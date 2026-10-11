import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';

const code=buildSync({entryPoints:['src/task-planner.ts'],bundle:true,write:false,format:'cjs',platform:'node',external:['obsidian']}).outputFiles[0].text;
const source='- [ ] Read 🔁 every day';
const completed='- [x] Read 🔁 every day ✅ 2026-10-11';
function host(initial='- [ ] Task',toggle=(line:string)=>source+'\n'+completed){
 class TFile{path='Tasks.md';extension='md';stat={mtime:1,size:100};}
 class Component{registerEvent(){}}
 const module={exports:{} as any};new Function('require','module','exports',code)((id:string)=>{if(id==='obsidian')return {Component,TFile};throw Error(id);},module,module.exports);
 const file=new TFile(),events=new Map<string,Function[]>();let body=initial,exists=true,error=false,calls=0,root='Journal';
 const trigger=(name:string)=>{for(const fn of events.get(name)||[])fn(file);};
 const read=async()=>{if(error)throw Error('temporary read failure');return body;};
 const vault={getAbstractFileByPath:(path:string)=>exists&&path===file.path?file:null,getMarkdownFiles:()=>exists?[file]:[],cachedRead:read,read,
  process:async(_file:unknown,fn:(body:string)=>string)=>{const next=fn(body);if(next!==body){body=next;trigger('modify');}},
  on:(name:string,fn:Function)=>{events.set(name,[...(events.get(name)||[]),fn]);return {};}};
 const app={vault,plugins:{plugins:{'obsidian-tasks-plugin':{apiV1:{executeToggleTaskDoneCommand:(line:string)=>{calls++;return toggle(line);}}}}}};
 const planner=new module.exports.TaskPlanner(app,()=>root);planner.schedule=()=>{};planner.onload();
 return {planner,vault,file,read:()=>body,write:(text:string)=>{body=text;trigger('modify');},fail:(value:boolean)=>{error=value;},remove:()=>{exists=false;trigger('delete');},trigger,root:(value:string)=>root=value,calls:()=>calls};
}

test('initial index emits once; unchanged ready, flush and force scans emit nothing',async()=>{
 const h=host();let notifications=0;h.planner.subscribe(()=>notifications++);await h.planner.ready();assert.equal(notifications,1);
 const row=h.planner.all()[0];for(let i=0;i<5;i++){await h.planner.ready();await h.planner.flush();await h.planner.rescan();}
 assert.equal(notifications,1);assert.equal(h.planner.all()[0],row);
});

test('a recurrence completion and its undo each publish one final consistent snapshot',async()=>{
 const h=host(source);await h.planner.ready();const snapshots:string[][]=[];
 h.planner.subscribe(()=>snapshots.push(h.planner.all().map((task:any)=>task.source)));
 await h.planner.update(h.planner.all()[0],{checked:true});assert.deepEqual(snapshots,[[source,completed]]);assert.equal(h.planner.canUndo(),true);
 await h.planner.undoLast();assert.deepEqual(snapshots,[[source,completed],[source]]);assert.equal(h.planner.canUndo(),false);
 await h.planner.flush();assert.equal(snapshots.length,2);
});

test('unrelated prose edits preserve task row identity and do not rebuild task views',async()=>{
 const h=host();await h.planner.ready();const row=h.planner.all()[0];let notifications=0;h.planner.subscribe(()=>notifications++);
 h.write('- [ ] Task\n\nAn independent paragraph.');await h.planner.flush();assert.equal(notifications,0);assert.equal(h.planner.all()[0],row);
 h.write('- [ ] Changed task\n\nAn independent paragraph.');await h.planner.flush();assert.equal(notifications,1);assert.notEqual(h.planner.all()[0],row);
});

test('task-free notes and no-op writes do not send empty notifications',async()=>{
 const h=host('A paragraph.');let notifications=0;h.planner.subscribe(()=>notifications++);await h.planner.ready();assert.equal(notifications,0);
 h.write('A different paragraph.');await h.planner.flush();h.remove();assert.equal(notifications,0);
 const ordinary=host();await ordinary.planner.ready();ordinary.planner.subscribe(()=>notifications++);await ordinary.planner.update(ordinary.planner.all()[0],{checked:false});assert.equal(notifications,0);
});

