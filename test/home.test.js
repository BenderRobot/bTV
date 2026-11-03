const { test } = require('node:test');
const assert = require('node:assert/strict');
const { greeting, currentAccount, continueItems } = require('../js/home-model');
const config = { serverUrl: 'https://example.invalid', username: 'demo', password: 'test' };
function item(id, section = 'movies', extra = {}) {
    return { id, name: 'Media ' + id, kind: 'stream', url: config.serverUrl + '/' + { movies: 'movie', series: 'series', live: 'live', replay: 'timeshift' }[section] + '/demo/test/' + id + '.mp4', position: 300, duration: 1800, updatedAt: id, ...extra };
}
test('home only resumes unfinished items and never mixes credentials from another account', () => {
    const map = { a: item(1), b: item(2, 'movies', { done: true }), c: item(3, 'movies', { position: 3 }), d: item(4, 'movies', { position: 1700 }), e: item(5, 'movies', { url: 'https://other.invalid/movie/demo/test/5.mp4' }), f: item(6, 'movies', { url: 'https://example.invalid/movie/other/password/6.mp4' }) };
    const snapshot = JSON.stringify(map);
    assert.deepEqual(continueItems({ movies: map }, [], config).map(it => it.id), [1]);
    assert.equal(JSON.stringify(map), snapshot);
});
test('home groups episodes by series, sorts by recent playback and keeps live logos without progress', () => {
    const result = continueItems({ movies: { a: item(2) }, series: { b: item(3, 'series', { seriesId: 9 }), c: item(4, 'series', { seriesId: 9 }) } }, [item(1, 'live')], config);
    assert.deepEqual(result.map(it => it.id), [4, 2, 1]);
    assert.equal(result[0].key, 'series:9');
    assert.equal(result[2].progress, null);
    assert.equal(result[0].progress, 1 / 6);
});
test('home rejects malformed progress, absent accounts, URL credentials and traversal out of the account path', () => {
    assert.deepEqual(continueItems({ movies: { a: null, b: item(1, 'movies', { duration: 0 }), c: item(2, 'movies', { position: NaN }) } }, {}, config), []);
    assert.deepEqual(continueItems({ movies: { a: item(1) } }, [], null), []);
    assert.equal(currentAccount(item(1, 'movies', { url: 'https://user:pass@example.invalid/movie/demo/test/1.mp4' }), 'movies', config), false);
    assert.equal(currentAccount(item(1, 'movies', { url: 'https://example.invalid/movie/demo/test/../../../other/1.mp4' }), 'movies', config), false);
});
test('home caps large histories and greets at day boundaries', () => {
    const result = continueItems({ movies: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [i, item(i)])) }, [], config);
    assert.equal(result.length, 30); assert.equal(result[0].id, 99);
    assert.equal(greeting(5), 'Bonjour !'); assert.equal(greeting(12), 'Bon après-midi !');
    assert.equal(greeting(18), 'Bonsoir !'); assert.equal(greeting(23), 'Encore debout ?');
});
