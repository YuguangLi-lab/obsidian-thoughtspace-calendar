import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {planTasks} from '../src/task-planner-model';
import {dayTimeline} from '../src/day-timeline-model';

class ElementStub {
 children:ElementStub[]=[];dataset:Record<string,string>={};attrs=new Map<string,string>();className='';textContent='';hidden=false;disabled=false;checked=false;value='';id='';scrollTop=0;title='';open=false;draggable=false;
 style={setProperty(){}};onclick?:((event?:any)=>unknown);oninput?:((event?:any)=>unknown);onkeydown?:((event?:any)=>unknown);
 constructor(public ownerDocument:any,public tagName='div'){}
 createEl(tag:string,args:any={}){const element=new ElementStub(this.ownerDocument,tag);element.className=args.cls||'';element.textContent=args.text||'';element.value=args.value||'';for(const [name,value]of Object.entries(args.attr||{}))element.setAttribute(name,String(value));this.children.push(element);return element;}
 createDiv(args:any={}){return this.createEl('div',typeof args==='string'?{cls:args}:args);}
 createSpan(args:any={}){return this.createEl('span',typeof args==='string'?{cls:args}:args);}
 addClass(...names:string[]){this.className=[this.className,...names].filter(Boolean).join(' ');}
 toggleClass(name:string,enabled:boolean){const names=this.className.split(' ').filter(Boolean).filter(item=>item!==name);if(enabled)names.push(name);this.className=names.join(' ');}
 hasClass(name:string){return this.className.split(' ').includes(name);}
 setAttribute(name:string,value:string){this.attrs.set(name,value);if(name==='id')this.id=value;}
 getAttribute(name:string){return this.attrs.get(name)||null;}
 setText(text:string){this.textContent=text;}
 empty(){this.children=[];this.textContent='';}
 focus(){this.ownerDocument.activeElement=this;}
 querySelectorAll(selector:string):ElementStub[]{const matches=(element:ElementStub)=>selector.split(',').some(part=>part.startsWith('.')?element.hasClass(part.slice(1)):element.tagName===part);return this.children.flatMap(child=>[...(matches(child)?[child]:[]),...child.querySelectorAll(selector)]);}
 querySelector(selector:string){return this.querySelectorAll(selector)[0]||null;}
 get lastElementChild(){return this.children.at(-1);}
}
const code=buildSync({entryPoints:['src/journal-view.ts'],bundle:true,write:false,format:'cjs',platform:'node',external:['obsidian']}).outputFiles[0].text;
const panelCode=buildSync({entryPoints:['src/task-planner-view.ts'],bundle:true,write:false,format:'cjs',platform:'node',external:['obsidian']}).outputFiles[0].text;
const timelineCode=buildSync({entryPoints:['src/day-timeline-view.ts'],bundle:true,write:false,format:'cjs',platform:'node',external:['obsidian']}).outputFiles[0].text;
function host(){
 const notices:string[]=[],document:any={activeElement:null,defaultView:{clearTimeout(){}}};document.body=new ElementStub(document);
 class Base{constructor(..._args:any[]){};}
 class Notice{constructor(message:string){notices.push(message);}}
 const load=(source:string)=>{const module={exports:{} as any};new Function('require','module','exports',source)((id:string)=>{if(id==='obsidian')return new Proxy({Notice,setIcon:(el:ElementStub,icon:string)=>el.setAttribute('data-icon',icon)},{get:(target,key)=>key in target?(target as any)[key]:Base});throw Error(id);},module,module.exports);return module.exports;};
 const app={workspace:{requestSaveLayout(){}},vault:{process(){throw Error('A timer action must not change Markdown');}}},root=new ElementStub(document);
 const planner={all:()=>[] as ReturnType<typeof planTasks>,focusKey:(task:any)=>`${task.path}:${task.line}:${task.source}`,canToggle:()=>true,update(){throw Error('A timer action must not change a task');},failures:new Map()};
 return {JournalView:load(code).JournalView,TaskPanel:load(panelCode).TaskPanel,DayTimeline:load(timelineCode).DayTimeline,document,notices,app,root,planner};
}
const day='2026-10-11',path=`Journal/${day}.md`,tick=()=>new Promise(resolve=>setImmediate(resolve));
const tasks=()=>planTasks('- [ ] 09:00 写作 #work 🔁 every day ⏳ 2026-10-11 ^write\n- [ ] 09:00 写作 #work 🔁 every day ⏳ 2026-10-12 ^write\n- [x] 10:00 已完成 ⏳ 2026-10-11\n- [ ] 未定时间 ⏳ 2026-10-11',path,'Journal');

test('old task panel and timeline constructor calls remain usable without Pomodoro actions',()=>{
 const h=host(),task=tasks()[0],panel=new h.TaskPanel(h.app,h.root,h.planner,day,{},false,undefined,undefined);
 panel.renderTaskRow(h.root,task);assert.equal(h.root.querySelectorAll('.ts-task-pomodoro').length,0);assert.equal(panel.menuActions(task).some((action:any)=>action.title==='开始计时'),false);
 const timeline=new h.DayTimeline(h.app,h.root,h.planner,day,undefined,{},async()=>{},true);timeline.row(h.root,dayTimeline([task],day).items[0]);assert.equal(h.root.querySelectorAll('.ts-timeline-pomodoro').length,0);
});

