import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {planTasks} from '../src/task-planner-model';
import {replaceTaskSpan,tasksToggleApi,tasksToggleLines} from '../src/tasks-integration';
const recurring='- [ ] Read #task 🔁 every day 📅 2026-10-11 ^reading';
const next='- [ ] Read #task 🔁 every day 📅 2026-10-12';
const done='- [x] Read #task 🔁 every day 📅 2026-10-11 ✅ 2026-10-11 ^reading';
const task=(line=recurring)=>planTasks(line,'Tasks.md','Journal')[0];
const code=buildSync({entryPoints:['src/task-planner.ts'],bundle:true,write:false,format:'cjs',platform:'node',external:['obsidian']}).outputFiles[0].text;
function host(initial=recurring,api?:unknown){
 class TFile{path='Tasks.md';extension='md';stat={mtime:1,size:14};}class Component{registerEvent(){} }
 const module={exports:{} as any};new Function('require','module','exports',code)((id:string)=>{if(id==='obsidian')return {Component,TFile};throw Error(id);},module,module.exports);
 const file=new TFile(),events=new Map<string,Function[]>();let body=initial;
 const vault={getAbstractFileByPath:(path:string)=>path===file.path?file:null,getMarkdownFiles:()=>[file],cachedRead:async()=>body,read:async()=>body,process:async(_f:unknown,fn:(body:string)=>string)=>{body=fn(body);for(const f of events.get('modify')||[])f(file);},on:(name:string,fn:Function)=>{events.set(name,[...(events.get(name)||[]),fn]);return {};}};
 const app={vault,plugins:{plugins:{} as Record<string,{apiV1:unknown}>}};if(api)app.plugins.plugins['obsidian-tasks-plugin']={apiV1:api};
 const planner=new module.exports.TaskPlanner(app,()=> 'Journal');planner.schedule=()=>{};planner.onload();
 return {planner,app,vault,file,read:()=>body,write:(value:string)=>body=value};
}
test('optional Tasks bridge detects the currently loaded API, including disabling it',()=>{
 const app:any={plugins:{plugins:{}}};assert.equal(tasksToggleApi(app),undefined);
 app.plugins.plugins['obsidian-tasks-plugin']={apiV1:{executeToggleTaskDoneCommand:'old version'}};assert.equal(tasksToggleApi(app),undefined);
 const api={executeToggleTaskDoneCommand:()=>done};app.plugins.plugins['obsidian-tasks-plugin'].apiV1=api;assert.equal(tasksToggleApi(app),api);
 delete app.plugins.plugins['obsidian-tasks-plugin'];assert.equal(tasksToggleApi(app),undefined);
});
test('Tasks output keeps recurrence order, block references and API binding',()=>{
 const api={prefix:next,executeToggleTaskDoneCommand(line:string,path:string){assert.equal(line,recurring);assert.equal(path,'Tasks.md');return this.prefix+'\n'+done;}};
 assert.deepEqual(tasksToggleLines(api,task()),[next,done]);
 assert.deepEqual(tasksToggleLines({executeToggleTaskDoneCommand:()=>done+'\n'+next},task()),[done,next]);
});
test('plain-checkbox fallback and invalid recurrence cannot silently finish a recurring task',async()=>{
 for(const output of [recurring.replace('[ ]','[x]'),done,recurring,done+'\n'+next.replace('🔁 every day ','')]){
  const h=host(recurring,{executeToggleTaskDoneCommand:()=>output});await h.planner.ready();
  await assert.rejects(h.planner.update(h.planner.all()[0],{checked:true}),/未生成下一次任务/);
  assert.equal(h.read(),recurring);assert.equal(h.planner.canUndo(),false);
 }
});
test('recurrence completion does not require a done date when Tasks disables that preference',()=>{
 const noDate=done.replace(' ✅ 2026-10-11','');
 assert.deepEqual(tasksToggleLines({executeToggleTaskDoneCommand:()=>next+'\n'+noDate},task()),[next,noDate]);
});
test('reopening a completed recurring task accepts one row and never generates an extra occurrence',async()=>{
 let calls=0;const h=host(done,{executeToggleTaskDoneCommand:()=>{calls++;return recurring;}});await h.planner.ready();
 await h.planner.update(h.planner.all()[0],{checked:false});assert.equal(h.read(),recurring);assert.equal(calls,1);
 await h.planner.undoLast();assert.equal(h.read(),done);
 assert.throws(()=>tasksToggleLines({executeToggleTaskDoneCommand:()=>done},task(done)),/未重新打开/);
});
test('rejected recurrence preserves an earlier undo receipt and allows later corrected completion',async()=>{
 let output=done;const h=host(recurring,{executeToggleTaskDoneCommand:()=>output});await h.planner.ready();
 await h.planner.update(h.planner.all()[0],{priority:1});const changed=h.read();
 await assert.rejects(h.planner.update(h.planner.all()[0],{checked:true}),/未生成下一次任务/);assert.equal(h.read(),changed);
 await h.planner.undoLast();assert.equal(h.read(),recurring);
 output=next+'\n'+done;await h.planner.update(h.planner.all()[0],{checked:true});assert.equal(h.read(),output);
});
test('malformed, empty, custom status or duplicate-reference Tasks results never persist',()=>{
 for(const value of ['',null,done+'\n'+next+'\n'+next,done.replace('[x]','[/]'),done.replace(' ^reading',''),done+'\n'+next+' ^reading'])
  assert.throws(()=>tasksToggleLines({executeToggleTaskDoneCommand:()=>value as string},task()));
});
test('recurring task completion without Tasks remains disabled and preserves original text',async()=>{
 const h=host();await h.planner.ready();assert.equal(h.planner.canToggle(h.planner.all()[0]),false);
 await assert.rejects(h.planner.update(h.planner.all()[0],{checked:true}),/Tasks/);assert.equal(h.read(),recurring);
});
test('completion calls the public API once, reindexes both rows, then bounded undo restores one task',async()=>{
 let count=0;const h=host('# Tasks\n'+recurring+'\nOther note',{executeToggleTaskDoneCommand:()=>{count++;return next+'\n'+done;}});await h.planner.ready();assert.equal(h.planner.canToggle(h.planner.all()[0]),true);
 await h.planner.update(h.planner.all()[0],{checked:true});assert.equal(count,1);assert.equal(h.planner.all().length,2);assert.equal(h.planner.all()[1].checked,true);
 h.write(h.read().replace('Other note','Edited independently'));
 await h.planner.undoLast();assert.equal(h.read(),'# Tasks\n'+recurring+'\nEdited independently');assert.equal(h.planner.all().length,1);
});
test('a stale source is rejected before calling Tasks, including repeat clicks queued together',async()=>{
 let count=0;const h=host(recurring,{executeToggleTaskDoneCommand:()=>{count++;return next+'\n'+done;}});await h.planner.ready();const original=h.planner.all()[0];
 const results=await Promise.allSettled([h.planner.update(original,{checked:true}),h.planner.update(original,{checked:true})]);assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');assert.equal(count,1);assert.equal(h.planner.all().length,2);
});
test('undated recurring occurrences cannot be completed twice through an old row snapshot',async()=>{
 const source='- [ ] Read 🔁 every day',completed='- [x] Read 🔁 every day ✅ 2026-10-11';let calls=0;
 const h=host(source,{executeToggleTaskDoneCommand:()=>{calls++;return source+'\n'+completed;}});await h.planner.ready();const original=h.planner.all()[0];
 const results=await Promise.allSettled([h.planner.update(original,{checked:true}),h.planner.update(original,{checked:true})]);
 assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');assert.equal(calls,1);
 assert.equal(h.read(),source+'\n'+completed);assert.notEqual(h.planner.all()[0].indexRevision,original.indexRevision);
 await assert.rejects(h.planner.update(original,{checked:true}),/版本已变化/);
 await h.planner.update(h.planner.all()[0],{checked:true});assert.equal(calls,2);assert.equal(h.planner.all().length,3);
 await h.planner.undoLast();assert.equal(h.read(),source+'\n'+completed);
});
test('multiline undo rejects an edited generated task without overwriting it',async()=>{
 const h=host(recurring,{executeToggleTaskDoneCommand:()=>next+'\n'+done});await h.planner.ready();await h.planner.update(h.planner.all()[0],{checked:true});h.write(h.read().replace('2026-10-12','2026-10-15'));
 const edited=h.read();await assert.rejects(h.planner.undoLast(),/已变化/);assert.equal(h.read(),edited);assert.equal(h.planner.canUndo(),true);
});
test('CRLF documents retain their exact line endings, including a task at EOF',async()=>{
 for(const ending of ['\r\n','']){
  const original='# Tasks\r\n'+recurring+ending,h=host(original,{executeToggleTaskDoneCommand:()=>next+'\n'+done});await h.planner.ready();await h.planner.update(h.planner.all()[0],{checked:true});assert.equal(h.read(),'# Tasks\r\n'+next+'\r\n'+done+ending);await h.planner.undoLast();assert.equal(h.read(),original);
 }
});
test('disabling Tasks between render and click is rechecked, errors do not poison write queue',async()=>{
 const h=host(recurring,{executeToggleTaskDoneCommand:()=>next+'\n'+done});await h.planner.ready();delete h.app.plugins.plugins['obsidian-tasks-plugin'];await assert.rejects(h.planner.update(h.planner.all()[0],{checked:true}),/Tasks/);
 await h.planner.update(h.planner.all()[0],{scheduled:'2026-10-12'});assert.equal(h.planner.all()[0].scheduled,'2026-10-12');
});
test('ordinary tasks retain native completion date behavior even with Tasks installed',async()=>{
 const h=host('- [ ] Plain ^plain',{executeToggleTaskDoneCommand:()=>{throw Error('must not call');}});await h.planner.ready();await h.planner.update(h.planner.all()[0],{checked:true});assert.match(h.read(),/^- \[x\] Plain ✅ \d{4}-\d{2}-\d{2} \^plain$/);await h.planner.undoLast();assert.equal(h.read(),'- [ ] Plain ^plain');
});
test('no-op repeated toggle does not generate another occurrence; mixed edits are explicit',async()=>{
 const h=host(recurring,{executeToggleTaskDoneCommand:()=>{throw Error('must not call');}});await h.planner.ready();await h.planner.update(h.planner.all()[0],{checked:false});assert.equal(h.read(),recurring);
 await assert.rejects(h.planner.update(h.planner.all()[0],{checked:true,priority:0}),/先保存/);assert.equal(h.read(),recurring);
});
test('bounded span guards invalid indices and preserves unrelated content',()=>{
 assert.equal(replaceTaskSpan('A\nB\nC',1,['B'],['D','E']),'A\nD\nE\nC');
 for(const index of [-1,1.5,4])assert.throws(()=>replaceTaskSpan('A\nB',index,['B'],['D']));
 assert.throws(()=>replaceTaskSpan('A\nB',1,[],['D']));
});
test('Tasks availability and plugin lifecycle are rechecked inside delayed vault transaction',async()=>{
 const h=host(recurring,{executeToggleTaskDoneCommand:()=>{throw Error('must not call disabled API');}});await h.planner.ready();const process=h.vault.process;
 h.vault.process=async(file,fn)=>{delete h.app.plugins.plugins['obsidian-tasks-plugin'];return process(file,fn);};
 await assert.rejects(h.planner.update(h.planner.all()[0],{checked:true}),/Tasks/);assert.equal(h.read(),recurring);
 h.vault.process=async(file,fn)=>{h.planner.stopped=true;return process(file,fn);};
 await assert.rejects(h.planner.update(h.planner.all()[0],{scheduled:'2026-10-12'}),/已重载/);assert.equal(h.read(),recurring);
});
