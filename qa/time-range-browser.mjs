// Actual time-range control and built CSS; all task values are synthetic.
// Obsidian Scope routing is covered separately by the native workflow check.
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const requireQA=createRequire(path.resolve(process.env.QA_DEPENDENCIES||'.','package.json'));
const {chromium}=requireQA('@playwright/test');
const folder='qa/large-calendar-output/';mkdirSync(folder,{recursive:true});
const css=readFileSync('styles.css','utf8');
assert(css.includes('.ts-time-range-picker'),'Build styles.css before running this check.');
const bundle=await build({stdin:{contents:`
import {mountTimeRangePicker} from './src/time-range-selection';
const start=document.querySelector('#start'),end=document.querySelector('#end');
const changes=[],saved=[];let acquired=0,released=0;
const picker=mountTimeRangePicker(document.querySelector('.ts-schedule-time-section'),start,end,()=>{acquired++;return ()=>released++;});
const status=document.querySelector('.ts-schedule-status');
const changed=()=>{changes.push([start.value,end.value]);status.textContent=start.value&&end.value?'时间将在保存安排后写回笔记。':'不设时间 · 只安排日期';};
start.addEventListener('input',changed);end.addEventListener('input',changed);
document.querySelector('form').onsubmit=event=>{event.preventDefault();saved.push([start.value,end.value]);};
window.timeRangeFixture={values:()=>({start:start.value,end:end.value,changes:changes.length,saved:saved.length,scope:{acquired,released}}),reset:(from,to)=>{start.disabled=end.disabled=false;start.value=from;end.value=to;picker.refresh();},disabled:()=>{start.disabled=end.disabled=true;picker.refresh();},destroy:()=>picker.destroy()};
`,resolveDir:process.cwd(),sourcefile:'qa-time-range-fixture.ts',loader:'ts'},bundle:true,platform:'browser',format:'iife',write:false});
const browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
const checks=[],layouts=[],errors=[];
function html(dark,width){return `<!doctype html><html class="${dark?'theme-dark':'theme-light'}"><head><meta charset="utf-8"><style>
:root{--font-interface:system-ui;--font-text:system-ui;--font-text-size:16px;--text-normal:${dark?'#e0e5e4':'#253934'};--text-muted:${dark?'#a2adaa':'#65766e'};--text-faint:${dark?'#8c9b94':'#84968c'};--background-primary:${dark?'#202725':'#ffffff'};--background-secondary:${dark?'#29322e':'#f6f8f7'};--background-modifier-border:${dark?'#3b4842':'#dce3df'};--background-modifier-hover:${dark?'#34433b':'#eef4f0'};--interactive-accent:${dark?'#75b39b':'#467f6b'};--text-on-accent:${dark?'#15291f':'white'};--text-error:#cc5d58;--text-warning:#d9a04c;}
*{box-sizing:border-box}body{margin:0;padding:24px;background:var(--background-secondary);color:var(--text-normal);font-family:var(--font-interface)}.modal{position:relative;background:var(--background-primary);border:1px solid var(--background-modifier-border);box-shadow:0 12px 44px color-mix(in srgb,var(--text-normal) 9%,transparent)}.modal-title{font-weight:600}button,input,select{font:inherit;color:inherit}button,select,input{border:1px solid var(--background-modifier-border);background:var(--background-primary);border-radius:6px;padding:7px;min-width:0}button{cursor:pointer}button:disabled{opacity:.45}input[type=date],input[type=time]{font-size:13px;color-scheme:${dark?'dark':'light'}}.mod-cta{background:var(--interactive-accent);color:var(--text-on-accent);border-color:var(--interactive-accent)}button:focus-visible,input:focus-visible{outline:2px solid var(--interactive-accent);outline-offset:2px}
${css}</style></head><body><main class="modal ts-task-schedule-modal ts-calendar-plugin" style="width:${width}px">
<div class="modal-title">安排任务</div><div class="ts-schedule-task-name">把阅读整理成自己的理解</div><div class="ts-schedule-source">日记 / 2026 / 10 / 2026-10-11.md</div>
<form><div class="ts-schedule-fields"><label><span>计划日期</span><input type="date" value="2026-10-11" aria-label="计划日期"></label><label><span>截止日期</span><input type="date" value="2026-10-12" aria-label="截止日期"></label></div>
<div class="ts-schedule-time-section"><div class="ts-schedule-section-heading"><span>具体时间</span></div><div class="ts-schedule-fields"><label><span>开始时间</span><input id="start" type="time" step="60" value="09:07" aria-label="开始时间"></label><label><span>结束时间</span><input id="end" type="time" step="60" value="10:11" aria-label="结束时间"></label></div><div class="ts-schedule-status">时间将在保存安排后写回笔记。</div></div>
<label class="ts-schedule-priority"><span>优先级</span><select aria-label="优先级"><option>普通</option></select></label><div class="ts-schedule-footer"><button type="button">取消</button><button type="submit" class="mod-cta">保存安排</button></div></form></main></body></html>`;}
async function values(page){return page.evaluate(()=>window.timeRangeFixture.values());}
async function reset(page,from='09:07',to='10:11'){await page.evaluate(([from,to])=>window.timeRangeFixture.reset(from,to),[from,to]);}
async function dragTrack(page,from,to,release=true,surface=page){
 const track=surface.locator('.ts-time-range-track');await track.scrollIntoViewIfNeeded();const rect=await track.boundingBox();assert(rect);
 await page.mouse.move(rect.x+rect.width*from/1440,rect.y+2);await page.mouse.down();await page.mouse.move(rect.x+rect.width*to/1440,rect.y+2,{steps:8});if(release)await page.mouse.up();
}
async function dragEnd(page,to){
 const handle=page.locator('.ts-time-range-handle[data-edge=end]');await handle.scrollIntoViewIfNeeded();const grip=await handle.boundingBox(),track=await page.locator('.ts-time-range-track').boundingBox();assert(grip&&track);
 await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();await page.mouse.move(track.x+track.width*to/1440,track.y+15,{steps:8});await page.mouse.up();
}
async function rangeEquals(page,start,end){const actual=await values(page);assert.equal(actual.start,start);assert.equal(actual.end,end);}
try{
 for(const dark of[false,true])for(const width of[280,360,420]){
  const key=`${dark?'dark':'light'}-${width}`,page=await browser.newPage({viewport:{width:width+48,height:950}});page.on('pageerror',error=>errors.push(`${key}: ${error.message}`));
  await page.setContent(html(dark,width));await page.addScriptTag({content:bundle.outputFiles[0].text});await page.evaluate(()=>document.fonts.ready);
  const before=await values(page);await dragTrack(page,548,667,false);await rangeEquals(page,'09:07','10:11');assert.match(await page.locator('.ts-time-range-summary').textContent(),/09:15.*11:00/);assert.equal(await page.locator('.is-selecting').count(),1);checks.push(`${key}: live selection previews without editing native inputs`);
  await page.mouse.up();await rangeEquals(page,'09:15','11:00');assert.equal((await values(page)).changes,before.changes+2);checks.push(`${key}: forward drag commits the snapped range once`);
  await dragTrack(page,690,602);await rangeEquals(page,'10:00','11:30');checks.push(`${key}: reverse drag produces ordered start and end`);
  await reset(page,'09:07','10:11');await dragEnd(page,735);await rangeEquals(page,'09:07','12:15');checks.push(`${key}: end handle extends duration and keeps the precise start`);
  await reset(page);const cancelled=await values(page);await dragTrack(page,840,960,false);await page.keyboard.press('Escape');await page.mouse.up();await rangeEquals(page,'09:07','10:11');assert.equal((await values(page)).changes,cancelled.changes);assert.equal(await page.locator('.is-selecting').count(),0);assert.equal(await page.locator('form').count(),1);checks.push(`${key}: Escape preserves inputs and clears the live selection`);
  await page.locator('#start').fill('09:07');await page.locator('#end').fill('10:11');await rangeEquals(page,'09:07','10:11');assert.match(await page.locator('.ts-time-range-summary').textContent(),/09:07.*10:11.*64/);checks.push(`${key}: hand-entered minute precision is retained`);
  const endHandle=page.locator('.ts-time-range-handle[data-edge=end]');await endHandle.focus();await page.keyboard.press('ArrowRight');await rangeEquals(page,'09:07','10:26');await page.keyboard.press('Shift+ArrowLeft');await rangeEquals(page,'09:07','10:25');checks.push(`${key}: keyboard handles support 15-minute and exact one-minute steps`);
  await page.keyboard.press('End');await rangeEquals(page,'09:07','23:59');checks.push(`${key}: keyboard End is clamped to 23:59`);
  await reset(page);await page.evaluate(()=>window.timeRangeFixture.disabled());await dragTrack(page,840,960);await rangeEquals(page,'09:07','10:11');assert.equal(await page.locator('.is-selecting').count(),0);checks.push(`${key}: disabled native inputs also disable range gestures`);
  const disabled=await values(page);await endHandle.evaluate(handle=>{for(let i=0;i<50;i++)handle.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',shiftKey:true,bubbles:true}));});await rangeEquals(page,'09:07','10:11');assert.equal((await values(page)).changes,disabled.changes);checks.push(`${key}: fifty keyboard steps during disabled saving keep inputs unchanged`);
  await reset(page);await endHandle.focus();const stepped=await values(page);for(let i=0;i<50;i++)await page.keyboard.press('Shift+ArrowRight');await rangeEquals(page,'09:07','11:01');assert.equal((await values(page)).changes,stepped.changes+50);await page.keyboard.press('End');const boundary=await values(page);for(let i=0;i<20;i++)await page.keyboard.press('End');assert.equal((await values(page)).changes,boundary.changes);checks.push(`${key}: fifty precise end edits signal only the changed input; unchanged boundary steps signal none`);
  await reset(page,'09:15','11:00');await page.locator('.modal-title').click();
  const layout=await page.evaluate(()=>{const root=document.querySelector('main'),picker=root.querySelector('.ts-time-range-picker'),track=root.querySelector('.ts-time-range-track');return{overflow:document.documentElement.scrollWidth-innerWidth,rootOverflow:root.scrollWidth-root.clientWidth,pickerOverflow:picker.scrollWidth-picker.clientWidth,trackWidth:track.clientWidth,bodyFont:getComputedStyle(picker).fontFamily,selectedWidth:root.querySelector('.ts-time-range-selection').getBoundingClientRect().width};});
  assert(layout.overflow<=1,`${key}: document overflow ${layout.overflow}`);assert(layout.rootOverflow<=1,`${key}: form overflow ${layout.rootOverflow}`);assert(layout.pickerOverflow<=1,`${key}: picker overflow ${layout.pickerOverflow}`);assert(layout.trackWidth>0&&layout.selectedWidth>0);layouts.push({key,...layout});checks.push(`${key}: no horizontal overflow with readable native fields`);
  if(width===420)await page.locator('main').screenshot({path:folder+`time-range-${dark?'dark':'light'}-420.png`});
  assert.equal((await values(page)).saved,0);checks.push(`${key}: gestures and keyboard never submit the task form`);
  for(const stage of['pointerup','pointermove']){
   const prior=await values(page);await dragTrack(page,840,960,false);await page.locator('.ts-time-range-track').evaluate(el=>el.style.width='0px');
   if(stage==='pointermove')await page.mouse.move(100,300);await page.mouse.up();
   await rangeEquals(page,'09:15','11:00');assert.equal((await values(page)).changes,prior.changes);assert.equal((await values(page)).saved,0);assert.equal(await page.locator('.is-selecting').count(),0);checks.push(`${key}: a collapsed track cancels on ${stage} without committing`);
   await page.locator('.ts-time-range-track').evaluate(el=>el.style.width='');
  }
  await dragTrack(page,840,960,false);await page.locator('.ts-time-range-track').evaluate(track=>{track.dispatchEvent(new PointerEvent('lostpointercapture',{pointerId:1,bubbles:true}));});await page.mouse.up();await rangeEquals(page,'09:15','11:00');assert.equal(await page.locator('.is-selecting').count(),0);checks.push(`${key}: losing pointer capture cancels the range without committing`);
  await page.evaluate(()=>{
   const frame=document.createElement('iframe');frame.id='time-range-host';frame.style.cssText='width:100%;height:450px;border:0';document.body.append(frame);
   const target=frame.contentDocument;target.body.className='ts-calendar-plugin';const style=target.createElement('style');style.textContent=document.querySelector('style').textContent;target.head.append(style);
  });
  const migration=await values(page),oldTrack=await page.locator('.ts-time-range-track').boundingBox();assert(oldTrack);
  await page.mouse.move(oldTrack.x+oldTrack.width*840/1440,oldTrack.y+2);await page.mouse.down();
  await page.evaluate(()=>document.querySelector('#time-range-host').contentDocument.body.append(document.querySelector('.ts-schedule-time-section')));
  const nextSurface=page.frameLocator('#time-range-host'),nextTrack=await nextSurface.locator('.ts-time-range-track').boundingBox();assert(nextTrack);
  await page.mouse.move(nextTrack.x+nextTrack.width*960/1440,nextTrack.y+2);await page.mouse.up();await rangeEquals(page,'09:15','11:00');
  const moved=await values(page);assert.equal(moved.changes,migration.changes);assert.equal(moved.scope.acquired,migration.scope.acquired+1);assert.equal(moved.scope.released,migration.scope.released+1);assert.equal(await nextSurface.locator('.is-selecting').count(),0);checks.push(`${key}: immediate adoption before capture cancels on new-window-only release and releases Escape scope before retry`);
  await dragTrack(page,840,960,true,nextSurface);await rangeEquals(page,'14:00','16:00');checks.push(`${key}: first retry in the adopted window commits and leaves no stale gesture`);
  await page.evaluate(()=>{const frame=document.querySelector('#time-range-host');document.querySelector('form').append(frame.contentDocument.querySelector('.ts-schedule-time-section'));frame.remove();window.timeRangeFixture.reset('09:15','11:00');});
  await dragTrack(page,840,960,false);await page.evaluate(()=>window.timeRangeFixture.destroy());await page.mouse.up();assert.equal(await page.locator('.ts-time-range-picker').count(),0);await rangeEquals(page,'09:15','11:00');checks.push(`${key}: destroying an active control removes listeners without committing`);
  await page.close();
 }
 assert.deepEqual(errors,[]);checks.push('no uncaught browser errors');
 const report={checkedAt:new Date().toISOString(),passed:checks.length,checks,layouts,errors,scope:'Actual time-range-selection.ts and generated styles.css, synthetic form only. Real Playwright mouse and keyboard gestures; no Obsidian runtime or source writes.'};
 writeFileSync(folder+'TIME-RANGE-VERIFY.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:checks.length,layouts,errors},null,2));
}catch(error){writeFileSync(folder+'TIME-RANGE-VERIFY.json',JSON.stringify({checkedAt:new Date().toISOString(),passed:checks.length,checks,layouts,errors,failure:String(error),scope:'Actual control and generated CSS with synthetic form only.'},null,2));throw error;}finally{await browser.close();}