test('external completion of an undated recurrence rejects the old row before debounce flush',async()=>{
 const h=host(source);await h.planner.ready();const old=h.planner.all()[0];h.write(source+'\n'+completed);
 await assert.rejects(h.planner.update(old,{checked:true}),/正在刷新/);assert.equal(h.calls(),0);assert.equal(h.read(),source+'\n'+completed);
 await h.planner.flush();await assert.rejects(h.planner.update(old,{checked:true}),/版本已变化/);assert.equal(h.calls(),0);
 await h.planner.update(h.planner.all()[0],{checked:true});assert.equal(h.calls(),1);assert.equal(h.planner.all().length,3);
});

test('error and recovery each notify once, including repeated failed retry attempts',async()=>{
 const h=host();await h.planner.ready();let notifications=0;h.planner.subscribe(()=>notifications++);
 h.fail(true);h.trigger('modify');await h.planner.flush();assert.equal(notifications,1);assert.equal(h.planner.failures.size,1);assert.equal(h.planner.all().length,0);
 await h.planner.ready();await h.planner.rescan();assert.equal(notifications,1);
 h.fail(false);await h.planner.ready();assert.equal(notifications,2);assert.equal(h.planner.failures.size,0);assert.equal(h.planner.all().length,1);
});

test('deleting a failed source clears its warning even when no task entry remains',async()=>{
 const h=host();h.fail(true);let notifications=0;h.planner.subscribe(()=>notifications++);await h.planner.ready();assert.equal(h.planner.failures.size,1);
 const before=notifications;h.remove();assert.equal(h.planner.failures.size,0);assert.equal(notifications,before+1);h.trigger('delete');assert.equal(notifications,before+1);
});

test('rename, journal-root changes and deletions publish their actual task changes',async()=>{
 const h=host();await h.planner.ready();let notifications=0;h.planner.subscribe(()=>notifications++);
 h.file.path='Journal/2026-10-11.md';h.trigger('rename');await h.planner.flush();assert.equal(notifications,1);assert.equal(h.planner.all()[0].day,'2026-10-11');
 h.root('Elsewhere');await h.planner.ready();assert.equal(notifications,2);assert.equal(h.planner.all()[0].day,undefined);
 h.remove();assert.equal(notifications,3);assert.deepEqual(h.planner.all(),[]);
});

test('a stale concurrent read does not publish an obsolete snapshot after a completed write',async()=>{
 const h=host();await h.planner.ready();let release!:()=>void,entered!:()=>void;
 const gate=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>entered=resolve),read=h.vault.read;let once=true;
 h.vault.read=async()=>{if(once){once=false;const before=h.read();entered();await gate;return before;}return read();};
 const snapshots:string[][]=[];h.planner.subscribe(()=>snapshots.push(h.planner.all().map((task:any)=>task.source)));
 const scan=h.planner.rescan();await started;await h.planner.update(h.planner.all()[0],{content:'New task'});release();await scan;
 assert.deepEqual(snapshots,[['- [ ] New task']]);assert.equal(h.planner.all()[0].source,h.read());
});

const repeat=(line:string)=>line+'\n'+line.replace('[ ]','[x]')+' ✅ 2026-10-11';
test('queued completions of distinct recurrences survive their own line insertions',async()=>{
 const h=host(['A','B','C'].map(name=>'- [ ] '+name+' 🔁 every day').join('\n'),repeat);await h.planner.ready();
 const outcomes=await Promise.allSettled(h.planner.all().map((task:any)=>h.planner.update(task,{checked:true})));
 assert.deepEqual(outcomes.map(r=>r.status),['fulfilled','fulfilled','fulfilled']);assert.equal(h.calls(),3);assert.equal(h.planner.all().length,6);
 assert.equal(h.planner.all().filter((t:any)=>t.checked).length,3);
 await h.planner.undoLast();assert.equal(h.planner.all().length,5);assert.equal(h.planner.all().filter((t:any)=>t.checked).length,2);
});
test('queued recurrence above the first mutation survives a file-wide index revision',async()=>{
 const h=host('- [ ] A 🔁 every day\n- [ ] B 🔁 every day',repeat);await h.planner.ready();const [a,b]=h.planner.all();
 const outcomes=await Promise.allSettled([h.planner.update(b,{checked:true}),h.planner.update(a,{checked:true})]);
 assert.deepEqual(outcomes.map(r=>r.status),['fulfilled','fulfilled']);assert.equal(h.calls(),2);
});

