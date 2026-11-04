(function () {
    'use strict';
    let generation = 0, timer = null, busy = false;
    async function receive() {
        if (busy || document.hidden || !window.BtvActivation.isAllowed() || !window.btvMediaStore) return;
        busy = true;
        const epoch = generation, store = window.btvMediaStore, config = window.iptvServerConfig;
        try {
            const key = BtvAndroidSync.keyFor(config);
            const stateKey = 'iptv_android_sync_v1_' + BtvAndroidSync.sha256(key);
            let cursor = store.read(stateKey, {}).cursor || 0, changed = false;
            // Bounded work per round; the next one continues the durable cursor.
            for (let page = 0; page < 20; page++) {
                const rows = await window.BtvActivation.syncPull(key, cursor);
                if (epoch !== generation || document.hidden || store !== window.btvMediaStore || !window.BtvActivation.isAllowed()) return;
                const result = BtvAndroidSync.applyPage(store, stateKey, rows, config);
                cursor = result.cursor; changed = changed || result.changed;
                if (rows.length < 100) break;
            }
            if (changed) {
                if (currentView === 'home' && window.BtvHome) window.BtvHome.render();
                flashAppToast('Favoris et historique du profil Principal actualisés');
            }
        } catch (_) { /* Offline or access denied: preserve local data and retry, never log credentials. */ }
        finally { busy = false; }
    }
    function stop() { generation++; clearInterval(timer); timer = null; }
    function start() { stop(); timer = setInterval(receive, 60000); receive(); }
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) generation++;
        else receive();
    });
    window.BtvSyncRuntime = { start, stop, receive };
}());
