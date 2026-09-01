// ---------------------------------------------------------------
// Etat global de navigation
// ---------------------------------------------------------------
let currentView = 'login'; // 'login' | 'home' | 'browse' | 'player'
let loginFocusIndex = 0; // 0: url, 1: user, 2: pass, 3: btn

const CREDENTIALS_KEY = 'iptv_credentials';

const loginElements = [
    document.getElementById('iptv-url'),
    document.getElementById('iptv-user'),
    document.getElementById('iptv-pass'),
    document.getElementById('login-submit-btn')
];

function showView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`${name}-view`).classList.add('active');
    currentView = name;
}

// Initialisation affichage login
function updateLoginFocus() {
    loginElements.forEach((el, idx) => {
        if (idx === loginFocusIndex) {
            el.classList.add('focused');
            if (el.tagName === 'INPUT') el.focus();
        } else {
            el.classList.remove('focused');
            if (el.tagName === 'INPUT') el.blur();
        }
    });
}

let appToastTimer = null;
function flashAppToast(msg) {
    const el = document.getElementById('app-toast');
    el.innerText = msg;
    el.style.display = 'block';
    clearTimeout(appToastTimer);
    appToastTimer = setTimeout(() => { el.style.display = 'none'; }, 2500);
}

// ---------------------------------------------------------------
// Theme clair / sombre (bouton "Thème" du menu du bas)
// ---------------------------------------------------------------
const THEME_KEY = 'iptv_theme';

function applyStoredTheme() {
    let theme = 'dark';
    try { theme = localStorage.getItem(THEME_KEY) || 'dark'; } catch (e) {}
    document.body.classList.toggle('theme-light', theme === 'light');
}

function toggleAppTheme() {
    const isLight = document.body.classList.toggle('theme-light');
    try { localStorage.setItem(THEME_KEY, isLight ? 'light' : 'dark'); } catch (e) {}
    flashAppToast(isLight ? 'Thème clair activé' : 'Thème sombre activé');
}

applyStoredTheme();

// ---------------------------------------------------------------
// Home Dashboard
// ---------------------------------------------------------------
const HOME_BUTTONS = ['favorites', 'live', 'movies', 'series', 'replay'];
const HEADER_BUTTONS = ['user', 'refresh', 'settings'];
let homeIndex = 2; // 'Films' pre-selectionne par defaut a l'ouverture de l'app
let homeZone = 'menu'; // 'menu' | 'header'
let headerIndex = 0;

function updateHomeFocus() {
    document.querySelectorAll('.home-btn').forEach((el, idx) => el.classList.toggle('focused', homeZone === 'menu' && idx === homeIndex));
    document.querySelectorAll('.home-icon').forEach((el, idx) => el.classList.toggle('focused', homeZone === 'header' && idx === headerIndex));
}

function formatExpiry(expUnixSeconds) {
    if (!expUnixSeconds) return 'Expiration : illimitée';
    const expMs = parseInt(expUnixSeconds, 10) * 1000;
    const days = Math.ceil((expMs - Date.now()) / 86400000);
    const dateStr = new Date(expMs).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    if (days < 0) return `Expiration : ${dateStr} (expiré)`;
    return `Expiration : ${dateStr} (${days} jour${days > 1 ? 's' : ''})`;
}

// Adresse MAC reelle via l'API Tizen (callback-only). "NETWORKS" n'est pas
// une propriete SystemInfo valide : il faut interroger WIFI_NETWORK puis, a
// defaut, ETHERNET_NETWORK. En dehors d'un vrai device Tizen (mode dev,
// navigateur), l'API est absente ou renvoie une adresse vide : on affiche
// alors une MAC factice plutot que "Indisponible".
const FAKE_MAC = '4C:57:39:E5:AB:38';

function fetchDeviceMAC(callback) {
    if (typeof tizen === 'undefined' || !tizen.systeminfo) {
        callback(FAKE_MAC);
        return;
    }

    function tryProperty(propId, onFail) {
        try {
            tizen.systeminfo.getPropertyValue(propId, function (prop) {
                if (prop && prop.macAddress && prop.macAddress !== '00:00:00:00:00:00') {
                    callback(prop.macAddress);
                } else {
                    onFail();
                }
            }, onFail);
        } catch (e) {
            onFail();
        }
    }

    tryProperty('WIFI_NETWORK', function () {
        tryProperty('ETHERNET_NETWORK', function () {
            callback(FAKE_MAC);
        });
    });
}

// Adresse MAC recuperee une fois et mise en cache (affichee dans la modale Parametres)
let cachedDeviceMac = null;

function enterHome() {
    showView('home');
    homeZone = 'menu';
    // homeIndex n'est volontairement pas reinitialise ici : on revient sur
    // le dernier menu selectionne (Films/Series/...), pas systematiquement
    // sur "En Direct".
    headerIndex = 0;
    updateHomeFocus();
    fetchDeviceMAC(mac => { cachedDeviceMac = mac; });
    if (window.lucide) lucide.createIcons();
}

function activateHomeSelection() {
    if (homeZone === 'menu') {
        openBrowseSection(HOME_BUTTONS[homeIndex]);
    } else {
        const action = HEADER_BUTTONS[headerIndex];
        if (action === 'settings') openSettingsModal();
        else if (action === 'user') openAccountModal();
        else if (action === 'refresh') refreshPlaylistData();
    }
}

// Vide les caches locaux pour forcer un rechargement des categories/contenus
// depuis le serveur au prochain acces (sans quitter l'ecran d'accueil).
function refreshPlaylistData() {
    Object.keys(categoriesCache).forEach(k => delete categoriesCache[k]);
    Object.keys(itemsCache).forEach(k => delete itemsCache[k]);
    Object.keys(vodInfoCache).forEach(k => delete vodInfoCache[k]);
    Object.keys(seriesInfoCache).forEach(k => delete seriesInfoCache[k]);
    Object.keys(epgCache).forEach(k => delete epgCache[k]);
    try { localStorage.removeItem(getPersistentCacheKey()); } catch (e) {}
    flashAppToast('Playlist resynchronisée');
}

// ---------------------------------------------------------------
// Modale Compte / Abonnement
// ---------------------------------------------------------------
let accountModalOpen = false;

function openAccountModal() {
    accountModalOpen = true;
    const info = window.iptvUserInfo || {};
    document.getElementById('account-username').innerText = info.username || '—';
    document.getElementById('account-status').innerText = info.status || '—';
    document.getElementById('account-expiry-detail').innerText = formatExpiry(info.exp_date).replace('Expiration : ', '');
    document.getElementById('account-max-connections').innerText = info.max_connections || '—';
    document.getElementById('account-modal').classList.add('visible');
}

function closeAccountModal() {
    accountModalOpen = false;
    document.getElementById('account-modal').classList.remove('visible');
}

function handleAccountModalKey(keyCode) {
    if (keyCode === 13 || keyCode === 10009 || keyCode === 8) {
        closeAccountModal();
    }
}

// ---------------------------------------------------------------
// Modale Parametres
// ---------------------------------------------------------------
let settingsModalOpen = false;
let settingsFocusIndex = 0;

function openSettingsModal() {
    settingsModalOpen = true;
    settingsFocusIndex = 0;
    document.getElementById('settings-server-url').innerText = window.iptvServerConfig ? window.iptvServerConfig.serverUrl : '';
    document.getElementById('settings-mac').innerText = cachedDeviceMac || '…';
    if (!cachedDeviceMac) {
        fetchDeviceMAC(mac => {
            cachedDeviceMac = mac;
            if (settingsModalOpen) document.getElementById('settings-mac').innerText = mac;
        });
    }
    updateSettingsMemoryDisplay();
    clearInterval(settingsMemoryTimer);
    settingsMemoryTimer = setInterval(updateSettingsMemoryDisplay, 2000);
    updateSettingsPerfButtonLabel();
    updateSettingsModalFocus();
    document.getElementById('settings-modal').classList.add('visible');
}

// Repart de l'ecran de connexion avec les identifiants actuels pre-remplis,
// sans effacer la session sauvegardee (contrairement a logout()).
function editServer() {
    closeSettingsModal();
    const cfg = window.iptvServerConfig || {};
    document.getElementById('iptv-url').value = cfg.serverUrl || '';
    document.getElementById('iptv-user').value = cfg.username || '';
    document.getElementById('iptv-pass').value = cfg.password || '';
    loginFocusIndex = 0;
    showView('login');
    updateLoginFocus();
}

function closeSettingsModal() {
    settingsModalOpen = false;
    clearInterval(settingsMemoryTimer);
    document.getElementById('settings-modal').classList.remove('visible');
}

// Tas JS de l'app (performance.memory est une API non-standard, presente
// sur les moteurs Chromium — celui de Tizen inclus la plupart du temps) :
// permet de distinguer ce que CETTE app consomme reellement du reste du
// systeme Tizen (Smart Hub, autres apps, services DRM...), qui peut a lui
// seul occuper une bonne partie de la RAM totale de la TV sans rapport
// avec cette application.
let settingsMemoryTimer = null;
function updateSettingsMemoryDisplay() {
    const el = document.getElementById('settings-memory');
    if (window.performance && performance.memory) {
        const usedMb = (performance.memory.usedJSHeapSize / 1048576).toFixed(1);
        const limitMb = (performance.memory.jsHeapSizeLimit / 1048576).toFixed(0);
        el.innerText = `${usedMb} Mo / ${limitMb} Mo max`;
    } else {
        el.innerText = 'Non disponible sur cet appareil';
    }
}

// ---------------------------------------------------------------
// HUD de performances (RAM/FPS/CPU), superpose en permanence a l'app tant
// qu'il est active — navigation et lecture comprises — pour observer le
// comportement de la TV. Le GPU n'a volontairement pas de valeur : aucune
// API web ou Tizen n'expose son utilisation, contrairement au CPU/a la
// memoire (cf. tizen.systeminfo). Prefere localStorage a une variable en
// memoire pour rester actif d'une session a l'autre, comme demande.
// ---------------------------------------------------------------
const PERF_HUD_KEY = 'iptv_perf_hud';
let perfHudEnabled = false;
let perfHudRafId = null;
let perfHudFrameCount = 0;
let perfHudLastTick = 0;
let perfHudCpuListenerId = null;

function togglePerfHud() {
    setPerfHudEnabled(!perfHudEnabled);
}

function setPerfHudEnabled(enabled) {
    perfHudEnabled = enabled;
    try { localStorage.setItem(PERF_HUD_KEY, enabled ? '1' : '0'); } catch (e) {}
    document.getElementById('perf-hud').classList.toggle('visible', enabled);
    updateSettingsPerfButtonLabel();
    if (enabled) startPerfHudLoop(); else stopPerfHudLoop();
}

function updateSettingsPerfButtonLabel() {
    const el = document.getElementById('settings-perf-state');
    if (el) el.innerText = perfHudEnabled ? 'Activées' : 'Désactivées';
}

function startPerfHudLoop() {
    perfHudFrameCount = 0;
    perfHudLastTick = performance.now();
    updatePerfHudMemory();
    function tick(now) {
        perfHudFrameCount++;
        if (now - perfHudLastTick >= 1000) {
            const fps = Math.round((perfHudFrameCount * 1000) / (now - perfHudLastTick));
            document.getElementById('perf-fps').innerText = fps;
            perfHudFrameCount = 0;
            perfHudLastTick = now;
            updatePerfHudMemory();
        }
        if (perfHudEnabled) perfHudRafId = requestAnimationFrame(tick);
    }
    perfHudRafId = requestAnimationFrame(tick);

    const cpuEl = document.getElementById('perf-cpu');
    if (typeof tizen !== 'undefined' && tizen.systeminfo) {
        try {
            tizen.systeminfo.getPropertyValue('CPU', function (cpu) {
                cpuEl.innerText = Math.round(cpu.load * 100) + ' %';
            }, function () { cpuEl.innerText = 'indisponible'; });
            perfHudCpuListenerId = tizen.systeminfo.addPropertyValueChangeListener('CPU', function (cpu) {
                cpuEl.innerText = Math.round(cpu.load * 100) + ' %';
            });
        } catch (e) {
            cpuEl.innerText = 'indisponible';
        }
    } else {
        cpuEl.innerText = 'indisponible';
    }
}

function stopPerfHudLoop() {
    if (perfHudRafId) cancelAnimationFrame(perfHudRafId);
    perfHudRafId = null;
    if (typeof tizen !== 'undefined' && tizen.systeminfo && perfHudCpuListenerId != null) {
        try { tizen.systeminfo.removePropertyValueChangeListener(perfHudCpuListenerId); } catch (e) {}
        perfHudCpuListenerId = null;
    }
}

function updatePerfHudMemory() {
    const el = document.getElementById('perf-mem');
    if (window.performance && performance.memory) {
        el.innerText = (performance.memory.usedJSHeapSize / 1048576).toFixed(1) + ' Mo';
    } else {
        el.innerText = 'indisponible';
    }
}

// Restaure la preference au demarrage, avant meme la connexion, pour que
// le HUD reste visible "en permanence" comme demande (y compris sur l'ecran
// de login) si l'utilisateur l'a active lors d'une session precedente.
(function initPerfHud() {
    let saved = false;
    try { saved = localStorage.getItem(PERF_HUD_KEY) === '1'; } catch (e) {}
    if (saved) setPerfHudEnabled(true);
})();

