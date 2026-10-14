import {snapCalendarMinute} from './calendar-scheduling';

/** A civil-day selection never creates a zero-length or next-day draft. */
export function calendarTimeRange(anchor:number,current:number):{start:number;end:number} {
 const from=snapCalendarMinute(anchor),to=snapCalendarMinute(current);
 const start=Math.min(1425,Math.min(from,to));
 const end=Math.min(1439,Math.max(start+15,from,to));
 return {start,end};
}
