export type CalendarMode = 'month' | 'week';
export interface AppleCalendar { id: string; title: string; color: string; editable: boolean; source: string }
export interface CalendarEvent {
  id: string; calendarId: string; title: string; start: string; end: string;
  allDay: boolean; location: string; notes: string; revision: string;
  recurring: boolean; editable: boolean; color: string;
}
export interface EventDraft {
  title: string; start: string; end: string; allDay: boolean; calendarId: string;
  location: string; notes: string; eventId?: string; originalStart?: string; revision?: string;
}
export interface AppleCalendarSettings {
  enabled: boolean; selectedCalendarIds: string[]; defaultCalendarId: string;
}
export const defaultAppleSettings: AppleCalendarSettings = {
  enabled: false, selectedCalendarIds: [], defaultCalendarId: ''
};
export interface CalendarTask {
  /** In-memory index generation; distinguishes identical recurring occurrences. */
  indexRevision?:number;
  id: string; text: string; completed: boolean; date: string;
  startMinute?: number; endMinute?: number; source: string; line?:number;
  /** Exact source row used for optimistic concurrency; never trust a drag payload alone. */
  sourceSnapshot?: string;
  dateRole?: 'scheduled'|'due'|'day'|'unscheduled';
  scheduledDate?: string;
}
export const dayKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export function parseDay(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('日期格式无效');
  const [y,m,d] = value.split('-').map(Number);
  const date = new Date(y,m-1,d);
  if (y < 1970 || y > 2199 || dayKey(date) !== value) throw new Error('日期无效');
  return date;
}
export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(),date.getMonth(),date.getDate()+days);
}
export function weekStart(date: Date): Date {
  return addDays(date, -(date.getDay()+6)%7);
}
export function visibleDays(date: Date, mode: CalendarMode): Date[] {
  const start = mode === 'week' ? weekStart(date) : weekStart(new Date(date.getFullYear(),date.getMonth(),1));
  return Array.from({length:mode === 'week'?7:42},(_,i)=>addDays(start,i));
}
export function movePeriod(date: Date, mode: CalendarMode, direction: number): Date {
  if (mode==='week') return addDays(date, direction*7);
  const first = new Date(date.getFullYear(), date.getMonth()+direction,1);
  const last = new Date(first.getFullYear(),first.getMonth()+1,0).getDate();
  return new Date(first.getFullYear(),first.getMonth(),Math.min(date.getDate(),last));
}
export function eventsOnDay(events: CalendarEvent[], date: Date): CalendarEvent[] {
  const a=date.getTime(), b=addDays(date,1).getTime();
  return events.filter(e=>Date.parse(e.start)<b && Date.parse(e.end)>a)
    .sort((a,b)=>Number(b.allDay)-Number(a.allDay)||Date.parse(a.start)-Date.parse(b.start)||a.title.localeCompare(b.title));
}
export const occurrenceKey = (event: CalendarEvent): string => `${event.calendarId}:${event.id}:${event.start}`;
export function toDateInput(date: Date): string {
  return `${dayKey(date)}T${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
}
// Construct local civil dates; do not parse date-only values as UTC or add 24-hour milliseconds across DST.
export function parseDateInput(value: string, allDay: boolean): Date {
  if (allDay) return parseDay(value);
  const match=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error('请填写正确的日期和时间');
  const date=parseDay(match[1]), hours=Number(match[2]), minutes=Number(match[3]);
  if (hours>23||minutes>59) throw new Error('时间无效');
  date.setHours(hours,minutes,0,0);
  if (date.getHours()!==hours||date.getMinutes()!==minutes) throw new Error('此时间在当地夏令时切换中不存在');
  return date;
}
export function draftFromInputs(input: {
  title:string; start:string; end:string; allDay:boolean; calendarId:string; location:string; notes:string;
}, original?: CalendarEvent): EventDraft {
  const title=input.title.trim();
  if (!title||title.length>500) throw new Error('请填写标题（最多 500 字）');
  if (!input.calendarId) throw new Error('请选择可写入的日历');
  let start=parseDateInput(input.start,input.allDay);
  // The editor presents an inclusive final day; EventKit uses an exclusive end.
  let end=input.allDay ? addDays(parseDateInput(input.end,true),1) : parseDateInput(input.end,false);
  if(original&&original.allDay===input.allDay) {
    const oldStart=new Date(original.start),oldEnd=new Date(original.end);
    if((input.allDay?dayKey(oldStart):toDateInput(oldStart))===input.start) start=oldStart;
    if((input.allDay?dayKey(addDays(oldEnd,-1)):toDateInput(oldEnd))===input.end) end=oldEnd;
  }
  if (end<=start||end.getTime()-start.getTime()>366*86400000) throw new Error('结束时间须晚于开始时间，最长一年');
  if (input.location.length>2000||input.notes.length>100000) throw new Error('地点或备注过长');
  return {...input,title,start:start.toISOString(),end:end.toISOString(),
    ...(original ? {eventId:original.id,originalStart:original.start,revision:original.revision}: {})};
}
export interface TimedSegment { event:CalendarEvent; start:number; end:number; lane:number; lanes:number }
export function timedSegments(events: CalendarEvent[], day: Date): TimedSegment[] {
  const midnight=day.getTime(), tomorrow=addDays(day,1).getTime();
  const minute=(time:number)=> { const d=new Date(time); return d.getHours()*60+d.getMinutes(); };
  const entries=eventsOnDay(events,day).filter(e=>!e.allDay).map(event=>({
    event,start:Date.parse(event.start)<=midnight?0:minute(Date.parse(event.start)),
    end:Date.parse(event.end)>=tomorrow?1440:minute(Date.parse(event.end)),lane:0,lanes:1
  })).sort((a,b)=>a.start-b.start||b.end-a.end);
  const groups:TimedSegment[][]=[];
  let group:TimedSegment[]=[], until=-1;
  for(const entry of entries) {
    if(entry.start>=until) { if(group.length) groups.push(group); group=[]; until=-1; }
    group.push(entry); until=Math.max(until,entry.end);
  }
  if(group.length) groups.push(group);
  for(const group of groups) {
    const ends:number[]=[];
    for(const entry of group) {
      let lane=ends.findIndex(end=>end<=entry.start);
      if(lane===-1) lane=ends.length;
      ends[lane]=entry.end; entry.lane=lane;
    }
    for(const entry of group) entry.lanes=ends.length;
  }
  return entries;
}