test('queued mixed edits follow a recurrence insertion without losing metadata',async()=>{
 const h=host('- [ ] A 🔁 every day\n- [ ] B\n- [ ] C 🔁 every day',repeat);await h.planner.ready();const [a,b,c]=h.planner.all();
 await Promise.all([h.planner.update(a,{checked:true}),h.planner.update(b,{scheduled:'2026-10-12',time:{start:'09:00',end:'10:00'}}),h.planner.update(c,{checked:true})]);
 const edited=h.planner.all().find((t:any)=>t.title.includes('B'));assert.equal(edited.scheduled,'2026-10-12');assert.equal(edited.time,'09:00');assert.equal(h.calls(),2);
});
test('queued duplicate clicks never complete the newly generated identical occurrence',async()=>{
 const h=host(source+'\n- [ ] B 🔁 every day',repeat);await h.planner.ready();const [a,b]=h.planner.all();
 const results=await Promise.allSettled([h.planner.update(a,{checked:true}),h.planner.update(b,{checked:true}),h.planner.update(a,{checked:true})]);
 assert.deepEqual(results.map(r=>r.status),['fulfilled','fulfilled','rejected']);assert.equal(h.calls(),2);
});
test('identical distinct source rows remain distinct through queued writes',async()=>{
 const h=host([source,source,source].join('\n'),repeat);await h.planner.ready();await Promise.all(h.planner.all().map((t:any)=>h.planner.update(t,{checked:true})));
 assert.equal(h.calls(),3);assert.equal(h.planner.all().filter((t:any)=>t.checked).length,3);
});
test('an external edit during a write prevents rebasing subsequent queued actions',async()=>{
 const h=host('- [ ] A 🔁 every day\n- [ ] B 🔁 every day',repeat);await h.planner.ready();const [a,b]=h.planner.all();
 const process=h.vault.process;h.vault.process=async(f,fn)=>{await process(f,fn);h.write(h.read()+'\nExternal edit');};
 const results=await Promise.allSettled([h.planner.update(a,{checked:true}),h.planner.update(b,{checked:true})]);
 assert.deepEqual(results.map(r=>r.status),['fulfilled','rejected']);assert.equal(h.calls(),1);assert(h.read().endsWith('External edit'));
});
test('failed recurrence does not poison following queued actions',async()=>{
 const h=host('- [ ] Bad 🔁 every day\n- [ ] Good 🔁 every day',line=>{if(line.includes('Bad'))throw Error('Bad rule');return repeat(line);});await h.planner.ready();
 const outcomes=await Promise.allSettled(h.planner.all().map((t:any)=>h.planner.update(t,{checked:true})));
 assert.deepEqual(outcomes.map(r=>r.status),['rejected','fulfilled']);assert(h.read().startsWith('- [ ] Bad'));assert.equal(h.planner.all().length,3);
});
test('queued CRLF recurrence edits preserve all line endings',async()=>{
 const h=host('- [ ] A 🔁 every day\r\n- [ ] B 🔁 every day\r\nTail',repeat);await h.planner.ready();
 await Promise.all(h.planner.all().map((t:any)=>h.planner.update(t,{checked:true})));
 assert(h.read().split('\n').slice(0,-1).every(line=>line.endsWith('\r')));assert(h.read().endsWith('Tail'));
});

test('queued stale rows are never revived by another successful task mutation',async()=>{
 const h=host('- [ ] A 🔁 every day\n- [ ] B 🔁 every day',repeat);await h.planner.ready();const stale=h.planner.all()[1];
 h.write(h.read()+'\n- [ ] External');await h.planner.flush();const fresh=h.planner.all()[0];
 const results=await Promise.allSettled([h.planner.update(fresh,{checked:true}),h.planner.update(stale,{checked:true})]);
 assert.deepEqual(results.map(r=>r.status),['fulfilled','rejected']);assert.equal(h.calls(),1);
});
test('a failed post-write read does not authorize rebasing another recurrence',async()=>{
 const h=host('- [ ] A 🔁 every day\n- [ ] B 🔁 every day',repeat);await h.planner.ready();const [a,b]=h.planner.all(),process=h.vault.process;
 h.vault.process=async(f,fn)=>{await process(f,fn);h.fail(true);};
 const results=await Promise.allSettled([h.planner.update(a,{checked:true}),h.planner.update(b,{checked:true})]);
 assert.deepEqual(results.map(r=>r.status),['fulfilled','rejected']);assert.equal(h.calls(),1);assert.equal(h.planner.failures.size,1);
});
