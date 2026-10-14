import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {createPomodoroState,defaultPomodoroConfig,type PomodoroState} from '../src/pomodoro-model';
import {createPomodoroStore,type PomodoroStorageAdapter} from '../src/pomodoro-store';

const path='.obsidian/plugins/calendar/pomodoro-state.json';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function gate(){let release!:()=>void;const promise=new Promise<void>(resolve=>release=resolve);return {promise,release};}
function state(title:string):PomodoroState{const value=createPomodoroState(defaultPomodoroConfig,1_000_000);value.session.target={title,path:'tasks.md',line:0,source:`- [ ] ${title}`};return value;}
function fixture(initial?:PomodoroState|string){
 const files=new Map<string,string>();if(initial!==undefined)files.set(path,typeof initial==='string'?initial:JSON.stringify(initial));
 const events:{action:string;path:string;next?:string}[]=[],hooks:{write?:(name:string,text:string)=>Promise<void>;rename?:(name:string,next:string)=>Promise<void>;read?:(name:string)=>Promise<void>;remove?:(name:string)=>Promise<void>}={};
 const adapter:PomodoroStorageAdapter={
  exists:async name=>{events.push({action:'exists',path:name});return files.has(name);},
  read:async name=>{events.push({action:'read',path:name});await hooks.read?.(name);if(!files.has(name))throw Error('missing');return files.get(name)!;},
  write:async(name,text)=>{events.push({action:'write',path:name});await hooks.write?.(name,text);files.set(name,text);},
  rename:async(name,next)=>{events.push({action:'rename',path:name,next});await hooks.rename?.(name,next);if(!files.has(name))throw Error('missing');files.set(next,files.get(name)!);files.delete(name);},
  remove:async name=>{events.push({action:'remove',path:name});await hooks.remove?.(name);files.delete(name);},
 };
 return {adapter,files,events,hooks,saved:()=>JSON.parse(files.get(path)!) as PomodoroState,temps:()=>[...files.keys()].filter(name=>name.includes('.tmp-'))};
}
const storeCode=buildSync({entryPoints:['src/pomodoro-store.ts'],bundle:true,write:false,format:'cjs',platform:'node'}).outputFiles[0].text;
function reloadedFactory(){const module={exports:{} as any};new Function('module','exports',storeCode)(module,module.exports);return module.exports.createPomodoroStore as typeof createPomodoroStore;}

test('disposed old temp write cannot overwrite a replacement store across a module reload',async()=>{
 const original=state('原状态'),f=fixture(original),entered=gate(),blocked=gate();let writes=0;
 f.hooks.write=async()=>{if(++writes===1){entered.release();await blocked.promise;}};
 const old=createPomodoroStore(f.adapter,path),oldWrite=old.save(state('旧实例'));const rejected=assert.rejects(oldWrite,/存储已关闭/);await entered.promise;old.dispose();
 await assert.rejects(old.load(),/存储已关闭/);await assert.rejects(old.save(state('关闭后的任务')),/存储已关闭/);
 const current=reloadedFactory()(f.adapter,path),load=current.load(),save=current.save(state('新实例'));let readFinished=false;load.then(()=>readFinished=true);
 await tick();assert.equal(readFinished,false);blocked.release();await rejected;assert.deepEqual(await load,original);await save;
 assert.equal(f.saved().session.target?.title,'新实例');assert.deepEqual(f.temps(),[]);assert.equal(f.events.filter(event=>event.action==='rename').length,1);current.dispose();
});

test('replacement load waits for an already running rename before its new save',async()=>{
 const f=fixture(state('原状态')),entered=gate(),blocked=gate();let renames=0;
 f.hooks.rename=async()=>{if(++renames===1){entered.release();await blocked.promise;}};
 const old=createPomodoroStore(f.adapter,path),write=old.save(state('旧实例已开始提交'));const rejected=assert.rejects(write,/存储已关闭/);await entered.promise;
 const current=createPomodoroStore(f.adapter,path),load=current.load(),save=current.save(state('新实例'));let readFinished=false;load.then(()=>readFinished=true);
 await tick();assert.equal(readFinished,false);blocked.release();await rejected;
 assert.equal((await load as PomodoroState).session.target?.title,'旧实例已开始提交');await save;assert.equal(f.saved().session.target?.title,'新实例');assert.deepEqual(f.temps(),[]);old.dispose();current.dispose();
});

