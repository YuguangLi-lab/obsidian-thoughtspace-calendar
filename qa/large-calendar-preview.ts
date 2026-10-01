import {LargeCalendarView} from '../src/large-calendar-view';
import {AppleCalendarClient,type CalendarBridgeTransport} from '../src/apple-calendar';
import type {AppleCalendarSettings,CalendarEvent} from '../src/calendar-model';
let settings:AppleCalendarSettings={enabled:true,selectedCalendarIds:['work','life'],defaultCalendarId:'work'};
const events:CalendarEvent[]=[
  {id:'meeting',calendarId:'work',title:'产品讨论 · 日历联动',start:'2026-10-01T02:00:00.000Z',end:'2026-10-01T03:00:00.000Z',allDay:false,location:'会议室 A',notes:'完整备注\n保留原始内容。',revision:'a'.repeat(64),recurring:true,editable:true,color:'#5a7fca'},
  {id:'walk',calendarId:'life',title:'傍晚散步',start:'2026-10-01T09:00:00.000Z',end:'2026-10-01T10:00:00.000Z',allDay:false,location:'公园',notes:'',revision:'b'.repeat(64),recurring:false,editable:true,color:'#6b997a'},
  {id:'holiday',calendarId:'life',title:'国庆 · 放松一下',start:'2026-09-30T16:00:00.000Z',end:'2026-10-01T16:00:00.000Z',allDay:true,location:'',notes:'',revision:'c'.repeat(64),recurring:false,editable:false,color:'#bc875e'},
];
let failSave=false;
const requests:any[]=[];
const transport:CalendarBridgeTransport={
  call:async<T>(request)=> {
    requests.push(request);
    switch(request.action) {
      case 'status':case 'request':return {authorization:'authorized'} as T;
      case 'calendars':return {calendars:[{id:'work',title:'工作',color:'#5a7fca',source:'iCloud',editable:true},{id:'life',title:'生活',color:'#6b997a',source:'iCloud',editable:true}],defaultCalendarId:'work'} as T;
      case 'events':return {events:events.filter(e=>Date.parse(e.start)<Date.parse(request.end!)&&Date.parse(e.end)>Date.parse(request.start!)),truncated:false} as T;
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
const host:any={
  app:{},apple:client,appleSettings:()=>settings,saveAppleSettings:async(value)=>{settings=value;},
  changed:()=>void view.refresh(true),
  tasks:async()=>[{id:'t',date:'2026-10-01',text:'测试双向联动和日期切换',source:'QA.md',completed:false,startMinute:540,endMinute:570}],
  openJournal:async(date)=>{(window as any).journalDate=date.toISOString();},
  openTask:async(task)=>{(window as any).openedTask=task.id;},
  lunar:(date)=>date.getDate()===1?'国庆节':''
};
view=new LargeCalendarView({} as any,host);
await view.onOpen();
Object.assign(window,{view,events,requests,setFailSave:(value:boolean)=>failSave=value});
