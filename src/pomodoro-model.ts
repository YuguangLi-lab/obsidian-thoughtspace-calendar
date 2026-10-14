/** 纯计时状态模型：所有时钟由调用方提供，视图刷新不会写入存储。 */
export type PomodoroPhase = 'focus' | 'short-break' | 'long-break';
export type PomodoroStatus = 'idle' | 'running' | 'paused' | 'finished';
export type TimerMode = 'pomodoro' | 'countdown' | 'stopwatch';
export type TimerOutcome = 'completed' | 'stopped';
export interface TimerSegment { start: number; end: number; }
export const MAX_TIMER_SEGMENTS = 500;
export const MAX_TIMER_DURATION_MS = 7 * 24 * 60 * 60_000;
const MINUTE = 60_000;
const MAX_COUNTDOWN = 1440 * MINUTE;
const MAX_RECORDS = 200;
const MAX_CLOCK = Number.MAX_SAFE_INTEGER - MAX_TIMER_DURATION_MS;
let nextId = 0;

export interface PomodoroConfig { focusMinutes: number; shortBreakMinutes: number; longBreakMinutes: number; longBreakEvery: number; }
export const defaultPomodoroConfig: PomodoroConfig = Object.freeze({focusMinutes:25,shortBreakMinutes:5,longBreakMinutes:15,longBreakEvery:4});
export interface PomodoroTarget {
  title: string; path?: string; line?: number; source?: string;
  eventId?: string; calendarId?: string; plannedStart?: number; plannedEnd?: number; plannedDurationMs?: number;
}
export interface PomodoroSession {
  id: string; mode: TimerMode; phase: PomodoroPhase; status: PomodoroStatus;
  durationMs: number; remainingMs: number; deadline?: number; startedAt?: number; target?: PomodoroTarget;
  /** elapsedMs 只包含已关闭活动段；正在进行的活动段由 activeStartedAt 推导。 */
  elapsedMs?: number; segments?: TimerSegment[]; activeStartedAt?: number;
  outcome?: TimerOutcome; segmentsEstimated?: boolean;
}
export interface PomodoroRecord {
  id: string; startedAt: number; completedAt: number; durationMs: number; target?: PomodoroTarget;
  mode?: TimerMode; outcome?: TimerOutcome; phase?: PomodoroPhase; segments?: TimerSegment[]; segmentsEstimated?: boolean;
}
export interface PomodoroState { session: PomodoroSession; cycle: number; records: PomodoroRecord[]; }
export type PomodoroAction =
  | {type:'start';target?:PomodoroTarget} | {type:'focus';target?:PomodoroTarget}
  | {type:'pause'} | {type:'resume'} | {type:'reset'} | {type:'next'} | {type:'stop'}
  | {type:'select-mode';mode:TimerMode;durationMinutes?:number}
  | {type:'duration';minutes:number} | {type:'adjust';minutes:number}
  | {type:'timer';target?:PomodoroTarget;mode?:TimerMode;durationMinutes?:number};

