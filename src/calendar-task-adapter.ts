import {CalendarTask,dayKey} from './calendar-model';
import {PlannedTask} from './task-planner-model';
import {timeSlot} from './task-time';
/** Use the same due/scheduled/day matching rule as the existing task panel. No separate vault reads. */
export function calendarTasks(tasks:PlannedTask[],start:Date,end:Date):CalendarTask[]{
 const first=dayKey(start),last=dayKey(end),result:CalendarTask[]=[];
 for(const task of tasks){
  const days=task.scheduled||task.due?[task.scheduled,task.due]:[task.day];
  for(const date of new Set(days))if(date&&date>=first&&date<last) {
   const role=date===task.scheduled?'scheduled':date===task.due?'due':'day';
   result.push(calendarTask(task,date,role));
  }
 }
 return result.sort((a,b)=>a.date.localeCompare(b.date)||(a.startMinute??1440)-(b.startMinute??1440)||a.source.localeCompare(b.source)||(a.line??0)-(b.line??0));
}

function calendarTask(task:PlannedTask,date:string,role:NonNullable<CalendarTask['dateRole']>):CalendarTask {
 const slot=timeSlot(task.title),dueMirror=role==='due'&&!!task.scheduled;
 return {
  id:`${task.path}:${task.line}`,text:(slot?.title||task.title).replace(/\s+\^[A-Za-z0-9-]+\s*$/,'').trim(),
  completed:task.checked,date,source:task.path,line:task.line,sourceSnapshot:task.source,dateRole:role,indexRevision:task.indexRevision,
  ...(task.scheduled?{scheduledDate:task.scheduled}:{}),
  // A separate deadline is a reminder, not another copy of the scheduled time block.
  ...(slot&&!dueMirror?{startMinute:slot.start,...(slot.end!==undefined?{endMinute:slot.end}:{})}:{})
 };
}

/** Unscheduled tasks reuse the existing index; a missing date never means "today". */
export function unscheduledCalendarTasks(tasks:PlannedTask[]):CalendarTask[] {
 const seen=new Set<string>();
 return tasks.filter(task=>!task.checked&&!task.scheduled&&!task.due&&!task.day).flatMap(task=>{
  const item=calendarTask(task,'','unscheduled');if(seen.has(item.id))return [];seen.add(item.id);return [item];
 }).sort((a,b)=>a.source.localeCompare(b.source)||(a.line??0)-(b.line??0));
}
