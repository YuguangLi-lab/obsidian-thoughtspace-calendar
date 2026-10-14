import test from 'node:test';
import assert from 'node:assert/strict';
import {PomodoroController} from '../src/pomodoro';
import {defaultPomodoroConfig,type PomodoroState} from '../src/pomodoro-model';

function fixture(raw:unknown=null){
 let now=new Date('2026-10-13T09:00:00+08:00').getTime(),saved=raw,writes=0,finished=0,fail=false;
 let config={...defaultPomodoroConfig,focusMinutes:1,shortBreakMinutes:1,longBreakMinutes:2};
 const controller=new PomodoroController({load:async()=>saved,save:async state=>{if(fail)throw Error('磁盘写入失败');writes++;saved=structuredClone(state);}},()=>config,{now:()=>now,interval:false,onFinished:()=>finished++});
 return {controller,advance:(ms:number)=>now+=ms,saved:()=>saved as PomodoroState,writes:()=>writes,finished:()=>finished,fail:(value:boolean)=>fail=value,config:(value:typeof config)=>config=value};
}
test('ticks change remaining time without disk writes or full state replacement',async()=>{
 const f=fixture();await f.controller.initialize();await f.controller.start();const state=f.controller.snapshot().state;
 for(let i=0;i<10;i++){f.advance(1000);f.controller.tick();}
 assert.equal(f.writes(),1);assert.equal(f.controller.snapshot().remainingMs,50_000);assert.equal(f.controller.snapshot().state,state);f.controller.dispose();
});
test('pause and resume preserve exact remaining time across wall-clock gaps',async()=>{
 const f=fixture();await f.controller.initialize();await f.controller.start();f.advance(12_500);await f.controller.pause();f.advance(3_600_000);assert.equal(f.controller.snapshot().remainingMs,47_500);await f.controller.resume();f.advance(47_500);f.controller.tick();await f.controller.settled();assert.equal(f.finished(),1);assert.equal(f.saved().records.length,1);f.controller.dispose();
});
test('rapid double start writes once and rejects an overlapping operation',async()=>{
 const f=fixture();await f.controller.initialize();const first=f.controller.start();await assert.rejects(f.controller.start(),/保存/);await first;assert.equal(f.writes(),1);f.controller.dispose();
});
test('completion after a long sleep records once and waits for explicit next stage',async()=>{
 const f=fixture();await f.controller.initialize();await f.controller.start();f.advance(8*3_600_000);
 f.controller.tick();f.controller.tick();await f.controller.settled();f.controller.tick();await f.controller.settled();
 assert.equal(f.saved().session.status,'finished');assert.equal(f.finished(),1);assert.equal(f.saved().records.length,1);assert.equal(f.writes(),2);f.controller.dispose();
});
test('reloading an elapsed running focus recovers once without starting a break',async()=>{
 const f=fixture();await f.controller.initialize();await f.controller.start({title:'阅读',path:'notes.md',line:2,source:'- [ ] 阅读'});f.advance(60_000);
 const restored=fixture(f.saved());restored.advance(60_000);await restored.controller.initialize();assert.equal(restored.saved().records.length,1);assert.equal(restored.controller.snapshot().state.session.status,'finished');
 const twice=fixture(restored.saved());await twice.controller.initialize();assert.equal(twice.controller.snapshot().state.records.length,1);f.controller.dispose();restored.controller.dispose();twice.controller.dispose();
});
test('failed transition keeps the saved session and allows a deliberate retry',async()=>{
 const f=fixture();await f.controller.initialize();f.fail(true);await assert.rejects(f.controller.start(),/磁盘/);assert.equal(f.controller.snapshot().state.session.status,'idle');assert.equal(f.controller.snapshot().busy,false);assert.match(f.controller.snapshot().error!,/磁盘/);f.fail(false);await f.controller.start();assert.equal(f.controller.snapshot().state.session.status,'running');assert.equal(f.controller.snapshot().error,undefined);f.controller.dispose();
});
test('failed completion does not duplicate credits when retried',async()=>{
 const f=fixture();await f.controller.initialize();await f.controller.start();f.advance(60_000);f.fail(true);f.controller.tick();await f.controller.settled();assert.equal(f.controller.snapshot().state.records.length,0);assert.equal(f.finished(),0);
 f.fail(false);f.advance(30_000);f.controller.tick();await f.controller.settled();assert.equal(f.saved().records.length,1);assert.equal(f.finished(),1);f.controller.dispose();
});
test('reset and skip never mark an unfinished task complete or credit focus',async()=>{
 const f=fixture();await f.controller.initialize();await f.controller.start({title:'任务',path:'tasks.md',line:3});f.advance(30_000);await f.controller.reset();assert.equal(f.saved().records.length,0);await f.controller.next();assert.equal(f.saved().records.length,0);assert.equal(f.saved().session.status,'idle');assert.equal(f.saved().session.phase,'short-break');f.controller.dispose();
});
test('changing durations applies next round and leaves a running clock unchanged',async()=>{
 const f=fixture();await f.controller.initialize();await f.controller.start();f.config({...defaultPomodoroConfig,focusMinutes:2});await f.controller.configure();assert.equal(f.controller.snapshot().state.session.durationMs,60_000);await f.controller.reset();assert.equal(f.controller.snapshot().state.session.durationMs,120_000);f.controller.dispose();
});
test('unload disposes subscriptions and rejects all subsequent actions',async()=>{
 const f=fixture();await f.controller.initialize();let calls=0;f.controller.subscribe(()=>calls++);await f.controller.start();f.controller.dispose();const count=calls;f.advance(60_000);f.controller.tick();assert.equal(calls,count);await assert.rejects(f.controller.pause(),/关闭/);assert.equal(f.writes(),1);
});
test('unsubscribed pane receives no clock events while another pane stays synced',async()=>{
 const f=fixture();await f.controller.initialize();let a=0,b=0;const dispose=f.controller.subscribe(()=>a++);f.controller.subscribe(()=>b++);dispose();f.controller.tick();assert.equal(a,1);assert.equal(b,2);f.controller.dispose();
});
test('unreadable storage disables new writes and exposes a recoverable error',async()=>{
 let writes=0;const c=new PomodoroController({load:async()=>{throw Error('损坏 JSON');},save:async()=>{writes++;}},()=>defaultPomodoroConfig,{interval:false});await assert.rejects(c.initialize(),/损坏/);await assert.rejects(c.start(),/读取/);assert.equal(writes,0);assert.match(c.snapshot().error!,/损坏/);c.dispose();
});
test('stopwatch display ticks increase elapsed without writes or automatic completion',async()=>{
 const f=fixture();await f.controller.initialize();await f.controller.selectMode('stopwatch');await f.controller.startTimer({title:'自由计时'},'stopwatch');const state=f.controller.snapshot().state,writes=f.writes();
 f.advance(3_600_000);f.controller.tick();await f.controller.settled();assert.equal(f.controller.snapshot().elapsedMs,3_600_000);assert.equal(f.controller.snapshot().state,state);assert.equal(f.writes(),writes);assert.equal(f.finished(),0);
 await f.controller.pause();f.advance(3_600_000);assert.equal(f.controller.snapshot().elapsedMs,3_600_000);await f.controller.resume();f.advance(5000);await f.controller.stop();assert.equal(f.saved().records[0].durationMs,3_605_000);assert.equal(f.saved().records[0].outcome,'stopped');assert.equal(f.saved().cycle,0);f.controller.dispose();
});
test('calendar countdown context and active segments persist without counting paused calendar gaps',async()=>{
 const f=fixture();await f.controller.initialize();const target={title:'会议准备',eventId:'event',calendarId:'work',plannedStart:1_000_000,plannedEnd:1_120_000,plannedDurationMs:120_000};await f.controller.startTimer(target,'countdown',2);
 f.advance(30_000);await f.controller.pause();f.advance(3_600_000);await f.controller.resume();f.advance(90_000);f.controller.tick();await f.controller.settled();
 assert.equal(f.saved().records[0].durationMs,120_000);assert.equal(f.saved().records[0].mode,'countdown');assert.equal(f.saved().records[0].segments?.length,2);assert.deepEqual(f.saved().records[0].target,target);assert.equal(f.finished(),1);f.controller.dispose();
});
test('failed stop and mode changes keep memory unchanged and successful stop is idempotent',async()=>{
 const f=fixture();await f.controller.initialize();await f.controller.startTimer({title:'记录'},'stopwatch');f.advance(5000);const original=f.controller.snapshot().state;f.fail(true);
 await assert.rejects(f.controller.stop(),/磁盘/);assert.equal(f.controller.snapshot().state,original);assert.equal(f.controller.snapshot().state.session.status,'running');assert.equal(f.controller.snapshot().state.records.length,0);
 f.fail(false);await assert.rejects(f.controller.selectMode('countdown',5),/切换模式/);assert.equal(f.controller.snapshot().state,original);await assert.rejects(f.controller.startTimer({title:'另一个'},'stopwatch'),/已有专注任务/);assert.equal(f.controller.snapshot().state,original);
 await f.controller.stop();const writes=f.writes();await f.controller.stop();assert.equal(f.writes(),writes);assert.equal(f.saved().records.length,1);await f.controller.selectMode('countdown',5);assert.equal(f.controller.snapshot().state.session.mode,'countdown');f.controller.dispose();
});
test('custom countdown duration and adjustments use atomic actions and survive failed persistence',async()=>{
 const f=fixture();await f.controller.initialize();await f.controller.selectMode('countdown',5);await f.controller.setDuration(2);await f.controller.startTimer();f.advance(30_000);const original=f.controller.snapshot().state;f.fail(true);
 await assert.rejects(f.controller.adjust(1),/磁盘/);assert.equal(f.controller.snapshot().state,original);assert.equal(f.controller.snapshot().remainingMs,90_000);
 f.fail(false);await f.controller.adjust(1);assert.equal(f.controller.snapshot().remainingMs,150_000);assert.equal(f.controller.snapshot().elapsedMs,30_000);await f.controller.pause();f.advance(3_600_000);await f.controller.adjust(-1);assert.equal(f.controller.snapshot().remainingMs,90_000);assert.equal(f.controller.snapshot().elapsedMs,30_000);await f.controller.stop();assert.equal(f.saved().records[0].durationMs,30_000);f.controller.dispose();
});
test('updating Pomodoro settings does not overwrite a custom idle countdown duration',async()=>{
 const f=fixture();await f.controller.initialize();await f.controller.selectMode('countdown',90);const state=f.controller.snapshot().state,writes=f.writes();f.config({...defaultPomodoroConfig,focusMinutes:2});await f.controller.configure();assert.equal(f.controller.snapshot().state,state);assert.equal(f.writes(),writes);assert.equal(state.session.durationMs,90*60_000);f.controller.dispose();
});
test('shortening a countdown to zero reports completion only after successful persistence',async()=>{
 const f=fixture();await f.controller.initialize();await f.controller.startTimer(undefined,'countdown',1);f.advance(30_000);f.fail(true);await assert.rejects(f.controller.adjust(-1),/磁盘/);assert.equal(f.finished(),0);f.fail(false);await f.controller.adjust(-1);assert.equal(f.finished(),1);assert.equal(f.saved().records[0].outcome,'completed');assert.equal(f.saved().records[0].durationMs,30_000);await f.controller.stop();assert.equal(f.finished(),1);f.controller.dispose();
});
test('legacy estimated segments survive controller recovery persistence and subsequent completion',async()=>{
 const start=new Date('2026-10-13T09:00:00+08:00').getTime(),f=fixture({session:{id:'legacy-paused',phase:'focus',status:'paused',durationMs:60_000,remainingMs:40_000,startedAt:start},cycle:0,records:[]});
 f.advance(60_000);await f.controller.initialize();assert.equal(f.saved().session.segmentsEstimated,true);f.advance(3_600_000);await f.controller.resume();f.advance(40_000);f.controller.tick();await f.controller.settled();assert.equal(f.saved().records[0].segmentsEstimated,true);assert.equal(f.saved().records[0].durationMs,60_000);assert.equal(f.saved().records[0].segments?.length,2);f.controller.dispose();
});
