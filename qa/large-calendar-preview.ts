import {LargeCalendarView,type LargeCalendarHost} from '../src/large-calendar-view';
import {AppleCalendarClient,type CalendarBridgeTransport} from '../src/apple-calendar';
import {type AppleCalendarSettings,type CalendarEvent,type CalendarTask,dayKey} from '../src/calendar-model';
import {calendarTasks,unscheduledCalendarTasks} from '../src/calendar-task-adapter';
import {planTasks,changeTask} from '../src/task-planner-model';
import {resolveCalendarTask,taskSchedulingChange} from '../src/calendar-scheduling';
import {calendarEventNoteKey} from '../src/calendar-note-links';
import {createPomodoroState,defaultPomodoroConfig} from '../src/pomodoro-model';
import type {PomodoroTarget,TimerMode} from '../src/pomodoro-model';
let settings:AppleCalendarSettings={enabled:true,selectedCalendarIds:['work','life'],defaultCalendarId:'work'};
const events:CalendarEvent[]=[
  {id:'meeting',calendarId:'work',title:'产品讨论 · 日历联动',start:'2026-10-01T02:00:00.000Z',end:'2026-10-01T03:00:00.000Z',allDay:false,location:'会议室 A',notes:'完整备注\n保留原始内容。',revision:'a'.repeat(64),recurring:true,editable:true,color:'#5a7fca'},
  {id:'walk',calendarId:'life',title:'傍晚散步',start:'2026-10-01T09:00:00.000Z',end:'2026-10-01T10:00:00.000Z',allDay:false,location:'公园',notes:'',revision:'b'.repeat(64),recurring:false,editable:true,color:'#6b997a'},
  {id:'holiday',calendarId:'life',title:'国庆 · 放松一下',start:'2026-09-30T16:00:00.000Z',end:'2026-10-01T16:00:00.000Z',allDay:true,location:'',notes:'',revision:'c'.repeat(64),recurring:false,editable:false,color:'#bc875e'},
  {id:'overnight',calendarId:'work',title:'跨午夜交接',start:'2026-10-01T15:00:00.000Z',end:'2026-10-01T17:00:00.000Z',allDay:false,location:'',notes:'跨日备注保留。',revision:'e'.repeat(64),recurring:false,editable:true,color:'#a37bb5'},
];
let failSave=false,failSchedule=false;
const requests:any[]=[],noteLinks=new Map<string,{path:string;name:string}[]>();
const taskMarkdown:Record<string,string>={
 'QA.md':'- [ ] 09:00 - 09:30 测试双向联动和日期切换 ⏳ 2026-10-01 ^scheduled',
 '收件箱.md':'- [ ] 整理资料 ^inbox\n- [ ] 写作提纲 ^outline'
};
const allTasks=()=>Object.entries(taskMarkdown).flatMap(([path,text])=>planTasks(text,path,'日记'));
const transport:CalendarBridgeTransport={
  call:async<T>(request)=> {
    requests.push(request);
    switch(request.action) {
      case 'status':case 'request':return {authorization:'authorized'} as T;
      case 'calendars':return {calendars:[{id:'work',title:'工作',color:'#5a7fca',source:'iCloud',editable:true},{id:'life',title:'生活',color:'#6b997a',source:'iCloud',editable:true}],defaultCalendarId:'work'} as T;
      // Event-list summaries intentionally omit private notes. Every edit must load detail.
      case 'events':return {events:events.filter(e=>Date.parse(e.start)<Date.parse(request.end!)&&Date.parse(e.end)>Date.parse(request.start!)).map(e=>({...e,notes:''})),truncated:false} as T;
      case 'event':return {event:events.find(e=>e.id===request.eventId)} as T;
      case 'save': {
        if(failSave) throw new Error('日程已在苹果日历中更新，请刷新后重新编辑');
        const draft=request.draft!;
        const event={...draft,id:draft.eventId??`new-${events.length}`,revision:'d'.repeat(64),editable:true,recurring:false,color:'#5a7fca'};
        const index=events.findIndex(e=>e.id===draft.eventId); if(index>=0) events[index]=event;else events.push(event);
        return {event} as T;
      }
      default:throw new Error('未知操作');
    }
  },dispose:()=>{}
};
const client=new AppleCalendarClient(transport,()=>settings);
let view:LargeCalendarView;
let timerState=createPomodoroState(defaultPomodoroConfig,Date.now()),timerElapsed=0,timerRemaining=timerState.session.remainingMs;
const startTimer=async(target:PomodoroTarget,mode:TimerMode='stopwatch',durationMinutes?:number)=>{requests.push({action:'timer-start',target:structuredClone(target),mode,durationMinutes});timerState={...timerState,session:{...timerState.session,id:`timer-${requests.length}`,mode,status:'running',target,startedAt:Date.now(),activeStartedAt:Date.now(),elapsedMs:0} as any};timerElapsed=0;timerRemaining=mode==='countdown'?(durationMinutes??25)*60_000:0;view.refreshTimer();};
const schedule=async(task:CalendarTask,date:string,start?:number,end?:number,clearTime?:boolean)=>{
 if(failSchedule)throw Error('任务原文已变化，请刷新后再操作');
 const current=resolveCalendarTask(allTasks(),task);
 const change=taskSchedulingChange(task,date,start,end);if(clearTime)change.time=null;
 taskMarkdown[current.path]=changeTask(taskMarkdown[current.path],current,change);
 requests.push({action:'task-schedule',id:task.id,date,start,end});
};
const host:LargeCalendarHost={
  app:{workspace:{requestSaveLayout(){}}} as any,apple:client,appleSettings:()=>settings,saveAppleSettings:async value=>{settings=value;},
  changed:()=>void view.refresh(true),
  tasks:async(start,end)=>calendarTasks(allTasks(),start,end),
  unscheduledTasks:async()=>unscheduledCalendarTasks(allTasks()),scheduleTask:schedule,
  canToggleTask:task=>{try{return !resolveCalendarTask(allTasks(),task).recurring;}catch{return false;}},
  toggleTask:async task=>{const current=resolveCalendarTask(allTasks(),task);taskMarkdown[current.path]=changeTask(taskMarkdown[current.path],current,{checked:!current.checked,completedOn:current.checked?'':'2026-10-01'});requests.push({action:'task-toggle',id:task.id});},
  openJournal:async date=>{(window as any).journalDate=dayKey(date);},
  openTask:async task=>{(window as any).openedTask=task.id;},
  timerSnapshot:()=>({state:timerState,remainingMs:timerRemaining,elapsedMs:timerElapsed,busy:false}),
  startTimer,openTimer:async()=>{requests.push({action:'timer-open'});},
  startPomodoro:async task=>{const current=resolveCalendarTask(allTasks(),task);const plannedStart=task.startMinute===undefined?undefined:+new Date(`${task.date}T00:00:00`)+task.startMinute*60_000,plannedEnd=plannedStart===undefined||task.endMinute===undefined?undefined:plannedStart+(task.endMinute-task.startMinute!)*60_000,duration=plannedStart!==undefined&&plannedEnd!==undefined?(plannedEnd-plannedStart)/60_000:0,countdown=duration>0&&duration<=1440;await startTimer({title:current.title,path:current.path,line:current.line,source:current.source,...(plannedStart!==undefined&&plannedEnd!==undefined?{plannedStart,plannedEnd,plannedDurationMs:plannedEnd-plannedStart}:{})},countdown?'countdown':'stopwatch',countdown?Math.ceil(duration):undefined);},
  eventNotes:event=>noteLinks.get(calendarEventNoteKey(event))??[],
  openEventNote:async event=>{const key=calendarEventNoteKey(event);if(!noteLinks.has(key))noteLinks.set(key,[{path:'日程/产品会议记录.md',name:'产品会议记录'}]);requests.push({action:'note-open',id:event.id});await view.refresh();},
  linkEventNote:event=>{noteLinks.set(calendarEventNoteKey(event),[{path:'资料/既有讨论笔记.md',name:'既有讨论笔记'}]);requests.push({action:'note-link',id:event.id});void view.refresh();},
  eventMoved:async(before,after)=>{const oldKey=calendarEventNoteKey(before),next=calendarEventNoteKey(after),notes=noteLinks.get(oldKey);if(notes&&oldKey!==next){noteLinks.set(next,notes);noteLinks.delete(oldKey);}requests.push({action:'event-rekey',id:before.id});},
  lunar:date=>date.getDate()===1?'国庆节':''
};
view=new LargeCalendarView({} as any,host);
await view.onOpen();
// Setup/control helpers only; tests drive all editing, dragging and clicking through DOM.
Object.assign(window,{view,events,requests,setFailSave:(value:boolean)=>failSave=value,
 qaFixture:{setFailSchedule:(value:boolean)=>failSchedule=value,state:()=>structuredClone({events,taskMarkdown,requests,notes:[...noteLinks],timerState}),
  setTimerRecords:(records:any[])=>{timerState={...timerState,records};view.refreshTimer();},
  setActiveTimer:(mode:TimerMode,elapsed:number,remaining:number)=>{timerState={...timerState,session:{...timerState.session,mode,status:'running',target:{title:'当前工作'}} as any};timerElapsed=elapsed;timerRemaining=remaining;view.refreshTimer();},
  clockTick:(elapsed:number,remaining:number)=>{timerElapsed=elapsed;timerRemaining=remaining;view.refreshTimerClock(host.timerSnapshot!());}
 }});
