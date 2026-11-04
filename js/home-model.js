/* Pure home projection: never write history or reuse another account's URL. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.BtvHomeModel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    function greeting(hour) {
        if (hour >= 5 && hour <= 11) return 'Bonjour !';
        if (hour >= 12 && hour <= 17) return 'Bon après-midi !';
        if (hour >= 18 && hour <= 22) return 'Bonsoir !';
        return 'Encore debout ?';
    }
    function currentAccount(item, section, config) {
        if (!item || typeof item.url !== 'string' || !config || !config.serverUrl || !config.username || !config.password) return false;
        const part = { movies: 'movie', series: 'series', live: 'live', replay: 'timeshift' }[section];
        if (!part) return false;
        const prefix = config.serverUrl.replace(/\/$/, '') + '/' + part + '/' + config.username + '/' + config.password + '/';
        try {
            const url = new URL(item.url), base = new URL(prefix);
            return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
                url.origin === base.origin && url.pathname.startsWith(base.pathname) && !url.hash;
        } catch (_) { return false; }
    }
    function continueItems(progress, recentLive, config) {
        const entries = [];
        ['movies', 'series', 'replay'].forEach(section => {
            const map = progress && progress[section];
            if (!map || typeof map !== 'object' || Array.isArray(map)) return;
            Object.values(map).forEach(item => {
                if (!item || item.done || !Number.isFinite(item.position) || item.position < 15 ||
                    !Number.isFinite(item.duration) || item.duration <= 0 || item.position / item.duration >= 0.92 ||
                    !currentAccount(item, section, config)) return;
                entries.push({ ...item, section, progress: Math.min(1, item.position / item.duration) });
            });
        });
        if (Array.isArray(recentLive)) recentLive.forEach(item => {
            if (currentAccount(item, 'live', config)) entries.push({ ...item, section: 'live', progress: null });
        });
        entries.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
        const seen = new Set();
        return entries.filter(item => {
            const key = item.section === 'series' && item.seriesId ? 'series:' + item.seriesId : item.section + ':' + item.url;
            if (seen.has(key)) return false;
            seen.add(key);
            item.key = key;
            return true;
        }).slice(0, 30);
    }
    return { greeting, currentAccount, continueItems };
}));
