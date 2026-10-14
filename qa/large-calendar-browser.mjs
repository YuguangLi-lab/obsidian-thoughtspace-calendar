import {build} from 'esbuild';
import {createRequire} from 'node:module';
const qaRequire=createRequire(path.resolve(process.env.QA_DEPENDENCIES||'.','package.json'));
const {chromium}=qaRequire('@playwright/test');
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
mkdirSync('qa/large-calendar-output',{recursive:true});
await build({entryPoints:['qa/large-calendar-preview.ts'],bundle:true,format:'esm',outfile:'qa/large-calendar-output/preview.js',alias:{obsidian:path.resolve('qa/large-calendar-obsidian-stub.ts')},platform:'browser'});
// Gesture previews use the current source CSS as well as the generated plugin sheet.
const css=readFileSync('styles.css','utf8')+'\n'+readFileSync('src/large-calendar.css','utf8');
const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
:root {--font-interface:system-ui;--interactive-accent:#467c83;--background-modifier-border:#dde4e6;--background-modifier-hover:#eaf0f2;--background-primary:#fff;--background-secondary:#f7f9fa;--text-normal:#243238;--text-muted:#718187;--text-faint:#98a4a8;--text-on-accent:#fff;--text-error:#be4343;}
*{box-sizing:border-box}body{margin:0}#root{height:100vh}button,input,select,textarea{font:inherit;font-size:13px;border:1px solid #d7dfe2;border-radius:6px;background:#fff;color:inherit;padding:7px}button{display:inline-flex;align-items:center;justify-content:center}input,select{height:34px}.mod-cta{color:white;background:#467c83;border-color:#467c83}.modal{position:fixed;z-index:30;width:500px;top:50%;left:50%;transform:translate(-50%,-50%);padding:24px;border:1px solid #d7dfe2;border-radius:14px;background:white;box-shadow:0 12px 80px #0003;max-height:95vh;overflow:auto}.modal h2{font-size:20px;margin:0 0 20px}button:focus-visible{outline:2px solid #467c83;outline-offset:2px}
${css}</style></head><body><div id="root"></div><script type="module" src="/preview.js"></script></body></html>`;
writeFileSync('qa/large-calendar-output/index.html',html);
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/preview.js'?'application/javascript':'text/html');res.end(req.url==='/preview.js'?readFileSync('qa/large-calendar-output/preview.js'):html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;
const browser=await chromium.launch({...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{}),headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900},timezoneId:'Asia/Shanghai'});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
const checks=[];
const state=()=>page.evaluate(()=>window.qaFixture.state());
const savedTask=(id)=>page.locator(`.tsc-agenda-task-entry[data-task-id="${id}"]`);
async function waitRequest(action,count){await page.waitForFunction(({action,count})=>window.requests.filter(request=>request.action===action).length>count,{action,count});await page.locator('#root.is-saving').waitFor({state:'detached'});}
async function dragToMinute(source,column,minute){
 await source.scrollIntoViewIfNeeded();
 const rect=await column.boundingBox();assert(rect);
 await source.dragTo(column,{targetPosition:{x:rect.width/2,y:rect.height*minute/1440}});
}
async function resizeToMinute(handle,column,minute,cancel=false){
 await handle.scrollIntoViewIfNeeded();const grip=await handle.boundingBox(),rect=await column.boundingBox();assert(grip&&rect);
 await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();
 await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height*minute/1440,{steps:8});
 if(cancel)await page.keyboard.press('Escape');await page.mouse.up();
}
async function startRange(day,from,to){
 const column=page.locator(`.tsc-week-column[data-date="${day}"]`);
 await column.evaluate((el,minute)=>{const main=el.closest('.tsc-large-main'),rect=el.getBoundingClientRect();main.scrollTop+=rect.top+rect.height*minute/1440-main.getBoundingClientRect().top-100;},Math.min(from,to));
 const rect=await column.boundingBox();assert(rect);
 const point=minute=>({x:rect.x+rect.width*.75,y:rect.y+rect.height*minute/1440});
 const start=point(from);await page.mouse.move(start.x,start.y);await page.mouse.down();
 const finish=point(to);await page.mouse.move(finish.x,finish.y,{steps:8});return {column,finish};
}
async function rangeInputs(start,end){
 await page.locator('.tsc-event-form').waitFor();
 assert.equal(await page.locator('input[type=datetime-local]').first().inputValue(),start);
 assert.equal(await page.locator('input[type=datetime-local]').last().inputValue(),end);
}
try {
 await page.goto(`http://127.0.0.1:${port}`);await page.locator('.tsc-month-day').first().waitFor();
 await page.evaluate(()=>{return window.view.showDay(new Date(2026,9,1));});
 assert.equal(await page.locator('.tsc-month-day').count(),42);checks.push('month 42 cells');

 const busyDay=page.locator('.tsc-month-day[data-date="2026-10-01"]');
 assert((await busyDay.locator('.tsc-event-chip').count())<=3);
 assert(await busyDay.evaluate(cell=>[...cell.children].every(child=>child.getBoundingClientRect().bottom<=cell.getBoundingClientRect().bottom+1)));
 checks.push('busy month date keeps combined previews and counters inside its own cell');
 await busyDay.locator('.tsc-cell-more').click();
 assert((await page.locator('.tsc-day-agenda .tsc-agenda-entry').count())>=4);
 checks.push('condensed month previews still open the complete selected-day agenda');
 await page.screenshot({path:'qa/large-calendar-output/month.png'});
 await page.getByRole('button',{name:'产品讨论 · 日历联动',exact:false}).last().click();
 await page.locator('form').waitFor();assert.equal(await page.locator('textarea').inputValue(),'完整备注\n保留原始内容。');checks.push('edit loads complete notes');
 await page.locator('input[type=text]').first().fill('讨论结果');await page.getByRole('button',{name:'保存修改',exact:true}).click();await page.locator('form').waitFor({state:'detached'});checks.push('edit and refresh');
 const save=await page.evaluate(()=>window.requests.filter(r=>r.action==='save').at(-1));assert.equal(save.draft.originalStart,'2026-10-01T02:00:00.000Z');assert.equal(save.draft.revision,'a'.repeat(64));checks.push('update preserves original occurrence');
 await page.getByRole('button',{name:'周',exact:true}).click();await page.locator('.tsc-week-column').first().waitFor();assert.equal(await page.locator('.tsc-week-column').count(),7);checks.push('week 7 columns');
 await page.evaluate(()=>{document.querySelector('.tsc-large-main').scrollTop=480;return window.view.refresh(true);});assert.equal(await page.evaluate(()=>document.querySelector('.tsc-large-main').scrollTop),480);checks.push('refresh preserves week scroll position');
 await page.locator('.tsc-week-event.tsc-task-chip').click();assert.equal(await page.evaluate(()=>window.openedTask),'QA.md:0');checks.push('scheduled local task opens original source');
 await page.locator('.tsc-week-column').first().click({position:{x:10,y:2}});await page.locator('form').waitFor();assert.equal((await page.locator('input[type=datetime-local]').first().inputValue()).endsWith('T00:00'),true);checks.push('midnight cell preserves midnight time');await page.getByRole('button',{name:'取消',exact:true}).click();
 await page.screenshot({path:'qa/large-calendar-output/week.png'});
 await page.getByRole('button',{name:'新日程',exact:true}).click();await page.locator('form').waitFor();
 await page.locator('input[type=text]').first().fill('全天计划');await page.getByText('全天',{exact:true}).last().click();
 await page.locator('input[type=date]').first().fill('2026-10-02');await page.locator('input[type=date]').last().fill('2026-10-02');await page.getByRole('button',{name:'创建日程',exact:true}).click();await page.locator('form').waitFor({state:'detached'});
 const allDay=await page.evaluate(()=>window.requests.filter(r=>r.action==='save').at(-1));assert.equal(allDay.draft.start,'2026-10-01T16:00:00.000Z');assert.equal(allDay.draft.end,'2026-10-02T16:00:00.000Z');checks.push('all-day inclusive end converted to exclusive');
 await page.getByRole('button',{name:'月',exact:true}).click();await page.locator('.tsc-month-day').first().waitFor();
 await page.getByRole('button',{name:'国庆 · 放松一下',exact:false}).last().click();await page.locator('form').waitFor();assert.equal(await page.locator('form input:disabled').count(),5);assert.equal(await page.getByRole('button',{name:'保存修改',exact:true}).count(),0);checks.push('read-only event cannot save');await page.getByRole('button',{name:'关闭',exact:true}).click();
 await page.evaluate(()=>window.setFailSave(true));await page.getByRole('button',{name:'讨论结果',exact:false}).last().click();await page.locator('form').waitFor();await page.getByRole('button',{name:'保存修改',exact:true}).click();await page.getByRole('alert').filter({hasText:'日程已在苹果日历中更新'}).waitFor();assert.equal(await page.locator('form').count(),1);assert.equal(await page.getByRole('button',{name:'保存修改',exact:true}).isEnabled(),true);checks.push('conflict preserves editor content');await page.getByRole('button',{name:'取消',exact:true}).click();
 await page.evaluate(()=>{document.querySelector('#root').style.width='640px';});assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.tsc-large-body')).display),'block');checks.push('narrow split uses container layout inside wide window');
 await page.evaluate(()=>document.querySelector('#root').style.width='');await page.setViewportSize({width:640,height:900});await page.screenshot({path:'qa/large-calendar-output/narrow.png'});assert.equal(await page.evaluate(()=>document.body.scrollWidth<=innerWidth),true);checks.push('narrow month no horizontal overflow');
 assert.equal(await page.evaluate(()=>document.querySelector('.tsc-month-grid').getBoundingClientRect().bottom<=document.querySelector('.tsc-day-agenda').getBoundingClientRect().top+1),true);checks.push('all six weeks remain above the narrow agenda');
 // A fresh fixture keeps the gesture suite independent of prior event edits.
 await page.setViewportSize({width:1440,height:900});await page.goto(`http://127.0.0.1:${port}`);await page.locator('.tsc-month-day').first().waitFor();
 await page.evaluate(()=>window.view.showDay(new Date(2026,9,1)));
 const timelineTitles=await page.locator('.tsc-linked-timeline .tsc-agenda-entry').evaluateAll(items=>items.map(item=>item.textContent));
 assert(timelineTitles[0].includes('测试双向联动'));assert(timelineTitles[1].includes('产品讨论'));checks.push('unified timeline interleaves tasks and Apple events chronologically');
 assert.equal(await page.locator('.tsc-agenda-more:visible').count(),0);checks.push('fully rendered sections hide the zero-count show-more button');
 await page.locator('.tsc-backlog summary').click();
 await page.getByRole('button',{name:'刷新日程和任务',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.tsc-backlog')?.open===true);checks.push('refresh retains expanded unscheduled task tray');
 let before=(await state()).requests.filter(r=>r.action==='task-schedule').length;
 await savedTask('收件箱.md:0').locator('.tsc-task-title').dragTo(page.locator('.tsc-month-day[data-date="2026-10-02"]'));
 await waitRequest('task-schedule',before);assert.match((await state()).taskMarkdown['收件箱.md'],/⏳ 2026-10-02.*\^inbox/);checks.push('dragging an unscheduled task onto a month date updates the source safely');
 await page.getByRole('button',{name:'周',exact:true}).click();await page.locator('.tsc-week-column').first().waitFor();
 before=(await state()).requests.filter(r=>r.action==='task-schedule').length;
 await dragToMinute(savedTask('收件箱.md:0').locator('.tsc-task-title'),page.locator('.tsc-week-column[data-date="2026-10-02"]'),600);
 await waitRequest('task-schedule',before);assert.match((await state()).taskMarkdown['收件箱.md'],/10:00 - 10:30 整理资料/);checks.push('dragging an agenda task into the week grid schedules a 30-minute block');
 await savedTask('收件箱.md:0').getByRole('button',{name:'安排任务时间',exact:true}).click();await page.locator('form').waitFor();
 await page.getByLabel('开始时间（可选）',{exact:true}).fill('09:07');await page.getByLabel('结束时间（可选）',{exact:true}).fill('09:52');
 await page.getByRole('button',{name:'保存安排',exact:true}).click();await page.locator('form').waitFor({state:'detached'});
 assert.match((await state()).taskMarkdown['收件箱.md'],/09:07 - 09:52/);checks.push('keyboard scheduling preserves exact 09:07 time rather than snapping it');
 await savedTask('收件箱.md:0').getByRole('button',{name:'安排任务时间',exact:true}).click();
 await page.getByLabel('开始时间（可选）',{exact:true}).fill('');await page.getByLabel('结束时间（可选）',{exact:true}).fill('');
 await page.getByRole('button',{name:'保存安排',exact:true}).click();await page.locator('form').waitFor({state:'detached'});
 assert.doesNotMatch((await state()).taskMarkdown['收件箱.md'],/09:07/);assert.match((await state()).taskMarkdown['收件箱.md'],/⏳ 2026-10-02.*\^inbox/);checks.push('clearing modal time keeps scheduled date and block reference');
 await savedTask('收件箱.md:0').getByRole('button',{name:'安排任务时间',exact:true}).click();
 await page.getByLabel('开始时间（可选）',{exact:true}).fill('09:07');await page.getByLabel('结束时间（可选）',{exact:true}).fill('09:52');
 await page.getByRole('button',{name:'保存安排',exact:true}).click();await page.locator('form').waitFor({state:'detached'});
 const taskColumn=page.locator('.tsc-week-column[data-date="2026-10-02"]');
 before=(await state()).requests.filter(r=>r.action==='task-schedule').length;
 await resizeToMinute(taskColumn.locator('.tsc-task-chip .tsc-resize-handle'),taskColumn,645);
 await waitRequest('task-schedule',before);assert.match((await state()).taskMarkdown['收件箱.md'],/09:07 - 10:45/);checks.push('task resize saves the new end while retaining its exact start and block ID');
 const unchanged=(await state()).taskMarkdown['收件箱.md'];before=(await state()).requests.filter(r=>r.action==='task-schedule').length;
 await resizeToMinute(taskColumn.locator('.tsc-task-chip .tsc-resize-handle'),taskColumn,675,true);
 assert.equal((await state()).requests.filter(r=>r.action==='task-schedule').length,before);assert.equal((await state()).taskMarkdown['收件箱.md'],unchanged);checks.push('Escape cancels a live resize without persisting a change');
 await page.evaluate(()=>window.qaFixture.setFailSchedule(true));
 before=(await state()).requests.filter(r=>r.action==='task-schedule').length;
 await dragToMinute(savedTask('收件箱.md:0').locator('.tsc-task-title'),page.locator('.tsc-week-column[data-date="2026-10-03"]'),660);
 await page.locator('.tsc-large-status').filter({hasText:'任务原文已变化'}).waitFor();
 assert.equal((await state()).taskMarkdown['收件箱.md'],unchanged);checks.push('failed task drop restores the rendered task and preserves source content');
 await page.evaluate(()=>window.qaFixture.setFailSchedule(false));
 // Select October 1 through the visible week heading, then exercise event-note actions.
 await page.locator('.tsc-week-heading[data-date="2026-10-01"]').click();
 const meeting=page.locator('.tsc-agenda-entry[data-event-id="meeting"]');
 await meeting.getByRole('button',{name:'新建关联笔记',exact:true}).click();await meeting.getByRole('button',{name:'产品会议记录',exact:true}).waitFor();
 await meeting.getByRole('button',{name:'关联已有笔记',exact:true}).click();await meeting.getByRole('button',{name:'既有讨论笔记',exact:true}).waitFor();
 assert.equal((await state()).requests.filter(r=>r.action==='note-open').length,1);assert.equal((await state()).requests.filter(r=>r.action==='note-link').length,1);checks.push('event cards expose create/open and link-existing note actions');
 before=(await state()).requests.filter(r=>r.action==='save').length;
 await dragToMinute(meeting.locator('.tsc-agenda-event'),page.locator('.tsc-week-column[data-date="2026-10-03"]'),660);
 await waitRequest('save',before);
 const eventMove=(await state()).requests.filter(r=>r.action==='save').at(-1).draft;
 assert.equal(eventMove.start,'2026-10-03T03:00:00.000Z');assert.equal(eventMove.originalStart,'2026-10-01T02:00:00.000Z');assert.equal(eventMove.revision,'a'.repeat(64));assert.equal(eventMove.notes,'完整备注\n保留原始内容。');
 await page.locator('.tsc-agenda-entry[data-event-id="meeting"]').getByRole('button',{name:'既有讨论笔记',exact:true}).waitFor();checks.push('event drop preserves complete notes and revision and migrates occurrence-note link');
 await page.evaluate(()=>document.querySelector('.tsc-large-main').scrollTop=0);
 const nextDay=page.locator('.tsc-week-column[data-date="2026-10-02"]'),overnight=nextDay.locator('.tsc-week-event').filter({hasText:'跨午夜交接'});
 assert.equal(await overnight.evaluate(el=>el.draggable),false);
 before=(await state()).requests.filter(r=>r.action==='save').length;
 await resizeToMinute(overnight.locator('.tsc-resize-handle'),nextDay,120);await waitRequest('save',before);
 const crossMidnight=(await state()).requests.filter(r=>r.action==='save').at(-1).draft;
 assert.equal(crossMidnight.start,'2026-10-01T15:00:00.000Z');assert.equal(crossMidnight.end,'2026-10-01T18:00:00.000Z');assert.equal(crossMidnight.notes,'跨日备注保留。');checks.push('resizing a next-day continuation to 02:00 preserves the original previous-day start');
 assert.equal(await overnight.evaluate(el=>el.draggable),false);
 before=(await state()).requests.filter(r=>r.action==='save').length;
 await resizeToMinute(overnight.locator('.tsc-resize-handle'),nextDay,180,true);
 assert.equal(await overnight.evaluate(el=>el.draggable),false);assert.equal((await state()).requests.filter(r=>r.action==='save').length,before);checks.push('cross-day continuation stays non-draggable after resize and Escape cancellation');
 await page.locator('.tsc-week-heading[data-date="2026-10-02"]').click();before=(await state()).requests.filter(r=>r.action==='task-toggle').length;
 await savedTask('收件箱.md:0').getByRole('button',{name:'完成任务',exact:true}).click();await waitRequest('task-toggle',before);
 assert.match((await state()).taskMarkdown['收件箱.md'],/\[x\].*✅ 2026-10-01.*\^inbox/);assert.equal(await taskColumn.locator('.tsc-task-chip').count(),0);checks.push('checking a task updates Markdown and removes its active time block');
 await page.getByRole('button',{name:'月',exact:true}).click();await page.locator('.tsc-month-day').first().waitFor();
 await page.screenshot({path:'qa/large-calendar-output/linked-month.png'});
 await page.getByRole('button',{name:'周',exact:true}).click();await page.evaluate(()=>document.querySelector('.tsc-large-main').scrollTop=384);
 await page.screenshot({path:'qa/large-calendar-output/linked-week.png'});

 // Empty-time gestures open a pre-filled draft only; cancelled gestures never save.
 const rangeDay='2026-10-04',rangeWrites=(await state()).requests.filter(r=>r.action==='save').length;
 let gesture=await startRange(rangeDay,548,667);
 await page.locator('.tsc-range-preview').waitFor();assert.equal(await page.locator('.tsc-range-preview').getAttribute('data-start'),'555');assert.equal(await page.locator('.tsc-range-preview').getAttribute('data-end'),'660');
 assert.equal(await page.locator('form').count(),0);checks.push('week drag previews the snapped start and end without opening or saving early');
 await page.evaluate(()=>window.view.refresh(true));assert.equal(await page.locator('.tsc-range-preview').count(),1);checks.push('refresh during time selection is deferred without replacing its column');
 await page.evaluate(()=>{window.dispatchEvent(new PointerEvent('pointermove',{pointerId:2,clientY:800}));window.dispatchEvent(new PointerEvent('pointerup',{pointerId:2,clientY:800}));});assert.equal(await page.locator('.tsc-range-preview').getAttribute('data-end'),'660');assert.equal(await page.locator('form').count(),0);checks.push('a second pointer cannot alter or commit another pointer’s live selection');
 await page.screenshot({path:'qa/large-calendar-output/time-range.png'});
 await page.mouse.up();await rangeInputs(`${rangeDay}T09:15`,`${rangeDay}T11:00`);assert.equal(await page.locator('.tsc-range-preview').count(),0);checks.push('release opens one event draft with the selected duration');
 await page.getByRole('button',{name:'取消',exact:true}).click();
 gesture=await startRange(rangeDay,690,602);await page.mouse.up();await rangeInputs(`${rangeDay}T10:00`,`${rangeDay}T11:30`);checks.push('reverse time selection sorts the range and keeps 15-minute snapping');await page.getByRole('button',{name:'取消',exact:true}).click();
 gesture=await startRange(rangeDay,540,545);await page.mouse.up();await rangeInputs(`${rangeDay}T09:00`,`${rangeDay}T09:15`);checks.push('a short drag still creates a positive 15-minute draft');await page.getByRole('button',{name:'取消',exact:true}).click();
 gesture=await startRange(rangeDay,1425,1460);await page.mouse.up();await rangeInputs(`${rangeDay}T23:45`,`${rangeDay}T23:59`);checks.push('late-night selection ends at 23:59 instead of silently changing the selected date');await page.getByRole('button',{name:'取消',exact:true}).click();
 for(const cancel of['Escape','pointercancel','blur','lostpointercapture']){
  gesture=await startRange(rangeDay,540,600);await page.locator('.tsc-range-preview').waitFor();
  if(cancel==='Escape')await page.keyboard.press('Escape');
  else if(cancel==='lostpointercapture'){await gesture.column.evaluate(el=>el.releasePointerCapture(1));await page.mouse.move(gesture.finish.x,gesture.finish.y+1);}
  else await page.evaluate(kind=>window.dispatchEvent(kind==='pointercancel'?new PointerEvent(kind,{pointerId:1}):new Event(kind)),cancel);
  await page.mouse.up();assert.equal(await page.locator('.tsc-range-preview').count(),0);assert.equal(await page.locator('form').count(),0);assert.equal(await page.locator('.is-selecting-range').count(),0);checks.push(`${cancel} cancels a time selection and suppresses its trailing click`);
 }
 for(const stage of['pointerup','pointermove']){
  gesture=await startRange(rangeDay,540,600);await page.locator('.tsc-range-preview').waitFor();await gesture.column.evaluate(el=>el.style.height='0px');
  if(stage==='pointermove')await page.mouse.move(gesture.finish.x,gesture.finish.y+1);await page.mouse.up();
  assert.equal(await page.locator('form').count(),0);assert.equal(await page.locator('.tsc-range-preview').count(),0);assert.equal(await page.locator('.is-selecting-range').count(),0);checks.push(`a collapsed week column cancels on ${stage} without opening a draft`);
  await gesture.column.evaluate(el=>el.style.height='');
 }
 assert.equal((await state()).requests.filter(r=>r.action==='save').length,rangeWrites);checks.push('time selection and cancelling drafts never writes an Apple event');
 await page.waitForTimeout(320);
 const idleColumn=page.locator(`.tsc-week-column[data-date="${rangeDay}"]`);await idleColumn.click({position:{x:10,y:15}});await page.locator('form').waitFor();
 const idleStart=await page.locator('input[type=datetime-local]').first().inputValue(),idleEnd=await page.locator('input[type=datetime-local]').last().inputValue();assert.equal(Date.parse(idleEnd)-Date.parse(idleStart),3600000);checks.push('an ordinary blank-time click keeps its existing one-hour default');await page.getByRole('button',{name:'取消',exact:true}).click();
 // Local actual work stays distinct from plans and never calls Apple save.
 await page.evaluate(async()=>{await window.view.showDay(new Date(2026,9,1));const at=(day,hour,minute=0)=>+new Date(2026,9,day,hour,minute),meeting=window.events.find(event=>event.id==='meeting');const make=(id,segments,target,mode='stopwatch',phase='focus')=>({id,mode,phase,outcome:'stopped',startedAt:segments[0].start,completedAt:segments.at(-1).end,durationMs:segments.reduce((sum,segment)=>sum+segment.end-segment.start,0),segments,target});window.actualFixture=[make('actual-task',[{start:at(1,9,10),end:at(1,9,20)},{start:at(1,9,35),end:at(1,9,45)}],{title:'任务实际投入',path:'QA.md',line:0,source:'- [ ] 09:00 - 09:30 测试双向联动和日期切换 ⏳ 2026-10-01 ^scheduled',plannedDurationMs:1800000}),make('actual-event',[{start:at(1,10,10),end:at(1,10,40)}],{title:'会议实际投入',eventId:'meeting',calendarId:'work',plannedStart:Date.parse(meeting.start),plannedEnd:Date.parse(meeting.end),plannedDurationMs:Date.parse(meeting.end)-Date.parse(meeting.start)}),make('actual-midnight',[{start:at(1,23,40),end:at(1,23,50)},{start:at(1,23,55),end:at(2,0,10)},{start:at(2,0,45),end:at(2,1,0)}],{title:'跨午夜实际投入'}),make('actual-break',[{start:at(1,11),end:at(1,11,5)}],{title:'短休息'},'pomodoro','short-break')];window.qaFixture.setTimerRecords(window.actualFixture);});
 assert.equal(await page.locator('.tsc-week-actual').count(),7);assert.equal(await page.locator('.tsc-week-actual[draggable=true],.tsc-week-actual .tsc-resize-handle').count(),0);checks.push('actual work renders seven active segments with no dragging or resizing controls');
 assert.equal(await page.locator('.tsc-week-actual[data-record-id="actual-break"]').count(),0);checks.push('Pomodoro rest records are excluded from actual work blocks');
 const actualOverlap=await page.locator('.tsc-week-column[data-date="2026-10-01"]').evaluate(column=>{const planned=column.querySelector('.tsc-task-chip').getBoundingClientRect(),actual=column.querySelector('.tsc-week-actual[data-record-id="actual-task"]').getBoundingClientRect();return planned.right<=actual.left;});assert.equal(actualOverlap,true);checks.push('planned and actual week blocks occupy distinct rails without hiding a plan');
 assert.equal(await page.locator('.tsc-actual-entry[data-record-id="actual-task"]').getByText('实际 20 分钟',{exact:true}).count(),1);assert.equal(await page.locator('.tsc-actual-entry[data-record-id="actual-task"]').getByText('计划 30 分钟',{exact:true}).count(),1);assert.equal(await page.getByText('实际投入 · 65 分钟',{exact:true}).count(),1);checks.push('daily history compares planned duration with active time and excludes pauses');
 assert.equal(await page.locator('.tsc-actual-meta').first().evaluate(meta=>getComputedStyle(meta).fontSize),'10px');assert.equal(await page.locator('.tsc-actual-entry .tsc-entry-actions').count(),3);checks.push('history compares actual and planned minutes in compact metadata with scoped source actions');
 await page.locator('.tsc-actual-entry[data-record-id="actual-task"]').getByRole('button',{name:'打开实际计时来源',exact:true}).click();assert.equal(await page.evaluate(()=>window.openedTask),'QA.md:0');checks.push('actual task records open their original note and line');
 await page.locator('.tsc-actual-entry[data-record-id="actual-event"]').getByRole('button',{name:'查看计划日程',exact:true}).click();await page.locator('.tsc-event-form').waitFor();assert.equal(await page.locator('input[type=datetime-local]').first().inputValue(),'2026-10-03T11:00');await page.getByRole('button',{name:'取消',exact:true}).click();checks.push('actual Apple records jump to the planned occurrence and open its source');
 await page.evaluate(()=>window.view.showDay(new Date(2026,9,1)));await page.getByRole('button',{name:'月',exact:true}).click();assert.equal(await page.locator('.tsc-month-day[data-date="2026-10-01"] .tsc-cell-actual').textContent(),'实 65 分');assert.equal(await page.locator('.tsc-month-day[data-date="2026-10-02"] .tsc-cell-actual').textContent(),'实 25 分');checks.push('monthly actual minute badges clip midnight segments to each local day');
 await page.screenshot({path:'qa/large-calendar-output/timer-actual-month.png'});
 await page.evaluate(async()=>{window.events.find(event=>event.id==='walk').editable=false;await window.view.refresh(true);});
 const timerEventsBefore=(await state()).requests.filter(request=>request.action==='events').length,timerSavesBefore=(await state()).requests.filter(request=>request.action==='save').length;
 await page.locator('.tsc-agenda-entry[data-event-id="walk"]').getByRole('button',{name:'开始日程计时',exact:true}).click();await page.waitForFunction(()=>window.requests.some(request=>request.action==='timer-start'&&request.target.eventId==='walk'));const timedTimer=(await state()).requests.filter(request=>request.action==='timer-start').at(-1);assert.equal(timedTimer.target.plannedDurationMs,3600000);assert.equal(timedTimer.mode,'countdown');assert.equal(timedTimer.durationMinutes,60);assert.equal((await state()).requests.filter(request=>request.action==='save').length,timerSavesBefore);assert.equal((await state()).requests.filter(request=>request.action==='events').length,timerEventsBefore);checks.push('readonly timed Apple events start a plan-length countdown without Apple writes or reload');
 await page.locator('.tsc-agenda-entry[data-event-id="holiday"]').getByRole('button',{name:'开始日程计时',exact:true}).click();await page.waitForFunction(()=>window.requests.some(request=>request.action==='timer-start'&&request.target.eventId==='holiday'));const readonlyTimer=(await state()).requests.filter(request=>request.action==='timer-start').at(-1);assert.equal(readonlyTimer.target.plannedDurationMs,86400000);assert.equal(readonlyTimer.mode,'stopwatch');assert.equal((await state()).requests.filter(request=>request.action==='save').length,timerSavesBefore);assert.equal((await state()).requests.filter(request=>request.action==='events').length,timerEventsBefore);checks.push('readonly all-day Apple events start a local stopwatch without Apple writes or reload');
 await savedTask('QA.md:0').getByRole('button',{name:'开始任务计时',exact:true}).click();await page.waitForFunction(()=>window.requests.some(request=>request.action==='timer-start'&&request.target.path==='QA.md'));const taskTimer=(await state()).requests.filter(request=>request.action==='timer-start').at(-1);assert.equal(taskTimer.target.line,0);assert.equal(taskTimer.target.plannedDurationMs,1800000);assert.equal(taskTimer.mode,'countdown');assert.equal(taskTimer.durationMinutes,30);assert.match(taskTimer.target.source,/\^scheduled/);checks.push('task timer action retains source identity and starts its planned duration');
 await page.getByRole('button',{name:'周',exact:true}).click();await page.evaluate(()=>{window.qaFixture.setActiveTimer('stopwatch',120000,0);window.actualNode=document.querySelector('.tsc-week-actual');for(let i=0;i<20;i++)window.qaFixture.clockTick(120000+i*1000,0);});assert.equal(await page.evaluate(()=>window.actualNode===document.querySelector('.tsc-week-actual')),true);assert.match(await page.locator('.tsc-active-timer-pill').textContent(),/正计时 02:19/);checks.push('timer clock ticks update text without replacing actual or planned week rows');
 await page.screenshot({path:'qa/large-calendar-output/timer-actual-week.png'});
 await page.locator('.tsc-actual-list').evaluate(list=>{const agenda=list.closest('.tsc-day-agenda');agenda.scrollTop+=list.previousElementSibling.getBoundingClientRect().top-agenda.getBoundingClientRect().top-16;});await page.screenshot({path:'qa/large-calendar-output/timer-actual-history.png'});
 assert.equal(await page.locator('.tsc-week-rail-key').textContent(),'计划 / 实际');checks.push('week actual records show a compact planned-versus-actual rail legend');
 await page.evaluate(()=>window.qaFixture.clockTick(5400999,0));assert.match(await page.locator('.tsc-active-timer-pill').textContent(),/正计时 01:30:00/);await page.evaluate(()=>window.qaFixture.setActiveTimer('countdown',0,5400001));assert.match(await page.locator('.tsc-active-timer-pill').textContent(),/倒计时 01:30:01/);checks.push('hour clocks use HH:MM:SS with elapsed flooring and countdown ceiling');
 await page.getByRole('button',{name:'月',exact:true}).click();await page.evaluate(()=>document.querySelector('#root').style.width='260px');assert.equal(await page.locator('.tsc-large-header').evaluate(header=>{const pane=header.closest('.tsc-large-calendar').getBoundingClientRect();return [...header.querySelectorAll('button')].filter(button=>!button.hidden).every(button=>{const r=button.getBoundingClientRect();return r.left>=pane.left&&r.right<=pane.right;});}),true);assert.equal(await page.locator('.tsc-cell-actual').count(),2);await page.locator('#root').screenshot({path:'qa/large-calendar-output/timer-actual-narrow.png'});checks.push('a 260px pane keeps the active timer and every header action inside its bounds with actual badges');await page.evaluate(()=>document.querySelector('#root').style.width='');await page.getByRole('button',{name:'周',exact:true}).click();await page.evaluate(()=>window.qaFixture.setActiveTimer('stopwatch',139000,0));
 const actualCalls=(await state()).requests.filter(request=>request.action==='events').length;gesture=await startRange(rangeDay,540,600);await page.locator('.tsc-range-preview').waitFor();await page.evaluate(()=>{const start=+new Date(2026,9,4,12);window.actualFixture.push({id:'deferred-actual',mode:'countdown',outcome:'completed',startedAt:start,completedAt:start+600000,durationMs:600000,segments:[{start,end:start+600000}],target:{title:'手势后记录'}});window.qaFixture.setTimerRecords(window.actualFixture);});assert.equal(await page.locator('.tsc-range-preview').count(),1);assert.equal(await page.locator('.tsc-week-actual[data-record-id="deferred-actual"]').count(),0);await page.keyboard.press('Escape');await page.mouse.up();await page.locator('.tsc-week-actual[data-record-id="deferred-actual"]').waitFor();assert.equal((await state()).requests.filter(request=>request.action==='events').length,actualCalls);checks.push('timer record refresh defers through an active gesture and reconciles without Apple transport');
 await page.evaluate(()=>window.view.showDay(new Date()));assert.equal(await page.locator('.tsc-agenda-active-timer').count(),1);const currentCalls=(await state()).requests.filter(request=>request.action==='events').length;await page.evaluate(()=>window.qaFixture.clockTick(125000,0));assert.match(await page.locator('.tsc-agenda-active-timer').textContent(),/正计时 02:05/);assert.equal((await state()).requests.filter(request=>request.action==='events').length,currentCalls);checks.push('current-day active timer pill follows lightweight clock updates without an event query');
 await page.evaluate(()=>window.view.showDay(new Date(2026,9,1)));
 gesture=await startRange(rangeDay,540,600);await page.locator('.tsc-range-preview').waitFor();await page.evaluate(()=>window.view.onClose());await page.mouse.up();assert.equal(await page.locator('form').count(),0);assert.equal(await page.locator('.tsc-range-preview').count(),0);checks.push('closing the view releases a live selection without opening a draft');
 assert.deepEqual(errors,[]);checks.push('no uncaught browser errors');
 writeFileSync('qa/large-calendar-output/VERIFY.json',JSON.stringify({checkedAt:new Date().toISOString(),checks,errors,scope:'Synthetic fixture host only. No real Apple Calendar writes or Obsidian runtime integration.'},null,2));
 console.log(JSON.stringify({checks,errors},null,2));
} catch(error) {
 await page.screenshot({path:'qa/large-calendar-output/failure.png'}).catch(()=>{});
 writeFileSync('qa/large-calendar-output/VERIFY.json',JSON.stringify({checkedAt:new Date().toISOString(),checks,errors,failure:String(error),scope:'Synthetic fixture host only. No real Apple Calendar writes or Obsidian runtime integration.'},null,2));
 throw error;
} finally {await browser.close();server.close();}
