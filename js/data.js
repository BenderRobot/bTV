// ---------------------------------------------------------------
// data.js : config Xtream Codes, caches memoire/localStorage, appels API
// (categories, contenus, EPG, series/VOD), favoris/recemment consultes,
// progression de lecture, preferences de piste par contenu. Cf. app-shell.js
// pour le principe general du decoupage en plusieurs fichiers.
// ---------------------------------------------------------------

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

// ---------------------------------------------------------------
// Preferences d'affichage (Parametres > Sous-titres / Categories masquees /
// Taille du texte) : purement locales (localStorage), independantes du
// compte IPTV, appliquees par app-shell.js (taille du texte) et player.js
// (sous-titres) ; le filtrage des categories masquees se fait dans
// browse.js (renderSidebarCategories).
// ---------------------------------------------------------------
const SUBTITLE_PREFS_KEY = 'iptv_subtitle_prefs';
const SUBTITLE_FONT_OPTIONS = ['Segoe UI', 'Arial', 'Verdana', 'Georgia', 'Courier New'];
const SUBTITLE_COLOR_OPTIONS = [
    { label: 'Blanc', value: '#ffffff' },
    { label: 'Jaune', value: '#ffe14d' },
    { label: 'Cyan', value: '#4dd8ff' },
    { label: 'Vert', value: '#4cda3e' }
];
const SUBTITLE_BG_OPTIONS = [
    { label: 'Semi-transparent', value: 'rgba(0,0,0,0.6)' },
    { label: 'Opaque', value: 'rgba(0,0,0,0.95)' },
    { label: 'Aucun', value: 'transparent' }
];
// Reglage independant de "Taille du texte" (qui exclut deliberement le
// lecteur, cf. applyTextSize) : sinon impossible d'ajuster les sous-titres
// sans agrandir aussi tout le reste de l'interface.
const SUBTITLE_SIZE_OPTIONS = [
    { label: 'Petite', px: 20 },
    { label: 'Normale', px: 26 },
    { label: 'Grande', px: 32 },
    { label: 'Très grande', px: 38 }
];

function getSubtitlePrefs() {
    const defaults = { fontIndex: 0, colorIndex: 0, bgIndex: 0, sizeIndex: 1 };
    try {
        const stored = JSON.parse(localStorage.getItem(SUBTITLE_PREFS_KEY));
        return stored ? { ...defaults, ...stored } : defaults;
    } catch (e) {
        return defaults;
    }
}

function saveSubtitlePrefs(prefs) {
    try { localStorage.setItem(SUBTITLE_PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
}

const HIDDEN_CATEGORIES_KEY_PREFIX = 'iptv_hidden_categories_';

function getHiddenCategoryIds(sectionKey) {
    try { return JSON.parse(localStorage.getItem(HIDDEN_CATEGORIES_KEY_PREFIX + sectionKey)) || []; } catch (e) { return []; }
}

function isCategoryHidden(sectionKey, catId) {
    return getHiddenCategoryIds(sectionKey).includes(String(catId));
}

// Renvoie le nouvel etat (true = desormais masquee).
function toggleCategoryHidden(sectionKey, catId) {
    const idStr = String(catId);
    let ids = getHiddenCategoryIds(sectionKey);
    const wasHidden = ids.includes(idStr);
    ids = wasHidden ? ids.filter(id => id !== idStr) : [...ids, idStr];
    try { localStorage.setItem(HIDDEN_CATEGORIES_KEY_PREFIX + sectionKey, JSON.stringify(ids)); } catch (e) {}
    return !wasHidden;
}

// TEXT_SIZE_* : deplace dans app-shell.js (cf. applyTextSize), applique des
// le chargement de ce tout premier fichier applicatif — le declarer ici
// (charge plus tard) provoquerait une ReferenceError au demarrage.

// cacheSet, formatTime, escapeHtml, decodeEpgText, resolveExtension et
// buildTimeshiftUrl vivent desormais dans js/utils.js (charge avant ce
// fichier dans index.html) : fonctions pures, testees unitairement sans TV
// ni navigateur (cf. test/utils.test.js).

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
        const { serverUrl, username, password, allowedFormats } = window.iptvServerConfig;
        const cfg = sectionConfig[sectionKey];
        const ext = resolveExtension(raw, cfg, allowedFormats);
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
// Nombre de "grandes" tentatives (en plus des 3 re-essais internes de
// fetchJson a chaque fois) avant d'abandonner et d'afficher une vraie
// erreur. Observe en conditions reelles : un creux serveur peut durer
// bien plus que les ~6s deja couvertes par fetchJson (JSON tronque qui se
// resout tout seul apres plusieurs dizaines de secondes) — sans ce palier,
// l'app affichait "Erreur reseau" pour un simple ralentissement passager,
// laissant croire a l'utilisateur que le serveur ou l'app est en panne
// alors que reessayer plus tard (ou attendre) suffit. Tant qu'il reste des
// tentatives, l'ecran garde "Chargement..." (pas d'erreur affichee) : cf.
// selectCategory, qui n'affiche l'etat vide qu'au retour de []/null ici.
const CATEGORY_OUTER_MAX_ATTEMPTS = 5;
const CATEGORY_OUTER_RETRY_DELAY_MS = 4000;

function abortableDelay(ms, signal) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(resolve, ms);
        if (signal) {
            signal.addEventListener('abort', () => {
                clearTimeout(t);
                reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
            }, { once: true });
        }
    });
}

