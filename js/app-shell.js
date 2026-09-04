// ---------------------------------------------------------------
// bTV — decoupage "leger" de l'ancien main.js monolithique (3400 lignes) en
// plusieurs fichiers thematiques, tous charges en <script> classiques, dans
// le MEME ordre qu'avant (cf. index.html) : aucun systeme de module, aucun
// changement de comportement, juste une reorganisation mecanique pour la
// navigabilite. Toutes les fonctions/variables restent globales et
// librement partagees entre ces fichiers, exactement comme si tout etait
// encore dans un seul fichier — donc pas de import/export a maintenir, mais
// aussi pas de garde-fou ESLint (no-undef) sur les references d'un fichier
// a l'autre (cf. eslint.config.js).
//
// Ordre de chargement (cf. index.html) :
//   utils.js (fonctions pures) -> app-shell.js -> modals.js -> data.js
//   -> browse.js -> input.js -> player.js -> bootstrap.js
// ---------------------------------------------------------------

// ---------------------------------------------------------------
// app-shell.js : etat de navigation racine (login/accueil/browse/player),
// toasts, filet de securite (erreurs JS non interceptees), theme
// clair/sombre, tableau de bord d'accueil.
// ---------------------------------------------------------------

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
// Simple deplacement du curseur (surbrillance CSS) : n'appelle PAS el.focus()
// sur le champ courant, sinon le clavier virtuel Samsung s'ouvrait des qu'on
// se deplaçait sur un champ, avant meme d'avoir appuye sur OK. L'ouverture
// reelle du clavier reste le fait de handleEnter uniquement.
function updateLoginFocus() {
    loginElements.forEach((el, idx) => {
        if (idx === loginFocusIndex) {
            el.classList.add('focused');
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

// Filet de securite : sans ça, une exception imprevue n'importe ou dans
// l'app casse silencieusement la navigation (aucun retour visuel, aucune
// trace) — la classe de bug la plus dure a diagnostiquer sur une TV sans
// console branchee. debugLog garde toujours une trace (meme panneau ferme,
// cf. plus bas) et un toast throttle evite qu'une boucle d'erreurs repetees
// ne spamme l'ecran en continu.
let lastCrashToastAt = 0;
function reportUncaughtError(label, message, detail) {
    console.error(label, detail);
    if (typeof debugLog === 'function') debugLog(`✗ ${label} : ${message}`, 'error');
    const now = Date.now();
    if (now - lastCrashToastAt > 5000) {
        lastCrashToastAt = now;
        flashAppToast('Erreur inattendue — voir le journal de debug (Paramètres)');
    }
}

window.addEventListener('error', function (e) {
    reportUncaughtError('Erreur JS non interceptée', `${e.message} (${e.filename}:${e.lineno})`, e.error || e.message);
});

window.addEventListener('unhandledrejection', function (e) {
    const reason = e.reason;
    reportUncaughtError('Promesse rejetée non interceptée', (reason && reason.message) || String(reason), reason);
});

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
    updateSettingsThemeButtonLabel();
}

function updateSettingsThemeButtonLabel() {
    const el = document.getElementById('settings-theme-state');
    if (el) el.innerText = document.body.classList.contains('theme-light') ? 'Clair' : 'Sombre';
}

applyStoredTheme();

// ---------------------------------------------------------------
// Taille du texte (Parametres > Taille du texte) : applique un zoom CSS a
// toute l'app (hors lecteur video, cf. plus bas) puisque l'integralite du
// CSS existant utilise des tailles en px et non des unites relatives —
// reecrire chaque regle en rem serait un chantier a part entiere. zoom
// scale donc aussi la mise en page, pas seulement le texte, mais reste la
// seule option realiste sans ce chantier. Declare ici (et non dans data.js,
// charge plus tard) car applique des le demarrage de ce tout premier
// fichier applicatif.
// ---------------------------------------------------------------
const TEXT_SIZE_KEY = 'iptv_text_size';
const TEXT_SIZE_OPTIONS = [
    { label: 'Petite', zoom: 0.85 },
    { label: 'Normale', zoom: 1 },
    { label: 'Grande', zoom: 1.15 },
    { label: 'Très grande', zoom: 1.3 }
];

function getTextSizeIndex() {
    try {
        const idx = parseInt(localStorage.getItem(TEXT_SIZE_KEY), 10);
        return Number.isInteger(idx) && TEXT_SIZE_OPTIONS[idx] ? idx : 1;
    } catch (e) {
        return 1;
    }
}

function saveTextSizeIndex(idx) {
    try { localStorage.setItem(TEXT_SIZE_KEY, String(idx)); } catch (e) {}
}

function applyTextSize(idx) {
    const option = TEXT_SIZE_OPTIONS[idx] || TEXT_SIZE_OPTIONS[1];
    // #app-scale-root est un canevas fixe 1920x1080 (cf. css/style.css) :
    // zoomer sans compenser sa taille de base ferait deborder de l'ecran
    // reel (zoom > 1) ou laisser des marges (zoom < 1). On recalcule donc sa
    // taille pour qu'une fois le zoom applique, le rendu fasse TOUJOURS
    // exactement 1920x1080 — seule la mise en page interne (vues, modales,
    // tout en px fixes) devient proportionnellement plus grande ou petite.
    const root = document.getElementById('app-scale-root');
    if (root) {
        root.style.width = (1920 / option.zoom) + 'px';
        root.style.height = (1080 / option.zoom) + 'px';
        root.style.zoom = option.zoom;
    }
    // Contre-zoom sur le lecteur plein ecran : "hors lecteur video" doit
    // rester vrai, sinon la video/OSD (dimensionnes en vw/vh/100%) serait
    // affectee par le zoom du canevas qui la contient. Le mini-lecteur, lui,
    // est hors de #app-scale-root (cf. index.html) : deja intact, pas de
    // contre-zoom a lui appliquer.
    const playerViewEl = document.getElementById('player-view');
    if (playerViewEl) playerViewEl.style.zoom = 1 / option.zoom;
}

applyTextSize(getTextSizeIndex());

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
    notifyNewFavoriteEpisodes(); // fire-and-forget, affichera son propre toast si besoin
}