// ---------------------------------------------------------------
// Journal de debug a l'ecran (chantier chargement Direct)
// ---------------------------------------------------------------
// Chantier en cours : les chaines en bas de certaines categories Direct
// echouent parfois au chargement quand on parcourt rapidement la sidebar.
// Ce panneau affiche en direct, sur la TV elle-meme, le detail des requetes
// de categories/EPG (debut, succes, erreur, annulation, duree) — impossible
// a observer autrement sans brancher un PC/cable sur la TV.
const DEBUG_LOG_KEY = 'iptv_debug_log';
let debugLogEnabled = false;
const debugLogEntries = [];
const DEBUG_LOG_MAX_ENTRIES = 150;

function toggleDebugLog() {
    setDebugLogEnabled(!debugLogEnabled);
}

function setDebugLogEnabled(enabled) {
    debugLogEnabled = enabled;
    try { localStorage.setItem(DEBUG_LOG_KEY, enabled ? '1' : '0'); } catch (e) {}
    document.getElementById('debug-log-panel').classList.toggle('visible', enabled);
    const el = document.getElementById('settings-debug-state');
    if (el) el.innerText = enabled ? 'Activé' : 'Désactivé';
    if (enabled) debugLog('Journal de debug activé', 'ok');
}

// level : 'info' | 'ok' | 'warn' | 'error'
function debugLog(message, level) {
    const time = new Date().toLocaleTimeString('fr-FR', { hour12: false });
    debugLogEntries.push({ time, message, level: level || 'info' });
    if (debugLogEntries.length > DEBUG_LOG_MAX_ENTRIES) debugLogEntries.shift();
    if (!debugLogEnabled) return;
    const panel = document.getElementById('debug-log-panel');
    const line = document.createElement('div');
    line.className = `debug-log-line ${level || ''}`;
    line.innerText = `[${time}] ${message}`;
    panel.appendChild(line);
    while (panel.children.length > DEBUG_LOG_MAX_ENTRIES) panel.removeChild(panel.firstChild);
    panel.scrollTop = panel.scrollHeight;
}

(function initDebugLog() {
    let saved = false;
    try { saved = localStorage.getItem(DEBUG_LOG_KEY) === '1'; } catch (e) {}
    if (saved) setDebugLogEnabled(true);
})();

function updateSettingsModalFocus() {
    document.querySelectorAll('#settings-modal .modal-btn').forEach((b, idx) => b.classList.toggle('focused', idx === settingsFocusIndex));
}

// ---------------------------------------------------------------
// Modale de reprise : proposee avant de lancer un contenu deja entame
// (cf. playItemWithResume). Se ferme automatiquement sur "Recommencer" au
// bout de 30s sans reponse, plutot que de reprendre silencieusement.
// ---------------------------------------------------------------
let resumeDialogOpen = false;
let resumeDialogFocusIndex = 0; // 0 = Reprendre, 1 = Recommencer
let resumeDialogCountdownTimer = null;
let resumeDialogPending = null; // { item, categoryLabel, section, resumeAt }
const RESUME_DIALOG_TIMEOUT_S = 30;

function openResumeDialog(item, categoryLabel, section, resumeAt) {
    resumeDialogPending = { item, categoryLabel, section, resumeAt };
    resumeDialogOpen = true;
    resumeDialogFocusIndex = 0;
    document.getElementById('resume-dialog-title').innerText = item.name;
    document.getElementById('resume-dialog-time').innerText = formatTime(resumeAt);
    updateResumeDialogFocus();
    document.getElementById('resume-dialog').classList.add('visible');
    startResumeDialogCountdown();
}

function updateResumeDialogFocus() {
    document.getElementById('resume-dialog-continue').classList.toggle('focused', resumeDialogFocusIndex === 0);
    document.getElementById('resume-dialog-restart').classList.toggle('focused', resumeDialogFocusIndex === 1);
}

function startResumeDialogCountdown() {
    let remaining = RESUME_DIALOG_TIMEOUT_S;
    const el = document.getElementById('resume-dialog-countdown');
    const render = () => { el.innerText = `Reprend depuis le début dans ${remaining}s sans réponse...`; };
    render();
    clearInterval(resumeDialogCountdownTimer);
    resumeDialogCountdownTimer = setInterval(function () {
        remaining--;
        if (remaining <= 0) {
            clearInterval(resumeDialogCountdownTimer);
            confirmResumeDialog('restart');
            return;
        }
        render();
    }, 1000);
}

function closeResumeDialog() {
    resumeDialogOpen = false;
    clearInterval(resumeDialogCountdownTimer);
    resumeDialogCountdownTimer = null;
    document.getElementById('resume-dialog').classList.remove('visible');
}

function confirmResumeDialog(choice) {
    const pending = resumeDialogPending;
    resumeDialogPending = null;
    closeResumeDialog();
    if (!pending) return;
    currentPlayItem = pending.item;
    currentPlaySection = pending.section;
    const resumeAt = choice === 'continue' ? pending.resumeAt : 0;
    playStream(pending.item.url, pending.item.name, pending.categoryLabel, pending.item.logo, resumeAt);
}

function handleResumeDialogKey(keyCode) {
    if (keyCode === 37 || keyCode === 39 || keyCode === 38 || keyCode === 40) {
        resumeDialogFocusIndex = resumeDialogFocusIndex === 0 ? 1 : 0;
        updateResumeDialogFocus();
    } else if (keyCode === 13) {
        confirmResumeDialog(resumeDialogFocusIndex === 0 ? 'continue' : 'restart');
    } else if (keyCode === 10009 || keyCode === 8) {
        // Retour : annule completement, ne lance pas la lecture.
        resumeDialogPending = null;
        closeResumeDialog();
    }
}

function handleSettingsModalKey(keyCode) {
    const btns = document.querySelectorAll('#settings-modal .modal-btn');
    if (keyCode === 38 || keyCode === 37) {
        settingsFocusIndex = Math.max(0, settingsFocusIndex - 1);
        updateSettingsModalFocus();
    } else if (keyCode === 40 || keyCode === 39) {
        settingsFocusIndex = Math.min(btns.length - 1, settingsFocusIndex + 1);
        updateSettingsModalFocus();
    } else if (keyCode === 13) {
        const action = btns[settingsFocusIndex].getAttribute('data-action');
        if (action === 'logout') logout();
        else if (action === 'server') editServer();
        else if (action === 'theme') toggleAppTheme(); // reste ouvert, pratique pour comparer
        else if (action === 'perf') togglePerfHud(); // reste ouvert, pratique pour voir l'etat change
        else if (action === 'debug') toggleDebugLog(); // reste ouvert, meme logique
        else closeSettingsModal();
    } else if (keyCode === 10009 || keyCode === 8) {
        closeSettingsModal();
    }
}

// ---------------------------------------------------------------
// Config Xtream Codes + caches
// ---------------------------------------------------------------
const sectionConfig = {
    live: { catAction: 'get_live_categories', streamAction: 'get_live_streams', urlPart: 'live', defaultExt: 'ts' },
    movies: { catAction: 'get_vod_categories', streamAction: 'get_vod_streams', urlPart: 'movie', defaultExt: 'mp4' },
    series: { catAction: 'get_series_categories', streamAction: 'get_series', urlPart: 'series', defaultExt: 'mp4' }
};
const SECTION_LABELS = { live: 'En Direct', movies: 'Films', series: 'Séries', replay: 'Rediffusion', favorites: 'Favoris' };

const categoriesCache = {};
const itemsCache = {};
const vodInfoCache = {};
const seriesInfoCache = {};

// Garde-fou memoire : ces caches ne sont jamais vides tant qu'on ne
// rafraichit pas manuellement (bouton ⟳ de l'accueil), et peuvent grossir
// sans limite sur une longue session — chaque categorie/film/serie visite,
// chaque "Tout afficher" (potentiellement des milliers d'entrees), reste en
// memoire indefiniment sinon. cacheSet plafonne chaque cache en supprimant
// l'entree la plus ancienne au-dela du maximum (ordre d'insertion des cles
// d'un objet, garanti par la specification JS pour des cles non-numeriques).
function cacheSet(cache, key, value, maxEntries) {
    if (!(key in cache) && Object.keys(cache).length >= maxEntries) {
        delete cache[Object.keys(cache)[0]];
    }
    cache[key] = value;
}

// ---------------------------------------------------------------
// Persistance des catalogues deja connus (categories, contenus de
// categorie, saisons/episodes de series) dans localStorage : evite de tout
// re-telecharger a chaque lancement de l'app pour des donnees qui changent
// rarement d'un jour a l'autre. Scope par serveur+compte (cle dediee) pour
// ne jamais melanger les catalogues de deux comptes differents.
// ---------------------------------------------------------------
const PERSISTENT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h : au-dela, on prefere re-demander au panel
let persistCachesTimer = null;

function getPersistentCacheKey() {
    const cfg = window.iptvServerConfig || {};
    return `iptv_cache_${cfg.serverUrl || ''}_${cfg.username || ''}`;
}

function loadPersistentCaches() {
    let stored;
    try { stored = JSON.parse(localStorage.getItem(getPersistentCacheKey())); } catch (e) { stored = null; }
    if (!stored || !stored.savedAt || (Date.now() - stored.savedAt) > PERSISTENT_CACHE_TTL_MS) return;
    if (stored.categoriesCache) Object.assign(categoriesCache, stored.categoriesCache);
    if (stored.itemsCache) Object.assign(itemsCache, stored.itemsCache);
    if (stored.seriesInfoCache) Object.assign(seriesInfoCache, stored.seriesInfoCache);
}

// Regroupe les ecritures rapprochees (plusieurs categories/series consultees
// a la suite) en une seule sauvegarde, pour ne pas re-serialiser tout le
// cache a chaque contenu charge.
function schedulePersistCaches() {
    clearTimeout(persistCachesTimer);
    persistCachesTimer = setTimeout(persistCachesNow, 2000);
}

function persistCachesNow() {
    try {
        // Les catalogues "__all__" ("Tout afficher") peuvent representer des
        // milliers d'entrees a eux seuls : exclus pour rester sous la limite
        // de stockage du navigateur (localStorage, quelques Mo maximum).
        const itemsToPersist = {};
        Object.keys(itemsCache).forEach(k => { if (!k.endsWith('__all')) itemsToPersist[k] = itemsCache[k]; });
        localStorage.setItem(getPersistentCacheKey(), JSON.stringify({
            savedAt: Date.now(),
            categoriesCache,
            itemsCache: itemsToPersist,
            seriesInfoCache
        }));
    } catch (e) {
        console.error('Erreur sauvegarde cache persistant (quota localStorage ?):', e);
    }
}

// Résout l'extension du flux VOD/série. Beaucoup de panels Xtream ne
// renvoient pas un conteneur lisible nativement par <video> (mkv/avi) ;
// quand le compte autorise la sortie HLS, on la préfère (remux serveur).
// Conteneurs que <video>/hls.js savent lire directement, sans transcodage.
const WEB_SAFE_EXTENSIONS = ['mp4', 'm3u8', 'ts', 'webm', 'm4v'];

function resolveExtension(raw, cfg) {
    if (cfg.urlPart === 'live') {
        // La route .m3u8 de ce type de panel répond 405 (non implémentée) ;
        // le flux TS brut direct est le format que Tizen sait lire nativement.
        return cfg.defaultExt;
    }
    const rawExt = (raw.container_extension || raw.target_container || '').toString().replace(/^\./, '').trim().toLowerCase();
    // Le fichier natif (souvent mp4) est servi tel quel par le panel : rapide.
    // On ne force .m3u8 QUE pour les conteneurs non lisibles nativement
    // (mkv/avi/...), sinon chaque lecture declenche un remux serveur en
    // temps reel — c'est ce qui causait l'enorme lag au demarrage des films.
    // Le contenu multi-audio ("MULTI" dans le titre) reste lui aussi en
    // conteneur natif : ses pistes audio/sous-titres sont recuperees via
    // l'API native Samsung AVPlay (cf. playStream/startAvplayPlayback), qui
    // sait les lire directement sans passer par un manifeste HLS (ce panel
    // ne supportant pas le remux .m3u8 pour la VOD/series).
    if (rawExt && WEB_SAFE_EXTENSIONS.includes(rawExt)) return rawExt;
    const allowed = (window.iptvServerConfig && window.iptvServerConfig.allowedFormats) || [];
    if (allowed.includes('m3u8')) return 'm3u8';
    return rawExt || cfg.defaultExt;
}

// Normalise les objets bruts de l'API Xtream en un format d'affichage unique
function normalizeList(rawList, kind, sectionKey) {
    return rawList.map(raw => {
        if (kind === 'series') {
            // get_series renvoie deja plot/genre/rating/cast/director, pas besoin d'appel supplementaire
            return {
                kind: 'series', id: raw.series_id, name: raw.name, logo: raw.cover,
                plot: raw.plot, genre: raw.genre, releaseDate: raw.releaseDate,
                rating: raw.rating, rating5: raw.rating_5based, episodeRunTime: raw.episode_run_time,
                cast: raw.cast, director: raw.director, added: raw.last_modified
            };
        }
        // 'stream' : chaine live ou film
        const { serverUrl, username, password } = window.iptvServerConfig;
        const cfg = sectionConfig[sectionKey];
        const ext = resolveExtension(raw, cfg);
        const url = `${serverUrl}/${cfg.urlPart}/${username}/${password}/${raw.stream_id}.${ext}`;
        return {
            kind: 'stream', id: raw.stream_id, name: raw.name, logo: raw.stream_icon, url, rating: raw.rating, rating5: raw.rating_5based, added: raw.added,
            // Rediffusion (catchup) : seules les chaines live avec tv_archive actif proposent un historique
            archive: raw.tv_archive == 1, archiveDuration: parseInt(raw.tv_archive_duration, 10) || 0
        };
    });
}

