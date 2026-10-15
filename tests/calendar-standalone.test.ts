import test from 'node:test';import assert from 'node:assert/strict';import {buildSync} from 'esbuild';import {calendarSettings} from '../src/calendar-settings';
const bundle=buildSync({entryPoints:['src/main.ts'],bundle:true,platform:'node',format:'cjs',external:['obsidian'],write:false}).outputFiles[0].text;
class Component{cleanups:Array<()=>void>=[];children=new Set<any>();load(){(this as any).onload?.()}unload(){(this as any).onunload?.();for(const c of this.children)c.unload();for(const fn of this.cleanups)fn()}addChild(c:any){this.children.add(c);c.load();return c}removeChild(c:any){c.unload();this.children.delete(c)}register(fn:()=>void){this.cleanups.push(fn)}registerEvent(){}registerInterval(){}}
class TFolder{constructor(public path:string){}}
class TFile{properties:Record<string,unknown>={};stat={size:1,mtime:1,ctime:1};extension='md';constructor(public path:string){}get name(){return this.path.split('/').pop()!}get basename(){return this.name.replace(/\.md$/,'')}get parent(){return{path:this.path.slice(0,this.path.lastIndexOf('/'))}}}
const loadedPlugins=new Set<any>();
test.afterEach(()=>{for(const plugin of loadedPlugins)plugin.unload();loadedPlugins.clear();});
class Plugin extends Component{app:any;manifest={id:'thoughtspace-calendar',version:'1.0.0'};saved:any=null;written:any;views=new Map();processors=new Map();commands:any[]=[];ribbons:any[]=[];domEvents:any[]=[];layoutCallbacks:any[]=[];loadData=async()=>this.saved;saveData=async(v:any)=>{this.written=v};registerView(id:string,f:any){this.views.set(id,f)}registerMarkdownCodeBlockProcessor(id:string,f:any){this.processors.set(id,f)}registerDomEvent(el:any,event:string,callback:any){this.domEvents.push({el,event,callback});}addStatusBarItem(){return{dataset:{},addClass(){},setAttribute(){},setText(){}}}addRibbonIcon(icon:string,title:string,callback:any){this.ribbons.push({icon,title,callback});}addCommand(c:any){this.commands.push(c)}addSettingTab(){}}
class ViewElement{isConnected=false;scrollTop=0;textContent='';children:any[]=[];addClass(){}empty(){this.children=[];this.textContent='';}setText(value:string){this.textContent=value;}createDiv(options:any={}){return this.createEl('div',options);}createEl(tag:string,options:any={}){const element:any={tag,textContent:options.text||'',disabled:false,onclick:undefined};this.children.push(element);return element;}}
class ItemView extends Component{app:any;leaf:any;contentEl=new ViewElement();constructor(leaf:any){super();this.leaf=leaf;this.app=leaf.app;}}
const stub={Component,MarkdownRenderChild:Component,Plugin,PluginSettingTab:class{constructor(..._:any[]){}},Modal:class{},ItemView,FuzzySuggestModal:class{},Notice:class{},TFile,TFolder,normalizePath:(s:string)=>s,Setting:class{}};
const mod={exports:{} as any};new Function('require','module','exports',bundle)(()=>stub,mod,mod.exports);const Calendar=mod.exports.default;
(globalThis as any).window={clearTimeout,setTimeout};
(globalThis as any).document={createElement:()=>({dataset:{},remove(){}}),head:{appendChild(){}}};
function fixture(legacy?:unknown){const files=new Map<string,TFile|TFolder>(),text=new Map<string,string>(),plugin=new Calendar(),layouts:any[]=[],leaves:any[]=[],revealed:any[]=[];let created=0,layoutSaves=0;loadedPlugins.add(plugin);const legacyPath='.obsidian/plugins/thoughtspace/data.json';if(legacy)text.set(legacyPath,JSON.stringify(legacy));
 plugin.app={plugins:{getPlugin:()=>undefined},vault:{configDir:'.obsidian',adapter:{exists:async(p:string)=>text.has(p)||files.has(p),read:async(p:string)=>text.get(p),write:async(p:string,t:string)=>{text.set(p,t)},rename:async(from:string,to:string)=>{const value=text.get(from);if(value===undefined)throw Error('missing');text.set(to,value);text.delete(from);},remove:async(p:string)=>{text.delete(p);},mkdir:async(p:string)=>{files.set(p,new TFolder(p))}},getAbstractFileByPath:(p:string)=>files.get(p),getMarkdownFiles:()=>[...files.values()].filter(f=>f instanceof TFile),read:async(f:TFile)=>text.get(f.path),cachedRead:async(f:TFile)=>text.get(f.path)||'',process:async(f:TFile,fn:(s:string)=>string)=>{text.set(f.path,fn(text.get(f.path)||''))},createFolder:async(p:string)=>{files.set(p,new TFolder(p))},create:async(p:string,t:string)=>{if(files.has(p))throw Error('exists');const f=new TFile(p);created++;files.set(p,f);text.set(p,t);return f},on:()=>({}),offref(){}},metadataCache:{on:()=>({}),offref(){},getFileCache:(file:TFile)=>({frontmatter:file.properties})},fileManager:{processFrontMatter:async(file:TFile,fn:(properties:Record<string,unknown>)=>void)=>{const next=structuredClone(file.properties);fn(next);file.properties=next;},renameFile:async(f:TFile,p:string)=>{const t=text.get(f.path)!;files.delete(f.path);text.delete(f.path);f.path=p;files.set(p,f);text.set(p,t)}},workspace:{onLayoutReady:(fn:any)=>layouts.push(fn),getLeavesOfType:(type:string)=>leaves.filter(l=>l.type===type),iterateAllLeaves:(fn:(leaf:any)=>void)=>{for(const leaf of [...leaves])fn(leaf);},getRightLeaf:()=>newLeaf(),getLeaf:()=>{const l={type:'markdown',view:{file:undefined as TFile|undefined},getViewState(){return{type:'markdown',state:{}};},openFile:async(file:TFile)=>{l.view.file=file;}};leaves.push(l);return l;},activeLeaf:undefined as any,setActiveLeaf(leaf:any){plugin.app.workspace.activeLeaf=leaf;},requestSaveLayout(){layoutSaves++;},rightSplit:{expand(){}},revealLeaf:async(leaf:any)=>{revealed.push(leaf);plugin.app.workspace.activeLeaf=leaf;}}};
 function newLeaf(type='',state:Record<string,unknown>={}){
  const leaf:any={app:plugin.app,type,view:undefined,stateChanges:[] as any[],loads:0,detached:false,
   getViewState(){return{type:this.type,state:this.view?.getState?.()||{}};},
   async setViewState(next:any){this.stateChanges.push(next);await this.view?.onClose?.();this.type=next.type;const factory=plugin.views.get(next.type);this.view=factory?factory(this):undefined;if(next.state&&this.view?.setState)await this.view.setState(next.state);},
   async loadIfDeferred(){this.loads++;},detach(){this.detached=true;void this.view?.onClose?.();const index=leaves.indexOf(this);if(index>=0)leaves.splice(index,1);}};
  if(type){const factory=plugin.views.get(type);leaf.view=factory?factory(leaf):undefined;if(leaf.view&&Object.keys(state).length)void leaf.view.setState?.(state);}
  leaves.push(leaf);return leaf;
 }
 function newDeferredLeaf(type:string,state:Record<string,unknown>={}){
  const leaf=newLeaf(),saved={type,state:structuredClone(state)};leaf.type='deferred';leaf.view={getViewType:()=> 'deferred'};
  leaf.getViewState=()=>leaf.type==='deferred'?saved:{type:leaf.type,state:leaf.view?.getState?.()||{}};
  leaf.loadIfDeferred=async()=>{leaf.loads++;if(leaf.type!=='deferred')return;const factory=plugin.views.get(saved.type);leaf.type=saved.type;leaf.view=factory?factory(leaf):undefined;if(leaf.view?.setState)await leaf.view.setState(saved.state);};
  return leaf;
 }
 return{plugin,files,text,layouts,leaves,revealed,newLeaf,newDeferredLeaf,created:()=>created,layoutSaves:()=>layoutSaves};}

