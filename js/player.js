// ---------------------------------------------------------------
// player.js : lecture video (<video>+hls.js et API native Samsung AVPlay),
// reprise/watchdog de pause prolongee, retry sur erreur, OSD (barre de
// progression, boutons, menu de pistes, liste des episodes/chaines suivants)
// et ecran de demarrage (splash). Cf. app-shell.js pour le principe general
// du decoupage en plusieurs fichiers.
// ---------------------------------------------------------------

const videoPlayerEl = document.getElementById('video-player');
const playerErrorBox = document.getElementById('player-error');
let hlsInstance = null;

// ---------------------------------------------------------------
// Preferences visuelles des sous-titres (Parametres > Sous-titres),
// appliquees aux deux backends. AVPlay ne rend pas les sous-titres
// lui-meme (affichage manuel, cf. onsubtitlechange plus bas) : simple style
// inline sur #avplay-subtitle-overlay. <video> natif (hls.js) rend ses
// pistes WebVTT via le pseudo-element ::cue, seul point d'entree CSS
// standard pour ça — impossible a cibler via .style sur <video> lui-meme,
// on injecte/actualise donc une regle dediee dans un <style> a part.
// ---------------------------------------------------------------
const SUBTITLE_BASE_FONT_SIZE = 26;

function applySubtitleStylePrefs() {
    const prefs = getSubtitlePrefs();
    const font = SUBTITLE_FONT_OPTIONS[prefs.fontIndex] || SUBTITLE_FONT_OPTIONS[0];
    const color = (SUBTITLE_COLOR_OPTIONS[prefs.colorIndex] || SUBTITLE_COLOR_OPTIONS[0]).value;
    const bg = (SUBTITLE_BG_OPTIONS[prefs.bgIndex] || SUBTITLE_BG_OPTIONS[0]).value;
    // #player-view est delibirement exclu du zoom "Taille du texte" (cf.
    // applyTextSize dans app-shell.js) pour ne jamais deformer la video —
    // ce qui annule aussi, par ricochet, cet effet sur les sous-titres
    // (le contre-zoom du lecteur les neutralise). On applique donc ici le
    // meme facteur directement en pixels, pour que "Taille du texte"
    // affecte quand meme la lisibilite des sous-titres sans toucher a la
    // taille de la video elle-meme.
    const textSizeZoom = (TEXT_SIZE_OPTIONS[getTextSizeIndex()] || TEXT_SIZE_OPTIONS[1]).zoom;
    const fontSize = Math.round(SUBTITLE_BASE_FONT_SIZE * textSizeZoom);

    // #avplay-subtitle-overlay reste pleine largeur (necessaire pour centrer
    // le texte quelle que soit sa longueur), mais le style s'applique via
    // variables CSS a .subtitle-chip — un <span> cree a chaque ligne (cf.
    // onsubtitlechange) qui, lui, ne prend que la largeur du texte : la
    // bande pleine largeur venait de styler directement le conteneur
    // plutot que le texte.
    const overlay = document.getElementById('avplay-subtitle-overlay');
    overlay.style.setProperty('--subtitle-font', font);
    overlay.style.setProperty('--subtitle-color', color);
    overlay.style.setProperty('--subtitle-bg', bg);
    overlay.style.setProperty('--subtitle-size', fontSize + 'px');

    let styleEl = document.getElementById('subtitle-cue-style');
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'subtitle-cue-style';
        document.head.appendChild(styleEl);
    }
    styleEl.textContent = `video::cue { font-family: ${font}; color: ${color}; background: ${bg}; font-size: ${fontSize}px; }`;
}

applySubtitleStylePrefs();

// Certains panels renvoient des sous-titres au format ASS/SSA (ou mal
// convertis depuis ce format) : tags de mise en forme/positionnement entre
// accolades ("{\an8}", "{\pos(400,300)}"...) qui n'ont aucun sens hors de ce
// format et doivent etre retires plutot qu'affiches tels quels. Egalement,
// un saut de ligne littéral "<br>" (au lieu d'un vrai retour à la ligne) :
// on echappe tout le texte (donnee externe, pas de confiance) PUIS on ne
// re-autorise que ce tag precis.
function formatSubtitleText(raw) {
    const withoutAssTags = (raw || '').replace(/\{\\[^}]*\}/g, '');
    return escapeHtml(withoutAssTags).replace(/&lt;br\s*\/?&gt;/gi, '<br>');
}

// Etat de l'OSD du lecteur video. Gauche/Droite avance/recule directement
// dans la video par defaut (osdZone 'seek') ; Haut deploie la rangee de
// boutons (Lecture/Pause, Suivant, Audio, Sous-titres), navigable en
// Gauche/Droite une fois dessus ; Bas (depuis 'seek' ou 'buttons') deploie
// la liste des autres episodes/chaines, integree dans l'OSD (remplace
// l'ancien tiroir de zapping en modal).
let playerNav = 'hidden'; // 'hidden' | 'controls'
let osdZone = 'buttons'; // 'seek' | 'buttons' | 'episodes'
const PLAYER_BUTTONS = ['playpause', 'next', 'audio', 'subtitle', 'pip'];
let playerFocusIndex = PLAYER_BUTTONS.indexOf('playpause');
let playerHideTimer = null;
// Derniere piste choisie manuellement (par libelle, cf. confirmTrackMenuSelection) :
// reappliquee sur chaque nouvel episode pour ne pas revenir a VO/sans sous-titres
// a chaque enchainement automatique (cf. l'ecouteur 'ended' plus bas).
let preferredAudioLabel = null;
let preferredSubtitleLabel = null; // 'Désactivés' est une valeur explicite valide

// Liste des autres episodes/chaines du rail d'origine, capturee au moment
// ou l'utilisateur lance la lecture (cf. playRailItem) — repliee dans l'OSD,
// deployee via osdZone === 'episodes' (Bas depuis la barre de progression
// ou la rangee de boutons).
let zapList = [];
let zapIndex = -1;
let episodeFocusIndex = 0;
let currentCategoryLabel = '';
let currentPlayItem = null; // item en cours de lecture (pour la sauvegarde de la progression)
let currentPlaySection = null; // section (movies/series) associee a currentPlayItem
let progressSaveTimer = 0; // horodatage de la derniere sauvegarde de progression (throttle)

// Une pause prolongee laisse expirer la session/les segments cote panel :
// reprendre la lecture declenche alors une erreur et oblige a tout
// relancer manuellement. On reconnecte donc le flux en silence (a la meme
// position, sans repartir en lecture) apres quelques minutes de pause
// continue, pour que reprendre plus tard fonctionne normalement.
let pauseWatchdogTimer = null;
const PAUSE_REFRESH_DELAY_MS = 90000; // ~1min30 de pause avant reconnexion silencieuse

function armPauseWatchdog() {
    clearTimeout(pauseWatchdogTimer);
    pauseWatchdogTimer = setTimeout(refreshStalePausedStream, PAUSE_REFRESH_DELAY_MS);
}

