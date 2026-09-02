// ---------------------------------------------------------------
// Fonctions pures, sans dependance au DOM/Tizen, pour pouvoir etre testees
// unitairement (cf. test/utils.test.js) sans TV ni navigateur. Chargees en
// <script> classique (pas de module ES, pour rester compatible avec le
// WebKit Tizen sans certitude sur son support) : ces fonctions restent
// globales pour le reste de l'app (cf. app-shell.js et suivants dans
// index.html), exactement comme si elles y etaient encore definies, du
// moment que ce fichier est charge en premier.
// ---------------------------------------------------------------

function formatTime(totalSeconds) {
    const sec = Math.max(0, Math.floor(totalSeconds || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = n => n.toString().padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// Echappe aussi les guillemets (pas seulement &<>) : utilise a la fois pour
// du texte et pour des attributs (ex. src="${escapeHtml(item.logo)}"), un
// nom/URL renvoye par le panel IPTV n'etant pas une donnee de confiance.
function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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

// Résout l'extension du flux VOD/série. Beaucoup de panels Xtream ne
// renvoient pas un conteneur lisible nativement par <video> (mkv/avi) ;
// quand le compte autorise la sortie HLS, on la préfère (remux serveur).
// Conteneurs que <video>/hls.js savent lire directement, sans transcodage.
const WEB_SAFE_EXTENSIONS = ['mp4', 'm3u8', 'ts', 'webm', 'm4v'];

// allowedFormats : formats de sortie autorises par le compte
// (window.iptvServerConfig.allowedFormats cote app) — passe explicitement
// par l'appelant plutot que lu depuis une globale, pour rester testable
// sans DOM/window.
function resolveExtension(raw, cfg, allowedFormats) {
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
    if ((allowedFormats || []).includes('m3u8')) return 'm3u8';
    return rawExt || cfg.defaultExt;
}

// Construit l'URL de rediffusion. "start" est deja fourni par le panel au
// format local du serveur ("YYYY-MM-DD HH:MM:SS") : on le reformate tel
// quel, sans reinterpreter de fuseau horaire, pour eviter tout decalage.
// serverConfig : { serverUrl, username, password } — passe explicitement
// (au lieu d'etre lu depuis window.iptvServerConfig) pour rester testable.
function buildTimeshiftUrl(streamId, startStr, durationMinutes, serverConfig) {
    const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})/.exec(startStr || '');
    if (!m) return '';
    const { serverUrl, username, password } = serverConfig;
    return `${serverUrl}/timeshift/${username}/${password}/${durationMinutes}/${m[1]}:${m[2]}-${m[3]}/${streamId}.ts`;
}

// Regroupe les episodes recemment consultes d'une meme serie sous une seule
// "affiche" (sinon 15 episodes de la meme serie vus recemment produisent 15
// entrees identiques dans l'historique). "list" est deja triee du plus
// recent au plus ancien (cf. trackRecent), donc le premier episode
// rencontre pour une serie donnee est bien le dernier regarde — c'est lui
// qui represente le groupe.
function groupRecentList(list, sectionKey) {
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

// Rend ces fonctions requerables depuis Node (tests) sans rien changer a
// leur usage en globales dans le navigateur.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { formatTime, escapeHtml, decodeEpgText, cacheSet, resolveExtension, WEB_SAFE_EXTENSIONS, buildTimeshiftUrl, groupRecentList };
}
