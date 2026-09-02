// ---------------------------------------------------------------
// modals.js : modales Compte et Parametres (avec HUD de performances et
// journal de debug), modale de reprise de lecture. Cf. app-shell.js pour le
// principe general du decoupage en plusieurs fichiers.
// ---------------------------------------------------------------

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
// Modale Parametres : sidebar de sections + panneau de contenu. Deux zones
// de focus, comme le modele deja utilise pour la navigation Films/Series/
// Direct (sidebar/rail) : settingsZone 'nav' (sidebar) ou 'content' (panneau
// actif). Gauche/Droite passent d'une zone a l'autre ET, sur une ligne a
// valeur cyclique (data-cycle), changent directement sa valeur.
//
// Deux types d'entrees de sidebar : 'panel' (a un panneau de contenu dans
// lequel on entre, cf. settingsZone) et 'action' (declenchee directement
// depuis la sidebar sans panneau, ex. Deconnexion — pas de reglage a
// afficher pour une simple action immediate).
// ---------------------------------------------------------------
let settingsModalOpen = false;
const SETTINGS_SIDEBAR_ITEMS = [
    { type: 'panel', panel: 'server' },
    { type: 'panel', panel: 'theme' },
    { type: 'panel', panel: 'subtitles' },
    { type: 'panel', panel: 'categories' },
    { type: 'panel', panel: 'textsize' },
    { type: 'panel', panel: 'admin' },
    { type: 'action', action: 'logout' }
];
let settingsZone = 'nav'; // 'nav' | 'content'
let settingsNavIndex = 0;
let settingsContentIndex = 0;
let settingsHiddenCatSection = 'movies'; // section affichee dans "Categories masquees"

function openSettingsModal() {
    settingsModalOpen = true;
    settingsZone = 'nav';
    settingsNavIndex = 0;
    settingsContentIndex = 0;
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
    updateSettingsThemeButtonLabel();
    renderSubtitlePrefsPanel();
    renderTextSizePanel();
    renderHiddenCategoriesPanel();
    showSettingsPanel(SETTINGS_SIDEBAR_ITEMS[settingsNavIndex].panel);
    updateSettingsNavFocus();
    updateSettingsContentFocus();
    document.getElementById('settings-modal').classList.add('visible');
}

function showSettingsPanel(panelKey) {
    // .active marque la section courante en permanence (meme une fois le
    // focus passe dans le panneau, ou en survolant une entree 'action' de la
    // sidebar) ; .focused (cf. updateSettingsNavFocus) ne s'applique lui que
    // zone 'nav' active, sinon la sidebar semblerait "perdre" sa selection
    // en changeant de zone.
    document.querySelectorAll('.settings-nav-item').forEach(el => el.classList.toggle('active', el.dataset.panel === panelKey));
    document.querySelectorAll('.settings-panel').forEach(el => el.classList.toggle('active', el.dataset.panel === panelKey));
}

function updateSettingsNavFocus() {
    document.querySelectorAll('.settings-nav-item').forEach((el, idx) => {
        el.classList.toggle('focused', settingsZone === 'nav' && idx === settingsNavIndex);
    });
}

function getSettingsPanelFocusables() {
    const item = SETTINGS_SIDEBAR_ITEMS[settingsNavIndex];
    if (!item || item.type !== 'panel') return [];
    return Array.from(document.querySelectorAll(`#settings-panel-${item.panel} .settings-focusable`));
}

function updateSettingsContentFocus() {
    const focusables = getSettingsPanelFocusables();
    focusables.forEach((el, idx) => {
        const focused = settingsZone === 'content' && idx === settingsContentIndex;
        el.classList.toggle('focused', focused);
        if (focused) el.scrollIntoView({ block: 'nearest' });
    });
}

// Deplacement Haut/Bas dans la sidebar : change de panneau affiche pour une
// entree 'panel', ne fait rien de plus pour une entree 'action' (le panneau
// affiche reste celui visite le plus recemment).
function onSettingsNavMove() {
    const item = SETTINGS_SIDEBAR_ITEMS[settingsNavIndex];
    if (item.type === 'panel') {
        settingsContentIndex = 0;
        showSettingsPanel(item.panel);
    }
    updateSettingsNavFocus();
    updateSettingsContentFocus();
}

// OK/Droite sur la sidebar : entre dans le panneau pour une entree 'panel',
// declenche l'action immediatement pour une entree 'action'.
function enterSettingsNavItem() {
    const item = SETTINGS_SIDEBAR_ITEMS[settingsNavIndex];
    if (item.type === 'action') {
        runSettingsAction(item.action);
        return;
    }
    settingsZone = 'content';
    settingsContentIndex = 0;
    updateSettingsNavFocus();
    updateSettingsContentFocus();
}

