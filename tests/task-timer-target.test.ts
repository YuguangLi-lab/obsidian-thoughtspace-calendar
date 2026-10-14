import test from 'node:test';
import assert from 'node:assert/strict';
import {planTasks} from '../src/task-planner-model';
import {resolveTimerTask,taskTimerTarget} from '../src/task-timer-target';

test('timed task starts with its planned duration and scheduled date while preserving source identity',()=>{
 const [task]=planTasks('- [ ] 09:00 - 10:30 写作 🔁 every day ⏳ 2026-10-13 📅 2026-10-15 ^write','项目/写作.md','Journal');
 const target=taskTimerTarget(task);assert.equal(target.title,'写作');assert.equal(target.plannedDurationMs,90*60_000);
 assert.equal(new Date(target.plannedStart!).getDate(),13);assert.equal(new Date(target.plannedStart!).getHours(),9);assert.equal(new Date(target.plannedEnd!).getHours(),10);
 assert.equal(target.path,task.path);assert.equal(target.line,task.line);assert.equal(target.source,task.source);
});
test('untimed and start-only tasks do not invent a planned duration',()=>{
 const tasks=planTasks('- [ ] 未定时间\n- [ ] 09:00 写作 ⏳ 2026-10-13\n- [ ] 10:00 - 09:00 无效时段','项目.md','Journal');
 assert.equal(taskTimerTarget(tasks[0]).plannedDurationMs,undefined);assert.equal(taskTimerTarget(tasks[0]).plannedStart,undefined);
 assert.equal(taskTimerTarget(tasks[1]).plannedDurationMs,undefined);assert.ok(taskTimerTarget(tasks[1]).plannedStart);
 assert.equal(taskTimerTarget(tasks[2]).plannedDurationMs,undefined);
});
test('duplicate recurring occurrences, completed and stale revisions cannot silently select another task',()=>{
 const tasks=planTasks('- [ ] 同名 🔁 every day ^same\n- [ ] 同名 🔁 every day ^same\n- [x] 完成','项目.md','Journal').map(task=>({...task,indexRevision:7}));
 assert.equal(resolveTimerTask(tasks,tasks[1]),tasks[1]);assert.throws(()=>resolveTimerTask(tasks,{...tasks[1],indexRevision:6}),/已变化/);
 assert.throws(()=>resolveTimerTask(tasks,{...tasks[1],line:4}),/已变化/);assert.throws(()=>resolveTimerTask(tasks,tasks[2]),/已完成/);
});
