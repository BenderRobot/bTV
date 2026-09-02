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

