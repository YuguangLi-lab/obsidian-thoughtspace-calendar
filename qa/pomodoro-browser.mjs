import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=createRequire(path.resolve(process.env.QA_DEPENDENCIES||'.','package.json'))('@playwright/test');
const out='qa/pomodoro-output';mkdirSync(out,{recursive:true});
await build({entryPoints:['qa/pomodoro-preview.ts'],bundle:true,format:'esm',outfile:out+'/preview.js',alias:{obsidian:path.resolve('qa/pomodoro-obsidian-stub.ts')},platform:'browser'});
const css=readFileSync('styles.css','utf8')+'\n'+readFileSync('src/pomodoro.css','utf8');
const html=`<!doctype html><html><head><meta charset="utf-8"><style>
:root{--font-interface:system-ui;--font-text:system-ui;--interactive-accent:#376f6c;--background-primary:#fff;--background-secondary:#f5f7f7;--text-normal:#243331;--text-muted:#6b7976;--text-faint:#81908c;--text-on-accent:white;--text-error:#a92d38;--color-green:#36745f;--background-modifier-border:#dce4e1;--background-modifier-hover:#eaf0ec;--text-accent:#376f6c}
body.theme-dark{--background-primary:#202625;--background-secondary:#282e2c;--text-normal:#e2e8e5;--text-muted:#a8b8b1;--text-faint:#8b9b94;--background-modifier-border:#3c4943;--text-on-accent:#fff;--interactive-accent:#9abfaf}
*{box-sizing:border-box}body{margin:0;background:var(--background-secondary)}#root{width:320px;min-height:100vh}button,input{font:inherit;border:1px solid var(--background-modifier-border);border-radius:6px;background:var(--background-primary);color:inherit;padding:7px}button{cursor:pointer}button:focus-visible{outline:2px solid var(--interactive-accent);outline-offset:2px}button:disabled{opacity:.5}
${css}</style></head><body class="theme-light"><div id="root"></div><script type="module" src="/preview.js"></script></body></html>`;
writeFileSync(out+'/index.html',html);
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/preview.js'?'application/javascript':'text/html');res.end(req.url==='/preview.js'?readFileSync(out+'/preview.js'):html);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{}),headless:true});
const page=await browser.newPage({viewport:{width:400,height:1000},timezoneId:'Asia/Shanghai'});const errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
const state=()=>page.evaluate(()=>window.qaPomodoro.state());
const advance=ms=>page.evaluate(ms=>window.qaPomodoro.advance(ms),ms);
const check=(label)=>checks.push(label);
async function mode(value,label){await page.getByRole('button',{name:label,exact:true}).click();await page.waitForFunction(value=>window.qaPomodoro.state().state.session.mode===value,value);}
async function waitIdle(label){await page.getByRole('button',{name:label,exact:true}).waitFor();await page.waitForFunction(()=>!window.qaPomodoro.state().busy);}
try{
 await page.goto(`http://127.0.0.1:${server.address().port}`);await waitIdle('开始专注');
 assert.equal(await page.locator('.ts-calendar-pomodoro-clock').textContent(),'25:00');assert.equal(await page.locator('h3').textContent(),'计时器');check('legacy default Pomodoro25/5/15 remains inside the general timer');
 await page.evaluate(()=>window.qaPomodoro.controller.startFocus({title:'整理研究资料 · 明确下一步',path:'项目/研究.md',line:4,source:'- [ ] 整理研究资料 🔁 every day'}));
 await page.getByRole('button',{name:'暂停',exact:true}).focus();await page.evaluate(()=>{window.clockNode=document.querySelector('.ts-calendar-pomodoro-clock');window.primaryNode=document.activeElement;});
 await advance(10_000);assert.equal(await page.evaluate(()=>document.querySelector('.ts-calendar-pomodoro-clock')===window.clockNode&&document.activeElement===window.primaryNode),true);assert.equal(await page.evaluate(()=>window.qaPomodoro.writes()),1);check('ticks preserve timer DOM keyboardfocus and do not save');
 await page.getByRole('button',{name:'暂停',exact:true}).click();await waitIdle('继续');await advance(3_600_000);assert.equal(await page.locator('.ts-calendar-pomodoro-clock').textContent(),'24:50');check('pause freezes exact remaining duration');
 await page.getByRole('button',{name:'继续',exact:true}).click();await waitIdle('暂停');await advance(24*60_000+50_000);await waitIdle('开始休息');assert.equal((await state()).state.records.length,1);check('focus completion records once and waits for manual break');
 await page.screenshot({path:out+'/focus-completed.png'});
 await page.getByRole('button',{name:'开始休息',exact:true}).click();await waitIdle('暂停');assert.equal((await state()).state.session.phase,'short-break');check('Pomodoro primary starts the next shortbreak');
 await page.evaluate(()=>window.qaPomodoro.controller.startFocus({title:'新的任务',path:'任务.md',line:2}));assert.equal((await state()).state.session.phase,'focus');check('task focus entry always starts focus during rest');
 await page.evaluate(()=>window.qaPomodoro.close());assert.equal(await page.locator('.ts-calendar-pomodoro').count(),0);await advance(20_000);await page.evaluate(()=>window.qaPomodoro.open());await waitIdle('暂停');assert.equal(await page.locator('.ts-calendar-pomodoro-clock').textContent(),'24:40');check('close/reopen keeps plugin clock');
 await page.evaluate(()=>window.qaPomodoro.fail(true));await page.getByRole('button',{name:'暂停',exact:true}).click();await page.getByRole('alert').filter({hasText:'磁盘写入失败'}).waitFor();assert.equal(await page.getByRole('button',{name:'暂停',exact:true}).isEnabled(),true);check('failed save retains running state and releases controls');
 await page.evaluate(()=>{window.qaPomodoro.fail(false);return window.qaPomodoro.controller.pause();});await page.getByRole('alert').waitFor({state:'hidden'});check('successful external retry clears stale error');
 assert.equal(await page.getByRole('button',{name:'重置当前阶段的计时',exact:true}).isVisible(),false);await page.getByRole('button',{name:'结束并记录',exact:true}).click();await waitIdle('开始休息');assert.equal((await state()).state.records.at(-1).outcome,'stopped');assert.equal((await state()).state.records.at(-1).durationMs,20_000);check('active timer ends through explicit record action and stores actual seconds');
 await page.getByRole('button',{name:'重置当前阶段的计时',exact:true}).click();await waitIdle('开始专注');assert.equal(await page.locator('.ts-calendar-pomodoro-clock').textContent(),'25:00');check('idle reset preserves recorded history');

 await page.getByLabel('本次计时事项',{exact:true}).fill('阅读材料');await mode('countdown','倒计时');assert.equal(await page.getByLabel('本次计时事项',{exact:true}).inputValue(),'阅读材料');
 await page.getByRole('button',{name:'倒计时 15 分钟',exact:true}).click();await page.waitForFunction(()=>!window.qaPomodoro.state().busy);assert.equal(await page.getByLabel('本次计时事项',{exact:true}).inputValue(),'阅读材料');assert.equal(await page.locator('.ts-calendar-pomodoro-clock').textContent(),'15:00');check('title draft survives mode and preset changes');
 await page.getByLabel('倒计时分钟数',{exact:true}).fill('0');const beforeWrites=await page.evaluate(()=>window.qaPomodoro.writes());await page.getByRole('button',{name:'开始计时',exact:true}).click();await page.getByRole('alert').filter({hasText:'1–1440'}).waitFor();assert.equal(await page.evaluate(()=>window.qaPomodoro.writes()),beforeWrites);check('invalid countdown duration stays local and never starts');
 await page.getByLabel('倒计时分钟数',{exact:true}).fill('2');await page.getByRole('button',{name:'开始计时',exact:true}).click();await waitIdle('暂停');assert.equal((await state()).state.session.target.title,'阅读材料');assert.equal((await state()).state.session.durationMs,120_000);assert.equal(await page.getByRole('button',{name:'正计时',exact:true}).isDisabled(),true);check('manual countdown starts with drafttitle and protects active mode');
 await advance(10_000);await page.getByRole('button',{name:'+5 分钟',exact:true}).click();await page.waitForFunction(()=>!window.qaPomodoro.state().busy);assert.equal(await page.locator('.ts-calendar-pomodoro-clock').textContent(),'06:50');await page.getByRole('button',{name:'−5 分钟',exact:true}).click();await page.waitForFunction(()=>!window.qaPomodoro.state().busy);assert.equal(await page.locator('.ts-calendar-pomodoro-clock').textContent(),'01:50');check('running countdown +/-5 adjusts remaining time without losing elapsed');
 await page.getByRole('button',{name:'结束并记录',exact:true}).click();await waitIdle('再开始一次');assert.equal((await state()).state.records.at(-1).durationMs,10_000);check('countdown early stop records active10seconds rather than planned2minutes');

 await mode('stopwatch','正计时');await page.getByLabel('本次计时事项',{exact:true}).fill('整理数据');await page.getByRole('button',{name:'开始计时',exact:true}).click();await waitIdle('暂停');await advance(3_620_000);assert.equal(await page.locator('.ts-calendar-pomodoro-clock').textContent(),'01:00:20');assert.equal((await state()).state.session.status,'running');check('stopwatch counts upwards beyond an hour without auto completion');
 await page.getByRole('button',{name:'暂停',exact:true}).click();await waitIdle('继续');const elapsed=(await state()).elapsedMs;await advance(300_000);assert.equal((await state()).elapsedMs,elapsed);await page.getByRole('button',{name:'继续',exact:true}).click();await waitIdle('暂停');await advance(40_000);await page.getByRole('button',{name:'结束并记录',exact:true}).click();await waitIdle('再开始一次');assert.equal((await state()).state.records.at(-1).durationMs,3_660_000);check('stopwatch actual duration excludes paused5minutes');
 await page.locator('.ts-calendar-pomodoro-record-calendar').first().click();assert.equal(await page.evaluate(()=>window.qaPomodoro.calendarDays().length),1);assert.match(await page.evaluate(()=>window.qaPomodoro.calendarDays()[0]),/^\d{4}-\d{2}-\d{2}$/);check('recentrecord calendar callback uses a real dateday');

 await page.evaluate(()=>{const now=window.qaPomodoro.now();return window.qaPomodoro.controller.startTimer({title:'文献讨论准备',eventId:'qa-event',calendarId:'qa-calendar',plannedStart:now,plannedEnd:now+45*60_000,plannedDurationMs:45*60_000},'countdown',45);});await waitIdle('暂停');
 assert.equal(await page.locator('.ts-calendar-pomodoro-target-plan').isVisible(),true);assert.equal(await page.getByRole('button',{name:'打开来源：文献讨论准备',exact:true}).isVisible(),false);await page.getByRole('button',{name:'在日历查看当前事项',exact:true}).click();assert.equal(await page.evaluate(()=>window.qaPomodoro.calendarDays().length),2);check('source-less event retains plan and exposes calendar without fake note');
 await advance(120_000);await page.getByRole('button',{name:'结束并记录',exact:true}).click();await waitIdle('再开始一次');assert.equal((await state()).state.records.at(-1).target.eventId,'qa-event');assert.match(await page.locator('.ts-calendar-pomodoro-record-plan').first().textContent(),/计划 45 分钟 \/ 实际 2 分钟/);check('linkedhistory preserves eventidentity and compares planned45actual2minutes');
 await page.getByLabel('本次计时事项',{exact:true}).fill('准备第二轮讨论');await page.getByRole('button',{name:'再开始一次',exact:true}).click();await waitIdle('暂停');assert.equal((await state()).state.session.target.eventId,'qa-event');assert.equal((await state()).state.session.target.title,'准备第二轮讨论');check('editable title preserves linkedtarget metadata');await advance(1_000);await page.getByRole('button',{name:'结束并记录',exact:true}).click();await waitIdle('再开始一次');

 const recordsBeforeZero=(await state()).state.records.length;await mode('stopwatch','正计时');await page.getByRole('button',{name:'开始计时',exact:true}).click();await waitIdle('暂停');await page.getByRole('button',{name:'结束并记录',exact:true}).click();await waitIdle('再开始一次');assert.equal((await state()).state.records.length,recordsBeforeZero);check('immediatezero-use stop creates no fakehistory record');

 await page.evaluate(()=>{
  const start=new Date().setHours(0,0,0,0),minute=60_000,now=window.qaPomodoro.now();
  window.qaPomodoro.seedRecords([
   {id:'overnight',mode:'stopwatch',outcome:'stopped',phase:'focus',startedAt:start-10*minute,completedAt:start+10*minute,durationMs:20*minute,segments:[{start:start-10*minute,end:start+10*minute}],target:{title:'跨午夜计划',plannedStart:start-10*minute,plannedEnd:start+10*minute,plannedDurationMs:20*minute}},
   {id:'overnight-legacy',startedAt:start-10*minute,completedAt:start+10*minute,durationMs:20*minute,target:{title:'旧版跨午夜计时'}},
   {id:'pause-gap',mode:'countdown',outcome:'stopped',phase:'focus',startedAt:start-60*minute,completedAt:start+20*minute,durationMs:15*minute,segments:[{start:start-60*minute,end:start-50*minute},{start:start+15*minute,end:start+20*minute}],target:{title:'跨午夜暂停'}},
   {id:'rest-excluded',mode:'pomodoro',outcome:'stopped',phase:'short-break',startedAt:now,completedAt:now+minute,durationMs:minute,segments:[{start:now,end:now+minute}],target:{title:'休息记录不计工作'}},
  ]);
 });
 assert.equal(await page.locator('.ts-calendar-pomodoro-stat strong').first().textContent(),'3');assert.equal(await page.locator('.ts-calendar-pomodoro-stat strong').last().textContent(),'25');
 assert.equal(await page.locator('.ts-calendar-pomodoro-record').filter({hasText:'休息记录不计工作'}).count(),0);
 assert.match(await page.locator('.ts-calendar-pomodoro-record').filter({hasText:'跨午夜计划'}).locator('.ts-calendar-pomodoro-record-plan').textContent(),/计划 20 分钟 \/ 实际 20 分钟/);
 check('today clips activecrossmidnight10+legacy10+paused5minutes while history retains planned20actual20 and excludes rest');

 for(const theme of ['light','dark'])for(const width of [230,280,360])for(const selectedMode of ['stopwatch','countdown','pomodoro']){
  await page.evaluate(async({theme,width,selectedMode})=>{document.body.className='theme-'+theme;document.getElementById('root').style.width=width+'px';await window.qaPomodoro.controller.selectMode(selectedMode);},{theme,width,selectedMode});
  const layout=await page.evaluate(()=>{const root=document.getElementById('root'),r=root.getBoundingClientRect();return{overflow:root.scrollWidth>r.width+1,radius:getComputedStyle(root).borderRadius,shadow:getComputedStyle(root).boxShadow,buttons:[...root.querySelectorAll('button,input')].filter(el=>el.getBoundingClientRect().width>0).every(el=>{const b=el.getBoundingClientRect();return b.left>=r.left&&b.right<=r.right+1;})};});assert.equal(layout.overflow,false);assert.equal(layout.radius,'0px');assert.equal(layout.shadow,'none');assert.equal(layout.buttons,true);check(`${theme} ${width}px ${selectedMode} controls fit sidebar without dialogshadow`);
  if(width===280)await page.screenshot({path:out+'/'+theme+'-'+selectedMode+'.png'});
  if(width===230||width===360)await page.screenshot({path:out+'/'+theme+'-'+selectedMode+'-'+width+'.png'});
  const compact=await page.evaluate(()=>({hero:document.querySelector('.ts-calendar-pomodoro-timer').getBoundingClientRect().height,lastRecord:[...document.querySelectorAll('.ts-calendar-pomodoro-record')].filter(el=>el.getBoundingClientRect().height>0).at(-1).getBoundingClientRect().bottom}));assert(compact.hero<=126);assert(compact.lastRecord<=780);
 }
 check('all modes use compact120pxhero and show three recentrecords above780px');
 await page.evaluate(async()=>{await window.qaPomodoro.controller.selectMode('stopwatch');await window.qaPomodoro.controller.startTimer(undefined,'stopwatch');});await advance(3_672_000);
 for(const theme of ['light','dark']){
  await page.evaluate(theme=>{document.body.className='theme-'+theme;document.getElementById('root').style.width='230px';},theme);
  const geometry=await page.evaluate(()=>{const clock=document.querySelector('.ts-calendar-pomodoro-clock').getBoundingClientRect(),ring=document.querySelector('.ts-calendar-pomodoro-dial').getBoundingClientRect(),primary=document.querySelector('.ts-calendar-pomodoro-primary').getBoundingClientRect(),stop=document.querySelector('.ts-calendar-pomodoro-stop').getBoundingClientRect();return{clock:clock.right,ring:ring.left,primary:primary.top,stop:stop.top,overflow:document.getElementById('root').scrollWidth>230};});
  assert(geometry.clock+4<=geometry.ring);assert.equal(geometry.primary,geometry.stop);assert.equal(geometry.overflow,false);assert.equal(await page.locator('.ts-calendar-pomodoro-clock').textContent(),'01:01:12');check(`${theme}230px HH:MM:SS stays clear ofring and activeactions share balancedrow`);
  await page.screenshot({path:out+'/'+theme+'-active-230.png'});
 }
 assert.deepEqual(errors,[]);check('no browser runtime errors');
 writeFileSync(out+'/result.json',JSON.stringify({checks:checks.length,passed:checks,errors},null,2)+'\n');console.log(JSON.stringify({checks:checks.length,errors}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
