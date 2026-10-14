// Layout checks use native-rendered synthetic Markdown and the final scoped CSS.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
const qaRequire=createRequire(path.resolve(process.env.QA_DEPENDENCIES||'.','package.json'));
const {chromium}=qaRequire('@playwright/test');
const out='qa/compact-sidebar-output';mkdirSync(out,{recursive:true});
const fixtures=JSON.parse(readFileSync(out+'/sidebar-fixtures.json','utf8')),css=readFileSync('styles.css','utf8');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const checks=[];
try{
 for(const dark of [false,true])for(const width of [230,280,420])for(const [mode,markup] of Object.entries(fixtures)){
  const page=await browser.newPage({viewport:{width:width+48,height:1100}});
  await page.setContent(`<!doctype html><html class="${dark?'theme-dark':'theme-light'}"><head><style>
  :root{--font-interface:system-ui;--font-text:Georgia;--font-text-size:16px;--text-normal:${dark?'#e0e5e4':'#253934'};--text-muted:${dark?'#a2adaa':'#65766e'};--text-faint:#81908a;--background-primary:${dark?'#202725':'#fff'};--background-secondary:${dark?'#29322e':'#f6f8f7'};--background-modifier-border:${dark?'#3b4842':'#dce3df'};--background-modifier-hover:${dark?'#34433b':'#eef4f0'};--interactive-accent:#4b8471;--text-on-accent:white;--text-error:#cc5d58;--color-red:#ce616b;--color-green:#52a07e;--color-orange:#bf9344;--color-blue:#6b91bd;}
  *{box-sizing:border-box}body{margin:0;padding:24px;background:var(--background-secondary);color:var(--text-normal);font-family:system-ui}button,input,select{font:inherit;color:inherit}button,select{border:1px solid var(--background-modifier-border);background:var(--background-primary);border-radius:6px;padding:4px}button{display:inline-flex;align-items:center;justify-content:center}input[type=checkbox]{width:15px;height:15px;accent-color:var(--interactive-accent)}svg{width:16px;height:16px}h4{margin:0}
  ${css}</style></head><body>${markup}</body></html>`);
  await page.evaluate(()=>document.fonts.ready);
  const values=await page.evaluate(()=>{
   const root=document.querySelector('.ts-journal'),rect=root.getBoundingClientRect(),grid=root.querySelector('.ts-calendar-grid'),strip=root.querySelector('.ts-calendar-pomodoro-strip'),head=root.querySelector('.ts-calendar-top'),body=root.querySelector('.ts-journal-body'),h2=body?.querySelector('h2'),summary=root.querySelector('.ts-task-summary');
   const clock=strip?.querySelector('.ts-calendar-pomodoro-strip-clock'),clockRect=clock?.getBoundingClientRect(),stripRect=strip?.getBoundingClientRect();
   const buttons=[...root.querySelectorAll('.ts-journal-top-switch button,.ts-calendar-top button,.ts-calendar-pomodoro-strip button,.ts-journal-header button,.ts-task-summary>button')].filter(b=>!b.hidden&&b.getBoundingClientRect().width>0);
   return {overflow:root.scrollWidth-root.clientWidth,controlsInside:buttons.every(b=>{const r=b.getBoundingClientRect();return r.left>=rect.left-1&&r.right<=rect.right+1}),columns:grid?getComputedStyle(grid).gridTemplateColumns.split(' ').length:0,
    stripHeight:strip?.getBoundingClientRect().height,stripVariant:strip?.dataset.presentation,clockClipped:clock?clock.scrollWidth>clock.clientWidth+1:false,clockInside:clockRect&&stripRect?clockRect.left>=stripRect.left-1&&clockRect.right<=stripRect.right+1&&clockRect.top>=stripRect.top&&clockRect.bottom<=stripRect.bottom:true,clockFontSize:strip?parseFloat(getComputedStyle(strip.querySelector('.ts-calendar-pomodoro-strip-clock')).fontSize):0,primaryHeight:strip?.querySelector('.ts-calendar-pomodoro-strip-primary')?.getBoundingClientRect().height,headerHeight:head?.getBoundingClientRect().height,bodyFont:body?getComputedStyle(body).fontFamily:'',h2FontSize:h2?parseFloat(getComputedStyle(h2).fontSize):0,h2After:h2?getComputedStyle(h2,'::after').content:'none',
    dateOrder:body?[...root.querySelectorAll('.ts-journal-heading h2>span')].map(span=>span.getBoundingClientRect().left):[],datePseudo:body?[...root.querySelectorAll('.ts-journal-heading h2>span')].every(span=>getComputedStyle(span,'::after').content==='none'):true,summaryHeight:summary?.getBoundingClientRect().height,scopeButtonHeight:summary?Math.max(...[...summary.querySelectorAll("button")].map(b=>b.getBoundingClientRect().height)):0,calendarVisible:grid?grid.getBoundingClientRect().width>0:false,quarterColumns:root.querySelector('.ts-task-quadrants')?getComputedStyle(root.querySelector('.ts-task-quadrants')).gridTemplateColumns.split(' ').length:0};
  });
  const name=`${dark?'dark':'light'}-${width}-${mode}`;
  assert(values.overflow<=2,`${name}: overflow ${values.overflow}`);assert(values.controlsInside,`${name}: action escapes panel`);
  if(mode!=='timer')assert(values.stripHeight<=68,`${name}: compact shared strip too tall ${values.stripHeight}`);
  if(mode.startsWith('calendar')){assert.equal(values.columns,8);assert(values.headerHeight<=72,`${name}: calendar navigation too tall ${values.headerHeight}`);assert(values.summaryHeight<=40&&values.scopeButtonHeight<=29,`${name}: scope controls too tall ${values.summaryHeight}/${values.scopeButtonHeight}`);}
  if(mode==='day'){assert(values.bodyFont.includes('Georgia'),`${name}: body font lost`);assert(values.h2FontSize<=21,`${name}: Markdown heading too large ${values.h2FontSize}`);assert.equal(values.h2After,'none');assert(values.dateOrder.every((left,i)=>i===0||left>values.dateOrder[i-1]),`${name}: month/day/unit visual order wrong`);assert(values.datePseudo,`${name}: extra date pseudo content`);}
  if(mode==='timer'){assert(!values.calendarVisible,`${name}: calendar still occupies timer pane`);assert(values.stripHeight>=200&&values.stripHeight<=280,`${name}: timer panel height ${values.stripHeight}`);assert(values.clockFontSize>=42&&values.clockFontSize<=64,`${name}: timer clock size ${values.clockFontSize}`);assert(values.primaryHeight>=36,`${name}: timer primary action too small ${values.primaryHeight}`);assert(!values.clockClipped&&values.clockInside,`${name}: clock text clipped or outside panel`);}
  if(mode==='quadrants')assert.equal(values.quarterColumns,2,`${name}: fixed 2x2 lost`);
  checks.push(name+': bounded controls, shared timer and appropriate panel density');
  await page.locator('.ts-journal').screenshot({path:out+'/'+name+'.png'});
  if(mode==='calendar'){
   await page.locator('.ts-journal').evaluate(root=>root.dataset.calendarDensity='compact');
   const height=await page.locator('.ts-calendar-day').first().evaluate(day=>day.getBoundingClientRect().height);
   assert(height>=36&&height<=38,`${name}: compact day hit area ${height}`);
   checks.push(name+': compact lunar calendar preserves 36px day targets');
  }
  await page.close();
 }
 writeFileSync(out+'/layout-result.json',JSON.stringify({checks:checks.length,passed:checks,errors:[],scope:'Native synthetic diary/calendar markup in Chrome; final generated CSS, 230/280/420px and light/dark.'},null,2)+'\n');
 console.log(JSON.stringify({checks:checks.length,errors:[]}));
}finally{await browser.close();}
