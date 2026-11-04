const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { create } = require('../js/media-store');
const { currentAccount } = require('../js/home-model');
const config = { serverUrl: 'https://example.invalid', username: 'demo', password: 'test' };
function storage() {
    const data = new Map();
    return { data, fail: false, getItem: key => data.has(key) ? data.get(key) : null,
        setItem(key, value) { if (this.fail) throw new Error('quota'); data.set(key, value); } };
}
const a = { id: 'a'.repeat(64), legacyOwner: true };
const b = { id: 'b'.repeat(64), legacyOwner: false };
const movie = { id: 1, url: 'https://example.invalid/movie/demo/test/1.mp4' };
test('legacy owner imports only its own URLs and preserves every original copy', () => {
    const local = storage();
    const foreign = { id: 2, url: 'https://example.invalid/movie/other/test/2.mp4' };
    local.setItem('iptv_favorites_movies', JSON.stringify([movie, foreign, { id: 3 }, null]));
    local.setItem('iptv_progress_movies', JSON.stringify({ [movie.url]: { ...movie, position: 120 }, [foreign.url]: foreign }));
    const original = [...local.data];
    const store = create(local, a, config, currentAccount);
    assert.deepEqual(store.read('iptv_favorites_movies', []), [movie, { id: 3 }]);
    assert.deepEqual(Object.keys(store.read('iptv_progress_movies', {})), [movie.url]);
    for (const [key, raw] of original) assert.equal(local.getItem(key), raw);
    assert([...local.data.keys()].filter(key => key.startsWith('btv_media_')).every(key => !key.includes('demo') && !key.includes('test')));
});
test('switching accounts and restarting restores only that account; deletion does not reimport legacy data', () => {
    const local = storage(); local.setItem('iptv_favorites_movies', JSON.stringify([movie]));
    const one = create(local, a, config, currentAccount), two = create(local, b, config, currentAccount);
    assert.equal(one.read('iptv_favorites_movies', []).length, 1);
    assert.deepEqual(two.read('iptv_favorites_movies', []), []);
    two.write('iptv_favorites_movies', [{ id: 9 }]);
    one.write('iptv_favorites_movies', []);
    assert.deepEqual(create(local, a, config, currentAccount).read('iptv_favorites_movies', []), []);
    assert.deepEqual(create(local, b, config, currentAccount).read('iptv_favorites_movies', []), [{ id: 9 }]);
});
test('unattributed legacy IDs, hidden categories and episode counts never migrate to a new account', () => {
    const local = storage();
    local.setItem('iptv_favorites_series', JSON.stringify([{ id: 1 }]));
    local.setItem('iptv_hidden_categories_live', JSON.stringify(['1']));
    local.setItem('iptv_known_episodes', JSON.stringify({ 1: ['2'] }));
    const store = create(local, b, config, currentAccount);
    assert.deepEqual(store.read('iptv_favorites_series', []), []);
    assert.deepEqual(store.read('iptv_hidden_categories_live', []), []);
    assert.deepEqual(store.read('iptv_known_episodes', {}), {});
    assert.equal(local.data.size, 6);
});
test('quota failure preserves a readable legacy copy and retries migration; corrupt scoped data never falls back', () => {
    const local = storage(); local.setItem('iptv_favorites_movies', JSON.stringify([movie]));
    const store = create(local, a, config, currentAccount);
    local.fail = true;
    assert.deepEqual(store.read('iptv_favorites_movies', []), [movie]);
    assert.throws(() => store.write('iptv_favorites_movies', []), /quota/);
    local.fail = false;
    assert.deepEqual(store.read('iptv_favorites_movies', []), [movie]);
    const key = [...local.data.keys()].find(key => key.startsWith('btv_media_'));
    local.setItem(key, 'broken');
    assert.deepEqual(store.read('iptv_favorites_movies', []), []);
    assert.throws(() => store.read('iptv_credentials', {}), /media_key/);
});
test('real data accessors isolate favorites, progress, history, tracks and late episode checks', async () => {
    const local = storage();
    let resolve;
    const pending = new Promise(done => { resolve = done; });
    const context = vm.createContext({ window: {}, localStorage: local, console, pending });
    vm.runInContext(fs.readFileSync(require.resolve('../js/data.js'), 'utf8'), context);
    const one = create(local, a, config, currentAccount), two = create(local, b, config, currentAccount);
    context.window.btvMediaStore = one;
    context.item = movie;
    vm.runInContext("toggleFavorite('movies', item); trackRecent('movies', item); saveProgress('movies', item, 120, 1800); saveTrackPref('movies', item, 'fr', null); toggleFavorite('series', {id: 8}); loadSeriesInfo = () => pending;", context);
    const check = vm.runInContext('checkFavoriteSeriesForNewEpisodes()', context);
    context.window.btvMediaStore = two;
    assert.equal(vm.runInContext("getFavoritesList('movies').length + getRecentList('movies').length + Object.keys(getProgressMap('movies')).length + Object.keys(getTrackPrefMap('movies')).length", context), 0);
    resolve({ episodes: { 1: [{ id: 42 }] } });
    assert.equal((await check).length, 0);
    assert.deepEqual(two.read('iptv_known_episodes', {}), {});
    context.window.btvMediaStore = one;
    assert.equal(vm.runInContext("getFavoritesList('movies').length + getRecentList('movies').length + Object.keys(getProgressMap('movies')).length + Object.keys(getTrackPrefMap('movies')).length", context), 4);
});
