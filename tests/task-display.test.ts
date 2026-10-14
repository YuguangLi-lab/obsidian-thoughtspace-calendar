import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {planTasks} from '../src/task-planner-model';
import {taskPresentation} from '../src/task-display';
import {timeSlot} from '../src/task-time';
const task=(text:string)=>planTasks('- [ ] '+text,'Tasks.md','Journal')[0];

test('task presentation separates recurring tags and block references without changing source',()=>{
 const row=task('09:00 - 10:00 **阅读文献** #研究 #研究/方法 🔁 every day 📅 2026-10-12 ⏫ ^reading'),before=JSON.stringify(row);
 assert.deepEqual(taskPresentation(Object.freeze(row)),{title:'09:00 - 10:00 **阅读文献**',tags:['#研究','#研究/方法'],recurrence:'every day',blockId:'^reading'});
 assert.equal(JSON.stringify(row),before);assert.equal(timeSlot(taskPresentation(row).title)?.label,'09:00–10:00');
});
test('mixed Dataview metadata becomes presentation badges while custom fields remain Markdown',()=>{
 const row=task('写提纲 (repeat:: every week when done) [due:: 2026-10-12] (scheduled:: 2026-10-11) [priority:: high] (start:: 2026-10-10) [created:: 2026-10-09] [id:: ab12] [dependsOn:: cd34] [project:: Alpha] #写作 ^outline');
 assert.deepEqual(taskPresentation(row),{title:'写提纲 [project:: Alpha]',tags:['#写作'],recurrence:'every week when done',blockId:'^outline'});
});
test('code, Markdown links, Wiki links and URL fragments keep literal metadata and hashtags',()=>{
 const body='保留 ``#code 🔁 every day [repeat:: every week]`` [#label 📅 2026-10-12](https://example.com/a_(b)#anchor) [[笔记#章节|#wiki]] https://example.com/#fragment #实际';
 const result=taskPresentation(task(body));assert.equal(result.title,body.replace(' #实际',''));assert.deepEqual(result.tags,['#实际']);assert.equal(result.recurrence,undefined);
});
test('escaped symbols, numeric hashtags and ordinary hash characters remain body text',()=>{
 const body='C# 与 #123 和 \\#转义，说明 🔁 符号及 📅 图标 #真实-tag';
 const result=taskPresentation(task(body));assert.equal(result.title,body.replace(' #真实-tag',''));assert.deepEqual(result.tags,['#真实-tag']);assert.equal(result.recurrence,undefined);
});
test('recurrence rule boundaries preserve prose that follows separate metadata',()=>{
 const result=taskPresentation(task('计划 🔁 every 2 weeks on Monday, Wednesday when done 📅 2026-10-12 补充说明 #计划'));
 assert.equal(result.title,'计划 补充说明');assert.equal(result.recurrence,'every 2 weeks on Monday, Wednesday when done');assert.deepEqual(result.tags,['#计划']);
});
test('unknown emoji recurrence prose and invalid date examples are not silently removed',()=>{
 const body='说明 🔁 not a supported rule 📅 2026-02-30 #说明';const result=taskPresentation(task(body));
 assert.equal(result.title,body.replace(' #说明',''));assert.equal(result.recurrence,undefined);
});
test('hidden task comments are omitted but literal code whitespace and links remain intact',()=>{
 const result=taskPresentation(task('写作 `a  b` <!-- thoughtspace:quadrant=q2 --> %% 隐藏 #私密 %% [链接](https://example.com/%%literal) #写作'));
 assert.equal(result.title,'写作 `a  b` [链接](https://example.com/%%literal)');assert.deepEqual(result.tags,['#写作']);
});
test('all known Tasks date metadata is presented apart from the title',()=>{
 const result=taskPresentation(task('行动 🛫 2026-10-10 ➕ 2026-10-09 ❌ 2026-10-08 ⏳ 2026-10-11 ✅ 2026-10-12 📅 2026-10-13 🔽 #行动'));
 assert.deepEqual(result,{title:'行动',tags:['#行动']});
});
test('repeated real tags are deduplicated in first appearance order',()=>{
 const result=taskPresentation(task('行动 #甲 #乙 #甲 #甲/子项'));assert.equal(result.title,'行动');assert.deepEqual(result.tags,['#甲','#乙','#甲/子项']);
});
test('reference links and escaped Dataview notation keep their original Markdown',()=>{
 const body='说明 [#链接][ref] \\[repeat:: every day] [repeat:: every day](https://example.com) #说明';
 const result=taskPresentation(task(body));assert.equal(result.title,body.replace(' #说明',''));assert.deepEqual(result.tags,['#说明']);assert.equal(result.recurrence,undefined);
});
test('metadata-only tasks keep a visible title and an unfinished Dataview rule remains identifiable',()=>{
 assert.deepEqual(taskPresentation(task('#工作 🔁 every day')),{title:'未命名任务',tags:['#工作'],recurrence:'every day'});
 assert.deepEqual(taskPresentation(task('[repeat:: ] #工作')),{title:'未命名任务',tags:['#工作'],recurrence:'重复'});
});
test('unknown custom fields, invalid date values and emphasis stay in the display body',()=>{
 const body='**行动** [due:: 2026-02-30] [priority:: urgent] [project:: Alpha] #工作';
 assert.equal(taskPresentation(task(body)).title,body.replace(' #工作',''));
});
test('literal links do not hide genuine comments later in the task',()=>{
 const result=taskPresentation(task('[例子](https://example.com/%%literal) <!-- internal #hidden --> 正文 #真实'));
 assert.equal(result.title,'[例子](https://example.com/%%literal) 正文');assert.deepEqual(result.tags,['#真实']);
});
test('long unfinished labels preserve body and metadata without blocking presentation',()=>{
 const body='[x '.repeat(6667)+'正文',row=task(body+' #真实 🔁 every day 📅 2026-10-12');
 const start=performance.now(),result=taskPresentation(row),elapsed=performance.now()-start;
 assert.equal(result.title,body);assert.deepEqual(result.tags,['#真实']);assert.equal(result.recurrence,'every day');
 // A broad guard against the previously measured 500 ms quadratic scan; not a frame budget.
 assert.ok(elapsed<250,`unfinished Markdown took ${elapsed.toFixed(1)} ms`);
});
test('unmatched brackets before valid nested and escaped links do not corrupt their literals',()=>{
 const body='[未完 [外层 [#内层]](https://example.com/a_(b)) [[笔记#章节|#别名]] [转义\\] #文本](https://example.com/a_\\(b\\)) #真实';
 const result=taskPresentation(task(body));assert.equal(result.title,body.replace(' #真实',''));assert.deepEqual(result.tags,['#真实']);
});