function disarmPauseWatchdog() {
    clearTimeout(pauseWatchdogTimer);
}

function refreshStalePausedStream() {
    if (!currentPlayItem || !currentPlayItem.url) return;
    const isLive = currentPlayItem.url.includes('/live/');
    const { cur } = getPlaybackTimes();
    const resumeAt = isLive ? null : cur;
    const url = currentPlayItem.url;
    flashPlayerMessage('Flux réactualisé après une pause prolongée');
    if (avplayActive) {
        startAvplayPlayback(url, resumeAt, true);
    } else {
        startVideoPlayback(url, resumeAt, true);
    }
}

// Lecture via l'API native Samsung AVPlay (webapis.avplay), utilisee
// uniquement pour le contenu MULTI (cf. playStream) — seule capable
// d'exposer les pistes audio/sous-titres embarquees dans un conteneur
// mp4/ts/mkv quelconque, la ou <video>+hls.js exige un manifeste HLS que ce
// panel ne sait pas fournir pour la VOD/series.
let avplayActive = false;
let avplayActiveAudioIndex = -1;
let avplayActiveSubtitleIndex = -1; // -1 = sous-titres desactives

function isAvplayAvailable() {
    return typeof webapis !== 'undefined' && !!webapis.avplay;
}

// Menu de selection de piste audio / sous-titres (dans le player)
let trackMenuNav = false;
let trackMenuType = null; // 'audio' | 'subtitle'
let trackMenuList = [];
let trackMenuFocusIndex = 0;

// En cas d'echec de lecture, on retente automatiquement avant d'abandonner
// (cf. retryOrFailPlayback) — indispensable sur TV ou la console n'est pas
// visible pour diagnostiquer une simple latence reseau vs une vraie panne.
videoPlayerEl.addEventListener('error', function () {
    if (!currentPlayItem) return; // reset intentionnel (removeAttribute+load), pas une vraie erreur de lecture
    const err = this.error;
    const codeMap = { 1: 'ABORTED', 2: 'NETWORK', 3: 'DECODE', 4: 'SRC_NOT_SUPPORTED' };
    const label = err ? (codeMap[err.code] || err.code) : 'inconnue';
    console.error(`Erreur de lecture (${label})\n${this.src}`);
    retryOrFailPlayback(label);
});
videoPlayerEl.addEventListener('waiting', function () {
    showPlayerLoadingSpinner();
});
videoPlayerEl.addEventListener('canplay', function () {
    hidePlayerLoadingSpinner();
});

// Position/duree courantes, quel que soit le backend actif (<video> natif
// ou webapis.avplay) — utilise par updateProgressUI et la sauvegarde de
// progression, pour que les deux fonctionnent de façon transparente peu
// importe comment le contenu en cours est lu.
function getPlaybackTimes() {
    if (avplayActive) {
        let cur = 0, dur = NaN;
        try { cur = webapis.avplay.getCurrentTime() / 1000; } catch (e) {}
        try { dur = webapis.avplay.getDuration() / 1000; } catch (e) {}
        return { cur, dur };
    }
    return { cur: videoPlayerEl.currentTime || 0, dur: videoPlayerEl.duration };
}

function saveProgressNow() {
    if (!currentPlayItem || !currentPlaySection) return;
    const { cur, dur } = getPlaybackTimes();
    saveProgress(currentPlaySection, currentPlayItem, cur, dur);
}

function showPlayerLoadingSpinner(text) {
    document.getElementById('player-loading-text').innerText = text || 'Chargement...';
    document.getElementById('player-loading').classList.add('visible');
}

function hidePlayerLoadingSpinner() {
    document.getElementById('player-loading').classList.remove('visible');
}

// Une erreur de lecture peut n'etre qu'un incident reseau passager (le
// symptome remonte par l'utilisateur : latences puis erreurs) : plutot que
// d'abandonner immediatement, on retente automatiquement le MEME flux, a la
// meme position, avant d'afficher une erreur definitive. Le budget se
// reinitialise a chaque nouvelle lecture et des qu'une lecture saine
// redemarre, pour ne pas penaliser un contenu qui vient de replanter bien
// plus tard dans le visionnage.
let playbackRetryCount = 0;
const MAX_PLAYBACK_RETRIES = 2;
const PLAYBACK_RETRY_DELAY_MS = 2000;

function resetPlaybackRetryBudget() {
    playbackRetryCount = 0;
}

function retryOrFailPlayback(errorLabel) {
    if (!currentPlayItem || !currentPlayItem.url || playbackRetryCount >= MAX_PLAYBACK_RETRIES) {
        showFatalPlaybackError(errorLabel);
        return;
    }
    playbackRetryCount++;
    showPlayerLoadingSpinner(`Reconnexion (${playbackRetryCount}/${MAX_PLAYBACK_RETRIES})...`);
    const { cur } = getPlaybackTimes();
    const url = currentPlayItem.url;
    const isLive = url.includes('/live/');
    const resumeAt = isLive ? null : cur;
    const useAvplay = avplayActive;
    setTimeout(function () {
        if (useAvplay) startAvplayPlayback(url, resumeAt);
        else startVideoPlayback(url, resumeAt);
    }, PLAYBACK_RETRY_DELAY_MS);
}

function showFatalPlaybackError(errorLabel) {
    hidePlayerLoadingSpinner();
    playerErrorBox.innerText = `Lecture impossible après plusieurs tentatives (${errorLabel}).\nCe contenu semble indisponible sur le serveur.`;
    playerErrorBox.style.display = 'block';
}

// Enchainement automatique des episodes d'une serie (binge-watch) : ne
// s'applique qu'aux episodes (seriesId present), jamais aux films/chaines.
function handlePlaybackEnded() {
    if (currentPlayItem && currentPlayItem.seriesId && zapIndex >= 0 && zapIndex < zapList.length - 1) {
        playNextInZapList();
    }
}

// Sauvegarde throttlee (toutes les ~10s) : evite d'ecrire dans le
// localStorage a chaque frame tout en gardant la reprise a jour si l'appli
// est fermee brutalement (crash, coupure TV) sans passer par stopAndExitPlayer.
function onPlaybackProgressTick() {
    updateProgressUI();
    if (!currentPlayItem || !currentPlaySection) return;
    const now = Date.now();
    if (now - progressSaveTimer < 10000) return;
    progressSaveTimer = now;
    saveProgressNow();
}

videoPlayerEl.addEventListener('play', function () {
    updatePlayPauseIcon();
    disarmPauseWatchdog();
    hidePlayerLoadingSpinner();
    resetPlaybackRetryBudget();
});
videoPlayerEl.addEventListener('pause', function () {
    updatePlayPauseIcon();
    saveProgressNow();
    armPauseWatchdog();
});
videoPlayerEl.addEventListener('timeupdate', onPlaybackProgressTick);
videoPlayerEl.addEventListener('loadedmetadata', function () {
    updateAudioButtonLabel();
    updateSubtitleButtonLabel();
});
videoPlayerEl.addEventListener('ended', handlePlaybackEnded);

