// ---------------------------------------------------------------
// input.js : dispatch central de la telecommande (Haut/Bas/Gauche/Droite/OK/
// Retour) vers l'ecran actif (login/accueil/browse/player). Point de
// jonction entre tous les autres fichiers puisque chaque ecran y branche sa
// propre logique de navigation. Cf. app-shell.js pour le principe general
// du decoupage en plusieurs fichiers.
// ---------------------------------------------------------------

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

// Relachement de Gauche/Droite : remet a zero l'acceleration de l'avance/
// retour (cf. seekHeld dans player.js) des que la touche n'est plus tenue,
// plutot que d'attendre qu'un eventuel appui suivant soit juge "trop tard"
// pour hériter par erreur d'un pas deja agrandi.
window.addEventListener('keyup', function (e) {
    if (e.keyCode === 37 || e.keyCode === 39) resetSeekHold();
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
            // Un episode reste marquable comme "vu" meme quand il n'est pas
            // favorisable individuellement (cf. getFavZoneOptions) : on ne
            // saute directement vers la recherche que si AUCUNE option
            // (etoile/vu/suppression) ne s'applique a l'item survole.
            const favOpts = getFavZoneOptions();
            browseFocusZone = favOpts.length ? 'fav' : 'search';
            favSubFocus = favOpts[0] || 'star';
            if (!favOpts.length) searchSubFocus = 'input';
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
            const favOpts = getFavZoneOptions();
            browseFocusZone = favOpts.length ? 'fav' : 'rail';
            favSubFocus = favOpts[0] || 'star';
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
            const favOpts = getFavZoneOptions();
            const favIdx = favOpts.indexOf(favSubFocus);
            if (favIdx > 0) {
                favSubFocus = favOpts[favIdx - 1];
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
            seekHeld(-1);
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
            // (Jamais d'option "vu" pour une chaine live, cf. isItemWatchable.)
            const favOpts = getFavZoneOptions();
            browseFocusZone = favOpts.length ? 'fav' : 'search';
            favSubFocus = favOpts[0] || 'star';
            if (!favOpts.length) searchSubFocus = 'input';
            updateRailFocus();
            updateChannelListFocus();
            updateFavButtonFocus();
            updateSearchZoneFocus();
        } else if (browseFocusZone === 'rail' && railIndex < railList.length - 1) {
            railIndex++;
            updateRailFocus();
            updateSynopsisPanel(railList[railIndex]);
        } else if (browseFocusZone === 'fav') {
            const favOpts = getFavZoneOptions();
            const favIdx = favOpts.indexOf(favSubFocus);
            if (favIdx !== -1 && favIdx < favOpts.length - 1) {
                favSubFocus = favOpts[favIdx + 1];
                updateFavButtonFocus();
            }
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
            seekHeld(1);
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
            else if (favSubFocus === 'watched') toggleWatchedOnFocusedRailItem();
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