// De nombreux panels IPTV bon marche repondent lentement/de façon flaky par
// moments (timeout, connexion coupee) sans que ce soit une vraie panne :
// avant d'abandonner et d'afficher une erreur, on retente quelques fois
// avec un delai croissant — evite l'aller-retour manuel de l'utilisateur
// pour qu'une categorie finisse par charger.
async function fetchJson(url, retries, signal) {
    for (let attempt = 0; ; attempt++) {
        try {
            const res = await fetch(url, signal ? { signal } : undefined);
            return await res.json();
        } catch (e) {
            // Une annulation volontaire (categorie quittee avant la fin de la
            // requete, cf. selectCategory) n'est pas une panne reseau : on ne
            // la retente pas, on la laisse simplement remonter telle quelle.
            if (e.name === 'AbortError') throw e;
            if (attempt >= retries) throw e;
            debugLog(`Nouvelle tentative (${attempt + 1}/${retries}) : ${url.split('&action=')[1] || url}`, 'warn');
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        }
    }
}

// Recupere (et met en cache) les items d'une categorie, deja normalises.
// signal : permet d'annuler la requete si l'utilisateur quitte deja cette
// categorie (cf. selectCategory) avant la reponse du serveur — sans ça, une
// rafale de survols rapides dans la sidebar empile des requetes completes
// concurrentes qui finissent par saturer/faire timeout le panel, et c'est
// alors la DERNIERE categorie sur laquelle l'utilisateur s'arrete qui
// "prend l'erreur", meme si elle n'y est pour rien.
async function fetchCategoryItems(sectionKey, catId, signal) {
    const cacheKey = `${sectionKey}_${catId}`;
    const kind = sectionKey === 'series' ? 'series' : 'stream';
    if (itemsCache[cacheKey]) return normalizeList(itemsCache[cacheKey], kind, sectionKey);

    const { serverUrl, username, password } = window.iptvServerConfig;
    const action = sectionConfig[sectionKey].streamAction;
    const url = `${serverUrl}/player_api.php?username=${username}&password=${password}&action=${action}&category_id=${catId}`;
    const startedAt = performance.now();
    debugLog(`→ Requête catégorie id=${catId} (${sectionKey})`);
    try {
        // 3 nouvelles tentatives (1s/2s/3s de delai) au lieu de 2 : observe en
        // conditions reelles un echec par reponse JSON tronquee ("Unexpected
        // end of JSON input", cf. journal de debug) qui se resolvait tout
        // seul quelques instants plus tard — la fenetre precedente (~3s au
        // total) etait trop courte pour laisser passer ce type de creux
        // reseau/serveur transitoire.
        const items = await fetchJson(url, 3, signal);
        const ms = Math.round(performance.now() - startedAt);
        if (!Array.isArray(items)) {
            // Le panel repond parfois par un objet d'erreur (session expiree,
            // trop de requetes recentes...) plutot qu'une liste : sans ce
            // controle, ça finissait silencieusement en "Aucun contenu."
            console.error('Reponse inattendue (categorie):', items);
            debugLog(`✗ Réponse inattendue id=${catId} après ${ms}ms : ${JSON.stringify(items).slice(0, 120)}`, 'error');
            flashAppToast('Réponse inattendue du serveur pour cette catégorie');
            return [];
        }
        debugLog(`✓ Catégorie id=${catId} chargée en ${ms}ms (${items.length} items)`, 'ok');
        cacheSet(itemsCache, cacheKey, items, 30);
        schedulePersistCaches();
        return normalizeList(items, kind, sectionKey);
    } catch (e) {
        const ms = Math.round(performance.now() - startedAt);
        if (e.name === 'AbortError') {
            debugLog(`⨯ Catégorie id=${catId} annulée après ${ms}ms (catégorie quittée entre-temps)`, 'warn');
            return null; // abandon volontaire : distinct d'une vraie erreur ([])
        }
        console.error('Erreur chargement contenu:', e);
        debugLog(`✗ Échec catégorie id=${catId} après ${ms}ms : ${e.message}`, 'error');
        flashAppToast('Erreur réseau lors du chargement de la catégorie');
        return [];
    }
}

// Recupere l'integralite du catalogue d'une section (sans filtrer par
// category_id). Sert d'echappatoire quand un contenu semble absent d'une
// categorie precise (mal categorise cote panel) et de base a "Tout afficher".
async function fetchAllItems(sectionKey) {
    const cacheKey = `${sectionKey}__all`;
    const kind = sectionKey === 'series' ? 'series' : 'stream';
    if (itemsCache[cacheKey]) return normalizeList(itemsCache[cacheKey], kind, sectionKey);

    const { serverUrl, username, password } = window.iptvServerConfig;
    const action = sectionConfig[sectionKey].streamAction;
    const url = `${serverUrl}/player_api.php?username=${username}&password=${password}&action=${action}`;
    try {
        const items = await fetchJson(url, 3); // cf. fetchCategoryItems : reponses JSON tronquees observees en conditions reelles
        if (!Array.isArray(items)) {
            console.error('Reponse inattendue (catalogue complet):', items);
            flashAppToast('Réponse inattendue du serveur pour ce catalogue');
            return [];
        }
        // "Tout afficher" peut representer des milliers d'entrees : cap plus
        // bas (5) puisque chacune de ces entrees est deja tres volumineuse a
        // elle seule (catalogue complet d'une section).
        cacheSet(itemsCache, cacheKey, items, 5);
        return normalizeList(items, kind, sectionKey);
    } catch (e) {
        console.error('Erreur chargement complet:', e);
        flashAppToast('Erreur réseau lors du chargement du catalogue');
        return [];
    }
}

// Rediffusion (catchup) : recupere l'EPG passe d'une chaine et construit les
// flux timeshift correspondants, dans la limite du nombre de jours
// d'archivage autorise par l'abonnement (tv_archive_duration).
async function fetchReplayPrograms(channel) {
    const { serverUrl, username, password } = window.iptvServerConfig;
    const url = `${serverUrl}/player_api.php?username=${username}&password=${password}&action=get_simple_data_table&stream_id=${channel.id}`;
    let listings = [];
    try {
        const res = await fetch(url);
        const data = await res.json();
        listings = data.epg_listings || [];
    } catch (e) {
        console.error('Erreur EPG rediffusion:', e);
        return [];
    }

    const now = Date.now();
    const maxAgeMs = (channel.archiveDuration || 1) * 24 * 60 * 60 * 1000;

    return listings
        .map(ep => ({ ep, startTs: parseInt(ep.start_timestamp, 10) * 1000, stopTs: parseInt(ep.stop_timestamp, 10) * 1000 }))
        // Seuls les programmes deja termines et encore dans la fenetre d'archivage sont rejouables.
        .filter(({ startTs, stopTs }) => stopTs && stopTs < now && (now - startTs) <= maxAgeMs)
        .sort((a, b) => b.startTs - a.startTs)
        .slice(0, 60)
        .map(({ ep, startTs, stopTs }) => {
            const durationMin = Math.max(1, Math.round((stopTs - startTs) / 60000));
            const dateLabel = new Date(startTs).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            return {
                kind: 'stream',
                name: decodeEpgText(ep.title) || channel.name,
                plot: decodeEpgText(ep.description),
                logo: channel.logo,
                badge: dateLabel,
                url: buildTimeshiftUrl(channel.id, ep.start, durationMin)
            };
        })
        .filter(item => item.url);
}

// Les champs title/description de l'EPG Xtream sont encodes en base64 (UTF-8).
function decodeEpgText(b64) {
    if (!b64) return '';
    try {
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        return new TextDecoder('utf-8').decode(bytes);
    } catch (e) {
        return '';
    }
}

// Construit l'URL de rediffusion. "start" est deja fourni par le panel au
// format local du serveur ("YYYY-MM-DD HH:MM:SS") : on le reformate tel
// quel, sans reinterpreter de fuseau horaire, pour eviter tout decalage.
function buildTimeshiftUrl(streamId, startStr, durationMinutes) {
    const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})/.exec(startStr || '');
    if (!m) return '';
    const { serverUrl, username, password } = window.iptvServerConfig;
    return `${serverUrl}/timeshift/${username}/${password}/${durationMinutes}/${m[1]}:${m[2]}-${m[3]}/${streamId}.ts`;
}

// Recupere (et met en cache) le detail complet d'une serie : saisons + episodes
async function loadSeriesInfo(seriesId) {
    if (seriesInfoCache[seriesId]) return seriesInfoCache[seriesId];
    const { serverUrl, username, password } = window.iptvServerConfig;
    const url = `${serverUrl}/player_api.php?username=${username}&password=${password}&action=get_series_info&series_id=${seriesId}`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        cacheSet(seriesInfoCache, seriesId, data, 100);
        schedulePersistCaches();
        return data;
    } catch (e) {
        console.error('Erreur get_series_info:', e);
        return { episodes: {} };
    }
}

async function loadVodInfo(item) {
    if (vodInfoCache[item.id]) return vodInfoCache[item.id];
    const { serverUrl, username, password } = window.iptvServerConfig;
    const url = `${serverUrl}/player_api.php?username=${username}&password=${password}&action=get_vod_info&vod_id=${item.id}`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        const info = data.info || {};
        cacheSet(vodInfoCache, item.id, info, 300);
        return info;
    } catch (e) {
        console.error('Erreur get_vod_info:', e);
        return null;
    }
}

function escapeHtml(s) {
    return (s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// Mini-guide TV : programme(s) d'une chaine live. Ne recupere l'EPG que
// pour la chaine survolee (comme loadVodInfo pour les films), jamais pour
// tout un rail a la fois — evite le meme risque de gel que "Tout afficher"
// en cas d'appels reseau en masse.
const epgCache = {};
async function loadLiveEpgListings(channel) {
    if (epgCache[channel.id]) return epgCache[channel.id];
    const { serverUrl, username, password } = window.iptvServerConfig;
    const url = `${serverUrl}/player_api.php?username=${username}&password=${password}&action=get_short_epg&stream_id=${channel.id}&limit=8`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        const listings = (data.epg_listings || []).map(ep => ({
            title: decodeEpgText(ep.title),
            start: ep.start,
            end: ep.end,
            startTs: parseInt(ep.start_timestamp, 10) * 1000,
            stopTs: parseInt(ep.stop_timestamp, 10) * 1000
        })).sort((a, b) => a.startTs - b.startTs);
        cacheSet(epgCache, channel.id, listings, 400);
        return listings;
    } catch (e) {
        console.error('Erreur get_short_epg:', e);
        return [];
    }
}

function getCurrentAndNextProgram(listings) {
    const now = Date.now();
    return {
        current: listings.find(p => p.startTs <= now && p.stopTs > now) || null,
        next: listings.find(p => p.startTs > now) || null
    };
}

// Version courte (en cours / a suivre), utilisee dans le panneau synopsis
// partage films/series/favoris (cf. updateSynopsisPanel).
async function loadLiveEpg(channel) {
    const listings = await loadLiveEpgListings(channel);
    return getCurrentAndNextProgram(listings);
}

function formatEpgTimeRange(startStr, endStr) {
    const s = (startStr || '').slice(11, 16);
    const e = (endStr || '').slice(11, 16);
    return s && e ? `${s}–${e}` : '';
}

function renderLiveEpgInfo(epg) {
    if (!epg || (!epg.current && !epg.next)) {
        document.getElementById('synopsis-text').innerText = 'Programme non disponible.';
        return;
    }
    if (epg.current) {
        document.getElementById('synopsis-meta').innerHTML =
            `<span class="meta-imdb">EN COURS</span><span>${formatEpgTimeRange(epg.current.start, epg.current.end)}</span>`;
    }
    const lines = [];
    if (epg.current) lines.push(escapeHtml(epg.current.title));
    if (epg.next) lines.push(`À suivre (${formatEpgTimeRange(epg.next.start, epg.next.end)}) : ${escapeHtml(epg.next.title)}`);
    // synopsis-text est un <p> : pas de <div> imbrique (invalide en HTML), un <br> suffit.
    document.getElementById('synopsis-text').innerHTML = lines.join('<br>');
}

// "Ajoutés récemment" : agrege les items des N premieres categories deja
// listees et trie par date d'ajout. Volontairement plafonne (12
// categories) pour rester leger — pas d'appel API systematique sur tout
// le catalogue.
async function computeRecentlyAdded(sectionKey) {
    const cats = categoriesCache[sectionKey] || [];
    const capped = cats.slice(0, 12);
    let all = [];
    for (const cat of capped) {
        const items = await fetchCategoryItems(sectionKey, cat.category_id);
        all = all.concat(items);
    }
    all.sort((a, b) => (parseInt(b.added, 10) || 0) - (parseInt(a.added, 10) || 0));
    const top = all.slice(0, 40);
    top.forEach(it => { it.badge = 'NEW'; });
    return top;
}

// ---------------------------------------------------------------
// Favoris / Récemment consultés (par section, localStorage)
// ---------------------------------------------------------------
const FAV_KEY_PREFIX = 'iptv_favorites_';
const RECENT_KEY_PREFIX = 'iptv_recent_';

function getFavoritesList(sectionKey) {
    try { return JSON.parse(localStorage.getItem(FAV_KEY_PREFIX + sectionKey)) || []; } catch (e) { return []; }
}

function isFavorite(sectionKey, item) {
    const key = item.url || item.id;
    return getFavoritesList(sectionKey).some(it => (it.url || it.id) === key);
}

function toggleFavorite(sectionKey, item) {
    let list = getFavoritesList(sectionKey);
    const key = item.url || item.id;
    const idx = list.findIndex(it => (it.url || it.id) === key);
    let added;
    if (idx === -1) { list.unshift({ ...item }); added = true; }
    else { list.splice(idx, 1); added = false; }
    try { localStorage.setItem(FAV_KEY_PREFIX + sectionKey, JSON.stringify(list)); } catch (e) {}
    return added;
}

function getRecentList(sectionKey) {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY_PREFIX + sectionKey)) || []; } catch (e) { return []; }
}

