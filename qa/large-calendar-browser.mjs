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
const css=readFileSync('styles.css','utf8');
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
try {
 await page.goto(`http://127.0.0.1:${port}`);await page.locator('.tsc-month-day').first().waitFor();
 await page.evaluate(()=>{return window.view.showDay(new Date(2026,9,1));});
 assert.equal(await page.locator('.tsc-month-day').count(),42);checks.push('month 42 cells');
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
 assert.deepEqual(errors,[]);checks.push('no uncaught browser errors');
 writeFileSync('qa/large-calendar-output/VERIFY.json',JSON.stringify({checkedAt:new Date().toISOString(),checks,errors,scope:'Synthetic fixture host only. No real Apple Calendar writes or Obsidian runtime integration.'},null,2));
 console.log(JSON.stringify({checks,errors},null,2));
} catch(error) {
 await page.screenshot({path:'qa/large-calendar-output/failure.png'}).catch(()=>{});
 writeFileSync('qa/large-calendar-output/VERIFY.json',JSON.stringify({checkedAt:new Date().toISOString(),checks,errors,failure:String(error),scope:'Synthetic fixture host only. No real Apple Calendar writes or Obsidian runtime integration.'},null,2));
 throw error;
} finally {await browser.close();server.close();}