test('two saves from one owner commit in request order using distinct temp files',async()=>{
 const f=fixture(),entered=gate(),blocked=gate();let writes=0;
 f.hooks.write=async()=>{if(++writes===1){entered.release();await blocked.promise;}};
 const store=createPomodoroStore(f.adapter,path),first=store.save(state('第一项')),second=store.save(state('第二项'));await entered.promise;await tick();assert.equal(writes,1);
 blocked.release();await Promise.all([first,second]);assert.equal(f.saved().session.target?.title,'第二项');assert.deepEqual(f.events.map(event=>event.action),['write','rename','write','rename']);
 assert.equal(new Set(f.events.filter(event=>event.action==='write').map(event=>event.path)).size,2);assert.deepEqual(f.temps(),[]);store.dispose();
});

test('new owner immediately closes the prior lease and old dispose cannot close the new owner',async()=>{
 const f=fixture(),old=createPomodoroStore(f.adapter,path),current=createPomodoroStore(f.adapter,path);
 await assert.rejects(old.load(),/存储已关闭/);await assert.rejects(old.save(state('失效任务')),/存储已关闭/);assert.equal(f.events.length,0);
 old.dispose();await current.save(state('当前任务'));assert.equal(f.saved().session.target?.title,'当前任务');current.dispose();
 await assert.rejects(current.load(),/存储已关闭/);await assert.rejects(current.save(state('关闭任务')),/存储已关闭/);assert.deepEqual(f.temps(),[]);
});

test('failed write or rename preserves the prior JSON, cleans its temp and allows retry',async()=>{
 for(const failure of ['write','rename'] as const){
  const original=state('保留任务'),f=fixture(original),error=Error(`${failure} failure`);let first=true;
  f.hooks[failure]=async(name:string)=>{if(first){first=false;if(failure==='write')f.files.set(name,'partial');throw error;}};
  const store=createPomodoroStore(f.adapter,path);await assert.rejects(store.save(state('失败任务')),caught=>caught===error);
  assert.deepEqual(f.saved(),original);assert.deepEqual(f.temps(),[]);await store.save(state('重试任务'));assert.equal(f.saved().session.target?.title,'重试任务');assert.deepEqual(f.temps(),[]);store.dispose();
 }
});

test('temp cleanup failure does not replace the original save error',async()=>{
 const f=fixture(state('原状态')),saveError=Error('rename failed'),cleanupError=Error('remove failed');
 f.hooks.rename=async()=>{throw saveError;};f.hooks.remove=async()=>{throw cleanupError;};
 const store=createPomodoroStore(f.adapter,path);await assert.rejects(store.save(state('失败任务')),caught=>caught===saveError);assert.equal(f.saved().session.target?.title,'原状态');store.dispose();
});

test('corrupt JSON is reported and preserved without writes, and repair can be read later',async()=>{
 const corrupt='{not valid json',f=fixture(corrupt),store=createPomodoroStore(f.adapter,path);
 await assert.rejects(store.load(),SyntaxError);assert.equal(f.files.get(path),corrupt);assert.equal(f.events.some(event=>event.action==='write'||event.action==='rename'),false);
 const repaired=state('修复后任务');f.files.set(path,JSON.stringify(repaired));assert.deepEqual(await store.load(),repaired);await store.save(state('修复后保存'));assert.equal(f.saved().session.target?.title,'修复后保存');store.dispose();
});