function trackRecent(sectionKey, item) {
    if (!item) return;
    const key = RECENT_KEY_PREFIX + sectionKey;
    let list = getRecentList(sectionKey);
    const itemKey = item.url || item.id;
    list = list.filter(it => (it.url || it.id) !== itemKey);
    list.unshift({ ...item });
    list = list.slice(0, 30);
    try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) {}
}

// Retire une entree de l'historique "Recemment consultes". Pour une fiche
// serie regroupee (cf. getGroupedRecentList), retire TOUS les episodes de
// cette serie d'un coup (item._groupKey), pas seulement le representant affiche.
function removeFromRecent(sectionKey, item) {
    if (!item) return;
    const key = RECENT_KEY_PREFIX + sectionKey;
    let list = getRecentList(sectionKey);
    if (item._groupKey) {
        list = list.filter(it => it.seriesId !== item._groupKey);
    } else {
        const itemKey = item.url || item.id;
        list = list.filter(it => (it.url || it.id) !== itemKey);
    }
    try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) {}
}

// Pour les series : regroupe les episodes recemment consultes d'une meme
// serie sous une seule "affiche" (sinon 15 episodes de la meme serie
// vus recemment produisent 15 entrees identiques dans l'historique). La
// liste source est deja triee du plus recent au plus ancien (trackRecent
// insere en tete), donc le premier episode rencontre pour une serie donnee
// est bien le dernier regarde — c'est lui qui represente le groupe.
function getGroupedRecentList(sectionKey) {
    const list = getRecentList(sectionKey);
    if (sectionKey !== 'series') return list;
    const bySeries = new Map();
    const result = [];
    list.forEach(item => {
        if (!item.seriesId) { result.push(item); return; } // securite : entree sans serie rattachee
        if (bySeries.has(item.seriesId)) {
            bySeries.get(item.seriesId)._groupedEpisodes.push(item);
            return;
        }
        const group = {
            kind: 'recentSeriesGroup',
            name: item.seriesName || item.name,
            logo: item.seriesLogo || item.logo,
            seriesId: item.seriesId,
            seriesName: item.seriesName || item.name,
            _groupKey: item.seriesId,
            _groupedEpisodes: [item]
        };
        bySeries.set(item.seriesId, group);
        result.push(group);
    });
    result.forEach(it => { if (it._groupedEpisodes) it.badge = `${it._groupedEpisodes.length} ép.`; });
    return result;
}

// ---------------------------------------------------------------
// Progression de lecture (reprise des films/episodes, par section)
// ---------------------------------------------------------------
const PROGRESS_KEY_PREFIX = 'iptv_progress_';
const PROGRESS_DONE_RATIO = 0.92; // au-dela : considere comme termine, pas de reprise proposee
const PROGRESS_MIN_SECONDS = 15; // en dessous : trop tot pour valoir la peine d'etre memorise

function getProgressMap(sectionKey) {
    try { return JSON.parse(localStorage.getItem(PROGRESS_KEY_PREFIX + sectionKey)) || {}; } catch (e) { return {}; }
}

function saveProgressMap(sectionKey, map) {
    try { localStorage.setItem(PROGRESS_KEY_PREFIX + sectionKey, JSON.stringify(map)); } catch (e) {}
}

function getProgress(sectionKey, item) {
    if (!item || !item.url) return null;
    return getProgressMap(sectionKey)[item.url] || null;
}

function isItemWatched(sectionKey, item) {
    const p = getProgress(sectionKey, item);
    return !!(p && p.done);
}

// Enregistre la position de lecture. Un contenu regarde au-dela de
// PROGRESS_DONE_RATIO est marque termine (repart de 0 la prochaine fois,
// sans proposer de reprise) ; en dessous de PROGRESS_MIN_SECONDS, on
// considere que la lecture vient de commencer et on ne garde rien.
function saveProgress(sectionKey, item, position, duration) {
    if (!item || !item.url || !isFinite(duration) || duration <= 0) return;
    const map = getProgressMap(sectionKey);
    const ratio = position / duration;
    if (ratio >= PROGRESS_DONE_RATIO) {
        map[item.url] = { ...item, position: 0, duration, done: true, updatedAt: Date.now() };
    } else if (position < PROGRESS_MIN_SECONDS) {
        delete map[item.url];
    } else {
        map[item.url] = { ...item, position, duration, done: false, updatedAt: Date.now() };
    }
    saveProgressMap(sectionKey, map);
}

// ---------------------------------------------------------------
// Preference de piste audio/sous-titres par contenu (survit a un
// redemarrage de l'app, contrairement a preferredAudioLabel/
// preferredSubtitleLabel qui ne font que suivre d'un episode a l'autre
// PENDANT la meme session, cf. applyPreferredAudioTrack). Stockage separe
// de la progression (et non fusionne dedans) car un choix de piste doit
// rester memorise meme si la lecture est trop courte pour justifier une
// reprise (< PROGRESS_MIN_SECONDS, ce qui supprime l'entree de progression).
// ---------------------------------------------------------------
const TRACK_PREF_KEY_PREFIX = 'iptv_trackpref_';

function getTrackPrefMap(sectionKey) {
    try { return JSON.parse(localStorage.getItem(TRACK_PREF_KEY_PREFIX + sectionKey)) || {}; } catch (e) { return {}; }
}

function saveTrackPrefMap(sectionKey, map) {
    try { localStorage.setItem(TRACK_PREF_KEY_PREFIX + sectionKey, JSON.stringify(map)); } catch (e) {}
}

function getTrackPref(sectionKey, item) {
    if (!item || !item.url) return null;
    return getTrackPrefMap(sectionKey)[item.url] || null;
}

function saveTrackPref(sectionKey, item, audioLabel, subtitleLabel) {
    if (!sectionKey || !item || !item.url) return;
    const map = getTrackPrefMap(sectionKey);
    map[item.url] = { audioLabel: audioLabel || null, subtitleLabel: (subtitleLabel === undefined ? null : subtitleLabel), updatedAt: Date.now() };
    saveTrackPrefMap(sectionKey, map);
}

function clearProgress(sectionKey, item) {
    if (!item || !item.url) return;
    const map = getProgressMap(sectionKey);
    delete map[item.url];
    saveProgressMap(sectionKey, map);
}

// Contenus entames mais pas termines, les plus recents en premier —
// alimente la categorie systeme "Continuer à regarder".
function getContinueWatchingList(sectionKey) {
    return Object.values(getProgressMap(sectionKey))
        .filter(p => !p.done)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 40);
}

// ---------------------------------------------------------------
// Browse : tiroir de categories + rail de posters + synopsis
// ---------------------------------------------------------------
let browseSectionKey = 'live';
let browseFocusZone = 'sidebar'; // 'sidebar' | 'search' | 'fav' | 'rail'
let browseCategories = []; // liste complete (non filtree) des categories
let visibleCategories = []; // liste affichee/indexee dans la sidebar (filtree par browse-cat-search)
let browseCatIndex = 0; // -1 = barre de recherche de la sidebar selectionnee
let railList = [];
let railBaseList = [];
let railFullList = []; // liste complete non plafonnee, utilisee par la recherche (cf. "Tout afficher")
let railIndex = 0;
let railStack = []; // pile pour le drill-down serie -> saisons -> episodes
let railFavoritable = true; // false pour les listes de saisons/episodes : seule la fiche serie est favorisable
let railIsRecentList = false; // true pour "Recemment consultes" : affiche le bouton de suppression de l'historique
// Aperçu de categorie (simple survol sidebar, cf. focusSidebarCategory) :
// n'affiche/ne construit que les SIDEBAR_PREVIEW_CAP premieres chaines pour
// rester leger tant que l'utilisateur ne fait que regarder — la validation
// (Droite/Entree) complete avec le reste, deja recupere par le meme fetch
// (Xtream ne permet pas de demander un sous-ensemble cote serveur), donc
// sans requete reseau supplementaire.
const SIDEBAR_PREVIEW_CAP = 15;
let railIsPreview = false;
let railPreviewFullList = null;
// Requete de contenu de categorie actuellement en vol (cf. selectCategory) :
// permet de l'annuler si l'utilisateur change de categorie avant sa reponse.
let categoryFetchAbortController = null;
let favSubFocus = 'star'; // 'star' | 'remove' : sous-focus de la zone 'fav' (etoile vs suppression de l'historique)
let synopsisToken = 0;
let searchSubFocus = 'input'; // 'input' | 'clear' : sous-focus de la barre de recherche du contenu

async function openBrowseSection(sectionKey, presetCategoryId) {
    browseSectionKey = sectionKey;
    railStack = [];
    document.getElementById('browse-title').innerText = SECTION_LABELS[sectionKey] || '';
    document.getElementById('browse-cat-search').value = '';
    document.getElementById('browse-search').value = '';
    showView('browse');
    document.getElementById('browse-sidebar').classList.remove('collapsed');
    browseFocusZone = 'sidebar';
    await renderSidebarCategories();
    if (presetCategoryId) {
        const idx = visibleCategories.findIndex(c => c.id === presetCategoryId);
        if (idx !== -1) await selectCategory(idx);
    }
}

async function renderSidebarCategories() {
    const container = document.getElementById('browse-cat-list');
    container.innerHTML = `<div class="rail-loading">Chargement...</div>`;

    // Le bouton "Favoris" de l'accueil regroupe les favoris des 3 sections
    // (Films/Series/En Direct chacun ayant leur propre stockage local) :
    // la sidebar affiche ces 3 types, et selectionner l'un bascule
    // reellement sur la navigation normale de cette section (cf.
    // selectCategory), pre-filtree sur ses favoris.
    if (browseSectionKey === 'favorites') {
        browseCategories = [
            { id: 'movies', name: 'Films', system: true, count: getFavoritesList('movies').length },
            { id: 'series', name: 'Séries', system: true, count: getFavoritesList('series').length },
            { id: 'live', name: 'En Direct', system: true, count: getFavoritesList('live').length }
        ];
        visibleCategories = browseCategories;
        renderCatListDOM();
        await selectCategory(0);
        return;
    }

    // Rediffusion : seules les chaines live avec tv_archive actif proposent
    // un historique. Chaque chaine compatible devient une "categorie" ; la
    // selectionner charge son EPG passe (cf. selectCategory).
    if (browseSectionKey === 'replay') {
        const allLive = await fetchAllItems('live');
        const archiveChannels = allLive.filter(ch => ch.archive);
        browseCategories = archiveChannels.map(ch => ({ id: ch.id, name: ch.name, system: false, count: null, channel: ch }));
        visibleCategories = browseCategories;
        renderCatListDOM();
        if (browseCategories.length) {
            await selectCategory(0);
        } else {
            setRailTitle('');
            document.getElementById('rail-track').innerHTML = `<div class="rail-empty">Aucune chaîne avec rediffusion disponible sur cet abonnement.</div>`;
            clearSynopsisPanel();
        }
        return;
    }

    const systemCats = [];
    if (browseSectionKey === 'movies' || browseSectionKey === 'series') {
        systemCats.push({ id: '__continue__', name: 'Continuer à regarder', system: true, count: getContinueWatchingList(browseSectionKey).length });
    }
    systemCats.push(
        { id: '__recent__', name: 'Récemment consultés', system: true, count: getGroupedRecentList(browseSectionKey).length },
        { id: '__favorites__', name: 'Favoris', system: true, count: getFavoritesList(browseSectionKey).length },
        // Ignore le regroupement par categories du panel : utile si un
        // contenu (ex. une version VO) est mal categorise ou non rattache
        // a une categorie visible, et sert aussi de base a la recherche.
        // Volontairement PAS en premiere position (donc pas charge par
        // defaut) car ça peut representer tout le catalogue de la section.
        { id: '__all__', name: 'Tout afficher', system: true, count: null }
    );
    if (browseSectionKey === 'movies' || browseSectionKey === 'series') {
        systemCats.push({ id: '__recentadded__', name: 'Ajoutés récemment', system: true, count: null });
    }

    let realCats = categoriesCache[browseSectionKey];
    if (!realCats) {
        try {
            const { serverUrl, username, password } = window.iptvServerConfig;
            const action = sectionConfig[browseSectionKey].catAction;
            realCats = await fetchJson(`${serverUrl}/player_api.php?username=${username}&password=${password}&action=${action}`, 2);
            categoriesCache[browseSectionKey] = realCats;
            schedulePersistCaches();
        } catch (e) {
            console.error('Erreur chargement catégories:', e);
            realCats = [];
        }
    }

    browseCategories = systemCats.concat(realCats.map(c => ({ id: c.category_id, name: c.category_name, system: false, count: null })));
    visibleCategories = browseCategories;
    renderCatListDOM();
    await selectCategory(0);
}

