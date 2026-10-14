import {dayTimeline,TimelineItem} from './day-timeline-model';
import {PlannedTask} from './task-planner-model';
import {maskInlineLiterals} from './markdown-literals';
/** Search narrows the display after conflicts are calculated for the complete day. */
export function timelineSelection(tasks:PlannedTask[],day:string,records:TimelineItem[],query='',tag=''){
 const q=query.trim().toLocaleLowerCase();
 const match=(text:string,path:string)=>!q||`${text} ${path}`.toLocaleLowerCase().includes(q);
 const taskMatch=(task:PlannedTask)=>(!tag||task.tags.includes(tag))&&match(task.text,task.path);
 const all=dayTimeline(tasks,day,records);
 return {items:all.items.filter(item=>item.task?taskMatch(item.task):match(item.title,item.path)&&(!tag||(maskInlineLiterals(item.title).match(/#[\p{L}\p{N}_/-]+/gu)||[]).some(value=>value===tag))),untimed:all.untimed.filter(taskMatch)};
}
