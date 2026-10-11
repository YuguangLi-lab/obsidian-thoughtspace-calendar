import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarTasks,unscheduledCalendarTasks} from '../src/calendar-task-adapter';
import {CalendarEvent,dayKey,parseDateInput,parseDay} from '../src/calendar-model';
import {calendarTaskCanSchedule,eventMoveDraft,eventResizeDraft,resolveCalendarTask,snapCalendarMinute,taskSchedulingChange} from '../src/calendar-scheduling';
import {changeTask,planTasks} from '../src/task-planner-model';
const from=parseDay('2026-10-01'),until=parseDay('2026-11-01');
const mapped=(line:string,path='计划.md')=>{const tasks=planTasks(line,path,'日记');return {tasks,items:calendarTasks(tasks,from,until)};};
const event=(start='2026-10-01T09:00',end='2026-10-01T10:00',extra:Partial<CalendarEvent>={}):CalendarEvent=>({id:'event',calendarId:'calendar',title:'讨论',start:parseDateInput(start,false).toISOString(),end:parseDateInput(end,false).toISOString(),allDay:false,location:'会议室',notes:'原备注\n[[证据]]',revision:'a'.repeat(64),recurring:false,editable:true,color:'#449988',...extra});
function inZone(zone:string,fn:()=>void){const old=process.env.TZ;process.env.TZ=zone;try{fn();}finally{if(old===undefined)delete process.env.TZ;else process.env.TZ=old;}}