function runSettingsAction(action) {
    if (action === 'logout') logout();
}

function activateSettingsFocusable(el) {
    if (!el) return;
    if (el.dataset.cycle) {
        cycleSettingsValue(el.dataset.cycle, 1);
        return;
    }
    if (el.classList.contains('settings-cat-row')) {
        toggleSettingsCatRow(el);
        return;
    }
    const action = el.getAttribute('data-action');
    if (action === 'server') editServer();
    else if (action === 'theme') toggleAppTheme(); // reste ouvert, pratique pour comparer
    else if (action === 'perf') togglePerfHud();
    else if (action === 'debug') toggleDebugLog();
}

function cycleSettingsValue(cycleKey, direction) {
    if (cycleKey === 'subtitle-font') {
        const prefs = getSubtitlePrefs();
        prefs.fontIndex = (prefs.fontIndex + direction + SUBTITLE_FONT_OPTIONS.length) % SUBTITLE_FONT_OPTIONS.length;
        saveSubtitlePrefs(prefs);
        renderSubtitlePrefsPanel();
        applySubtitleStylePrefs();
    } else if (cycleKey === 'subtitle-color') {
        const prefs = getSubtitlePrefs();
        prefs.colorIndex = (prefs.colorIndex + direction + SUBTITLE_COLOR_OPTIONS.length) % SUBTITLE_COLOR_OPTIONS.length;
        saveSubtitlePrefs(prefs);
        renderSubtitlePrefsPanel();
        applySubtitleStylePrefs();
    } else if (cycleKey === 'subtitle-bg') {
        const prefs = getSubtitlePrefs();
        prefs.bgIndex = (prefs.bgIndex + direction + SUBTITLE_BG_OPTIONS.length) % SUBTITLE_BG_OPTIONS.length;
        saveSubtitlePrefs(prefs);
        renderSubtitlePrefsPanel();
        applySubtitleStylePrefs();
    } else if (cycleKey === 'hidden-cat-section') {
        const sections = ['movies', 'series', 'live'];
        const idx = sections.indexOf(settingsHiddenCatSection);
        settingsHiddenCatSection = sections[(idx + direction + sections.length) % sections.length];
        renderHiddenCategoriesPanel();
    } else if (cycleKey === 'text-size') {
        let idx = (getTextSizeIndex() + direction + TEXT_SIZE_OPTIONS.length) % TEXT_SIZE_OPTIONS.length;
        saveTextSizeIndex(idx);
        applyTextSize(idx);
        renderTextSizePanel();
    } else if (cycleKey === 'subtitle-size') {
        const prefs = getSubtitlePrefs();
        prefs.sizeIndex = (prefs.sizeIndex + direction + SUBTITLE_SIZE_OPTIONS.length) % SUBTITLE_SIZE_OPTIONS.length;
        saveSubtitlePrefs(prefs);
        renderSubtitlePrefsPanel();
        applySubtitleStylePrefs();
    }
}

function renderSubtitlePrefsPanel() {
    const prefs = getSubtitlePrefs();
    const font = SUBTITLE_FONT_OPTIONS[prefs.fontIndex];
    const color = SUBTITLE_COLOR_OPTIONS[prefs.colorIndex];
    const bg = SUBTITLE_BG_OPTIONS[prefs.bgIndex];
    const size = SUBTITLE_SIZE_OPTIONS[prefs.sizeIndex];
    document.getElementById('settings-subtitle-font-value').innerText = font;
    document.getElementById('settings-subtitle-color-value').innerText = color.label;
    document.getElementById('settings-subtitle-bg-value').innerText = bg.label;
    document.getElementById('settings-subtitle-size-value').innerText = size.label;
    const preview = document.getElementById('settings-subtitle-preview-text');
    preview.style.fontFamily = font;
    preview.style.color = color.value;
    preview.style.background = bg.value;
    preview.style.fontSize = size.px + 'px';
}

function renderTextSizePanel() {
    document.getElementById('settings-textsize-value').innerText = TEXT_SIZE_OPTIONS[getTextSizeIndex()].label;
}

const HIDDEN_CAT_SECTION_LABELS = { movies: 'Films', series: 'Séries', live: 'Direct' };
let hiddenCatRenderToken = 0;

