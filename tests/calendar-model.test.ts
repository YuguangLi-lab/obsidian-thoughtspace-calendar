import assert from 'node:assert/strict';
import {test} from 'node:test';
import {addDays,dayKey,draftFromInputs,eventsOnDay,movePeriod,parseDateInput,parseDay,timedSegments,visibleDays,weekStart,type CalendarEvent} from '../src/calendar-model';
const event=(start:string,end:string,extra:Partial<CalendarEvent>={}):CalendarEvent=>({id:'e',calendarId:'c',title:'测试',start,end,allDay:false,location:'',notes:'',revision:'a'.repeat(64),recurring:false,editable:true,color:'#447c83',...extra});
const input={title:'会议',start:'2026-10-01T09:00',end:'2026-10-01T10:00',allDay:false,calendarId:'c',location:'',notes:''};
test('月视图固定 42 天且从周一开始',()=> { const days=visibleDays(parseDay('2026-10-01'),'month'); assert.equal(days.length,42); assert.equal(days[0].getDay(),1); assert.equal(dayKey(days[0]),'2026-09-28'); assert.equal(dayKey(days[41]),'2026-11-08'); });
test('周视图覆盖跨年一周',()=> { const days=visibleDays(parseDay('2027-01-01'),'week'); assert.equal(days.length,7); assert.equal(dayKey(days[0]),'2026-12-28'); assert.equal(dayKey(days[6]),'2027-01-03'); });
test('周日属于前六天的星期一',()=>assert.equal(dayKey(weekStart(parseDay('2026-10-04'))),'2026-09-28'));
test('闰年一月末切换二月不跳到三月',()=>assert.equal(dayKey(movePeriod(parseDay('2028-01-31'),'month',1)),'2028-02-29'));
test('非闰年一月末切换二月',()=>assert.equal(dayKey(movePeriod(parseDay('2027-01-31'),'month',1)),'2027-02-28'));
test('周视图前进不改变星期',()=>assert.equal(dayKey(movePeriod(parseDay('2026-10-01'),'week',1)),'2026-10-08'));
for(const date of ['2026-02-29','2026-13-01','2026-00-01','2026-10-00','2026-10-32','2026-2-1','1969-12-31','2200-01-01']) test(`拒绝无效日期 ${date}`,()=>assert.throws(()=>parseDay(date)));
test('可解析闰日',()=>assert.equal(dayKey(parseDay('2028-02-29')),'2028-02-29'));
test('日期递增遵循当地 DST',()=> {
  const old=process.env.TZ; process.env.TZ='America/New_York';
  try { const day=parseDay('2026-03-08'); const next=addDays(day,1); assert.equal(dayKey(next),'2026-03-09'); assert.equal(next.getHours(),0); assert.equal((+next-+day)/3600000,23); }
  finally { process.env.TZ=old; }
});
test('拒绝不存在的夏令时时间',()=> { const old=process.env.TZ;process.env.TZ='America/New_York'; try { assert.throws(()=>parseDateInput('2026-03-08T02:30',false)); } finally { process.env.TZ=old; } });
test('全天单日采用下一日排他结束时间',()=> { const d=draftFromInputs({...input,allDay:true,start:'2026-10-01',end:'2026-10-01'}); assert.equal(dayKey(new Date(d.end)),'2026-10-02'); assert.equal(new Date(d.start).getHours(),0); });
test('全天跨 DST 按自然日计算',()=> { const old=process.env.TZ;process.env.TZ='America/New_York';try { const d=draftFromInputs({...input,allDay:true,start:'2026-03-08',end:'2026-03-08'}); assert.equal((Date.parse(d.end)-Date.parse(d.start))/3600000,23); } finally { process.env.TZ=old; } });
test('结束时间不晚于开始须拒绝',()=>assert.throws(()=>draftFromInputs({...input,end:input.start})));
test('空标题须拒绝',()=>assert.throws(()=>draftFromInputs({...input,title:'  '})));
test('无可写日历须拒绝',()=>assert.throws(()=>draftFromInputs({...input,calendarId:''})));
test('多行长备注不会截断',()=>assert.equal(draftFromInputs({...input,notes:'证据\n'.repeat(1000)}).notes.length,3000));
test('修改日程保留原场次和版本',()=> { const old=event('2026-10-01T01:00:00.000Z','2026-10-01T02:00:00.000Z',{recurring:true}); const draft=draftFromInputs(input,old); assert.equal(draft.eventId,old.id); assert.equal(draft.originalStart,old.start); assert.equal(draft.revision,old.revision); });
test('当天午夜结束的日程不进入下一日',()=> { const day=parseDay('2026-10-01'); const ev=event(day.toISOString(),addDays(day,1).toISOString()); assert.equal(eventsOnDay([ev],day).length,1); assert.equal(eventsOnDay([ev],addDays(day,1)).length,0); });
test('重叠场次分列，相接日程复用列',()=> { const d=parseDay('2026-10-01'); const at=(h:number,m=0)=>new Date(d.getFullYear(),d.getMonth(),d.getDate(),h,m).toISOString(); const entries=timedSegments([event(at(9),at(11)),event(at(10),at(12),{id:'b'}),event(at(11),at(13),{id:'c'})],d); assert.deepEqual(entries.map(e=>[e.lane,e.lanes]),[[0,2],[1,2],[0,2]]); });
test('独立的时间组不继承拥挤的列数',()=> { const d=parseDay('2026-10-01'); const at=(h:number)=>new Date(d.getFullYear(),d.getMonth(),d.getDate(),h).toISOString(); const entries=timedSegments([event(at(9),at(11)),event(at(10),at(12)),event(at(14),at(15))],d);assert.equal(entries[2].lanes,1); });
test('跨夜日程截到当天边界',()=> { const day=parseDay('2026-10-01'); const previous=addDays(day,-1);previous.setHours(23); const end=new Date(day);end.setHours(1); const segment=timedSegments([event(previous.toISOString(),end.toISOString())],day)[0]; assert.equal(segment.start,0);assert.equal(segment.end,60); });
test('全天日程不占据小时格',()=> { const day=parseDay('2026-10-01');assert.equal(timedSegments([event(day.toISOString(),addDays(day,1).toISOString(),{allDay:true})],day).length,0); });
test('只修改标题保留原日程秒数和毫秒',()=> {
  const old=event(parseDateInput(input.start,false).toISOString().replace('00.000Z','27.123Z'),parseDateInput(input.end,false).toISOString().replace('00.000Z','42.456Z'));
  const draft=draftFromInputs({...input,title:'新标题'},old);assert.equal(draft.start,old.start);assert.equal(draft.end,old.end);
});
