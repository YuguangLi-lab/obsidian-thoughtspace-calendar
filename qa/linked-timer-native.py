"""Native general timer/calendar regression. Unique fixtures, original state/settings/layout restored."""
from pathlib import Path
import argparse,json,subprocess,uuid
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--vault',required=True);args=parser.parse_args()
expected_version=json.loads((Path(__file__).parent.parent/'manifest.json').read_text())['version']
out=Path(__file__).parent/'linked-timer-output';out.mkdir(exist_ok=True);checks=[]
def command(*parts):
 return subprocess.run(['obsidian',f'vault={args.vault}',*parts],check=True,capture_output=True,text=True,timeout=60).stdout
def evaluate(code):
 raw=command('eval','code='+code)
 if '=> ' not in raw:raise RuntimeError(raw)
 return json.loads(raw.split('=> ',1)[1].strip())
def native(code):return evaluate("(async()=>{const q=window[Symbol.for('thoughtspace.linked-timer-qa')];"+code+'})()')
def check(name,value):
 if not value:raise AssertionError(name)
 checks.append(name)
command('plugin:reload','id=thoughtspace-calendar');before_errors=command('dev:errors')
preflight=evaluate("JSON.stringify({ready:app.plugins.getPlugin('thoughtspace-calendar')?.ready,status:app.plugins.getPlugin('thoughtspace-calendar')?.pomodoro.snapshot().state.session.status})")
if not preflight['ready'] or preflight['status'] not in ['idle','finished']:raise RuntimeError('Preserving active user timer: native QA not started')
folder='TS-Linked-Timer-QA-'+uuid.uuid4().hex[:12]
try:
 start=evaluate("""(async()=>{
const key=Symbol.for('thoughtspace.linked-timer-qa');if(window[key])throw Error('Another QA is active');const p=app.plugins.getPlugin('thoughtspace-calendar');if(p.manifest.version!==VERSION)throw Error('Installed version mismatch');
const q={p,folder:FOLDER,layout:app.workspace.getLayout(),active:app.workspace.activeLeaf?.id,journal:p.journalLinks,NL:String.fromCharCode(10)};
// A reveal without focus can leave activeLeaf pointing at a hidden tab. Preserve the visible selection.
const selectedTabs=[];const selectedNodes=node=>{if(node?.type==='tabs')selectedTabs.push(node);for(const child of node?.children||[])selectedNodes(child);};for(const node of [q.layout.main,q.layout.left,q.layout.right])selectedNodes(node);
const activeGroup=selectedTabs.find(tab=>tab.children?.some(child=>child.id===q.active));if(activeGroup){const selected=activeGroup.children[activeGroup.currentTab||0];if(selected&&selected.id!==q.active){q.active=selected.id;q.layout.active=selected.id;}}
window[key]=q;
q.statePath=app.vault.configDir+'/plugins/thoughtspace-calendar/pomodoro-state.json';q.stateExists=await app.vault.adapter.exists(q.statePath);q.stateText=q.stateExists?await app.vault.adapter.read(q.statePath):null;
q.dataPath=app.vault.configDir+'/plugins/thoughtspace-calendar/data.json';q.dataText=await app.vault.adapter.read(q.dataPath);
q.journal?.unload();await q.journal?.queue;q.wait=async fn=>{for(let i=0;i<120;i++){if(await fn())return;await new Promise(r=>setTimeout(r,40));}throw Error('Native timer did not settle');};
await p.pomodoro.settled();q.realNow=p.pomodoro.now;q.now=Date.now()-120*60000;p.pomodoro.now=()=>q.now;q.day=window.moment(q.now).format('YYYY-MM-DD');
await app.vault.createFolder(q.folder);q.original='- [ ] 09:00 - 09:30 重复任务 🔁 every day ⏳ '+q.day+' ^repeat'+q.NL+'- [ ] 自由任务'+q.NL+q.NL+'原文保留';q.file=await app.vault.create(q.folder+'/tasks.md',q.original);
await p.taskPlanner.ready();await p.taskPlanner.flush();q.tasks=p.taskPlanner.all().filter(t=>t.path===q.file.path);q.beforeCount=p.pomodoro.snapshot().state.records.length;
return JSON.stringify({ready:p.ready,count:q.tasks.length,tasks:app.plugins.getPlugin('obsidian-tasks-plugin')?.manifest.version});
})()""".replace('FOLDER',json.dumps(folder)).replace('VERSION',json.dumps(expected_version)))
 check('native '+expected_version+' with official Tasks is ready',start['ready'] and start['tasks']=='8.5.0');check('two unique tasks indexed',start['count']==2)
 values=native("""
await q.p.pomodoroActions.startTask(q.tasks[0]);await q.wait(()=>document.querySelector('.ts-calendar-pomodoro-primary:not(:disabled)'));const s=q.p.pomodoro.snapshot().state.session;
return JSON.stringify({mode:s.mode==='countdown',planned:s.durationMs===30*60000&&s.target.plannedDurationMs===30*60000,identity:s.target.path===q.file.path&&s.target.source===q.tasks[0].source,ui:document.querySelector('.ts-calendar-pomodoro-clock')?.textContent==='30:00',status:document.querySelector('.ts-calendar-focus-status')?.textContent.includes('30:00'),source:await app.vault.read(q.file)===q.original});
""")
 for name,value in values.items():check('planned task start: '+name,value)
 values=native("""
q.now+=60000;await q.p.pomodoro.pause();q.now+=300000;await q.p.pomodoro.resume();q.now+=60000;await q.p.pomodoro.pause();let blocked=false;try{await q.p.pomodoroActions.startTask(q.tasks[1]);}catch(e){blocked=true;}
await q.p.pomodoro.adjust(5);const before=q.p.pomodoro.snapshot();await q.p.pomodoro.stop();const s=q.p.pomodoro.snapshot().state,r=s.records.at(-1);
return JSON.stringify({pauseExcluded:before.elapsedMs===120000,adjust:before.remainingMs===33*60000,conflict:blocked,actual:r.durationMs===120000,outcome:r.outcome==='stopped',segments:r.segments.length===2,recordedOnce:s.records.length===q.beforeCount+1,cycle:s.cycle===0,source:await app.vault.read(q.file)===q.original});
""")
 for name,value in values.items():check('continuous planned session: '+name,value)
 values=native("""
await q.p.pomodoroActions.startTask(q.tasks[1]);q.now+=65000;q.p.pomodoro.tick();const s=q.p.pomodoro.snapshot();await q.p.pomodoro.pause();q.beforeReload=q.p.pomodoro.snapshot();q.p.pomodoro.now=q.realNow;
return JSON.stringify({stopwatch:s.state.session.mode==='stopwatch',elapsed:s.elapsedMs===65000,status:document.querySelector('.ts-calendar-focus-status')?.textContent.includes('01:05'),source:await app.vault.read(q.file)===q.original});
""")
 for name,value in values.items():check('free task stopwatch: '+name,value)
 command('plugin:reload','id=thoughtspace-calendar')
 values=native("""
q.p=app.plugins.getPlugin('thoughtspace-calendar');q.p.journalLinks?.unload();await q.p.journalLinks?.queue;await q.p.openPomodoro();const before=q.p.pomodoro.snapshot();q.p.pomodoro.now=()=>q.now;await q.p.pomodoro.stop();
return JSON.stringify({mode:before.state.session.mode==='stopwatch',paused:before.state.session.status==='paused',elapsed:before.elapsedMs===65000,source:before.state.session.target.path===q.file.path,onePane:app.workspace.getLeavesOfType('thoughtspace-pomodoro').length===1,record:q.p.pomodoro.snapshot().state.records.at(-1).durationMs===65000});
""")
 for name,value in values.items():check('real reload recovery: '+name,value)
 values=native("""
await q.p.openLargeCalendar(q.day);const v=app.workspace.getLeavesOfType('thoughtspace-large-calendar')[0].view;v.mode='week';await v.showDay(new Date(q.day+'T12:00:00'));
await q.wait(()=>document.querySelector('.tsc-week-actual'));const nodes=[...document.querySelectorAll('.tsc-week-actual')];
return JSON.stringify({week:nodes.length>=3,readOnly:nodes.every(n=>!n.draggable&&!n.querySelector('.tsc-resize-handle')),agenda:!!document.querySelector('.tsc-actual-list'),source:await app.vault.read(q.file)===q.original});
""")
 for name,value in values.items():check('large calendar actual records: '+name,value)
 command('dev:screenshot','path='+str(out/'native-linked.png'))
 values=native("""
await q.p.pomodoro.selectMode('countdown',1);await q.p.pomodoro.start();q.now+=60000;q.p.pomodoro.tick();await q.p.pomodoro.settled();q.p.pomodoro.tick();await q.p.pomodoro.settled();const s=q.p.pomodoro.snapshot().state;
return JSON.stringify({finished:s.session.status==='finished',mode:s.session.mode==='countdown',completed:s.records.at(-1).outcome==='completed',once:s.records.length===q.beforeCount+3,cycle:s.cycle===0,source:await app.vault.read(q.file)===q.original});
""")
 for name,value in values.items():check('automatic countdown completion: '+name,value)
