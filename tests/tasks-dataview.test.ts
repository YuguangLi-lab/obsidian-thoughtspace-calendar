import test from 'node:test';
import assert from 'node:assert/strict';
import {changeTask,planTasks,selectTasks} from '../src/task-planner-model';
import {dataviewTaskFields} from '../src/task-dataview';

const parse=(text:string)=>planTasks(text,'Tasks.md','Journal');

test('Dataview square and round fields index recurrence, dates, priority and completed-day filters',()=>{
 for(const [open,close] of [['[',']'],['(',')']]){
  const field=(key:string,value:string)=>`${open}${key}:: ${value}${close}`;
  const source=`- [x] Read #study ${field('repeat','every week when done')} ${field('due','2026-10-12')} ${field('scheduled','2026-10-11')} ${field('completion','2026-10-10')} ${field('priority','high')} ^reading`;
  const task=parse(source)[0];assert.equal(task.recurring,true);assert.equal(task.due,'2026-10-12');assert.equal(task.scheduled,'2026-10-11');assert.equal(task.completedOn,'2026-10-10');assert.equal(task.priority,1);
  assert.equal(selectTasks([task],'2026-10-10','done').length,1);assert.equal(selectTasks([task],'2026-10-11','done').length,0);
  assert.ok(task.title.includes(field('repeat','every week when done')));assert.doesNotMatch(task.title,/due::|scheduled::|completion::|priority::/);
 }
});

test('Dataview recurrence cannot be silently completed through the ordinary checkbox writer',()=>{
 for(const recurrence of ['[repeat:: every day]','(repeat:: every day)']){
  const source=`- [ ] Read ${recurrence} [due:: 2026-10-11]`;
  assert.throws(()=>changeTask(source,parse(source)[0],{checked:true}),/重复任务/);
 }
});

test('finite, empty and invalid Dataview recurrence rules still delegate to Tasks validation',()=>{
 for(const [open,close] of [['[',']'],['(',')']])for(const rule of ['every day until 2026-10-11','','   ','glorp?','every 3 days! invalid?']){
  const source=`- [ ] Read ${open}repeat:: ${rule}${close} ${open}due:: 2026-10-11${close}`;
  const task=parse(source)[0];assert.equal(task.recurring,true,source);
  assert.throws(()=>changeTask(source,task,{checked:true}),/重复任务/,source);
  assert.equal(parse(changeTask(source,task,{scheduled:'2026-10-12'}))[0].recurring,true);
 }
});

test('code, comments, escaped fields, links and wiki-links remain ordinary text',()=>{
 const cases=['`[repeat:: every day] [due:: 2026-10-11]`','``(repeat:: every day) [priority:: highest]``','<!-- [repeat:: every day] -->','%% (repeat:: every day) %%','\\[repeat:: every day]','[repeat:: every day](https://example.com)','[[repeat:: every day]]'];
 for(const example of cases){const task=parse(`- [ ] Explain ${example}`)[0];assert.equal(task.recurring,false,example);assert.equal(task.due,undefined);assert.equal(task.priority,3);assert.deepEqual(dataviewTaskFields(example),[]);}
 const hidden='---\nexample: - [ ] [repeat:: every day]\n---\n```md\n- [ ] (repeat:: every day)\n```';assert.equal(parse(hidden).length,0);
});

test('invalid dates and mismatched brackets do not become usable schedule metadata',()=>{
 const task=parse('- [ ] Read [due:: 2026-02-30] (scheduled:: 2026-13-01) [completion:: 2026-10-11) [repeat:: every day)')[0];
 assert.equal(task.due,undefined);assert.equal(task.scheduled,undefined);assert.equal(task.completedOn,undefined);assert.equal(task.recurring,false);
});