function seekToResumeOnLoad(resumeAt) {
    if (!resumeAt || resumeAt <= PROGRESS_MIN_SECONDS) return;
    const onLoadedForResume = function () {
        videoPlayerEl.currentTime = resumeAt;
        flashPlayerMessage(`Reprise à ${formatTime(resumeAt)}`);
        videoPlayerEl.removeEventListener('loadedmetadata', onLoadedForResume);
    };
    videoPlayerEl.addEventListener('loadedmetadata', onLoadedForResume);
}

// Lecture via <video> natif (+ hls.js pour les manifestes .m3u8). Les flux
// .m3u8 passent par hls.js : le tag <video> natif sonde la source avec une
// requête HEAD que l'endpoint /live/ de nombreux panels Xtream rejette
// (405), alors que hls.js ne fait que du GET.
// keepPaused (reconnexion silencieuse apres pause prolongee, cf.
// refreshStalePausedStream) : recharge le flux et se repositionne SANS
// relancer la lecture, pour ne pas surprendre l'utilisateur pendant qu'il
// ne regarde pas activement.
function startVideoPlayback(url, resumeAt, keepPaused) {
    if (!keepPaused) showPlayerLoadingSpinner();
    document.getElementById('av-player').style.display = 'none';
    videoPlayerEl.style.display = '';
    if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
    }
    videoPlayerEl.removeAttribute('src');
    videoPlayerEl.load();

    const isHls = url.toLowerCase().includes('.m3u8');
    if (isHls && typeof Hls !== 'undefined' && Hls.isSupported()) {
        // Buffer volontairement modeste : les valeurs par defaut de hls.js
        // (jusqu'a 600s / ~60 Mo tampon) sont pensees pour un PC, pas pour
        // une TV avec peu de RAM disponible.
        hlsInstance = new Hls({ maxBufferLength: 30, maxMaxBufferLength: 60, maxBufferSize: 20 * 1000 * 1000 });
        hlsInstance.on(Hls.Events.ERROR, function (event, data) {
            if (!data.fatal) return;
            console.error('Erreur HLS:', data);
            retryOrFailPlayback(`${data.type} / ${data.details}`);
        });
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, function () {
            applyPreferredAudioTrack();
            applyPreferredSubtitleTrack();
            updateAudioButtonLabel();
            updateSubtitleButtonLabel();
        });
        hlsInstance.on(Hls.Events.AUDIO_TRACKS_UPDATED, function () {
            applyPreferredAudioTrack();
            updateAudioButtonLabel();
        });
        hlsInstance.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, function () {
            applyPreferredSubtitleTrack();
            updateSubtitleButtonLabel();
        });
        hlsInstance.loadSource(url);
        hlsInstance.attachMedia(videoPlayerEl);
    } else {
        videoPlayerEl.src = url;
    }

    if (keepPaused) {
        if (resumeAt) {
            const onLoaded = function () {
                videoPlayerEl.currentTime = resumeAt;
                videoPlayerEl.pause();
                videoPlayerEl.removeEventListener('loadedmetadata', onLoaded);
            };
            videoPlayerEl.addEventListener('loadedmetadata', onLoaded);
        }
        // Repart pour un nouveau cycle si la pause se prolonge encore (ex. le
        // live n'a pas de position a reprendre, donc pas d'evenement 'pause'
        // natif a attendre pour se rearmer).
        armPauseWatchdog();
    } else {
        videoPlayerEl.play().catch(e => console.log('Erreur de lecture du flux:', e));
        seekToResumeOnLoad(resumeAt);
    }
}

// Repli utilise si webapis.avplay n'est pas disponible ou echoue a
// preparer/lire ce contenu : on revient a la lecture standard plutot que de
// bloquer l'utilisateur sur une erreur, quitte a perdre le changement de piste.
function fallBackToNativeVideo(url, resumeAt, message, keepPaused) {
    stopAvplayIfActive();
    startVideoPlayback(url, resumeAt, keepPaused);
    if (!keepPaused) flashPlayerMessage(message || 'Pistes multiples indisponibles pour ce contenu — lecture standard.');
}

// Lecture via l'API native Samsung AVPlay : seule capable d'exposer les
// pistes audio/sous-titres embarquees dans un conteneur mp4/ts/mkv
// quelconque (cf. getAudioTrackList/getSubtitleTrackList plus bas), sans
// dependre d'un manifeste HLS multi-pistes que ce panel ne sait pas fournir
// pour la VOD/series. keepPaused : cf. startVideoPlayback (reconnexion
// silencieuse apres pause prolongee, sans relancer la lecture).
function startAvplayPlayback(url, resumeAt, keepPaused) {
    if (!keepPaused) showPlayerLoadingSpinner();
    if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
    }
    videoPlayerEl.removeAttribute('src');
    videoPlayerEl.style.display = 'none';
    const obj = document.getElementById('av-player');
    obj.style.display = '';
    document.getElementById('avplay-subtitle-overlay').innerText = '';
    avplayActiveAudioIndex = -1;
    avplayActiveSubtitleIndex = -1;

    try {
        try { webapis.avplay.close(); } catch (e) {}
        webapis.avplay.open(url);
        webapis.avplay.setDisplayRect(0, 0, 1920, 1080);
        webapis.avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_FULL_SCREEN');
        webapis.avplay.setListener({
            onbufferingstart: function () { showPlayerLoadingSpinner(); },
            onbufferingprogress: function () {},
            onbufferingcomplete: function () { hidePlayerLoadingSpinner(); },
            onstreamcompleted: function () {
                avplayActive = false;
                handlePlaybackEnded();
            },
            oncurrentplaytime: function () {
                onPlaybackProgressTick();
            },
            onerror: function (err) {
                console.error('Erreur AVPlay:', err);
                // AVPlay a deja son propre repli natif (probleme de piste/format) ;
                // si celui-ci echoue a son tour, la logique de retry du <video>
                // natif prend le relais (cf. l'ecouteur 'error' de videoPlayerEl).
                fallBackToNativeVideo(url, resumeAt, null, keepPaused);
            },
            onevent: function () {},
            onsubtitlechange: function (duration, text) {
                const overlay = document.getElementById('avplay-subtitle-overlay');
                overlay.innerHTML = text ? `<span class="subtitle-chip">${formatSubtitleText(text)}</span>` : '';
            },
            ondrmevent: function () {}
        });
        webapis.avplay.prepareAsync(function () {
            avplayActive = true;
            hidePlayerLoadingSpinner();
            resetPlaybackRetryBudget();
            try {
                const audioTracks = webapis.avplay.getTotalTrackInfo().filter(t => t.type === 'AUDIO');
                avplayActiveAudioIndex = audioTracks.length ? audioTracks[0].index : -1;
            } catch (e) {}
            webapis.avplay.play();
            if (keepPaused) {
                if (resumeAt) { try { webapis.avplay.seekTo(Math.round(resumeAt * 1000)); } catch (e) {} }
                try { webapis.avplay.pause(); } catch (e) {}
                // Pas d'evenement DOM natif a ecouter ici : on se rearme directement.
                armPauseWatchdog();
            } else if (resumeAt && resumeAt > PROGRESS_MIN_SECONDS) {
                webapis.avplay.seekTo(Math.round(resumeAt * 1000));
                flashPlayerMessage(`Reprise à ${formatTime(resumeAt)}`);
            }
            applyPreferredAudioTrack();
            applyPreferredSubtitleTrack();
            updateAudioButtonLabel();
            updateSubtitleButtonLabel();
            updatePlayPauseIcon();
        }, function (err) {
            console.error('Erreur preparation AVPlay:', err);
            avplayActive = false;
            fallBackToNativeVideo(url, resumeAt, null, keepPaused);
        });
    } catch (e) {
        console.error('AVPlay indisponible:', e);
        avplayActive = false;
        fallBackToNativeVideo(url, resumeAt, null, keepPaused);
    }
}

