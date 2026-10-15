import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {timerLayoutMetrics} from './timer-layout-metrics.mjs';
const require=createRequire(path.resolve(process.env.QA_DEPENDENCIES||'.','package.json'));
const {chromium}=require('@playwright/test');
const out='qa/calendar-timer-output';mkdirSync(out,{recursive:true});
await build({entryPoints:['qa/calendar-timer-preview.ts'],bundle:true,format:'esm',outfile:out+'/preview.js',alias:{obsidian:path.resolve('qa/calendar-timer-obsidian-stub.ts')},platform:'browser'});
const css=readFileSync('styles.css','utf8');
const html=`<!doctype html><html><head><meta charset="utf-8"><style>
:root{--font-interface:system-ui;--font-text:system-ui;--interactive-accent:#376f6c;--background-primary:#fff;--background-secondary:#f5f7f7;--text-normal:#243331;--text-muted:#6b7976;--text-faint:#81908c;--text-on-accent:white;--text-error:#a92d38;--color-green:#36745f;--background-modifier-border:#dce4e1;--background-modifier-hover:#eaf0ec;--ts-ui-1:#fff;--ts-ui-2:#f8faf9;--ts-ui-5:#e5eae8;--ts-ui-6:#dce4e1;--ts-ui-12:#243331;--ts-accent:#376f6c;--ts-selected-ink:white;--ts-ui-11:#6b7976}
body.theme-dark{--background-primary:#202625;--background-secondary:#282e2c;--text-normal:#e2e8e5;--text-muted:#a8b8b1;--text-faint:#8b9b94;--background-modifier-border:#3c4943;--text-on-accent:#202625;--interactive-accent:#9abfaf;--ts-ui-1:#202625;--ts-ui-2:#202625;--ts-ui-5:#333e39;--ts-ui-6:#3c4943;--ts-ui-12:#e2e8e5;--ts-ui-11:#a8b8b1;--ts-accent:#9abfaf;--ts-selected-ink:#202625}
*{box-sizing:border-box}body{margin:0;background:var(--background-primary);color:var(--text-normal);font-family:var(--font-interface)}#root{width:280px;height:100vh;overflow:auto}button,input,select{font:inherit;color:inherit;background:var(--background-primary);border:1px solid var(--background-modifier-border);border-radius:6px;padding:7px}button{cursor:pointer}button:disabled{opacity:.5}${css}
</style></head><body class="theme-light"><div id="root"></div><script type="module" src="/preview.js"></script></body></html>`;
writeFileSync(out+'/index.html',html);
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/preview.js'?'application/javascript':'text/html');res.end(req.url==='/preview.js'?readFileSync(out+'/preview.js'):html);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{}),headless:true});
const page=await browser.newPage({viewport:{width:600,height:900}}),checks=[],errors=[],layouts=[],calendarLayouts=[];
page.on('pageerror',error=>errors.push(error.message));const check=value=>checks.push(value),state=()=>page.evaluate(()=>window.qaCalendarTimer.state());
const timer=page.locator('.ts-journal-timer-host'),button=name=>timer.getByRole('button',{name,exact:true});
const ready=()=>page.waitForFunction(()=>!!window.qaCalendarTimer&&!window.qaCalendarTimer.state().busy);
try{
 await page.goto(`http://127.0.0.1:${server.address().port}`);await ready();
 assert.equal(await timer.isVisible(),false);assert.equal(await page.getByRole('tab',{name:'日历',exact:true}).getAttribute('aria-selected'),'true');check('calendar starts in the month surface with its complete timer hidden');
 for(const theme of ['light','dark'])for(const width of [230,280,420]){
  await page.evaluate(({theme,width})=>{document.body.className='theme-'+theme;document.getElementById('root').style.width=width+'px';},{theme,width});
  const densityMeasurements=[];
  for(const density of ['comfortable','compact']){
   await page.evaluate(density=>window.qaCalendarTimer.density(density),density);
   const geometry=await page.locator('.ts-calendar').evaluate(el=>{const cells=[...el.querySelectorAll('.ts-calendar-day')],lunar=el.querySelector('.ts-calendar-lunar-label'),solar=el.querySelector('.ts-calendar-solar-number');return {overflow:el.scrollWidth>el.clientWidth+1,solar:parseFloat(getComputedStyle(solar).fontSize),lunar:parseFloat(getComputedStyle(lunar).fontSize),height:el.getBoundingClientRect().height,cellHeight:cells[0].getBoundingClientRect().height,cells:cells.length,lunarLines:[...el.querySelectorAll('.ts-calendar-lunar-label')].every(label=>{const parent=label.closest('.ts-calendar-day').getBoundingClientRect(),rect=label.getBoundingClientRect();return rect.left>=parent.left-1&&rect.right<=parent.right+1&&rect.bottom<=parent.bottom+1;})};});
   assert.equal(geometry.overflow,false,JSON.stringify({theme,width,density,geometry}));assert(geometry.lunar>=7&&geometry.lunar<=(density==='compact'?8.5:9.5));assert(geometry.lunar<=geometry.solar*.65);assert(geometry.cells>=28);assert.equal(geometry.lunarLines,true);
   densityMeasurements.push(geometry);calendarLayouts.push({theme,width,density,...geometry});check(`${theme} ${width}px ${density} calendar keeps lunar labels subordinate, visible and within date cells`);
   if(width===280)await page.locator('#root').screenshot({path:`${out}/${theme}-${width}-calendar-${density}.png`});
  }
  assert(densityMeasurements[1].cellHeight<densityMeasurements[0].cellHeight);assert(densityMeasurements[1].height<densityMeasurements[0].height);
 }
 await page.evaluate(()=>window.qaCalendarTimer.density('comfortable'));
 await page.getByRole('tab',{name:'计时',exact:true}).click();assert.equal(await timer.isVisible(),true);assert.equal(await page.locator('.ts-calendar').isVisible(),false);assert.equal(await page.getByRole('tab',{name:'计时',exact:true}).getAttribute('aria-selected'),'true');check('timer replaces the month area in the same calendar view');
 assert.equal(await timer.locator('button[aria-label="展开完整计时器"]').count(),0);assert.equal(await timer.locator('h3:visible').count(),0);assert.equal(await page.evaluate(()=>window.qaCalendarTimer.subscriptions()),1);check('full controls have no expansion entry or duplicate heading and use one controller subscription');
 for(const theme of ['light','dark'])for(const width of [230,280,420]){
  await page.evaluate(({theme,width})=>{document.body.className='theme-'+theme;document.getElementById('root').style.width=width+'px';},{theme,width});
  for(const mode of ['stopwatch','countdown','pomodoro']){
   await page.evaluate(mode=>window.qaCalendarTimer.controller.selectMode(mode),mode);await ready();
   const geometry=await timer.evaluate(timerLayoutMetrics);layouts.push({theme,width,mode,...geometry});
   assert.equal(geometry.overflow,false,JSON.stringify({theme,width,mode,geometry}));assert.equal(geometry.clockFits,true,JSON.stringify({theme,width,mode,geometry}));assert.equal(geometry.controls,true,JSON.stringify({theme,width,mode,geometry}));assert.equal(geometry.clockClearOfRing,true,JSON.stringify({theme,width,mode,geometry}));assert(geometry.font>=38);assert(geometry.nestedFrames<=1);
   if(mode==='pomodoro')await page.locator('#root').screenshot({path:`${out}/${theme}-${width}-integrated.png`});
  }
  check(`${theme} ${width}px complete timer fits and keeps a generous clock in all three modes without touching its progress ring or nesting frames`);
 }
 // A 760px-tall dock should expose the task heading and some task content without scrolling past an idle timer.
 await page.setViewportSize({width:600,height:760});
 for(const width of [230,280,420]){
  await page.evaluate(width=>{const root=document.getElementById('root');root.style.width=width+'px';root.scrollTop=0;},width);
  const budget=await page.evaluate(()=>{const heading=document.querySelector('.ts-journal-task-label').getBoundingClientRect(),row=document.querySelector('.ts-task-row').getBoundingClientRect();return {height:innerHeight,headingBottom:heading.bottom,firstTaskTop:row.top};});
  assert(budget.headingBottom<=budget.height*.75,JSON.stringify({width,budget}));assert(budget.firstTaskTop<budget.height,JSON.stringify({width,budget}));
 }
 check('idle timer leaves at least a quarter of a normal dock for the task heading and exposes task content at 230/280/420px');
 for(const theme of ['light','dark'])for(const width of [230,280,420]){
  await page.evaluate(({theme,width})=>{document.body.className='theme-'+theme;document.body.style.fontSize='22px';document.body.style.setProperty('--font-text-size','22px');document.body.style.setProperty('--font-ui-medium','20px');const root=document.getElementById('root');root.style.width=width+'px';root.style.zoom='1.25';root.scrollTop=0;},{theme,width});
  const geometry=await timer.evaluate(timerLayoutMetrics);layouts.push({theme,width,largeFont:true,zoom:1.25,...geometry});assert.equal(geometry.overflow,false,JSON.stringify({theme,width,geometry}));assert.equal(geometry.clockFits,true);assert.equal(geometry.controls,true);assert.equal(geometry.clockClearOfRing,true,JSON.stringify({theme,width,geometry}));check(`${theme} ${width}px enlarged body text and 125% UI zoom retain timer controls and clock separation`);
 }
 await page.evaluate(()=>{document.body.className='theme-light';document.body.style.fontSize='';document.body.style.removeProperty('--font-text-size');document.body.style.removeProperty('--font-ui-medium');const root=document.getElementById('root');root.style.width='280px';root.style.zoom='';root.scrollTop=0;});await page.setViewportSize({width:600,height:900});
 await button('倒计时').click();await ready();await button('倒计时 45 分钟').click();await ready();assert.equal((await state()).state.session.durationMs,45*60000);check('embedded countdown presets update the shared controller');
 await timer.getByRole('spinbutton',{name:'倒计时分钟数'}).fill('37');await timer.getByRole('textbox',{name:'本次计时事项'}).fill('保留刷新时的草稿');await timer.getByRole('textbox',{name:'本次计时事项'}).focus();
 await page.evaluate(()=>{window.timerRoot=document.querySelector('.ts-journal-timer-host');window.timerInput=document.activeElement;window.timerInput.setSelectionRange(2,6);});
 const beforeWrites=await page.evaluate(()=>window.qaCalendarTimer.writes());await page.evaluate(async()=>{for(let i=0;i<12;i++)await window.qaCalendarTimer.refresh();});
 assert.equal(await timer.getByRole('spinbutton',{name:'倒计时分钟数'}).inputValue(),'37');assert.equal(await timer.getByRole('textbox',{name:'本次计时事项'}).inputValue(),'保留刷新时的草稿');assert.equal(await page.evaluate(()=>document.querySelector('.ts-journal-timer-host')===window.timerRoot&&document.activeElement===window.timerInput&&window.timerInput.selectionStart===2&&window.timerInput.selectionEnd===6),true);assert.equal(await page.evaluate(()=>window.qaCalendarTimer.subscriptions()),1);assert.equal(await page.evaluate(()=>window.qaCalendarTimer.writes()),beforeWrites);check('twelve journal/task refreshes keep original timer DOM, custom duration, title draft, caret and one subscription without saving');
 for(let i=0;i<20;i++){await page.evaluate(()=>window.qaCalendarTimer.select('calendar'));await page.evaluate(()=>window.qaCalendarTimer.select('timer'));}
 assert.equal(await timer.getByRole('spinbutton',{name:'倒计时分钟数'}).inputValue(),'37');assert.equal(await page.evaluate(()=>window.qaCalendarTimer.subscriptions()),1);assert.equal(await page.evaluate(()=>window.qaCalendarTimer.writes()),beforeWrites);check('twenty calendar/timer switches keep duration, controller state and subscription stable');
 await button('开始计时').click();await ready();assert.equal((await state()).state.session.durationMs,37*60000);assert.equal((await state()).state.session.target.title,'保留刷新时的草稿');await page.evaluate(()=>window.qaCalendarTimer.advance(12000));assert.equal(await timer.locator('.ts-calendar-pomodoro-clock').textContent(),'36:48');check('custom countdown starts in the calendar and advances accurately');
 await button('暂停').click();await ready();await page.evaluate(()=>window.qaCalendarTimer.advance(60000));assert.equal(await timer.locator('.ts-calendar-pomodoro-clock').textContent(),'36:48');await page.evaluate(()=>window.qaCalendarTimer.refresh());assert.equal((await state()).state.session.status,'paused');await button('继续').click();await ready();await page.evaluate(()=>window.qaCalendarTimer.advance(8000));await button('结束并记录').click();await ready();assert.equal((await state()).state.records.at(-1).durationMs,20000);assert.equal(await timer.locator('.ts-calendar-pomodoro-record:visible').count(),1);check('pause, refresh, resume and stop preserve exactly twenty seconds of actual work and show history inline');
 await timer.getByRole('button',{name:'在日历查看记录：保留刷新时的草稿',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-top-pane="calendar"]').getAttribute('aria-selected')==='true');assert.equal(await timer.isVisible(),false);assert.equal(await page.locator('.ts-calendar').isVisible(),true);assert.equal(await page.evaluate(()=>window.qaCalendarTimer.journalOpens()),0);check('record calendar action returns to this same calendar surface without opening a diary leaf');
 await page.getByRole('button',{name:/^开始计时：/}).click();await ready();assert.equal((await state()).state.session.mode,'stopwatch');assert.equal(await timer.isVisible(),true);assert.equal((await state()).state.session.target.path,'QA.md');assert.equal(await page.locator('.ts-journal-task-area').isVisible(),true);check('task timer starts a source-linked stopwatch and opens the same calendar timer with tasks below');
 await timer.getByRole('button',{name:/^打开来源：/}).click();assert.equal(await page.evaluate(()=>window.qaCalendarTimer.opened()),1);check('embedded target action uses the host native source-opening callback');
 await page.evaluate(()=>window.qaCalendarTimer.enableLargeCalendar(true));
 const expectedDay=await page.evaluate(()=>{const date=new Date(window.qaCalendarTimer.state().state.session.startedAt);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;});
 await timer.getByRole('button',{name:'在日历查看当前事项',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.qaCalendarTimer.largeCalendarDays()),[expectedDay]);assert.equal(await timer.isVisible(),true);assert.equal(await page.evaluate(()=>window.qaCalendarTimer.journalOpens()),0);check('current target opens the large calendar on its correct day without another timer or diary leaf');
 await timer.getByRole('button',{name:'在日历查看记录：保留刷新时的草稿',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.qaCalendarTimer.largeCalendarDays()),[expectedDay,expectedDay]);assert.equal(await timer.isVisible(),true);assert.equal(await page.evaluate(()=>window.qaCalendarTimer.journalOpens()),0);check('history opens the large calendar actual-work surface on the record start day without another timer or diary leaf');
 await page.evaluate(()=>window.qaCalendarTimer.advance(3_672_000));assert.equal(await timer.locator('.ts-calendar-pomodoro-clock').textContent(),'01:01:12');
 for(const theme of ['light','dark'])for(const width of [230,280,420]){
  await page.evaluate(({theme,width})=>{document.body.className='theme-'+theme;document.getElementById('root').style.width=width+'px';},{theme,width});
  const geometry=await timer.evaluate(timerLayoutMetrics);layouts.push({theme,width,hours:true,...geometry});assert.equal(geometry.overflow,false);assert.equal(geometry.clockFits,true);assert.equal(geometry.controls,true);assert.equal(geometry.clockClearOfRing,true,JSON.stringify({theme,width,geometry}));assert(geometry.font>=34);check(`${theme} ${width}px HH:MM:SS remains readable and clear of the progress ring`);if(width===230)await page.locator('#root').screenshot({path:`${out}/${theme}-hours-230.png`});
 }
 await button('暂停').click();await ready();const protectedState=await page.evaluate(()=>JSON.stringify(window.qaCalendarTimer.state().state));await page.evaluate(()=>window.qaCalendarTimer.close());assert.equal(await page.evaluate(()=>window.qaCalendarTimer.subscriptions()),0);assert.equal(await page.evaluate(()=>JSON.stringify(window.qaCalendarTimer.state().state)),protectedState);check('closing the calendar unsubscribes its panel without changing the active timer');
 assert.deepEqual(errors,[]);check('no browser runtime errors');writeFileSync(out+'/VERIFY.json',JSON.stringify({passed:true,checks,errors,calendarLayouts,layouts},null,2));console.log(JSON.stringify({passed:true,checks:checks.length,output:out}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
