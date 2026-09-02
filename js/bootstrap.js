// ---------------------------------------------------------------
// bootstrap.js : authentification Xtream Codes, auto-login au demarrage
// (avec retry sur echec reseau transitoire), deconnexion, rendu initial des
// icones. Dernier fichier charge : ne fait que consommer ce que les autres
// ont deja defini. Cf. app-shell.js pour le principe general du decoupage
// en plusieurs fichiers.
// ---------------------------------------------------------------

// Authentification Xtream Codes via l'API JSON (léger, pas de M3U brut).
// options.silent : utilisé par l'auto-login au démarrage (cf. attemptAutoLogin)
// pour laisser l'appelant décider quoi faire de l'échec (retry, abandon) au
// lieu d'afficher un message pour une tentative que l'utilisateur n'a pas
// initiée lui-même. Un échec "permanent" (identifiants refusés) est marqué
// via err.permanent pour ne jamais être re-tenté silencieusement.
async function connectToIPTV(options) {
    const silent = !!(options && options.silent);
    let serverUrl = document.getElementById('iptv-url').value.trim().replace(/['"]+/g, '');
    const username = document.getElementById('iptv-user').value.trim().replace(/['"]+/g, '');
    const password = document.getElementById('iptv-pass').value.trim().replace(/['"]+/g, '');

    if (serverUrl.endsWith('/')) serverUrl = serverUrl.slice(0, -1);
    if (!serverUrl.startsWith('http://') && !serverUrl.startsWith('https://')) serverUrl = 'http://' + serverUrl;

    const apiUrl = `${serverUrl}/player_api.php?username=${username}&password=${password}`;

    let response;
    try {
        response = await fetch(apiUrl);
    } catch (networkError) {
        // Serveur injoignable : DNS, TLS, connexion refusee, pas de reseau...
        console.error('Serveur IPTV injoignable:', networkError);
        if (silent) throw networkError;
        flashAppToast("Serveur injoignable — vérifiez l'adresse et votre connexion");
        return;
    }

    if (!response.ok) {
        console.error('Erreur HTTP connexion IPTV:', response.status);
        if (silent) throw new Error(`HTTP ${response.status}`);
        flashAppToast(`Erreur du serveur (HTTP ${response.status})`);
        return;
    }

    let data;
    try {
        data = await response.json();
    } catch (parseError) {
        // Reponse OK cote HTTP mais pas du JSON valide : URL pointant vers
        // autre chose qu'un panel Xtream, page d'erreur du serveur, etc.
        console.error('Reponse invalide connexion IPTV:', parseError);
        if (silent) throw parseError;
        flashAppToast('Réponse invalide du serveur — vérifiez l\'URL du serveur');
        return;
    }

    if (!(data.user_info && data.user_info.auth === 1)) {
        console.error('Authentification refusée:', data.user_info);
        const authError = new Error('AUTH_REFUSED');
        authError.permanent = true; // identifiants/abonnement en cause : jamais transitoire, ne pas re-tenter
        if (silent) throw authError;
        flashAppToast('Identifiants invalides ou compte expiré');
        return;
    }

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
}

// Efface les identifiants sauvegardés et revient à l'écran de connexion
function logout() {
    try {
        localStorage.removeItem(CREDENTIALS_KEY);
    } catch (e) {}
    location.reload();
}

// Auto-connexion si des identifiants ont déjà été validés précédemment. Au
// demarrage de la TV, le Wi-Fi peut ne pas encore etre associe (quelques
// secondes apres l'allumage) : un simple echec reseau immediat laisserait
// l'app plantee sur l'ecran de connexion sans explication. On retente donc
// automatiquement plusieurs fois avant d'abandonner — sauf si l'echec est
// permanent (identifiants/abonnement refusés), auquel cas retenter ne
// changerait rien.
const AUTO_LOGIN_MAX_RETRIES = 4;
const AUTO_LOGIN_RETRY_DELAY_MS = 3000;

async function attemptAutoLogin(attempt) {
    attempt = attempt || 0;
    try {
        await connectToIPTV({ silent: true });
    } catch (e) {
        if (e && e.permanent) {
            flashAppToast('Identifiants invalides ou compte expiré');
            return;
        }
        if (attempt >= AUTO_LOGIN_MAX_RETRIES) {
            console.error('Auto-login abandonné après plusieurs tentatives:', e);
            flashAppToast('Connexion automatique impossible — vérifiez le réseau');
            return;
        }
        setTimeout(() => attemptAutoLogin(attempt + 1), AUTO_LOGIN_RETRY_DELAY_MS);
    }
}

(function tryAutoLogin() {
    try {
        const saved = localStorage.getItem(CREDENTIALS_KEY);
        if (!saved) return;
        const creds = JSON.parse(saved);
        document.getElementById('iptv-url').value = creds.serverUrl || '';
        document.getElementById('iptv-user').value = creds.username || '';
        document.getElementById('iptv-pass').value = creds.password || '';
        attemptAutoLogin();
    } catch (e) {
        console.error('Erreur auto-login:', e);
    }
})();

// Rendu initial des icones Lucide (menu, header). Idempotent : sans effet
// sur les icones deja converties, donc sans risque a rappeler ailleurs.
if (window.lucide) lucide.createIcons();