finally:
 cleanup=native("""
if(!q)return JSON.stringify({initialized:false});await q.p.pomodoro.settled();q.p.pomodoro.dispose();q.p.journalLinks?.unload();await q.p.journalLinks?.queue;
if(q.stateExists)await app.vault.adapter.write(q.statePath,q.stateText);else if(await app.vault.adapter.exists(q.statePath))await app.vault.adapter.remove(q.statePath);const folder=app.vault.getAbstractFileByPath(q.folder);if(folder)await app.vault.delete(folder,true);
return JSON.stringify({initialized:true,data:await app.vault.adapter.read(q.dataPath)===q.dataText});
""")
 command('plugin:reload','id=thoughtspace-calendar')
 restored=native("""
q.p=app.plugins.getPlugin('thoughtspace-calendar');
const pending=app.workspace.changeLayout(q.layout);pending?.catch(()=>{});
const tabs=[];const collect=node=>{if(node?.type==='tabs'&&node.children?.length)tabs.push(node);for(const child of node?.children||[])collect(child);};for(const node of [q.layout.main,q.layout.left,q.layout.right])collect(node);
await q.wait(()=>tabs.every(tab=>app.workspace.getLeafById(tab.children[tab.currentTab||0]?.id)));
const active=app.workspace.getLeafById(q.active);if(active)app.workspace.setActiveLeaf(active,{focus:false});
for(const tab of tabs){const leaf=app.workspace.getLeafById(tab.children[tab.currentTab||0]?.id);if(leaf)await app.workspace.revealLeaf(leaf);}
const normalize=(value,expected)=>{if(Array.isArray(value))return value.map((item,i)=>normalize(item,expected?.[i]));if(value&&typeof value==='object'){const copy={...value};if(expected?.type?.startsWith('thoughtspace-')&&expected.icon==='lucide-ghost'&&copy.type===expected.type){copy.icon=expected.icon;copy.title=expected.title;}return Object.fromEntries(Object.keys(copy).sort().map(key=>[key,normalize(copy[key],expected?.[key]) ]));}return value;};
await q.wait(()=>JSON.stringify(normalize(app.workspace.getLayout(),q.layout))===JSON.stringify(normalize(q.layout,q.layout)));
const result={state:q.stateExists?await app.vault.adapter.read(q.statePath)===q.stateText:!await app.vault.adapter.exists(q.statePath),data:await app.vault.adapter.read(q.dataPath)===q.dataText,fixtureRemoved:!app.vault.getAbstractFileByPath(q.folder),layout:true};delete window[Symbol.for('thoughtspace.linked-timer-qa')];return JSON.stringify(result);
""")
 for name,value in restored.items():check('cleanup: '+name,value)
check('native developer errors unchanged',command('dev:errors')==before_errors)
(out/'native-result.json').write_text(json.dumps({'checks':len(checks),'passed':checks,'errors':[],'restored':restored},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'checks':len(checks),'errors':[],'restored':restored},ensure_ascii=False))
