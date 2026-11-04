/* Receive Android Principal favorites/history. No cloud writes, settings or profile registry changes. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.BtvAndroidSync = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    function sha256(text) {
        const bytes = [];
        for (const char of text) {
            let c = char.codePointAt(0);
            if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
            if (c < 128) bytes.push(c);
            else if (c < 2048) bytes.push(192 | c >> 6, 128 | c & 63);
            else if (c < 65536) bytes.push(224 | c >> 12, 128 | c >> 6 & 63, 128 | c & 63);
            else bytes.push(240 | c >> 18, 128 | c >> 12 & 63, 128 | c >> 6 & 63, 128 | c & 63);
        }
        const length = bytes.length * 8;
        bytes.push(128); while (bytes.length % 64 !== 56) bytes.push(0);
        for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : length >>> (i * 8) & 255);
        const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
        const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
        const r = (x, n) => x >>> n | x << (32 - n);
        for (let offset = 0; offset < bytes.length; offset += 64) {
            const w = [];
            for (let i = 0; i < 16; i++) w[i] = bytes.slice(offset + i * 4, offset + i * 4 + 4).reduce((v, b) => v << 8 | b, 0);
            for (let i = 16; i < 64; i++) w[i] = (w[i-16] + (r(w[i-15],7)^r(w[i-15],18)^w[i-15]>>>3) + w[i-7] + (r(w[i-2],17)^r(w[i-2],19)^w[i-2]>>>10)) | 0;
            let [a,b,c,d,e,f,g,j] = h;
            for (let i = 0; i < 64; i++) {
                const t = (j + (r(e,6)^r(e,11)^r(e,25)) + (e&f^~e&g) + k[i] + w[i]) | 0;
                const u = ((r(a,2)^r(a,13)^r(a,22)) + (a&b^a&c^b&c)) | 0;
                j=g; g=f; f=e; e=(d+t)|0; d=c; c=b; b=a; a=(t+u)|0;
            }
            [a,b,c,d,e,f,g,j].forEach((value,i) => { h[i]=(h[i]+value)|0; });
        }
        return h.map(value => (value >>> 0).toString(16).padStart(8,'0')).join('');
    }
    function keyFor(config) {
        const server = config.serverUrl.trim().replace(/\/+$/, '');
        return sha256(`btv-sync-v1\n${server.length}:${server}\n${config.username.length}:${config.username}\n${config.password.length}:${config.password}`);
    }
    function normalize(row, config) {
        if (!row || !Number.isSafeInteger(row.seq) || row.seq <= 0 || !Number.isSafeInteger(row.updated_at) || row.updated_at < 0 || typeof row.deleted !== 'boolean') throw new Error('sync_format');
        if (!['favorite','history'].includes(row.kind)) return null;
        const match = /^(LIVE|VOD|SERIES)\|([0-9]{1,20})$/.exec(row.item_id);
        if (!match) return null; // Other clients' media types remain untouched.
        const section = { LIVE:'live', VOD:'movies', SERIES:'series' }[match[1]];
        const p = row.payload;
        if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('sync_format');
        const id = match[2], series = row.kind === 'favorite' && section === 'series';
        if (!row.deleted && (typeof p.name !== 'string' || !p.name.length || p.name.length > 2048)) throw new Error('sync_format');
        const ext = /^[a-zA-Z0-9]{1,8}$/.test(p.containerExtension) ? p.containerExtension : section === 'live' ? 'ts' : 'mp4';
        const item = { id, kind: series ? 'series' : 'stream', name: p.name || '', logo: typeof p.posterUrl === 'string' ? p.posterUrl : '',
            updatedAt: row.updated_at, categoryId: p.categoryId || '', categoryName: p.categoryName || '' };
        if (!series) item.url = config.serverUrl.replace(/\/+$/, '') + '/' + {live:'live',movies:'movie',series:'series'}[section] + '/' + encodeURIComponent(config.username) + '/' + encodeURIComponent(config.password) + '/' + id + '.' + ext;
        if (section === 'series' && !series && /^[0-9]{1,20}$/.test(p.seriesId)) {
            item.seriesId = String(p.seriesId); item.season = p.seasonNumber; item.episodeNumber = p.episodeNumber;
        }
        return { key: 'iptv_' + (row.kind === 'favorite' ? 'favorites_' : 'recent_') + section, section, item, deleted: row.deleted, at: row.updated_at };
    }
    function applyPage(store, stateKey, rows, config) {
        if (!Array.isArray(rows) || rows.length > 100) throw new Error('sync_format');
        if (rows.some((row,i) => i && row.seq <= rows[i-1].seq)) throw new Error('sync_order');
        const state = store.read(stateKey, {});
        let cursor = Number.isSafeInteger(state.cursor) ? state.cursor : 0;
        const changes = rows.map(row => ({ row, change: normalize(row, config) }));
        let changed = false;
        for (const {row,change} of changes) {
            if (row.seq <= cursor) continue;
            if (row.kind === 'setting' && row.item_id === '__erased__' && !row.deleted) {
                for (const section of ['live','movies','series','replay']) for (const type of ['favorites','recent']) {
                    const key = 'iptv_' + type + '_' + section;
                    const list = store.read(key, []), kept = list.filter(it => Number(it.updatedAt || 0) >= row.updated_at);
                    if (list.length !== kept.length) { store.write(key, kept); changed = true; }
                }
            } else if (change) {
                const list = store.read(change.key, []);
                const index = list.findIndex(it => String(it.id) === change.item.id);
                const mine = index < 0 ? null : list[index];
                if (!mine || Number(mine.updatedAt || 0) < change.at) {
                    if (index >= 0) list.splice(index,1);
                    if (!change.deleted) list.push(change.item);
                    list.sort((a,b) => Number(b.updatedAt || 0)-Number(a.updatedAt || 0));
                    // History is intentionally bounded, favorites must never be silently evicted.
                    store.write(change.key, change.key.startsWith('iptv_recent_') ? list.slice(0,500) : list);
                    changed = true;
                }
            }
            cursor = row.seq;
        }
        // Last write: an interrupted page is safe to replay, never falsely acknowledged.
        store.write(stateKey, { cursor });
        return { cursor, changed };
    }
    return { sha256, keyFor, normalize, applyPage };
}));
