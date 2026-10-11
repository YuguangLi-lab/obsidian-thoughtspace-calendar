"""Exercise the installed Tasks plugin and calendar against unique native fixtures.

Run with --vault TEST_VAULT. Saves/restores Tasks settings, the workspace, and
calendar undo; deletes only its uniquely named fixtures. Never reads Apple events.
"""
from pathlib import Path
import argparse
import json
import subprocess
import uuid
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--vault', required=True)
parser.add_argument('--report', default='native-tasks-verify.json')
parser.add_argument('--visuals', action='store_true', help='Export only synthetic task UI for layout QA')
args = parser.parse_args()
output = Path(__file__).resolve().parent / 'large-calendar-output'
output.mkdir(exist_ok=True)
results = []
metrics = {}

def command(*parts):
    return subprocess.run(['obsidian', f'vault={args.vault}', *parts], check=True,
                          capture_output=True, text=True, timeout=60).stdout

def evaluate(code):
    raw = command('eval', 'code=' + code)
    if '=> ' not in raw:
        raise RuntimeError(raw)
    return json.loads(raw.split('=> ', 1)[1].strip())

def native(code):
    return evaluate("(async()=>{const q=window[Symbol.for('thoughtspace.native-tasks-qa')];" + code + '})()')

def record(group, code):
    try:
        data = native(code)
        for name, passed in data.items():
            if name == 'metrics':
                metrics.update(passed)
            else:
                results.append({'name': group + ': ' + name, 'passed': passed is True})
    except Exception as error:
        results.append({'name': group, 'passed': False, 'error': str(error)[-1200:]})