async function fetchCategoryItems(sectionKey, catId, signal) {
    const cacheKey = `${sectionKey}_${catId}`;
    const kind = sectionKey === 'series' ? 'series' : 'stream';
    if (itemsCache[cacheKey]) return normalizeList(itemsCache[cacheKey], kind, sectionKey);

    const { serverUrl, username, password } = window.iptvServerConfig;
    const action = sectionConfig[sectionKey].streamAction;
    const url = `${serverUrl}/player_api.php?username=${username}&password=${password}&action=${action}&category_id=${catId}`;

    for (let outerAttempt = 0; outerAttempt < CATEGORY_OUTER_MAX_ATTEMPTS; outerAttempt++) {
        const startedAt = performance.now();
        const attemptLabel = `${outerAttempt + 1}/${CATEGORY_OUTER_MAX_ATTEMPTS}`;
        debugLog(`→ Requête catégorie id=${catId} (${sectionKey}) [${attemptLabel}]`);
        try {
            // 3 re-essais internes (1s/2s/3s de delai) par grande tentative :
            // observe en conditions reelles un echec par reponse JSON tronquee
            // ("Unexpected end of JSON input") qui se resolvait tout seul
            // quelques instants plus tard.
            const items = await fetchJson(url, 3, signal);
            const ms = Math.round(performance.now() - startedAt);
            if (!Array.isArray(items)) {
                // Le panel repond parfois par un objet d'erreur (session expiree,
                // trop de requetes recentes...) plutot qu'une liste : pas un
                // creux passager, inutile de reessayer.
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
            const isLastAttempt = outerAttempt === CATEGORY_OUTER_MAX_ATTEMPTS - 1;
            debugLog(`✗ Échec catégorie id=${catId} après ${ms}ms [${attemptLabel}] : ${e.message}`, isLastAttempt ? 'error' : 'warn');
            if (isLastAttempt) {
                console.error('Erreur chargement contenu:', e);
                flashAppToast('Erreur réseau lors du chargement de la catégorie');
                return [];
            }
        }
        try {
            await abortableDelay(CATEGORY_OUTER_RETRY_DELAY_MS, signal);
        } catch (e) {
            debugLog(`⨯ Catégorie id=${catId} annulée pendant l'attente entre tentatives`, 'warn');
            return null;
        }
    }
    return []; // inatteignable en pratique (la derniere iteration renvoie deja []), garde-fou de type
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

    // Meme principe que fetchCategoryItems : un creux serveur peut durer plus
    // longtemps que les re-essais internes de fetchJson, sans etre une
    // vraie panne. On garde l'ecran de chargement (pas d'erreur) tant qu'il
    // reste des tentatives.
    for (let outerAttempt = 0; outerAttempt < CATEGORY_OUTER_MAX_ATTEMPTS; outerAttempt++) {
        try {
            const items = await fetchJson(url, 3);
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
            const isLastAttempt = outerAttempt === CATEGORY_OUTER_MAX_ATTEMPTS - 1;
            if (isLastAttempt) {
                console.error('Erreur chargement complet:', e);
                flashAppToast('Erreur réseau lors du chargement du catalogue');
                return [];
            }
        }
        await abortableDelay(CATEGORY_OUTER_RETRY_DELAY_MS);
    }
    return [];
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
                url: buildTimeshiftUrl(channel.id, ep.start, durationMin, window.iptvServerConfig)
            };
        })
        .filter(item => item.url);
}

