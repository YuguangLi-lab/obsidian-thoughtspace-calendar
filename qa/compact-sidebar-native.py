"""Native compact-sidebar QA. Synthetic diaries only; timer, settings and layout restored."""
from pathlib import Path
import argparse, json, subprocess, uuid

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--vault',required=True)
args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
out=root/'qa/compact-sidebar-output';out.mkdir(exist_ok=True)
expected=json.loads((root/'manifest.json').read_text())['version'];checks=[]

def command(*parts):
    return subprocess.run(['obsidian',f'vault={args.vault}',*parts],check=True,capture_output=True,text=True,timeout=60).stdout

def evaluate(code):
    raw=command('eval','code='+code)
    if '=> ' not in raw:raise RuntimeError(raw)
    return json.loads(raw.split('=> ',1)[1].strip())

def native(code):
    return evaluate("(async()=>{const q=window[Symbol.for('thoughtspace.compact-sidebar-qa')];"+code+'})()')

def record(values):
    for name,value in values.items():
        if not value:raise AssertionError(name)
        checks.append(name)

command('plugin:reload','id=thoughtspace-calendar')
before_errors=command('dev:errors')
pre=evaluate("JSON.stringify({status:app.plugins.getPlugin('thoughtspace-calendar')?.pomodoro.snapshot().state.session.status})")
if pre['status'] not in ['idle','finished']:raise RuntimeError('Preserving active user timer; native QA not started')
folder='TS-Compact-Sidebar-QA-'+uuid.uuid4().hex[:12]
initialized=False
try:
    setup=evaluate("""(async()=>{
const p=app.plugins.getPlugin('thoughtspace-calendar');if(!p?.ready||p.manifest.version!==VERSION)throw Error('Version not ready');
const key=Symbol.for('thoughtspace.compact-sidebar-qa');if(window[key])throw Error('Another QA active');
const q={p,folder:FOLDER,layout:app.workspace.getLayout(),active:app.workspace.activeLeaf?.id,settings:JSON.parse(JSON.stringify(p.settings)),journal:p.journalLinks,originalAll:p.taskPlanner.all,undo:p.taskPlanner.undo,appleEvents:p.appleCalendar.events,appleQueries:0};
// A reveal without focus can leave activeLeaf pointing at a hidden tab. Preserve the visible selection.
const selectedTabs=[];const selectedNodes=node=>{if(node?.type==='tabs')selectedTabs.push(node);for(const child of node?.children||[])selectedNodes(child);};for(const node of [q.layout.main,q.layout.left,q.layout.right])selectedNodes(node);
const activeGroup=selectedTabs.find(tab=>tab.children?.some(child=>child.id===q.active));if(activeGroup){const selected=activeGroup.children[activeGroup.currentTab||0];if(selected&&selected.id!==q.active){q.active=selected.id;q.layout.active=selected.id;}}
window[key]=q;
q.wait=async fn=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,40));}throw Error('Native sidebar did not settle');};
q.statePath=app.vault.configDir+'/plugins/thoughtspace-calendar/pomodoro-state.json';q.stateExists=await app.vault.adapter.exists(q.statePath);q.stateText=q.stateExists?await app.vault.adapter.read(q.statePath):null;
q.dataPath=app.vault.configDir+'/plugins/thoughtspace-calendar/data.json';q.dataText=await app.vault.adapter.read(q.dataPath);
q.journal?.unload();await q.journal?.queue;q.p.appleCalendar.events=async()=>{q.appleQueries++;return [];};
q.p.settings.journalFolder=q.folder+'/日记';q.p.taskPlanner.all=function(){return q.originalAll.call(this).filter(task=>task.path.startsWith(q.folder+'/'));};
q.now=Date.now()-3600000;q.realNow=p.pomodoro.now;p.pomodoro.now=()=>q.now;q.day=window.moment(q.now).format('YYYY-MM-DD');q.NL=String.fromCharCode(10);
q.file=await p.ensureJournalFile(q.day);q.source=['# '+q.day,'','## 今日想法','','记录一个 **清晰的想法**，保留 Markdown。','','## 今日任务','','- [ ] 09:00 - 09:30 整理阅读笔记 ⏳ '+q.day+' ^fixture','- [x] 完成今天的散步 ✅ '+q.day,'','## 阅读与关联','','> 留一点时间给重要的事。','','阅读笔记里的 `代码` 和链接。'].join(q.NL);await app.vault.modify(q.file,q.source);
await p.taskPlanner.ready();await p.taskPlanner.flush();q.calendar=(await p.ensureCalendar(true)).view;await q.calendar.setState({day:q.day,month:q.day.slice(0,7),calendarView:'month',taskView:'list',topPane:'calendar'});
q.panel=()=>q.calendar.renderScope?._children.find(child=>typeof child.setFilter==='function');await q.wait(()=>q.panel());q.panel().setFilter('today',true);
q.journalView=(await p.ensureJournal(true)).view;await q.journalView.setState({day:q.day,month:q.day.slice(0,7),mode:'day'});
return JSON.stringify({version:true,shared:q.p.pomodoro===p.pomodoro});})()""".replace('VERSION',json.dumps(expected)).replace('FOLDER',json.dumps(folder)))
    initialized=True;record(setup)
    record(native("""
await app.workspace.revealLeaf(q.calendar.leaf);
const calendar=q.calendar.contentEl,diary=q.journalView.contentEl,primary=calendar.querySelector('.ts-calendar-primary-nav');
const year=calendar.querySelector('.ts-calendar-year'),month=calendar.querySelector('.ts-calendar-month');
return JSON.stringify({
'month/year navigation in one row':!!primary&&Math.abs(year.getBoundingClientRect().top-month.getBoundingClientRect().top)<3,
'seven weekdays plus week numbers':getComputedStyle(calendar.querySelector('.ts-calendar-grid')).gridTemplateColumns.split(' ').length===8,
'lunar labels remain visible':calendar.querySelectorAll('.ts-calendar-lunar-label').length>20,
'one common range control set':calendar.querySelectorAll('.ts-task-summary>button').length===4,
'advanced filters remain available':!!calendar.querySelector('.ts-task-filter-disclosure summary'),
'duplicate task count/date removed':!calendar.querySelector('.ts-task-count'),
'calendar has one embedded timer':calendar.querySelectorAll('.ts-calendar-pomodoro-strip').length===1,
'diary has one shared timer':diary.querySelectorAll('.ts-calendar-pomodoro-strip').length===1,
'diary actions belong to compact header':!!diary.querySelector('.ts-journal-header>.ts-journal-actions'),
'native Markdown rendering remains':!!diary.querySelector('.ts-journal-body strong')&&!!diary.querySelector('.ts-journal-body code'),
'large decorative heading rule removed':getComputedStyle(diary.querySelector('.ts-journal-body h2'),'::after').content==='none',
'original fixture untouched by rendering':await app.vault.read(q.file)===q.source});
"""))
    record(native("""
const result={'more calendar tools has accessible entry':!!q.calendar.contentEl.querySelector('button.ts-calendar-tools[aria-label="更多日历工具"]')};
await q.calendar.setState({calendarView:'year'});
result['year view remains functional']=q.calendar.contentEl.querySelectorAll('.ts-calendar-year-month').length===12;
await q.calendar.setState({calendarView:'month',taskView:'quadrants'});q.panel().setFilter('today',true);
result['quadrants remain fixed four']=q.calendar.contentEl.querySelectorAll('.ts-task-quadrant').length===4;
result['quadrants retain more filters']=!!q.calendar.contentEl.querySelector('.ts-task-filter-disclosure summary');
await q.calendar.setState({taskView:'list'});q.panel().setFilter('overdue',true);
result['empty list is a single short hint']=q.calendar.contentEl.querySelectorAll('.ts-task-empty').length===1&&!q.calendar.contentEl.querySelector('.ts-task-count');
q.panel().setFilter('today',true);return JSON.stringify(result);
"""))
    record(native("""
await app.workspace.revealLeaf(q.calendar.leaf);const root=q.calendar.contentEl,rows=root.querySelector('.ts-task-rows'),grid=root.querySelector('.ts-calendar-grid'),panel=q.panel();
const calendarPanel=root.querySelector('.ts-journal-calendar-panel'),timerPanel=root.querySelector('.ts-journal-timer-panel'),calendarTab=root.querySelector('[data-top-pane="calendar"]'),timerTab=root.querySelector('[data-top-pane="timer"]'),before=root.querySelector('.ts-journal-task-area').getBoundingClientRect().top;
const result={'calendar is default without timer space':!calendarPanel.hidden&&timerPanel.hidden};
timerTab.click();result['timer replaces calendar instead of stacking']=calendarPanel.hidden&&!timerPanel.hidden;
const timer=timerPanel.querySelector('.ts-calendar-pomodoro-strip'),timerRect=timer.getBoundingClientRect(),taskRect=root.querySelector('.ts-journal-task-area').getBoundingClientRect();
result['timer panel is generous and leaves task space']=timerRect.height>=200&&timerRect.height<=280&&taskRect.top-timerRect.bottom>=12&&taskRect.top-timerRect.bottom<=40&&taskRect.top-root.getBoundingClientRect().top<=370;
result['timer clock is visibly larger']=parseFloat(getComputedStyle(timer.querySelector('.ts-calendar-pomodoro-strip-clock')).fontSize)>=42;
result['diary timer remains compact']=q.journalView.contentEl.querySelector('.ts-calendar-pomodoro-strip').getBoundingClientRect().height<=42;
result['switch retains task DOM and filter']=root.querySelector('.ts-task-rows')===rows&&q.panel()===panel;
result['top selection included in saved view state']=q.calendar.getState().topPane==='timer';
timerTab.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));
result['keyboard switch keeps focused tab and selected state']=calendarTab.getAttribute('aria-selected')==='true'&&document.activeElement===calendarTab;
result['calendar DOM remains intact after switching']=root.querySelector('.ts-calendar-grid')===grid;
return JSON.stringify(result);
"""))
    fixtures=native("""
const result={calendar:q.calendar.contentEl.outerHTML,day:q.journalView.contentEl.outerHTML};
q.calendar.contentEl.querySelector('[data-top-pane=timer]').click();result.timer=q.calendar.contentEl.outerHTML;q.calendar.contentEl.querySelector('[data-top-pane=calendar]').click();
q.panel().setFilter('overdue',true);result['calendar-empty']=q.calendar.contentEl.outerHTML;
await q.calendar.setState({taskView:'quadrants'});q.panel().setFilter('today',true);result.quadrants=q.calendar.contentEl.outerHTML;
await q.calendar.setState({taskView:'list',calendarView:'year'});result.year=q.calendar.contentEl.outerHTML;
await q.calendar.setState({calendarView:'month'});q.panel().setFilter('today',true);
await q.journalView.setState({mode:'week'});result.week=q.journalView.contentEl.outerHTML;
await q.journalView.setState({mode:'agenda'});result.agenda=q.journalView.contentEl.outerHTML;
await q.journalView.setState({mode:'day'});return JSON.stringify(result);
""")
    (out/'sidebar-fixtures.json').write_text(json.dumps(fixtures,ensure_ascii=False,indent=2)+'\n')
    record(native("""
q.calendar.contentEl.querySelector('[data-top-pane=timer]').click();
q.calendarRoot=q.calendar.contentEl.querySelector('.ts-calendar-grid');q.diaryBody=q.journalView.contentEl.querySelector('.ts-journal-body');
q.calendar.contentEl.querySelector('.ts-calendar-pomodoro-strip-primary').click();await q.wait(()=>q.p.pomodoro.snapshot().state.session.status==='running'&&!q.p.pomodoro.snapshot().busy);
q.now+=65000;q.p.pomodoro.tick();
const clocks=[q.calendar,q.journalView].map(view=>view.contentEl.querySelector('.ts-calendar-pomodoro-strip-clock').textContent);
const result={'calendar starts Pomodoro mode':q.p.pomodoro.snapshot().state.session.mode==='pomodoro','two pages show same countdown':clocks[0]===clocks[1],
'ticks retain calendar grid':q.calendar.contentEl.querySelector('.ts-calendar-grid')===q.calendarRoot,
'ticks retain diary Markdown DOM':q.journalView.contentEl.querySelector('.ts-journal-body')===q.diaryBody};
q.journalView.contentEl.querySelector('.ts-calendar-pomodoro-strip-primary').click();await q.wait(()=>q.p.pomodoro.snapshot().state.session.status==='paused'&&!q.p.pomodoro.snapshot().busy);
result['diary pause controls shared clock']=q.p.pomodoro.snapshot().state.session.status==='paused';q.now+=300000;
q.calendar.contentEl.querySelector('.ts-calendar-pomodoro-strip-primary').click();await q.wait(()=>q.p.pomodoro.snapshot().state.session.status==='running'&&!q.p.pomodoro.snapshot().busy);q.now+=10000;q.p.pomodoro.tick();
q.journalView.contentEl.querySelector('.ts-calendar-pomodoro-strip-more').click();q.journalView.contentEl.querySelector('.ts-calendar-pomodoro-strip-stop').click();await q.wait(()=>q.p.pomodoro.snapshot().state.session.status==='finished'&&!q.p.pomodoro.snapshot().busy);
result['stop records actual excluding pauses']=q.p.pomodoro.snapshot().state.records.at(-1).durationMs===75000;
result['timer actions leave diary original intact']=await app.vault.read(q.file)===q.source;
result['clock actions made no Apple requests']=q.appleQueries===0;
const expand=q.calendar.contentEl.querySelector('.ts-calendar-pomodoro-strip-button[aria-label="展开完整计时器"]');expand.click();await q.wait(()=>!expand.disabled&&app.workspace.getLeavesOfType('thoughtspace-pomodoro').length===1&&app.workspace.getLeavesOfType('thoughtspace-pomodoro')[0].view.getDisplayText()==='计时器');
result['expand reuses one full timer pane']=app.workspace.getLeavesOfType('thoughtspace-pomodoro').length===1;
return JSON.stringify(result);
"""))
finally:
    if initialized or evaluate("JSON.stringify(!!window[Symbol.for('thoughtspace.compact-sidebar-qa')])"):
        native("""
await q.p.pomodoro.settled();q.p.pomodoro.dispose();q.p.journalLinks?.unload();await q.p.journalLinks?.queue;q.p.settings=q.settings;q.p.taskPlanner.all=q.originalAll;q.p.taskPlanner.undo=q.undo;q.p.appleCalendar.events=q.appleEvents;
if(q.stateExists)await app.vault.adapter.write(q.statePath,q.stateText);else if(await app.vault.adapter.exists(q.statePath))await app.vault.adapter.remove(q.statePath);
const folder=app.vault.getAbstractFileByPath(q.folder);if(folder)await app.vault.delete(folder,true);return JSON.stringify(true);
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
const result={'timer state restored':q.stateExists?await app.vault.adapter.read(q.statePath)===q.stateText:!await app.vault.adapter.exists(q.statePath),'settings restored':await app.vault.adapter.read(q.dataPath)===q.dataText,'fixture removed':!app.vault.getAbstractFileByPath(q.folder),'workspace restored':true};delete window[Symbol.for('thoughtspace.compact-sidebar-qa')];return JSON.stringify(result);
""")
        record(restored)
record({'native developer errors unchanged':command('dev:errors')==before_errors})
report={'version':expected,'checks':len(checks),'passed':checks,'errors':[],'scope':'Native synthetic notes and shared real timer; original timer/settings/view state and selected tabs restored, no Apple event access. Lazy placeholder titles/icons may resolve to registered views.'}
(out/'native-result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'checks':len(checks),'errors':[]},ensure_ascii=False))
