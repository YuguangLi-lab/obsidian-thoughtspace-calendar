import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {timerRecordsOnDay,timerActualMsOnDay,timerMinuteLabel,timerModeLabel} from '../src/timer-calendar-model';
import type {PomodoroRecord,TimerSegment} from '../src/pomodoro-model';
const local=(day:number,hour=0,minute=0)=>+new Date(2026,9,day,hour,minute);
const segment=(day:number,fromHour:number,fromMinute:number,toDay:number,toHour:number,toMinute:number):TimerSegment=>({start:local(day,fromHour,fromMinute),end:local(toDay,toHour,toMinute)});
function record(segments:TimerSegment[],extra:Partial<PomodoroRecord>={}):PomodoroRecord{return {id:'actual-1',mode:'stopwatch',startedAt:segments[0].start,completedAt:segments.at(-1)!.end,durationMs:segments.reduce((sum,item)=>sum+item.end-item.start,0),segments,...extra};}

test('midnight clips only active intervals and excludes paused overnight gaps',()=>{
 const value=record([segment(1,23,40,1,23,50),segment(1,23,55,2,0,10),segment(2,0,45,2,1,0)],{target:{title:'跨日工作',plannedDurationMs:90*60_000}}),before=structuredClone(value);
 const first=timerRecordsOnDay([value],new Date(2026,9,1))[0],second=timerRecordsOnDay([value],new Date(2026,9,2))[0];
 assert.equal(first.durationMs,15*60_000);assert.equal(second.durationMs,25*60_000);assert.equal(first.totalDurationMs,40*60_000);assert.equal(second.plannedDurationMs,90*60_000);assert.equal(first.segments.at(-1)!.end,local(2));assert.equal(second.segments[0].start,local(2));assert.deepEqual(value,before);
});
test('midnight is a half-open boundary and incomplete zero-duration records stay absent',()=>{
 const value=record([segment(1,23,45,2,0,0)]);assert.equal(timerRecordsOnDay([value],new Date(2026,9,1)).length,1);assert.equal(timerRecordsOnDay([value],new Date(2026,9,2)).length,0);
 assert.equal(timerRecordsOnDay([{...value,durationMs:0}],new Date(2026,9,1)).length,0);assert.equal(timerRecordsOnDay([value],new Date(NaN)).length,0);
});
test('overlapping segments merge and corrupt intervals cannot inflate recorded active time',()=>{
 const value=record([segment(1,9,0,1,9,20),segment(1,9,10,1,9,30),segment(1,10,0,1,10,10)],{durationMs:40*60_000});
 value.segments!.push({start:NaN,end:Infinity},{start:-1,end:local(1,9,1)});const result=timerRecordsOnDay([value],new Date(2026,9,1))[0];assert.equal(result.segments.length,2);assert.equal(result.durationMs,40*60_000);
 const capped=timerRecordsOnDay([{...value,durationMs:25*60_000}],new Date(2026,9,1))[0];assert.equal(capped.durationMs,25*60_000);assert.equal(capped.segments.at(-1)!.end,local(1,9,25));
});
test('legacy records estimate bounded active time rather than crediting the whole wall-clock span',()=>{
 const value:PomodoroRecord={id:'legacy',startedAt:local(1,9),completedAt:local(1,10,30),durationMs:25*60_000,target:{title:'旧专注'}};
 const result=timerRecordsOnDay([value],new Date(2026,9,1))[0];assert.equal(result.mode,'pomodoro');assert.equal(result.estimated,true);assert.equal(result.durationMs,25*60_000);assert.equal(result.segments[0].end,local(1,9,25));
 assert.equal(timerRecordsOnDay([{...value,segments:[]}],new Date(2026,9,1)).length,0);
});
test('actual work excludes short and long Pomodoro breaks and preserves stopped work',()=>{
 const base=record([segment(1,9,0,1,9,10)]),values=[{...base,id:'short',mode:'pomodoro' as const,phase:'short-break' as const},{...base,id:'long',mode:'pomodoro' as const,phase:'long-break' as const},{...base,id:'countdown',mode:'countdown' as const,outcome:'stopped' as const}];
 const result=timerRecordsOnDay(values,new Date(2026,9,1));assert.equal(result.length,1);assert.equal(result[0].mode,'countdown');assert.equal(result[0].record.outcome,'stopped');assert.equal(timerActualMsOnDay(values,new Date(2026,9,1)),10*60_000);
});
test('event target plan timestamps and note target identities remain separate from actual segments',()=>{
 const value=record([segment(1,9,15,1,9,45)],{target:{title:'日程',eventId:'meeting',calendarId:'work',plannedStart:local(1,9),plannedEnd:local(1,10),path:'notes.md',line:3,source:'- [ ] 原任务'}}),result=timerRecordsOnDay([value],new Date(2026,9,1))[0];
 assert.equal(result.plannedDurationMs,60*60_000);assert.equal(result.durationMs,30*60_000);assert.deepEqual(result.target,value.target);assert.equal(result.segments[0].start,local(1,9,15));
});
test('history and per-record segments stay bounded and newest duplicate record wins',()=>{
 const base=record([segment(1,9,0,1,9,1)]),values=Array.from({length:250},(_,index)=>({...base,id:`record-${index}`}));assert.equal(timerRecordsOnDay(values,new Date(2026,9,1)).length,200);
 const duplicate=timerRecordsOnDay([base,{...base,target:{title:'最新内容'}}],new Date(2026,9,1));assert.equal(duplicate.length,1);assert.equal(duplicate[0].title,'最新内容');
 const start=local(1,9),segments=Array.from({length:501},(_,index)=>({start:start+index*2000,end:start+index*2000+1000}));const bounded=timerRecordsOnDay([record(segments)],new Date(2026,9,1))[0];assert.equal(bounded.segments.length,500);assert.equal(bounded.durationMs,500_000);
});
test('civil midnight clipping respects a 25-hour daylight-saving day',()=>{
 const script="import {timerActualMsOnDay} from './src/timer-calendar-model.ts';const day=new Date(2026,10,1),end=new Date(2026,10,2);const record={id:'dst',mode:'stopwatch',startedAt:+day,completedAt:+end,durationMs:+end-+day,segments:[{start:+day,end:+end}]};console.log(timerActualMsOnDay([record],day));";
 const output=execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',script],{cwd:process.cwd(),env:{...process.env,TZ:'America/New_York'},encoding:'utf8'});assert.equal(Number(output.trim()),25*60*60_000);
});
test('duration labels keep subminute work honest and show the correct timer mode',()=>{
 assert.equal(timerMinuteLabel(0),'0');assert.equal(timerMinuteLabel(1000),'<1');assert.equal(timerMinuteLabel(60_000),'1');assert.equal(timerMinuteLabel(90_000),'1.5');assert.equal(timerModeLabel('stopwatch'),'正计时');assert.equal(timerModeLabel('countdown'),'倒计时');assert.equal(timerModeLabel(),'番茄专注');
});
test('estimated migrated intervals retain their separated pauses and day clipping',()=>{
 const value=record([segment(1,23,30,1,23,45),segment(2,0,30,2,0,40)],{mode:'pomodoro',segmentsEstimated:true});
 const before=timerRecordsOnDay([value],new Date(2026,9,1))[0],after=timerRecordsOnDay([value],new Date(2026,9,2))[0];
 assert.equal(before.estimated,true);assert.equal(after.estimated,true);assert.equal(before.durationMs,15*60_000);assert.equal(after.durationMs,10*60_000);assert.equal(after.segments[0].start,local(2,0,30));assert.equal(after.totalDurationMs,25*60_000);
 assert.equal(timerRecordsOnDay([{...value,segmentsEstimated:false}],new Date(2026,9,1))[0].estimated,false);
});