// Categories masquees : source = categoriesCache (deja peuple par le
// prechargement du splash pour live/movies/series, cf. showSplashAndPreload) ;
// repli sur une requete a la demande si jamais absent. hiddenCatRenderToken
// evite d'afficher un resultat perime si la section est changee (cycle
// rapide Gauche/Droite) avant la fin d'un fetch de repli.
async function renderHiddenCategoriesPanel() {
    const myToken = ++hiddenCatRenderToken;
    const section = settingsHiddenCatSection;
    document.getElementById('settings-hidden-cat-section-value').innerText = HIDDEN_CAT_SECTION_LABELS[section];
    const listEl = document.getElementById('settings-category-list');
    listEl.innerHTML = `<div class="settings-cat-empty">Chargement...</div>`;

    let cats = categoriesCache[section];
    if (!cats) {
        try {
            const { serverUrl, username, password } = window.iptvServerConfig;
            const action = sectionConfig[section].catAction;
            cats = await fetchJson(`${serverUrl}/player_api.php?username=${username}&password=${password}&action=${action}`, 1);
            categoriesCache[section] = cats;
        } catch (e) {
            if (myToken !== hiddenCatRenderToken) return;
            listEl.innerHTML = `<div class="settings-cat-empty">Impossible de charger les catégories.</div>`;
            return;
        }
    }
    if (myToken !== hiddenCatRenderToken) return;

    if (!cats.length) {
        listEl.innerHTML = `<div class="settings-cat-empty">Aucune catégorie.</div>`;
        return;
    }
    listEl.innerHTML = '';
    cats.forEach(cat => {
        const hidden = isCategoryHidden(section, cat.category_id);
        const row = document.createElement('div');
        row.className = `settings-cat-row settings-focusable ${hidden ? 'is-hidden' : ''}`;
        row.dataset.catId = cat.category_id;
        row.innerHTML = `<span class="settings-cat-checkbox"></span><span class="settings-cat-name">${escapeHtml(cat.category_name)}</span>`;
        listEl.appendChild(row);
    });
    // La nouvelle liste peut etre plus courte que l'ancienne selection.
    const currentItem = SETTINGS_SIDEBAR_ITEMS[settingsNavIndex];
    if (settingsZone === 'content' && currentItem && currentItem.panel === 'categories') {
        const focusables = getSettingsPanelFocusables();
        settingsContentIndex = Math.min(settingsContentIndex, Math.max(0, focusables.length - 1));
        updateSettingsContentFocus();
    }
}

