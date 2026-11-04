/* Local account isolation. IDs are assigned in KeyManager, never derived from passwords.
 * This is not the Android cloud namespace; no sync payload is sent by this module. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.BtvMediaStore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    function section(key) {
        const match = /^iptv_(favorites|recent|progress|trackpref|hidden_categories)_(live|movies|series|replay)$/.exec(key);
        return match ? match[2] : null;
    }
    function allowed(key) {
        return !!section(key) || ['iptv_known_episodes', 'iptv_new_episodes'].includes(key);
    }
    function create(storage, account, config, ownsURL) {
        if (!account || !/^[a-f0-9]{64}$/.test(account.id)) throw new Error('media_storage');
        const prefix = 'btv_media_v1_' + account.id + '_main_';
        function legacyValue(key, fallback) {
            if (!account.legacyOwner) return fallback;
            let value;
            try { value = JSON.parse(storage.getItem(key)); } catch (_) { return fallback; }
            if (value === null || typeof value !== 'object' || Array.isArray(value) !== Array.isArray(fallback)) return fallback;
            const part = section(key);
            if (/^iptv_(favorites|recent)_/.test(key)) {
                // URL-less provider IDs are accepted only for the remembered owner.
                return value.filter(it => it && typeof it === 'object' && !Array.isArray(it) &&
                    (it.url ? ownsURL(it, part, config) : it.id !== undefined));
            }
            if (/^iptv_(progress|trackpref)_/.test(key)) {
                return Object.fromEntries(Object.entries(value).filter(([url, item]) =>
                    item && typeof item === 'object' && !Array.isArray(item) &&
                    ownsURL({ url }, part, config) && (!item.url || item.url === url)));
            }
            return value;
        }
        function write(key, value) {
            if (!allowed(key)) throw new Error('media_key');
            const raw = JSON.stringify(value);
            storage.setItem(prefix + key, raw);
            if (storage.getItem(prefix + key) !== raw) throw new Error('media_storage');
        }
        function read(key, fallback) {
            if (!allowed(key)) throw new Error('media_key');
            const raw = storage.getItem(prefix + key);
            if (raw !== null) {
                try {
                    const value = JSON.parse(raw);
                    return value && typeof value === 'object' && Array.isArray(value) === Array.isArray(fallback) ? value : fallback;
                } catch (_) { return fallback; }
            }
            const value = legacyValue(key, fallback);
            // Keep the legacy copy, including if quota or read-back fails.
            // Failed migration is retried next time; never read another namespace.
            try { write(key, value); } catch (_) { /* Original copy remains readable on retry. */ }
            return value;
        }
        return { read, write };
    }
    return { create };
}));
