"""Bounded native Obsidian workflow QA; never authorizes or writes Apple Calendar.

Run: python3 qa/native-workflow-check.py --vault YOUR_QA_VAULT
Only uniquely named TS-Calendar-Workflow-QA-* files are created. The workspace,
calendar read method, journal-link component and existing task undo are restored.
Workspace snapshots and screenshots remain in the ignored output directory.
"""
from pathlib import Path
import argparse
import json
import subprocess
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--vault', required=True)
args = parser.parse_args()
output = Path(__file__).resolve().parent / 'large-calendar-output'
output.mkdir(exist_ok=True)
prefix = f'TS-Calendar-Workflow-QA-{uuid.uuid4().hex[:12]}'
checks = []
expected_version = json.loads((Path(__file__).resolve().parent.parent / 'manifest.json').read_text())['version']


def command(*parts):
    result = subprocess.run(['obsidian', f'vault={args.vault}', *parts],
                            capture_output=True, text=True, check=True, timeout=60)
    return result.stdout


def evaluate(code):
    value = command('eval', 'code=' + code)
    if '=> ' not in value:
        raise RuntimeError(value)
    return json.loads(value.split('=> ', 1)[1].strip())


def check(name, value):
    if not value:
        raise AssertionError(name)
    checks.append(name)


def record(results):
    for name, value in results.items():
        check(name, value)


def native(code):
    return evaluate("(async()=>{const q=window[Symbol.for('thoughtspace-calendar.native-workflow-qa')];" + code + "})()")


