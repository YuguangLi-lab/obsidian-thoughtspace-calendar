import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {planTasks} from '../src/task-planner-model';
const code=buildSync({entryPoints:['src/task-planner-view.ts'],bundle:true,write:false,format:'cjs',platform:'node',external:['obsidian']}).outputFiles[0].text;
function host(query:string,tag:string){
 const module={exports:{} as any};class Base{};new Function('require','module','exports',code)((id:string)=>{if(id==='obsidian')return new Proxy({},{get:()=>Base});throw Error(id);},module,module.exports);
 const options:string[]=[],group:any={hidden:false};let selection:any,caption='';
 const panel=Object.create(module.exports.TaskPanel.prototype);
 Object.assign(panel,{view:'timeline',query,tag,filter:'today',day:'2026-10-11',tabs:new Map(),viewButtons:new Map(),tagSelect:{empty:()=>options.length=0,createEl:(_tag:string,args:any)=>options.push(args.value),value:''},filterSummary:{setText:(text:string)=>caption=text},el:{dataset:{},querySelector:(selector:string)=>selector==='.ts-task-group-select'?group:null},planner:{all:()=>planTasks('- [ ] 09:00 Read #work ⏳ 2026-10-11\n- [ ] 10:00 Other #home ⏳ 2026-10-11','Tasks.md','Journal')},timelineFactory:()=>{},timeline:{setFilter:(...args:any[])=>selection=args}});
 return {panel,options,group,selection:()=>selection,caption:()=>caption};
}
test('timeline applies the existing search and tag and refreshes available tag options',()=>{
 const h=host('read','#work');h.panel.renderContents();assert.deepEqual(h.selection(),['read','#work']);assert.deepEqual(h.options,['','#home','#work']);assert.match(h.caption(),/时间线/);assert.equal(h.group.hidden,true);
});
test('clearing timeline search propagates immediately and missing tags reset',()=>{
 const h=host('','#deleted');h.panel.renderContents();assert.deepEqual(h.selection(),['','']);assert.equal(h.panel.tag,'');
});
test('planner refresh keeps independent quadrant scroll positions during continuous actions',()=>{
 const h=host('',''),old=[{dataset:{quadrant:'q1'},scrollTop:136},{dataset:{quadrant:'q2'},scrollTop:45}],next=[{dataset:{quadrant:'q1'},scrollTop:0},{dataset:{quadrant:'q2'},scrollTop:0}];let boxes=old;
 h.panel.active=true;h.panel.view='quadrants';h.panel.el.ownerDocument={activeElement:null};h.panel.el.querySelectorAll=(selector:string)=>selector==='.ts-task-quadrant'?boxes:[];
 h.panel.renderContents=()=>boxes=next;h.panel.render();assert.deepEqual(boxes.map(box=>box.scrollTop),[136,45]);
});
test('an invalidated tag clears the filtered caption in the same refresh',()=>{
 const h=host('','#deleted');h.panel.renderContents();assert.doesNotMatch(h.caption(),/已筛选/);
});
test('index notification refreshes timeline once while adopting a removed tag',()=>{
 const timelineCode=buildSync({entryPoints:['src/day-timeline-view.ts'],bundle:true,write:false,format:'cjs',platform:'node',external:['obsidian']}).outputFiles[0].text;
 const module={exports:{} as any};class Base{};new Function('require','module','exports',timelineCode)((id:string)=>{if(id==='obsidian')return new Proxy({},{get:()=>Base});throw Error(id);},module,module.exports);
 const h=host('','#deleted'),timeline=Object.create(module.exports.DayTimeline.prototype);let renders=0;
 Object.assign(timeline,{query:'',tag:'#deleted',limit:40,render:()=>renders++});h.panel.timeline=timeline;
 h.panel.renderContents(true);timeline.render();assert.equal(renders,1);assert.equal(timeline.tag,'');
});