function stopAvplayIfActive() {
    if (!avplayActive) return;
    try { webapis.avplay.stop(); } catch (e) {}
    try { webapis.avplay.close(); } catch (e) {}
    avplayActive = false;
    document.getElementById('av-player').style.display = 'none';
    document.getElementById('avplay-subtitle-overlay').innerText = '';
}

// Envoie un contenu au lecteur et passe en plein écran. Le contenu MULTI
// (hors chaines live) passe par l'API native AVPlay pour le choix de piste
// audio/sous-titres (cf. startAvplayPlayback) ; tout le reste garde le
// pipeline <video>+hls.js existant, deja fiable et performant.
function playStream(url, name, categoryLabel, logo, resumeAt) {
    // Un mini-lecteur actif doit s'effacer devant toute nouvelle lecture
    // lancee ailleurs dans l'app (cf. retour utilisateur) : on recupere les
    // elements de lecture dans #player-view sans les arreter, puisque le
    // reste de cette fonction (startVideoPlayback/startAvplayPlayback) va de
    // toute façon les reinitialiser pour le nouveau contenu juste apres.
    if (miniPlayerActive) {
        returnMiniPlayerElementsToPlayerView();
        document.getElementById('mini-player').classList.remove('visible');
        miniPlayerActive = false;
        miniPlayerFocused = false;
    }

    showView('player');
    disarmPauseWatchdog();
    resetPlaybackRetryBudget();

    // Retrouve la piste audio/sous-titres choisie manuellement la derniere
    // fois que CE contenu precis a ete lu (cf. saveTrackPref), y compris
    // apres avoir quitte et relance l'app. A defaut d'un choix specifique a
    // ce contenu, on garde le comportement existant (preferredAudioLabel/
    // preferredSubtitleLabel deja en memoire, reporte d'un episode a l'autre
    // pendant la session en cours).
    const savedTrackPref = getTrackPref(currentPlaySection, currentPlayItem);
    if (savedTrackPref) {
        if (savedTrackPref.audioLabel) preferredAudioLabel = savedTrackPref.audioLabel;
        if (savedTrackPref.subtitleLabel !== null && savedTrackPref.subtitleLabel !== undefined) preferredSubtitleLabel = savedTrackPref.subtitleLabel;
    }

    playerErrorBox.style.display = 'none';
    closeEpisodeList();
    osdZone = 'buttons';
    hidePlayerControls();
    playerFocusIndex = PLAYER_BUTTONS.indexOf('playpause');
    document.getElementById('player-time-current').innerText = '00:00';
    document.getElementById('player-time-duration').innerText = '00:00';
    document.getElementById('player-progress-fill').style.width = '0%';
    document.getElementById('player-progress-handle').style.left = '0%';
    document.getElementById('label-audio').innerText = 'Audio';
    document.getElementById('label-subtitle').innerText = 'Off';

    if (categoryLabel) currentCategoryLabel = categoryLabel;
    document.getElementById('osd-program-name').innerText = name || '—';
    document.getElementById('osd-category-name').innerText = currentCategoryLabel;
    const logoEl = document.getElementById('osd-logo');
    if (logo) {
        logoEl.src = logo;
        logoEl.style.display = '';
    } else {
        logoEl.removeAttribute('src');
        logoEl.style.display = 'none';
    }

    const isLive = url.includes('/live/');
    // AVPlay est necessaire des qu'un titre annonce plusieurs pistes audio
    // ("MULTI") OU des sous-titres embarques ("VOST"/"VOSTFR") : <video>+hls.js
    // ne peut exposer aucune de ces pistes sans manifeste HLS, que ce panel
    // ne genere pas pour la VOD/series (cf. resolveExtension).
    const needsAvplayTracks = /\b(multi|vost(?:fr)?)\b/i.test(name || '');
    if (!isLive && needsAvplayTracks && isAvplayAvailable()) {
        startAvplayPlayback(url, resumeAt);
    } else {
        stopAvplayIfActive();
        startVideoPlayback(url, resumeAt);
    }

    requestPlayerFullscreen();
}

function requestPlayerFullscreen() {
    const playerView = document.getElementById('player-view');
    const requestFs = playerView.requestFullscreen || playerView.webkitRequestFullscreen || playerView.mozRequestFullScreen;
    if (requestFs) {
        Promise.resolve(requestFs.call(playerView)).catch(() => {});
    }
}

// Coupe reellement le flux (AVPlay/hls.js/<video>) : partage par
// stopAndExitPlayer et closeMiniPlayerAndDiscard (fermeture du mini-lecteur
// sans repasser par la vue plein ecran).
function releasePlaybackResources() {
    stopAvplayIfActive();
    if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
    }
    videoPlayerEl.pause();
    videoPlayerEl.removeAttribute('src');
    videoPlayerEl.load();
}

// #player-view passe en VRAI plein ecran navigateur (requestFullscreen,
// cf. playStream) : tant qu'on y est, tout element qui n'est pas cet
// element (ou l'un de ses descendants) — comme la modale de confirmation ou
// le mini-lecteur, tous deux hors de #player-view — peut rester invisible/
// inerte sur certains moteurs. On sort donc du plein ecran AVANT de leur
// laisser la main, pas seulement en quittant completement le lecteur.
function exitFullscreenIfActive() {
    const exitFs = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen;
    if (document.fullscreenElement && exitFs) {
        Promise.resolve(exitFs.call(document)).catch(() => {});
    }
}