snapshot = evaluate('JSON.stringify({layout:app.workspace.getLayout(),active:app.workspace.activeLeaf?.id})')
(output / 'native-workflow-before.json').write_text(json.dumps(snapshot, ensure_ascii=False, indent=2))
before_errors = command('dev:errors')
initialized = False
try:
    result = evaluate("""(async()=>{
const key=Symbol.for('thoughtspace-calendar.native-workflow-qa');if(window[key])throw Error('Another native QA session is active');
const p=app.plugins.getPlugin('thoughtspace-calendar');if(!p?.ready)throw Error('Calendar plugin is not ready');
if(document.querySelector('.tsc-dialog'))throw Error('Close the existing calendar dialog before running native QA');
const folder=PREFIX;if(app.vault.getAbstractFileByPath(folder))throw Error('Fixture folder already exists');
const q={p,folder,host:p.largeCalendarHost,undo:p.taskPlanner.undo,journal:p.journalLinks,journalLoaded:!!p.journalLinks?._loaded,appleEvents:p.appleCalendar.events,appleSettings:JSON.stringify(p.settings.appleCalendar)};
window[key]=q;
q.journal?.unload();await q.journal?.queue;
// Guard native reads before opening any view. No EventKit read or permission request.
p.appleCalendar.events=async()=>({events:[],truncated:false});
await app.vault.createFolder(folder);
q.original='---\\ntype: workflow-qa\\ncustom: keep-me\\n---\\n\\n# Native workflow fixture\\n\\n- [ ] 09:07 - 10:17 Prepare evidence ⏳ 2026-10-20 📅 2026-10-23 ^native-reference\\n- [ ] Capture inbox ^native-inbox\\n- [ ] Review recurrence 🔁 every week ⏳ 2026-10-20 ^native-repeat\\n\\nUnrelated paragraph stays intact.\\n';
q.file=await app.vault.create(folder+'/tasks.md',q.original);
q.note=await app.vault.create(folder+'/reference.md','---\\ncustom: keep-me\\n---\\n\\n# Reference fixture\\n\\nEvidence body stays intact.\\n');
await p.taskPlanner.ready();
q.wait=async predicate=>{for(let i=0;i<80;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,25));}throw Error('Native fixture did not settle');};
await q.wait(()=>!!app.metadataCache.getFileCache(q.note)?.frontmatter);
q.list=async()=> (await q.host.tasks(new Date(2026,9,1),new Date(2026,10,1))).filter(t=>t.source===q.file.path);
q.event={id:'native-workflow-fixture',calendarId:'native-workflow-calendar',title:'Native linked event',start:new Date(2026,9,21,10,0).toISOString(),end:new Date(2026,9,21,11,0).toISOString(),allDay:false,location:'Fixture only',notes:'Native QA fixture',revision:'a'.repeat(64),recurring:true,editable:true,color:'#54867a'};
return JSON.stringify({ready:p.ready,version:p.manifest.version,tasksPresent:!!app.plugins.getPlugin('obsidian-tasks-plugin'),count:(await q.list()).length});
})()""".replace('PREFIX', json.dumps(prefix)))
    tasks_present = result['tasksPresent']
    initialized = True
    check(f'native calendar {expected_version} ready', result['ready'] and result['version'] == expected_version)
    check('fixture tasks indexed from native vault', result['count'] == 3)
    record(native("""
const tasks=await q.list(),task=tasks.find(t=>t.dateRole==='scheduled'&&t.text.includes('Prepare evidence'));
await q.host.scheduleTask(task,'2026-10-21',493,581);const scheduled=await app.vault.read(q.file);
const result={exactMinutes:scheduled.includes('08:13 - 09:41'),deadlinePreserved:scheduled.includes('📅 2026-10-23'),blockIdPreserved:/\\^native-reference$/m.test(scheduled),otherContentPreserved:scheduled.includes('Unrelated paragraph stays intact.')&&scheduled.includes('custom: keep-me')};
await q.p.taskPlanner.undoLast();result.scheduleUndoExact=(await app.vault.read(q.file))===q.original;
const fresh=(await q.list()).find(t=>t.dateRole==='scheduled'&&t.text.includes('Prepare evidence'));
await q.host.toggleTask(fresh);let done=await app.vault.read(q.file);result.completionWritesMarkdown=/^- \\[x\\].*Prepare evidence.*✅ \\d{4}-\\d{2}-\\d{2}.*\\^native-reference$/m.test(done);
await q.p.taskPlanner.undoLast();result.completionUndoExact=(await app.vault.read(q.file))===q.original;
const stale=(await q.list()).find(t=>t.dateRole==='scheduled'&&t.text.includes('Prepare evidence'));
const externallyChanged=q.original.replace('Prepare evidence','Externally changed evidence');await app.vault.modify(q.file,externallyChanged);await q.p.taskPlanner.flush();
try{await q.host.scheduleTask(stale,'2026-10-21',500,600);result.staleRejected=false;}catch(e){result.staleRejected=/原文已变化/.test(String(e));}
result.staleLeavesExternalText=(await app.vault.read(q.file))===externallyChanged;
await app.vault.modify(q.file,q.original);await q.p.taskPlanner.flush();
const recurring=(await q.list()).find(t=>t.text.includes('Review recurrence'));
result.recurringFallback=app.plugins.getPlugin('obsidian-tasks-plugin')?q.host.canToggleTask(recurring):!q.host.canToggleTask(recurring);
if(!app.plugins.getPlugin('obsidian-tasks-plugin')){try{await q.host.toggleTask(recurring);result.repeatNoApiRejected=false;}catch(e){result.repeatNoApiRejected=/Tasks/.test(String(e));}result.repeatNoApiUnchanged=(await app.vault.read(q.file))===q.original;}
const inbox=(await q.host.unscheduledTasks()).find(t=>t.source===q.file.path);result.inboxOnlyUnscheduled=!!inbox&&inbox.text==='Capture inbox'&&inbox.date==='';
return JSON.stringify(result);
"""))
    record(native("""
const original=q.original,dv='- [ ] Review Dataview [repeat:: every day] [scheduled:: 2026-10-20] [due:: 2026-10-23] [priority:: high] ^native-dataview';
try{
await app.vault.modify(q.file,dv);await q.p.taskPlanner.flush();
const rows=await q.list(),task=rows.find(t=>t.dateRole==='scheduled');
const result={nativeDataviewDate:!!task&&task.date==='2026-10-20'};
const planned=q.p.taskPlanner.all().find(t=>t.path===q.file.path);
result.nativeDataviewRecurring=!!planned?.recurring;result.nativeDataviewPriority=planned?.priority===1;
if(!app.plugins.getPlugin('obsidian-tasks-plugin')){
result.nativeDataviewNoApiDisabled=!q.host.canToggleTask(task);
try{await q.host.toggleTask(task);result.nativeDataviewNoApiRejected=false;}catch(e){result.nativeDataviewNoApiRejected=/Tasks/.test(String(e));}
result.nativeDataviewNoApiUnchanged=(await app.vault.read(q.file))===dv;
}
await q.host.scheduleTask(task,'2026-10-21',493,581);const changed=await app.vault.read(q.file);
result.nativeDataviewScheduleFormat=changed.includes('[scheduled:: 2026-10-21]')&&!changed.includes('⏳');
result.nativeDataviewMetadataPreserved=changed.includes('[due:: 2026-10-23]')&&changed.includes('[repeat:: every day]')&&changed.endsWith('^native-dataview');
await q.p.taskPlanner.undoLast();result.nativeDataviewUndoExact=(await app.vault.read(q.file))===dv;
return JSON.stringify(result);
}finally{await app.vault.modify(q.file,original);await q.p.taskPlanner.flush();}
"""))
    record(native("""
await q.p.eventNoteLinks.link(q.event,q.note);await q.p.eventNoteLinks.link(q.event,q.note);
await q.wait(()=>Array.isArray(app.metadataCache.getFileCache(q.note)?.frontmatter?.['thoughtspace-calendar-events']));
const fm=app.metadataCache.getFileCache(q.note).frontmatter;
const result={nativePropertyLink:fm['thoughtspace-calendar-events'].length===1&&q.host.eventNotes(q.event).length===1,nativePropertyPreservesForeign:fm.custom==='keep-me',noteBodyPreserved:(await app.vault.read(q.note)).includes('Evidence body stays intact.')};
await app.fileManager.renameFile(q.note,q.folder+'/renamed-reference.md');result.nativeRenameKeepsLink=q.host.eventNotes(q.event)[0]?.path===q.note.path;
q.moved={...q.event,start:new Date(2026,9,22,10,0).toISOString(),end:new Date(2026,9,22,11,0).toISOString()};
await q.host.eventMoved(q.event,q.moved);result.nativeOccurrenceRekey=q.host.eventNotes(q.event).length===0&&q.host.eventNotes(q.moved).length===1;
await q.host.eventMoved(q.moved,q.event);await q.host.openEventNote(q.event);result.openLinkedNoteReusesNativeFile=app.workspace.activeLeaf?.view?.file===q.note;
return JSON.stringify(result);
"""))
    record(native("""
const task=(await q.list()).find(t=>t.dateRole==='scheduled'&&t.text.includes('Prepare evidence'));await q.host.scheduleTask(task,'2026-10-21',493,581);
await q.p.openLargeCalendar('2026-10-21');const leaves=app.workspace.getLeavesOfType('thoughtspace-large-calendar'),v=leaves[0].view;q.view=v;q.viewHost=v.host;
v.host={...q.host,apple:{events:async()=>({events:[q.event],truncated:false}),detail:async()=>{throw Error('Native QA blocks Apple detail');},save:async()=>{throw Error('Native QA blocks Apple writes');}},tasks:async(start,end)=>(await q.host.tasks(start,end)).filter(t=>t.source===q.file.path),unscheduledTasks:async()=>(await q.host.unscheduledTasks()).filter(t=>t.source===q.file.path)};
await v.setState({mode:'week',day:'2026-10-21',anchor:'2026-10-21'});await v.refresh();
const timeline=v.contentEl.querySelector('.tsc-linked-timeline'),items=[...timeline.querySelectorAll('.tsc-agenda-entry')];
const result={nativeWeekSevenColumns:v.contentEl.querySelectorAll('.tsc-week-column').length===7,nativeMergedTimeline:items.length===2&&items[0].textContent.includes('Prepare evidence')&&items[1].textContent.includes('Native linked event'),nativeLinkedNoteAction:!!v.contentEl.querySelector('.tsc-note-link')};
const backlog=v.contentEl.querySelector('.tsc-backlog');backlog.open=true;backlog.querySelector('[aria-label="安排任务时间"]').click();
const form=document.querySelector('.tsc-event-form');result.nativeScheduleForm=!!form&&form.querySelector('input[type=date]').value==='2026-10-21';
form.querySelector('input[type=date]').value='2026-10-21';const times=form.querySelectorAll('input[type=time]');times[0].value='11:13';times[1].value='12:31';form.requestSubmit();
await q.wait(()=>!form.isConnected);await q.p.taskPlanner.flush();result.nativeModalWritesExactMinutes=(await app.vault.read(q.file)).includes('11:13 - 12:31 Capture inbox ⏳ 2026-10-21 ^native-inbox');
await v.refresh();const main=v.contentEl.querySelector('.tsc-large-main');main.scrollTop=400;await v.refresh();result.nativeRefreshKeepsScroll=main.scrollTop===400;
const oldWidth=v.contentEl.style.width;v.contentEl.style.width='620px';await new Promise(requestAnimationFrame);result.nativeNarrowStack=getComputedStyle(v.contentEl.querySelector('.tsc-large-body')).display==='block';v.contentEl.style.width=oldWidth;
return JSON.stringify(result);
"""))
    # Let pending metadata events settle; sample within one eval so CLI focus changes
    # cannot masquerade as a plugin refresh loop.
    refresh_count = native('await new Promise(r=>setTimeout(r,600));const before=q.view.revision;await new Promise(r=>setTimeout(r,1200));return JSON.stringify(q.view.revision-before);')
    check('native view has no self-triggering refresh loop', refresh_count <= 1)
    after_errors = command('dev:errors')
    check('no new captured native JavaScript errors', after_errors == before_errors)
    (output / 'native-workflow-errors.txt').write_text(after_errors)
    record(native('return JSON.stringify({applePreferencesUnchanged:JSON.stringify(q.p.settings.appleCalendar)===q.appleSettings});'))