test('rescheduling keeps field position, brackets, spacing, callout, block ID and CRLF',()=>{
 const source='Before\r\n>   1. [ ] Read (repeat:: every day) [ due:: 2026-10-11 ] ( scheduled:: 2026-10-10 ) ^reading\r\nAfter\r\n';
 const output=changeTask(source,parse(source)[0],{due:'2026-10-13',scheduled:'2026-10-12',priority:2});
 assert.equal(output,'Before\r\n>   1. [ ] Read (repeat:: every day) [ due:: 2026-10-13 ] ( scheduled:: 2026-10-12 ) (priority:: medium) ^reading\r\nAfter\r\n');
 assert.doesNotMatch(output,/[📅⏳🔼]/u);assert.equal(parse(output)[0].scheduled,'2026-10-12');
});

test('time scheduling adds missing dates using existing Dataview bracket style',()=>{
 const source='- [ ] Read (repeat:: every day) (due:: 2026-10-11) ^reading';
 const output=changeTask(source,parse(source)[0],{scheduled:'2026-10-12',time:{start:'09:15',end:'10:00'}});
 assert.equal(output,'- [ ] 09:15 - 10:00 Read (repeat:: every day) (due:: 2026-10-11) (scheduled:: 2026-10-12) ^reading');
 assert.equal(parse(output)[0].time,'09:15');
});

test('editing duplicate mixed-format fields leaves one active value and preserves literal examples',()=>{
 const source='- [ ] Read `[due:: 2000-01-01] 📅 2001-01-01` [due:: 2026-10-11] (due:: 2026-10-12) 📅 2026-10-13 [priority:: low] 🔺 ^reading';
 const output=changeTask(source,parse(source)[0],{due:'2026-10-15',priority:1});
 assert.equal(output,'- [ ] Read `[due:: 2000-01-01] 📅 2001-01-01` [due:: 2026-10-15] [priority:: high] ^reading');
 assert.equal(dataviewTaskFields(output).filter(f=>f.key==='due').length,1);assert.equal(parse(output)[0].priority,1);
});

test('clearing dates and priority preserves recurrence and other Dataview metadata',()=>{
 const source='- [ ] Read (repeat:: every day) (due:: 2026-10-11), [scheduled:: 2026-10-12] [priority:: lowest] (start:: 2026-10-10) ^reading';
 const output=changeTask(source,parse(source)[0],{due:'',scheduled:'',priority:3});
 assert.equal(output,'- [ ] Read (repeat:: every day) (start:: 2026-10-10) ^reading');assert.equal(parse(output)[0].recurring,true);
});

test('ordinary Dataview tasks use completion fields and clear them when reopened',()=>{
 const source='- [ ] Read (due:: 2026-10-11) ^reading';
 const done=changeTask(source,parse(source)[0],{checked:true,completedOn:'2026-10-12'});
 assert.equal(done,'- [x] Read (due:: 2026-10-11) (completion:: 2026-10-12) ^reading');
 assert.equal(changeTask(done,parse(done)[0],{checked:false}),source);
});

test('new fields are inserted outside an open comment and content edits retain original format preference',()=>{
 const source='- [ ] Read [due:: 2026-10-11] <!-- example (scheduled:: 2000-01-01)';
 const output=changeTask(source,parse(source)[0],{scheduled:'2026-10-12'});
 assert.equal(output,'- [ ] Read [due:: 2026-10-11] [scheduled:: 2026-10-12] <!-- example (scheduled:: 2000-01-01)');
 const original='- [ ] Read (due:: 2026-10-11) ^reading';
 assert.equal(changeTask(original,parse(original)[0],{content:'Revised',scheduled:'2026-10-12'}),'- [ ] Revised (scheduled:: 2026-10-12) ^reading');
});

test('plain emoji tasks retain the existing metadata syntax',()=>{
 const source='- [ ] Read 🔁 every day 📅 2026-10-11 ^reading';
 assert.equal(changeTask(source,parse(source)[0],{scheduled:'2026-10-12',priority:1}),'- [ ] Read 🔁 every day 📅 2026-10-11 ⏳ 2026-10-12 ⏫ ^reading');
});