function stopAndExitPlayer() {
    disarmPauseWatchdog();
    saveProgressNow();
    currentPlayItem = null;
    currentPlaySection = null;
    resetPlaybackRetryBudget();
    hidePlayerLoadingSpinner();

    playerErrorBox.style.display = 'none';
    closeEpisodeList();
    osdZone = 'buttons';
    hidePlayerControls();
    releasePlaybackResources();
    exitFullscreenIfActive();

    showView('browse');
}

// ---------------------------------------------------------------
// Mini-lecteur (PiP maison) : reduit la lecture dans un coin de l'ecran
// pour continuer a naviguer dans le reste de l'app (categories, recherche)
// pendant que la video continue, plutot que de couper le flux comme le fait
// stopAndExitPlayer. Fonctionne en deplaçant reellement les elements de
// lecture (<video> ou <object> AVPlay) hors de #player-view vers #mini-player
// (persistant, hors du systeme de vues .view) : contrairement a un simple
// display:none sur #player-view, ça garantit que la lecture continue quel
// que soit le comportement du WebKit Tizen vis-a-vis d'une vue masquee.
// ---------------------------------------------------------------
let miniPlayerActive = false;
let miniPlayerFocused = false;
const MINI_PLAYER_RECT = { x: 1920 - 640 - 32, y: 1080 - 360 - 32, w: 640, h: 360 };

function enterMiniPlayer() {
    exitFullscreenIfActive();
    const frame = document.getElementById('mini-player-frame');
    frame.appendChild(videoPlayerEl);
    frame.appendChild(document.getElementById('av-player'));
    frame.appendChild(document.getElementById('avplay-subtitle-overlay'));
    if (avplayActive) {
        try { webapis.avplay.setDisplayRect(MINI_PLAYER_RECT.x, MINI_PLAYER_RECT.y, MINI_PLAYER_RECT.w, MINI_PLAYER_RECT.h); } catch (e) {}
    }
    hidePlayerControls();
    closeEpisodeList();
    if (trackMenuNav) closeTrackMenu();
    document.getElementById('mini-player-label').innerText = document.getElementById('osd-program-name').innerText || '—';
    document.getElementById('mini-player').classList.add('visible');
    miniPlayerActive = true;
    showView('browse');
}

// Remet <video>/#av-player a leur place normale dans #player-view, dans
// l'ordre d'origine (important : ce sont des calques position:absolute,
// l'ordre DOM determine lequel s'affiche au-dessus des overlays du lecteur).
function returnMiniPlayerElementsToPlayerView() {
    const playerViewEl = document.getElementById('player-view');
    playerViewEl.insertBefore(videoPlayerEl, playerViewEl.firstChild);
    const avEl = document.getElementById('av-player');
    playerViewEl.insertBefore(avEl, videoPlayerEl.nextSibling);
    playerViewEl.insertBefore(document.getElementById('avplay-subtitle-overlay'), avEl.nextSibling);
}

function expandMiniPlayerToFullscreen() {
    returnMiniPlayerElementsToPlayerView();
    if (avplayActive) {
        try { webapis.avplay.setDisplayRect(0, 0, 1920, 1080); } catch (e) {}
    }
    document.getElementById('mini-player').classList.remove('visible');
    miniPlayerActive = false;
    miniPlayerFocused = false;
    showView('player');
    hidePlayerControls();
    requestPlayerFullscreen();
}

// Ferme le mini-lecteur en coupant reellement le flux (ex. Retour depuis le
// mini-lecteur focus, ou une nouvelle lecture lancee ailleurs qui doit s'y
// substituer, cf. playStream) — a la difference d'expandMiniPlayerToFullscreen
// qui, lui, reprend la lecture en plein ecran.
function closeMiniPlayerAndDiscard() {
    disarmPauseWatchdog();
    saveProgressNow();
    releasePlaybackResources();
    returnMiniPlayerElementsToPlayerView();
    document.getElementById('mini-player').classList.remove('visible');
    miniPlayerActive = false;
    miniPlayerFocused = false;
    currentPlayItem = null;
    currentPlaySection = null;
}

function setMiniPlayerFocused(focused) {
    miniPlayerFocused = focused;
    document.getElementById('mini-player').classList.toggle('focused', focused);
}

// Dispatch dedie pendant que le focus D-pad est sur le mini-lecteur (cf.
// l'ecouteur keydown global dans input.js) : OK l'agrandit, Retour l'arrete
// completement, toute autre touche en ressort vers la zone d'origine.
function handleMiniPlayerKey(keyCode) {
    if (keyCode === 13) {
        expandMiniPlayerToFullscreen();
    } else if (keyCode === 10009 || keyCode === 8) {
        closeMiniPlayerAndDiscard();
    } else {
        setMiniPlayerFocused(false);
    }
}

// ---------------------------------------------------------------
// OSD du lecteur : affichage/masquage, navigation, actions
// ---------------------------------------------------------------
const ICON_PLAY = '<svg viewBox="0 0 24 24" width="22" height="22" fill="white"><path d="M8 5v14l11-7z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="white"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';

function showPlayerControls() {
    playerNav = 'controls';
    document.getElementById('player-osd').classList.add('visible');
    updatePlayerButtonFocus();
    resetPlayerHideTimer();
}

function hidePlayerControls() {
    playerNav = 'hidden';
    osdZone = 'buttons';
    playerFocusIndex = PLAYER_BUTTONS.indexOf('playpause');
    document.getElementById('player-osd').classList.remove('visible');
    document.getElementById('osd-episode-list').classList.remove('visible');
    clearTimeout(playerHideTimer);
}

function resetPlayerHideTimer() {
    clearTimeout(playerHideTimer);
    playerHideTimer = setTimeout(hidePlayerControls, 4000);
}

function updatePlayerButtonFocus() {
    PLAYER_BUTTONS.forEach((action, idx) => {
        document.getElementById(`player-btn-${action}`).classList.toggle('focused', osdZone === 'buttons' && idx === playerFocusIndex);
    });
    // La timeline s'épaissit quand elle est la zone active (osdZone === 'seek').
    document.getElementById('osd-progress-track').classList.toggle('focused', osdZone === 'seek');
}

function activatePlayerButton(action) {
    switch (action) {
        case 'playpause': togglePlayPause(); break;
        case 'next': playNextInZapList(); break;
        case 'audio': openTrackMenu('audio'); break;
        case 'subtitle': openTrackMenu('subtitle'); break;
        case 'pip': enterMiniPlayer(); break;
    }
}

// Avance directement a l'episode/contenu suivant de la liste en cours (meme
// contexte que le tiroir de zapping), sans avoir a l'ouvrir.
function playNextInZapList() {
    if (zapIndex < 0 || zapIndex >= zapList.length - 1) {
        flashPlayerMessage('Aucun contenu suivant');
        return;
    }
    zapIndex++;
    const item = zapList[zapIndex];
    trackRecent(browseSectionKey, item);
    playItemWithResume(item, currentCategoryLabel);
    showPlayerControls();
}

