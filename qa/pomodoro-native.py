"""Native Pomodoro test. Restores state, settings, workspace and its unique fixture."""
from pathlib import Path
import argparse, json, subprocess, uuid

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--vault',required=True)
args=parser.parse_args()
out=Path(__file__).parent/'pomodoro-output';out.mkdir(exist_ok=True)
checks=[]
def command(*parts):
    return subprocess.run(['obsidian',f'vault={args.vault}',*parts],check=True,capture_output=True,text=True,timeout=60).stdout
def evaluate(code):
    raw=command('eval','code='+code)
    if '=> ' not in raw: raise RuntimeError(raw)
    return json.loads(raw.split('=> ',1)[1].strip())
def native(code):
    return evaluate("(async()=>{const q=window[Symbol.for('thoughtspace.pomodoro-qa')];"+code+'})()')
def check(name,value):
    if not value: raise AssertionError(name)
    checks.append(name)

command('plugin:reload','id=thoughtspace-calendar')
before_errors=command('dev:errors')
folder='TS-Pomodoro-QA-'+uuid.uuid4().hex[:12]
initialized=False
try:
    start=evaluate("""(async()=>{
const key=Symbol.for('thoughtspace.pomodoro-qa');if(window[key])throw Error('Another Pomodoro QA is active');
const p=app.plugins.getPlugin('thoughtspace-calendar');if(!p?.ready||p.manifest.version!=='1.4.6')throw Error('Pomodoro version not ready');
const q={p,folder:FOLDER,layout:app.workspace.getLayout(),active:app.workspace.activeLeaf?.id,settings:structuredClone(p.settings),journal:p.journalLinks,NL:String.fromCharCode(10)};window[key]=q;
q.statePath=app.vault.configDir+'/plugins/thoughtspace-calendar/pomodoro-state.json';q.stateExists=await app.vault.adapter.exists(q.statePath);q.stateText=q.stateExists?await app.vault.adapter.read(q.statePath):null;
q.dataPath=app.vault.configDir+'/plugins/thoughtspace-calendar/data.json';q.dataText=await app.vault.adapter.read(q.dataPath);
q.journal?.unload();await q.journal?.queue;
q.frame=()=>new Promise(r=>setTimeout(r,40));q.wait=async fn=>{for(let i=0;i<120;i++){if(await fn())return;await q.frame();}throw Error('Native Pomodoro did not settle');};
await p.pomodoro.settled();q.realNow=p.pomodoro.now;q.now=Date.now();p.pomodoro.now=()=>q.now;
if(p.pomodoro.snapshot().state.session.status!=='idle')throw Error('Existing live focus must be preserved; QA aborted');
await app.vault.createFolder(q.folder);q.original='- [ ] 番茄钟重复任务 🔁 every day 📅 '+window.moment().format('YYYY-MM-DD')+' ^focus-repeat'+q.NL+'- [ ] 另一个任务'+q.NL+q.NL+'正文保留';q.file=await app.vault.create(q.folder+'/tasks.md',q.original);
await p.taskPlanner.ready();await p.taskPlanner.flush();q.tasks=p.taskPlanner.all().filter(t=>t.path===q.file.path);
return JSON.stringify({ready:p.ready,count:q.tasks.length,tasksVersion:app.plugins.getPlugin('obsidian-tasks-plugin')?.manifest.version});
})()""".replace('FOLDER',json.dumps(folder)))
    initialized=True
    check('installed native 1.4.6 and Tasks 8.5.0 are ready',start['ready'] and start['tasksVersion']=='8.5.0')
    check('real vault indexes two unique fixture tasks',start['count']==2)
    values=native("""
await q.p.pomodoroActions.startTask(q.tasks[0]);await q.wait(()=>document.querySelector('.ts-calendar-pomodoro-primary:not(:disabled)'));
const s=q.p.pomodoro.snapshot().state.session,button=document.querySelector('.ts-calendar-pomodoro-primary');
return JSON.stringify({focus:s.phase==='focus'&&s.status==='running',target:s.target.path===q.file.path&&s.target.line===q.tasks[0].line,view:app.workspace.getLeavesOfType('thoughtspace-pomodoro').length===1,body:document.querySelector('.ts-calendar-pomodoro-clock')?.textContent==='25:00',status:document.querySelector('.ts-calendar-focus-status')?.textContent.includes('25:00'),visible:document.querySelector('.ts-calendar-pomodoro')?.getBoundingClientRect().width>0,unchanged:await app.vault.read(q.file)===q.original});
""")
    for name,value in values.items():check('native task start: '+name,value)
    values=native("""
q.now+=10000;q.p.pomodoro.tick();await q.p.pomodoro.pause();const remaining=q.p.pomodoro.snapshot().remainingMs;
for(let i=0;i<5;i++){q.now+=5000;await q.p.pomodoro.resume();q.now+=1000;await q.p.pomodoro.pause();}
let blocked=false;try{await q.p.pomodoroActions.startTask(q.tasks[1]);}catch(e){blocked=String(e).includes('重置');}
const s=q.p.pomodoro.snapshot();return JSON.stringify({remaining:s.remainingMs===remaining-5000,paused:s.state.session.status==='paused',conflict:blocked,targetPreserved:s.state.session.target.path===q.file.path&&s.state.session.target.title===q.tasks[0].title,source:await app.vault.read(q.file)===q.original});
""")
    for name,value in values.items():check('continuous pause/resume: '+name,value)
    values=native("""
await q.p.pomodoro.resume();q.now+=q.p.pomodoro.snapshot().remainingMs;q.p.pomodoro.tick();await q.p.pomodoro.settled();q.p.pomodoro.tick();await q.p.pomodoro.settled();
const s=q.p.pomodoro.snapshot().state;await q.p.pomodoro.start();const rest=q.p.pomodoro.snapshot().state.session;
await q.p.pomodoroActions.startTask(q.tasks[1]);const focus=q.p.pomodoro.snapshot().state.session;await q.p.pomodoro.pause();
return JSON.stringify({records:s.records.length===1,finished:s.session.status==='finished',shortBreak:rest.phase==='short-break'&&rest.status==='running',newTaskFocus:focus.phase==='focus'&&focus.target.title===q.tasks[1].title,source:await app.vault.read(q.file)===q.original});
""")
    for name,value in values.items():check('finish and stage actions: '+name,value)
    command('dev:screenshot','path='+str(out/'native.png'))
    # Reload the real plugin from its persisted paused state, with the real wall clock.
    native("q.p.pomodoro.now=q.realNow;q.beforeReload=q.p.pomodoro.snapshot().state.session;return JSON.stringify(true);")
    command('plugin:reload','id=thoughtspace-calendar')
    values=native("""
q.p=app.plugins.getPlugin('thoughtspace-calendar');await q.p.openPomodoro();await q.wait(()=>document.querySelector('.ts-calendar-pomodoro-primary:not(:disabled)'));
const s=q.p.pomodoro.snapshot().state.session;return JSON.stringify({version:q.p.manifest.version==='1.4.6',paused:s.status==='paused',target:s.target.title===q.tasks[1].title,remaining:s.remainingMs===q.beforeReload.remainingMs,onePane:app.workspace.getLeavesOfType('thoughtspace-pomodoro').length===1,records:q.p.pomodoro.snapshot().state.records.length===1});
""")
    for name,value in values.items():check('real plugin reload: '+name,value)
