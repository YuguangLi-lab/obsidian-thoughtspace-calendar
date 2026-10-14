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
parser.add_argument('--visuals', action='store_true', help='Export only synthetic task, calendar and journal UI for layout QA')
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
(output / 'native-tasks-before.json').write_text(json.dumps(snapshot, ensure_ascii=False, indent=2))
errors_before = command('dev:errors')
folder = 'TS-Tasks-Native-QA-' + uuid.uuid4().hex[:12]
try:
    start = evaluate("""(async()=>{
const key=Symbol.for('thoughtspace.native-tasks-qa');if(window[key])throw Error('Native Tasks QA already running');
const p=app.plugins.getPlugin('thoughtspace-calendar'),t=app.plugins.getPlugin('obsidian-tasks-plugin');
if(!p?.ready||typeof t?.apiV1?.executeToggleTaskDoneCommand!=='function')throw Error('Enable both calendar and Tasks before QA');
if(document.querySelector('.ts-task-schedule-modal,.ts-timeline-modal,.tsc-dialog'))throw Error('Close calendar dialogs before QA');
const config=app.vault.configDir+'/plugins/obsidian-tasks-plugin/data.json';
const q={p,t,folder:FOLDER,config,configExists:await app.vault.adapter.exists(config),undo:p.taskPlanner.undo,journal:p.journalLinks,journalLoaded:!!p.journalLinks?._loaded,appleEvents:p.appleCalendar.events,NL:String.fromCharCode(10),CR:String.fromCharCode(13)};
window[key]=q;q.configText=q.configExists?await app.vault.adapter.read(config):null;
q.baseSettings=await t.loadData()||{};q.journalFolder=p.settings.journalFolder;
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
    record('queued property and completion', """
await q.reset('- [ ] 09:00 - 09:30 Rapid plan #TSQA 🔁 every day 📅 2026-10-11 ^rapid-plan');
const task=q.rows()[0],outcomes=await Promise.allSettled([
 q.p.taskPlanner.update(task,{scheduled:'2026-10-11',time:{start:'09:13',end:'10:07'}}),
 q.p.taskPlanner.update(task,{priority:1}),q.p.taskPlanner.update(task,{checked:true})]);
const result={allThreeActionsComplete:outcomes.every(r=>r.status==='fulfilled'),oneNextKeepsTimeAndPriority:q.rows().length===2&&q.rows().some(t=>!t.checked&&t.priority===1&&t.source.includes('09:13 - 10:07')&&t.due==='2026-10-12'),metrics:{sameTaskQueueErrors:outcomes.filter(r=>r.status==='rejected').map(r=>String(r.reason))}};
await q.reset('- [ ] External repeat #TSQA 🔁 every day');const stale=q.rows()[0];
await app.vault.process(q.file,text=>q.t.apiV1.executeToggleTaskDoneCommand(text,q.file.path));
const before=await q.text();let rejected=false;try{await q.p.taskPlanner.update(stale,{priority:1});}catch{rejected=true;}
result.externalOccurrenceAttributesRejected=rejected&&(await q.text())===before;
return JSON.stringify(result);
""")
    record('queued completion undo and next task', """
await q.reset(['Undo first','Continue next'].map(name=>'- [ ] '+name+' #TSQA 🔁 every day 📅 2026-10-11').join(q.NL));
const rows=q.rows(),outcomes=await Promise.allSettled([q.p.taskPlanner.update(rows[0],{checked:true}),q.p.taskPlanner.undoLast(),q.p.taskPlanner.update(rows[1],{checked:true})]);
return JSON.stringify({allActionsComplete:outcomes.every(r=>r.status==='fulfilled'),undoFirstThenCompleteSecond:q.rows().length===3&&q.rows().filter(t=>t.checked).length===1&&q.rows().find(t=>t.checked)?.text.includes('Continue next')});
""")
    record('quadrant recurrence continuity', """
const result={};
for(const legacy of [false,true]){
 const source=legacy?'- [ ] Quadrant repeat #TSQA 🔁 every 2 days 📅 2026-10-11 <!-- thoughtspace:quadrant=q2 --> ^quad-repeat':'- [ ] Quadrant repeat #TSQA 🔁 every 2 days 📅 2026-10-11 ^quad-repeat';
 await q.reset(source);if(!legacy){const panel=q.panel();panel.query='TSQA';panel.setFilter('today');q.calendar.contentEl.querySelector('[aria-label="四象限模式"]').click();await q.frame();const select=[...panel.el.querySelectorAll('.ts-task-row')].find(e=>e.dataset.path===q.file.path&&e.dataset.line==='0').querySelector('select');select.value='q2';select.dispatchEvent(new Event('change',{bubbles:true}));await q.p.taskPlanner.writes;}
 let fulfilled=true;try{await q.p.taskPlanner.update(q.rows()[0],{checked:true});}catch{fulfilled=false;}
 result[(legacy?'legacy':'new')+'QuadrantCompletes']=fulfilled&&q.rows().length===2&&q.rows().some(t=>!t.checked&&t.due==='2026-10-13'&&t.text.includes('thoughtspace:quadrant=q2'));
 if(fulfilled){const done=q.rows().find(t=>t.checked);await q.p.taskPlanner.update(done,{checked:false});result[(legacy?'legacy':'new')+'ReopenClearsCompletionDate']=q.rows().every(t=>!t.checked&&!t.completedOn);}
}
return JSON.stringify(result);
""")
    record('focus follows original task after insertion', """
const result={};for(const mode of ['列表','四象限','时间线']){
 await q.reset('- [ ] 09:00 - 09:30 Inserts before #TSQA 🔁 every day 📅 2026-10-10'+q.NL+'- [ ] 10:00 - 10:30 Keep original focus #TSQA 📅 2026-10-11');
 const panel=q.panel();panel.query='TSQA';panel.setFilter('unfinished');q.calendar.contentEl.querySelector(`[aria-label="${mode}模式"]`).click();await q.frame();
 const selector=mode==='时间线'?'.ts-timeline-item':'.ts-task-row',row=[...panel.el.querySelectorAll(selector)].find(e=>e.dataset.path===q.file.path&&e.dataset.line==='1');
 row.querySelector('input[type=checkbox]').focus();await q.p.taskPlanner.update(q.rows()[0],{checked:true});await q.frame();
 const active=document.activeElement,focused=active.closest(selector);result[mode+'FocusIdentity']=active.matches('input[type=checkbox]')&&focused?.dataset.path===q.file.path&&focused?.dataset.line==='2'&&focused.textContent.includes('Keep original focus');
}
return JSON.stringify(result);
""")
    record('calendar queued snapshots', """
await q.reset(['Calendar alpha','Calendar beta','Calendar gamma'].map(name=>'- [ ] '+name+' #TSQA 🔁 every day ⏳ 2026-10-11 📅 2026-10-11').join(q.NL));
const snapshots=(await q.p.largeCalendarHost.tasks(new Date(2026,9,11),new Date(2026,9,12))).filter(t=>t.source===q.file.path),outcomes=await Promise.allSettled(snapshots.map(t=>q.p.largeCalendarHost.toggleTask(t)));
return JSON.stringify({allSnapshotsComplete:outcomes.every(r=>r.status==='fulfilled'),eachGeneratesOnce:q.rows().filter(t=>t.checked).length===3&&q.rows().filter(t=>!t.checked&&t.scheduled==='2026-10-12').length===3,metrics:{calendarQueueErrors:outcomes.filter(r=>r.status==='rejected').map(r=>String(r.reason))}});
""")
    record('focus collision with generated occurrence', """
const result={};await q.calendar.showDay('2026-10-12',false);await q.wait(()=>!!q.panel());
for(const mode of ['列表','四象限','时间线']){
 await q.reset('- [ ] 09:00 - 09:30 Same future #TSQA 🔁 every day 📅 2026-10-11'+q.NL+'- [ ] 09:00 - 09:30 Same future #TSQA 🔁 every day 📅 2026-10-12');
 const panel=q.panel();panel.query='TSQA';panel.tag='';panel.setFilter('unfinished');q.calendar.contentEl.querySelector(`[aria-label="${mode}模式"]`).click();await q.frame();
 const selector=mode==='时间线'?'.ts-timeline-item':'.ts-task-row',row=[...panel.el.querySelectorAll(selector)].find(e=>e.dataset.path===q.file.path&&e.dataset.line==='1');
 row.querySelector('input[type=checkbox]').focus();await q.p.taskPlanner.update(q.rows()[0],{checked:true});await q.frame();
 const active=document.activeElement,focused=active.closest(selector);result[mode+'KeepsExistingOccurrence']=active.matches('input[type=checkbox]')&&focused?.dataset.path===q.file.path&&focused?.dataset.line==='2';
}
await q.calendar.showDay(q.day,false);await q.wait(()=>!!q.panel());return JSON.stringify(result);
""")
    record('external occurrence preserves undo safety', """
await q.configure({setDoneDate:false});await q.reset('- [ ] Undo occurrence #TSQA 🔁 every day');
await q.p.taskPlanner.update(q.rows()[0],{checked:true});
await app.vault.process(q.file,text=>{const lines=text.split(q.NL);lines.splice(0,1,...q.t.apiV1.executeToggleTaskDoneCommand(lines[0],q.file.path).split(q.NL));return lines.join(q.NL);});
const before=await q.text();let rejected=false;try{await q.p.taskPlanner.undoLast();}catch{rejected=true;}
const result={staleUndoRejected:rejected,externalOccurrencesPreserved:(await q.text())===before};await q.configure();return JSON.stringify(result);
""")
    record('adding recurrence preserves undo safety', """
await q.configure({setDoneDate:false});await q.reset('- [ ] Add repeat #TSQA');
await q.p.taskPlanner.update(q.rows()[0],{content:'Add repeat #TSQA 🔁 every day'});
await app.vault.process(q.file,text=>q.t.apiV1.executeToggleTaskDoneCommand(text,q.file.path));
const before=await q.text();let rejected=false;try{await q.p.taskPlanner.undoLast();}catch{rejected=true;}
const result={newRuleStaleUndoRejected:rejected,newOccurrenceKeepsRule:(await q.text())===before};await q.configure();return JSON.stringify(result);
""")
    record('timeline search and tag', """
await q.reset('- [ ] 09:00 - 09:30 Find needle #TSQA #FilterA 📅 2026-10-11'+q.NL+'- [ ] 10:00 - 10:30 Other result #TSQA #FilterB 📅 2026-10-11');
const panel=q.panel();panel.query='';panel.tag='';q.calendar.contentEl.querySelector('[aria-label="时间线模式"]').click();await q.frame();
const taskRows=()=>[...panel.el.querySelectorAll('.ts-timeline-item')].filter(e=>e.dataset.path===q.file.path);
panel.query='Find needle';panel.render();await q.frame();const result={searchFiltersTimeline:taskRows().length===1&&taskRows()[0].textContent.includes('Find needle')};
panel.query='';panel.tag='#FilterB';panel.render();await q.frame();result.tagFiltersTimeline=taskRows().length===1&&taskRows()[0].textContent.includes('Other result');
panel.query='nothing matched';panel.render();await q.frame();result.noMatchesStaysEmpty=taskRows().length===0;
panel.query='';panel.tag='#FilterB';panel.render();const timeline=panel.timeline;let renders=0;const old=timeline.render;timeline.render=function(...args){renders++;return old.apply(this,args);};
try{await q.reset('- [ ] 09:00 - 09:30 Find needle #TSQA #FilterA 📅 2026-10-11');await q.frame();result.deletedLastTagClearsCaption=panel.tag===''&&!panel.filterSummary.textContent.includes('已筛选');result.deletedTagOnlyOneTimelineRender=renders===1;}finally{timeline.render=old;}
panel.query='TSQA';panel.tag='';panel.render();await q.frame();return JSON.stringify(result);
""")
    record('nested native recurrence', """
const result={};for(const indent of ['    ',String.fromCharCode(9)]){
 const source='- Parent list'+q.NL+indent+'- [ ] Nested repeat #TSQA 🔁 every day 📅 2026-10-11 ^nested-repeat';await q.reset(source);
 let complete=true;try{await q.p.taskPlanner.update(q.rows()[0],{checked:true});}catch{complete=false;}
 const prefix=indent==='    '?'spaces':'tab';result[prefix+'Completes']=complete&&q.rows().length===2&&q.rows().some(t=>!t.checked&&t.due==='2026-10-12');
 result[prefix+'PreservesIndent']=complete&&(await q.text()).split(q.NL).slice(1).every(line=>line.startsWith(indent+'- ['));
 if(complete){await q.p.taskPlanner.undoLast();result[prefix+'UndoExact']=(await q.text())===source;}
}
return JSON.stringify(result);
""")
    record('quadrant scroll continuity', """
await q.reset(Array.from({length:24},(_,i)=>`- [ ] Scroll ${i} #TSQA 📅 2026-10-11`).join(q.NL));const panel=q.panel();panel.query='TSQA';panel.tag='';panel.setFilter('unfinished');panel.quadrantLimits.q3=40;
q.calendar.contentEl.querySelector('[aria-label="四象限模式"]').click();await q.frame();const column=panel.el.querySelector('[data-quadrant="q3"]');column.scrollTop=100;const before=column.scrollTop;
await q.p.taskPlanner.update(q.rows()[0],{priority:1});await q.frame();const after=panel.el.querySelector('[data-quadrant="q3"]').scrollTop;
return JSON.stringify({columnScrollPreserved:before>0&&Math.abs(after-before)<2,metrics:{quadrantScrollBefore:before,quadrantScrollAfter:after}});
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
    record('native timeline task drag', """
const source=['- [ ] 09:00 - 09:30 拖动任务 #TSQA 🔁 every day 📅 2026-10-11 ^drag-native','- [ ] 14:00 - 15:00 目标时间 #TSQA 📅 2026-10-11 ^drag-target'].join(q.NL);
await q.reset(source);q.calendar.contentEl.querySelector('[aria-label="时间线模式"]').click();q.panel().query='TSQA';q.panel().setFilter('today');await q.frame();
const find=text=>[...q.calendar.contentEl.querySelectorAll('.ts-timeline-item')].find(row=>row.textContent.includes(text));
const begin=row=>{const transfer=new DataTransfer();row.dispatchEvent(new DragEvent('dragstart',{dataTransfer:transfer,bubbles:true,cancelable:true}));return transfer;};
const dragged=find('拖动任务'),target=find('目标时间'),transfer=begin(dragged),result={timelineCardDraggable:dragged.draggable,opaquePayload:transfer.types.includes('application/x-thoughtspace-calendar-task')&&!transfer.getData('text/plain')};
target.dispatchEvent(new DragEvent('dragover',{dataTransfer:transfer,bubbles:true,cancelable:true}));result.dropShowsTargetTime=target.querySelector('.ts-timeline-drop-preview')?.textContent.includes('14:00')===true;
target.dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));await q.wait(()=>q.rows()[0].text.startsWith('14:00 - 14:30'));await q.p.taskPlanner.writes;dragged.dispatchEvent(new DragEvent('dragend',{bubbles:true}));
let saved=await q.text();result.localDropKeepsDurationRuleAndReference=saved.startsWith('- [ ] 14:00 - 14:30')&&saved.includes('🔁 every day')&&saved.includes('^drag-native');
await q.p.taskPlanner.undoLast();result.dragUndoExact=(await q.text())===source;
await q.reset(source);await q.p.openLargeCalendar('2026-10-12');q.large=app.workspace.getLeavesOfType('thoughtspace-large-calendar')[0].view;await q.large.setState({mode:'week',day:'2026-10-12',anchor:'2026-10-12'});await q.large.refresh();
await q.frame();const from=find('拖动任务'),across=begin(from),column=q.large.contentEl.querySelector('.tsc-week-column[data-date="2026-10-12"]'),rect=column.getBoundingClientRect(),point={dataTransfer:across,bubbles:true,cancelable:true,clientX:rect.left+rect.width/2,clientY:rect.top+600/1440*rect.height};
column.dispatchEvent(new DragEvent('dragover',point));column.dispatchEvent(new DragEvent('drop',point));await q.wait(()=>q.rows()[0].text.startsWith('10:00 - 10:30')&&q.rows()[0].scheduled==='2026-10-12');await q.p.taskPlanner.writes;from.dispatchEvent(new DragEvent('dragend',{bubbles:true}));
saved=await q.text();result.timelineToWeekSchedulesDateAndTime=saved.includes('10:00 - 10:30')&&saved.includes('⏳ 2026-10-12')&&saved.includes('📅 2026-10-11')&&saved.includes('🔁 every day')&&saved.includes('^drag-native');
await q.p.taskPlanner.undoLast();result.crossViewUndoExact=(await q.text())===source;
return JSON.stringify(result);
""")
    record('timeline drop coalesces native refreshes', """
const source=['- [ ] 09:00 - 09:30 连续拖动 #TSQA 🔁 every day 📅 2026-10-11 ^smooth-drop','- [ ] 14:00 - 15:00 接收位置 #TSQA 📅 2026-10-11'].join(q.NL);await q.reset(source);
q.calendar.contentEl.querySelector('[aria-label="时间线模式"]').click();q.panel().query='TSQA';q.panel().setFilter('today');await q.frame();
const timeline=q.panel().timeline,originalRender=timeline.renderContents,originalUpdate=q.p.taskPlanner.update;let paints=0,writes=0;const result={};
timeline.renderContents=function(){paints++;return originalRender.call(this);};
q.p.taskPlanner.update=function(task,change){if(task.path!==q.file.path)return originalUpdate.call(this,task,change);writes++;return new Promise((resolve,reject)=>setTimeout(()=>Promise.resolve(originalUpdate.call(this,task,change)).then(resolve,reject),80));};
try {
 const rows=[...timeline.body.querySelectorAll('.ts-timeline-item')],dragged=rows.find(row=>row.textContent.includes('连续拖动')),target=rows.find(row=>row.textContent.includes('接收位置')),transfer=new DataTransfer();
 dragged.dispatchEvent(new DragEvent('dragstart',{dataTransfer:transfer,bubbles:true,cancelable:true}));timeline.render();
 const event=()=>new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true});target.dispatchEvent(event());target.dispatchEvent(event());
 timeline.render();timeline.render();result.pendingKeepsOriginalRows=paints===0&&dragged.isConnected&&target.isConnected;
 dragged.dispatchEvent(new DragEvent('dragend',{bubbles:true}));await q.wait(()=>!timeline.dropSaving);await q.p.taskPlanner.writes;await q.frame();
 result.singlePaintAfterSave=paints===1;result.duplicateDropWritesOnce=writes===1;result.timelineIdentityPreserved=q.panel().timeline===timeline;
 const text=await q.text();result.savedRangePreservesMetadata=text.startsWith('- [ ] 14:00 - 14:30 连续拖动')&&text.includes('🔁 every day')&&text.includes('^smooth-drop');
 result.nextGestureAvailable=!timeline.dragging&&!timeline.dropSaving&&timeline.body.querySelector('.ts-timeline-item').draggable;
 result.metrics={timelineDropPaints:paints,timelineDropWrites:writes};
 await q.p.taskPlanner.undoLast();result.coalescedDropUndoExact=(await q.text())===source;
}finally{timeline.renderContents=originalRender;q.p.taskPlanner.update=originalUpdate;}
return JSON.stringify(result);
""")
    record('drag range picker native task editor', """
await q.reset('- [ ] 09:00 - 09:30 拖动选时 #TSQA 🔁 every day 📅 2026-10-11 ^range-native');
q.calendar.contentEl.querySelector('[aria-label="时间线模式"]').click();q.panel().query='TSQA';q.panel().setFilter('today');await q.frame();
q.calendar.contentEl.querySelector('.ts-timeline-time.is-editable').click();
const modal=document.querySelector('.ts-task-schedule-modal'),track=modal.querySelector('.ts-time-range-track'),start=modal.querySelector('[aria-label="开始时间"]'),end=modal.querySelector('[aria-label="结束时间（可选）"]');
const gesture=(from,to,cancel='',element=track)=>{const rect=track.getBoundingClientRect(),point=minute=>({pointerId:177,isPrimary:true,button:0,clientX:rect.left+minute/1440*rect.width,clientY:rect.top+rect.height/2,bubbles:true,cancelable:true});element.dispatchEvent(new PointerEvent('pointerdown',point(from)));window.dispatchEvent(new PointerEvent('pointermove',point(to)));if(cancel==='Escape')track.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));else window.dispatchEvent(new PointerEvent(cancel||'pointerup',point(to)));};
const result={};gesture(600,690);result.dragSelectsStartEnd=start.value==='10:00'&&end.value==='11:30';
gesture(750,660);result.reverseSelectsOrderedRange=start.value==='11:00'&&end.value==='12:30';
gesture(750,810,'',track.querySelector('[data-edge=end]'));result.handleExtendsDuration=start.value==='11:00'&&end.value==='13:30';
gesture(900,1005,'Escape');result.escapePreservesInputsAndDialog=start.value==='11:00'&&end.value==='13:30'&&modal.isConnected;
gesture(900,1005,'pointercancel');result.pointerCancelPreservesInputs=start.value==='11:00'&&end.value==='13:30';
track.querySelector('[data-edge=end]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',shiftKey:true,bubbles:true,cancelable:true}));result.keyboardExtendsOneMinute=end.value==='13:31';
start.value='09:07';start.dispatchEvent(new Event('input',{bubbles:true}));end.value='10:23';end.dispatchEvent(new Event('input',{bubbles:true}));result.manualMinuteDoesNotSnap=start.value==='09:07'&&end.value==='10:23';
modal.querySelector('form').requestSubmit();await q.wait(()=>!modal.isConnected);await q.p.taskPlanner.writes;
const saved=await q.text();result.savedRangeKeepsRecurrenceAndReference=saved.startsWith('- [ ] 09:07 - 10:23 拖动选时')&&saved.includes('🔁 every day')&&saved.endsWith('^range-native');
await q.p.taskPlanner.undoLast();result.rangeEditUndoRestoresOriginal=(await q.text()).startsWith('- [ ] 09:00 - 09:30');
await q.frame();q.calendar.contentEl.querySelector('.ts-timeline-time.is-editable').click();const idle=document.querySelector('.ts-task-schedule-modal');idle.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));result.idleEscapeStillClosesDialog=!idle.isConnected;return JSON.stringify(result);
""")
    record('schedule failure recovery and repeated saves', """
const source='- [ ] 09:00 - 09:30 连续排期 #TSQA 🔁 every day 📅 2026-10-11 ^continuous-range';await q.reset(source);
q.calendar.contentEl.querySelector('[aria-label="时间线模式"]').click();q.panel().query='TSQA';q.panel().setFilter('today');await q.frame();
q.calendar.contentEl.querySelector('.ts-timeline-time.is-editable').click();
const modal=document.querySelector('.ts-task-schedule-modal'),form=modal.querySelector('form'),start=modal.querySelector('input[aria-label="开始时间"]'),end=modal.querySelector('input[aria-label="结束时间（可选）"]'),track=modal.querySelector('.ts-time-range-track'),original=q.p.taskPlanner.update;let calls=0,fail=true;const result={};
q.p.taskPlanner.update=function(task,change){if(task.path!==q.file.path)return original.call(this,task,change);calls++;return new Promise((resolve,reject)=>setTimeout(()=>fail?reject(new Error('QA 写入暂时失败')):resolve(original.call(this,task,change)),80));};
try {
 start.value='11:00';start.dispatchEvent(new Event('input',{bubbles:true}));end.value='12:00';end.dispatchEvent(new Event('input',{bubbles:true}));
 form.requestSubmit();form.requestSubmit();result.pendingLocksTimeInputs=start.disabled&&end.disabled;
 const handle=track.querySelector('[data-edge=end]');handle.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));result.pendingKeyboardCannotChangeRange=end.value==='12:00';
 await q.wait(()=>!start.disabled);result.failedSaveShowsError=modal.querySelector('.ts-schedule-error').textContent.includes('QA 写入暂时失败');result.failedSaveKeepsSource=(await q.text())===source;result.doubleSubmitWritesOnce=calls===1;
 fail=false;end.value='13:30';end.dispatchEvent(new Event('input',{bubbles:true}));form.requestSubmit();form.requestSubmit();await q.wait(()=>!modal.isConnected);await q.p.taskPlanner.writes;
 result.retrySavesExactRange=(await q.text()).startsWith('- [ ] 11:00 - 13:30 连续排期');result.retryKeepsRuleAndBlock=(await q.text()).includes('🔁 every day')&&(await q.text()).endsWith('^continuous-range');result.retryHasOneWrite=calls===2;
 await q.p.taskPlanner.undoLast();result.retryUndoExact=(await q.text())===source;
}finally{q.p.taskPlanner.update=original;}
return JSON.stringify(result);
""")
    record('task presentation in native views', """
const source='- [ ] 09:00 - 09:30 清晰的任务正文 #TSQA 🔁 every day 📅 2026-10-11 ^display-test';
await q.reset(source);q.panel().query='TSQA';q.panel().setFilter('today');const result={};
for(const mode of ['列表','四象限','时间线']){
 q.calendar.contentEl.querySelector(`[aria-label="${mode}模式"]`).click();await q.frame();
 const title=q.calendar.contentEl.querySelector(mode==='时间线'?'.ts-timeline-title':'.ts-task-title');
 result[mode+'CleanTitle']=title?.textContent==='清晰的任务正文';
 result[mode+'RecurrenceBadge']=!!q.calendar.contentEl.querySelector('.ts-task-label[title="重复规则：every day"]');
 result[mode+'SourcePreserved']=(await q.text())===source;
}
return JSON.stringify(result);
""")
    if args.visuals:
        previews = native("""
q.allTasks=q.p.taskPlanner.all;q.p.taskPlanner.all=function(){return q.allTasks.call(this).filter(task=>task.path.startsWith(q.folder+'/'));};
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
        sidebar = native("""
// Use a unique journal root: never export or overwrite an existing diary.
q.p.settings.journalFolder=q.folder+'/日记';
try {
 for(const day of ['2026-10-07','2026-10-09',q.day]){
  const file=await q.p.ensureJournalFile(day);
  await app.vault.modify(file,[`# ${day}`,'','## 今日想法','','把新的想法写下来，留一点时间给重要的事。','','## 今日任务','','- [ ] 整理阅读笔记','- [x] 完成今天的散步','','## 阅读与关联','','> 慢下来，才能看清下一步。','','今天阅读了 **设计与日常**，记录三个值得继续探索的问题。'].join(q.NL));
 }
 await q.p.taskPlanner.ready();await q.p.taskPlanner.flush();
 await q.calendar.setState({day:q.day,month:'2026-10',calendarView:'month',taskView:'list'});
 q.panel().query='界面样例';q.panel().setFilter('today');await q.frame();
 const journal=(await q.p.ensureJournal(true)).view;
 await journal.setState({day:q.day,month:'2026-10',mode:'day'});await q.frame();
 const result={calendar:q.calendar.contentEl.outerHTML,day:journal.contentEl.outerHTML};
 await journal.setState({day:q.day,month:'2026-10',mode:'agenda'});await q.frame();
 result.agenda=journal.contentEl.outerHTML;
 await q.calendar.setState({calendarView:'year'});q.panel().query='界面样例';q.panel().setFilter('today');await q.frame();
 result.year=q.calendar.contentEl.outerHTML;
 return JSON.stringify(result);
}finally{q.p.settings.journalFolder=q.journalFolder;}
""")
        (output / 'sidebar-ui-fixtures.json').write_text(json.dumps(sidebar, ensure_ascii=False, indent=2))

    errors_after = command('dev:errors')
    results.append({'name': 'no new native errors', 'passed': errors_after == errors_before})
finally:
    try:
        cleaned = native("""
if(!q)return JSON.stringify(true);
try{
await q.p.taskPlanner.writes;
for(const modal of document.querySelectorAll('.ts-task-schedule-modal,.ts-timeline-modal,.tsc-dialog'))modal.querySelector('.modal-close-button')?.click();
if(q.configExists)await app.vault.adapter.write(q.config,q.configText);else if(await app.vault.adapter.exists(q.config))await app.vault.adapter.remove(q.config);
await q.t.loadSettings();
const f=app.vault.getAbstractFileByPath(q.folder);if(f&&q.folder.startsWith('TS-Tasks-Native-QA-'))await app.vault.delete(f,true);
await q.p.taskPlanner.flush();
return JSON.stringify(!app.vault.getAbstractFileByPath(q.folder));
}finally{if(q.allTasks)q.p.taskPlanner.all=q.allTasks;q.p.settings.journalFolder=q.journalFolder;q.p.taskPlanner.undo=q.undo;q.p.appleCalendar.events=q.appleEvents;if(q.journalLoaded)q.journal.load();delete window[Symbol.for('thoughtspace.native-tasks-qa')];}
""")
        results.append({'name': 'fixtures removed and settings restored', 'passed': cleaned})
    finally:
        # Other installed views can leave changeLayout's completion promise pending.
        # Verify the actual native layout instead of treating the promise as proof.
        layout = json.dumps(snapshot['layout'])
        restored = evaluate('(async()=>{const expected=' + layout + ';let settled=false;Promise.resolve(app.workspace.changeLayout(expected)).then(()=>settled=true,()=>settled=true);const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==="object"?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;for(let i=0;i<100;i++){if(JSON.stringify(canonical(app.workspace.getLayout()))===JSON.stringify(canonical(expected)))return JSON.stringify({restored:true,completionSettled:settled});await new Promise(r=>setTimeout(r,50));}return JSON.stringify({restored:false,completionSettled:settled});})()')
        results.append({'name': 'native workspace restored exactly', 'passed': restored['restored']})
        metrics['layoutCompletionSettled'] = restored['completionSettled']

report = {'checkedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'passed': sum(r['passed'] for r in results),
          'tests': len(results), 'results': results, 'metrics': metrics,
          'scope': 'Installed official Tasks; native vault writes, cache and DOM checkbox actions. Temporary settings restored; unique fixtures deleted; no Apple access.'}
(output / args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2))
print(json.dumps(report, ensure_ascii=False, indent=2))
if report['passed'] != report['tests']:
    raise SystemExit(1)
