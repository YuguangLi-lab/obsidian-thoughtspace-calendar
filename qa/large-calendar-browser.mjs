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
try {
 await page.goto(`http://127.0.0.1:${port}`);await page.locator('.tsc-month-day').first().waitFor();
 await page.evaluate(()=>{window.view.anchor=new Date(2026,9,1);window.view.selected=new Date(2026,9,1);return window.view.refresh(true);});
 assert.equal(await page.locator('.tsc-month-day').count(),42);checks.push('month 42 cells');
 await page.screenshot({path:'qa/large-calendar-output/month.png'});
 await page.getByRole('button',{name:'产品讨论 · 日历联动',exact:false}).last().click();
 await page.locator('form').waitFor();assert.equal(await page.locator('textarea').inputValue(),'完整备注\n保留原始内容。');checks.push('edit loads complete notes');
 await page.locator('input[type=text]').first().fill('讨论结果');await page.getByRole('button',{name:'保存修改',exact:true}).click();await page.locator('form').waitFor({state:'detached'});checks.push('edit and refresh');
 const save=await page.evaluate(()=>window.requests.filter(r=>r.action==='save').at(-1));assert.equal(save.draft.originalStart,'2026-10-01T02:00:00.000Z');assert.equal(save.draft.revision,'a'.repeat(64));checks.push('update preserves original occurrence');
 await page.getByRole('button',{name:'周',exact:true}).click();await page.locator('.tsc-week-column').first().waitFor();assert.equal(await page.locator('.tsc-week-column').count(),7);checks.push('week 7 columns');
 await page.evaluate(()=>{document.querySelector('.tsc-large-main').scrollTop=480;return window.view.refresh(true);});assert.equal(await page.evaluate(()=>document.querySelector('.tsc-large-main').scrollTop),480);checks.push('refresh preserves week scroll position');
 await page.locator('.tsc-task-chip').click();assert.equal(await page.evaluate(()=>window.openedTask),'t');checks.push('scheduled local task opens original source');
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
 assert.deepEqual(errors,[]);checks.push('no uncaught browser errors');
 writeFileSync('qa/large-calendar-output/VERIFY.json',JSON.stringify({checkedAt:new Date().toISOString(),checks,errors,scope:'Synthetic fixture host only. No real Apple Calendar writes or Obsidian runtime integration.'},null,2));
 console.log(JSON.stringify({checks,errors},null,2));
} finally {await browser.close();server.close();}
