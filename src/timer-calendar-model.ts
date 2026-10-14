import type {PomodoroRecord,PomodoroTarget,TimerMode,TimerSegment} from './pomodoro-model';

export interface TimerCalendarItem {
 id:string;title:string;mode:TimerMode;target?:PomodoroTarget;
 segments:TimerSegment[];durationMs:number;totalDurationMs:number;plannedDurationMs?:number;
 estimated:boolean;record:PomodoroRecord;
}
const MAX_RECORDS=200,MAX_SEGMENTS=500,MAX_TIMESTAMP=8_640_000_000_000_000;
const timestamp=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<MAX_TIMESTAMP;
const positive=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0;

function activeSegments(record:PomodoroRecord):{segments:TimerSegment[];estimated:boolean}{
 if(!positive(record.durationMs)||!timestamp(record.startedAt)||!timestamp(record.completedAt)||record.completedAt<=record.startedAt)return {segments:[],estimated:false};
 const hasSegments=Array.isArray(record.segments),estimated=!hasSegments||record.segmentsEstimated===true;
 const raw=hasSegments?record.segments!.slice(-MAX_SEGMENTS):[{start:record.startedAt,end:Math.min(record.completedAt,record.startedAt+record.durationMs)}];
 const sorted=raw.filter(segment=>segment&&timestamp(segment.start)&&timestamp(segment.end)&&segment.end>segment.start)
  .map(segment=>({start:Math.max(record.startedAt,segment.start),end:Math.min(record.completedAt,segment.end)}))
  .filter(segment=>segment.end>segment.start).sort((a,b)=>a.start-b.start||a.end-b.end);
 const merged:TimerSegment[]=[];
 for(const segment of sorted){const previous=merged.at(-1);if(previous&&segment.start<=previous.end)previous.end=Math.max(previous.end,segment.end);else merged.push({...segment});}
 let remaining=record.durationMs;const segments:TimerSegment[]=[];
 for(const segment of merged){if(remaining<=0)break;const duration=Math.min(remaining,segment.end-segment.start);segments.push({start:segment.start,end:segment.start+duration});remaining-=duration;}
 return {segments,estimated};
}

/** Clip active intervals to local civil midnight; pauses and overnight gaps add no work. */
export function timerRecordsOnDay(records:readonly PomodoroRecord[],date:Date):TimerCalendarItem[]{
 if(!Number.isFinite(+date))return [];
 const start=+new Date(date.getFullYear(),date.getMonth(),date.getDate()),end=+new Date(date.getFullYear(),date.getMonth(),date.getDate()+1);
 const result:TimerCalendarItem[]=[],seen=new Set<string>();
 for(const record of records.slice(-MAX_RECORDS).reverse()){
  if(!record||typeof record.id!=='string'||seen.has(record.id))continue;seen.add(record.id);
  const mode=record.mode==='stopwatch'||record.mode==='countdown'?record.mode:'pomodoro';
  if(mode==='pomodoro'&&(record.phase==='short-break'||record.phase==='long-break'))continue;
  const normalized=activeSegments(record),segments=normalized.segments.filter(segment=>segment.start<end&&segment.end>start)
   .map(segment=>({start:Math.max(start,segment.start),end:Math.min(end,segment.end)}));
  if(!segments.length)continue;
  const durationMs=segments.reduce((sum,segment)=>sum+segment.end-segment.start,0),totalDurationMs=normalized.segments.reduce((sum,segment)=>sum+segment.end-segment.start,0);
  const target=record.target,planned=target?.plannedDurationMs;
  const plannedDurationMs=positive(planned)?planned:timestamp(target?.plannedStart)&&timestamp(target?.plannedEnd)&&target.plannedEnd>target.plannedStart?target.plannedEnd-target.plannedStart:undefined;
  result.push({id:record.id,title:target?.title||'自由计时',mode,...(target?{target}:{}),segments,durationMs,totalDurationMs,...(plannedDurationMs?{plannedDurationMs}:{}),estimated:normalized.estimated,record});
 }
 return result.sort((a,b)=>a.segments[0].start-b.segments[0].start||a.id.localeCompare(b.id));
}

export function timerActualMsOnDay(records:readonly PomodoroRecord[],date:Date):number{return timerRecordsOnDay(records,date).reduce((sum,item)=>sum+item.durationMs,0);}
export function timerMinuteLabel(durationMs:number):string{if(!positive(durationMs))return '0';if(durationMs<60_000)return '<1';return String(Math.round(durationMs/6000)/10);}
export function timerModeLabel(mode?:TimerMode):string{return mode==='stopwatch'?'正计时':mode==='countdown'?'倒计时':'番茄专注';}