snapshot = evaluate('JSON.stringify({layout:app.workspace.getLayout(),active:app.workspace.activeLeaf?.id})')
errors_before = command('dev:errors')
folder = 'TS-Tasks-Native-QA-' + uuid.uuid4().hex[:12]
try:
    start = evaluate("""(async()=>{
const key=Symbol.for('thoughtspace.native-tasks-qa');if(window[key])throw Error('Native Tasks QA already running');
const p=app.plugins.getPlugin('thoughtspace-calendar'),t=app.plugins.getPlugin('obsidian-tasks-plugin');
if(!p?.ready||typeof t?.apiV1?.executeToggleTaskDoneCommand!=='function')throw Error('Enable both calendar and Tasks before QA');
const config=app.vault.configDir+'/plugins/obsidian-tasks-plugin/data.json';
const q={p,t,folder:FOLDER,config,configExists:await app.vault.adapter.exists(config),undo:p.taskPlanner.undo,journal:p.journalLinks,journalLoaded:!!p.journalLinks?._loaded,appleEvents:p.appleCalendar.events,NL:String.fromCharCode(10),CR:String.fromCharCode(13)};
window[key]=q;q.configText=q.configExists?await app.vault.adapter.read(config):null;
q.baseSettings=await t.loadData()||{};
q.journal?.unload();await q.journal?.queue;p.appleCalendar.events=async()=>({events:[],truncated:false});
q.frame=()=>new Promise(resolve=>{const timer=setTimeout(resolve,100);requestAnimationFrame(()=>{clearTimeout(timer);resolve();});});
q.wait=async(fn)=>{for(let i=0;i<120;i++){if(await fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Native Tasks state did not settle');};
q.configure=async(patch={})=>{await q.t.saveData({...q.baseSettings,globalFilter:'',taskFormat:'tasksPluginEmoji',setDoneDate:true,recurrenceOnNextLine:false,...patch});await q.t.loadSettings();};
await q.configure();await app.vault.createFolder(q.folder);q.file=await app.vault.create(q.folder+'/recurrence.md','Native Tasks fixture');
q.source='- [ ] Native repeat #TSQA 🔁 every day 📅 2026-10-11 ^native-repeat';
q.rows=()=>q.p.taskPlanner.all().filter(row=>row.path===q.file.path);
q.reset=async(text)=>{await q.p.taskPlanner.writes;await app.vault.modify(q.file,text);await q.p.taskPlanner.ready();await q.p.taskPlanner.flush();};
q.text=()=>app.vault.read(q.file);
q.day='2026-10-11';q.today=window.moment().format('YYYY-MM-DD');
q.calendar=(await q.p.ensureCalendar(true)).view;await q.calendar.showDay(q.day,false);
q.panel=()=>q.calendar.renderScope?._children.find(c=>typeof c.setFilter==='function');
await q.wait(()=>!!q.panel());
return JSON.stringify({calendar:p.manifest.version,tasks:t.manifest.version,state:t.getState()});
})()""".replace('FOLDER', json.dumps(folder)))
    metrics.update(start)

    record('real API and file', """
await q.reset(q.source);const expected=q.t.apiV1.executeToggleTaskDoneCommand(q.source,q.file.path);
let count=0;const stop=q.p.taskPlanner.subscribe(()=>count++),start=performance.now();
await q.p.taskPlanner.update(q.rows()[0],{checked:true});const latency=performance.now()-start;stop();
const text=await q.text(),rows=q.rows();
await q.wait(()=>q.t.getTasks().filter(t=>t.path===q.file.path).length===2);
const result={exactApiOutput:text===expected,nextOccurrence:rows.some(t=>!t.checked&&t.due==='2026-10-12'),completionDate:rows.some(t=>t.checked&&t.completedOn===q.today),singleBlockReference:text.split('^native-repeat').length===2,TasksCacheAgrees:q.t.getTasks().filter(t=>t.path===q.file.path).length===2,oneNotification:count===1,metrics:{completionMs:latency,notifications:count}};
await q.p.taskPlanner.undoLast();result.exactUndo=(await q.text())===q.source;
return JSON.stringify(result);
""")
    record('undated recurrence race', """
const source='- [ ] Undated #TSQA 🔁 every day';await q.reset(source);const stale=q.rows()[0];
const results=await Promise.allSettled([q.p.taskPlanner.update(stale,{checked:true}),q.p.taskPlanner.update(stale,{checked:true})]);
const result={queuedClickRejected:results[0].status==='fulfilled'&&results[1].status==='rejected',onlyOneCompletion:q.rows().filter(t=>t.checked).length===1};
await q.reset(source);const old=q.rows()[0];
// Native Tasks modifies the source before the calendar's debounce has flushed.
await app.vault.process(q.file,text=>q.t.apiV1.executeToggleTaskDoneCommand(text,q.file.path));
const before=await q.text();let rejected=false;try{await q.p.taskPlanner.update(old,{checked:true});}catch{rejected=true;}
result.externalTasksRaceRejected=rejected;result.externalTasksResultPreserved=(await q.text())===before;
return JSON.stringify(result);
""")
    record('queued distinct recurrences', """
await q.reset(['Alpha','Beta','Gamma'].map(name=>'- [ ] '+name+' #TSQA 🔁 every day 📅 2026-10-11').join(q.NL));
const rows=q.rows(),start=performance.now(),outcomes=await Promise.allSettled(rows.map(row=>q.p.taskPlanner.update(row,{checked:true})));
const result={allQueuedActionsComplete:outcomes.every(r=>r.status==='fulfilled'),oneNextOccurrenceEach:q.rows().length===6&&q.rows().filter(t=>t.checked).length===3&&q.rows().filter(t=>!t.checked&&t.due==='2026-10-12').length===3,metrics:{queuedMs:performance.now()-start,queuedErrors:outcomes.filter(r=>r.status==='rejected').map(r=>String(r.reason))}};
return JSON.stringify(result);
""")
    record('source safety', """
await q.reset('Intro'+q.CR+q.NL+q.source+q.CR+q.NL+'Keep paragraph');await q.p.taskPlanner.update(q.rows()[0],{checked:true});const crlf=await q.text();
const result={CRLFPreserved:crlf.split(q.NL).slice(0,-1).every(line=>line.endsWith(q.CR))};
await app.vault.modify(q.file,crlf.replace('Keep paragraph','Independent edit'));await q.p.taskPlanner.undoLast();
result.undoPreservesOtherText=(await q.text())==='Intro'+q.CR+q.NL+q.source+q.CR+q.NL+'Independent edit';
await q.reset(q.source);await q.p.taskPlanner.update(q.rows()[0],{checked:true});const done=q.rows().find(t=>t.checked);await q.p.taskPlanner.update(done,{checked:false});
result.reopenDoesNotGenerate=q.rows().length===2&&q.rows().every(t=>!t.checked);
await q.reset(q.source);await q.p.taskPlanner.update(q.rows()[0],{checked:true});const edited=(await q.text()).replace('2026-10-12','2026-10-15');await app.vault.modify(q.file,edited);
let rejected=false;try{await q.p.taskPlanner.undoLast();}catch{rejected=true;}result.changedGeneratedTaskBlocksUndo=rejected&&(await q.text())===edited;
return JSON.stringify(result);
""")
    record('configured Tasks behavior', """
const result={};await q.configure({recurrenceOnNextLine:true,setDoneDate:false});await q.reset(q.source);await q.p.taskPlanner.update(q.rows()[0],{checked:true});const text=await q.text();
result.doneFirst=text.split(q.NL)[0].startsWith('- [x]');result.noForcedCompletionDate=!text.includes('✅');
await q.configure({globalFilter:'#missing-global-tag'});await q.reset(q.source);let rejected=false;try{await q.p.taskPlanner.update(q.rows()[0],{checked:true});}catch(e){rejected=String(e).includes('未生成下一次');}
result.missingGlobalFilterPreservesSource=rejected&&(await q.text())===q.source;
await q.configure({globalFilter:'#TSQA'});await q.reset(q.source);await q.p.taskPlanner.update(q.rows()[0],{checked:true});result.matchingGlobalFilterRepeats=q.rows().length===2;
await q.configure();await q.reset(q.source.replace('every day','nonsense'));rejected=false;try{await q.p.taskPlanner.update(q.rows()[0],{checked:true});}catch{rejected=true;}result.invalidRulePreserved=rejected&&(await q.text()).includes('nonsense');
return JSON.stringify(result);
""")
    record('native Dataview', """
await q.configure({taskFormat:'dataview'});const source='- [ ] Dataview #TSQA (repeat:: every day) (scheduled:: 2026-10-11) (due:: 2026-10-12) (priority:: high) ^dv';await q.reset(source);
await q.p.taskPlanner.update(q.rows()[0],{checked:true});const next=q.rows().find(t=>!t.checked),done=q.rows().find(t=>t.checked);
const items=await q.p.largeCalendarHost.tasks(new Date(2026,9,11),new Date(2026,9,15));
const result={recurrence:next?.scheduled==='2026-10-12'&&next?.due==='2026-10-13',completion:done?.completedOn===q.today,priority:next?.priority===1,calendarDate:items.some(t=>t.source===q.file.path&&!t.completed&&t.date==='2026-10-12')};
await q.p.taskPlanner.undoLast();result.undoPreservesRoundBrackets=(await q.text())===source;
await q.p.taskPlanner.update(q.rows()[0],{scheduled:'2026-10-15',time:{start:'09:07',end:'10:13'}});const scheduled=await q.text();result.scheduleKeepsFormat=scheduled.includes('(scheduled:: 2026-10-15)')&&!scheduled.includes('⏳')&&scheduled.endsWith('^dv');
await q.configure();return JSON.stringify(result);
""")
    record('native list and quadrants UI', """
await q.reset(q.source+q.NL+'- [ ] Next visible #TSQA 📅 2026-10-11');const panel=q.panel();panel.setFilter('today');panel.query='TSQA';panel.render();
q.calendar.contentEl.querySelector('[aria-label="列表模式"]').click();
const row=[...q.calendar.contentEl.querySelectorAll('.ts-task-row')].find(e=>e.dataset.path===q.file.path&&e.dataset.line==='0'),check=row.querySelector('input[type=checkbox]');
let renders=0;const old=panel.render;panel.render=function(...args){renders++;return old.apply(this,args);};
check.focus();const start=performance.now();check.click();await q.wait(()=>q.rows().some(t=>t.checked));await q.p.taskPlanner.writes;await q.frame();
const result={listNativeClickCreatesNext:q.rows().some(t=>!t.checked&&t.due==='2026-10-12'),focusStaysInTaskPanel:panel.el.contains(document.activeElement),oneListRender:renders===1,metrics:{listClickMs:performance.now()-start,listRenders:renders}};panel.render=old;
await q.p.taskPlanner.undoLast();q.calendar.contentEl.querySelector('[aria-label="四象限模式"]').click();
const quadratic=[...q.calendar.contentEl.querySelectorAll('.ts-task-row')].find(e=>e.dataset.path===q.file.path&&e.dataset.line==='0');quadratic.querySelector('input[type=checkbox]').click();await q.wait(()=>q.rows().some(t=>t.checked));await q.p.taskPlanner.writes;
result.quadrantsNativeClickCreatesNext=q.rows().some(t=>!t.checked&&t.due==='2026-10-12');result.fourQuadrants=q.calendar.contentEl.querySelectorAll('.ts-task-quadrant').length===4;
await q.p.taskPlanner.undoLast();const moved=[...q.calendar.contentEl.querySelectorAll('.ts-task-row')].find(e=>e.dataset.path===q.file.path&&e.dataset.line==='0');
const select=moved.querySelector('select');select.focus();select.value='q2';select.dispatchEvent(new Event('change',{bubbles:true}));await q.p.taskPlanner.writes;await q.frame();
result.quadrantSelectKeepsFocus=panel.el.contains(document.activeElement)&&document.activeElement.matches('select.ts-task-quadrant-select');
result.quadrantMovePreservesRecurrence=q.rows().length===2&&q.rows()[0].recurring&&!q.rows()[0].checked;

return JSON.stringify(result);
""")
    record('continuous keyboard and scroll', """
await q.reset(Array.from({length:28},(_,i)=>`- [ ] Row ${String(i).padStart(2,'0')} #TSQA 📅 2026-10-11`).join(q.NL));
q.calendar.contentEl.querySelector('[aria-label="列表模式"]').click();const panel=q.panel();panel.setFilter('today');panel.query='TSQA';panel.render();
const row=[...panel.el.querySelectorAll('.ts-task-row')].find(e=>e.dataset.line==='10'&&e.dataset.path===q.file.path),check=row.querySelector('input[type=checkbox]');
check.scrollIntoView({block:'center'});check.focus({preventScroll:true});await q.frame();
const scrolls=[];for(let e=row.parentElement;e;e=e.parentElement)if(e.scrollHeight>e.clientHeight+20&&e.scrollTop>0)scrolls.push({el:e,y:e.scrollTop});
check.click();await q.p.taskPlanner.writes;await q.frame();
const result={listScrollStable:scrolls.length>0&&scrolls.every(s=>Math.abs(s.el.scrollTop-s.y)<2),metrics:{scrollAncestors:scrolls.length,scrollDelta:scrolls.map(s=>s.el.scrollTop-s.y)}};
await q.reset(q.source.replace('Native repeat','09:00 - 09:30 Native repeat')+q.NL+'- [ ] 10:00 - 10:30 Next visible #TSQA 📅 2026-10-11');
q.calendar.contentEl.querySelector('[aria-label="时间线模式"]').click();
await q.wait(()=>q.calendar.contentEl.querySelector('.ts-day-timeline input[type=checkbox]'));
const doneButton=q.calendar.contentEl.querySelector('.ts-day-timeline [aria-label="隐藏已完成事项"]');if(doneButton)doneButton.click();await q.frame();
const timeline=q.calendar.contentEl.querySelector('.ts-day-timeline');const box=[...timeline.querySelectorAll('input[type=checkbox]')].find(e=>e.getAttribute('aria-label')?.includes('Native repeat'));
box.focus();box.click();await q.p.taskPlanner.writes;await q.frame();
result.timelineFocusStaysInTasks=timeline.contains(document.activeElement)&&document.activeElement.matches('input[type=checkbox]');
await q.reset(Array.from({length:2},()=>'- [ ] 11:00 - 11:30 Same title #TSQA 📅 2026-10-11').join(q.NL));
const boxes=()=>[...timeline.querySelectorAll('input[type=checkbox]')].filter(e=>e.getAttribute('aria-label')?.includes('Same title'));
boxes()[1].focus();await q.p.taskPlanner.update(q.rows()[0],{priority:1});await q.frame();
result.sameTitleKeepsCorrectFocus=boxes().indexOf(document.activeElement)===1;
return JSON.stringify(result);
""")
    record('rapid native checkbox sequence', """
const result={},latencies={};
for(const mode of ['列表','四象限','时间线']){
 await q.reset(Array.from({length:6},(_,i)=>`- [ ] 09:${String(i*5).padStart(2,'0')} - 10:00 Batch ${i} #TSQA 🔁 every day 📅 2026-10-11`).join(q.NL));
 const panel=q.panel();panel.query='TSQA';panel.setFilter('today');q.calendar.contentEl.querySelector(`[aria-label="${mode}模式"]`).click();
 await q.wait(()=>[...panel.el.querySelectorAll('input[type=checkbox]')].filter(el=>el.closest('[data-path]')?.dataset.path===q.file.path).length===6);
 const checks=[...panel.el.querySelectorAll('input[type=checkbox]')].filter(el=>el.closest('[data-path]')?.dataset.path===q.file.path),start=performance.now();
 checks.forEach(el=>el.click());await q.p.taskPlanner.writes;latencies[mode]=performance.now()-start;
 result[mode+'SixCompletions']=q.rows().filter(t=>t.checked).length===6&&q.rows().filter(t=>!t.checked&&t.due==='2026-10-12').length===6;
 await q.p.taskPlanner.undoLast();result[mode+'UndoOnlyLast']=q.rows().filter(t=>t.checked).length===5&&q.rows().length===11;
}
result.metrics={sixCheckboxWritesMs:latencies};return JSON.stringify(result);
""")
    record('timeline minute tick', """
await q.reset('- [ ] 09:00 - 09:30 Clock fixture #TSQA 📅 2026-10-11');
q.calendar.contentEl.querySelector('[aria-label="列表模式"]').click();
let tick;const original=window.setInterval;window.setInterval=function(fn,delay,...rest){if(delay===60000)tick=fn;return original.call(this,fn,delay,...rest);};
try{q.calendar.contentEl.querySelector('[aria-label="时间线模式"]').click();await q.wait(()=>q.panel()?.timeline?.body?.querySelector('input[type=checkbox]'));}finally{window.setInterval=original;}
const timeline=q.panel().timeline,body=timeline.body,check=body.querySelector('input[type=checkbox]');check.focus();const row=check.closest('.ts-timeline-item');
let count=0;const observer=new MutationObserver(records=>count+=records.filter(r=>r.type==='childList').length);observer.observe(body,{childList:true,subtree:true});
if(typeof tick!=='function')throw Error('Minute timer was not captured');tick();await q.frame();observer.disconnect();
const result={minuteKeepsRowIdentity:row.isConnected&&body.contains(row),minuteKeepsFocusedControl:check===document.activeElement,metrics:{minuteChildListChanges:count}};
if(timeline.refreshClock){timeline.refreshClock(new Date(2026,9,11,9,15));result.activeAtStart=row.classList.contains('is-current')&&!row.querySelector('.ts-timeline-active-label').hidden;timeline.refreshClock(new Date(2026,9,11,9,30));result.inactiveAtEnd=!row.classList.contains('is-current');timeline.refreshClock(new Date(2026,9,12,0,0));result.hidesYesterdayClock=body.querySelector('.ts-timeline-now').hidden;timeline.refreshClock();}
return JSON.stringify(result);
""")
    record('timeline direct time edit', """
await q.reset('- [ ] 09:00 - 09:30 Time edit #TSQA 🔁 every day 📅 2026-10-11 ^time-edit');
q.calendar.contentEl.querySelector('[aria-label="时间线模式"]').click();await q.wait(()=>q.panel()?.timeline?.body?.querySelector('.ts-timeline-time.is-editable'));
const button=q.panel().timeline.body.querySelector('.ts-timeline-time.is-editable');button.click();
const modal=document.querySelector('.ts-task-schedule-modal'),start=modal.querySelector('[aria-label="开始时间"]'),end=modal.querySelector('[aria-label="结束时间（可选）"]');
const result={timeButtonOpensPopulatedEditor:start.value==='09:00'&&end.value==='09:30'};
start.value='09:13';end.value='10:07';modal.querySelector('form').requestSubmit();await q.wait(()=>!modal.isConnected);await q.p.taskPlanner.writes;
result.exactTimeKeepsRuleAndReference=(await q.text()).includes('09:13 - 10:07 Time edit')&&(await q.text()).includes('🔁 every day')&&(await q.text()).endsWith('^time-edit');
await q.p.taskPlanner.undoLast();result.timeEditUndoRestoresOriginal=(await q.text()).startsWith('- [ ] 09:00 - 09:30');return JSON.stringify(result);
""")
    record('timeline and large calendar UI', """
await q.reset(q.source.replace('Native repeat','09:00 - 09:30 Native repeat'));q.calendar.contentEl.querySelector('[aria-label="时间线模式"]').click();await q.wait(()=>[...q.calendar.contentEl.querySelectorAll('.ts-day-timeline input[type=checkbox]')].some(e=>e.getAttribute('aria-label')?.includes('Native repeat')));
const check=[...q.calendar.contentEl.querySelectorAll('.ts-day-timeline input[type=checkbox]')].find(e=>e.getAttribute('aria-label').includes('Native repeat'));check.click();await q.wait(()=>q.rows().some(t=>t.checked));await q.p.taskPlanner.writes;
const result={timelineNativeClickCreatesNext:q.rows().some(t=>!t.checked&&t.due==='2026-10-12')};
await q.reset(q.source);await q.p.openLargeCalendar(q.day);q.large=app.workspace.getLeavesOfType('thoughtspace-large-calendar')[0].view;await q.large.refresh();
const card=[...q.large.contentEl.querySelectorAll('.tsc-agenda-task-entry')].find(e=>e.textContent.includes('Native repeat'));
card.querySelector('[aria-label="完成任务"]').click();await q.wait(()=>q.rows().some(t=>t.checked));await q.p.taskPlanner.writes;await q.wait(()=>!q.large.contentEl.querySelector('.is-busy'));
result.largeCalendarClickCreatesNext=q.rows().some(t=>!t.checked&&t.due==='2026-10-12');return JSON.stringify(result);
""")
    record('refresh and idle', """
await new Promise(r=>setTimeout(r,500));let count=0;const stop=q.p.taskPlanner.subscribe(()=>count++);await q.p.taskPlanner.ready();await q.p.taskPlanner.flush();stop();
return JSON.stringify({unchangedIndexDoesNotNotify:count===0,metrics:{idleNotifications:count}});
""")
    if args.visuals:
        previews = native("""
await q.reset([
'- [ ] 09:00 - 09:30 阅读并整理研究笔记 #界面样例 🔁 every day ⏫ 📅 2026-10-11',
'- [ ] 本周写作计划 #界面样例 ⏫ ⏳ 2026-10-11 📅 2026-10-15',
'- [ ] 回复协作消息 #界面样例 📅 2026-10-11',
'- [ ] 整理待读资料 #界面样例 ⏳ 2026-10-11'
].join(q.NL));
const panel=q.panel();panel.query='界面样例';panel.setFilter('today');
const result={};for(const mode of ['列表','四象限','时间线']){
q.calendar.contentEl.querySelector(`[aria-label="${mode}模式"]`).click();await q.frame();
result[mode]=q.calendar.contentEl.querySelector('.ts-journal-task-area').outerHTML;
}
return JSON.stringify(result);
""")
        (output / 'task-ui-fixtures.json').write_text(json.dumps(previews, ensure_ascii=False, indent=2))
    errors_after = command('dev:errors')
    results.append({'name': 'no new native errors', 'passed': errors_after == errors_before})