function renderCatListDOM() {
    const container = document.getElementById('browse-cat-list');
    container.innerHTML = '';
    let lastWasSystem = false;
    visibleCategories.forEach((cat, idx) => {
        if (lastWasSystem && !cat.system) {
            const sep = document.createElement('div');
            sep.className = 'browse-cat-separator';
            container.appendChild(sep);
        }
        lastWasSystem = cat.system;

        const row = document.createElement('div');
        row.className = `browse-cat-item ${cat.system ? 'system' : ''} ${idx === browseCatIndex ? 'focused' : ''}`;
        const countHtml = (cat.count !== null && cat.count !== undefined) ? `<span class="cat-count">${cat.count}</span>` : '';
        row.innerHTML = `<span class="cat-name">${cat.name}</span>${countHtml}`;
        container.appendChild(row);
    });
}

function updateSidebarFocus() {
    document.getElementById('browse-cat-search').classList.toggle('focused', browseCatIndex === -1);
    document.querySelectorAll('.browse-cat-item').forEach((el, idx) => {
        el.classList.toggle('focused', idx === browseCatIndex);
        if (idx === browseCatIndex) el.scrollIntoView({ block: 'nearest' });
    });
    if (browseCatIndex === -1) document.getElementById('browse-cat-search').scrollIntoView({ block: 'nearest' });
}

function updateSearchZoneFocus() {
    const inSearch = browseFocusZone === 'search';
    document.getElementById('browse-search').classList.toggle('focused', inSearch && searchSubFocus === 'input');
    document.getElementById('search-clear-btn').classList.toggle('focused', inSearch && searchSubFocus === 'clear');
}

// Vide la recherche de contenu independamment du clavier virtuel (backspace
// via la telecommande n'est pas toujours fiable sur le clavier Samsung) et
// relance le filtrage pour reafficher la liste complete de la categorie.
function clearContentSearch() {
    const input = document.getElementById('browse-search');
    if (!input.value) return;
    input.value = '';
    input.dispatchEvent(new Event('input'));
}

// Parcourir la sidebar au Haut/Bas declenchait un chargement COMPLET de
// chaque categorie simplement survolee (pas seulement celle finalement
// choisie) : en descendant vite une liste de plusieurs dizaines de
// chaines de categories, ça enchainait les requetes completes et finissait
// par saturer le panel apres 5-6 categories. On ne charge desormais la
// categorie que si le focus s'y arrete un court instant ; le simple
// deplacement du curseur reste, lui, instantane (updateSidebarFocus).
let sidebarPreviewTimer = null;
function focusSidebarCategory(idx) {
    browseCatIndex = idx;
    updateSidebarFocus();
    clearTimeout(sidebarPreviewTimer);
    sidebarPreviewTimer = setTimeout(() => selectCategory(idx, true), 350);
}

// previewOnly : n'affiche que les SIDEBAR_PREVIEW_CAP premiers items pour un
// simple survol de la sidebar (cf. focusSidebarCategory) ; la liste complete
// est quand meme recuperee (et mise en cache) en une seule requete, prete a
// etre affichee instantanement des que l'utilisateur valide (cf. handleRight).
async function selectCategory(idx, previewOnly) {
    browseCatIndex = idx;
    updateSidebarFocus();
    if (idx < 0) return; // barre de recherche de la sidebar selectionnee : rien de plus a charger
    railStack = [];
    railFavoritable = true; // une liste de categorie (series/films/chaines/favoris...) reste favorisable
    railIsRecentList = false;
    railIsPreview = false;
    railPreviewFullList = null;
    // Un changement de categorie invalide la recherche de contenu en cours :
    // sans ce reset, le mot tape restait affiche (et le filtrage sur
    // l'ancienne liste perdait tout sens) sans moyen simple de l'effacer.
    document.getElementById('browse-search').value = '';
    const cat = visibleCategories[idx];
    if (!cat) return;

    if (browseSectionKey === 'favorites') {
        // cat.id vaut 'movies' | 'series' | 'live' ici : on reste sur CETTE
        // page (sidebar Films/Series/Direct), on ne navigue pas vers la
        // section normale — chaque item est marque avec sa section d'origine
        // (_section) pour que lecture/favori/progression restent corrects
        // une fois qu'on joue ou qu'on entre dans une serie (cf. handleEnter).
        setRailTitle(cat.name);
        const realSection = cat.id;
        const list = getFavoritesList(realSection).map(it => ({ ...it, _section: realSection }));
        showRail(list);
        return;
    }
    if (browseSectionKey === 'replay') {
        setRailTitle(cat.name);
        showRail([]);
        renderRailLoading();
        const programs = await fetchReplayPrograms(cat.channel);
        if (browseCatIndex === idx) showRail(programs);
        return;
    }

    setRailTitle(cat.name);

    if (cat.id === '__continue__') {
        showRail(getContinueWatchingList(browseSectionKey));
    } else if (cat.id === '__recent__') {
        railIsRecentList = true;
        showRail(getGroupedRecentList(browseSectionKey));
    } else if (cat.id === '__favorites__') {
        showRail(getFavoritesList(browseSectionKey));
    } else if (cat.id === '__recentadded__') {
        showRail([]);
        renderRailLoading();
        const list = await computeRecentlyAdded(browseSectionKey);
        if (browseCatIndex === idx) showRail(list);
    } else if (cat.id === '__all__') {
        showRail([]);
        renderRailLoading();
        const fullList = await fetchAllItems(browseSectionKey);
        // Un catalogue complet peut compter des milliers d'entrees : creer
        // autant de tuiles + declencher autant de chargements d'images d'un
        // coup peut geler une TV peu puissante. On plafonne l'AFFICHAGE
        // initial, mais la recherche (voir listener plus bas) filtre bien
        // sur fullList en entier, sinon un contenu au-dela du plafond
        // resterait introuvable meme en tapant son nom exact.
        const ALL_CAP = 300;
        const totalCount = fullList.length;
        const list = totalCount > ALL_CAP ? fullList.slice(0, ALL_CAP) : fullList;
        if (browseCatIndex === idx) {
            setRailTitle(totalCount > ALL_CAP
                ? `${cat.name} (${ALL_CAP} premiers sur ${totalCount} — affinez avec la recherche)`
                : cat.name);
            showRail(list, fullList);
        }
    } else {
        showRail([]);
        renderRailLoading();
        // Une seule requete de contenu de categorie a la fois : si l'utilisateur
        // a deja bouge (nouvel appel a selectCategory) avant que celle-ci
        // n'aboutisse, on l'annule plutot que de laisser le serveur la finir
        // pour rien (cf. fetchCategoryItems).
        if (categoryFetchAbortController) categoryFetchAbortController.abort();
        categoryFetchAbortController = new AbortController();
        const items = await fetchCategoryItems(browseSectionKey, cat.id, categoryFetchAbortController.signal);
        if (items === null) return; // requete annulee entre-temps
        if (browseCatIndex !== idx) return;
        if (previewOnly && items.length > SIDEBAR_PREVIEW_CAP) {
            railIsPreview = true;
            railPreviewFullList = items;
            showRail(items.slice(0, SIDEBAR_PREVIEW_CAP));
        } else {
            showRail(items);
        }
    }
}

function renderRailLoading() {
    // Le Direct affiche #live-channel-list, pas #rail-track (masque en mode
    // live) : sans ecrire dans les deux, le chargement d'une categorie live
    // ne montrait litteralement rien pendant l'attente, donnant l'impression
    // d'un bug des qu'une reponse tardait.
    const msg = `<div class="rail-loading">Chargement...</div>`;
    document.getElementById('rail-track').innerHTML = msg;
    document.getElementById('live-channel-list').innerHTML = msg;
}

// Le Direct a son propre titre de liste (layout dedie, cf. showRail) ; on
// garde les deux en phase plutot que de brancher chaque appelant.
function setRailTitle(text) {
    document.getElementById('rail-title').innerText = text;
    document.getElementById('live-rail-title').innerText = text;
}

// Rend soit le rail d'affiches (films/series/replay/favoris), soit la liste
// de chaines + panneau EPG (Direct), selon la section en cours. Les deux
// jeux de fonctions n'ont aucun effet si leurs elements DOM respectifs
// n'existent pas dans le mode inactif, donc pas de risque a n'appeler que
// le bon jeu ici.
function renderRailOrChannelList(list) {
    if (browseSectionKey === 'live') {
        buildChannelListDOM(list);
        updateChannelListFocus();
        if (list.length) updateLiveEpgPanel(list[0]); else clearLiveEpgPanel();
    } else {
        buildRailDOM(list);
        updateRailFocus();
        if (list.length) updateSynopsisPanel(list[0]); else clearSynopsisPanel();
    }
}

// Meme chose mais pour un simple changement de selection au sein d'une
// liste deja construite (Haut/Bas/Gauche/Droite) : pas de reconstruction du DOM.
function updateRailSelectionUI() {
    if (browseSectionKey === 'live') {
        updateChannelListFocus();
        updateLiveEpgPanel(railList[railIndex]);
    } else {
        updateRailFocus();
        updateSynopsisPanel(railList[railIndex]);
    }
}

function showRail(list, fullList) {
    railBaseList = list;
    railFullList = fullList || list;
    railList = list;
    railIndex = 0;
    document.getElementById('synopsis-fav-btn').style.display = railFavoritable ? '' : 'none';
    document.getElementById('live-epg-fav-btn').style.display = railFavoritable ? '' : 'none';
    document.getElementById('synopsis-remove-btn').style.display = railIsRecentList ? '' : 'none';
    document.getElementById('live-epg-remove-btn').style.display = railIsRecentList ? '' : 'none';
    // favSubFocus n'est PAS reinitialise ici : un appel a showRail() ne
    // signifie pas forcement un changement de zone (ex. removeFocusedFromRecent
    // reconstruit la liste en restant sur 'fav'/'remove'). La reinitialisation
    // se fait uniquement aux points d'entree reels dans la zone 'fav'
    // (cf. handleUp/handleDown/handleRight).
    document.getElementById('browse-main').classList.toggle('live-mode', browseSectionKey === 'live');
    renderRailOrChannelList(railList);
    updateFavButtonFocus(); // resynchronise le DOM avec browseFocusZone/favSubFocus, quels qu'ils soient
}

function buildRailDOM(list) {
    const track = document.getElementById('rail-track');
    track.innerHTML = '';
    if (!list.length) {
        track.innerHTML = `<div class="rail-empty">Aucun contenu.</div>`;
        return;
    }
    list.forEach((item, idx) => {
        const el = document.createElement('div');
        // Vue "Favoris" agregee (item._section) : chaque item porte sa
        // propre section d'origine, sinon on retombe sur la section en cours.
        const sectionKey = item._section || browseSectionKey;
        const fav = isFavorite(sectionKey, item) ? 'is-fav' : '';
        const watched = isItemWatched(sectionKey, item) ? 'is-watched' : '';
        el.className = `rail-poster ${(browseFocusZone === 'rail' && idx === railIndex) ? 'focused' : ''} ${fav} ${watched}`;
        const imgHtml = item.logo ? `<img src="${item.logo}" loading="lazy" decoding="async" onerror="this.remove()">` : `<div class="rail-poster-fallback">${item.name}</div>`;
        const badgeHtml = item.badge ? `<div class="rail-poster-badge">${item.badge}</div>` : '';
        const progress = getProgress(sectionKey, item);
        const progressHtml = (progress && !progress.done && progress.duration)
            ? `<div class="rail-poster-progress"><div class="rail-poster-progress-fill" style="width:${Math.min(100, progress.position / progress.duration * 100).toFixed(1)}%"></div></div>`
            : '';
        el.innerHTML = `${imgHtml}${badgeHtml}<div class="rail-poster-icons"><span class="rail-poster-fav-icon">★</span><span class="rail-poster-watched-icon">✓</span></div>${progressHtml}<div class="rail-poster-title">${item.name}</div>`;
        track.appendChild(el);
    });
}

function updateRailFocus() {
    document.querySelectorAll('.rail-poster').forEach((p, idx) => {
        const isFocused = browseFocusZone === 'rail' && idx === railIndex;
        p.classList.toggle('focused', isFocused);
        if (isFocused) p.scrollIntoView({ block: 'nearest', inline: 'center' });
    });
}

// ---------------------------------------------------------------
// Direct : liste de chaines (au lieu des affiches) + panneau EPG dedie,
// navigation Haut/Bas au lieu de Gauche/Droite (cf. handleUp/Down/Left/Right).
// ---------------------------------------------------------------
function buildChannelListDOM(list) {
    const container = document.getElementById('live-channel-list');
    container.innerHTML = '';
    if (!list.length) {
        container.innerHTML = `<div class="rail-empty">Aucune chaîne.</div>`;
        return;
    }
    list.forEach((item, idx) => {
        const row = document.createElement('div');
        const sectionKey = item._section || browseSectionKey;
        const fav = isFavorite(sectionKey, item) ? 'is-fav' : '';
        row.className = `live-channel-row ${(browseFocusZone === 'rail' && idx === railIndex) ? 'focused' : ''} ${fav}`;
        const imgHtml = item.logo ? `<img src="${item.logo}" loading="lazy" decoding="async" onerror="this.remove()">` : `<div class="live-channel-fallback"></div>`;
        row.innerHTML = `${imgHtml}
            <div class="live-channel-info">
                <div class="live-channel-line1">
                    <span class="live-channel-name">${escapeHtml(item.name)}</span>
                    <span class="live-channel-time"></span>
                </div>
                <div class="live-channel-program">—</div>
                <div class="live-channel-progress"><div class="live-channel-progress-fill"></div></div>
            </div>
            <span class="live-channel-fav-icon">★</span>`;
        container.appendChild(row);
    });
    enrichChannelListWithEpg(list);
}

