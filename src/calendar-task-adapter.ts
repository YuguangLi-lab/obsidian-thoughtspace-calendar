import {CalendarTask,dayKey} from './calendar-model';
import {PlannedTask} from './task-planner-model';
import {timeSlot} from './task-time';
/** Use the same due/scheduled/day matching rule as the existing task panel. No separate vault reads. */
export function calendarTasks(tasks:PlannedTask[],start:Date,end:Date):CalendarTask[]{
 const first=dayKey(start),last=dayKey(end),result:CalendarTask[]=[];
 for(const task of tasks){
  const days=task.scheduled||task.due?[task.scheduled,task.due]:[task.day];
  const slot=timeSlot(task.title);
  for(const date of new Set(days))if(date&&date>=first&&date<last)result.push({
   id:`${task.path}:${task.line}`,text:(slot?.title||task.title).replace(/\s+\^[A-Za-z0-9-]+\s*$/,'').trim(),
   completed:task.checked,date,source:task.path,line:task.line,
   ...(slot?{startMinute:slot.start,...(slot.end!==undefined?{endMinute:slot.end}:{})}:{})
  });
 }
 return result.sort((a,b)=>a.date.localeCompare(b.date)||(a.startMinute??1440)-(b.startMinute??1440)||a.source.localeCompare(b.source)||(a.line??0)-(b.line??0));
}
