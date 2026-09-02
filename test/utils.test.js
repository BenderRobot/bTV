const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    formatTime,
    escapeHtml,
    decodeEpgText,
    cacheSet,
    resolveExtension,
    buildTimeshiftUrl,
    groupRecentList
} = require('../js/utils.js');

test('formatTime', () => {
    assert.equal(formatTime(0), '00:00');
    assert.equal(formatTime(65), '01:05');
    assert.equal(formatTime(3661), '1:01:01');
    assert.equal(formatTime(-5), '00:00');
    assert.equal(formatTime(NaN), '00:00');
});

test('escapeHtml', () => {
    assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
    assert.equal(escapeHtml(`x" onerror="alert(1)`), 'x&quot; onerror=&quot;alert(1)');
    assert.equal(escapeHtml("O'Brien & Fils"), 'O&#39;Brien &amp; Fils');
    assert.equal(escapeHtml(''), '');
    assert.equal(escapeHtml(undefined), '');
});

test('decodeEpgText', () => {
    const b64 = Buffer.from('Match en direct', 'utf-8').toString('base64');
    assert.equal(decodeEpgText(b64), 'Match en direct');
    assert.equal(decodeEpgText(''), '');
    assert.equal(decodeEpgText('!!!pas du base64!!!'), '');
});

test('cacheSet respecte le plafond en evincant l\'entree la plus ancienne', () => {
    const cache = {};
    cacheSet(cache, 'a', 1, 2);
    cacheSet(cache, 'b', 2, 2);
    cacheSet(cache, 'c', 3, 2);
    assert.deepEqual(Object.keys(cache), ['b', 'c']);
});

test('cacheSet ne compte pas une cle deja presente comme une nouvelle entree', () => {
    const cache = { a: 1, b: 2 };
    cacheSet(cache, 'a', 99, 2);
    assert.deepEqual(cache, { a: 99, b: 2 });
});

test('resolveExtension : live force toujours le conteneur par defaut', () => {
    assert.equal(resolveExtension({ container_extension: 'mkv' }, { urlPart: 'live', defaultExt: 'ts' }), 'ts');
});

test('resolveExtension : conteneur deja lisible nativement conserve tel quel', () => {
    assert.equal(resolveExtension({ container_extension: 'mp4' }, { urlPart: 'movie', defaultExt: 'mp4' }), 'mp4');
});

test('resolveExtension : conteneur non lisible bascule en m3u8 si le compte l\'autorise', () => {
    assert.equal(resolveExtension({ container_extension: 'mkv' }, { urlPart: 'movie', defaultExt: 'mp4' }, ['m3u8']), 'm3u8');
});

test('resolveExtension : conteneur non lisible et m3u8 non autorise retombe sur le conteneur brut', () => {
    assert.equal(resolveExtension({ container_extension: 'mkv' }, { urlPart: 'movie', defaultExt: 'mp4' }, []), 'mkv');
});

test('buildTimeshiftUrl', () => {
    const cfg = { serverUrl: 'http://panel.test', username: 'u', password: 'p' };
    const url = buildTimeshiftUrl(42, '2026-09-01 20:30:00', 90, cfg);
    assert.equal(url, 'http://panel.test/timeshift/u/p/90/2026-09-01:20-30/42.ts');
});

test('buildTimeshiftUrl : date mal formee renvoie une chaine vide', () => {
    assert.equal(buildTimeshiftUrl(42, 'pas une date', 90, { serverUrl: 'x', username: 'u', password: 'p' }), '');
});

test('groupRecentList : hors series, la liste est renvoyee telle quelle', () => {
    const list = [{ name: 'Film A' }, { name: 'Film B' }];
    assert.equal(groupRecentList(list, 'movies'), list);
});

test('groupRecentList : regroupe les episodes d\'une meme serie sous une entree', () => {
    const list = [
        { seriesId: 1, seriesName: 'Serie X', name: 'S1E3' },
        { seriesId: 2, seriesName: 'Serie Y', name: 'S2E1' },
        { seriesId: 1, seriesName: 'Serie X', name: 'S1E2' }
    ];
    const grouped = groupRecentList(list, 'series');
    assert.equal(grouped.length, 2);
    assert.equal(grouped[0].kind, 'recentSeriesGroup');
    assert.equal(grouped[0].seriesId, 1);
    assert.equal(grouped[0]._groupedEpisodes.length, 2);
    assert.equal(grouped[0].badge, '2 ép.');
    assert.equal(grouped[0]._groupedEpisodes[0].name, 'S1E3'); // le plus recent en premier
    assert.equal(grouped[1].seriesId, 2);
});

test('groupRecentList : une entree sans seriesId passe telle quelle (securite)', () => {
    const grouped = groupRecentList([{ name: 'Episode orphelin' }], 'series');
    assert.equal(grouped.length, 1);
    assert.equal(grouped[0].name, 'Episode orphelin');
});
