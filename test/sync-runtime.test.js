const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const {create} = require('../js/media-store');
const {currentAccount} = require('../js/home-model');
const sync = require('../js/android-sync');
function fixture(){
    const data=new Map(),events={},calls=[];
    const storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
    const config={serverUrl:'https://example.invalid',username:'demo',password:'test'};
    const store=create(storage,{id:'a'.repeat(64),legacyOwner:false},config,currentAccount);
    const document={hidden:false,addEventListener:(name,fn)=>{events[name]=fn;}};
    const activation={isAllowed:()=>true,syncPull:async(key,cursor)=>{calls.push({key,cursor});return [];}};
    const window={BtvActivation:activation,btvMediaStore:store,iptvServerConfig:config,BtvHome:{render(){}}};
    const context=vm.createContext({window,document,BtvAndroidSync:sync,currentView:'home',setInterval:()=>1,clearInterval(){},flashAppToast(){}});
    vm.runInContext(fs.readFileSync(require.resolve('../js/sync-runtime'),'utf8'),context);
    return {document,events,calls,activation,window,store,runtime:window.BtvSyncRuntime};
}
test('runtime paginates authenticated Principal data into the real account store',async()=>{
    const f=fixture();f.activation.syncPull=async(key,cursor)=>{
        f.calls.push({key,cursor});
        if(!cursor)return Array.from({length:100},(_,i)=>({seq:i+1,kind:'setting',item_id:'other',payload:{},updated_at:1,deleted:false}));
        return [{seq:101,kind:'favorite',item_id:'SERIES|8',payload:{name:'Serie'},updated_at:1000,deleted:false}];
    };
    await f.runtime.receive();
    assert.deepEqual(f.calls.map(it=>it.cursor),[0,100]);
    assert.equal(f.calls[0].key,sync.keyFor(f.window.iptvServerConfig));
    assert.equal(f.store.read('iptv_favorites_series',[])[0].id,'8');
});
test('an in-flight answer cannot import into a different account or a hidden app',async()=>{
    for(const action of ['account','hidden']){
        const f=fixture();let resolve;
        f.activation.syncPull=()=>new Promise(done=>{resolve=done;});
        const running=f.runtime.receive();
        if(action==='account')f.window.btvMediaStore={};else {f.document.hidden=true;f.events.visibilitychange();}
        resolve([{seq:1,kind:'favorite',item_id:'VOD|1',payload:{name:'Film'},updated_at:1000,deleted:false}]);
        await running;assert.deepEqual(f.store.read('iptv_favorites_movies',[]),[]);
    }
});
test('revoked or inactive apps perform no sync calls',async()=>{
    const f=fixture();f.activation.isAllowed=()=>false;await f.runtime.receive();assert.equal(f.calls.length,0);
    f.activation.isAllowed=()=>true;f.document.hidden=true;await f.runtime.receive();assert.equal(f.calls.length,0);
});
