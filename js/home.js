/* TV home: native D-pad navigation stays in input.js; data stays in data.js. */
(function () {
    'use strict';
    const row = document.getElementById('home-continue-row');
    const section = document.getElementById('home-continue');
    let entries = [], index = 0, selectedKey = null, returnToContinue = false;
    function layout() {
        const root = document.getElementById('app-scale-root');
        document.getElementById('home-view').classList.toggle('home-compact', root.clientHeight < 900);
        document.getElementById('home-view').classList.toggle('home-with-mini', miniPlayerActive);
        if (section.hidden || currentView !== 'home') return;
        const height = Math.max(80, Math.min(324, row.clientHeight - 82));
        row.style.setProperty('--home-poster-height', height + 'px');
        row.style.setProperty('--home-poster-width', Math.round(height * 2 / 3) + 'px');
    }
    function imageUrl(value) {
        try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : 'icon.png'; }
        catch (_) { return 'icon.png'; }
    }
    function focus() {
        const active = homeZone === 'continue' && !miniPlayerFocused;
        row.querySelectorAll('.home-poster').forEach((card, i) => {
            const selected = active && i === index;
            card.classList.toggle('focused', selected);
            card.setAttribute('aria-selected', String(selected));
            card.tabIndex = selected ? 0 : -1;
        });
        if (active && entries[index]) {
            selectedKey = entries[index].key;
            const card = row.children[index];
            // Scroll this rail only; scrollIntoView can move the entire TV canvas.
            const left = card.offsetLeft - row.offsetLeft;
            if (left < row.scrollLeft + 8) row.scrollLeft = Math.max(0, left - 8);
            else if (left + card.offsetWidth > row.scrollLeft + row.clientWidth - 8) row.scrollLeft = left + card.offsetWidth - row.clientWidth + 8;
        }
    }
    function open() {
        const item = entries[index];
        if (!item || !window.BtvActivation.requireAccess()) return;
        if (!BtvHomeModel.currentAccount(item, item.section, window.iptvServerConfig)) { render(); return; }
        selectedKey = item.key;
        browseSectionKey = item.section;
        railList = entries.filter(entry => entry.section === item.section);
        document.getElementById('rail-title').textContent = 'Continuer à regarder';
        playRailItem(item);
    }
    function render() {
        document.getElementById('home-greeting').textContent = BtvHomeModel.greeting(new Date().getHours());
        entries = BtvHomeModel.continueItems({ movies: getProgressMap('movies'), series: getProgressMap('series'), replay: getProgressMap('replay') }, getRecentList('live'), window.iptvServerConfig);
        const restored = entries.findIndex(item => item.key === selectedKey);
        index = restored >= 0 ? restored : Math.max(0, Math.min(index, entries.length - 1));
        row.textContent = '';
        entries.forEach((item, i) => {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'home-poster' + (item.section === 'live' ? ' home-poster-channel' : '');
            card.setAttribute('role', 'option');
            const art = document.createElement('span'); art.className = 'home-poster-art';
            const image = document.createElement('img'); image.alt = ''; image.src = imageUrl(item.seriesLogo || item.logo); image.loading = 'lazy';
            image.addEventListener('error', () => { if (!image.src.endsWith('/icon.png')) image.src = 'icon.png'; }, { once: true });
            art.appendChild(image);
            if (item.progress !== null) {
                const track = document.createElement('span'); track.className = 'home-poster-progress';
                const bar = document.createElement('span'); bar.style.width = (item.progress * 100) + '%'; track.appendChild(bar); art.appendChild(track);
            }
            const title = document.createElement('span'); title.className = 'home-poster-title'; title.textContent = item.seriesName || item.name || 'Sans titre';
            const subtitle = document.createElement('span'); subtitle.className = 'home-poster-subtitle'; subtitle.textContent = item.section === 'live' ? 'En direct' : item.seriesName ? item.name : 'Reprendre à ' + formatTime(item.position);
            card.appendChild(art); card.appendChild(title); card.appendChild(subtitle);
            card.addEventListener('click', () => { homeZone = 'continue'; index = i; updateHomeFocus(); open(); });
            row.appendChild(card);
        });
        section.hidden = !entries.length;
        document.getElementById('home-empty').hidden = !!entries.length;
        if (homeZone === 'continue' && !entries.length) homeZone = 'menu';
        layout();
        focus();
    }
    window.BtvHome = {
        render, focus, open, layout,
        remember() { returnToContinue = true; },
        hasContinue: () => entries.length > 0,
        move(step) { index = Math.max(0, Math.min(entries.length - 1, index + step)); focus(); },
        restore() { const restore = returnToContinue; returnToContinue = false; return restore && entries.length > 0; }
    };
    window.addEventListener('resize', () => { layout(); focus(); });
    document.querySelectorAll('.home-btn').forEach((card, i) => {
        card.addEventListener('click', () => { if (!window.BtvActivation.requireAccess()) return; homeZone = 'menu'; homeIndex = i; updateHomeFocus(); activateHomeSelection(); });
    });
    document.querySelectorAll('.home-icon').forEach((button, i) => {
        button.addEventListener('click', () => { if (!window.BtvActivation.requireAccess()) return; homeZone = 'header'; headerIndex = i; updateHomeFocus(); activateHomeSelection(); });
    });
}());