function togglePlayPause() {
    if (avplayActive) {
        try {
            const playing = webapis.avplay.getState() === 'PLAYING';
            if (playing) { webapis.avplay.pause(); saveProgressNow(); armPauseWatchdog(); }
            else { webapis.avplay.play(); disarmPauseWatchdog(); }
        } catch (e) { console.error('AVPlay play/pause:', e); }
        updatePlayPauseIcon();
        return;
    }
    if (videoPlayerEl.paused) {
        videoPlayerEl.play().catch(e => console.log('Erreur de lecture du flux:', e));
    } else {
        videoPlayerEl.pause();
    }
}

function updatePlayPauseIcon() {
    let paused = true;
    if (avplayActive) {
        try { paused = webapis.avplay.getState() !== 'PLAYING'; } catch (e) {}
    } else {
        paused = videoPlayerEl.paused;
    }
    document.getElementById('player-btn-playpause').innerHTML = paused ? ICON_PLAY : ICON_PAUSE;
}

function seekBy(seconds) {
    if (avplayActive) {
        const { cur, dur } = getPlaybackTimes();
        if (!isFinite(dur)) { flashPlayerMessage('Avance/retour indisponible en direct'); return; }
        const targetMs = Math.max(0, Math.min(dur, cur + seconds)) * 1000;
        try { webapis.avplay.seekTo(Math.round(targetMs)); } catch (e) { console.error('AVPlay seekTo:', e); }
        return;
    }
    if (!isFinite(videoPlayerEl.duration)) {
        flashPlayerMessage('Avance/retour indisponible en direct');
        return;
    }
    videoPlayerEl.currentTime = Math.max(0, Math.min(videoPlayerEl.duration, videoPlayerEl.currentTime + seconds));
}

// Avance/recul depuis la barre de progression (osdZone 'seek', cf.
// handleLeft/handleRight) : rester appuye envoie des keydown repetes
// (auto-repeat de la telecommande/du navigateur) — sans acceleration,
// chacun ne vaut que le pas fixe de seekBy (10s), ce qui rend le rembobinage
// d'un long film tres lent. On agrandit le pas a chaque repetition tant que
// les appuis restent rapproches ; un relachement (keyup, cf. l'ecouteur
// dans input.js) ou une pause plus longue que SEEK_HOLD_RESET_MS remet a zero.
const SEEK_HOLD_RESET_MS = 700;
const SEEK_HOLD_STEPS_S = [10, 10, 20, 30, 60, 90, 120];
let seekHoldStreak = 0;
let seekHoldDirection = 0;
let seekHoldLastAt = 0;

// direction : -1 (recul) ou 1 (avance)
function seekHeld(direction) {
    const now = Date.now();
    if (direction !== seekHoldDirection || (now - seekHoldLastAt) > SEEK_HOLD_RESET_MS) {
        seekHoldStreak = 0;
        seekHoldDirection = direction;
    }
    seekHoldLastAt = now;
    const amount = SEEK_HOLD_STEPS_S[Math.min(seekHoldStreak, SEEK_HOLD_STEPS_S.length - 1)];
    seekHoldStreak++;
    seekBy(direction * amount);
}

function resetSeekHold() {
    seekHoldStreak = 0;
    seekHoldDirection = 0;
}

// Elements references une seule fois : updateProgressUI tourne en continu
// pendant toute la lecture (plusieurs fois par seconde), un getElementById
// repete par appel est un cout inutile sur tout la duree du visionnage.
const progressUiEls = {
    current: document.getElementById('player-time-current'),
    liveBadge: document.getElementById('osd-live-badge'),
    duration: document.getElementById('player-time-duration'),
    remaining: document.getElementById('osd-remaining'),
    fill: document.getElementById('player-progress-fill'),
    handle: document.getElementById('player-progress-handle')
};

function updateProgressUI() {
    const { cur, dur } = getPlaybackTimes();
    const isLive = !(isFinite(dur) && dur > 0);

    progressUiEls.current.innerText = formatTime(cur);
    progressUiEls.liveBadge.classList.toggle('visible', isLive);
    progressUiEls.duration.style.display = isLive ? 'none' : '';
    progressUiEls.remaining.innerText = isLive ? '' : `-${formatTime(dur - cur)}`;

    if (isLive) {
        progressUiEls.fill.style.width = '100%';
        progressUiEls.handle.style.left = '100%';
    } else {
        const pct = (cur / dur * 100).toFixed(2);
        progressUiEls.duration.innerText = formatTime(dur);
        progressUiEls.fill.style.width = `${pct}%`;
        progressUiEls.handle.style.left = `${pct}%`;
    }
}