// Recupere (et met en cache) le detail complet d'une serie : saisons + episodes.
// forceRefresh : ignore le cache memoire (cf. checkFavoriteSeriesForNewEpisodes,
// qui a justement besoin d'une reponse fraiche pour detecter un episode ajoute
// depuis la derniere consultation de cette serie).
async function loadSeriesInfo(seriesId, forceRefresh) {
    if (!forceRefresh && seriesInfoCache[seriesId]) return seriesInfoCache[seriesId];
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

// ---------------------------------------------------------------
// TMDB (The Movie Database) : l'API Xtream ne fournit les acteurs qu'en
// texte brut (jamais de photo). Enrichissement purement cosmetique du
// synopsis (cf. loadSynopsisCastPhotos) : en cas d'echec (reseau, pas de
// correspondance, quota depasse...), l'app retombe silencieusement sur le
// texte deja affiche, rien ne bloque jamais dessus.
// ---------------------------------------------------------------
// Jeton personnel TMDB (lecture seule, gratuit, revocable sur
// themoviedb.org/settings/api) : une app 100% cote client comme celle-ci,
// sans serveur ni etape de build, n'a pas d'autre endroit ou le garder qu'en
// clair dans le code embarque dans le paquet .wgt.
const TMDB_BEARER_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI4ZjBiMDE5NTU2MjNmNjMyMDhkY2FmZWRjZDBmOWQ1ZCIsIm5iZiI6MTc4ODM2NTQ5Ni40LCJzdWIiOiI2YTk4NGFiODhmMzdjZjlkNmZiZDYwYTQiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.bpuXWvdRn1-qbKMavJJM7bzTq3DIDxpT1dya1VuDZSI';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w185';
const TMDB_CAST_LIMIT = 8;
const tmdbCastCache = {};

// mediaType : 'movie' | 'tv'. Recherche par titre (+annee si connue, pour
// desambiguiser un remake/une serie homonyme), puis recupere le casting du
// premier resultat. Renvoie null si aucune correspondance (garde le texte
// simple deja affiche) plutot que de forcer un affichage vide.
// Les panels Xtream truffent les titres de tags entre crochets/barres
// ("|FR| The Whisper Man", "[VOSTFR]", "(MULTI)"...) : envoyes tels quels a
// TMDB, aucune recherche ne matchait jamais, d'ou un cast toujours en texte
// simple malgre l'integration (cf. loadSynopsisCastPhotos).
function cleanTitleForTmdb(name) {
    return (name || '')
        .replace(/\|[^|]*\|/g, ' ')
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/\((?:multi|vost(?:fr)?|vf|vo|4k|hdr10?|dolby ?(?:vision|atmos)?)\)/gi, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

async function fetchTmdbCast(mediaType, rawTitle, year) {
    const title = cleanTitleForTmdb(rawTitle);
    if (!title) return null;
    const cacheKey = `${mediaType}_${title}_${year || ''}`;
    if (cacheKey in tmdbCastCache) return tmdbCastCache[cacheKey];
    try {
        const searchParams = new URLSearchParams({ query: title, language: 'fr-FR' });
        if (year) searchParams.set(mediaType === 'tv' ? 'first_air_date_year' : 'year', year);
        const searchRes = await fetch(`https://api.themoviedb.org/3/search/${mediaType}?${searchParams}`, {
            headers: { Authorization: `Bearer ${TMDB_BEARER_TOKEN}`, accept: 'application/json' }
        });
        const searchData = await searchRes.json();
        const match = (searchData.results || [])[0];
        if (!match) {
            cacheSet(tmdbCastCache, cacheKey, null, 300);
            return null;
        }

        const creditsRes = await fetch(`https://api.themoviedb.org/3/${mediaType}/${match.id}/credits`, {
            headers: { Authorization: `Bearer ${TMDB_BEARER_TOKEN}`, accept: 'application/json' }
        });
        const creditsData = await creditsRes.json();
        const cast = (creditsData.cast || []).slice(0, TMDB_CAST_LIMIT).map(p => ({
            name: p.name,
            photo: p.profile_path ? `${TMDB_IMAGE_BASE}${p.profile_path}` : null
        }));
        cacheSet(tmdbCastCache, cacheKey, cast, 300);
        return cast;
    } catch (e) {
        console.error('Erreur TMDB:', e);
        return null;
    }
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

// ---------------------------------------------------------------
// Nouveaux episodes des series favorites : a chaque demarrage (et sur
// rafraichissement manuel de la playlist), compare le nombre d'episodes de
// chaque serie favorite a l'instantane memorise lors de la PRECEDENTE
// verification — pas au moment de l'ajout aux favoris — pour ne signaler
// que les episodes reellement apparus entre-temps. Une serie qui n'a pas
// encore d'instantane (toute premiere verification, ou serie tout juste
// ajoutee aux favoris) n'est jamais signalee : sinon, activer la fonction
// alerterait immediatement sur tout le catalogue deja favorise.
// ---------------------------------------------------------------
const KNOWN_EPISODES_KEY = 'iptv_known_episodes';
const NEW_EPISODES_KEY = 'iptv_new_episodes';

function getKnownEpisodesMap() {
    try { return JSON.parse(localStorage.getItem(KNOWN_EPISODES_KEY)) || {}; } catch (e) { return {}; }
}

function getNewEpisodesMap() {
    try { return JSON.parse(localStorage.getItem(NEW_EPISODES_KEY)) || {}; } catch (e) { return {}; }
}

function saveNewEpisodesMap(map) {
    try { localStorage.setItem(NEW_EPISODES_KEY, JSON.stringify(map)); } catch (e) {}
}

// Nombre de nouveaux episodes encore non acquittes pour une serie favorite
// (0 si aucun, ou si deja acquittes via acknowledgeNewEpisodes).
function getNewEpisodesCount(seriesId) {
    const ids = getNewEpisodesMap()[seriesId];
    return ids ? ids.length : 0;
}

// Appelee des que l'utilisateur ouvre la fiche saisons d'une serie (cf.
// openSeriesSeasons) : il vient de la voir, inutile de continuer a la
// signaler comme "nouvelle".
function acknowledgeNewEpisodes(seriesId) {
    const map = getNewEpisodesMap();
    if (map[seriesId]) {
        delete map[seriesId];
        saveNewEpisodesMap(map);
    }
}

// Sequentiel (pas Promise.all) : eviter une rafale de requetes simultanees
// vers des panels IPTV bon marche deja sensibles a la charge (cf. fetchJson
// plus haut) — un peu plus lent si beaucoup de series sont favorites, mais
// ça tourne en arriere-plan sans bloquer l'interface (cf. appelants).
async function checkFavoriteSeriesForNewEpisodes() {
    const favorites = getFavoritesList('series');
    if (!favorites.length) return [];

    const knownMap = getKnownEpisodesMap();
    const newMap = getNewEpisodesMap();
    const newlyFound = [];

    for (const fav of favorites) {
        let info;
        try {
            info = await loadSeriesInfo(fav.id, true);
        } catch (e) {
            continue;
        }
        const episodeIds = Object.values(info.episodes || {}).flat().map(ep => String(ep.id));
        if (!episodeIds.length) continue;

        const known = knownMap[fav.id];
        if (known) {
            const newIds = episodeIds.filter(id => !known.includes(id));
            if (newIds.length) {
                newMap[fav.id] = newIds;
                newlyFound.push({ id: fav.id, name: fav.name, count: newIds.length });
            }
        }
        knownMap[fav.id] = episodeIds;
    }

    try { localStorage.setItem(KNOWN_EPISODES_KEY, JSON.stringify(knownMap)); } catch (e) {}
    saveNewEpisodesMap(newMap);
    return newlyFound;
}

// Point d'entree unique pour les appelants (splash de demarrage,
// rafraichissement manuel de la playlist) : lance la verification et
// affiche un toast si de nouveaux episodes sont trouves. Volontairement non
// awaite par ses appelants (fire-and-forget) pour ne jamais retarder
// l'affichage de l'accueil.
async function notifyNewFavoriteEpisodes() {
    let newlyFound;
    try {
        newlyFound = await checkFavoriteSeriesForNewEpisodes();
    } catch (e) {
        console.error('Erreur verification nouveaux episodes (favoris):', e);
        return;
    }
    if (!newlyFound.length) return;
    const names = newlyFound.map(s => s.name);
    const shown = names.slice(0, 3).join(', ');
    const extra = names.length > 3 ? ` et ${names.length - 3} autre(s)` : '';
    flashAppToast(`Nouveaux épisodes disponibles : ${shown}${extra}`);
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

// Regroupement (algorithme pur) dans js/utils.js (cf. groupRecentList,
// teste unitairement) ; ce wrapper se contente d'y injecter la liste reelle
// depuis localStorage.
function getGroupedRecentList(sectionKey) {
    return groupRecentList(getRecentList(sectionKey), sectionKey);
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
    // Une fiche saison n'a pas d'URL propre (getProgress ne peut donc rien
    // trouver pour elle) : son statut "vu" vient d'un precalcul fait au
    // moment de construire la liste des saisons, cf. openSeriesSeasons.
    if (item && item.kind === 'season') return !!item._allEpisodesWatched;
    const p = getProgress(sectionKey, item);
    return !!(p && p.done);
}

// Marquage manuel vu/non vu (independant de la position reelle de lecture,
// contrairement a saveProgress) : renvoie le nouvel etat. Marquer comme non
// vu supprime completement l'entree plutot que de la garder a position 0,
// pour ne pas la faire ressortir dans "Continuer a regarder".
function toggleWatched(sectionKey, item) {
    if (!item || !item.url) return false;
    const map = getProgressMap(sectionKey);
    const wasWatched = !!(map[item.url] && map[item.url].done);
    if (wasWatched) {
        delete map[item.url];
    } else {
        map[item.url] = { ...item, position: 0, duration: (map[item.url] && map[item.url].duration) || 0, done: true, updatedAt: Date.now() };
    }
    saveProgressMap(sectionKey, map);
    return !wasWatched;
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