function object(value:unknown):Record<string,unknown>|undefined {
  return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
}
function finite(value:unknown):value is number {return typeof value==='number'&&Number.isFinite(value);}
function bounded(value:unknown,fallback:number,min:number,max:number):number {
  return finite(value)?Math.min(max,Math.max(min,Math.round(value))):fallback;
}
function clock(now:number):number {return finite(now)?Math.min(MAX_CLOCK,Math.max(0,Math.trunc(now))):0;}
function timestamp(value:unknown):number|undefined {return finite(value)&&value>=0&&value<=MAX_CLOCK?Math.trunc(value):undefined;}
function text(value:unknown,max:number):string|undefined {
  if(typeof value!=='string')return undefined;
  return value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max)||undefined;
}
function validMode(value:unknown):value is TimerMode {return value==='pomodoro'||value==='countdown'||value==='stopwatch';}
function mode(value:unknown):TimerMode {return validMode(value)?value:'pomodoro';}
function target(value:unknown):PomodoroTarget|undefined {
  const raw=object(value),title=text(raw?.title,500);if(!raw||!title)return undefined;
  const normalized:PomodoroTarget={title};
  for(const [key,max]of [['path',2048],['source',2000],['eventId',500],['calendarId',500]] as const){const value=text(raw[key],max);if(value)normalized[key]=value;}
  if(finite(raw.line)&&Number.isInteger(raw.line)&&raw.line>=0&&raw.line<=10_000_000)normalized.line=raw.line;
  const start=timestamp(raw.plannedStart),end=timestamp(raw.plannedEnd);
  if(start!==undefined)normalized.plannedStart=start;
  if(end!==undefined&&(start===undefined||end>start))normalized.plannedEnd=end;
  if(finite(raw.plannedDurationMs)&&raw.plannedDurationMs>0)normalized.plannedDurationMs=Math.max(1,Math.min(MAX_TIMER_DURATION_MS,Math.round(raw.plannedDurationMs)));
  return normalized;
}
function sameTarget(a?:PomodoroTarget,b?:PomodoroTarget):boolean {
  return a?.title===b?.title&&a?.path===b?.path&&a?.line===b?.line&&a?.source===b?.source
    &&a?.eventId===b?.eventId&&a?.calendarId===b?.calendarId
    &&a?.plannedStart===b?.plannedStart&&a?.plannedEnd===b?.plannedEnd&&a?.plannedDurationMs===b?.plannedDurationMs;
}
function id(now:number):string {nextId++;return `pomodoro-${clock(now).toString(36)}-${nextId.toString(36)}-${Math.random().toString(36).slice(2,8)}`;}
export function normalizePomodoroConfig(value:unknown):PomodoroConfig {
  const raw=object(value);return {
    focusMinutes:bounded(raw?.focusMinutes,defaultPomodoroConfig.focusMinutes,1,180),
    shortBreakMinutes:bounded(raw?.shortBreakMinutes,defaultPomodoroConfig.shortBreakMinutes,1,60),
    longBreakMinutes:bounded(raw?.longBreakMinutes,defaultPomodoroConfig.longBreakMinutes,1,60),
    longBreakEvery:bounded(raw?.longBreakEvery,defaultPomodoroConfig.longBreakEvery,2,12),
  };
}
function duration(phase:PomodoroPhase,config:PomodoroConfig):number {
  return (phase==='focus'?config.focusMinutes:phase==='short-break'?config.shortBreakMinutes:config.longBreakMinutes)*MINUTE;
}
function countdownDuration(minutes:unknown,fallback:number):number {return bounded(minutes,fallback/MINUTE,1,1440)*MINUTE;}
function freshSession(phase:PomodoroPhase,config:PomodoroConfig,now:number,assigned?:PomodoroTarget,timerMode:TimerMode='pomodoro',durationMs?:number):PomodoroSession {
  const amount=timerMode==='stopwatch'?MAX_TIMER_DURATION_MS:timerMode==='countdown'?countdownDuration((durationMs??duration('focus',config))/MINUTE,duration('focus',config)):duration(phase,config);
  return {id:id(now),mode:timerMode,phase:timerMode==='pomodoro'?phase:'focus',status:'idle',durationMs:amount,
    remainingMs:timerMode==='stopwatch'?0:amount,elapsedMs:0,segments:[],...(assigned?{target:{...assigned}}:{})};
}
export function createPomodoroState(config:PomodoroConfig,now:number):PomodoroState {
  return {session:freshSession('focus',normalizePomodoroConfig(config),now),cycle:0,records:[]};
}
function segmentDuration(segments:TimerSegment[]):number {return segments.reduce((sum,segment)=>sum+Math.max(0,segment.end-segment.start),0);}
function normalizedSegments(value:unknown,min=0,max=MAX_CLOCK,limit=MAX_TIMER_DURATION_MS):TimerSegment[] {
  if(!Array.isArray(value)||limit<=0)return [];
  const intervals:TimerSegment[]=[];
  for(const candidate of value.slice(-MAX_TIMER_SEGMENTS)){
    const raw=object(candidate),start=timestamp(raw?.start),end=timestamp(raw?.end);
    if(start===undefined||end===undefined||end<=start)continue;
    const clipped={start:Math.max(min,start),end:Math.min(max,end)};if(clipped.end>clipped.start)intervals.push(clipped);
  }
  intervals.sort((a,b)=>a.start-b.start||a.end-b.end);
  const merged:TimerSegment[]=[];let active=0;
  for(const interval of intervals){
    const last=merged.at(-1);
    if(last&&interval.start<=last.end){const addition=Math.min(limit-active,Math.max(0,interval.end-last.end));last.end+=addition;active+=addition;}
    else {const amount=Math.min(limit-active,interval.end-interval.start);if(amount<=0)break;merged.push({start:interval.start,end:interval.start+amount});active+=amount;}
    if(active>=limit)break;
  }
  return merged;
}
function normalizedRecords(value:unknown):PomodoroRecord[] {
  if(!Array.isArray(value))return [];
  const seen=new Set<string>(),records:PomodoroRecord[]=[];
  for(const candidate of value.slice(-MAX_RECORDS*2).reverse()){
    const raw=object(candidate);if(!raw)continue;
    const recordId=text(raw.id,160),startedAt=timestamp(raw.startedAt),completedAt=timestamp(raw.completedAt);
    const recordMode=validMode(raw.mode)?raw.mode:undefined;
    const phase:PomodoroPhase|undefined=raw.phase==='focus'||raw.phase==='short-break'||raw.phase==='long-break'?raw.phase:undefined;
    const recordLimit=recordMode==='stopwatch'?MAX_TIMER_DURATION_MS:recordMode==='countdown'?MAX_COUNTDOWN:(phase==='short-break'||phase==='long-break'?60:180)*MINUTE;
    if(!recordId||seen.has(recordId)||startedAt===undefined||completedAt===undefined||completedAt<startedAt
      ||(raw.mode!==undefined&&!recordMode)||!finite(raw.durationMs)
      ||raw.durationMs<(recordMode?1:MINUTE)||raw.durationMs>recordLimit)continue;
    const assigned=target(raw.target),segments=Array.isArray(raw.segments)?normalizedSegments(raw.segments,startedAt,completedAt,recordLimit):undefined;
    const actualDuration=segments?segmentDuration(segments):Math.trunc(raw.durationMs);
    if(actualDuration<=0)continue;
    const outcome:TimerOutcome|undefined=raw.outcome==='completed'||raw.outcome==='stopped'?raw.outcome:undefined;
    seen.add(recordId);records.push({id:recordId,startedAt,completedAt,durationMs:actualDuration,
      ...(assigned?{target:assigned}:{}),...(recordMode?{mode:recordMode}:{}),...(outcome?{outcome}:{}),...(phase?{phase}:{}),...(segments?{segments}:{}),...(raw.segmentsEstimated===true?{segmentsEstimated:true}:{})});
    if(records.length===MAX_RECORDS)break;
  }
  return records.reverse();
}
export function normalizePomodoroState(rawValue:unknown,config:PomodoroConfig,now:number):PomodoroState {
  const normalizedConfig=normalizePomodoroConfig(config),safeNow=clock(now),raw=object(rawValue),candidate=object(raw?.session);
  const records=normalizedRecords(raw?.records),cycle=bounded(raw?.cycle,0,0,1_000_000);
  if(!candidate)return {...createPomodoroState(normalizedConfig,safeNow),records,cycle};
  const timerMode=mode(candidate.mode);
  const phase:PomodoroPhase=timerMode==='pomodoro'&&(candidate.phase==='short-break'||candidate.phase==='long-break')?candidate.phase:'focus';
  const status:PomodoroStatus=candidate.status==='running'||candidate.status==='paused'||candidate.status==='finished'?candidate.status:'idle';
  const durationMs=timerMode==='stopwatch'?MAX_TIMER_DURATION_MS:bounded(candidate.durationMs,duration(phase,normalizedConfig),
    status==='finished'?0:MINUTE,timerMode==='countdown'?MAX_COUNTDOWN:(phase==='focus'?180:60)*MINUTE);
  const assigned=target(candidate.target),startedAt=timestamp(candidate.startedAt);
  const session:PomodoroSession={id:text(candidate.id,160)??id(safeNow),mode:timerMode,phase,status,durationMs,
    remainingMs:timerMode==='stopwatch'?0:bounded(candidate.remainingMs,durationMs,0,durationMs),elapsedMs:0,segments:[],...(assigned?{target:assigned}:{})};
  if(status==='finished'){
    const outcome=candidate.outcome==='completed'||candidate.outcome==='stopped'?candidate.outcome:records.find(record=>record.id===session.id)?.outcome;
    if(outcome)session.outcome=outcome;
  }
  if(status!=='idle'&&startedAt!==undefined)session.startedAt=Math.min(startedAt,safeNow);
  if(status==='idle')session.remainingMs=timerMode==='stopwatch'?0:durationMs;
  if(status==='finished')session.remainingMs=0;
  if(status==='paused'&&timerMode!=='stopwatch'&&session.remainingMs===0){session.status='idle';session.remainingMs=durationMs;delete session.startedAt;}
  const hasSegments=Array.isArray(candidate.segments);
  if(session.status!=='idle'){
    session.segments=normalizedSegments(candidate.segments,session.startedAt??0,safeNow,durationMs);
    if(!hasSegments&&timerMode!=='stopwatch'){
      // 旧版只存剩余时长：恢复已知活动总量，历史暂停位置无法从旧数据还原。
      const elapsed=Math.max(0,durationMs-session.remainingMs);
      if(elapsed>0&&session.startedAt!==undefined)session.segments=normalizedSegments([{start:session.startedAt,end:session.startedAt+elapsed}],session.startedAt,safeNow,durationMs);
    }
    session.elapsedMs=segmentDuration(session.segments);
    if(session.segments.length>0&&(candidate.segmentsEstimated===true||!hasSegments))session.segmentsEstimated=true;
    if(timerMode!=='stopwatch')session.remainingMs=Math.min(session.remainingMs,Math.max(0,durationMs-session.elapsedMs));
  }
  if(session.status==='running'){
    if(timerMode==='stopwatch'){
      const activeStart=timestamp(candidate.activeStartedAt)??startedAt;
      if(activeStart===undefined||activeStart>safeNow||activeStart<(session.segments?.at(-1)?.end??0))session.status='paused';else session.activeStartedAt=activeStart;
    }else {
      const deadline=timestamp(candidate.deadline);
      if(deadline===undefined||startedAt===undefined||deadline-startedAt<session.remainingMs){
        session.status='paused';if(session.remainingMs===0)session.remainingMs=durationMs;
      }else {
        session.deadline=Math.min(deadline,safeNow+session.remainingMs);
        const inferredStart=Math.max(0,session.deadline-session.remainingMs);
        const rawActive=timestamp(candidate.activeStartedAt);
        if(rawActive!==undefined&&(rawActive>safeNow||rawActive<(session.segments?.at(-1)?.end??0))){session.status='paused';delete session.deadline;}
        else session.activeStartedAt=Math.min(safeNow,rawActive===undefined?inferredStart:Math.max(inferredStart,rawActive));
      }
    }
  }
  if(session.status==='running'&&(session.segments?.length??0)>=MAX_TIMER_SEGMENTS){session.status='paused';delete session.activeStartedAt;delete session.deadline;}
  return advancePomodoro({session,records,cycle},safeNow);
}
/** 活动区间包含关闭段和当前段；倒计时后台恢复时当前段截止于真正的 deadline。 */
export function timerSegments(state:PomodoroState,now:number):TimerSegment[] {
  const session=state.session,limit=session.mode==='stopwatch'?MAX_TIMER_DURATION_MS:session.durationMs;
  const segments=normalizedSegments(session.segments,0,MAX_CLOCK,limit);
  if(session.status!=='running'||session.activeStartedAt===undefined)return segments;
  const end=session.mode==='stopwatch'?clock(now):Math.min(clock(now),session.deadline??clock(now));
  const amount=Math.min(limit-segmentDuration(segments),Math.max(0,end-session.activeStartedAt));
  if(amount>0){
    const last=segments.at(-1);
    if(last&&session.activeStartedAt<=last.end)last.end=Math.max(last.end,session.activeStartedAt+amount);
    else if(segments.length<MAX_TIMER_SEGMENTS)segments.push({start:session.activeStartedAt,end:session.activeStartedAt+amount});
  }
  return normalizedSegments(segments,0,MAX_CLOCK,limit);
}
export function pomodoroElapsed(state:PomodoroState,now:number):number {
  return segmentDuration(timerSegments(state,now));
}
export function pomodoroRemaining(state:PomodoroState,now:number):number {
  const session=state.session;if(session.mode==='stopwatch'||session.status==='finished')return 0;
  const remaining=bounded(session.remainingMs,0,0,Math.max(0,session.durationMs));
  if(session.status!=='running'||!finite(session.deadline))return remaining;
  return Math.max(0,Math.min(remaining,session.deadline-clock(now)));
}
function closeActive(state:PomodoroState,now:number):PomodoroSession {
  const segments=timerSegments(state,now),session={...state.session,segments,elapsedMs:segmentDuration(segments)};
  delete session.activeStartedAt;delete session.deadline;return session;
}
function finish(state:PomodoroState,now:number,outcome:TimerOutcome):PomodoroState {
  const previous=state.session,session:PomodoroSession={...closeActive(state,now),status:'finished',remainingMs:0,outcome};
  const recordsWork=outcome==='stopped'||previous.mode!=='pomodoro'||previous.phase==='focus';
  if(!recordsWork||(session.elapsedMs??0)<=0||state.records.some(record=>record.id===previous.id))return {...state,session};
  const segments=session.segments??[],fallbackEnd=clock(now);
  const startedAt=segments.length?Math.min(...segments.map(segment=>segment.start)):Math.min(fallbackEnd,previous.startedAt??fallbackEnd);
  const completedAt=segments.length?Math.max(...segments.map(segment=>segment.end)):fallbackEnd;
  const record:PomodoroRecord={id:previous.id,startedAt,completedAt,durationMs:session.elapsedMs??0,mode:previous.mode,
    outcome,phase:previous.phase,segments:segments.map(segment=>({...segment})),...(previous.target?{target:{...previous.target}}:{}),...(previous.segmentsEstimated?{segmentsEstimated:true}:{})};
  const credit=outcome==='completed'&&previous.mode==='pomodoro'&&previous.phase==='focus';
  return {session,cycle:credit?Math.min(1_000_000,state.cycle+1):state.cycle,records:[...state.records,record].slice(-MAX_RECORDS)};
}
export function advancePomodoro(state:PomodoroState,now:number):PomodoroState {
  if(state.session.status!=='running'||state.session.mode==='stopwatch'||pomodoroRemaining(state,now)>0)return state;
  return finish(state,now,'completed');
}
function followingPhase(state:PomodoroState,config:PomodoroConfig):PomodoroPhase {
  if(state.session.phase!=='focus')return 'focus';
  const completed=state.session.outcome??state.records.find(record=>record.id===state.session.id)?.outcome;
  return state.session.status==='finished'&&completed!=='stopped'&&state.cycle>0&&state.cycle%config.longBreakEvery===0?'long-break':'short-break';
}
function running(state:PomodoroState,now:number):PomodoroState {
  const safeNow=clock(now),old=state.session;
  if((old.segments?.length??0)>=MAX_TIMER_SEGMENTS)throw Error('暂停次数已达上限，请先结束当前计时再开始。');
  if(old.mode==='stopwatch'&&(old.elapsedMs??0)>=MAX_TIMER_DURATION_MS)throw Error('秒表已达到 7 天上限，请先结束当前计时。');
  const session:PomodoroSession={...old,status:'running',startedAt:Math.min(old.startedAt??safeNow,safeNow),activeStartedAt:safeNow};
  if(old.mode!=='stopwatch')session.deadline=safeNow+old.remainingMs;else delete session.deadline;
  return advancePomodoro({...state,session},safeNow);
}
function assignedTarget(session:PomodoroSession,value?:PomodoroTarget):PomodoroTarget|undefined {
  const assigned=value===undefined?session.target:target(value);
  if(value!==undefined&&!assigned)throw Error('专注任务标题不能为空，请重新选择任务。');return assigned;
}
function activeConflict(session:PomodoroSession,assigned:PomodoroTarget|undefined,provided:boolean):void {
  if((session.status==='running'||session.status==='paused')&&provided&&!sameTarget(session.target,assigned))
    throw Error('当前计时已有专注任务，请先结束并记录当前计时；如需放弃，请先重置或跳过当前阶段，再选择其他任务。');
}
export function transitionPomodoro(state:PomodoroState,action:PomodoroAction,config:PomodoroConfig,now:number):PomodoroState {
  const current=advancePomodoro(state,now),normalizedConfig=normalizePomodoroConfig(config),session=current.session;
  const active=session.status==='running'||session.status==='paused';
  if(action.type==='pause'){
    if(session.status!=='running')return current;
    return {...current,session:{...closeActive(current,now),status:'paused',remainingMs:pomodoroRemaining(current,now)}};
  }
  if(action.type==='resume')return session.status==='paused'?running(current,now):current;
  if(action.type==='stop')return active?finish(current,now,'stopped'):current;
  if(action.type==='reset')return {...current,session:freshSession(session.phase,normalizedConfig,now,session.target,session.mode,session.durationMs)};
  if(action.type==='next')return {...current,session:freshSession(session.mode==='pomodoro'?followingPhase(current,normalizedConfig):'focus',normalizedConfig,now,session.target,session.mode,session.durationMs)};
  if(action.type==='select-mode'){
    if(active)throw Error('计时正在进行，请先结束或重置后切换模式。');
    if(!validMode(action.mode))throw Error('请选择有效的计时模式。');
    const amount=countdownDuration(action.durationMinutes,session.mode==='countdown'?session.durationMs:duration('focus',normalizedConfig));
    if(session.status==='idle'&&session.mode===action.mode&&(action.mode!=='countdown'||amount===session.durationMs))return current;
    return {...current,session:freshSession('focus',normalizedConfig,now,session.target,action.mode,amount)};
  }
  if(action.type==='duration'){
    if(session.status!=='idle')throw Error('请在计时开始前设置时长。');
    if(session.mode!=='countdown')throw Error('自定义时长仅适用于倒计时模式。');
    if(!finite(action.minutes))throw Error('请输入有效的分钟数。');
    const amount=countdownDuration(action.minutes,session.durationMs);
    return amount===session.durationMs?current:{...current,session:{...session,durationMs:amount,remainingMs:amount}};
  }
  if(action.type==='adjust'){
    if(session.mode!=='countdown'||!active)throw Error('只有正在运行或暂停的倒计时可以调整时长。');
    if(!finite(action.minutes))throw Error('请输入有效的调整分钟数。');
    const closed=closeActive(current,now),elapsed=closed.elapsedMs??0;
    const remaining=Math.max(0,Math.min(MAX_COUNTDOWN-elapsed,pomodoroRemaining(current,now)+Math.round(action.minutes*MINUTE)));
    if(remaining===pomodoroRemaining(current,now))return current;
    const adjusted={...current,session:{...closed,durationMs:elapsed+remaining,remainingMs:remaining}};
    if(remaining===0)return finish(adjusted,now,'completed');
    return session.status==='running'?running(adjusted,now):adjusted;
  }
  if(action.type==='timer'){
    const selected=action.mode??session.mode;if(!validMode(selected))throw Error('请选择有效的计时模式。');
    const assigned=assignedTarget(session,action.target);activeConflict(session,assigned,action.target!==undefined);
    if(active&&selected!==session.mode)throw Error('已有计时正在进行，请先结束或重置后开始另一种计时。');
    if(active){if(selected==='pomodoro'&&session.phase!=='focus')throw Error('休息正在进行，请先结束或跳过后开始专注。');return session.status==='paused'?running(current,now):current;}
    const amount=countdownDuration(action.durationMinutes,selected===session.mode?session.durationMs:duration('focus',normalizedConfig));
    if(selected==='pomodoro')return running({...current,session:session.status==='idle'&&session.mode==='pomodoro'&&session.phase==='focus'?{...session,...(assigned?{target:{...assigned}}:{})}:freshSession('focus',normalizedConfig,now,assigned)},now);
    const next=session.status==='idle'&&session.mode===selected?{...session,target:assigned,
      ...(selected==='countdown'?{durationMs:amount,remainingMs:amount}:{})}:freshSession('focus',normalizedConfig,now,assigned,selected,amount);
    return running({...current,session:next},now);
  }
  const assigned=assignedTarget(session,action.target);
  if(action.type==='focus'&&session.mode!=='pomodoro'){
    if(active)throw Error('已有计时正在进行，请先结束或重置后开始番茄专注。');
    return running({...current,session:freshSession('focus',normalizedConfig,now,assigned)},now);
  }
  if(action.type==='start'||session.phase==='focus')activeConflict(session,assigned,action.target!==undefined);
  if(action.type==='focus'&&(session.phase!=='focus'||session.status==='finished'))return running({...current,session:freshSession('focus',normalizedConfig,now,assigned)},now);
  if(session.status==='running')return current;
  if(session.status==='paused')return running(current,now);
  if(session.status==='finished')return running({...current,session:freshSession(session.mode==='pomodoro'?followingPhase(current,normalizedConfig):'focus',normalizedConfig,now,assigned,session.mode,session.durationMs)},now);
  return running({...current,session:{...session,...(assigned?{target:{...assigned}}:{})}},now);
}
