// ---------------------------------------------------------------
// browse.js : navigation Films/Series/Direct/Rediffusion/Favoris — sidebar
// de categories, rail d'affiches ou liste de chaines + panneau EPG,
// synopsis, drill-down series -> saisons -> episodes, recherche. Cf.
// app-shell.js pour le principe general du decoupage en plusieurs fichiers.
// ---------------------------------------------------------------

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
let favSubFocus = 'star'; // 'star' | 'watched' | 'remove' : sous-focus de la zone 'fav' (cf. getFavZoneOptions)
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
        // "Recemment consultes" faisait doublon avec "Continuer a regarder"
        // (tout contenu entame apparaissait dans les deux) : un seul suffit
        // pour Films/Series. Le Direct n'a pas de progression trackee sur un
        // flux live, donc pas de "Continuer a regarder" — il garde son seul
        // historique possible.
        systemCats.push({ id: '__continue__', name: 'Continuer à regarder', system: true, count: getContinueWatchingList(browseSectionKey).length });
    } else {
        systemCats.push({ id: '__recent__', name: 'Récemment consultés', system: true, count: getGroupedRecentList(browseSectionKey).length });
    }
    systemCats.push(
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
        row.innerHTML = `<span class="cat-name">${escapeHtml(cat.name)}</span>${countHtml}`;
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
        const imgHtml = item.logo ? `<img src="${escapeHtml(item.logo)}" loading="lazy" decoding="async" onerror="this.remove()">` : `<div class="rail-poster-fallback">${escapeHtml(item.name)}</div>`;
        const badgeHtml = item.badge ? `<div class="rail-poster-badge">${escapeHtml(item.badge)}</div>` : '';
        const progress = getProgress(sectionKey, item);
        const progressHtml = (progress && !progress.done && progress.duration)
            ? `<div class="rail-poster-progress"><div class="rail-poster-progress-fill" style="width:${Math.min(100, progress.position / progress.duration * 100).toFixed(1)}%"></div></div>`
            : '';
        el.innerHTML = `${imgHtml}${badgeHtml}<div class="rail-poster-icons"><span class="rail-poster-fav-icon">★</span><span class="rail-poster-watched-icon">✓</span></div>${progressHtml}<div class="rail-poster-title">${escapeHtml(item.name)}</div>`;
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
        const imgHtml = item.logo ? `<img src="${escapeHtml(item.logo)}" loading="lazy" decoding="async" onerror="this.remove()">` : `<div class="live-channel-fallback"></div>`;
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

// Affichage immediat, sans reseau : texte simple issu directement des
// donnees Xtream (jamais de photo, l'API IPTV n'en fournit pas). Remplace
// par loadSynopsisCastPhotos si TMDB trouve une correspondance.
function renderSynopsisCast(director, cast) {
    document.getElementById('synopsis-director').innerText = director ? `Réalisateur : ${director}` : '';
    const photosEl = document.getElementById('synopsis-cast-photos');
    photosEl.classList.remove('has-photos');
    photosEl.innerText = cast ? `Cast : ${cast}` : '';
}

// Tente d'enrichir la ligne de cast avec de vraies photos via TMDB (cf.
// fetchTmdbCast) : le panel IPTV ne fournit que des noms en texte. myToken
// (capture par l'appelant via synopsisToken) evite d'afficher un resultat
// perime si l'utilisateur a deja survole un autre poster entre-temps.
async function loadSynopsisCastPhotos(myToken, mediaType, title, year, hasCastText) {
    if (!hasCastText || !title) return;
    const people = await fetchTmdbCast(mediaType, title, year);
    if (myToken !== synopsisToken) return; // selection plus recente entre-temps
    if (!people || !people.length) return; // pas de correspondance : on garde le texte simple

    const photosEl = document.getElementById('synopsis-cast-photos');
    photosEl.classList.add('has-photos');
    photosEl.innerHTML = people.map(p => `
        <div class="cast-person">
            ${p.photo ? `<img src="${escapeHtml(p.photo)}" loading="lazy" decoding="async" onerror="this.parentElement.classList.add('no-photo')">` : ''}
            <span>${escapeHtml(p.name)}</span>
        </div>
    `).join('');
}

function clearSynopsisPanel() {
    synopsisToken++;
    document.getElementById('synopsis-title').innerText = '—';
    document.getElementById('synopsis-meta').innerHTML = '';
    document.getElementById('synopsis-text').innerText = '';
    document.getElementById('synopsis-director').innerText = '';
    document.getElementById('synopsis-cast-photos').innerText = '';
    document.getElementById('synopsis-cast-photos').classList.remove('has-photos');
    setBackdrop(null);
    updateSynopsisFavButton(null);
    updateSynopsisWatchedButton(null);
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

// "Vu" ne s'applique qu'a un contenu individuellement lisible (un film, un
// episode) : pas a une fiche serie/saison (qui ne represente rien de
// regardable en soi) ni a une chaine live (regarder du direct n'a pas de
// fin a "terminer").
function isItemWatchable(item) {
    if (!item || !item.url) return false;
    if (item.kind === 'series' || item.kind === 'season' || item.kind === 'recentSeriesGroup') return false;
    const sectionKey = item._section || browseSectionKey;
    return sectionKey === 'movies' || sectionKey === 'series';
}

// Reflete l'etat vu/non-vu de l'item affiche sur le bouton du synopsis
function updateSynopsisWatchedButton(item) {
    const btn = document.getElementById('synopsis-watched-btn');
    const label = document.getElementById('synopsis-watched-label');
    if (!isItemWatchable(item)) {
        btn.style.display = 'none';
        return;
    }
    btn.style.display = '';
    const watched = isItemWatched(item._section || browseSectionKey, item);
    btn.classList.toggle('is-watched', watched);
    label.innerText = watched ? 'Vu' : 'Marquer comme vu';
}

// Options de sous-focus disponibles dans la zone 'fav' pour l'item
// actuellement en surbrillance dans le rail, dans l'ordre de navigation
// Gauche/Droite (cf. handleUp/Down/Left/Right/Enter) : etoile (favori,
// seulement si la liste entiere est favorisable), vu (seulement pour un
// contenu individuellement lisible, cf. isItemWatchable — peut s'appliquer
// meme quand l'etoile ne s'applique pas, ex. un episode), suppression
// (seulement dans "Recemment consultes").
function getFavZoneOptions() {
    const opts = [];
    if (railFavoritable) opts.push('star');
    if (isItemWatchable(railList[railIndex])) opts.push('watched');
    if (railIsRecentList) opts.push('remove');
    return opts;
}

function updateFavButtonFocus() {
    const inFav = browseFocusZone === 'fav';
    document.getElementById('synopsis-fav-btn').classList.toggle('focused', inFav && favSubFocus === 'star');
    document.getElementById('synopsis-watched-btn').classList.toggle('focused', inFav && favSubFocus === 'watched');
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
    document.getElementById('synopsis-director').innerText = '';
    document.getElementById('synopsis-cast-photos').innerText = '';
    document.getElementById('synopsis-cast-photos').classList.remove('has-photos');
    setBackdrop(item.logo);
    updateSynopsisFavButton(item);
    updateSynopsisWatchedButton(item);

    if (item.kind === 'series' || item.plot) {
        const year = (item.releaseDate || '').toString().slice(0, 4);
        renderSynopsisMeta({
            rating: item.rating,
            rating5: item.rating5,
            year,
            genre: item.genre,
            duration: item.episodeRunTime ? `${item.episodeRunTime} min/ép.` : ''
        });
        document.getElementById('synopsis-text').innerText = item.plot || '';
        renderSynopsisCast(item.director, item.cast);
        if (item.kind === 'series') loadSynopsisCastPhotos(myToken, 'tv', item.name, year, !!item.cast);
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
    const year = (info.releasedate || info.release_date || '').toString().slice(0, 4);
    renderSynopsisMeta({
        rating: info.rating || item.rating,
        rating5: info.rating_5based || item.rating5,
        year,
        genre: info.genre,
        duration: info.duration || (info.duration_secs ? formatTime(info.duration_secs) : ''),
        country: info.country,
        age: info.age || info.mpaa_rating
    });
    document.getElementById('synopsis-text').innerText = info.plot || info.description || '';
    renderSynopsisCast(info.director, info.cast);
    loadSynopsisCastPhotos(myToken, 'movie', item.name, year, !!info.cast);
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

// Construit les items episodes d'une saison a partir des donnees brutes de
// get_series_info (cf. loadSeriesInfo). Partage par openSeasonEpisodes
// (navigation normale saison -> episodes) et buildSeasonZapList (recharge la
// saison pour le tiroir du player quand un episode est lance hors de ce
// contexte, ex. depuis "Continuer a regarder").
function mapSeasonEpisodes(episodesRaw, { seriesId, seasonNum, seriesName, logo }) {
    const cfg = sectionConfig.series;
    const { serverUrl, username, password, allowedFormats } = window.iptvServerConfig;
    return episodesRaw.map(ep => {
        const ext = resolveExtension(ep, cfg, allowedFormats);
        return {
            kind: 'stream',
            name: ep.title || `Épisode ${ep.episode_num}`,
            url: `${serverUrl}/series/${username}/${password}/${ep.id}.${ext}`,
            logo,
            badge: `S${seasonNum}E${ep.episode_num}`,
            seriesId,
            seasonNum,
            seriesName
        };
    });
}

// Reconstruit la liste des episodes de la saison d'un episode donne (a
// partir de son seriesId/seasonNum, cf. mapSeasonEpisodes) : utilise pour le
// tiroir "episode suivant" du player quand cet episode est lance hors du
// contexte normal saison -> episodes (ex. "Continuer a regarder", qui
// melange des contenus de series differentes) — sans ça, "episode suivant"
// proposait une autre serie entamee au hasard plutot que la suite logique.
// null si l'item n'est pas un episode identifiable (film, chaine live,
// ou entree sauvegardee avant l'ajout de seasonNum).
async function buildSeasonZapList(item) {
    if (!item || !item.seriesId || item.seasonNum === undefined || item.seasonNum === null) return null;
    const data = await loadSeriesInfo(item.seriesId);
    const episodesOfSeason = (data.episodes || {})[item.seasonNum] || [];
    if (!episodesOfSeason.length) return null;
    return mapSeasonEpisodes(episodesOfSeason, {
        seriesId: item.seriesId,
        seasonNum: item.seasonNum,
        seriesName: item.seriesName,
        logo: item.logo
    });
}

// Ouvre les episodes d'une saison donnee (donnees deja en cache depuis openSeriesSeasons)
async function openSeasonEpisodes(season) {
    const data = await loadSeriesInfo(season.seriesId);
    const episodesOfSeason = (data.episodes || {})[season.seasonNum] || [];
    const episodes = mapSeasonEpisodes(episodesOfSeason, {
        seriesId: season.seriesId,
        seasonNum: season.seasonNum,
        seriesName: season.seriesName,
        logo: season.logo || season.seriesLogo
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

    // Un episode lance hors du contexte normal saison -> episodes (ex.
    // "Continuer a regarder", qui melange des contenus de series
    // differentes) doit proposer la suite de SA saison dans le tiroir
    // "episode suivant" du player, pas les autres series entamees (railList
    // ci-dessus, garde comme repli immediat). Recharge en arriere-plan pour
    // ne pas retarder le lancement de la lecture.
    if (item.seriesId && item.seasonNum !== undefined && item.seasonNum !== null) {
        buildSeasonZapList(item).then(seasonList => {
            if (!seasonList) return;
            // Le contexte a pu changer entre-temps (zap vers un autre
            // contenu pendant le chargement) : ne remplace le tiroir que si
            // CET episode est toujours celui en cours de lecture.
            if (!currentPlayItem || currentPlayItem.url !== item.url) return;
            zapList = seasonList;
            zapIndex = zapList.findIndex(it => it.url === item.url);
        });
    }
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

function toggleWatchedOnFocusedRailItem() {
    const item = railList[railIndex];
    if (!isItemWatchable(item)) return;
    const sectionKey = item._section || browseSectionKey;
    const nowWatched = toggleWatched(sectionKey, item);
    const posters = document.querySelectorAll('.rail-poster');
    if (posters[railIndex]) posters[railIndex].classList.toggle('is-watched', nowWatched);
    updateSynopsisWatchedButton(item);
    flashAppToast(nowWatched ? 'Marqué comme vu' : 'Marqué comme non vu');
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