test('list and quadrant timer buttons retain each recurring occurrence and do not update tasks',async()=>{
 const h=host(),started:any[]=[],actions={startTask:async(task:any)=>{started.push(task);},open:async()=>{}},panel=new h.TaskPanel(h.app,h.root,h.planner,day,{},false,undefined,undefined,actions),[today,next]=tasks();
 panel.renderTaskRow(h.root,today);panel.view='quadrants';panel.renderTaskRow(h.root,next);
 const buttons=h.root.querySelectorAll('.ts-task-pomodoro');assert.equal(buttons.length,2);buttons[0].onclick?.();buttons[1].onclick?.();await tick();
 assert.equal(started[0],today);assert.equal(started[1],next);assert.notEqual(started[0].source,started[1].source);assert.equal(started[0].line,0);assert.equal(started[1].line,1);assert.equal(started[0].path,path);assert.equal(h.notices.length,0);
});

test('context menu offers focus only for unfinished tasks and forwards the source object',async()=>{
 const h=host(),started:any[]=[],actions={startTask:async(task:any)=>{started.push(task);},open:async()=>{}},panel=new h.TaskPanel(h.app,h.root,h.planner,day,{},false,undefined,undefined,actions),[task,,done]=tasks();
 const action=panel.menuActions(task).find((item:any)=>item.title==='开始计时');assert.ok(action);await action.run();assert.equal(started[0],task);
 assert.equal(panel.menuActions(done).some((item:any)=>item.title==='开始计时'),false);panel.renderTaskRow(h.root,done);assert.equal(h.root.querySelectorAll('.ts-task-pomodoro').length,0);
});

test('timeline focus uses task identity and excludes completed tasks and journal records',async()=>{
 const h=host(),started:any[]=[],actions={startTask:async(task:any)=>{started.push(task);},open:async()=>{}},timeline=new h.DayTimeline(h.app,h.root,h.planner,day,undefined,{},async()=>{},true,actions),[task,,done]=tasks();
 const item=dayTimeline([task],day).items[0],completed=dayTimeline([done],day).items[0];timeline.row(h.root,item);timeline.row(h.root,completed);timeline.row(h.root,{kind:'record',title:'随记',path,line:15,slot:{start:660,label:'11:00',title:'随记'}});
 const buttons=h.root.querySelectorAll('.ts-timeline-pomodoro');assert.equal(buttons.length,1);buttons[0].onclick?.();await tick();assert.equal(started[0],task);assert.equal(h.notices.length,0);
});

test('timeline untimed tasks can start focus with their original source and line',async()=>{
 const h=host(),started:any[]=[],actions={startTask:async(task:any)=>{started.push(task);},open:async()=>{}},untimed=tasks()[3];h.planner.all=()=>[untimed];
 const timeline=new h.DayTimeline(h.app,h.root,h.planner,day,undefined,{untimedOpen:true},async()=>{},true,actions);
 Object.assign(timeline,{body:h.root.createDiv(),clock:h.root.createSpan(),toggle:h.root.createEl('button'),done:h.root.createEl('button'),refreshClock(){}});timeline.renderContents();
 const button=h.root.querySelectorAll('.ts-timeline-pomodoro')[0];assert.ok(button);button.onclick?.();await tick();assert.equal(started[0],untimed);assert.equal(started[0].line,3);assert.equal(started[0].source,untimed.source);
});

test('timer errors are surfaced and the native task button is enabled again',async()=>{
 const h=host(),actions={startTask:async()=>{throw Error('已有另一项正在专注');},open:async()=>{}},panel=new h.TaskPanel(h.app,h.root,h.planner,day,{},false,undefined,undefined,actions);panel.renderTaskRow(h.root,tasks()[0]);
 const button=h.root.querySelectorAll('.ts-task-pomodoro')[0];button.onclick?.();assert.equal(button.disabled,true);await tick();assert.equal(button.disabled,false);assert.deepEqual(h.notices,['Error: 已有另一项正在专注']);
});

test('journal heading opens focus and injects the same optional actions into both task views',async()=>{
 const h=host();let opens=0;const actions={startTask:async()=>{},open:async()=>{opens++;}},children:any[]=[],journal=Object.create(h.JournalView.prototype);
 Object.assign(journal,{app:h.app,host:{taskPlanner:h.planner,pomodoroActions:actions,getJournalFile:async()=>{throw Error('A timer action must not create a journal');}},part:'calendar',taskPanelState:{view:'timeline'},timelineState:{},drafts:new Map(),pendingTasks:new Set()});
 journal.renderTaskArea(h.root,{addChild:(child:any)=>{children.push(child);return child;}},day);
 const button=h.root.querySelectorAll('.ts-journal-task-pomodoro')[0];assert.ok(button);button.onclick?.();await tick();assert.equal(opens,1);assert.equal(children.length,1);assert.equal(children[0].pomodoro,actions);const timeline=children[0].timelineFactory(h.root.createDiv());assert.equal(timeline.pomodoro,actions);assert.equal(h.notices.length,0);
});
