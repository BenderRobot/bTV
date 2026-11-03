/* Native access protocol. No DOM, IPTV requests, telemetry or secret logging. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.BtvAccessCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const GRACE_MS = 60 * 60 * 1000;
    const PAIR_MS = 5 * 60 * 1000;
    const TOKEN = /^BTVD[0-9A-F]{32}$/;
    const DEVICE = /^[0-9a-f]{64}$/;
    const RPCS = ['btv_device_check_platform', 'btv_device_check', 'btv_tv_code_claim', 'btv_pair_start', 'btv_pair_take'];
    class AccessError extends Error {
        constructor(code) { super(code); this.name = 'BtvAccessError'; this.code = code; }
    }
    function fail(code) { throw new AccessError(code); }
    function matches(value, regex, size) { return typeof value === 'string' && value.length === size && regex.test(value); }
    function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
    function randomHex(crypto, bytes) {
        if (!crypto || typeof crypto.getRandomValues !== 'function') fail('unsupported');
        const buffer = new Uint8Array(bytes);
        crypto.getRandomValues(buffer);
        return Array.from(buffer, byte => byte.toString(16).padStart(2, '0')).join('');
    }
    function normalizeCode(value) {
        if (typeof value !== 'string' || value.length > 40) fail('invalid_code');
        const code = value.replace(/[\s-]/g, '').toUpperCase();
        if (!/^[A-Z0-9]{8}$/.test(code)) fail('invalid_code');
        return code;
    }
    function credentials(value) {
        if (!object(value) || typeof value.serverUrl !== 'string' || value.serverUrl.length > 2048 ||
            typeof value.username !== 'string' || value.username.length < 1 || value.username.length > 256 ||
            typeof value.password !== 'string' || value.password.length < 1 || value.password.length > 512) fail('credentials');
        let url;
        try { url = new URL(value.serverUrl); } catch (_) { fail('credentials'); }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) fail('credentials');
        return { serverUrl: value.serverUrl, username: value.username, password: value.password };
    }

    // Two native KeyManager slots: a failed write cannot delete the last good
    // copy. Neither the access token nor IPTV credentials enter localStorage.
    class Vault {
        constructor(manager, now) { this.manager = manager; this.now = now; this.writing = Promise.resolve(); }
        available() { return !!this.manager && ['getData', 'saveData', 'removeData'].every(key => typeof this.manager[key] === 'function'); }
        alias(name, slot) {
            if (!['identity', 'access', 'credentials'].includes(name)) fail('storage');
            return 'btv.' + name + '.v1.' + slot;
        }
        slots(name) {
            if (!this.available()) fail('unsupported_storage');
            let invalid = false;
            const slots = [0, 1].map(slot => {
                let raw;
                try { raw = this.manager.getData({ name: this.alias(name, slot) }); }
                catch (error) { if (error && error.name === 'NotFoundError') return null; fail('storage'); }
                try {
                    const record = JSON.parse(raw);
                    if (record.schema !== 1 || !Number.isSafeInteger(record.revision) || record.revision < 1 ||
                        !(record.value === null || object(record.value))) throw new Error();
                    return { slot, record };
                } catch (_) { invalid = true; return null; }
            });
            if (invalid && !slots.some(Boolean)) fail('storage');
            return slots;
        }
        read(name) {
            const valid = this.slots(name).filter(Boolean).sort((a, b) => b.record.revision - a.record.revision);
            return valid.length ? valid[0].record.value : null;
        }
        write(name, value) {
            const operation = this.writing.catch(() => {}).then(async () => {
                const slots = this.slots(name);
                const latest = slots.filter(Boolean).sort((a, b) => b.record.revision - a.record.revision)[0];
                const slot = latest ? 1 - latest.slot : 0;
                const alias = this.alias(name, slot);
                const revision = Math.max(1, this.now(), latest ? latest.record.revision + 1 : 0);
                const record = { schema: 1, revision, value };
                try { this.manager.removeData({ name: alias }); }
                catch (error) { if (!error || error.name !== 'NotFoundError') fail('storage'); }
                await new Promise((resolve, reject) => {
                    const timer = setTimeout(() => reject(new AccessError('storage')), 10000);
                    const done = fn => value => { clearTimeout(timer); fn(value); };
                    try { this.manager.saveData(alias, JSON.stringify(record), null, done(resolve), done(() => reject(new AccessError('storage')))); }
                    catch (_) { done(() => reject(new AccessError('storage')))(); }
                });
                const saved = this.read(name);
                if (JSON.stringify(saved) !== JSON.stringify(value)) fail('storage');
                if (value === null && latest) {
                    try { this.manager.removeData({ name: this.alias(name, latest.slot) }); }
                    catch (_) { fail('storage'); }
                }
                return saved;
            });
            this.writing = operation;
            return operation;
        }
    }

    class Client {
        constructor(options) {
            this.crypto = options.crypto;
            this.fetch = options.fetch;
            this.storage = options.storage;
            this.now = options.now || Date.now;
            this.vault = new Vault(options.keymanager, this.now);
            this.base = (options.base || '').replace(/\/$/, '');
            this.publicKey = options.publicKey || '';
            this.version = options.version || '';
            this.name = (options.name || 'TV Samsung bTV').slice(0, 80);
            this.id = null;
            this.record = null;
            this.authorized = false;
            this.claiming = false;
            this.checking = null;
        }
        async initialize() {
            if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(this.base) || !this.publicKey || this.publicKey.startsWith('sb_secret_') ||
                !/^\d{1,3}\.\d{1,3}\.\d{1,4}$/.test(this.version)) fail('configuration');
            if (typeof this.fetch !== 'function') fail('unsupported');
            if (!this.vault.available()) fail('unsupported_storage');
            let identity = this.vault.read('identity');
            if (identity === null) {
                identity = { deviceId: randomHex(this.crypto, 32) };
                await this.vault.write('identity', identity);
            }
            if (!matches(identity.deviceId, DEVICE, 64)) fail('storage');
            this.id = identity.deviceId;
            // A successful, read-back native write is required before removing
            // the old clear-text copy. Histories and favourites are untouched.
            const saved = this.vault.read('credentials');
            if (saved) credentials(saved);
            let legacy;
            try { legacy = this.storage.getItem('iptv_credentials'); } catch (_) { fail('storage'); }
            if (!saved && legacy) {
                let value;
                try { value = credentials(JSON.parse(legacy)); } catch (_) { fail('credentials'); }
                await this.vault.write('credentials', value);
            }
            if (legacy) {
                try { this.storage.removeItem('iptv_credentials'); } catch (_) { fail('storage'); }
            }
            return this.id;
        }
        isAllowed() {
            if (!this.authorized || !this.record || !this.id) return false;
            const age = this.now() - this.record.verifiedAt;
            if (age < 0 || age > GRACE_MS) return false;
            return !this.record.expiresAt || this.now() < this.record.expiresAt;
        }
        async rpc(name, body) {
            if (!RPCS.includes(name)) fail('configuration');
            const controller = typeof AbortController === 'function' ? new AbortController() : null;
            let timer;
            const timeout = new Promise((_, reject) => {
                timer = setTimeout(() => { if (controller) controller.abort(); reject(new AccessError('network')); }, 15000);
            });
            try {
                return await Promise.race([timeout, (async () => {
                    const reply = await this.fetch(this.base + '/rest/v1/rpc/' + name, {
                        method: 'POST', headers: { apikey: this.publicKey, 'Content-Type': 'application/json', Accept: 'application/json' },
                        body: JSON.stringify(body), credentials: 'omit', cache: 'no-store', redirect: 'error',
                        referrerPolicy: 'no-referrer', signal: controller ? controller.signal : undefined
                    });
                    if (reply.status === 404) fail('missing_rpc');
                    if (!reply.ok) fail('network');
                    const text = await reply.text();
                    if (text.length > 65536) fail('network');
                    if (name === 'btv_pair_start' && (!text || text === 'null')) return {};
                    let value;
                    try { value = JSON.parse(text); } catch (_) { fail('network'); }
                    if (!object(value)) fail('network');
                    return value;
                })()]);
            } catch (error) {
                if (error instanceof AccessError) throw error;
                fail('network');
            } finally { clearTimeout(timer); }
        }
        async accept(token, expiresAt) {
            if (!matches(token, TOKEN, 36) || !this.id) fail('invalid');
            const record = { token, deviceId: this.id, verifiedAt: this.now(), expiresAt: expiresAt || null };
            await this.vault.write('access', record);
            try { this.storage.removeItem('btv_access_denied'); } catch (_) { fail('storage'); }
            this.record = record;
            this.authorized = true;
            return { status: 'active', offline: false };
        }
        async deny(status) {
            this.authorized = false;
            this.record = null;
            try { this.storage.setItem('btv_access_denied', '1'); } catch (_) { /* Native tombstone still required below. */ }
            await this.vault.write('access', { blocked: status });
            return { status };
        }
        check() {
            if (this.checking) return this.checking;
            this.checking = this.checkSaved().finally(() => { this.checking = null; });
            return this.checking;
        }
        async checkSaved() {
            if (!this.id) fail('storage');
            const record = this.vault.read('access');
            let denied;
            try { denied = this.storage.getItem('btv_access_denied'); } catch (_) { fail('storage'); }
            if (!record || record.blocked || denied) {
                this.authorized = false;
                return { status: record && record.blocked || 'activation_required' };
            }
            if (!matches(record.token, TOKEN, 36) || record.deviceId !== this.id || !Number.isSafeInteger(record.verifiedAt) ||
                !(record.expiresAt === null || Number.isSafeInteger(record.expiresAt))) return this.deny('invalid');
            this.record = record;
            const body = { p_token: record.token, p_device_id: this.id, p_name: this.name, p_kind: 'tv' };
            let reply;
            try {
                try {
                    reply = await this.rpc('btv_device_check_platform', Object.assign({}, body,
                        { p_version: this.version, p_platform: 'tizen', p_channel: 'release' }));
                } catch (error) {
                    if (error.code !== 'missing_rpc') throw error;
                    try { reply = await this.rpc('btv_device_check', Object.assign({}, body, { p_version: this.version + ' release' })); }
                    catch (legacy) { if (legacy.code !== 'missing_rpc') throw legacy; reply = await this.rpc('btv_device_check', body); }
                }
            } catch (error) {
                if (!['network', 'missing_rpc'].includes(error.code)) throw error;
                this.authorized = true;
                if (this.isAllowed()) return { status: 'active', offline: true };
                this.authorized = false;
                return { status: 'offline' };
            }
            if (reply.status !== 'active') return this.deny(['revoked', 'expired', 'invalid'].includes(reply.status) ? reply.status : 'invalid');
            const expiry = reply.expires_at ? Date.parse(reply.expires_at) : null;
            if (reply.expires_at && !Number.isFinite(expiry)) fail('network');
            if (expiry !== null && expiry <= this.now()) return this.deny('expired');
            return this.accept(record.token, expiry);
        }
        async claimCode(value) {
            if (!this.id) fail('storage');
            const code = normalizeCode(value);
            if (this.claiming) fail('busy');
            this.claiming = true;
            try {
                const reply = await this.rpc('btv_tv_code_claim', { p_code: code, p_device_id: this.id, p_name: this.name, p_kind: 'tv' });
                if (reply.status !== 'active') return { status: reply.status || 'invalid' };
                return await this.accept(reply.device_token, null);
            } finally { this.claiming = false; }
        }
        async startPair() {
            if (!this.id) fail('storage');
            const pair = { challenge: randomHex(this.crypto, 16), secret: randomHex(this.crypto, 16), expiresAt: this.now() + PAIR_MS };
            await this.rpc('btv_pair_start', { p_challenge: pair.challenge, p_poll_secret: pair.secret, p_device_id: this.id, p_name: this.name });
            return pair;
        }
        async pollPair(pair) {
            if (!pair || this.now() >= pair.expiresAt) return { status: 'expired_pair' };
            if (this.claiming) return { status: 'pending' };
            this.claiming = true;
            try {
                const reply = await this.rpc('btv_pair_take', { p_challenge: pair.challenge, p_poll_secret: pair.secret });
                if (reply.status !== 'active') return { status: reply.status || 'invalid' };
                return await this.accept(reply.device_token, null);
            } finally { this.claiming = false; }
        }
        readCredentials() { return this.vault.read('credentials'); }
        saveCredentials(value) { return this.vault.write('credentials', credentials(value)); }
        forgetCredentials() { return this.vault.write('credentials', null); }
    }
    return { Client, Vault, AccessError, normalizeCode, credentials, GRACE_MS, PAIR_MS };
}));
