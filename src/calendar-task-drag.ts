import type {App} from 'obsidian';
import {addDays,CalendarTask,parseDay} from './calendar-model';
import {calendarTasks,unscheduledCalendarTasks} from './calendar-task-adapter';
import type {PlannedTask} from './task-planner-model';

export const CALENDAR_TASK_DRAG_TYPE='application/x-thoughtspace-calendar-task';
const MAX_AGE=120_000;
type Transfer=Pick<DataTransfer,'getData'|'setData'|'types'|'effectAllowed'>;
const sessions=new WeakMap<App,{token:string;created:number;task:CalendarTask}>();

function active(app:App){
 const session=sessions.get(app);if(!session)return;
 const age=Date.now()-session.created;
 if(age<0||age>=MAX_AGE){sessions.delete(app);return;}
 return session;
}

/** Only an opaque token leaves the app. Markdown and note paths remain in memory. */
export function startCalendarTaskDrag(app:App,task:PlannedTask,transfer:Transfer):void {
 sessions.delete(app);
 if(task.checked)throw Error('已完成任务不能拖动安排');
 const date=task.scheduled||task.due||task.day;
 const start=date?parseDay(date):undefined;
 const snapshot=start?calendarTasks([task],start,addDays(start,1))[0]:unscheduledCalendarTasks([task])[0];
 if(!snapshot||!snapshot.sourceSnapshot||!Number.isInteger(snapshot.line)||snapshot.line===undefined||snapshot.line<0)throw Error('任务信息无效，请刷新');
 const token=crypto.randomUUID();
 transfer.setData(CALENDAR_TASK_DRAG_TYPE,token);transfer.effectAllowed='move';
 sessions.set(app,{token,created:Date.now(),task:{...snapshot}});
}

/** Chromium hides payload data until drop; dragover can inspect MIME types only. */
export function canReadCalendarTaskDrag(app:App,transfer:Pick<DataTransfer,'types'>|null|undefined):boolean {
 return !!active(app)&&!!transfer&&Array.from(transfer.types).includes(CALENDAR_TASK_DRAG_TYPE);
}

export function readCalendarTaskDrag(app:App,transfer:Pick<DataTransfer,'types'|'getData'>|null|undefined):CalendarTask|undefined {
 const session=active(app);if(!session||!canReadCalendarTaskDrag(app,transfer)||!transfer)return;
 try{return transfer.getData(CALENDAR_TASK_DRAG_TYPE)===session.token?{...session.task}:undefined;}catch{return;}
}

export function endCalendarTaskDrag(app:App):void {sessions.delete(app);}
