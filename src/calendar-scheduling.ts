import {addDays,CalendarEvent,CalendarTask,dayKey,EventDraft,parseDateInput,parseDay} from './calendar-model';
import {changeTask,PlannedTask} from './task-planner-model';
import {clockLabel} from './task-time';

export type TaskSchedulingChange=Parameters<typeof changeTask>[2];
const stale=()=>new Error('任务原文已变化，请刷新后再操作');

/** Resolve against the current shared index, then let vault.process verify the row again. */
export function resolveCalendarTask(tasks:PlannedTask[],displayed:CalendarTask):PlannedTask {
 if(!Number.isInteger(displayed.line)||(displayed.line??-1)<0||typeof displayed.sourceSnapshot!=='string')throw stale();
 const current=tasks.find(task=>task.path===displayed.source&&task.line===displayed.line);
 if(!current||current.source!==displayed.sourceSnapshot||current.checked!==displayed.completed)throw stale();
 if(current.recurring&&current.indexRevision!==displayed.indexRevision)throw stale();
 const role=displayed.dateRole;
 const expected=role==='scheduled'?current.scheduled:role==='due'?current.due:role==='day'?(!current.scheduled&&!current.due?current.day:undefined):role==='unscheduled'&&!current.scheduled&&!current.due&&!current.day?'':undefined;
 if(expected===undefined||expected!==displayed.date||current.scheduled!==displayed.scheduledDate)throw stale();
 return current;
}

export function calendarTaskCanSchedule(task:CalendarTask):boolean {
 return !task.completed&&typeof task.sourceSnapshot==='string'&&Number.isInteger(task.line)&&(task.line??-1)>=0&&!!task.dateRole&&!(task.dateRole==='due'&&!!task.scheduledDate);
}

/** Public snapping keeps pointer gestures and keyboard scheduling consistent. */
export function snapCalendarMinute(value:number):number {
 if(!Number.isFinite(value))throw Error('时间无效');
 return Math.min(1440,Math.max(0,Math.round(value/15)*15));
}

/** Dragging arranges work; an independent deadline and Markdown block ID are preserved. */
export function taskSchedulingChange(task:CalendarTask,date:string,startMinute?:number,endMinute?:number):TaskSchedulingChange {
 parseDay(date);
 if(!calendarTaskCanSchedule(task))throw Error(task.completed?'已完成任务不能重新安排':task.dateRole==='due'&&task.scheduledDate?'这是截止日期，请拖动任务的安排日期':'请刷新任务后再安排');
 if(startMinute===undefined) {
  if(endMinute!==undefined)throw Error('请先设置开始时间');
  return {scheduled:date};
 }
 // Pointer gestures snap before calling; typed times must retain their exact minute.
 if(!Number.isInteger(startMinute)||startMinute<0||startMinute>1438)throw Error('开始时间须在 00:00 至 23:58 之间');
 const start=startMinute;
 if(endMinute!==undefined&&(!Number.isInteger(endMinute)||endMinute<=start||endMinute>1440))throw Error('结束时间须晚于开始时间，且不超过当天');
 // Preserve a known duration while moving; otherwise allocate a 30-minute block.
 const duration=task.endMinute!==undefined&&task.startMinute!==undefined&&task.endMinute>task.startMinute?task.endMinute-task.startMinute:30;
 const finish=endMinute===undefined?start+duration:endMinute;
 const end=Math.min(1439,finish);
 return {scheduled:date,time:{start:clockLabel(start),end:clockLabel(end)}};
}

function assertEvent(event:CalendarEvent) {
 if(!event.editable)throw Error('这个日程只读，无法调整');
 const start=new Date(event.start),end=new Date(event.end);
 if(!Number.isFinite(+start)||!Number.isFinite(+end)||end<=start)throw Error('日程时间无效');
 if(!event.id||!event.calendarId||!event.revision)throw Error('请刷新日程后再调整');
 return {start,end};
}
function draft(event:CalendarEvent,start:Date,end:Date):EventDraft {
 if(end<=start||+end-+start>366*86400000)throw Error('结束时间须晚于开始时间，最长一年');
 parseDay(dayKey(start));parseDay(dayKey(end));
 return {title:event.title,start:start.toISOString(),end:end.toISOString(),allDay:event.allDay,calendarId:event.calendarId,location:event.location,notes:event.notes,eventId:event.id,originalStart:event.start,revision:event.revision};
}
function localMinute(date:string,minute:number):Date {
 if(minute===1440)return addDays(parseDay(date),1);
 return parseDateInput(`${date}T${clockLabel(minute)}`,false);
}
const civilDayNumber=(date:Date)=>Date.UTC(date.getFullYear(),date.getMonth(),date.getDate())/86400000;

/** Call with detail() results, not event-list summaries, to preserve complete notes. */
export function eventMoveDraft(event:CalendarEvent,date:string,startMinute?:number):EventDraft {
 const original=assertEvent(event),day=parseDay(date);
 // A no-op drop during the repeated DST hour must not choose its first occurrence.
 if(startMinute===undefined&&dayKey(original.start)===date)return draft(event,original.start,original.end);
 if(event.allDay) {
  if(startMinute!==undefined)throw Error('全天日程请拖到日期或全天区域');
  const days=civilDayNumber(original.end)-civilDayNumber(original.start);
  if(days<1||!Number.isInteger(days))throw Error('全天日程时间无效');
  return draft(event,day,addDays(day,days));
 }
 const minute=startMinute===undefined?original.start.getHours()*60+original.start.getMinutes():Math.min(1425,snapCalendarMinute(startMinute));
 const start=localMinute(date,minute);
 if(startMinute===undefined)start.setSeconds(original.start.getSeconds(),original.start.getMilliseconds());
 // Timed events preserve real elapsed duration across a DST boundary.
 return draft(event,start,new Date(+start+(+original.end-+original.start)));
}

/** Resize the end on its displayed day; 1440 means the next local midnight. */
export function eventResizeDraft(event:CalendarEvent,date:string,endMinute:number):EventDraft {
 const {start,end}=assertEvent(event);parseDay(date);
 if(event.allDay)throw Error('全天日程请打开编辑窗口调整日期');
 const snapped=snapCalendarMinute(endMinute);
 if(dayKey(end)===date&&end.getHours()*60+end.getMinutes()===snapped)return draft(event,start,end);
 return draft(event,start,localMinute(date,snapped));
}
