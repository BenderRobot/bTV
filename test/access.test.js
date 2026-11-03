const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { Client, Vault, AccessError, GRACE_MS, PAIR_MS } = require('../js/access-core.js');

const TOKEN = 'BTVD' + 'A'.repeat(32);
function missing() { const error = new Error('not found'); error.name = 'NotFoundError'; return error; }
function manager() {
    const data = new Map();
    return {
        data, failSave: false,
        getData(alias) { if (!data.has(alias.name)) throw missing(); return data.get(alias.name); },
        removeData(alias) { if (!data.delete(alias.name)) throw missing(); },
        saveData(name, value, password, success, failure) {
            setImmediate(() => { if (this.failSave) failure({ name: 'UnknownError' }); else { data.set(name, value); success(); } });
        }
    };
}
function storage() {
    const data = new Map();
    return { data, getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
}
function response(value, status = 200) { return { status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(value) }; }
function fixture() {
    const vault = manager(), local = storage(), requests = [];
    let clock = 1700000000000;
    const state = {
        vault, local, requests,
        now: () => clock, advance: value => { clock += value; },
        reply: name => name === 'btv_pair_start' ? response(null) : response({ status: 'active', device_token: TOKEN }),
        fetch: async (url, options) => {
            const name = url.split('/').pop();
            requests.push({ name, body: JSON.parse(options.body), options });
            return state.reply(name, JSON.parse(options.body));
        }
    };
    state.client = () => new Client({ base: 'https://example.supabase.co', publicKey: 'sb_publishable_test', version: '1.1.0',
        crypto: webcrypto, keymanager: vault, storage: local, fetch: state.fetch, now: state.now });
    return state;
}

test('a malformed existing native account never causes the legacy recovery copy to be deleted', async () => {
    const state = fixture(), client = state.client();
    await client.initialize();
    await client.vault.write('credentials', { wrong: 'shape' });
    state.local.setItem('iptv_credentials', JSON.stringify({ serverUrl: 'https://example.invalid', username: 'demo', password: 'recovery' }));
    await assert.rejects(state.client().initialize(), error => error.code === 'credentials');
    assert(state.local.getItem('iptv_credentials'));
});

test('native identity survives restarts and neither token nor password enters web storage', async () => {
    const state = fixture(), client = state.client();
    await client.initialize();
    assert.match(client.id, /^[0-9a-f]{64}$/);
    await client.claimCode(' abcd-2345 ');
    await client.saveCredentials({ serverUrl: 'https://example.invalid', username: 'demo', password: 'secret-value' });
    const restarted = state.client(); await restarted.initialize();
    assert.equal(restarted.id, client.id);
    assert.equal((await restarted.check()).status, 'active');
    assert.equal(restarted.readCredentials().password, 'secret-value');
    const clearText = JSON.stringify([...state.local.data]);
    assert.ok(!clearText.includes(TOKEN) && !clearText.includes('secret-value'));
    assert.equal(state.requests[0].body.p_code, 'ABCD2345');
    assert.equal(state.requests[1].body.p_platform, 'tizen');
    assert.equal(state.requests[1].body.p_version, '1.1.0');
});

test('legacy credentials migrate only after a secure read-back; media history is kept', async () => {
    const state = fixture(), client = state.client();
    const legacy = { serverUrl: 'https://example.invalid', username: 'demo', password: 'legacy-secret' };
    state.local.setItem('iptv_credentials', JSON.stringify(legacy));
    state.local.setItem('iptv_favorites_movies', 'keep-favourites');
    await client.initialize();
    assert.deepEqual(client.readCredentials(), legacy);
    assert.equal(state.local.getItem('iptv_credentials'), null);
    assert.equal(state.local.getItem('iptv_favorites_movies'), 'keep-favourites');
    const failed = fixture(), bad = failed.client();
    await bad.initialize();
    failed.local.setItem('iptv_credentials', JSON.stringify(legacy));
    failed.vault.failSave = true;
    await assert.rejects(bad.initialize(), error => error.code === 'storage');
    assert.equal(failed.local.getItem('iptv_credentials'), JSON.stringify(legacy));
});

test('a failed native write preserves the previous complete record', async () => {
    const native = manager(), vault = new Vault(native, () => 100);
    await vault.write('credentials', { value: 'first' });
    await vault.write('credentials', { value: 'second' });
    native.failSave = true;
    await assert.rejects(vault.write('credentials', { value: 'third' }), error => error.code === 'storage');
    assert.deepEqual(vault.read('credentials'), { value: 'second' });
    native.failSave = false;
    await vault.write('credentials', null);
    assert.equal(vault.read('credentials'), null);
    assert.ok(![...native.data.values()].some(value => value.includes('second')));
});

test('offline grace is bounded, does not advance the verification timestamp and rejects clock rollback', async () => {
    const state = fixture(), client = state.client();
    await client.initialize(); await client.claimCode('ABCD2345');
    const stamp = client.record.verifiedAt;
    state.reply = () => { throw new Error('network URL must never escape'); };
    state.advance(GRACE_MS - 1);
    assert.deepEqual(await client.check(), { status: 'active', offline: true });
    assert.equal(client.record.verifiedAt, stamp);
    state.advance(2);
    assert.equal((await client.check()).status, 'offline'); assert.equal(client.isAllowed(), false);
    state.advance(-GRACE_MS - 1000);
    assert.equal((await client.check()).status, 'offline');
});

test('explicit revocation closes access and cannot fall back to grace or the legacy RPC', async () => {
    const state = fixture(), client = state.client();
    await client.initialize(); await client.claimCode('ABCD2345');
    state.requests.length = 0;
    state.reply = () => response({ status: 'revoked' });
    assert.equal((await client.check()).status, 'revoked');
    assert.equal(client.isAllowed(), false);
    assert.equal(state.requests.length, 1);
    state.reply = () => { throw new Error('offline'); };
    const restarted = state.client(); await restarted.initialize();
    assert.equal((await restarted.check()).status, 'revoked');
    assert.equal(restarted.isAllowed(), false);
});

test('404-only compatibility fallbacks preserve the existing device identity', async () => {
    const state = fixture(), client = state.client();
    await client.initialize(); await client.claimCode('ABCD2345');
    state.requests.length = 0;
    state.reply = (name, body) => name === 'btv_device_check_platform' || body.p_version
        ? response({}, 404) : response({ status: 'active' });
    assert.equal((await client.check()).status, 'active');
    assert.deepEqual(state.requests.map(request => request.name), ['btv_device_check_platform', 'btv_device_check', 'btv_device_check']);
    assert.ok(state.requests.every(request => request.body.p_device_id === client.id));
    assert.equal(state.requests[1].body.p_version, '1.1.0 release');
    assert.equal(state.requests[2].body.p_version, undefined);
    assert.equal(state.requests[0].options.redirect, 'error');
    assert.equal(state.requests[0].options.credentials, 'omit');
});

test('invalid input never consumes a code and concurrent claims cannot issue two requests', async () => {
    const state = fixture(), client = state.client(); await client.initialize();
    for (const value of ['x', '<script>', 'ABCD2345extra', 'ABCD/2345']) {
        await assert.rejects(client.claimCode(value), error => error.code === 'invalid_code');
    }
    assert.equal(state.requests.length, 0);
    let finish;
    state.reply = () => new Promise(resolve => { finish = resolve; });
    const first = client.claimCode('ABCD2345');
    await assert.rejects(client.claimCode('WXYZ2345'), error => error.code === 'busy');
    finish(response({ status: 'active', device_token: TOKEN }));
    await first;
    assert.equal(state.requests.length, 1);
});

test('QR secrets have the exact server format, stay transient and expired QR never polls', async () => {
    const state = fixture(), client = state.client(); await client.initialize();
    const pair = await client.startPair();
    assert.match(pair.challenge, /^[0-9a-f]{32}$/); assert.match(pair.secret, /^[0-9a-f]{32}$/);
    assert.notEqual(pair.challenge, pair.secret);
    const request = state.requests[0];
    assert.equal(request.body.p_poll_secret, pair.secret);
    assert.ok(!JSON.stringify([...state.vault.data]).includes(pair.secret));
    assert.ok(!JSON.stringify([...state.local.data]).includes(pair.secret));
    state.advance(PAIR_MS);
    assert.equal((await client.pollPair(pair)).status, 'expired_pair');
    assert.equal(state.requests.length, 1);
});

test('activation refuses missing secure storage and malformed device tokens', async () => {
    const state = fixture(); state.vault.saveData = null;
    const client = state.client();
    await assert.rejects(client.initialize(), error => error.code === 'unsupported_storage');
    assert.equal(state.requests.length, 0);
    const normal = fixture(), other = normal.client(); await other.initialize();
    normal.reply = () => response({ status: 'active', device_token: 'invalid-token' });
    await assert.rejects(other.claimCode('ABCD2345'), error => error.code === 'invalid');
    assert.equal(other.isAllowed(), false);
});

test('a server expiry is enforced even during a later network failure', async () => {
    const state = fixture(), client = state.client(); await client.initialize(); await client.claimCode('ABCD2345');
    state.reply = () => response({ status: 'active', expires_at: new Date(state.now() + 1000).toISOString() });
    await client.check(); state.advance(1001);
    state.reply = () => { throw new AccessError('network'); };
    assert.equal((await client.check()).status, 'offline'); assert.equal(client.isAllowed(), false);
});
