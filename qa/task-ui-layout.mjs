// Render native-generated synthetic task markup. Interaction coverage lives in
// native-tasks-check.py; this checks CSS layout without exposing vault content.
import {readFileSync,writeFileSync} from 'node:fs';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const folder='qa/large-calendar-output/';
const fixtures=JSON.parse(readFileSync(folder+'task-ui-fixtures.json','utf8'));
const css=readFileSync('styles.css','utf8');
const browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
const checks=[];
try {
 for(const dark of [false,true])for(const width of [280,420])for(const [mode,markup] of Object.entries(fixtures)) {
  const page=await browser.newPage({viewport:{width:width+48,height:1000}});
  await page.setContent(`<!doctype html><html class="${dark?'theme-dark':'theme-light'}"><head><style>
  :root{--font-interface:system-ui;--font-text:Georgia;--font-text-size:16px;--text-normal:${dark?'#e0e5e4':'#253934'};--text-muted:${dark?'#a2adaa':'#65766e'};--text-faint:#81908a;--background-primary:${dark?'#202725':'#ffffff'};--background-secondary:${dark?'#29322e':'#f6f8f7'};--background-modifier-border:${dark?'#3b4842':'#dce3df'};--background-modifier-hover:${dark?'#34433b':'#eef4f0'};--interactive-accent:#4b8471;--text-on-accent:white;--text-error:#cc5d58;--text-warning:#d9a04c;--color-red:#ce616b;--color-green:#52a07e;--color-orange:#bf9344;--color-blue:#6b91bd;}
  *{box-sizing:border-box}body{margin:0;padding:24px;background:var(--background-secondary);color:var(--text-normal);font-family:system-ui}button,input,select{font:inherit;color:inherit}button,select{border:1px solid var(--background-modifier-border);background:var(--background-primary);border-radius:6px;padding:4px;cursor:pointer}input[type=checkbox]{width:15px;height:15px;accent-color:var(--interactive-accent)}button{display:inline-flex;align-items:center;justify-content:center}svg{width:16px;height:16px}summary{cursor:pointer}button:disabled{opacity:.5}h4{margin:0}
  ${css}</style></head><body><main class="ts-calendar-plugin ts-journal" data-calendar-ui="quiet" data-journal-part="calendar" data-accent="forest">${markup}</main></body></html>`);
  await page.evaluate(()=>document.fonts.ready);
  const prefix=`${dark?'dark':'light'}-${width}-${mode}`;
  const measures=await page.evaluate(()=>{
   const root=document.querySelector('main'),grid=document.querySelector('.ts-task-quadrants');
   return {overflow:root.scrollWidth-root.clientWidth,columns:grid?getComputedStyle(grid).gridTemplateColumns.split(' ').length:0,
    titleFont:getComputedStyle(root.querySelector('.ts-task-title,.ts-timeline-title')).fontFamily,
    badRows:[...document.querySelectorAll('.ts-task-row')].filter(el=>el.scrollWidth>el.clientWidth+2).length};
  });
  assert(measures.overflow<=2,`${prefix} horizontal overflow ${measures.overflow}`);
  assert(measures.titleFont.includes('Georgia'),`${prefix} must inherit Obsidian body font`);
  assert.equal(measures.badRows,0,`${prefix} clipped row content`);
  if(mode==='四象限')assert.equal(measures.columns,2,`${prefix} matrix must stay two columns`);
  checks.push(`${prefix}: no overflow${mode==='四象限'?', two columns':''}`);
  await page.locator('main').screenshot({path:folder+`task-ui-${prefix}.png`});await page.close();
 }
 writeFileSync(folder+'TASK-UI-VERIFY.json',JSON.stringify({checks,passed:checks.length,scope:'Native-generated synthetic task markup; layout and themes only.'},null,2));
 console.log(JSON.stringify({passed:checks.length,checks},null,2));
} finally {await browser.close();}