finally:
    # Cleanup even a partially initialized native run; each removal is uniquely owned.
    cleanup=native("""
if(!q)return JSON.stringify({initialized:false});
await q.p.pomodoro.settled();q.p.pomodoro.dispose();
q.p.journalLinks?.unload();await q.p.journalLinks?.queue;
if(q.stateExists)await app.vault.adapter.write(q.statePath,q.stateText);else if(await app.vault.adapter.exists(q.statePath))await app.vault.adapter.remove(q.statePath);
const folder=app.vault.getAbstractFileByPath(q.folder);if(folder)await app.vault.delete(folder,true);
const data=await app.vault.adapter.read(q.dataPath);q.restoredData=data===q.dataText;
return JSON.stringify({initialized:true,data:q.restoredData});
""")
    command('plugin:reload','id=thoughtspace-calendar')
    restored=native("""
q.p=app.plugins.getPlugin('thoughtspace-calendar');const pending=app.workspace.changeLayout(q.layout);if(pending?.catch)pending.catch(()=>{});
await q.wait(()=>JSON.stringify(app.workspace.getLayout())===JSON.stringify(q.layout));
const active=app.workspace.getLeafById(q.active);if(active)app.workspace.setActiveLeaf(active,{focus:false});
const state=q.stateExists?await app.vault.adapter.read(q.statePath)===q.stateText:!await app.vault.adapter.exists(q.statePath);
const data=await app.vault.adapter.read(q.dataPath)===q.dataText;
delete window[Symbol.for('thoughtspace.pomodoro-qa')];return JSON.stringify({state,data,fixtureRemoved:!app.vault.getAbstractFileByPath(q.folder),layout:true});
""")
    for name,value in restored.items():check('cleanup: '+name,value)

check('native developer errors unchanged',command('dev:errors')==before_errors)
(out/'native-result.json').write_text(json.dumps({'checks':len(checks),'passed':checks,'errors':[]},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'checks':len(checks),'errors':[],'restored':restored},ensure_ascii=False))