test('different adapters and different paths do not share owners or blocked queues',async()=>{
 const a=fixture(),b=fixture(),entered=gate(),blocked=gate();a.hooks.write=async name=>{if(name.startsWith(path+'.tmp-')){entered.release();await blocked.promise;}};
 const first=createPomodoroStore(a.adapter,path),otherPath=createPomodoroStore(a.adapter,path+'.other'),otherAdapter=createPomodoroStore(b.adapter,path);
 const pending=first.save(state('阻塞任务'));await entered.promise;let pathDone=false,adapterDone=false;
 const pathWrite=otherPath.save(state('另一文件')).then(()=>pathDone=true),adapterWrite=otherAdapter.save(state('另一适配器')).then(()=>adapterDone=true);
 await tick();const independent=pathDone&&adapterDone;blocked.release();await Promise.all([pending,pathWrite,adapterWrite]);assert.equal(independent,true);
 assert.equal(a.saved().session.target?.title,'阻塞任务');assert.equal(JSON.parse(a.files.get(path+'.other')!).session.target.title,'另一文件');assert.equal(b.saved().session.target?.title,'另一适配器');first.dispose();otherPath.dispose();otherAdapter.dispose();
});

test('disposal cancels queued saves and removes the sole in-flight temporary file',async()=>{
 const f=fixture(),entered=gate(),blocked=gate();f.hooks.write=async()=>{entered.release();await blocked.promise;};
 const store=createPomodoroStore(f.adapter,path),first=store.save(state('正在写入')),second=store.save(state('等待写入'));
 const rejectedFirst=assert.rejects(first,/存储已关闭/),rejectedSecond=assert.rejects(second,/存储已关闭/);await entered.promise;store.dispose();blocked.release();await Promise.all([rejectedFirst,rejectedSecond]);
 assert.equal(f.events.filter(event=>event.action==='write').length,1);assert.equal(f.events.some(event=>event.action==='rename'),false);assert.deepEqual(f.temps(),[]);assert.equal(f.files.has(path),false);
});

test('a pending old read rejects after ownership changes and the new load succeeds',async()=>{
 const original=state('原状态'),f=fixture(original),entered=gate(),blocked=gate();let reads=0;
 f.hooks.read=async()=>{if(++reads===1){entered.release();await blocked.promise;}};
 const old=createPomodoroStore(f.adapter,path),oldLoad=old.load(),rejected=assert.rejects(oldLoad,/存储已关闭/);await entered.promise;
 const current=createPomodoroStore(f.adapter,path),newLoad=current.load();blocked.release();await rejected;assert.deepEqual(await newLoad,original);assert.deepEqual(f.temps(),[]);old.dispose();current.dispose();
});

test('custom atomic replacement updates existing JSON when the adapter cannot overwrite',async()=>{
 const original=state('已有任务'),f=fixture(original);let adapterRenames=0,replacements=0;
 f.adapter.rename=async(from,to)=>{adapterRenames++;if(f.files.has(to))throw Error('Destination file already exists!');f.files.set(to,f.files.get(from)!);f.files.delete(from);};
 await assert.rejects(f.adapter.rename('probe-temp',path),/Destination file already exists/);adapterRenames=0;
 const store=createPomodoroStore(f.adapter,path,async(from,to)=>{
  replacements++;assert.deepEqual(f.saved(),original);assert.equal(f.files.has(from),true);
  f.files.set(to,f.files.get(from)!);f.files.delete(from);
 });
 await store.save(state('替换后的任务'));assert.equal(f.saved().session.target?.title,'替换后的任务');assert.equal(adapterRenames,0);assert.equal(replacements,1);assert.deepEqual(f.temps(),[]);store.dispose();
});

test('failed custom replacement preserves the old file and cleans its temp before retry',async()=>{
 const original=state('保留任务'),f=fixture(original),error=Error('Atomic replacement failed');let attempts=0;
 const store=createPomodoroStore(f.adapter,path,async(from,to)=>{if(++attempts===1)throw error;f.files.set(to,f.files.get(from)!);f.files.delete(from);});
 await assert.rejects(store.save(state('失败任务')),caught=>caught===error);assert.deepEqual(f.saved(),original);assert.deepEqual(f.temps(),[]);
 await store.save(state('成功重试'));assert.equal(f.saved().session.target?.title,'成功重试');assert.equal(attempts,2);assert.deepEqual(f.temps(),[]);store.dispose();
});
