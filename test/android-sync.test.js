const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const sync = require('../js/android-sync');
const { create } = require('../js/media-store');
const { currentAccount } = require('../js/home-model');
const vectors = require('../tools/android-sync-vectors.json');
const config = { serverUrl:'https://example.invalid', username:'demo',password:'test' };
const stateKey = 'iptv_android_sync_v1_' + 'd'.repeat(64);
function fixture(){const data=new Map();const storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};return create(storage,{id:'a'.repeat(64),legacyOwner:false},config,currentAccount);}
function row(seq,kind='favorite',extra={}){return {seq,kind,item_id:'VOD|123',payload:{name:'Film',posterUrl:'https://example.invalid/poster.jpg'},deleted:false,updated_at:1000+seq,...extra};}
test('Android ASCII, accents and UTF-16 keys match, with independent SHA-256 checks',()=>{
    for(const c of vectors.cases)assert.equal(sync.keyFor(c),c.sourceKey);
    for(const value of ['', 'abc', '😀'.repeat(100), 'é'.repeat(1000)])assert.equal(sync.sha256(value),crypto.createHash('sha256').update(value).digest('hex'));
});
test('Principal receives usable movies, live channels, series favorites and episode history without settings',()=>{
    const store=fixture();
    const rows=[row(1),row(2,'favorite',{item_id:'LIVE|2'}),row(3,'favorite',{item_id:'SERIES|3'}),row(4,'history',{item_id:'SERIES|9',payload:{name:'Episode',seriesId:'3',seasonNumber:1,episodeNumber:2,containerExtension:'mkv'}}),row(5,'setting',{item_id:'pin',payload:{values:['private']}})];
    assert.equal(sync.applyPage(store,stateKey,rows,config).cursor,5);
    assert.equal(store.read('iptv_favorites_movies',[])[0].url,'https://example.invalid/movie/demo/test/123.mp4');
    assert.equal(store.read('iptv_favorites_series',[])[0].kind,'series');
    assert.equal(store.read('iptv_recent_series',[])[0].seriesId,'3');
    assert.equal(store.read('iptv_recent_series',[])[0].url.endsWith('/9.mkv'),true);
});
test('newer local data survives and tombstones delete only older data',()=>{
    const store=fixture();sync.applyPage(store,stateKey,[row(1)],config);
    store.write('iptv_favorites_movies',[{id:'123',updatedAt:5000,name:'Local'}]);
    sync.applyPage(store,stateKey,[row(2,'favorite',{deleted:true})],config);
    assert.equal(store.read('iptv_favorites_movies',[])[0].name,'Local');
    sync.applyPage(store,stateKey,[row(3,'favorite',{deleted:true,updated_at:6000})],config);
    assert.deepEqual(store.read('iptv_favorites_movies',[]),[]);
});
test('privacy marker removes older favorites/history and keeps newer local entries',()=>{
    const store=fixture();sync.applyPage(store,stateKey,[row(1),row(2,'history')],config);
    store.write('iptv_recent_live',[{id:'55',updatedAt:9000}]);
    sync.applyPage(store,stateKey,[row(3,'setting',{item_id:'__erased__',payload:{},updated_at:5000})],config);
    assert.deepEqual(store.read('iptv_favorites_movies',[]),[]);assert.deepEqual(store.read('iptv_recent_movies',[]),[]);
    assert.equal(store.read('iptv_recent_live',[]).length,1);
});
test('interrupted page never advances its cursor and replays without duplicates',()=>{
    const store=fixture(), original=store.write;let fail=true;
    store.write=(key,value)=>{if(key==='iptv_recent_movies'&&fail)throw new Error('quota');return original(key,value);};
    const rows=[row(1),row(2,'history')];assert.throws(()=>sync.applyPage(store,stateKey,rows,config),/quota/);
    assert.equal(store.read(stateKey,{}).cursor,undefined);fail=false;
    sync.applyPage(store,stateKey,rows,config);sync.applyPage(store,stateKey,rows,config);
    assert.equal(store.read('iptv_favorites_movies',[]).length,1);assert.equal(store.read('iptv_recent_movies',[]).length,1);
    assert.equal(store.read(stateKey,{}).cursor,2);
});
test('invalid pages never acknowledge rows or settings; numeric IDs cannot inject URLs',()=>{
    const store=fixture();assert.throws(()=>sync.applyPage(store,stateKey,[row(2),row(1)],config),/sync_order/);
    assert.throws(()=>sync.applyPage(store,stateKey,[row(1),row(2,'history',{payload:{}})],config),/sync_format/);
    assert.equal(store.read(stateKey,{}).cursor,undefined);
    sync.applyPage(store,stateKey,[row(1,'favorite',{item_id:'VOD|../outside'})],config);
    assert.deepEqual(store.read('iptv_favorites_movies',[]),[]);
});