function toggleSettingsCatRow(el) {
    const nowHidden = toggleCategoryHidden(settingsHiddenCatSection, el.dataset.catId);
    el.classList.toggle('is-hidden', nowHidden);
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
    const panel = document.getElementById('debug-log-panel');
    panel.classList.toggle('visible', enabled);
    const el = document.getElementById('settings-debug-state');
    if (el) el.innerText = enabled ? 'Activé' : 'Désactivé';
    if (enabled) {
        // Rejoue l'historique deja capture (cf. reportUncaughtError) : sans
        // ça, une erreur survenue avant l'activation du panneau resterait
        // invisible alors qu'elle est deja en memoire (debugLogEntries).
        panel.innerHTML = '';
        debugLogEntries.forEach(entry => {
            const line = document.createElement('div');
            line.className = `debug-log-line ${entry.level || ''}`;
            line.innerText = `[${entry.time}] ${entry.message}`;
            panel.appendChild(line);
        });
        panel.scrollTop = panel.scrollHeight;
        debugLog('Journal de debug activé', 'ok');
    }
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

// ---------------------------------------------------------------
// Modale de confirmation avant de quitter la lecture (Retour, lecteur en
// plein ecran) : sortir completement, ou reduire en mini-lecteur (cf.
// enterMiniPlayer dans player.js) pour continuer a naviguer ailleurs.
// ---------------------------------------------------------------
let exitPlayerDialogOpen = false;
let exitPlayerDialogFocusIndex = 0; // 0 = Reduire (PiP), 1 = Sortir

function openExitPlayerDialog() {
    // #player-view est en VRAI plein ecran (requestFullscreen, cf.
    // playStream) : cette modale est un element FRERE de #player-view, pas
    // un descendant — sur certains moteurs, tout ce qui n'est pas dans
    // l'element mis en plein ecran reste invisible/inerte tant qu'on n'en
    // est pas sorti. On sort donc du plein ecran avant de l'afficher.
    exitFullscreenIfActive();
    exitPlayerDialogOpen = true;
    exitPlayerDialogFocusIndex = 0;
    updateExitPlayerDialogFocus();
    document.getElementById('exit-player-dialog').classList.add('visible');
}

function closeExitPlayerDialog() {
    exitPlayerDialogOpen = false;
    document.getElementById('exit-player-dialog').classList.remove('visible');
}

function updateExitPlayerDialogFocus() {
    document.getElementById('exit-player-pip-btn').classList.toggle('focused', exitPlayerDialogFocusIndex === 0);
    document.getElementById('exit-player-exit-btn').classList.toggle('focused', exitPlayerDialogFocusIndex === 1);
}

function handleExitPlayerDialogKey(keyCode) {
    if (keyCode === 37 || keyCode === 39 || keyCode === 38 || keyCode === 40) {
        exitPlayerDialogFocusIndex = exitPlayerDialogFocusIndex === 0 ? 1 : 0;
        updateExitPlayerDialogFocus();
    } else if (keyCode === 13) {
        closeExitPlayerDialog();
        if (exitPlayerDialogFocusIndex === 0) enterMiniPlayer();
        else stopAndExitPlayer();
    } else if (keyCode === 10009 || keyCode === 8) {
        // Retour : annule, reste sur la lecture. On avait quitte le vrai
        // plein ecran pour afficher cette modale (cf. openExitPlayerDialog) :
        // on y retourne puisque la lecture continue.
        closeExitPlayerDialog();
        showPlayerControls();
        requestPlayerFullscreen();
    }
}

// ---------------------------------------------------------------
// Modale de confirmation avant de quitter l'application (Retour sur
// l'accueil) : evite une sortie involontaire (appui accidentel, telecommande
// qui traine dans une poche...). "Annuler" est focus par defaut — une
// confirmation de sortie ne doit jamais pre-selectionner l'action
// destructive, sinon un double-appui reflexe quitte quand meme l'app.
// ---------------------------------------------------------------
let exitAppDialogOpen = false;
let exitAppDialogFocusIndex = 0; // 0 = Annuler, 1 = Quitter

function openExitAppDialog() {
    exitAppDialogOpen = true;
    exitAppDialogFocusIndex = 0;
    updateExitAppDialogFocus();
    document.getElementById('exit-app-dialog').classList.add('visible');
}

function closeExitAppDialog() {
    exitAppDialogOpen = false;
    document.getElementById('exit-app-dialog').classList.remove('visible');
}

function updateExitAppDialogFocus() {
    document.getElementById('exit-app-cancel-btn').classList.toggle('focused', exitAppDialogFocusIndex === 0);
    document.getElementById('exit-app-confirm-btn').classList.toggle('focused', exitAppDialogFocusIndex === 1);
}

function handleExitAppDialogKey(keyCode) {
    if (keyCode === 37 || keyCode === 39 || keyCode === 38 || keyCode === 40) {
        exitAppDialogFocusIndex = exitAppDialogFocusIndex === 0 ? 1 : 0;
        updateExitAppDialogFocus();
    } else if (keyCode === 13) {
        closeExitAppDialog();
        if (exitAppDialogFocusIndex === 1 && typeof tizen !== 'undefined' && tizen.application) {
            try { tizen.application.getCurrentApplication().exit(); } catch (e) {}
        }
    } else if (keyCode === 10009 || keyCode === 8) {
        // Retour sur la modale elle-meme : annule, comme "Annuler".
        closeExitAppDialog();
    }
}

function handleSettingsModalKey(keyCode) {
    if (keyCode === 38) { // Haut
        if (settingsZone === 'nav') {
            if (settingsNavIndex > 0) { settingsNavIndex--; onSettingsNavMove(); }
        } else if (settingsContentIndex > 0) {
            settingsContentIndex--;
            updateSettingsContentFocus();
        }
    } else if (keyCode === 40) { // Bas
        if (settingsZone === 'nav') {
            if (settingsNavIndex < SETTINGS_SIDEBAR_ITEMS.length - 1) { settingsNavIndex++; onSettingsNavMove(); }
        } else {
            const focusables = getSettingsPanelFocusables();
            if (settingsContentIndex < focusables.length - 1) { settingsContentIndex++; updateSettingsContentFocus(); }
        }
    } else if (keyCode === 37) { // Gauche : retour vers la sidebar, ou valeur precedente sur une ligne cyclique
        if (settingsZone === 'content') {
            const el = getSettingsPanelFocusables()[settingsContentIndex];
            if (el && el.dataset.cycle) {
                cycleSettingsValue(el.dataset.cycle, -1);
            } else {
                settingsZone = 'nav';
                updateSettingsNavFocus();
                updateSettingsContentFocus();
            }
        }
    } else if (keyCode === 39) { // Droite : entre dans le panneau (ou declenche l'action), ou valeur suivante sur une ligne cyclique
        if (settingsZone === 'nav') {
            enterSettingsNavItem();
        } else {
            const el = getSettingsPanelFocusables()[settingsContentIndex];
            if (el && el.dataset.cycle) cycleSettingsValue(el.dataset.cycle, 1);
        }
    } else if (keyCode === 13) { // OK
        if (settingsZone === 'nav') {
            enterSettingsNavItem();
        } else {
            activateSettingsFocusable(getSettingsPanelFocusables()[settingsContentIndex]);
        }
    } else if (keyCode === 10009 || keyCode === 8) { // Retour : remonte a la sidebar, puis ferme
        if (settingsZone === 'content') {
            settingsZone = 'nav';
            updateSettingsNavFocus();
            updateSettingsContentFocus();
        } else {
            closeSettingsModal();
        }
    }
}