// Horloge temps reel affichee dans le HUD (mise a jour peu frequente, cout negligeable)
function updateClock() {
    const now = new Date();
    document.getElementById('osd-clock').innerText =
        `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
}
updateClock();
setInterval(updateClock, 30000);

let playerToastTimer = null;
function flashPlayerMessage(msg) {
    const el = document.getElementById('player-toast');
    el.innerText = msg;
    el.style.display = 'block';
    clearTimeout(playerToastTimer);
    playerToastTimer = setTimeout(() => { el.style.display = 'none'; }, 2500);
}

// Pistes audio : hls.js expose les renditions EXT-X-MEDIA d'un manifeste HLS ;
// en lecture native on retombe sur l'API standard HTMLMediaElement.audioTracks
// (support variable selon le conteneur/plateforme du flux).
// Extrait le libelle de langue d'une piste AVPlay (le format exact du JSON
// extra_info varie selon les versions de Tizen : on tente les cles connues).
function avplayTrackLabel(track, fallback) {
    try {
        const extra = JSON.parse(track.extra_info);
        return extra.language || extra.track_lang || extra.lang || fallback;
    } catch (e) {
        return fallback;
    }
}

function getAvplayTracks(type) {
    try {
        return webapis.avplay.getTotalTrackInfo().filter(t => t.type === type);
    } catch (e) {
        return [];
    }
}

// Le libelle exact utilise par AVPlay pour les pistes de sous-titres varie
// selon les firmwares Tizen (la documentation Samsung indique 'TEXT', mais
// certains modeles renvoient autre chose) : on essaie plusieurs variantes
// connues, puis en dernier recours tout ce qui n'est ni AUDIO ni VIDEO.
// avplaySubtitleTrackType retient le libelle reellement trouve pour que
// selectSubtitleTrack utilise le MEME type lors de l'appel a setSelectTrack.
let avplaySubtitleTrackType = 'TEXT';
function getAvplaySubtitleTracks() {
    let all;
    try {
        all = webapis.avplay.getTotalTrackInfo();
    } catch (e) {
        return [];
    }
    let subs = all.filter(t => ['TEXT', 'SUBTITLE', 'SUBTITLES', 'TTML', 'DATA'].includes(t.type));
    if (!subs.length) {
        subs = all.filter(t => t.type !== 'AUDIO' && t.type !== 'VIDEO');
    }
    if (subs.length) avplaySubtitleTrackType = subs[0].type;
    return subs;
}

function getAudioTrackList() {
    if (avplayActive) {
        return getAvplayTracks('AUDIO').map(t => ({
            index: t.index,
            label: avplayTrackLabel(t, `Piste ${t.index}`),
            active: t.index === avplayActiveAudioIndex
        }));
    }
    if (hlsInstance && hlsInstance.audioTracks && hlsInstance.audioTracks.length) {
        return hlsInstance.audioTracks.map((t, idx) => ({
            index: idx,
            label: t.name || t.lang || `Piste ${idx + 1}`,
            active: hlsInstance.audioTrack === idx
        }));
    }
    const tracks = videoPlayerEl.audioTracks;
    const list = [];
    if (tracks && tracks.length) {
        for (let i = 0; i < tracks.length; i++) {
            list.push({ index: i, label: tracks[i].label || tracks[i].language || `Piste ${i + 1}`, active: tracks[i].enabled });
        }
    }
    return list;
}

function selectAudioTrack(idx) {
    if (avplayActive) {
        try {
            webapis.avplay.setSelectTrack('AUDIO', idx);
            avplayActiveAudioIndex = idx;
        } catch (e) { console.error('AVPlay setSelectTrack AUDIO:', e); }
        updateAudioButtonLabel();
        return;
    }
    if (hlsInstance && hlsInstance.audioTracks && hlsInstance.audioTracks.length) {
        hlsInstance.audioTrack = idx;
    } else if (videoPlayerEl.audioTracks && videoPlayerEl.audioTracks.length) {
        for (let i = 0; i < videoPlayerEl.audioTracks.length; i++) {
            videoPlayerEl.audioTracks[i].enabled = (i === idx);
        }
    }
    updateAudioButtonLabel();
}

function updateAudioButtonLabel() {
    const list = getAudioTrackList();
    const active = list.find(t => t.active);
    document.getElementById('label-audio').innerText = active ? active.label : 'Audio';
}

// Sous-titres : hls.js gère les EXT-X-MEDIA:TYPE=SUBTITLES d'un manifeste HLS ;
// en natif on s'appuie sur videoPlayerEl.textTracks. index -1 = piste desactivee.
function getSubtitleTrackList() {
    const list = [{ index: -1, label: 'Désactivés', active: false }];

    if (avplayActive) {
        getAvplaySubtitleTracks().forEach(t => {
            list.push({ index: t.index, label: avplayTrackLabel(t, `Piste ${t.index}`), active: t.index === avplayActiveSubtitleIndex });
        });
        list[0].active = avplayActiveSubtitleIndex === -1;
        return list;
    }

    if (hlsInstance && hlsInstance.subtitleTracks && hlsInstance.subtitleTracks.length) {
        hlsInstance.subtitleTracks.forEach((t, idx) => {
            list.push({ index: idx, label: t.name || t.lang || `Piste ${idx + 1}`, active: hlsInstance.subtitleTrack === idx });
        });
        list[0].active = hlsInstance.subtitleTrack === -1;
        return list;
    }

    const tt = videoPlayerEl.textTracks;
    let anyShowing = false;
    if (tt && tt.length) {
        for (let i = 0; i < tt.length; i++) {
            const showing = tt[i].mode === 'showing';
            if (showing) anyShowing = true;
            list.push({ index: i, label: tt[i].label || tt[i].language || `Piste ${i + 1}`, active: showing });
        }
    }
    list[0].active = !anyShowing;
    return list;
}

function selectSubtitleTrack(idx) {
    if (avplayActive) {
        try {
            if (idx === -1) {
                webapis.avplay.setSilentSubtitle(true);
            } else {
                webapis.avplay.setSelectTrack(avplaySubtitleTrackType, idx);
                webapis.avplay.setSilentSubtitle(false);
            }
            avplayActiveSubtitleIndex = idx;
            if (idx === -1) document.getElementById('avplay-subtitle-overlay').innerText = '';
        } catch (e) { console.error('AVPlay setSelectTrack TEXT:', e); }
        updateSubtitleButtonLabel();
        return;
    }
    if (hlsInstance && hlsInstance.subtitleTracks && hlsInstance.subtitleTracks.length) {
        hlsInstance.subtitleTrack = idx;
        hlsInstance.subtitleDisplay = idx !== -1;
    } else if (videoPlayerEl.textTracks && videoPlayerEl.textTracks.length) {
        for (let i = 0; i < videoPlayerEl.textTracks.length; i++) {
            videoPlayerEl.textTracks[i].mode = (i === idx) ? 'showing' : 'disabled';
        }
    }
    updateSubtitleButtonLabel();
}

function updateSubtitleButtonLabel() {
    const list = getSubtitleTrackList();
    const active = list.find(t => t.active);
    document.getElementById('label-subtitle').innerText = active ? active.label : 'Off';
}

// ---------------------------------------------------------------
// Menu de selection de piste (audio ou sous-titres) : liste lisible
// avec radio de selection, navigable Haut/Bas, OK pour valider.
// ---------------------------------------------------------------
function openTrackMenu(type) {
    const list = type === 'audio' ? getAudioTrackList() : getSubtitleTrackList();
    if (type === 'audio' && list.length === 0) {
        flashPlayerMessage('Aucune piste audio disponible');
        return;
    }
    if (type === 'audio' && list.length === 1) {
        flashPlayerMessage('Une seule piste audio disponible');
        return;
    }
    // Pour les sous-titres, "Désactivés" est toujours present : list.length
    // === 1 signifie donc qu'aucune piste de sous-titres reelle n'a ete
    // trouvee dans le fichier (aucun menu a afficher dans ce cas).
    if (type === 'subtitle' && list.length === 1) {
        if (avplayActive) {
            // Diagnostic a l'ecran (pas d'acces console sur cette TV) : si le
            // sous-titrage existe reellement (confirme sur un autre lecteur)
            // mais n'apparait toujours pas ici, ce dump donne le detail exact
            // renvoye par getTotalTrackInfo pour identifier le bon libelle de type.
            try {
                const all = webapis.avplay.getTotalTrackInfo();
                playerErrorBox.innerText = `Sous-titres introuvables — pistes detectees :\n${JSON.stringify(all.map(t => ({ type: t.type, index: t.index })))}`;
                playerErrorBox.style.display = 'block';
            } catch (e) {}
        }
        flashPlayerMessage('Aucun sous-titre disponible dans ce fichier');
        return;
    }

    trackMenuType = type;
    trackMenuList = list;
    trackMenuFocusIndex = Math.max(0, list.findIndex(t => t.active));
    trackMenuNav = true;
    clearTimeout(playerHideTimer); // le menu reste ouvert tant qu'on ne le ferme pas explicitement

    document.getElementById('track-menu-title').innerText = type === 'audio' ? 'Piste audio' : 'Sous-titres';
    document.getElementById('player-track-menu').classList.add('visible');
    renderTrackMenu();
}

function closeTrackMenu() {
    trackMenuNav = false;
    document.getElementById('player-track-menu').classList.remove('visible');
}

function renderTrackMenu() {
    const list = document.getElementById('track-menu-list');
    list.innerHTML = '';
    trackMenuList.forEach((item, idx) => {
        const row = document.createElement('div');
        row.className = `track-menu-item ${idx === trackMenuFocusIndex ? 'focused' : ''} ${item.active ? 'active' : ''}`;
        row.innerHTML = `<span class="track-menu-radio"></span><span>${item.label}</span>`;
        list.appendChild(row);
    });
    const focusedEl = list.children[trackMenuFocusIndex];
    if (focusedEl) focusedEl.scrollIntoView({ block: 'nearest' });
}

function confirmTrackMenuSelection() {
    const item = trackMenuList[trackMenuFocusIndex];
    if (!item) return;
    if (trackMenuType === 'audio') {
        selectAudioTrack(item.index);
        preferredAudioLabel = item.label;
    } else {
        selectSubtitleTrack(item.index);
        preferredSubtitleLabel = item.label;
    }
    // Persiste immediatement (pas seulement en memoire) pour que ce choix
    // soit retrouve meme apres avoir quitte l'app, la prochaine fois que ce
    // contenu precis est repris (cf. getTrackPref dans playStream).
    saveTrackPref(currentPlaySection, currentPlayItem, preferredAudioLabel, preferredSubtitleLabel);
    closeTrackMenu();
    showPlayerControls();
}

// Reapplique la derniere piste choisie manuellement (par libelle) des que la
// liste des pistes du nouvel episode est connue, sans quoi hls.js repart
// systematiquement sur la piste par defaut du flux (VO, sous-titres off).
function applyPreferredAudioTrack() {
    if (!preferredAudioLabel) return;
    const match = getAudioTrackList().find(t => t.label === preferredAudioLabel);
    if (match && !match.active) selectAudioTrack(match.index);
}

function applyPreferredSubtitleTrack() {
    if (preferredSubtitleLabel === null) return;
    const match = getSubtitleTrackList().find(t => t.label === preferredSubtitleLabel);
    if (match && !match.active) selectSubtitleTrack(match.index);
}

// ---------------------------------------------------------------
// Liste des autres episodes/chaines, integree dans l'OSD (osdZone
// 'episodes') : Bas depuis la barre de progression ou la rangee de boutons
// la deploie, Haut/Bas dedans deplacent la selection, OK change de contenu.
// ---------------------------------------------------------------
function openEpisodeList() {
    if (!zapList.length) {
        flashPlayerMessage('Aucun autre contenu dans cette liste');
        return;
    }
    osdZone = 'episodes';
    episodeFocusIndex = zapIndex >= 0 ? zapIndex : 0;
    clearTimeout(playerHideTimer); // la liste reste ouverte tant qu'on ne la ferme pas explicitement
    document.getElementById('osd-episode-list').classList.add('visible');
    updatePlayerButtonFocus();
    renderEpisodeList();
}

function closeEpisodeList() {
    document.getElementById('osd-episode-list').classList.remove('visible');
    resetPlayerHideTimer();
}

function renderEpisodeList() {
    const list = document.getElementById('osd-episode-list');
    list.innerHTML = '';
    zapList.forEach((item, idx) => {
        const row = document.createElement('div');
        row.className = `osd-episode-item ${idx === episodeFocusIndex ? 'focused' : ''} ${idx === zapIndex ? 'playing' : ''}`;
        const logoHtml = item.logo ? `<img src="${escapeHtml(item.logo)}" loading="lazy" decoding="async" onerror="this.style.display='none'">` : '';
        row.innerHTML = `${logoHtml}<span>${escapeHtml(item.name)}</span>`;
        list.appendChild(row);
    });
    const focusedEl = list.children[episodeFocusIndex];
    if (focusedEl) focusedEl.scrollIntoView({ block: 'nearest' });
}

function selectEpisodeListItem() {
    const item = zapList[episodeFocusIndex];
    if (!item) return;
    zapIndex = episodeFocusIndex;
    closeEpisodeList();
    osdZone = 'buttons';
    updatePlayerButtonFocus();
    trackRecent(browseSectionKey, item);
    playItemWithResume(item, currentCategoryLabel);
    showPlayerControls();
}

// Ecran de demarrage affiche juste apres connexion : joue la video de splash
// (images/splash.mp4) pendant que les categories de chaque section sont
// pre-chargees en arriere-plan, plutot que de laisser l'utilisateur
// decouvrir le temps de chargement en ouvrant Films/Series/Direct pour la
// premiere fois. La duree de l'ecran suit celle de la video (fin de lecture)
// plutot qu'un delai fixe ; si le pre-chargement est plus lent que la video,
// un delai de securite le laisse continuer en arriere-plan (l'ouverture
// normale d'une section, plus tard, se contente sinon d'attendre comme avant).
async function showSplashAndPreload() {
    showView('splash');
    const sections = ['live', 'movies', 'series'];

    const preload = (async () => {
        for (const sectionKey of sections) {
            if (!categoriesCache[sectionKey]) {
                try {
                    const { serverUrl, username, password } = window.iptvServerConfig;
                    const action = sectionConfig[sectionKey].catAction;
                    categoriesCache[sectionKey] = await fetchJson(`${serverUrl}/player_api.php?username=${username}&password=${password}&action=${action}`, 1);
                } catch (e) {
                    console.error(`Erreur pre-chargement categories (${sectionKey}):`, e);
                }
            }
        }
        schedulePersistCaches();
    })();

    const video = document.getElementById('splash-video');
    // Filet de securite : autoplay bloque, fichier absent du build Tizen,
    // codec non supporte... la video ne doit jamais bloquer l'acces a l'app.
    const SPLASH_VIDEO_TIMEOUT_MS = 12000;
    const videoPlayed = new Promise(resolve => {
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        video.addEventListener('ended', finish, { once: true });
        video.addEventListener('error', finish, { once: true });
        setTimeout(finish, SPLASH_VIDEO_TIMEOUT_MS);
        video.currentTime = 0;
        const playPromise = video.play();
        if (playPromise && playPromise.catch) playPromise.catch(finish);
    });

    const SPLASH_MAX_MS = 6000;
    await Promise.all([videoPlayed, Promise.race([preload, new Promise(resolve => setTimeout(resolve, SPLASH_MAX_MS))])]);

    // Sur Tizen, la video est souvent affichee via un plan materiel distinct
    // du DOM normal : masquer #splash-view (display:none) ne suffit pas
    // toujours a faire disparaitre immediatement la derniere frame decodee,
    // qui peut alors "fuiter" un instant au-dessus du lecteur suivant. Vider
    // explicitement la source force la liberation de ce plan video.
    video.pause();
    video.removeAttribute('src');
    video.load();

    enterHome();
}