test('拖动快照解析到同一任务，保留安排和截止角色',()=>{
 const {tasks,items}=mapped('- [ ] 09:00 - 10:00 准备 ⏳ 2026-10-02 📅 2026-10-03 ^evidence');
 assert.equal(resolveCalendarTask(tasks,items[0]),tasks[0]);
 assert.equal(items[0].dateRole,'scheduled');assert.equal(items[1].dateRole,'due');
 assert.equal(items[1].startMinute,undefined);assert.equal(calendarTaskCanSchedule(items[1]),false);
});
test('同一天安排和截止只产生一个可安排时间块',()=>{
 const {items}=mapped('- [ ] 09:00 A ⏳ 2026-10-02 📅 2026-10-02');
 assert.equal(items.length,1);assert.equal(items[0].dateRole,'scheduled');assert.equal(calendarTaskCanSchedule(items[0]),true);
});
test('单独截止日允许安排工作，不修改截止日期和引用标记',()=>{
 const text='> - [ ] 09:00 - 10:00 准备 📅 2026-10-03 ^meeting\r\n后文';
 const {tasks,items}=mapped(text);const result=changeTask(text,tasks[0],taskSchedulingChange(items[0],'2026-10-02',605));
 assert.match(result,/10:05 - 11:05/);assert.match(result,/📅 2026-10-03/);assert.match(result,/⏳ 2026-10-02 \^meeting\r\n后文$/);assert.ok(result.startsWith('> - [ ]'));
});
test('拖入月日期保留任务原来的时间，包括未写结束时间的任务',()=>{
 const text='- [ ] 09:17 准备 ⏳ 2026-10-02';const {tasks,items}=mapped(text);
 const update=taskSchedulingChange(items[0],'2026-10-04');assert.deepEqual(update,{scheduled:'2026-10-04'});
 assert.match(changeTask(text,tasks[0],update),/09:17 准备 ⏳ 2026-10-04/);
});
test('无日期任务只进入未安排列表，重复索引去重且排除完成和日记任务',()=>{
 const a=planTasks('- [ ] 未安排\n- [x] 已完成\n- [ ] 截止 📅 2026-10-03','事项.md','日记');
 const b=planTasks('- [ ] 日记任务','日记/2026/10/2026-10-02.md','日记');
 const items=unscheduledCalendarTasks([...a,...a,...b]);assert.equal(items.length,1);assert.equal(items[0].date,'');assert.equal(items[0].dateRole,'unscheduled');assert.equal(resolveCalendarTask(a,items[0]),a[0]);
});
test('未安排任务落到时间网格，默认分配半小时',()=>{
 const tasks=planTasks('- [ ] 准备材料','事项.md','日记'),item=unscheduledCalendarTasks(tasks)[0];
 assert.deepEqual(taskSchedulingChange(item,'2026-10-02',543),{scheduled:'2026-10-02',time:{start:'09:03',end:'09:33'}});
});
test('精确时间保持输入分钟，夜间截断到可写入的23:59',()=>{
 const {items}=mapped('- [ ] 09:00 - 10:00 准备 ⏳ 2026-10-02');
 assert.deepEqual(taskSchedulingChange(items[0],'2026-10-02',547,590).time,{start:'09:07',end:'09:50'});
 assert.deepEqual(taskSchedulingChange(items[0],'2026-10-02',1425).time,{start:'23:45',end:'23:59'});
 assert.deepEqual(taskSchedulingChange(items[0],'2026-10-02',1425,1440).time,{start:'23:45',end:'23:59'});
 assert.throws(()=>taskSchedulingChange(items[0],'2026-10-02',540,530),/晚于/);
 assert.throws(()=>taskSchedulingChange(items[0],'2026-10-02',1440),/开始时间/);
 assert.throws(()=>taskSchedulingChange(items[0],'2026-10-02',540.5),/开始时间/);
});
test('日期验证和非有限时间值不能写进任务',()=>{
 const {items}=mapped('- [ ] A ⏳ 2026-10-02');
 assert.throws(()=>taskSchedulingChange(items[0],'2026-02-30',540));
 assert.throws(()=>taskSchedulingChange(items[0],'2026-10-02',NaN));
 assert.throws(()=>taskSchedulingChange(items[0],'2026-10-02',540,Infinity));
 assert.throws(()=>taskSchedulingChange(items[0],'2026-10-02',undefined,600));
 assert.equal(snapCalendarMinute(-100),0);assert.equal(snapCalendarMinute(2000),1440);
});
test('已完成或过期任务快照拒绝重新安排',()=>{
 const {tasks,items}=mapped('- [ ] A ⏳ 2026-10-02');
 assert.throws(()=>resolveCalendarTask(planTasks('- [ ] B ⏳ 2026-10-02','计划.md','日记'),items[0]),/原文已变化/);
 assert.throws(()=>resolveCalendarTask(tasks,{...items[0],sourceSnapshot:undefined}),/原文已变化/);
 assert.throws(()=>resolveCalendarTask(tasks,{...items[0],line:1}),/原文已变化/);
 assert.throws(()=>resolveCalendarTask(tasks,{...items[0],date:'2026-10-03'}),/原文已变化/);
 assert.throws(()=>resolveCalendarTask(tasks,{...items[0],scheduledDate:'2026-10-03'}),/原文已变化/);
 assert.throws(()=>taskSchedulingChange({...items[0],completed:true},'2026-10-04'),/已完成/);
});
test('截止日期镜像拒绝操作，日记任务可创建安排日期',()=>{
 const dual=mapped('- [ ] A ⏳ 2026-10-02 📅 2026-10-03');assert.throws(()=>taskSchedulingChange(dual.items[1],'2026-10-04'),/截止日期/);
 const diary=mapped('- [ ] A','日记/2026/10/2026-10-02.md');assert.equal(diary.items[0].dateRole,'day');
 assert.equal(resolveCalendarTask(diary.tasks,diary.items[0]),diary.tasks[0]);assert.equal(taskSchedulingChange(diary.items[0],'2026-10-04').scheduled,'2026-10-04');
});
test('拖动重复任务仅安排日期，不破坏规则或复制任务',()=>{
 const text='- [ ] 阅读 🔁 every week 📅 2026-10-04 ^repeat';const {tasks,items}=mapped(text);
 const result=changeTask(text,tasks[0],taskSchedulingChange(items[0],'2026-10-03',540));
 assert.match(result,/🔁 every week/);assert.match(result,/📅 2026-10-04/);assert.match(result,/\^repeat$/);assert.equal(result.split('\n').length,1);
});
test('相同原文的下一次重复任务拒绝旧日历操作快照',()=>{
 const source='- [ ] Read 🔁 every day';
 const old={...planTasks(source,'任务.md','日记')[0],indexRevision:1};
 const displayed=unscheduledCalendarTasks([old])[0],next={...old,indexRevision:2};
 assert.equal(displayed.indexRevision,1);
 assert.throws(()=>resolveCalendarTask([next],displayed),/原文已变化/);
 assert.equal(resolveCalendarTask([next],unscheduledCalendarTasks([next])[0]),next);
});
test('任务源在索引验证后再次变化，实际写入仍拒绝',()=>{
 const text='- [ ] 原任务 ⏳ 2026-10-02';const {tasks,items}=mapped(text),current=resolveCalendarTask(tasks,items[0]);
 assert.throws(()=>changeTask(text.replace('原任务','已外部编辑'),current,taskSchedulingChange(items[0],'2026-10-03')),/原文已变化/);
});

