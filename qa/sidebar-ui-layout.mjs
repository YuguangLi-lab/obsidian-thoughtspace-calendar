// Screenshots use only native-rendered synthetic diaries from a temporary vault folder.
import {readFileSync,writeFileSync} from 'node:fs';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const folder='qa/large-calendar-output/';
const fixtures=JSON.parse(readFileSync(folder+'sidebar-ui-fixtures.json','utf8'));
const css=readFileSync('styles.css','utf8');
const browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
const checks=[];
try {
 for(const dark of [false,true])for(const width of [280,420])for(const [mode,markup] of Object.entries(fixtures)) {
  const page=await browser.newPage({viewport:{width:width+48,height:1100}});
  await page.setContent(`<!doctype html><html class="${dark?'theme-dark':'theme-light'}"><head><style>
  :root{--font-interface:system-ui;--font-text:Georgia;--font-text-size:16px;--text-normal:${dark?'#e0e5e4':'#253934'};--text-muted:${dark?'#a2adaa':'#65766e'};--text-faint:#81908a;--background-primary:${dark?'#202725':'#ffffff'};--background-secondary:${dark?'#29322e':'#f6f8f7'};--background-modifier-border:${dark?'#3b4842':'#dce3df'};--background-modifier-hover:${dark?'#34433b':'#eef4f0'};--interactive-accent:#4b8471;--text-on-accent:white;--text-error:#cc5d58;--color-red:#ce616b;--color-green:#52a07e;--color-orange:#bf9344;--color-blue:#6b91bd;}
  *{box-sizing:border-box}body{margin:0;padding:24px;background:var(--background-secondary);color:var(--text-normal);font-family:system-ui}button,input,select{font:inherit;color:inherit}button,select{border:1px solid var(--background-modifier-border);background:var(--background-primary);border-radius:6px;padding:4px;cursor:pointer}input[type=checkbox]{width:15px;height:15px;accent-color:var(--interactive-accent)}button{display:inline-flex;align-items:center;justify-content:center}svg{width:16px;height:16px}summary{cursor:pointer}h4{margin:0}
  ${css}</style></head><body>${markup}</body></html>`);
  await page.evaluate(()=>document.fonts.ready);
  const prefix=`${dark?'dark':'light'}-${width}-${mode}`;
  const measures=await page.evaluate(()=>{
   const root=document.querySelector('.ts-journal'),grid=root.querySelector('.ts-calendar-grid'),body=root.querySelector('.ts-journal-body');
   return {overflow:root.scrollWidth-root.clientWidth,columns:grid?getComputedStyle(grid).gridTemplateColumns.split(' ').length:0,
    bodyFont:body?getComputedStyle(body).fontFamily:'',gradient:root.querySelector('.ts-calendar')?getComputedStyle(root.querySelector('.ts-calendar')).backgroundImage:''};
  });
  assert(measures.overflow<=2,`${prefix}: horizontal overflow ${measures.overflow}`);
  if(mode==='calendar'){assert.equal(measures.columns,8,`${prefix}: week number and seven weekdays`);assert(measures.gradient.includes('gradient'),`${prefix}: calendar gradient preserved`);}
  if(mode==='day')assert(measures.bodyFont.includes('Georgia'),`${prefix}: diary inherits Obsidian body font`);
  assert.equal(await page.locator('.ts-calendar-lunar-summary').count(),0,`${prefix}: deleted footer stays absent`);
  checks.push(`${prefix}: no overflow, theme and layout preserved`);
  await page.locator('.ts-journal').screenshot({path:folder+`sidebar-ui-${prefix}.png`});await page.close();
 }
 writeFileSync(folder+'SIDEBAR-UI-VERIFY.json',JSON.stringify({checks,passed:checks.length,scope:'Native-generated synthetic diaries and calendar; CSS layout and theme checks.'},null,2));
 console.log(JSON.stringify({passed:checks.length,checks},null,2));
} finally {await browser.close();}