// Enrichit progressivement les premieres lignes avec le programme en cours
// (horaire + titre + barre de progression), sans bloquer l'affichage de la
// liste. Plafonne le nombre d'appels reseau simultanes pour ne pas
// surcharger le panel sur une categorie a beaucoup de chaines — celles
// au-dela sont enrichies au fil de la navigation (cf. updateLiveEpgPanel).
// Lancer un fetch par chaine EN MEME TEMPS (jusqu'a 40 requetes simultanees)
// est ce qui causait le lag signale a la selection d'une categorie : on
// enrichit desormais UNE chaine a la fois, en tache de fond, avec une
// petite pause entre chaque — la chaine survolee reste, elle, mise a jour
// immediatement via updateLiveEpgPanel, donc rien ne semble "manquant" a
// l'usage, juste rempli plus progressivement pour le reste de la liste.
const CHANNEL_LIST_EAGER_EPG_LIMIT = 40;
let channelListEnrichToken = 0;
function enrichChannelListWithEpg(list) {
    const myToken = ++channelListEnrichToken;
    const rows = document.querySelectorAll('.live-channel-row');
    debugLog(`→ Enrichissement EPG démarré (${Math.min(list.length, CHANNEL_LIST_EAGER_EPG_LIMIT)}/${list.length} chaînes, limite=${CHANNEL_LIST_EAGER_EPG_LIMIT})`);
    let i = 0;
    function next() {
        if (myToken !== channelListEnrichToken) {
            debugLog(`⨯ Enrichissement EPG interrompu à la chaîne #${i} (catégorie/recherche changée)`, 'warn');
            return;
        }
        if (i >= list.length) {
            debugLog(`✓ Enrichissement EPG terminé (${i}/${list.length} chaînes)`, 'ok');
            return;
        }
        if (i >= CHANNEL_LIST_EAGER_EPG_LIMIT) {
            debugLog(`✓ Limite d'enrichissement EPG atteinte à la chaîne #${i}/${list.length} — le reste ne se charge qu'au survol`, 'warn');
            return;
        }
        const item = list[i];
        const row = rows[i];
        i++;
        if (!item.id || !row) { next(); return; }
        loadLiveEpgListings(item).then(function (listings) {
            if (myToken !== channelListEnrichToken) return;
            applyEpgToChannelRow(row, listings);
            setTimeout(next, 150);
        }).catch(function (e) {
            debugLog(`✗ EPG chaîne "${item.name}" (id=${item.id}) : ${e && e.message}`, 'error');
            setTimeout(next, 150);
        });
    }
    next();
}

function applyEpgToChannelRow(row, listings) {
    const { current } = getCurrentAndNextProgram(listings);
    const timeEl = row.querySelector('.live-channel-time');
    const programEl = row.querySelector('.live-channel-program');
    const fillEl = row.querySelector('.live-channel-progress-fill');
    if (!current) {
        if (programEl) programEl.innerText = 'Programme non disponible';
        return;
    }
    if (timeEl) timeEl.innerText = formatEpgTimeRange(current.start, current.end);
    if (programEl) programEl.innerText = current.title;
    if (fillEl && current.stopTs > current.startTs) {
        const pct = Math.min(100, Math.max(0, (Date.now() - current.startTs) / (current.stopTs - current.startTs) * 100));
        fillEl.style.width = `${pct.toFixed(1)}%`;
    }
}

function updateChannelListFocus() {
    document.querySelectorAll('.live-channel-row').forEach((el, idx) => {
        const isFocused = browseFocusZone === 'rail' && idx === railIndex;
        el.classList.toggle('focused', isFocused);
        if (isFocused) el.scrollIntoView({ block: 'nearest' });
    });
}

function clearLiveEpgPanel() {
    document.getElementById('live-epg-channel-name').innerText = '—';
    document.getElementById('live-epg-logo').style.display = 'none';
    document.getElementById('live-epg-programs').innerHTML = '';
    updateLiveEpgFavButton(null);
}

// Mise a jour du panneau EPG pour la chaine survolee (comme updateSynopsisPanel
// pour les films/series). Un seul appel reseau a la fois, jamais pour tout
// le rail — cf. loadLiveEpgListings.
async function updateLiveEpgPanel(item) {
    const myToken = ++synopsisToken;
    document.getElementById('live-epg-channel-name').innerText = item.name;
    const logoEl = document.getElementById('live-epg-logo');
    if (item.logo) { logoEl.src = item.logo; logoEl.style.display = ''; }
    else { logoEl.removeAttribute('src'); logoEl.style.display = 'none'; }
    updateLiveEpgFavButton(item);
    document.getElementById('live-epg-date').innerText = '';
    document.getElementById('live-epg-programs').innerHTML = `<div class="rail-loading">Chargement...</div>`;

    if (!item.id) { document.getElementById('live-epg-programs').innerHTML = ''; return; }
    // Meme principe que updateSynopsisPanel : parcourir vite la liste de
    // chaines ne doit pas declencher une requete EPG par chaine traversee.
    await new Promise(r => setTimeout(r, 200));
    if (myToken !== synopsisToken) return;
    const listings = await loadLiveEpgListings(item);
    if (myToken !== synopsisToken) return; // selection plus recente entre-temps
    document.getElementById('live-epg-date').innerText = formatEpgDateHeader(listings);
    renderLiveEpgPrograms(listings);
    // Enrichit aussi la ligne de la liste (utile pour les chaines au-dela du
    // lot charge en avance, cf. enrichChannelListWithEpg).
    const row = document.querySelectorAll('.live-channel-row')[railIndex];
    if (row) applyEpgToChannelRow(row, listings);
}