test('苹果日程移动保留完整备注、地点和原场次版本',()=>{
 const original=event(undefined,undefined,{recurring:true}),result=eventMoveDraft(original,'2026-10-03',615);
 assert.equal(new Date(result.start).getHours(),10);assert.equal(new Date(result.start).getMinutes(),15);
 assert.equal(Date.parse(result.end)-Date.parse(result.start),3600000);assert.equal(result.notes,original.notes);assert.equal(result.location,original.location);
 assert.equal(result.originalStart,original.start);assert.equal(result.revision,original.revision);assert.equal(result.eventId,original.id);
});
test('日期拖动保留日程秒数和毫秒，时间拖动按刻度吸附',()=>{
 const original=event();original.start=new Date(Date.parse(original.start)+27123).toISOString();original.end=new Date(Date.parse(original.end)+42500).toISOString();
 const result=eventMoveDraft(original,'2026-10-04');assert.equal(new Date(result.start).getSeconds(),27);assert.equal(new Date(result.start).getMilliseconds(),123);
 assert.equal(Date.parse(result.end)-Date.parse(result.start),Date.parse(original.end)-Date.parse(original.start));
 assert.equal(new Date(eventMoveDraft(original,'2026-10-04',540).start).getSeconds(),0);
});
test('跨夏令时全天移动保留自然日跨度',()=>inZone('America/New_York',()=>{
 const original=event('2026-03-07T00:00','2026-03-10T00:00',{allDay:true});
 assert.equal((Date.parse(original.end)-Date.parse(original.start))/3600000,71);
 const result=eventMoveDraft(original,'2026-10-31');assert.equal(dayKey(new Date(result.end)),'2026-11-03');assert.equal((Date.parse(result.end)-Date.parse(result.start))/3600000,73);
}));
test('定时事件跨夏令时移动保留真实时长，不接受不存在的时刻',()=>inZone('America/New_York',()=>{
 const original=event('2026-03-01T01:30','2026-03-01T03:30');const result=eventMoveDraft(original,'2026-03-08');
 assert.equal((Date.parse(result.end)-Date.parse(result.start))/3600000,2);assert.equal(new Date(result.end).getHours(),4);
 assert.throws(()=>eventMoveDraft(original,'2026-03-08',150),/夏令时/);
}));
test('只读日程以及无版本日程不能进行拖动或缩放',()=>{
 assert.throws(()=>eventMoveDraft(event(undefined,undefined,{editable:false}),'2026-10-03'),/只读/);
 assert.throws(()=>eventResizeDraft(event(undefined,undefined,{editable:false}),'2026-10-01',660),/只读/);
 assert.throws(()=>eventMoveDraft(event(undefined,undefined,{revision:''}),'2026-10-03'),/刷新/);
});
test('修改结束时间保留开始和元数据，跨到午夜使用排他结束',()=>{
 const original=event(),result=eventResizeDraft(original,'2026-10-01',1440);
 assert.equal(result.start,original.start);assert.equal(dayKey(new Date(result.end)),'2026-10-02');assert.equal(new Date(result.end).getHours(),0);
 assert.equal(result.notes,original.notes);assert.equal(result.originalStart,original.start);
});
test('缩短到开始之前拒绝，全天事件不隐式转为定时事件',()=>{
 assert.throws(()=>eventResizeDraft(event(),'2026-10-01',510),/晚于/);
 assert.throws(()=>eventResizeDraft(event(undefined,undefined,{allDay:true}),'2026-10-03',660),/全天/);
 assert.throws(()=>eventMoveDraft(event('2026-10-01T00:00','2026-10-02T00:00',{allDay:true}),'2026-10-03',660),/全天/);
});
test('夏令时当日缩放到午夜采用自然日边界',()=>inZone('America/New_York',()=>{
 const result=eventResizeDraft(event('2026-03-08T01:00','2026-03-08T04:00'),'2026-03-08',1440);
 assert.equal(dayKey(new Date(result.end)),'2026-03-09');assert.equal((Date.parse(result.end)-Date.parse(result.start))/3600000,22);
}));
test('夏令时回拨的重复小时内原位拖动和缩放保留原场次',()=>inZone('America/New_York',()=>{
 const original=event();original.start='2026-11-01T06:00:27.123Z';original.end='2026-11-01T06:30:42.456Z';
 const moved=eventMoveDraft(original,'2026-11-01'),resized=eventResizeDraft(original,'2026-11-01',90);
 assert.equal(moved.start,original.start);assert.equal(moved.end,original.end);assert.equal(resized.end,original.end);
}));