test('calendar loads without ThoughtSpace and owns its calendar, journal, large calendar and task renderer',async()=>{const f=fixture();await f.plugin.onload();assert.deepEqual([...f.plugin.views.keys()].sort(),['thoughtspace-calendar','thoughtspace-journal','thoughtspace-large-calendar','thoughtspace-pomodoro']);assert.deepEqual([...f.plugin.processors.keys()],['thoughtspace-tasks']);assert.equal(f.plugin.ensureDock,undefined);assert(f.plugin.ready);f.plugin.unload();assert.equal(f.plugin.ready,false);});
test('large calendar shares the task index and initializes it only once',async()=>{const f=fixture();await f.plugin.onload();let reads=0;f.plugin.taskPlanner.ready=async()=>{reads++;};f.plugin.taskPlanner.all=()=>[];await f.plugin.largeCalendarHost.tasks(new Date(2026,9,1),new Date(2026,10,1));await f.plugin.largeCalendarHost.tasks(new Date(2026,9,1),new Date(2026,10,1));assert.equal(reads,1);f.plugin.unload();});
test('settings save preserves the latest Apple selection even with an older settings draft',async()=>{const f=fixture();await f.plugin.onload();const draft={...f.plugin.settings,accent:'rose'};await Promise.all([f.plugin.saveAppleCalendarSettings({enabled:true,selectedCalendarIds:['c'],defaultCalendarId:'c'}),f.plugin.updateSettings(draft,true)]);assert.equal(f.plugin.settings.accent,'rose');assert.equal(f.plugin.settings.appleCalendar.enabled,true);assert.deepEqual(f.plugin.settings.appleCalendar.selectedCalendarIds,['c']);f.plugin.unload();});
test('Apple connection is off by default and does not migrate another plugin permission',()=>{assert.equal(calendarSettings(null,{appleCalendar:{enabled:true,selectedCalendarIds:['old']}}).appleCalendar.enabled,false);assert.equal(calendarSettings({}).appleCalendar.enabled,false);});
test('Apple calendar selections normalize and bound malformed stored values',()=>{const settings=calendarSettings({appleCalendar:{enabled:'true',selectedCalendarIds:['c','c',null,1,'','x'.repeat(1025)],defaultCalendarId:5}});assert.equal(settings.appleCalendar.enabled,false);assert.deepEqual(settings.appleCalendar.selectedCalendarIds,['c']);assert.equal(settings.appleCalendar.defaultCalendarId,'');});
test('first load imports only calendar settings without modifying legacy data',async()=>{const old={journalFolder:'我的日记',cardFolder:'收集箱',accent:'blue',glassEffects:false,secret:'not migrated'},f=fixture(old);const before=f.text.get('.obsidian/plugins/thoughtspace/data.json');await f.plugin.onload();assert.equal(f.plugin.settings.journalFolder,'我的日记');assert.equal(f.plugin.settings.accent,'blue');assert(!('secret' in f.plugin.written));assert.equal(f.text.get('.obsidian/plugins/thoughtspace/data.json'),before);});
test('saved standalone settings take precedence over later legacy changes',()=>{assert.equal(calendarSettings({journalFolder:'独立日记',cardFolder:'笔记'},{journalFolder:'旧日记'}).journalFolder,'独立日记');assert.throws(()=>calendarSettings({journalFolder:'../outside'}));});
test('concurrent daily-note creation creates one Markdown file and one live task block',async()=>{const f=fixture();await f.plugin.onload();const [a,b]=await Promise.all([f.plugin.ensureJournalFile('2026-09-15'),f.plugin.ensureJournalFile('2026-09-15')]);assert.equal(a,b);assert.equal(f.created(),1);assert.equal(a.path,'ThoughtSpace/日记/2026/09/2026-09-15.md');assert.equal((f.text.get(a.path)!.match(/```thoughtspace-tasks/g)||[]).length,1);});
test('existing legacy diary is reused without moving its file or losing prose',async()=>{const f=fixture();await f.plugin.onload();const path='ThoughtSpace/日记/2026-09-15.md',note=new TFile(path);f.files.set(path,note);f.text.set(path,'# 日记\n\n保留原文\n');assert.equal(await f.plugin.ensureJournalFile('2026-09-15'),note);assert.equal(note.path,path);assert(f.text.get(path)!.includes('保留原文'));assert.equal(f.created(),0);});
test('existing target folder blocks note creation rather than overwriting it',async()=>{const f=fixture();await f.plugin.onload();const path='ThoughtSpace/日记/2026/09/2026-09-15.md';f.files.set(path,new TFolder(path));await assert.rejects(f.plugin.ensureJournalFile('2026-09-15'),/文件夹/);assert.equal(f.created(),0);});
test('repeated pane requests reuse a single leaf and disabled plugin refuses new panes',async()=>{const f=fixture();await f.plugin.onload();const [a,b]=await Promise.all([f.plugin.ensureCalendar(false),f.plugin.ensureCalendar(true)]);assert.equal(a,b);assert.equal(f.leaves.length,1);f.plugin.onunload();await assert.rejects(f.plugin.ensureCalendar(),/关闭/);});

const calendarType='thoughtspace-calendar',legacyTimerType='thoughtspace-pomodoro',uiTick=()=>new Promise(resolve=>setTimeout(resolve,0));
test('calendar and timer requests share one pane during rapid repeated opens',async()=>{
 const f=fixture();await f.plugin.onload();
 const [calendar]=await Promise.all([f.plugin.ensureCalendar(false),f.plugin.openPomodoro(),f.plugin.openPomodoro(),f.plugin.pomodoroActions.open(),f.plugin.largeCalendarHost.openTimer()]);
 assert.equal(f.leaves.length,1);assert.equal(f.leaves[0],calendar);assert.equal(calendar.type,calendarType);assert.equal(calendar.view.getState().topPane,'timer');assert.equal(f.leaves.filter(leaf=>leaf.type===legacyTimerType).length,0);
 assert.equal(calendar.stateChanges.length,1);assert(f.revealed.every(leaf=>leaf===calendar));
});
test('opening the calendar timer retains diary date and task layout without changing a running clock',async()=>{
 const f=fixture();await f.plugin.onload();const calendar=await f.plugin.ensureCalendar();
 await calendar.view.setState({day:'2026-10-11',month:'2026-10',taskView:'quadrants',calendarCollapsed:true});
 f.plugin.pomodoro.now=()=>Date.UTC(2026,9,14,1);await f.plugin.pomodoro.startTimer({title:'保护进行中的任务'},'stopwatch');
 const before=f.plugin.pomodoro.snapshot().state;await f.plugin.openPomodoro();await f.plugin.openPomodoro();
 const state=calendar.view.getState();assert.equal(state.topPane,'timer');assert.equal(state.day,'2026-10-11');assert.equal(state.month,'2026-10');assert.equal(state.taskView,'quadrants');assert.equal(state.calendarCollapsed,true);
 assert.strictEqual(f.plugin.pomodoro.snapshot().state,before);assert.equal(f.leaves.length,1);assert.equal(calendar.stateChanges.length,1);
});
test('status-bar and retained timer command route to the calendar without a separate ribbon',async()=>{
 const f=fixture();await f.plugin.onload();assert.equal(f.plugin.ribbons.some((ribbon:any)=>ribbon.icon==='timer'),false);assert.equal(f.plugin.ribbons.some((ribbon:any)=>ribbon.title==='ThoughtSpace 日历'),true);
 f.plugin.commands.find((command:any)=>command.id==='show-pomodoro').callback();await uiTick();const calendar=f.leaves[0];assert.equal(calendar.type,calendarType);assert.equal(calendar.view.getState().topPane,'timer');
 calendar.view.selectCalendarSurface('calendar');f.plugin.domEvents.find((event:any)=>event.event==='click').callback();await uiTick();assert.equal(calendar.view.getState().topPane,'timer');assert.equal(f.leaves.length,1);
 let prevented=false;calendar.view.selectCalendarSurface('calendar');f.plugin.domEvents.find((event:any)=>event.event==='keydown').callback({key:'Enter',preventDefault(){prevented=true;}});await uiTick();assert(prevented);assert.equal(calendar.view.getState().topPane,'timer');assert.equal(f.leaves[0],calendar);
});
test('restored legacy timer migrates in place and keeps a paused session and saved records',async()=>{
 const f=fixture();await f.plugin.onload();let now=Date.UTC(2026,9,14,1);f.plugin.pomodoro.now=()=>now;
 await f.plugin.pomodoro.startTimer({title:'早一轮'},'stopwatch');now+=60_000;await f.plugin.pomodoro.stop();await f.plugin.pomodoro.startTimer({title:'继续当前轮'},'countdown',25);await f.plugin.pomodoro.pause();
 const before=f.plugin.pomodoro.snapshot().state,legacy=f.newLeaf(legacyTimerType);f.plugin.app.workspace.activeLeaf=legacy;
 await f.plugin.migrateTimerViews();assert.equal(f.leaves.length,1);assert.equal(f.leaves[0],legacy);assert.equal(legacy.type,calendarType);assert.equal(legacy.view.getState().topPane,'timer');assert.equal(legacy.detached,false);
 assert.strictEqual(f.plugin.pomodoro.snapshot().state,before);assert.equal(before.session.status,'paused');assert.equal(before.records.length,1);
 await f.plugin.migrateTimerViews();assert.equal(legacy.stateChanges.length,1);assert.equal(f.leaves.length,1);
});
test('layout restore removes duplicate legacy timer tabs while retaining the existing calendar selection',async()=>{
 const f=fixture();await f.plugin.onload();const calendar=await f.plugin.ensureCalendar();await calendar.view.setState({day:'2026-10-12',month:'2026-10',taskView:'timeline',topPane:'calendar'});
 const legacy=f.newLeaf(legacyTimerType),extra=f.newLeaf(legacyTimerType);f.plugin.app.workspace.activeLeaf=extra;
 for(const ready of f.layouts)ready();await uiTick();await f.plugin.migrateTimerViews();
 assert.deepEqual(f.leaves,[calendar]);assert.equal(legacy.detached,true);assert.equal(extra.detached,true);assert.equal(calendar.stateChanges.length,1);assert.equal(calendar.view.getState().day,'2026-10-12');assert.equal(calendar.view.getState().taskView,'timeline');assert.equal(calendar.view.getState().topPane,'timer');assert.equal(f.plugin.app.workspace.activeLeaf,calendar);
});
test('background layout migration does not steal the active native note',async()=>{
 const f=fixture();await f.plugin.onload();const calendar=await f.plugin.ensureCalendar(),legacy=f.newLeaf(legacyTimerType),note=f.plugin.app.workspace.getLeaf();f.plugin.app.workspace.activeLeaf=note;const reveals=f.revealed.length;
 await f.plugin.migrateTimerViews();assert.equal(legacy.detached,true);assert.equal(calendar.view.getState().topPane,'timer');assert.equal(f.plugin.app.workspace.activeLeaf,note);assert.equal(f.revealed.length,reveals);
});
test('restoring a deferred calendar reuses its pending leaf before migrating a legacy timer',async()=>{
 const f=fixture();await f.plugin.onload();const pending=f.newDeferredLeaf(calendarType,{day:'2026-09-14',month:'2026-09',taskView:'timeline',topPane:'calendar'}),legacy=f.newLeaf(legacyTimerType);f.plugin.app.workspace.activeLeaf=legacy;
 assert.equal(f.plugin.app.workspace.getLeavesOfType(calendarType).length,0);assert.equal(pending.getViewState().type,calendarType);
 await f.plugin.migrateTimerViews();assert.equal(f.leaves.length,1);assert.equal(f.leaves[0],pending);assert.equal(legacy.detached,true);assert.equal(pending.type,calendarType);assert.equal(pending.stateChanges.length,0);assert.equal(pending.view.getState().day,'2026-09-14');assert.equal(pending.view.getState().month,'2026-09');assert.equal(pending.view.getState().taskView,'timeline');assert.equal(pending.view.getState().topPane,'timer');assert.equal(f.plugin.app.workspace.activeLeaf,pending);
});
test('migration does not steal focus when the user opens a native note during deferred loading',{timeout:2000},async()=>{
 const f=fixture();await f.plugin.onload();const pending=f.newDeferredLeaf(calendarType,{day:'2026-09-14',taskView:'timeline'}),legacy=f.newLeaf(legacyTimerType),note=f.plugin.app.workspace.getLeaf();f.plugin.app.workspace.activeLeaf=legacy;
 let release!:()=>void,started!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),loading=new Promise<void>(resolve=>{started=resolve;}),restore=pending.loadIfDeferred.bind(pending);
 pending.loadIfDeferred=async()=>{started();await gate;await restore();};
 const migration=f.plugin.migrateTimerViews();await loading;f.plugin.app.workspace.activeLeaf=note;release();await migration;
 assert.equal(legacy.detached,true);assert.equal(pending.type,calendarType);assert.equal(pending.view.getState().topPane,'timer');assert.equal(f.plugin.app.workspace.activeLeaf,note);assert.equal(f.revealed.length,0);
});
test('concurrent deferred restore, migration and timer entry keep a single calendar leaf',async()=>{
 const f=fixture();await f.plugin.onload();const pending=f.newDeferredLeaf(calendarType,{day:'2026-09-14',month:'2026-09',taskView:'timeline',topPane:'calendar'}),legacy=f.newLeaf(legacyTimerType);
 await Promise.all([f.plugin.openPomodoro(),f.plugin.migrateTimerViews(),f.plugin.ensureCalendar(false),f.plugin.openPomodoro()]);
 assert.equal(f.leaves.length,1);assert.equal(f.leaves[0],pending);assert.equal(pending.loads,1);assert.equal(legacy.detached,true);assert.equal(pending.stateChanges.length,0);assert.equal(pending.view.getState().day,'2026-09-14');assert.equal(pending.view.getState().taskView,'timeline');assert.equal(pending.view.getState().topPane,'timer');
});
test('concurrent legacy migration and timer entry reuse the same restored leaf',async()=>{
 const f=fixture();await f.plugin.onload();const legacy=f.newLeaf(legacyTimerType);
 await Promise.all([f.plugin.migrateTimerViews(),f.plugin.openPomodoro(),f.plugin.ensureCalendar(true),f.plugin.openPomodoro()]);
 assert.deepEqual(f.leaves,[legacy]);assert.equal(legacy.type,calendarType);assert.equal(legacy.stateChanges.length,1);assert.equal(legacy.view.getState().topPane,'timer');assert.equal(legacy.detached,false);
});
test('a late-restored legacy view registers migration and exposes no separate timer controls',async()=>{
 const f=fixture();await f.plugin.onload();for(const ready of f.layouts)ready();await uiTick();
 const legacy=f.newLeaf(legacyTimerType),placeholder=legacy.view;await placeholder.onOpen();const content=placeholder.contentEl;
 assert.equal(content.children.length,2);assert.equal(content.children[0].textContent,'计时功能已移入日历。');assert.equal(content.children[1].textContent,'在日历中打开');assert.equal(placeholder.getIcon(),'calendar-days');
 f.layouts.at(-1)();await uiTick();assert.deepEqual(f.leaves,[legacy]);assert.equal(legacy.type,calendarType);assert.equal(legacy.view.getState().topPane,'timer');assert.equal(content.children.length,0);
});
test('a closed legacy placeholder cannot reopen the calendar later',async()=>{
 const f=fixture();await f.plugin.onload();const legacy=f.newLeaf(legacyTimerType),placeholder=legacy.view;await placeholder.onOpen();const delayed=f.layouts.at(-1);legacy.detach();
 delayed();await uiTick();assert.equal(f.leaves.length,0);
});
test('a failed legacy conversion remains recoverable without creating an extra timer pane',async()=>{
 const f=fixture();await f.plugin.onload();const legacy=f.newLeaf(legacyTimerType),convert=legacy.setViewState.bind(legacy);let attempts=0;
 legacy.setViewState=async(state:any)=>{if(++attempts===1)throw Error('temporary layout failure');await convert(state);};
 await assert.rejects(f.plugin.migrateTimerViews(),/temporary layout failure/);assert.deepEqual(f.leaves,[legacy]);assert.equal(legacy.detached,false);assert.equal(legacy.type,legacyTimerType);
 await f.plugin.openPomodoro();assert.deepEqual(f.leaves,[legacy]);assert.equal(legacy.type,calendarType);assert.equal(legacy.view.getState().topPane,'timer');assert.equal(attempts,2);
});
test('task focus and large-calendar timer start both reveal the shared calendar timer surface',async()=>{
 const f=fixture(),file=new TFile('日历计时入口.md'),source='- [ ] 09:00 - 09:30 整理任务 ⏳ 2026-10-14 ^timer';f.files.set(file.path,file);f.text.set(file.path,source);await f.plugin.onload();await f.plugin.taskPlanner.ready();
 await f.plugin.pomodoroActions.startTask(f.plugin.taskPlanner.all()[0]);const calendar=f.leaves[0];assert.equal(calendar.type,calendarType);assert.equal(calendar.view.getState().topPane,'timer');assert.equal(f.plugin.pomodoro.snapshot().state.session.mode,'countdown');assert.equal(f.text.get(file.path),source);
 await f.plugin.pomodoro.stop();calendar.view.selectCalendarSurface('calendar');await f.plugin.largeCalendarHost.startTimer({title:'大日历自由计时'},'stopwatch');assert.equal(calendar.view.getState().topPane,'timer');assert.deepEqual(f.leaves,[calendar]);assert.equal(f.plugin.pomodoro.snapshot().state.session.target.title,'大日历自由计时');assert.equal(f.text.get(file.path),source);
});
test('both start commands display their session in the calendar timer pane',async()=>{
 const f=fixture();await f.plugin.onload();f.plugin.commands.find((command:any)=>command.id==='start-stopwatch').callback();await uiTick();const calendar=f.leaves[0];assert.equal(calendar.type,calendarType);assert.equal(calendar.view.getState().topPane,'timer');assert.equal(f.plugin.pomodoro.snapshot().state.session.mode,'stopwatch');
 await f.plugin.pomodoro.stop();calendar.view.selectCalendarSurface('calendar');f.plugin.commands.find((command:any)=>command.id==='start-pomodoro').callback();await uiTick();assert.equal(calendar.view.getState().topPane,'timer');assert.equal(f.plugin.pomodoro.snapshot().state.session.mode,'pomodoro');assert.deepEqual(f.leaves,[calendar]);
});
test('timer routing rejects requests after unload without creating or changing a pane',async()=>{
 const f=fixture();await f.plugin.onload();const calendar=await f.plugin.ensureCalendar();await calendar.view.setState({topPane:'calendar'});f.plugin.onunload();
 await assert.rejects(f.plugin.openPomodoro(),/关闭/);assert.equal(calendar.view.getState().topPane,'calendar');assert.deepEqual(f.leaves,[calendar]);
});
test('old journal filing backs up before moving and preserves duplicate dates',async()=>{const f=fixture();await f.plugin.onload();for(const path of ['ThoughtSpace/日记/2026-09-15.md','ThoughtSpace/日记/2026-09-16.md','ThoughtSpace/日记/2026/09/2026-09-16.md']){f.files.set(path,new TFile(path));f.text.set(path,'original '+path)}const result=await f.plugin.fileOldJournals();assert.equal(result.moved,1);assert.equal(result.skipped.length,1);assert.equal(result.failed.length,0);assert(f.text.has('ThoughtSpace/日记/2026-09-16.md'));assert([...f.text].some(([path,text])=>path.includes('filing-backups')&&text==='original ThoughtSpace/日记/2026-09-15.md'));});

const calendarRange=[new Date(2026,9,1),new Date(2026,10,1)] as const;
test('calendar and unscheduled tray share one concurrent initial task read',async()=>{
 const f=fixture();await f.plugin.onload();let reads=0;f.plugin.taskPlanner.ready=async()=>{reads++;await Promise.resolve();};
 await Promise.all([f.plugin.largeCalendarHost.tasks(...calendarRange),f.plugin.largeCalendarHost.unscheduledTasks(),f.plugin.largeCalendarHost.tasks(...calendarRange)]);
 assert.equal(reads,1);f.plugin.unload();
});
test('calendar host schedules an inbox task and keeps its Markdown block reference',async()=>{
 const f=fixture(),file=new TFile('收件箱.md');f.files.set(file.path,file);f.text.set(file.path,'# 计划\n\n- [ ] 整理材料 ^inbox\n\n保留正文');await f.plugin.onload();
 const host=f.plugin.largeCalendarHost,backlog=await host.unscheduledTasks();assert.equal(backlog.length,1);
 await host.scheduleTask(backlog[0],'2026-10-11',555,615);
 assert.equal((await host.unscheduledTasks()).length,0);
 const tasks=await host.tasks(...calendarRange);assert.equal(tasks[0].date,'2026-10-11');assert.equal(tasks[0].startMinute,555);assert.equal(tasks[0].endMinute,615);
 assert.match(f.text.get(file.path)!,/\^inbox/);assert.match(f.text.get(file.path)!,/保留正文$/);
 f.plugin.unload();
});
test('calendar scheduling rejects an externally edited source line without overwriting it',async()=>{
 const f=fixture(),file=new TFile('任务.md');f.files.set(file.path,file);f.text.set(file.path,'- [ ] 原任务 ⏳ 2026-10-11');await f.plugin.onload();
 const host=f.plugin.largeCalendarHost,[displayed]=await host.tasks(...calendarRange);f.text.set(file.path,'- [ ] 用户刚修改的内容 ⏳ 2026-10-11');
 await assert.rejects(host.scheduleTask(displayed,'2026-10-12',600,660),/变化/);
 assert.equal(f.text.get(file.path),'- [ ] 用户刚修改的内容 ⏳ 2026-10-11');f.plugin.unload();
});
test('clearing task time retains scheduled date, deadline and block reference',async()=>{
 const f=fixture(),file=new TFile('时间.md');f.files.set(file.path,file);f.text.set(file.path,'- [ ] 09:07 - 10:02 核对资料 ⏳ 2026-10-11 📅 2026-10-13 ^review');await f.plugin.onload();
 const host=f.plugin.largeCalendarHost,task=(await host.tasks(...calendarRange)).find((task:any)=>task.dateRole==='scheduled');
 await host.scheduleTask(task,'2026-10-12',undefined,undefined,true);
 const [updated]=await host.tasks(...calendarRange);assert.equal(updated.startMinute,undefined);assert.equal(updated.date,'2026-10-12');
 assert.match(f.text.get(file.path)!,/📅 2026-10-13/);assert.match(f.text.get(file.path)!,/\^review$/);assert.match(f.text.get(file.path)!,/核对资料/);assert.doesNotMatch(f.text.get(file.path)!,/09:07/);f.plugin.unload();
});
test('calendar task toggle uses the shared planner, stamps completion, and refuses stale double clicks',async()=>{
 const f=fixture(),file=new TFile('任务.md');f.files.set(file.path,file);f.text.set(file.path,'- [ ] 发布总结 📅 2026-10-11 ^summary');await f.plugin.onload();
 const host=f.plugin.largeCalendarHost,[task]=await host.tasks(...calendarRange);assert.equal(host.canToggleTask(task),true);
 await host.toggleTask(task);assert.match(f.text.get(file.path)!,/- \[x\]/);assert.match(f.text.get(file.path)!,/✅ \d{4}-\d{2}-\d{2}/);assert.match(f.text.get(file.path)!,/\^summary/);
 assert.equal(host.canToggleTask(task),false);await assert.rejects(host.toggleTask(task),/变化/);f.plugin.unload();
});
test('calendar recurring task toggle detects Tasks dynamically and preserves generated next occurrence',async()=>{
 const f=fixture(),file=new TFile('重复任务.md'),source='- [ ] 阅读 🔁 every day 📅 2026-10-11';f.files.set(file.path,file);f.text.set(file.path,source);await f.plugin.onload();
 const host=f.plugin.largeCalendarHost,[task]=await host.tasks(...calendarRange);assert.equal(host.canToggleTask(task),false);
 f.plugin.app.plugins.plugins={'obsidian-tasks-plugin':{apiV1:{executeToggleTaskDoneCommand:(line:string,path:string)=>{assert.equal(line,source);assert.equal(path,file.path);return '- [x] 阅读 🔁 every day 📅 2026-10-11 ✅ 2026-10-11\n- [ ] 阅读 🔁 every day 📅 2026-10-12';}}}};
 assert.equal(host.canToggleTask(task),true);await host.toggleTask(task);
 const tasks=await host.tasks(...calendarRange);assert.equal(tasks.length,2);assert.equal(tasks.find((t:any)=>t.date==='2026-10-12')?.completed,false);f.plugin.unload();
});
test('calendar event creates one linked native note in the configured capture folder and reuses its leaf',async()=>{
 const f=fixture();f.plugin.saved={cardFolder:'我的笔记'};await f.plugin.onload();
 const event={id:'event',calendarId:'calendar',title:'项目会议',start:'2026-10-11T01:00:00Z',end:'2026-10-11T02:00:00Z',allDay:false,location:'',notes:'',revision:'r1',recurring:false,editable:true,color:'#333333'};
 const host=f.plugin.largeCalendarHost;await host.openEventNote(event);await host.openEventNote({...event,title:'会议新名称'});
 const notes=host.eventNotes(event);assert.equal(notes.length,1);assert(notes[0].path.startsWith('我的笔记/日程/'));assert.equal(f.created(),1);assert.equal(f.leaves.filter(l=>l.type==='markdown').length,1);
 const file=f.files.get(notes[0].path) as TFile;assert.equal((file.properties['thoughtspace-calendar-events'] as string[]).length,1);assert.match(f.text.get(file.path)!,/calendar-start:/);assert.match(f.text.get(file.path)!,/## 记录/);
 f.plugin.unload();await assert.rejects(host.openEventNote(event),/关闭/);
});
test('eventMoved host preserves an occurrence note after Apple changes its scheduled time',async()=>{
 const f=fixture();await f.plugin.onload();const host=f.plugin.largeCalendarHost;
 const original={id:'series',calendarId:'calendar',title:'周会',start:'2026-10-11T01:00:00Z',end:'2026-10-11T02:00:00Z',allDay:false,location:'',notes:'',revision:'r1',recurring:true,editable:true,color:'#333333'};
 await host.openEventNote(original);const path=host.eventNotes(original)[0].path,moved={...original,start:'2026-10-11T03:00:00Z',end:'2026-10-11T04:00:00Z',revision:'r2'};
 await host.eventMoved(original,moved);assert.equal(host.eventNotes(original).length,0);assert.equal(host.eventNotes(moved)[0].path,path);f.plugin.unload();
});


test('task timer facade uses plan duration and preserves recurring Markdown without changing its checkbox',async()=>{
 const f=fixture(),file=new TFile('计时任务.md'),source='- [ ] 09:00 - 09:45 写作 🔁 every day ⏳ 2026-10-14 ^write';f.files.set(file.path,file);f.text.set(file.path,source);await f.plugin.onload();f.plugin.openPomodoro=async()=>{};f.plugin.pomodoro.now=()=>Date.UTC(2026,9,14,1);
 await f.plugin.taskPlanner.ready();const task=f.plugin.taskPlanner.all()[0];await f.plugin.pomodoroActions.startTask(task);
 const snapshot=f.plugin.pomodoro.snapshot();assert.equal(snapshot.state.session.mode,'countdown');assert.equal(snapshot.remainingMs,45*60000);assert.equal(snapshot.state.session.target.plannedDurationMs,45*60000);assert.equal(snapshot.state.session.target.source,source);assert.equal(f.text.get(file.path),source);
 await f.plugin.pomodoro.pause();await assert.rejects(f.plugin.largeCalendarHost.startTimer({title:'另一项工作'},'stopwatch'),/已有/);assert.equal(f.plugin.pomodoro.snapshot().state.session.target.title,snapshot.state.session.target.title);assert.equal(f.text.get(file.path),source);
});
test('untimed task facade starts stopwatch and stale timer actions reject completed or changed occurrences',async()=>{
 const f=fixture(),file=new TFile('自由任务.md'),source='- [ ] 自由任务 ^free';f.files.set(file.path,file);f.text.set(file.path,source);await f.plugin.onload();f.plugin.openPomodoro=async()=>{};
 await f.plugin.taskPlanner.ready();const task=f.plugin.taskPlanner.all()[0];await f.plugin.pomodoroActions.startTask(task);assert.equal(f.plugin.pomodoro.snapshot().state.session.mode,'stopwatch');assert.equal(f.plugin.pomodoro.snapshot().state.session.target.path,file.path);
 await f.plugin.pomodoro.stop();f.plugin.taskPlanner.all=()=>[{...task,checked:true}];await assert.rejects(f.plugin.pomodoroActions.startTask(task),/已完成/);
 f.plugin.taskPlanner.all=()=>[{...task,source:'- [ ] 刚修改的任务'}];await assert.rejects(f.plugin.pomodoroActions.startTask(task),/已变化/);assert.equal(f.text.get(file.path),source);
});
