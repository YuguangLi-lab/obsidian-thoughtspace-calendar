import test from 'node:test';import assert from 'node:assert/strict';
import {calendarTasks} from '../src/calendar-task-adapter';import {parseDay} from '../src/calendar-model';import {planTasks} from '../src/task-planner-model';
const start=parseDay('2026-10-01'),end=parseDay('2026-11-01');
test('大日历使用现有任务模型，不扫描文件',()=>{const tasks=planTasks('- [ ] 09:00 - 10:00 准备会议 ⏳ 2026-10-02 ^meeting','计划.md','日记');const result=calendarTasks(tasks,start,end);assert.equal(result[0].text,'准备会议');assert.equal(result[0].startMinute,540);assert.equal(result[0].endMinute,600);assert.equal(result[0].source,'计划.md');assert.equal(result[0].line,0);assert.equal(tasks[0].source,'- [ ] 09:00 - 10:00 准备会议 ⏳ 2026-10-02 ^meeting');});
test('任务安排日和截止日各显示一次，同日去重',()=>{const tasks=planTasks('- [ ] A ⏳ 2026-10-02 📅 2026-10-03\n- [ ] B ⏳ 2026-10-04 📅 2026-10-04','计划.md','日记');assert.deepEqual(calendarTasks(tasks,start,end).map(t=>t.date),['2026-10-02','2026-10-03','2026-10-04']);});
test('未设置安排和截止日期时使用日记日期',()=>{const tasks=planTasks('- [ ] 日记中的任务','日记/2026/10/2026-10-02.md','日记');assert.equal(calendarTasks(tasks,start,end)[0].date,'2026-10-02');});
test('无日期的收件箱任务不冒充当天任务',()=>assert.equal(calendarTasks(planTasks('- [ ] 收件箱任务','笔记.md','日记'),start,end).length,0));
test('范围结束排他，完成状态保留',()=>{const tasks=planTasks('- [x] 已完成 📅 2026-10-31\n- [ ] 下个月 📅 2026-11-01','笔记.md','日记');const result=calendarTasks(tasks,start,end);assert.equal(result.length,1);assert.equal(result[0].completed,true);});
test('隐藏代码中的时间不生成任务时间块',()=>{const tasks=planTasks('- [ ] 检查 `09:00` 的代码 📅 2026-10-02','笔记.md','日记');assert.equal(calendarTasks(tasks,start,end)[0].startMinute,undefined);});
