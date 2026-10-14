import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
const code=buildSync({entryPoints:['src/task-planner.ts'],bundle:true,write:false,format:'cjs',platform:'node',external:['obsidian']}).outputFiles[0].text;
function host(){
 class TFile {path='Tasks.md';extension='md';stat={mtime:1,size:100};}class Component {registerEvent(){}}
 const module={exports:{} as any};new Function('require','module','exports',code)((id:string)=>{if(id==='obsidian')return {TFile,Component};throw Error(id);},module,module.exports);
 const file=new TFile(),events=new Map<string,Function[]>();let body='- [ ] Read 🔁 every day 📅 2026-10-11\n- [ ] Read 🔁 every day 📅 2026-10-12';
 const trigger=()=>{for(const callback of events.get('modify')||[])callback(file);};
 const vault={getAbstractFileByPath:()=>file,getMarkdownFiles:()=>[file],read:async()=>body,cachedRead:async()=>body,on:(name:string,fn:Function)=>{events.set(name,[...(events.get(name)||[]),fn]);return {};},process:async(_file:unknown,fn:(text:string)=>string)=>{const next=fn(body);if(next!==body){body=next;trigger();}}};
 const toggle=(line:string)=>line.replace('2026-10-11','2026-10-12')+'\n'+line.replace('[ ]','[x]')+' ✅ 2026-10-11';
 const app={vault,plugins:{plugins:{'obsidian-tasks-plugin':{apiV1:{executeToggleTaskDoneCommand:toggle}}}}},planner=new module.exports.TaskPlanner(app,()=> 'Journal');planner.schedule=()=>{};planner.onload();
 return {planner,external:(text:string)=>{body=text;trigger();},text:()=>body};
}
test('verified recurrence followers retain focus identity across a same-source collision',async()=>{
 const h=host();await h.planner.ready();const [a,b]=h.planner.all(),aKey=h.planner.focusKey(a),bKey=h.planner.focusKey(b);await h.planner.update(a,{checked:true});
 const next=h.planner.all();assert.equal(next[0].source,next[2].source);assert.equal(h.planner.focusKey(next[2]),bKey);assert.notEqual(h.planner.focusKey(next[0]),bKey);assert.notEqual(h.planner.focusKey(next[0]),aKey);
 await h.planner.undoLast();assert.equal(h.planner.focusKey(h.planner.all()[1]),bKey);
});
test('focus identity survives own attribute edits but is not rebased through external edits',async()=>{
 const h=host();await h.planner.ready();const task=h.planner.all()[1],key=h.planner.focusKey(task);await h.planner.update(task,{priority:1});assert.equal(h.planner.focusKey(h.planner.all()[1]),key);
 h.external(h.text()+'\n- [ ] External');await h.planner.flush();assert.notEqual(h.planner.focusKey(h.planner.all()[1]),key);
});