function formatEpgDateHeader(listings) {
    if (!listings.length) return '';
    const d = new Date(listings[0].startTs);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function renderLiveEpgPrograms(listings) {
    const container = document.getElementById('live-epg-programs');
    container.innerHTML = '';
    if (!listings.length) {
        container.innerHTML = `<div class="rail-empty">Programme non disponible.</div>`;
        return;
    }
    const now = Date.now();
    listings.forEach(p => {
        const isNow = p.startTs <= now && p.stopTs > now;
        const row = document.createElement('div');
        row.className = `live-epg-program ${isNow ? 'is-now' : ''}`;
        row.innerHTML = `<span class="live-epg-time">${formatEpgTimeRange(p.start, p.end)}</span><span class="live-epg-program-title">${escapeHtml(p.title)}${isNow ? ' <em>EN COURS</em>' : ''}</span>`;
        container.appendChild(row);
    });
}

function updateLiveEpgFavButton(item) {
    const btn = document.getElementById('live-epg-fav-btn');
    const label = document.getElementById('live-epg-fav-label');
    if (!item) {
        btn.classList.remove('is-fav');
        label.innerText = 'Ajouter aux favoris';
        return;
    }
    const isFav = isFavorite(item._section || browseSectionKey, item);
    btn.classList.toggle('is-fav', isFav);
    label.innerText = isFav ? 'Dans mes favoris' : 'Ajouter aux favoris';
}

function updateLiveEpgFavButtonFocus() {
    document.getElementById('live-epg-fav-btn').classList.toggle('focused', browseFocusZone === 'fav' && favSubFocus === 'star');
}

function setBackdrop(url) {
    document.getElementById('synopsis-backdrop').style.backgroundImage = url ? `url('${url}')` : 'none';
}

function renderSynopsisMeta({ rating, rating5, year, genre, duration, country, age }) {
    const parts = [];
    const r = parseFloat(rating);
    const r5 = parseFloat(rating5);
    // Beaucoup de panels laissent "rating" (IMDb) vide ; rating_5based
    // (souvent TMDB, sur 5) sert alors de repli, ramene sur 10 pour comparaison.
    if (r) parts.push(`<span class="meta-imdb">IMDb ${r.toFixed(1)}</span>`);
    else if (r5) parts.push(`<span class="meta-imdb">Note ${(r5 * 2).toFixed(1)}</span>`);
    if (year) parts.push(`<span>${year}</span>`);
    if (age) parts.push(`<span>${age}</span>`);
    if (duration) parts.push(`<span>${duration}</span>`);
    if (genre) parts.push(`<span>${genre}</span>`);
    if (country) parts.push(`<span>${country}</span>`);
    document.getElementById('synopsis-meta').innerHTML = parts.join('');
}

function renderSynopsisCast(director, cast) {
    const parts = [];
    if (director) parts.push(`Réalisateur : ${director}`);
    if (cast) parts.push(`Cast : ${cast}`);
    document.getElementById('synopsis-cast').innerText = parts.join('   •   ');
}

function clearSynopsisPanel() {
    synopsisToken++;
    document.getElementById('synopsis-title').innerText = '—';
    document.getElementById('synopsis-meta').innerHTML = '';
    document.getElementById('synopsis-text').innerText = '';
    document.getElementById('synopsis-cast').innerText = '';
    setBackdrop(null);
    updateSynopsisFavButton(null);
}

// Reflete l'etat favori de l'item affiche sur le bouton etoile du synopsis
function updateSynopsisFavButton(item) {
    const btn = document.getElementById('synopsis-fav-btn');
    const label = document.getElementById('synopsis-fav-label');
    if (!item) {
        btn.classList.remove('is-fav');
        label.innerText = 'Ajouter aux favoris';
        return;
    }
    const isFav = isFavorite(item._section || browseSectionKey, item);
    btn.classList.toggle('is-fav', isFav);
    label.innerText = isFav ? 'Dans mes favoris' : 'Ajouter aux favoris';
}

function updateFavButtonFocus() {
    const inFav = browseFocusZone === 'fav';
    document.getElementById('synopsis-fav-btn').classList.toggle('focused', inFav && favSubFocus === 'star');
    document.getElementById('synopsis-remove-btn').classList.toggle('focused', inFav && favSubFocus === 'remove');
    document.getElementById('live-epg-remove-btn').classList.toggle('focused', inFav && favSubFocus === 'remove');
    updateLiveEpgFavButtonFocus();
}

// Mise a jour dynamique du synopsis au survol d'un poster. Pour les
// series (et episodes), tout est deja disponible sans appel reseau ;
// pour un film, get_vod_info est recupere a la demande (et mis en
// cache) puisque get_vod_streams ne fournit pas plot/genre/casting.
async function updateSynopsisPanel(item) {
    const myToken = ++synopsisToken;
    document.getElementById('synopsis-title').innerText = item.name;
    document.getElementById('synopsis-meta').innerHTML = '';
    document.getElementById('synopsis-text').innerText = '';
    document.getElementById('synopsis-cast').innerText = '';
    setBackdrop(item.logo);
    updateSynopsisFavButton(item);

    if (item.kind === 'series' || item.plot) {
        renderSynopsisMeta({
            rating: item.rating,
            rating5: item.rating5,
            year: (item.releaseDate || '').toString().slice(0, 4),
            genre: item.genre,
            duration: item.episodeRunTime ? `${item.episodeRunTime} min/ép.` : ''
        });
        document.getElementById('synopsis-text').innerText = item.plot || '';
        renderSynopsisCast(item.director, item.cast);
        return;
    }

    // Affiche deja ce qu'on a (note/annee) avant l'appel reseau, pour un retour immediat
    renderSynopsisMeta({ rating: item.rating, rating5: item.rating5 });

    const itemSection = item._section || browseSectionKey;
    if (itemSection === 'live' && item.id) {
        // Parcourir vite le rail (Gauche/Droite tenu, Haut/Bas repete) ne
        // doit pas declencher un appel reseau par chaine traversee : on
        // attend un court instant d'arret avant de lancer la requete EPG,
        // meme principe que le survol de la sidebar (focusSidebarCategory).
        await new Promise(r => setTimeout(r, 200));
        if (myToken !== synopsisToken) return;
        const epg = await loadLiveEpg(item);
        if (myToken !== synopsisToken) return; // selection plus recente entre-temps
        renderLiveEpgInfo(epg);
        return;
    }

    if (itemSection !== 'movies' || !item.id) return; // pas de fiche detaillee pour ce type de contenu

    await new Promise(r => setTimeout(r, 200));
    if (myToken !== synopsisToken) return;
    const info = await loadVodInfo(item);
    if (myToken !== synopsisToken) return; // selection plus recente entre-temps
    if (!info) return;
    renderSynopsisMeta({
        rating: info.rating || item.rating,
        rating5: info.rating_5based || item.rating5,
        year: (info.releasedate || info.release_date || '').toString().slice(0, 4),
        genre: info.genre,
        duration: info.duration || (info.duration_secs ? formatTime(info.duration_secs) : ''),
        country: info.country,
        age: info.age || info.mpaa_rating
    });
    document.getElementById('synopsis-text').innerText = info.plot || info.description || '';
    renderSynopsisCast(info.director, info.cast);
}

// Ouvre la liste des saisons d'une serie (une "affiche" par saison, avec son
// propre visuel/nombre d'episodes quand le panel les fournit).
async function openSeriesSeasons(item) {
    const data = await loadSeriesInfo(item.id);
    const episodesBySeason = data.episodes || {};
    const seasonMetaByNum = {};
    (data.seasons || []).forEach(s => { seasonMetaByNum[s.season_number] = s; });

    const seasonItems = Object.keys(episodesBySeason).sort((a, b) => a - b).map(num => {
        const meta = seasonMetaByNum[num] || {};
        return {
            kind: 'season',
            seasonNum: num,
            name: meta.name || `Saison ${num}`,
            logo: meta.cover || meta.cover_big || item.logo,
            badge: `${episodesBySeason[num].length} ép.`,
            plot: meta.overview || '',
            releaseDate: meta.air_date,
            seriesId: item.id,
            seriesName: item.name,
            seriesLogo: item.logo
        };
    });

    railStack.push({ title: document.getElementById('rail-title').innerText, list: railBaseList, favoritable: railFavoritable, isRecentList: railIsRecentList });
    railFavoritable = false; // ni les saisons ni les episodes ne sont favorisables individuellement
    railIsRecentList = false;
    document.getElementById('rail-title').innerText = item.name;
    showRail(seasonItems);
}

// Ouvre les episodes d'une saison donnee (donnees deja en cache depuis openSeriesSeasons)
async function openSeasonEpisodes(season) {
    const data = await loadSeriesInfo(season.seriesId);
    const episodesOfSeason = (data.episodes || {})[season.seasonNum] || [];
    const cfg = sectionConfig.series;
    const { serverUrl, username, password } = window.iptvServerConfig;

    const episodes = episodesOfSeason.map(ep => {
        const ext = resolveExtension(ep, cfg);
        return {
            kind: 'stream',
            name: ep.title || `Épisode ${ep.episode_num}`,
            url: `${serverUrl}/series/${username}/${password}/${ep.id}.${ext}`,
            logo: season.logo || season.seriesLogo,
            badge: `S${season.seasonNum}E${ep.episode_num}`,
            seriesId: season.seriesId,
            seriesName: season.seriesName
        };
    });

    railStack.push({ title: document.getElementById('rail-title').innerText, list: railBaseList, favoritable: railFavoritable, isRecentList: railIsRecentList });
    railFavoritable = false;
    railIsRecentList = false;
    document.getElementById('rail-title').innerText = `${season.seriesName} — ${season.name}`;
    showRail(episodes);
}

// Ouvre le detail d'une fiche serie regroupee de "Recemment consultes" :
// simple liste (plate, deja triee du plus recent au plus ancien) des
// episodes effectivement consultes recemment pour cette serie — pas la
// serie complete (cf. openSeriesSeasons pour ça).
function openRecentSeriesGroup(group) {
    railStack.push({ title: document.getElementById('rail-title').innerText, list: railBaseList, favoritable: railFavoritable, isRecentList: railIsRecentList });
    railFavoritable = false;
    railIsRecentList = false;
    setRailTitle(group.seriesName || group.name);
    showRail(group._groupedEpisodes);
}

function playRailItem(item) {
    trackRecent(browseSectionKey, item);
    zapList = railList.filter(it => it.url).map(it => ({ ...it }));
    zapIndex = zapList.findIndex(it => it.url === item.url);
    playItemWithResume(item, document.getElementById('rail-title').innerText);
}

// Joue un contenu en reprenant la position memorisee (film ou episode
// entame lors d'une session precedente), et sauvegarde d'abord la
// progression de ce qui etait en cours (utile lors d'un zap vers un
// autre episode/film sans repasser par stopAndExitPlayer).
function playItemWithResume(item, categoryLabel) {
    saveProgressNow();
    const progress = getProgress(browseSectionKey, item);
    const resumeAt = (progress && !progress.done) ? progress.position : 0;
    if (resumeAt > PROGRESS_MIN_SECONDS) {
        // Contenu deja entame : on demande avant de reprendre plutot que de
        // le faire silencieusement (cf. openResumeDialog).
        openResumeDialog(item, categoryLabel, browseSectionKey, resumeAt);
        return;
    }
    currentPlayItem = item;
    currentPlaySection = browseSectionKey;
    playStream(item.url, item.name, categoryLabel, item.logo, 0);
}

function toggleFavoriteOnFocusedRailItem() {
    if (!railFavoritable) return; // saisons/episodes : seule la fiche serie est favorisable
    const item = railList[railIndex];
    if (!item || item.kind === 'recentSeriesGroup') return; // fiche synthetique : rien de reel a favoriser
    const added = toggleFavorite(item._section || browseSectionKey, item);
    const posters = document.querySelectorAll('.rail-poster');
    if (posters[railIndex]) posters[railIndex].classList.toggle('is-fav', added);
    const channelRows = document.querySelectorAll('.live-channel-row');
    if (channelRows[railIndex]) channelRows[railIndex].classList.toggle('is-fav', added);
    updateSynopsisFavButton(item);
    updateLiveEpgFavButton(item);
    flashAppToast(added ? 'Ajouté aux favoris' : 'Retiré des favoris');
}

// Retire l'item survole de "Recemment consultes" (fiche serie regroupee ou
// item individuel), puis reconstruit la liste sans lui.
function removeFocusedFromRecent() {
    const item = railList[railIndex];
    if (!item) return;
    removeFromRecent(item._section || browseSectionKey, item);
    const newList = railBaseList.filter(it => it !== item);
    flashAppToast('Retiré de l\'historique');
    showRail(newList);
}

// Filtre le rail actuellement affiché (recherche locale, limitée aux
// catégories déjà consultées cette session — Xtream Codes n'expose pas
// d'action de recherche globale côté serveur). Filtre sur railFullList
// (jamais plafonnee) et non railBaseList (l'affichage initial peut etre
// plafonne a 300 items pour "Tout afficher"), sinon un contenu au-dela de
// ce plafond serait introuvable meme en tapant son nom exact.
document.getElementById('browse-search').addEventListener('input', function (e) {
    const q = e.target.value.trim().toLowerCase();
    const RESULTS_CAP = 300;
    let filtered = q ? railFullList.filter(it => it.name.toLowerCase().includes(q)) : railBaseList;
    if (filtered.length > RESULTS_CAP) filtered = filtered.slice(0, RESULTS_CAP);
    railList = filtered;
    railIndex = 0;
    renderRailOrChannelList(railList);
});

// Filtre la liste des categories dans la sidebar (nom uniquement). Le
// chargement effectif du contenu ne se declenche qu'apres un court delai
// pour eviter une requete reseau a chaque frappe.
let catSearchDebounceTimer = null;
document.getElementById('browse-cat-search').addEventListener('input', function (e) {
    const q = e.target.value.trim().toLowerCase();
    visibleCategories = q ? browseCategories.filter(c => c.name.toLowerCase().includes(q)) : browseCategories;
    browseCatIndex = 0;
    renderCatListDOM();
    updateSidebarFocus();
    clearTimeout(catSearchDebounceTimer);
    catSearchDebounceTimer = setTimeout(() => {
        if (visibleCategories.length) {
            selectCategory(0);
        } else {
            setRailTitle('');
            document.getElementById('rail-track').innerHTML = `<div class="rail-empty">Aucune catégorie ne correspond.</div>`;
            clearSynopsisPanel();
        }
    }, 300);
});

// La dictee vocale passe par le clavier virtuel Samsung lui-meme (bouton
// micro de la telecommande, pris en charge nativement par le clavier
// systeme des qu'un champ texte est focus) : rien a coder ici, c'est deja
// disponible via le focus normal du champ (cf. handleEnter, zone 'search').
document.getElementById('search-clear-btn').addEventListener('click', clearContentSearch);

// ---------------------------------------------------------------
// Gestion globale des touches de la télécommande Samsung
// ---------------------------------------------------------------
window.addEventListener('keydown', function (e) {
    if (settingsModalOpen) {
        handleSettingsModalKey(e.keyCode);
        return;
    }
    if (accountModalOpen) {
        handleAccountModalKey(e.keyCode);
        return;
    }
    if (resumeDialogOpen) {
        handleResumeDialogKey(e.keyCode);
        return;
    }
    switch (e.keyCode) {
        case 38: handleUp(); break;
        case 40: handleDown(); break;
        case 37: handleLeft(); break;
        case 39: handleRight(); break;
        case 13: handleEnter(); break;
        case 10009: case 8: handleBack(); break;
    }
});

// Le clavier virtuel Samsung se declenche via input.focus() (cf. handleEnter
// sur les zones de recherche) et le focus DOM y reste tant qu'on ne le
// libere pas explicitement : sans ce blur(), les touches directionnelles
// suivantes continuent d'etre captees par le champ texte au lieu de la
// navigation de l'appli, qui semble alors "revenir" tout le temps sur la
// recherche. On le libere avant tout deplacement (Haut/Bas/Gauche/Droite/
// Retour) ; Entree reste seule capable de (re)donner le focus au champ.
function blurBrowseSearchInputs() {
    const active = document.activeElement;
    if (active && (active.id === 'browse-search' || active.id === 'browse-cat-search')) {
        active.blur();
    }
}

function handleUp() {
    blurBrowseSearchInputs();
    if (currentView === 'login') {
        if (loginFocusIndex > 0) loginFocusIndex--;
        updateLoginFocus();
    } else if (currentView === 'home') {
        if (homeZone === 'menu') {
            homeZone = 'header';
            updateHomeFocus();
        }
    } else if (currentView === 'browse') {
        if (browseFocusZone === 'sidebar' && browseCatIndex > -1) {
            focusSidebarCategory(browseCatIndex - 1);
        } else if (browseFocusZone === 'rail' && browseSectionKey === 'live' && railIndex > 0) {
            // Direct : liste verticale, Haut/Bas deplacent la selection au
            // lieu de Gauche/Droite (cf. handleLeft/handleRight).
            railIndex--;
            updateRailSelectionUI();
        } else if (browseFocusZone === 'rail' && browseSectionKey === 'live') {
            // Direct : rien au-dessus de la liste — les boutons fav/suppression
            // sont a DROITE (panneau EPG), pas en haut (cf. handleRight).
        } else if (browseFocusZone === 'rail') {
            // Les episodes/saisons ne sont pas favorisables individuellement
            // (seule la fiche serie l'est) : le bouton etoile est masque,
            // on saute donc directement vers la recherche.
            browseFocusZone = railFavoritable ? 'fav' : 'search';
            favSubFocus = 'star';
            if (!railFavoritable) searchSubFocus = 'input';
            updateRailFocus();
            updateFavButtonFocus();
            updateSearchZoneFocus();
        } else if (browseFocusZone === 'fav') {
            browseFocusZone = 'search';
            searchSubFocus = 'input';
            updateFavButtonFocus();
            updateSearchZoneFocus();
        }
    } else if (currentView === 'player') {
        if (trackMenuNav) {
            trackMenuFocusIndex = Math.max(0, trackMenuFocusIndex - 1);
            renderTrackMenu();
        } else if (playerNav === 'hidden') {
            showPlayerControls();
        } else if (osdZone === 'episodes') {
            if (episodeFocusIndex > 0) {
                episodeFocusIndex--;
                renderEpisodeList();
            } else {
                closeEpisodeList();
                osdZone = 'buttons';
                updatePlayerButtonFocus();
            }
        } else if (osdZone === 'buttons') {
            osdZone = 'seek';
            updatePlayerButtonFocus();
        }
        // osdZone === 'seek' : rien au-dessus, pas d'action.
    }
}

function handleDown() {
    blurBrowseSearchInputs();
    if (currentView === 'login') {
        if (loginFocusIndex < loginElements.length - 1) loginFocusIndex++;
        updateLoginFocus();
    } else if (currentView === 'home') {
        if (homeZone === 'header') {
            homeZone = 'menu';
            updateHomeFocus();
        }
    } else if (currentView === 'browse') {
        if (browseFocusZone === 'sidebar' && browseCatIndex < visibleCategories.length - 1) {
            focusSidebarCategory(browseCatIndex + 1);
        } else if (browseFocusZone === 'search') {
            browseFocusZone = railFavoritable ? 'fav' : 'rail';
            favSubFocus = 'star';
            updateSearchZoneFocus();
            updateFavButtonFocus();
            updateRailFocus();
            updateChannelListFocus();
        } else if (browseFocusZone === 'fav') {
            browseFocusZone = 'rail';
            updateFavButtonFocus();
            updateRailFocus();
            updateChannelListFocus();
        } else if (browseFocusZone === 'rail' && browseSectionKey === 'live' && railIndex < railList.length - 1) {
            // Direct : liste verticale, Bas descend dans la liste de chaines.
            railIndex++;
            updateRailSelectionUI();
        }
    } else if (currentView === 'player') {
        if (trackMenuNav) {
            trackMenuFocusIndex = Math.min(trackMenuList.length - 1, trackMenuFocusIndex + 1);
            renderTrackMenu();
        } else if (playerNav === 'hidden') {
            showPlayerControls();
        } else if (osdZone === 'episodes') {
            episodeFocusIndex = Math.min(zapList.length - 1, episodeFocusIndex + 1);
            renderEpisodeList();
        } else if (osdZone === 'seek') {
            osdZone = 'buttons';
            updatePlayerButtonFocus();
        } else {
            // osdZone === 'buttons' : deploie la liste des episodes/chaines.
            openEpisodeList();
        }
    }
}

function handleLeft() {
    blurBrowseSearchInputs();
    if (currentView === 'home') {
        if (homeZone === 'menu') homeIndex = Math.max(0, homeIndex - 1);
        else headerIndex = Math.max(0, headerIndex - 1);
        updateHomeFocus();
    } else if (currentView === 'browse') {
        if (browseFocusZone === 'rail') {
            // Direct : liste verticale sans deplacement horizontal, Gauche
            // revient donc toujours a la sidebar (Haut/Bas deplacent la liste).
            if (railIndex === 0 || browseSectionKey === 'live') {
                browseFocusZone = 'sidebar';
                document.getElementById('browse-sidebar').classList.remove('collapsed');
                updateRailFocus();
                updateChannelListFocus();
                updateSidebarFocus();
            } else {
                railIndex--;
                updateRailFocus();
                updateSynopsisPanel(railList[railIndex]);
            }
        } else if (browseFocusZone === 'fav') {
            if (favSubFocus === 'remove') {
                favSubFocus = 'star';
                updateFavButtonFocus();
            } else if (browseSectionKey === 'live') {
                // Direct : les boutons sont a droite de la liste, Gauche y revient.
                browseFocusZone = 'rail';
                updateFavButtonFocus();
                updateChannelListFocus();
            } else {
                browseFocusZone = 'sidebar';
                document.getElementById('browse-sidebar').classList.remove('collapsed');
                updateFavButtonFocus();
                updateSidebarFocus();
            }
        } else if (browseFocusZone === 'search') {
            if (searchSubFocus === 'clear') {
                searchSubFocus = 'input';
                updateSearchZoneFocus();
            } else {
                browseFocusZone = 'sidebar';
                document.getElementById('browse-sidebar').classList.remove('collapsed');
                updateSearchZoneFocus();
                updateSidebarFocus();
            }
        }
    } else if (currentView === 'player') {
        if (trackMenuNav) {
            closeTrackMenu();
            showPlayerControls();
        } else if (playerNav === 'hidden') {
            showPlayerControls();
        } else if (osdZone === 'episodes') {
            closeEpisodeList();
            osdZone = 'buttons';
            updatePlayerButtonFocus();
        } else if (osdZone === 'seek') {
            seekBy(-10);
            resetPlayerHideTimer();
        } else {
            playerFocusIndex = (playerFocusIndex - 1 + PLAYER_BUTTONS.length) % PLAYER_BUTTONS.length;
            updatePlayerButtonFocus();
            resetPlayerHideTimer();
        }
    }
}

async function handleRight() {
    blurBrowseSearchInputs();
    if (currentView === 'home') {
        if (homeZone === 'menu') homeIndex = Math.min(HOME_BUTTONS.length - 1, homeIndex + 1);
        else headerIndex = Math.min(HEADER_BUTTONS.length - 1, headerIndex + 1);
        updateHomeFocus();
    } else if (currentView === 'browse') {
        if (browseFocusZone === 'sidebar') {
            if (sidebarPreviewTimer) {
                // Categorie survolee mais pas encore chargee (debounce en
                // cours, cf. focusSidebarCategory) : on la charge tout de
                // suite plutot que d'entrer dans le rail avec le contenu
                // (perime) de la categorie precedente.
                clearTimeout(sidebarPreviewTimer);
                sidebarPreviewTimer = null;
                await selectCategory(browseCatIndex);
            } else if (railIsPreview) {
                // Deja charge en aperçu (15 premieres, cf. SIDEBAR_PREVIEW_CAP) :
                // on complete avec le reste, deja recupere, sans requete reseau.
                railIsPreview = false;
                showRail(railPreviewFullList);
                railPreviewFullList = null;
            }
            if (railList.length) {
                browseFocusZone = 'rail';
                document.getElementById('browse-sidebar').classList.add('collapsed');
                updateRailFocus();
                updateChannelListFocus();
            }
        } else if (browseFocusZone === 'rail' && browseSectionKey === 'live') {
            // Direct : les boutons fav/suppression sont a droite de la liste
            // de chaines (panneau EPG), donc Droite y donne acces directement.
            browseFocusZone = railFavoritable ? 'fav' : 'search';
            favSubFocus = 'star';
            if (!railFavoritable) searchSubFocus = 'input';
            updateRailFocus();
            updateChannelListFocus();
            updateFavButtonFocus();
            updateSearchZoneFocus();
        } else if (browseFocusZone === 'rail' && railIndex < railList.length - 1) {
            railIndex++;
            updateRailFocus();
            updateSynopsisPanel(railList[railIndex]);
        } else if (browseFocusZone === 'fav' && railIsRecentList && favSubFocus === 'star') {
            favSubFocus = 'remove';
            updateFavButtonFocus();
        } else if (browseFocusZone === 'search' && searchSubFocus === 'input') {
            searchSubFocus = 'clear';
            updateSearchZoneFocus();
        }
    } else if (currentView === 'player') {
        if (trackMenuNav) {
            // Menu centre : rien a faire a droite.
        } else if (playerNav === 'hidden') {
            showPlayerControls();
        } else if (osdZone === 'episodes') {
            // Rien a droite d'une liste verticale.
        } else if (osdZone === 'seek') {
            seekBy(10);
            resetPlayerHideTimer();
        } else {
            playerFocusIndex = (playerFocusIndex + 1) % PLAYER_BUTTONS.length;
            updatePlayerButtonFocus();
            resetPlayerHideTimer();
        }
    }
}

function handleEnter() {
    if (currentView === 'login') {
        if (loginFocusIndex < 3) {
            const activeInput = loginElements[loginFocusIndex];
            activeInput.focus(); // Ouvre le clavier virtuel de la TV Samsung
            if (typeof tizen !== 'undefined' && tizen.tvinputdevice) {
                try { tizen.tvinputdevice.registerKey("MediaPlayPause"); } catch (err) {}
            }
        } else if (loginFocusIndex === 3 || loginElements[loginFocusIndex].tagName === 'BUTTON') {
            connectToIPTV();
        }
    } else if (currentView === 'home') {
        activateHomeSelection();
    } else if (currentView === 'browse') {
        if (browseFocusZone === 'sidebar') {
            if (browseCatIndex === -1) {
                document.getElementById('browse-cat-search').focus(); // Ouvre le clavier virtuel de la TV Samsung
            } else {
                handleRight(); // bascule sur le rail, comme la fleche Droite
            }
        } else if (browseFocusZone === 'search') {
            if (searchSubFocus === 'clear') clearContentSearch();
            else document.getElementById('browse-search').focus(); // Ouvre le clavier virtuel Samsung (dictee vocale native incluse)
        } else if (browseFocusZone === 'fav') {
            if (favSubFocus === 'remove') removeFocusedFromRecent();
            else toggleFavoriteOnFocusedRailItem();
        } else {
            const item = railList[railIndex];
            if (!item) return;
            // Vue "Favoris" agregee : on ne commet la vraie section (pour la
            // lecture/le drill-down serie, la progression, etc.) qu'au
            // moment ou l'utilisateur joue/entre reellement dans un item —
            // le simple survol dans le rail reste sur la page Favoris.
            if (item._section) browseSectionKey = item._section;
            if (item.kind === 'series') openSeriesSeasons(item);
            else if (item.kind === 'season') openSeasonEpisodes(item);
            else if (item.kind === 'recentSeriesGroup') openRecentSeriesGroup(item);
            else if (item.url) playRailItem(item);
        }
    } else if (currentView === 'player') {
        if (trackMenuNav) {
            confirmTrackMenuSelection();
        } else if (playerNav === 'hidden') {
            showPlayerControls();
            togglePlayPause();
        } else if (osdZone === 'episodes') {
            selectEpisodeListItem();
        } else if (osdZone === 'seek') {
            togglePlayPause();
            resetPlayerHideTimer();
        } else {
            activatePlayerButton(PLAYER_BUTTONS[playerFocusIndex]);
            resetPlayerHideTimer();
        }
    }
}

function handleBack() {
    blurBrowseSearchInputs();
    if (currentView === 'player') {
        if (trackMenuNav) {
            closeTrackMenu();
            showPlayerControls();
        } else if (osdZone === 'episodes') {
            closeEpisodeList();
            osdZone = 'buttons';
            updatePlayerButtonFocus();
        } else if (playerNav === 'controls') {
            hidePlayerControls();
        } else {
            stopAndExitPlayer();
        }
        return;
    }

    if (currentView === 'browse') {
        if (browseFocusZone === 'search' || browseFocusZone === 'fav') {
            browseFocusZone = 'rail';
            updateSearchZoneFocus();
            updateFavButtonFocus();
            updateRailFocus();
            updateChannelListFocus();
        } else if (railStack.length) {
            const prev = railStack.pop();
            setRailTitle(prev.title);
            railFavoritable = prev.favoritable !== undefined ? prev.favoritable : true;
            railIsRecentList = !!prev.isRecentList;
            showRail(prev.list);
            browseFocusZone = 'rail';
        } else if (browseFocusZone === 'rail') {
            browseFocusZone = 'sidebar';
            document.getElementById('browse-sidebar').classList.remove('collapsed');
            updateSidebarFocus();
        } else {
            enterHome();
        }
    } else if (currentView === 'home') {
        if (typeof tizen !== 'undefined' && tizen.application) {
            try { tizen.application.getCurrentApplication().exit(); } catch (e) {}
        }
    }
}

const videoPlayerEl = document.getElementById('video-player');
const playerErrorBox = document.getElementById('player-error');
let hlsInstance = null;

// Etat de l'OSD du lecteur video. Gauche/Droite avance/recule directement
// dans la video par defaut (osdZone 'seek') ; Haut deploie la rangee de
// boutons (Lecture/Pause, Suivant, Audio, Sous-titres), navigable en
// Gauche/Droite une fois dessus ; Bas (depuis 'seek' ou 'buttons') deploie
// la liste des autres episodes/chaines, integree dans l'OSD (remplace
// l'ancien tiroir de zapping en modal).
let playerNav = 'hidden'; // 'hidden' | 'controls'
let osdZone = 'buttons'; // 'seek' | 'buttons' | 'episodes'
const PLAYER_BUTTONS = ['playpause', 'next', 'audio', 'subtitle'];
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
                document.getElementById('avplay-subtitle-overlay').innerText = text || '';
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

    const playerView = document.getElementById('player-view');
    const requestFs = playerView.requestFullscreen || playerView.webkitRequestFullscreen || playerView.mozRequestFullScreen;
    if (requestFs) {
        Promise.resolve(requestFs.call(playerView)).catch(() => {});
    }
}

