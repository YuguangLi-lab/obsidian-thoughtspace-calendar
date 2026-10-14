import {build} from 'esbuild';
import {createRequire} from 'node:module';
const qaRequire=createRequire(path.resolve(process.env.QA_DEPENDENCIES||'.','package.json'));
const {chromium}=qaRequire('@playwright/test');
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
mkdirSync('qa/large-calendar-output/week-drag-audit',{recursive:true});
await build({entryPoints:['qa/large-calendar-preview.ts'],bundle:true,format:'esm',outfile:'qa/large-calendar-output/week-drag-audit/preview.js',alias:{obsidian:path.resolve('qa/large-calendar-obsidian-stub.ts')},platform:'browser'});
// Gesture previews use the current source CSS as well as the generated plugin sheet.
const css=readFileSync('styles.css','utf8')+'\n'+readFileSync('src/large-calendar.css','utf8');
const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
:root {--font-interface:system-ui;--interactive-accent:#467c83;--background-modifier-border:#dde4e6;--background-modifier-hover:#eaf0f2;--background-primary:#fff;--background-secondary:#f7f9fa;--text-normal:#243238;--text-muted:#718187;--text-faint:#98a4a8;--text-on-accent:#fff;--text-error:#be4343;}
*{box-sizing:border-box}body{margin:0}#root{height:100vh}button,input,select,textarea{font:inherit;font-size:13px;border:1px solid #d7dfe2;border-radius:6px;background:#fff;color:inherit;padding:7px}button{display:inline-flex;align-items:center;justify-content:center}input,select{height:34px}.mod-cta{color:white;background:#467c83;border-color:#467c83}.modal{position:fixed;z-index:30;width:500px;top:50%;left:50%;transform:translate(-50%,-50%);padding:24px;border:1px solid #d7dfe2;border-radius:14px;background:white;box-shadow:0 12px 80px #0003;max-height:95vh;overflow:auto}.modal h2{font-size:20px;margin:0 0 20px}button:focus-visible{outline:2px solid #467c83;outline-offset:2px}
${css}</style></head><body><div id="root"></div><script type="module" src="/preview.js"></script></body></html>`;
writeFileSync('qa/large-calendar-output/week-drag-audit/index.html',html);
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/preview.js'?'application/javascript':'text/html');res.end(req.url==='/preview.js'?readFileSync('qa/large-calendar-output/week-drag-audit/preview.js'):html);});
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
const results=[];
async function fresh(){
 await page.goto(`http://127.0.0.1:${port}`);
 await page.locator('.tsc-month-day').first().waitFor();
 await page.evaluate(()=>window.view.showDay(new Date(2026,9,1)));
 await page.getByRole('button',{name:'周',exact:true}).click();
 await page.locator('.tsc-week-column').first().waitFor();
}
async function resizeStart(kind='task',day='2026-10-01'){
 const column=page.locator(`.tsc-week-column[data-date="${day}"]`);
 const chip=column.locator(kind==='task'?'.tsc-task-chip':'.tsc-week-event:not(.tsc-task-chip)').filter({hasText:kind==='task'?'测试双向联动':'产品讨论'});
 const handle=chip.locator('.tsc-resize-handle');await handle.scrollIntoViewIfNeeded();
 const grip=await handle.boundingBox();assert(grip);
 await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();
 return {column,chip,handle};
}
async function moveResize(gesture,minute){
 const rect=await gesture.column.boundingBox();assert(rect);
 const point={x:rect.x+rect.width/2,y:rect.y+rect.height*minute/1440};
 await page.mouse.move(point.x,point.y,{steps:6});return point;
}
async function audit(name,run){
 await page.setViewportSize({width:1440,height:900});await fresh();
 try{await run();results.push({name,passed:true});}
 catch(error){results.push({name,passed:false,error:String(error)});await page.screenshot({path:`qa/large-calendar-output/week-drag-audit/failure-${results.length}.png`}).catch(()=>{});}
 finally{await page.mouse.up();await page.keyboard.press('Escape');}
}
try{
 await audit('resize recomputes civil minute after the time grid scrolls',async()=>{
  const gesture=await resizeStart();
  await gesture.column.evaluate(el=>el.closest('.tsc-large-main').scrollTop+=120);
  await moveResize(gesture,600);await page.mouse.up();await waitRequest('task-schedule',0);
  assert.match((await state()).taskMarkdown['QA.md'],/09:00 - 10:00/);
 });
 await audit('another pointercancel cannot cancel the active resize',async()=>{
  const gesture=await resizeStart();await moveResize(gesture,600);
  await page.evaluate(()=>window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:77,isPrimary:false})));
  assert.equal(await gesture.chip.evaluate(el=>el.classList.contains('is-resizing')),true);
  await page.mouse.up();await waitRequest('task-schedule',0);assert.match((await state()).taskMarkdown['QA.md'],/09:00 - 10:00/);
 });
 await audit('pointerup consumes the final resize coordinate',async()=>{
  const gesture=await resizeStart();await moveResize(gesture,600);
  await gesture.column.evaluate(el=>{const rect=el.getBoundingClientRect();window.dispatchEvent(new PointerEvent('pointerup',{pointerId:1,clientX:rect.x+rect.width/2,clientY:rect.top+rect.height*660/1440}));});
  await page.mouse.up();await waitRequest('task-schedule',0);assert.match((await state()).taskMarkdown['QA.md'],/09:00 - 11:00/);
 });
 for(const stage of ['pointermove','pointerup'])await audit(`a collapsed column cancels resize on ${stage} without writing`,async()=>{
  const gesture=await resizeStart();const point=await moveResize(gesture,600);
  await gesture.column.evaluate(el=>el.style.height='0px');
  if(stage==='pointermove')await page.mouse.move(point.x,point.y+1);await page.mouse.up();
  await page.waitForTimeout(100);
  assert.equal((await state()).requests.filter(r=>r.action==='task-schedule').length,0);
  assert.equal(await page.locator('.is-resizing').count(),0);
 });
 await audit('a secondary pointer cannot begin resize',async()=>{
  const column=page.locator('.tsc-week-column[data-date="2026-10-01"]'),chip=column.locator('.tsc-task-chip');
  await chip.locator('.tsc-resize-handle').evaluate(el=>el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:77,button:0,isPrimary:false})));
  assert.equal(await page.locator('.is-resizing').count(),0);
 });
 await audit('zero-height geometry cannot begin a resize',async()=>{
  const column=page.locator('.tsc-week-column[data-date="2026-10-01"]'),chip=column.locator('.tsc-task-chip');
  await column.evaluate(el=>el.style.height='0px');
  await chip.locator('.tsc-resize-handle').evaluate(el=>el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,button:0,isPrimary:true})));
  assert.equal(await page.locator('.is-resizing').count(),0);
 });
 await audit('an untouched handle preserves exact manually entered minutes',async()=>{
  await page.evaluate(async()=>{const tasks=await window.view.host.tasks(new Date(2026,9,1),new Date(2026,9,2));await window.view.host.scheduleTask(tasks[0],'2026-10-01',547,592);await window.view.refresh(true);});
  const before=(await state()).requests.filter(r=>r.action==='task-schedule').length;
  await resizeStart();await page.mouse.up();await page.waitForTimeout(100);
  assert.equal((await state()).requests.filter(r=>r.action==='task-schedule').length,before);
  assert.match((await state()).taskMarkdown['QA.md'],/09:07 - 09:52/);
 });
 await audit('minor pointer jitter preserves precise end minutes without a write',async()=>{
  await page.evaluate(async()=>{const tasks=await window.view.host.tasks(new Date(2026,9,1),new Date(2026,9,2));await window.view.host.scheduleTask(tasks[0],'2026-10-01',547,592);await window.view.refresh(true);});
  const before=(await state()).requests.filter(r=>r.action==='task-schedule').length;
  const gesture=await resizeStart(),rect=await gesture.handle.boundingBox();assert(rect);
  await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2+1);await page.mouse.up();await page.waitForTimeout(100);
  assert.equal((await state()).requests.filter(r=>r.action==='task-schedule').length,before);
  assert.match((await state()).taskMarkdown['QA.md'],/09:07 - 09:52/);
 });
 await audit('component unload cancels resize even without an onClose callback',async()=>{
  const gesture=await resizeStart();await moveResize(gesture,660);
  await page.evaluate(()=>window.view.cleanups.forEach(cleanup=>cleanup()));
  assert.equal(await page.locator('.is-resizing').count(),0);await page.mouse.up();
  assert.equal((await state()).requests.filter(r=>r.action==='task-schedule').length,0);
 });
 await audit('Escape restores resizing state and does not leave a stale end label',async()=>{
  const gesture=await resizeStart();const original=await gesture.handle.getAttribute('title');await moveResize(gesture,660);await page.keyboard.press('Escape');await page.mouse.up();
  assert.equal(await gesture.handle.getAttribute('title'),original);
  assert.equal(await gesture.chip.evaluate(el=>el.draggable),true);
  assert.equal((await state()).requests.filter(r=>r.action==='task-schedule').length,0);
 });
 await audit('close during active resize cancels all listeners and writes',async()=>{
  const gesture=await resizeStart();await moveResize(gesture,660);await page.evaluate(()=>window.view.onClose());await page.mouse.up();
  assert.equal((await state()).requests.filter(r=>r.action==='task-schedule').length,0);assert.equal(await page.locator('.is-resizing').count(),0);
 });
 await audit('resize defers refresh and preserves its original chip until release',async()=>{
  const gesture=await resizeStart();await moveResize(gesture,600);
  await gesture.chip.evaluate(el=>window.originalResizingChip=el);await page.evaluate(()=>window.view.refresh(true));
  assert.equal(await page.evaluate(()=>window.originalResizingChip.isConnected),true);
  await page.mouse.up();await waitRequest('task-schedule',0);assert.match((await state()).taskMarkdown['QA.md'],/09:00 - 10:00/);
 });
 await audit('an asynchronous task resize blocks another mutation and refreshes before the next edit',async()=>{
  await page.evaluate(()=>{const host=window.view.host,original=host.scheduleTask;let release;const gate=new Promise(resolve=>release=resolve);window.releaseTaskResize=release;host.scheduleTask=async(...args)=>{host.scheduleTask=original;await gate;return original(...args);};});
  let gesture=await resizeStart();await moveResize(gesture,600);await page.mouse.up();await page.locator('#root.is-saving').waitFor();
  await gesture.chip.evaluate(el=>window.originalResizingChip=el);await page.evaluate(()=>window.view.refresh(true));
  assert.equal(await page.evaluate(()=>window.originalResizingChip.isConnected),true);
  const handle=gesture.handle;await handle.evaluate(el=>el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:77,button:0,isPrimary:true})));assert.equal(await page.locator('.is-resizing').count(),0);
  await page.evaluate(()=>window.releaseTaskResize());await waitRequest('task-schedule',0);
  gesture=await resizeStart();await moveResize(gesture,630);await page.mouse.up();await waitRequest('task-schedule',1);
  assert.match((await state()).taskMarkdown['QA.md'],/09:00 - 10:30.*\^scheduled/);
 });
 await audit('post-save refresh keeps editing locked until new source snapshots reach the grid',async()=>{
  await page.evaluate(()=>{const host=window.view.host,original=host.tasks;let release;const gate=new Promise(resolve=>release=resolve);window.releasePostSaveRefresh=()=>{host.tasks=original;release();};host.tasks=async(...args)=>{window.postSaveRefreshStarted=true;await gate;return original(...args);};});
  let gesture=await resizeStart();await moveResize(gesture,600);await page.mouse.up();await page.waitForFunction(()=>window.postSaveRefreshStarted===true);
  assert.equal(await page.locator('#root.is-saving').count(),1);
  await gesture.handle.evaluate(el=>el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:77,button:0,isPrimary:true})));assert.equal(await page.locator('.is-resizing').count(),0);
  await page.evaluate(()=>window.releasePostSaveRefresh());await page.locator('#root.is-saving').waitFor({state:'detached'});
  gesture=await resizeStart();await moveResize(gesture,630);await page.mouse.up();await waitRequest('task-schedule',1);assert.match((await state()).taskMarkdown['QA.md'],/09:00 - 10:30/);
 });
 await audit('lost pointer capture cancels a resize without persisting its preview',async()=>{
  const gesture=await resizeStart();const point=await moveResize(gesture,660);
  assert.equal(await gesture.handle.evaluate(el=>el.hasPointerCapture(1)),true);
  await gesture.handle.evaluate(el=>el.releasePointerCapture(1));await page.mouse.move(point.x,point.y+1);await page.mouse.up();
  assert.equal(await page.locator('.is-resizing').count(),0);assert.equal((await state()).requests.filter(r=>r.action==='task-schedule').length,0);
 });
 for(const kind of ['pointercancel','blur'])await audit(`${kind} cancels active resize and restores draggable state`,async()=>{
  const gesture=await resizeStart();await moveResize(gesture,660);
  await page.evaluate(kind=>window.dispatchEvent(kind==='pointercancel'?new PointerEvent(kind,{pointerId:1}):new Event(kind)),kind);await page.mouse.up();
  assert.equal(await gesture.chip.evaluate(el=>el.draggable),true);assert.equal(await page.locator('.is-resizing').count(),0);assert.equal((await state()).requests.filter(r=>r.action==='task-schedule').length,0);
 });
 await audit('narrowing the pane mid-resize uses its current column geometry',async()=>{
  const gesture=await resizeStart();await page.setViewportSize({width:640,height:900});await moveResize(gesture,600);await page.mouse.up();await waitRequest('task-schedule',0);
  assert.match((await state()).taskMarkdown['QA.md'],/09:00 - 10:00/);await page.setViewportSize({width:1440,height:900});
 });
 await audit('range selection cancels if its column loses width before release',async()=>{
  const gesture=await startRange('2026-10-04',540,600);await page.locator('.tsc-range-preview').waitFor();
  await gesture.column.evaluate(el=>el.style.width='0px');await page.mouse.up();
  assert.equal(await page.locator('form').count(),0);assert.equal(await page.locator('.tsc-range-preview').count(),0);
 });
 await audit('range selection remains on the original date while crossing a neighbouring column',async()=>{
  const gesture=await startRange('2026-10-04',540,600),other=page.locator('.tsc-week-column[data-date="2026-10-03"]');
  const rect=await other.boundingBox();assert(rect);await page.mouse.move(rect.x+rect.width*.5,rect.y+rect.height*660/1440);await page.mouse.up();await rangeInputs('2026-10-04T09:00','2026-10-04T11:00');
  await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal((await state()).requests.filter(r=>r.action==='save').length,0);
 });
 await audit('old task and event controls stay inactive while the saved grid is reconciling',async()=>{
  await page.evaluate(()=>{const host=window.view.host,original=host.tasks;let release;const gate=new Promise(resolve=>release=resolve);window.releasePostSaveRefresh=()=>{host.tasks=original;release();};host.tasks=async(...args)=>{window.postSaveRefreshStarted=true;await gate;return original(...args);};});
  const gesture=await resizeStart();await moveResize(gesture,600);await page.mouse.up();await page.waitForFunction(()=>window.postSaveRefreshStarted===true);await page.waitForTimeout(320);
  await savedTask('QA.md:0').getByRole('button',{name:'安排任务时间',exact:true}).click();assert.equal(await page.locator('form').count(),0);
  await page.locator('.tsc-week-column[data-date="2026-10-01"] .tsc-week-event:not(.tsc-task-chip)').filter({hasText:'产品讨论'}).click();assert.equal(await page.locator('form').count(),0);
  await page.evaluate(()=>window.releasePostSaveRefresh());await page.locator('#root.is-saving').waitFor({state:'detached'});
 });
 await audit('switching an exact-midnight ending to all-day excludes the following date',async()=>{
  await page.evaluate(()=>{const event=window.events.find(event=>event.id==='overnight');event.end='2026-10-01T16:00:00.000Z';window.view.openEvent(event);});await page.locator('.tsc-event-form').waitFor();
  await page.getByText('全天',{exact:true}).last().click();
  assert.equal(await page.locator('input[type=date]').first().inputValue(),'2026-10-01');assert.equal(await page.locator('input[type=date]').last().inputValue(),'2026-10-01');
  await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal((await state()).requests.filter(r=>r.action==='save').length,0);
 });
 await audit('switching a genuine cross-midnight duration to all-day retains both occupied dates',async()=>{
  await page.evaluate(()=>window.view.openEvent(window.events.find(event=>event.id==='overnight')));await page.locator('.tsc-event-form').waitFor();
  await page.getByText('全天',{exact:true}).last().click();
  assert.equal(await page.locator('input[type=date]').first().inputValue(),'2026-10-01');assert.equal(await page.locator('input[type=date]').last().inputValue(),'2026-10-02');await page.getByRole('button',{name:'取消',exact:true}).click();
 });
 for(const [from,to] of [[0,15],[540,555],[1425,1440]])await audit(`short ${from}–${to} selection label fits the civil-day column without stretching its time range`,async()=>{
  const gesture=await startRange('2026-10-04',from,to),preview=gesture.column.locator('.tsc-range-preview'),label=preview.locator('.tsc-week-selection-preview');
  await label.waitFor();
  const geometry=await preview.evaluate(el=>{const rect=el.getBoundingClientRect(),column=el.parentElement.getBoundingClientRect(),label=el.querySelector('.tsc-week-selection-preview').getBoundingClientRect();return {height:rect.height,expected:(Number(el.dataset.end)-Number(el.dataset.start))/1440*column.height,label:{top:label.top,bottom:label.bottom,left:label.left,right:label.right},column:{top:column.top,bottom:column.bottom,left:column.left,right:column.right},contents:[...el.querySelectorAll('.tsc-preview-time,.tsc-preview-duration')].map(child=>{const box=child.getBoundingClientRect();return {top:box.top,bottom:box.bottom,left:box.left,right:box.right};})};});
  assert(Math.abs(geometry.height-geometry.expected)<=1,JSON.stringify(geometry));
  assert(geometry.label.top>=geometry.column.top-1&&geometry.label.bottom<=geometry.column.bottom+1,JSON.stringify(geometry));
  assert(geometry.label.left>=geometry.column.left-1&&geometry.label.right<=geometry.column.right+1,JSON.stringify(geometry));
  assert(geometry.contents.every(content=>content.top>=geometry.label.top-1&&content.bottom<=geometry.label.bottom+1&&content.left>=geometry.label.left-1&&content.right<=geometry.label.right+1),JSON.stringify(geometry));
  await page.keyboard.press('Escape');await page.mouse.up();assert.equal((await state()).requests.filter(r=>r.action==='save').length,0);
 });
 await audit('the first visible 09:00 selection label stays beneath the sticky weekday header',async()=>{
  const column=page.locator('.tsc-week-column[data-date="2026-10-04"]');
  await column.evaluate(el=>{const main=el.closest('.tsc-large-main'),header=main.querySelector('.tsc-week-header'),rect=el.getBoundingClientRect();main.scrollTop+=rect.top+rect.height*540/1440-header.getBoundingClientRect().bottom-8;});
  const rect=await column.boundingBox();assert(rect);await page.mouse.move(rect.x+rect.width*.75,rect.y+rect.height*540/1440);await page.mouse.down();await page.mouse.move(rect.x+rect.width*.75,rect.y+rect.height*555/1440,{steps:6});
  const label=column.locator('.tsc-week-selection-preview');await label.waitFor();
  const geometry=await label.evaluate(el=>{const main=el.closest('.tsc-large-main'),header=main.querySelector('.tsc-week-header');return {top:el.getBoundingClientRect().top,visibleTop:Math.max(main.getBoundingClientRect().top,header.getBoundingClientRect().bottom)};});
  assert(geometry.top>=geometry.visibleTop+3,JSON.stringify(geometry));assert.equal(await column.locator('.tsc-range-preview').getAttribute('data-placement'),'below');await page.keyboard.press('Escape');await page.mouse.up();
 });
 await audit('a 23:50 task resize cannot preview past 23:59 or write an unchanged clipped end',async()=>{
  await page.evaluate(async()=>{const tasks=await window.view.host.tasks(new Date(2026,9,1),new Date(2026,9,2));await window.view.host.scheduleTask(tasks[0],'2026-10-01',1430,1439);await window.view.refresh(true);});
  const before=(await state()).requests.filter(r=>r.action==='task-schedule').length,gesture=await resizeStart();await moveResize(gesture,1440);
  assert.equal(await gesture.chip.getAttribute('data-range-label'),'23:50–23:59 · 9 分钟');await page.mouse.up();await page.waitForTimeout(100);
  assert.equal((await state()).requests.filter(r=>r.action==='task-schedule').length,before);assert.match((await state()).taskMarkdown['QA.md'],/23:50 - 23:59/);
 });
 await audit('an event beginning 23:50 resizes only to midnight rather than 24:05',async()=>{
  await page.evaluate(async()=>{const event=window.events.find(event=>event.id==='meeting');event.start='2026-10-01T15:50:00.000Z';event.end='2026-10-01T15:59:00.000Z';await window.view.refresh(true);});
  const gesture=await resizeStart('event');await moveResize(gesture,1440);assert.equal(await gesture.chip.getAttribute('data-range-label'),'23:50–24:00 · 10 分钟');await page.mouse.up();await waitRequest('save',0);
  const write=(await state()).requests.find(request=>request.action==='save');assert.equal(write.draft.start,'2026-10-01T15:50:00.000Z');assert.equal(write.draft.end,'2026-10-01T16:00:00.000Z');assert.equal(write.draft.notes,'完整备注\n保留原始内容。');
 });
 await audit('two consecutive Apple resizes preserve notes and validate fresh revision',async()=>{
  let gesture=await resizeStart('event');await moveResize(gesture,720);await page.mouse.up();await waitRequest('save',0);
  gesture=await resizeStart('event');await moveResize(gesture,750);await page.mouse.up();await waitRequest('save',1);
  const saved=(await state()).events.find(event=>event.id==='meeting');assert.equal(saved.end,'2026-10-01T04:30:00.000Z');assert.equal(saved.notes,'完整备注\n保留原始内容。');
  const writes=(await state()).requests.filter(r=>r.action==='save');assert.equal(writes[0].draft.revision,'a'.repeat(64));assert.equal(writes[1].draft.revision,'d'.repeat(64));
 });
 assert.deepEqual(errors,[]);
 const report={checkedAt:new Date().toISOString(),passed:results.filter(test=>test.passed).length,failed:results.filter(test=>!test.passed).length,results,errors,scope:'Synthetic isolated Apple fixture. No real Apple writes or native Obsidian.'};
 writeFileSync('qa/large-calendar-output/week-drag-audit/VERIFY.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 if(report.failed)process.exitCode=1;
}finally{await browser.close();server.close();}
