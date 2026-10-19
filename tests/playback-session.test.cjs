const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const script=fs.readFileSync('internal/web/templates/static/js/app.js','utf8');
const code=script.slice(script.indexOf('// Playback sessions store song metadata'));
function setup(storage={record:null,local:new Map()}) {
 const handlers={},audioHandlers={},calls=[];
 const ap={on:(name,fn)=>(handlers[name]??=[]).push(fn),
  audio:{currentTime:0,readyState:0,duration:300,addEventListener:(name,fn)=>audioHandlers[name]=fn},
  pause(){calls.push('pause');},seek(time){calls.push(['seek',time]);},
  list:{audios:[],index:0,
   add(songs){handlers.listadd?.forEach(fn=>fn());this.audios.push(...songs);},
   switch(index){this.index=index;handlers.listswitch?.forEach(fn=>fn({index}));},
   clear(){handlers.listclear?.forEach(fn=>fn());this.audios=[];}
  }
 };
 const ctx={ap,console,queueMicrotask,Date,showToast:(...args)=>calls.push(['toast',...args]),
  serializeSongExtra:value=>JSON.stringify(value||{}),
  playbackEntryFromSong:s=>({custom_id:s.id,source:s.source,name:s.name,url:'fresh-stream:'+s.id}),
  syncPlayerTrackControls(){},document:{readyState:'loading',addEventListener(){}},window:{addEventListener(){}},
  localStorage:{getItem:key=>storage.local.get(key)||null,setItem:(key,value)=>storage.local.set(key,value),removeItem:key=>storage.local.delete(key)},
 };
 vm.createContext(ctx);vm.runInContext(code,ctx);
 ctx.writePlaybackSession=async session=>{storage.record=structuredClone(session);};
 ctx.readPlaybackSession=async()=>storage.record;
 return {ctx,ap,calls,audioHandlers,storage};
}
const song=i=>({custom_id:String(i),source:'local',name:'Song '+i,url:'expired-url',lrc:'expired-lyrics'});
test('2880-song session survives restart with selected song and position, without autoplay',async()=>{
 const first=setup();first.ap.list.add(Array.from({length:2880},(_,i)=>song(i)));
 first.ap.list.switch(2500);first.ap.audio.currentTime=142.3;
 await Promise.resolve();await Promise.resolve();
 assert.equal(first.storage.record.songs.length,2880);
 assert.equal(first.storage.record.songs[0].url,undefined);
 const next=setup(first.storage);await next.ctx.restorePlaybackSession();
 assert.equal(next.ap.list.audios.length,2880);assert.equal(next.ap.list.index,2500);
 assert.equal(next.ap.list.audios[2500].url,'fresh-stream:2500');
 assert.ok(next.calls.includes('pause'));assert.ok(!next.calls.includes('play'));
 next.audioHandlers.loadedmetadata();assert.ok(next.calls.some(c=>Array.isArray(c)&&c[0]==='seek'&&c[1]===142.3));
});
test('clear persists an empty queue and cannot resurrect the previous playlist',async()=>{
 const first=setup();first.ap.list.add([song(1)]);await Promise.resolve();
 first.ap.list.clear();await Promise.resolve();await Promise.resolve();
 const next=setup(first.storage);await next.ctx.restorePlaybackSession();
 assert.equal(next.ap.list.audios.length,0);assert.equal(first.storage.record.songs.length,0);
});
test('slow restore cannot overwrite a new playlist chosen by the user',async()=>{
 const s=setup();let release;s.ctx.readPlaybackSession=()=>new Promise(resolve=>release=resolve);
 const restore=s.ctx.restorePlaybackSession();s.ap.list.add([song('new')]);
 release({version:1,songs:[{id:'old',source:'local'}]});await restore;
 assert.equal(s.ap.list.audios.length,1);assert.equal(s.ap.list.audios[0].custom_id,'new');
});
test('delayed metadata cannot seek a different song after the user switches',async()=>{
 const s=setup({record:{version:1,songs:[{id:'1',source:'local'},{id:'2',source:'local'}]},local:new Map([['musicdl:playback-position',JSON.stringify({id:'1',source:'local',position:40})]])});
 await s.ctx.restorePlaybackSession();s.ap.list.switch(1);s.audioHandlers.loadedmetadata();
 assert.ok(!s.calls.some(c=>Array.isArray(c)&&c[0]==='seek'));
});