// Coupe le flux et quitte le plein écran en revenant a l'ecran de navigation
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
    stopAvplayIfActive();
    if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
    }
    videoPlayerEl.pause();
    videoPlayerEl.removeAttribute('src');
    videoPlayerEl.load();

    const exitFs = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen;
    if (document.fullscreenElement && exitFs) {
        Promise.resolve(exitFs.call(document)).catch(() => {});
    }

    showView('browse');
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

function formatTime(totalSeconds) {
    const sec = Math.max(0, Math.floor(totalSeconds || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = n => n.toString().padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
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
        const logoHtml = item.logo ? `<img src="${item.logo}" loading="lazy" decoding="async" onerror="this.style.display='none'">` : '';
        row.innerHTML = `${logoHtml}<span>${item.name}</span>`;
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

    enterHome();
}

// Authentification Xtream Codes via l'API JSON (léger, pas de M3U brut)
async function connectToIPTV() {
    let serverUrl = document.getElementById('iptv-url').value.trim().replace(/['"]+/g, '');
    const username = document.getElementById('iptv-user').value.trim().replace(/['"]+/g, '');
    const password = document.getElementById('iptv-pass').value.trim().replace(/['"]+/g, '');

    if (serverUrl.endsWith('/')) serverUrl = serverUrl.slice(0, -1);
    if (!serverUrl.startsWith('http://') && !serverUrl.startsWith('https://')) serverUrl = 'http://' + serverUrl;

    const apiUrl = `${serverUrl}/player_api.php?username=${username}&password=${password}`;

    try {
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error("Erreur HTTP: " + response.status);

        const data = await response.json();

        if (data.user_info && data.user_info.auth === 1) {
            document.getElementById('home-expiry').innerText = formatExpiry(data.user_info.exp_date);

            // Conserve les infos de compte pour la modale "Mon compte"
            window.iptvUserInfo = data.user_info;

            // Sauvegarde de la config serveur pour la construction des flux
            window.iptvServerConfig = {
                serverUrl, username, password,
                allowedFormats: data.user_info.allowed_output_formats || []
            };

            // Conserve les identifiants pour éviter une reconnexion manuelle
            try {
                localStorage.setItem(CREDENTIALS_KEY, JSON.stringify({ serverUrl, username, password }));
            } catch (e) {}

            // Repart d'un état propre en cas de reconnexion, puis recharge
            // instantanement ce qui est deja connu de ce compte depuis un
            // lancement precedent (cf. loadPersistentCaches).
            Object.keys(categoriesCache).forEach(k => delete categoriesCache[k]);
            Object.keys(itemsCache).forEach(k => delete itemsCache[k]);
            loadPersistentCaches();

            await showSplashAndPreload();
        } else {
            alert("Identifiants invalides ou compte expiré.");
        }
    } catch (error) {
        console.error("Erreur API:", error);
        alert("Impossible de se connecter à l'API du serveur.");
    }
}

// Efface les identifiants sauvegardés et revient à l'écran de connexion
function logout() {
    try {
        localStorage.removeItem(CREDENTIALS_KEY);
    } catch (e) {}
    location.reload();
}

// Auto-connexion si des identifiants ont déjà été validés précédemment
(function tryAutoLogin() {
    try {
        const saved = localStorage.getItem(CREDENTIALS_KEY);
        if (!saved) return;
        const creds = JSON.parse(saved);
        document.getElementById('iptv-url').value = creds.serverUrl || '';
        document.getElementById('iptv-user').value = creds.username || '';
        document.getElementById('iptv-pass').value = creds.password || '';
        connectToIPTV();
    } catch (e) {
        console.error('Erreur auto-login:', e);
    }
})();

// Rendu initial des icones Lucide (menu, header). Idempotent : sans effet
// sur les icones deja converties, donc sans risque a rappeler ailleurs.
if (window.lucide) lucide.createIcons();