finally:
    try:
        cleaned = native("""
if(!q)return JSON.stringify(true);
try{
await q.p.taskPlanner.writes;
if(q.configExists)await app.vault.adapter.write(q.config,q.configText);else if(await app.vault.adapter.exists(q.config))await app.vault.adapter.remove(q.config);
await q.t.loadSettings();
const f=app.vault.getAbstractFileByPath(q.folder);if(f&&q.folder.startsWith('TS-Tasks-Native-QA-'))await app.vault.delete(f,true);
await q.p.taskPlanner.flush();
return JSON.stringify(!app.vault.getAbstractFileByPath(q.folder));
}finally{q.p.taskPlanner.undo=q.undo;q.p.appleCalendar.events=q.appleEvents;if(q.journalLoaded)q.journal.load();delete window[Symbol.for('thoughtspace.native-tasks-qa')];}
""")
        results.append({'name': 'fixtures removed and settings restored', 'passed': cleaned})
    finally:
        evaluate('(async()=>{await app.workspace.changeLayout(' + json.dumps(snapshot['layout']) + ');return JSON.stringify(true);})()')

report = {'checkedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'passed': sum(r['passed'] for r in results),
          'tests': len(results), 'results': results, 'metrics': metrics,
          'scope': 'Installed official Tasks; native vault writes, cache and DOM checkbox actions. Temporary settings restored; unique fixtures deleted; no Apple access.'}
(output / args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2))
print(json.dumps(report, ensure_ascii=False, indent=2))
if report['passed'] != report['tests']:
    raise SystemExit(1)