finally:
    # Attempt cleanup even if fixture creation or a native assertion failed.
    try:
        result = native("""
if(!q)return JSON.stringify({cleaned:true});
document.querySelectorAll('.tsc-dialog').forEach(m=>m.parentElement.querySelector('.modal-bg')?.click());
if(q.view&&q.viewHost)q.view.host=q.viewHost;
try{
await q.p.taskPlanner.writes;
const fixture=app.vault.getAbstractFileByPath(q.folder);if(fixture&&/^TS-Calendar-Workflow-QA-[a-f0-9]+$/.test(q.folder))await app.vault.delete(fixture,true);
await q.p.taskPlanner.flush();
}finally{
q.p.taskPlanner.undo=q.undo;q.p.appleCalendar.events=q.appleEvents;
try{if(q.journalLoaded)q.journal.load();}finally{delete window[Symbol.for('thoughtspace-calendar.native-workflow-qa')];}
}
const clean=!app.vault.getAbstractFileByPath(q.folder);
return JSON.stringify({cleaned:clean});
""")
        if initialized:
            check('native fixture files cleaned', result['cleaned'])
    finally:
        evaluate('(async()=>{await app.workspace.changeLayout(' + json.dumps(snapshot['layout']) + ');return JSON.stringify(true);})()')

report = {'passed': len(checks), 'checks': checks,
          'scope': 'Native vault, metadata and DOM. Apple events are synthetic; no permission request or real calendar read/write.',
          'tasksPlugin': ('Tasks was installed; its recurrence actions are checked with qa/native-tasks-check.py.' if tasks_present else 'Tasks was absent; unavailable-API guards were verified.'),
          'cleanup': 'Unique fixtures deleted, native workspace restored, prior undo and journal-link component restored.'}
(output / 'native-workflow-verify.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
print(json.dumps(report, ensure_ascii=False, indent=2))
