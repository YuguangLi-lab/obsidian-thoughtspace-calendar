import type {PlannedTask} from './task-planner-model';
import type {PomodoroTarget} from './pomodoro-model';
import {parseDay} from './calendar-model';
import {timeSlot} from './task-time';
import {taskPresentation} from './task-display';

/** Revalidate the displayed occurrence; a recurring task with the same title is not interchangeable. */
export function resolveTimerTask(tasks:PlannedTask[], displayed:{path:string;line:number;source:string;indexRevision?:number}):PlannedTask {
 const current=tasks.find(task=>task.path===displayed.path&&task.line===displayed.line&&task.source===displayed.source);
 if(!current||displayed.indexRevision!==undefined&&current.indexRevision!==displayed.indexRevision)throw Error('任务已变化，请刷新后重新开始计时');
 if(current.checked)throw Error('已完成任务无需开始计时');
 return current;
}

/** Planned time is a read-only snapshot. Starting a timer never changes Markdown or Tasks recurrence. */
export function taskTimerTarget(task:PlannedTask):PomodoroTarget {
 const slot=timeSlot(task.title),day=task.scheduled||task.due||task.day,display=taskPresentation(task).title;
 const result:PomodoroTarget={title:timeSlot(display)?.title||display||'任务计时',path:task.path,line:task.line,source:task.source};
 if(slot?.end!==undefined)result.plannedDurationMs=(slot.end-slot.start)*60_000;
 if(slot&&day){const start=parseDay(day);start.setMinutes(slot.start);result.plannedStart=start.getTime();if(slot.end!==undefined){const end=parseDay(day);end.setMinutes(slot.end);result.plannedEnd=end.getTime();}}
 return result;
}
