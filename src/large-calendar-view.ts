import { ItemView, WorkspaceLeaf, Notice, setIcon } from 'obsidian';
import { addDays, dayKey, eventsOnDay, movePeriod, occurrenceKey, parseDay, timedSegments, visibleDays, type CalendarEvent, type CalendarMode, type CalendarTask } from './calendar-model';
import { AppleCalendarConnectionModal, CalendarEventModal, type CalendarHost } from './calendar-modals';
import {CalendarTaskScheduleModal} from './calendar-task-modal';
import {clockLabel} from './task-time';
import {calendarTaskCanSchedule, eventMoveDraft, eventResizeDraft, snapCalendarMinute} from './calendar-scheduling';
import {calendarTimeRange} from './calendar-range-selection';
import {canReadCalendarTaskDrag,readCalendarTaskDrag,endCalendarTaskDrag} from './calendar-task-drag';
import type {PomodoroSnapshot} from './pomodoro';
import type {PomodoroTarget,TimerMode} from './pomodoro-model';
import {timerRecordsOnDay,timerActualMsOnDay,timerMinuteLabel,timerModeLabel,type TimerCalendarItem} from './timer-calendar-model';

export interface LargeCalendarHost extends CalendarHost {
  tasks(start:Date,end:Date):Promise<CalendarTask[]>;
  openJournal(date:Date):Promise<void>;
  openTask(task:CalendarTask):Promise<void>;
  unscheduledTasks?():Promise<CalendarTask[]>;
  scheduleTask?(task:CalendarTask,date:string,startMinute?:number,endMinute?:number,clearTime?:boolean):Promise<void>;
  toggleTask?(task:CalendarTask):Promise<void>;
  canToggleTask?(task:CalendarTask):boolean;
  startPomodoro?(task:CalendarTask):Promise<void>;
  timerSnapshot?():PomodoroSnapshot;
  startTimer?(target:PomodoroTarget,mode?:TimerMode,durationMinutes?:number):Promise<void>;
  openTimer?():Promise<void>;
  eventNotes?(event:CalendarEvent):{path:string;name:string}[];
  openEventNote?(event:CalendarEvent):Promise<void>;
  linkEventNote?(event:CalendarEvent):void;
  eventMoved?(before:CalendarEvent,after:CalendarEvent):Promise<void>;
  lunar?(date:Date):string;
}
const weekday=['一','二','三','四','五','六','日'];
const time=(date:string)=>new Date(date).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
const datedTime=(iso:string,day:Date)=>{const date=new Date(iso);return `${dayKey(date)===dayKey(day)?'':`${date.getMonth()+1}/${date.getDate()} `}${time(iso)}`;};
// Obsidian briefly replaces unregistered custom views during plugin reload. Its placeholder
// drops view state. Keep only three small navigation values on the existing leaf, whose
// lifetime Obsidian controls; no global cache, note content or additional settings writes.
const resumeState=Symbol.for('thoughtspace-calendar.large-calendar-resume');
type CalendarDrag={kind:'task';task:CalendarTask}|{kind:'event';event:CalendarEvent};
const dragType='application/x-thoughtspace-calendar-item';

export class LargeCalendarView extends ItemView {
  static readonly type='thoughtspace-large-calendar';
  private mode:CalendarMode='month';
  private selected=new Date();
  private anchor=new Date();
  private events:CalendarEvent[]=[];
  private tasks:CalendarTask[]=[];
  private backlog:CalendarTask[]=[];
  private drag?:{item:CalendarDrag;token:string};
  private resizing?:()=>void;
  private selecting?:()=>void;
  private saving=false;
  private deferredRefresh=false;
  private deferredForce=false;
  private deferredTimerRefresh=false;
  private timerState?:PomodoroSnapshot;
  private timerPill?:HTMLButtonElement;
  private timerPillLabel?:HTMLElement;
  private agendaTimerPill?:HTMLButtonElement;
  private externalDragging=false;
  private externalDragTimer?:number;
  private suppressClickUntil=0;
  private revision=0;
  private closed=false;
  private timer?:number;
  private main!:HTMLElement;
  private agenda!:HTMLElement;
  private status!:HTMLElement;
  private title!:HTMLElement;
  private modeButtons=new Map<CalendarMode,HTMLButtonElement>();
  private win!:Window;
  constructor(leaf:WorkspaceLeaf,private host:LargeCalendarHost) {
    super(leaf);
    const saved=(leaf as unknown as Record<symbol,unknown>)[resumeState];
    if(saved&&typeof saved==='object')void this.setState(saved as Record<string,unknown>);
    delete (leaf as unknown as Record<symbol,unknown>)[resumeState];
  }
  getViewType():string { return LargeCalendarView.type; }
  getDisplayText():string { return '大日历'; }
  getIcon():string { return 'calendar-range'; }
  getState(){return {mode:this.mode,day:dayKey(this.selected),anchor:dayKey(this.anchor)};}
  async setState(state:Record<string,unknown>):Promise<void>{
    if(state.mode==='month'||state.mode==='week')this.mode=state.mode;
    try{if(typeof state.day==='string')this.selected=parseDay(state.day);if(typeof state.anchor==='string')this.anchor=parseDay(state.anchor);}catch{this.selected=new Date();this.anchor=new Date();}
    if(this.main&&!this.closed)await this.refresh();
  }
  async showDay(date:Date):Promise<void>{this.selected=new Date(date);this.anchor=new Date(date);this.saveLayout();await this.refresh();}
  private saveLayout(){this.host.app.workspace?.requestSaveLayout();}
  async onOpen():Promise<void> {
    this.closed=false;
    this.win=this.contentEl.ownerDocument.defaultView!;
    this.contentEl.empty(); this.contentEl.addClass('tsc-large-calendar','ts-calendar-plugin');
    const header=this.contentEl.createDiv({cls:'tsc-large-header'});
    const heading=header.createDiv({cls:'tsc-large-heading'});
    heading.createSpan({text:'日历',cls:'tsc-eyebrow'}); this.title=heading.createEl('h2');
    const navigation=header.createDiv({cls:'tsc-large-navigation'});
    this.iconButton(navigation,'chevron-left','上一个周期',()=>this.navigate(-1));
    const today=navigation.createEl('button',{text:'今天',cls:'tsc-today-button'}); today.onclick=()=> { this.selected=new Date(); this.anchor=new Date(); this.saveLayout();void this.refresh(); };
    this.iconButton(navigation,'chevron-right','下一个周期',()=>this.navigate(1));
    const modes=header.createDiv({cls:'tsc-view-modes',attr:{role:'group','aria-label':'日历视图'}});
    for(const [mode,title] of [['month','月'],['week','周']] as const) {
      const button=modes.createEl('button',{text:title}); this.modeButtons.set(mode,button);
      button.onclick=()=> { this.mode=mode; this.anchor=new Date(this.selected);this.saveLayout(); void this.refresh(); };
    }
    const actions=header.createDiv({cls:'tsc-large-actions'});
    if(this.host.timerSnapshot&&this.host.openTimer){this.timerPill=actions.createEl('button',{cls:'tsc-active-timer-pill',attr:{'aria-label':'打开计时器',title:'打开计时器'}});setIcon(this.timerPill.createSpan(),'timer');this.timerPillLabel=this.timerPill.createSpan();this.timerPill.onclick=()=>this.run(()=>this.host.openTimer!());}
    this.iconButton(actions,'refresh-cw','刷新日程和任务',()=>void this.refresh(true));
    this.iconButton(actions,'calendar-cog','苹果日历连接与选择',()=>new AppleCalendarConnectionModal(this.host).open());
    const create=actions.createEl('button',{cls:'mod-cta tsc-add-event'}); setIcon(create.createSpan(),'plus'); create.createSpan({text:'新日程'});
    create.onclick=()=>this.openEvent();
    const body=this.contentEl.createDiv({cls:'tsc-large-body'});
    this.main=body.createDiv({cls:'tsc-large-main'}); this.agenda=body.createEl('aside',{cls:'tsc-day-agenda'});
    this.status=this.contentEl.createDiv({cls:'tsc-large-status',attr:{role:'status','aria-live':'polite'}});
    this.registerDomEvent(this.win,'keydown',e=>{if(e.key==='Escape'){this.selecting?.();this.resizing?.();this.endDrag();}});
    this.registerDomEvent(this.win,'dragend',()=>{this.externalDragging=false;this.win.clearTimeout(this.externalDragTimer);this.clearDropPreview();this.flushDeferred();});
    // Refresh external edits only while this pane is visible. No calendar database scans in hidden panes.
    this.registerDomEvent(this.win,'focus',()=> { if(this.visible()) void this.refresh(); });
    this.timer=this.win.setInterval(()=> { if(this.visible()&&this.host.appleSettings().enabled) void this.refresh(); },60000);
    this.register(()=>this.win.clearInterval(this.timer));
    this.register(()=>{this.closed=true;this.selecting?.();this.resizing?.();});
    await this.refresh();
  }
  async onClose():Promise<void> { (this.leaf as unknown as Record<symbol,unknown>)[resumeState]=this.getState();this.closed=true;this.selecting?.();this.resizing?.();this.drag=undefined; this.revision++;this.win?.clearInterval(this.timer);this.win?.clearTimeout(this.externalDragTimer);this.externalDragging=false; this.contentEl.empty(); }
  private visible():boolean { return !this.closed && this.contentEl.isConnected && this.contentEl.getBoundingClientRect().width>0 && !this.contentEl.ownerDocument.hidden; }
  private navigate(direction:number):void { this.anchor=movePeriod(this.anchor,this.mode,direction); this.selected=new Date(this.anchor);this.saveLayout(); void this.refresh(); }
  async refresh(force=false):Promise<void> {
    await this.loadCalendar(force);
  }
  /** Clock updates touch only two text labels; no calendar rows or transport calls. */
  refreshTimerClock(snapshot:PomodoroSnapshot):void{
    if(this.closed)return;this.timerState=snapshot;const session=snapshot.state.session;
    const active=session.status==='running'||session.status==='paused',mode=session.mode||'pomodoro';
    const ms=mode==='stopwatch'?snapshot.elapsedMs:snapshot.remainingMs,seconds=Math.max(0,mode==='stopwatch'?Math.floor(ms/1000):Math.ceil(ms/1000));
    const minutes=seconds>=3600?Math.floor(seconds/60)%60:Math.floor(seconds/60);
    const clock=`${seconds>=3600?String(Math.floor(seconds/3600)).padStart(2,'0')+':':''}${String(minutes).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
    const modeLabel=mode==='pomodoro'&&session.phase!=='focus'?'休息':timerModeLabel(mode);
    const label=active?`${modeLabel} ${clock}${session.status==='paused'?' · 暂停':''}`:'计时器';
    if(this.timerPillLabel&&this.timerPillLabel.textContent!==label)this.timerPillLabel.textContent=label;
    if(this.timerPill){this.timerPill.dataset.active=String(active);this.timerPill.title=session.target?.title||'打开计时器';}
    if(this.agendaTimerPill){this.agendaTimerPill.hidden=!active||dayKey(this.selected)!==dayKey(new Date());const text=`${label} · ${session.target?.title||'自由计时'}`;if(this.agendaTimerPill.textContent!==text)this.agendaTimerPill.textContent=text;}
  }
  /** Reconcile local timer transitions without loading Apple events again. */
  refreshTimer():void{
    if(this.closed||!this.main)return;const snapshot=this.host.timerSnapshot?.();if(snapshot)this.refreshTimerClock(snapshot);
    if(this.drag||this.externalDragging||this.resizing||this.selecting||this.saving){this.deferredTimerRefresh=true;return;}
    this.deferredTimerRefresh=false;this.renderCalendar(visibleDays(this.anchor,this.mode));this.renderAgenda();
  }
  private async loadCalendar(force=false,afterSave=false):Promise<void> {
    if(this.closed) return;
    if(this.drag||this.externalDragging||this.resizing||this.selecting||this.saving&&!afterSave){this.deferredRefresh=true;this.deferredForce||=force;return;}
    const revision=++this.revision; const days=visibleDays(this.anchor,this.mode), end=addDays(days.at(-1)!,1);
    this.title.textContent=this.mode==='month'?`${this.anchor.getFullYear()} 年 ${this.anchor.getMonth()+1} 月`:
      `${days[0].getMonth()+1} 月 ${days[0].getDate()} 日 — ${days[6].getMonth()+1} 月 ${days[6].getDate()} 日`;
    for(const [mode,button] of this.modeButtons) button.setAttribute('aria-pressed',String(mode===this.mode));
    this.status.textContent='正在加载…';
    const results=await Promise.allSettled([this.host.apple.events(days[0],end,force),this.host.tasks(days[0],end),this.host.unscheduledTasks?.()??Promise.resolve([])]);
    if(this.closed||revision!==this.revision) return;
    if(this.drag||this.externalDragging||this.resizing||this.selecting||this.saving&&!afterSave){this.deferredRefresh=true;this.deferredForce||=force;return;}
    const [apple,tasks,backlog]=results;
    this.events=apple.status==='fulfilled'?apple.value.events:[];
    this.tasks=tasks.status==='fulfilled'?tasks.value:[];
    this.backlog=backlog.status==='fulfilled'?backlog.value:[];
    const snapshot=this.host.timerSnapshot?.();if(snapshot)this.refreshTimerClock(snapshot);this.deferredTimerRefresh=false;
    this.renderCalendar(days); this.renderAgenda();
    if(apple.status==='rejected') this.status.textContent=apple.reason instanceof Error?apple.reason.message:'苹果日程加载失败';
    else if(tasks.status==='rejected') this.status.textContent='本地任务加载失败，可点击刷新重试';
    else if(backlog.status==='rejected') this.status.textContent='待安排任务加载失败，可点击刷新重试';
    else if(apple.value.truncated) this.status.textContent='此范围日程超过 2,000 条，请切换周视图或减少显示的日历';
    else this.status.textContent=this.host.appleSettings().enabled?'已同步 · 苹果日程和本地任务': '本地日历 · 点击右上角日历设置连接苹果日历';
  }
  private renderCalendar(days:Date[]):void {
    const period=`${this.mode}:${dayKey(days[0])}`;
    const samePeriod=this.main.dataset.period===period;
    const scroll={top:this.main.scrollTop,left:this.main.scrollLeft,body:this.main.parentElement!.scrollTop};
    this.main.empty(); this.main.dataset.mode=this.mode;this.main.dataset.period=period;
    if(this.mode==='week') { this.renderWeek(days); }
    else this.renderMonth(days);
    this.main.scrollLeft=samePeriod?scroll.left:0;
    this.main.scrollTop=samePeriod?scroll.top:this.mode==='week'?Math.max(0,(dayKey(this.selected)===dayKey(new Date())?new Date().getHours()-1:8)*48):0;
    this.main.parentElement!.scrollTop=samePeriod?scroll.body:0;
  }
  private renderMonth(days:Date[]):void {
    const weekdays=this.main.createDiv({cls:'tsc-month-weekdays'});
    for(const day of weekday) weekdays.createSpan({text:`周${day}`});
    const grid=this.main.createDiv({cls:'tsc-month-grid'});
    const today=dayKey(new Date());
    for(const day of days) {
      const key=dayKey(day);
      const cell=grid.createDiv({cls:'tsc-month-day',attr:{'data-date':key}});
      this.dropTarget(cell,day,false);
      cell.toggleClass('is-other-month',day.getMonth()!==this.anchor.getMonth());
      cell.toggleClass('is-selected',key===dayKey(this.selected)); cell.toggleClass('is-today',key===today);
      const head=cell.createDiv({cls:'tsc-day-header'});
      const select=head.createEl('button',{text:String(day.getDate()),cls:'tsc-day-number',attr:{'aria-label':`${key}，查看日程和任务`}});
      select.onclick=()=>this.select(day);
      const lunar=this.host.lunar?.(day); if(lunar) head.createSpan({text:lunar,cls:'tsc-cell-lunar'});
      this.iconButton(head,'plus','在此日新建日程',()=> { const at=new Date(day); at.setHours(9); this.openEvent(undefined,at); }).addClass('tsc-day-add');
      const events=eventsOnDay(this.events,day);
      const tasks=this.tasks.filter(task=>task.date===key&&!task.completed);
      // Keep one date readable even when events and tasks share a busy day.
      // Counts below open the full agenda, so condensed previews hide no actions.
      const eventLimit=tasks.length?2:3,visibleEvents=events.slice(0,eventLimit);
      for(const event of visibleEvents) this.eventChip(cell,event,day);
      for(const task of tasks.slice(0,Math.min(2,3-visibleEvents.length))){
        const chip=cell.createEl('button',{cls:'tsc-event-chip tsc-task-chip',text:task.text});
        chip.style.setProperty('--event-accent','var(--tsc-accent)');chip.title=task.text;
        chip.onclick=e=>{e.stopPropagation();if(Date.now()>this.suppressClickUntil){this.select(day);this.schedule(task);}};
        this.makeDraggable(chip,{kind:'task',task});
      }
      if(tasks.length) {
        const badge=cell.createEl('button',{cls:'tsc-cell-tasks',text:`${tasks.length} 项待办`}); badge.onclick=()=>this.select(day);
      }
      if(events.length>visibleEvents.length) {
        const more=cell.createEl('button',{text:`+${events.length-visibleEvents.length} 项日程`,cls:'tsc-cell-more'}); more.onclick=()=>this.select(day);
      }
      const actual=timerActualMsOnDay(this.timerState?.state.records||[],day);
      if(actual>0){const minutes=timerMinuteLabel(actual),badge=cell.createEl('button',{cls:'tsc-cell-actual',text:`实 ${minutes} 分`,attr:{'data-minutes':minutes,'aria-label':`${key} 实际计时 ${minutes} 分钟`,title:'查看本日实际计时记录'}});badge.onclick=()=>this.select(day);}
      cell.onclick=(e)=> { if(e.target===cell) this.select(day); };
    }
  }
  private select(date:Date):void {
    this.selected=new Date(date);
    this.saveLayout();
    for(const cell of this.main.querySelectorAll<HTMLElement>('[data-date]')) cell.toggleClass('is-selected',cell.dataset.date===dayKey(date));
    this.renderAgenda();
  }
  private renderWeek(days:Date[]):void {
    const scroll=this.main.createDiv({cls:'tsc-week-scroll'});
    const header=scroll.createDiv({cls:'tsc-week-header'});const hasActual=days.some(day=>timerActualMsOnDay(this.timerState?.state.records||[],day)>0);header.createSpan({cls:'tsc-week-rail-key',text:hasActual?'计划 / 实际':'',attr:{title:'左侧计划，右侧实际投入（暖色虚线）'}});
    days.forEach((date,i)=> {
      const button=header.createEl('button',{cls:'tsc-week-heading',attr:{'data-date':dayKey(date)}});
      button.createSpan({text:`周${weekday[i]}`}); button.createEl('strong',{text:String(date.getDate())});
      button.toggleClass('is-today',dayKey(date)===dayKey(new Date())); button.onclick=()=>this.select(date);
    });
    const allDay=scroll.createDiv({cls:'tsc-week-allday'}); allDay.createSpan({text:'全天'});
    for(const day of days) {
      const column=allDay.createDiv();this.dropTarget(column,day,false); const events=eventsOnDay(this.events,day).filter(e=>e.allDay);
      for(const event of events.slice(0,3)) this.eventChip(column,event,day);
      if(events.length>3) {
        const more=column.createEl('button',{text:`+${events.length-3} 项`,cls:'tsc-cell-more'}); more.onclick=()=>this.select(day);
      }
    }
    const body=scroll.createDiv({cls:'tsc-week-timegrid'});
    const axis=body.createDiv({cls:'tsc-hour-axis'});
    for(let hour=0;hour<24;hour++) axis.createSpan({text:`${String(hour).padStart(2,'0')}:00`});
    for(const day of days) {
      const column=body.createDiv({cls:'tsc-week-column',attr:{'data-date':dayKey(day)}});
      this.dropTarget(column,day,true);
      this.selectTimeRange(column,day);
      const taskEvents=new Map<CalendarEvent,CalendarTask>();
      const actual=timerRecordsOnDay(this.timerState?.state.records||[],day),hasActual=actual.length>0;column.dataset.hasActual=String(hasActual);
      for(const task of this.tasks.filter(t=>t.date===dayKey(day)&&!t.completed&&t.startMinute!==undefined)) {
        const startMinute=task.startMinute!;
        if(startMinute<0||startMinute>=1440) continue;
        const start=new Date(day); start.setHours(0,startMinute,0,0);
        const end=new Date(day); end.setHours(0,Math.min(1440,task.endMinute??startMinute+30),0,0);
        if(end<=start) continue;
        taskEvents.set({id:task.id,calendarId:'local-task',title:task.text,start:start.toISOString(),end:end.toISOString(),
          allDay:false,location:'',notes:'',revision:'',recurring:false,editable:false,color:'#6b997a'},task);
      }
      const segments=timedSegments([...this.events,...taskEvents.keys()],day);
      for(const segment of segments.slice(0,60)) {
        const task=taskEvents.get(segment.event);
        const chip=task?column.createEl('button',{cls:'tsc-event-chip tsc-task-chip',text:task.text}):this.eventChip(column,segment.event,day);
        if(task) { chip.style.setProperty('--event-accent','#6b997a'); chip.onclick=(e)=> { e.stopPropagation();if(Date.now()>this.suppressClickUntil)this.run(()=>this.host.openTask(task)); };this.makeDraggable(chip,{kind:'task',task}); }
        chip.addClass('tsc-week-event');
        chip.style.top=`${segment.start/1440*100}%`; chip.style.height=`max(28px, ${Math.max(15,segment.end-segment.start)/1440*100}%)`;
        const plannedWidth=hasActual?65:100;chip.style.left=`calc(${segment.lane/segment.lanes*plannedWidth}% + 3px)`;
        chip.style.width=`calc(${plannedWidth/segment.lanes}% - 6px)`;
        this.resizeHandle(chip,column,day,task?{kind:'task',task}:{kind:'event',event:segment.event});
      }
      if(segments.length>60) {
        const more=column.createEl('button',{text:`另有 ${segments.length-60} 项`,cls:'tsc-week-overflow'});
        more.onclick=(e)=> { e.stopPropagation(); this.select(day); };
      }
      let actualCount=0;for(const item of actual)for(const interval of item.segments){
        if(actualCount++>=60)continue;
        const minute=(at:number)=>{const date=new Date(at);return date.getHours()*60+date.getMinutes()+date.getSeconds()/60;},start=interval.start<=+day?0:minute(interval.start),end=interval.end>=+addDays(day,1)?1440:minute(interval.end);
        const chip=column.createEl('button',{cls:'tsc-week-actual',attr:{'data-record-id':item.id,'aria-label':`实际计时：${item.title}，${timerMinuteLabel(interval.end-interval.start)} 分钟`,title:`实际 ${this.intervalLabel(interval.start,interval.end)} · ${item.title}${item.estimated?' · 旧记录分段估计':''}`}});
        chip.createEl('small',{text:`实 ${timerMinuteLabel(interval.end-interval.start)} 分`});chip.createSpan({text:item.title});chip.style.top=`${start/1440*100}%`;chip.style.height=`max(18px,${Math.max(1,end-start)/1440*100}%)`;chip.onclick=e=>{e.stopPropagation();if(Date.now()>this.suppressClickUntil)this.run(()=>this.openActual(item));};
      }
      if(actualCount>60){const more=column.createEl('button',{cls:'tsc-week-actual-overflow',text:`实际 +${actualCount-60}`});more.onclick=e=>{e.stopPropagation();this.select(day);};}
      column.onclick=(e)=> {
        if(e.target!==column||Date.now()<this.suppressClickUntil||this.saving) return;
        const rect=column.getBoundingClientRect();
        const minute=Math.max(0,Math.min(1410,Math.round((e.clientY-rect.top)/rect.height*1440/30)*30));
        const date=new Date(day); date.setHours(0,minute,0,0); this.openEvent(undefined,date);
      };
      if(dayKey(day)===dayKey(new Date())) {
        const now=new Date(); const line=column.createDiv({cls:'tsc-now-line'}); line.style.top=`${(now.getHours()*60+now.getMinutes())/1440*100}%`;
      }
    }
  }
  private eventChip(parent:HTMLElement,event:CalendarEvent,day?:Date):HTMLButtonElement {
    const chip=parent.createEl('button',{cls:'tsc-event-chip',attr:{title:`${event.title}${event.allDay?' · 全天':` · ${time(event.start)}–${time(event.end)}`}`}});
    chip.style.setProperty('--event-accent',/^#[0-9a-f]{6}$/i.test(event.color)?event.color:'#447c83');
    chip.dataset.occurrence=occurrenceKey(event);
    if(!event.allDay) chip.createEl('small',{text:time(event.start)});
    chip.createSpan({text:event.title}); chip.onclick=(e)=> { e.stopPropagation();if(Date.now()>this.suppressClickUntil)this.openEvent(event); };this.makeDraggable(chip,{kind:'event',event},day); return chip;
  }
  private renderAgenda():void {
    const scroll=this.agenda.scrollTop;
    const openSections=new Set([...this.agenda.querySelectorAll<HTMLDetailsElement>('details[open]')].map(el=>el.className));
    this.agenda.empty();
    this.agendaTimerPill=undefined;
    const head=this.agenda.createDiv({cls:'tsc-agenda-heading'});
    head.createSpan({text:this.selected.toLocaleDateString('zh-CN',{weekday:'long'}),cls:'tsc-eyebrow'});
    head.createEl('h3',{text:`${this.selected.getMonth()+1} 月 ${this.selected.getDate()} 日`});
    const actions=head.createDiv({cls:'tsc-agenda-actions'});
    const journal=actions.createEl('button',{text:'打开日记'}); journal.onclick=()=>this.run(()=>this.host.openJournal(new Date(this.selected)));
    this.iconButton(actions,'plus','新建日程',()=>this.openEvent());
    const events=eventsOnDay(this.events,new Date(this.selected.getFullYear(),this.selected.getMonth(),this.selected.getDate()));
    const tasks=this.tasks.filter(task=>task.date===dayKey(this.selected));
    const section=(title:string)=>{this.agenda.createEl('h4',{text:title});return this.agenda.createDiv({cls:'tsc-agenda-list'});};
    const session=this.timerState?.state.session;
    if(this.host.openTimer&&session&&(session.status==='running'||session.status==='paused')&&dayKey(this.selected)===dayKey(new Date())){this.agendaTimerPill=this.agenda.createEl('button',{cls:'tsc-agenda-active-timer',attr:{'aria-label':'查看当前计时'}});this.agendaTimerPill.onclick=()=>this.run(()=>this.host.openTimer!());this.refreshTimerClock(this.timerState!);}
    const allDay=events.filter(e=>e.allDay);
    if(allDay.length)this.paged(section(`全天 · ${allDay.length}`),allDay,(list,event)=>this.agendaEvent(list,event));
    const timed:Array<{minute:number;event?:CalendarEvent;task?:CalendarTask}>=events.filter(e=>!e.allDay).map(event=>({minute:dayKey(new Date(event.start))<dayKey(this.selected)?0:new Date(event.start).getHours()*60+new Date(event.start).getMinutes(),event}));
    timed.push(...tasks.filter(t=>!t.completed&&t.startMinute!==undefined).map(task=>({minute:task.startMinute!,task})));
    timed.sort((a,b)=>a.minute-b.minute);
    const timeline=section(`时间线 · ${timed.length}`);timeline.addClass('tsc-linked-timeline');
    if(!timed.length)timeline.createEl('p',{text:'为待办安排时间，和日程一起查看。',cls:'tsc-muted'});
    this.paged(timeline,timed,(list,item)=>item.event?this.agendaEvent(list,item.event):this.agendaTask(list,item.task!));
    const pending=tasks.filter(t=>!t.completed&&t.startMinute===undefined);
    if(pending.length)this.paged(section(`当日待办 · ${pending.length}`),pending,(list,task)=>this.agendaTask(list,task));
    const completed=tasks.filter(t=>t.completed);
    if(completed.length){const details=this.agenda.createEl('details',{cls:'tsc-agenda-disclosure'});details.createEl('summary',{text:`已完成 · ${completed.length}`});this.paged(details,completed,(list,task)=>this.agendaTask(list,task));}
    if(this.backlog.length){
      const details=this.agenda.createEl('details',{cls:'tsc-agenda-disclosure tsc-backlog'});details.createEl('summary',{text:`待安排 · ${this.backlog.length}`});
      details.createEl('p',{text:'拖到日期或周视图，也可点击时钟安排。',cls:'tsc-muted'});
      this.paged(details,this.backlog,(list,task)=>this.agendaTask(list,task));
    }
    const actual=timerRecordsOnDay(this.timerState?.state.records||[],this.selected),actualMs=actual.reduce((sum,item)=>sum+item.durationMs,0);
    if(actual.length){const list=section(`实际投入 · ${timerMinuteLabel(actualMs)} 分钟`);list.addClass('tsc-actual-list');this.paged(list,actual,(parent,item)=>this.agendaActual(parent,item));}
    this.agenda.querySelectorAll<HTMLDetailsElement>('details').forEach(el=>{el.open=openSections.has(el.className);});this.agenda.scrollTop=scroll;
  }
  private paged<T>(parent:HTMLElement,items:T[],render:(parent:HTMLElement,item:T)=>void):void{
    const list=parent.createDiv({cls:'tsc-agenda-items'});let count=0;
    const more=parent.createEl('button',{cls:'tsc-agenda-more'});
    const append=()=>{for(const item of items.slice(count,count+40))render(list,item);count=Math.min(count+40,items.length);more.textContent=`展开更多（${items.length-count} 项）`;more.hidden=count>=items.length;};
    more.onclick=append;append();
  }
  private agendaEvent(parent:HTMLElement,event:CalendarEvent):void{
    const card=parent.createDiv({cls:'tsc-agenda-entry',attr:{'data-event-id':event.id}});
    card.style.setProperty('--event-accent',/^#[0-9a-f]{6}$/i.test(event.color)?event.color:'#447c83');
    const row=card.createEl('button',{cls:'tsc-agenda-event'});
    row.createSpan({text:event.allDay?'全天':`${datedTime(event.start,this.selected)}–${datedTime(event.end,this.selected)}`,cls:'tsc-agenda-time'});
    row.createEl('strong',{text:event.title});if(event.location)row.createEl('small',{text:event.location});
    row.onclick=()=>{if(Date.now()>this.suppressClickUntil)this.openEvent(event);};this.makeDraggable(row,{kind:'event',event},this.selected);
    if(this.host.openEventNote||this.host.startTimer){
      const actions=card.createDiv({cls:'tsc-entry-actions'}),notes=this.host.eventNotes?.(event)??[];
      if(this.host.openEventNote){
      const open=actions.createEl('button',{cls:'tsc-note-link',attr:{title:notes.map(n=>n.path).join('\n')}});
      setIcon(open.createSpan(),notes.length?'file-text':'file-plus-2');open.createSpan({text:notes.length?notes[0].name:'新建关联笔记'});
      open.onclick=()=>this.run(()=>this.host.openEventNote!(event));
      if(this.host.linkEventNote)this.iconButton(actions,'link','关联已有笔记',()=>this.host.linkEventNote!(event));
      }
      if(this.host.startTimer)this.iconButton(actions,'timer','开始日程计时',()=>this.run(()=>this.startEventTimer(event)));
    }
  }
  private agendaTask(parent:HTMLElement,task:CalendarTask):void{
    const card=parent.createDiv({cls:'tsc-agenda-entry tsc-agenda-task-entry',attr:{'data-task-id':task.id}});card.toggleClass('is-completed',task.completed);
    if(task.startMinute!==undefined)card.createSpan({text:clockLabel(task.startMinute)+(task.endMinute===undefined?'':`–${clockLabel(task.endMinute)}`),cls:'tsc-agenda-time'});
    const row=card.createDiv({cls:'tsc-agenda-task'});
    const check=this.iconButton(row,task.completed?'circle-check':'circle',task.completed?'重新打开任务':'完成任务',()=>void this.perform(()=>this.host.toggleTask!(task)));
    check.disabled=!this.host.toggleTask||this.host.canToggleTask?.(task)===false;check.setAttribute('aria-pressed',String(task.completed));
    if(check.disabled)check.title='重复任务需启用兼容的 Tasks 插件，或在原文中处理';
    const title=row.createEl('button',{cls:'tsc-task-title',text:task.text});title.onclick=()=>{if(Date.now()>this.suppressClickUntil)this.run(()=>this.host.openTask(task));};
    this.makeDraggable(title,{kind:'task',task});
    const foot=card.createDiv({cls:'tsc-entry-actions'});foot.createSpan({text:task.source.split('/').at(-1)?.replace(/\.md$/i,'')||'笔记',cls:'tsc-task-source',attr:{title:task.source}});
    if(this.host.scheduleTask&&calendarTaskCanSchedule(task))this.iconButton(foot,'clock','安排任务时间',()=>this.schedule(task));
    if(!task.completed&&this.host.startPomodoro)this.iconButton(foot,'timer','开始任务计时',()=>this.run(()=>this.host.startPomodoro!(task)));
    if(task.dateRole==='due')foot.createSpan({text:'截止',cls:'tsc-task-deadline'});
  }
  private startEventTimer(event:CalendarEvent):Promise<void>{
    const start=Date.parse(event.start),end=Date.parse(event.end),duration=end-start;
    const target:PomodoroTarget={title:event.title,eventId:event.id,calendarId:event.calendarId,...(Number.isFinite(start)&&Number.isFinite(end)&&duration>0?{plannedStart:start,plannedEnd:end,plannedDurationMs:duration}:{})};
    const minutes=duration/60_000,countdown=!event.allDay&&Number.isFinite(minutes)&&minutes>0&&minutes<=1440;
    return this.host.startTimer!(target,countdown?'countdown':'stopwatch',countdown?Math.max(1,Math.ceil(minutes)):undefined);
  }
  private intervalLabel(start:number,end:number):string{const label=(value:number)=>new Date(value).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});return `${label(start)}–${end===+new Date(new Date(start).getFullYear(),new Date(start).getMonth(),new Date(start).getDate()+1)?'24:00':label(end)}`;}
  private agendaActual(parent:HTMLElement,item:TimerCalendarItem):void{
    const card=parent.createDiv({cls:'tsc-agenda-entry tsc-actual-entry',attr:{'data-record-id':item.id}}),title=card.createEl('button',{cls:'tsc-actual-title',attr:{'aria-label':'查看实际计时来源：'+item.title}});
    title.createEl('small',{text:item.segments.slice(0,3).map(segment=>this.intervalLabel(segment.start,segment.end)).join(' · ')+(item.segments.length>3?` · 另有 ${item.segments.length-3} 段`:'')});title.createEl('strong',{text:item.title});title.onclick=()=>this.run(()=>this.openActual(item));
    const meta=card.createDiv('tsc-actual-meta');meta.createSpan({text:`实际 ${timerMinuteLabel(item.durationMs)} 分钟`});if(item.plannedDurationMs)meta.createSpan({text:`计划 ${timerMinuteLabel(item.plannedDurationMs)} 分钟`});meta.createSpan({text:timerModeLabel(item.mode)});if(item.durationMs!==item.totalDurationMs)meta.createSpan({text:`本次共 ${timerMinuteLabel(item.totalDurationMs)} 分钟`});if(item.estimated)meta.createSpan({text:'旧记录 · 分段估计'});
    const actions=card.createDiv('tsc-entry-actions');if(item.target?.path)this.iconButton(actions,'file-text','打开实际计时来源',()=>this.run(()=>this.openActual(item)));else if(item.target?.eventId)this.iconButton(actions,'calendar-range','查看计划日程',()=>this.run(()=>this.openActual(item)));else if(this.host.openTimer)this.iconButton(actions,'timer','打开计时器记录',()=>this.run(()=>this.host.openTimer!()));
  }
  private async openActual(item:TimerCalendarItem):Promise<void>{
    const target=item.target;if(target?.path){await this.host.openTask({id:`${target.path}:${target.line||0}`,text:item.title,completed:false,date:dayKey(this.selected),source:target.path,line:target.line||0,...(target.source?{sourceSnapshot:target.source}:{})});return;}
    if(target?.eventId){if(Number.isFinite(target.plannedStart))await this.showDay(new Date(target.plannedStart!));const event=this.events.find(event=>event.id===target.eventId&&event.calendarId===target.calendarId&&(!target.plannedStart||Date.parse(event.start)===target.plannedStart));if(event)this.openEvent(event);else if(!Number.isFinite(target.plannedStart))throw Error('原计划日程不在当前日期范围');return;}
    await this.host.openTimer?.();
  }
  private schedule(task:CalendarTask):void{
    if(this.closed||this.saving)return;
    if(this.host.scheduleTask&&calendarTaskCanSchedule(task))new CalendarTaskScheduleModal(this.host,task,new Date(this.selected)).open();
    else this.run(()=>this.host.openTask(task));
  }
  private run(action:()=>Promise<unknown>):void{if(this.closed)return;void Promise.resolve().then(action).catch(e=>{const message=e instanceof Error?e.message:String(e);if(!this.closed)this.status.textContent=message;new Notice(message);});}
  private async perform(action:()=>Promise<unknown>):Promise<void>{
    if(this.closed||this.saving)return;
    this.saving=true;this.revision++;this.contentEl.addClass('is-saving');this.status.textContent='正在保存…';let error:unknown;
    try{await action();}catch(e){error=e;}
    finally{
      this.deferredRefresh=false;this.deferredForce=false;
      // Keep gestures locked until the refreshed cards carry the new source/revision.
      // Only this reconciliation load may bypass the saving guard.
      try{if(!this.closed){await this.loadCalendar(true,true);if(error){const message=error instanceof Error?error.message:String(error);this.status.textContent=message;new Notice(message);}}}
      finally{this.saving=false;this.contentEl.classList.remove('is-saving');this.flushDeferred();}
    }
  }
  private canDrag(item:CalendarDrag):boolean{return item.kind==='task'?!!this.host.scheduleTask&&calendarTaskCanSchedule(item.task):item.event.editable;}
  private makeDraggable(el:HTMLElement,item:CalendarDrag,sourceDay?:Date):void{
    // A continuation opens the same event; only its first-day chip moves the start.
    if(!this.canDrag(item)||item.kind==='event'&&sourceDay&&dayKey(new Date(item.event.start))!==dayKey(sourceDay))return;el.draggable=true;
    el.ondragstart=e=>{
      if(this.saving||this.resizing||this.selecting||!e.dataTransfer){e.preventDefault();return;}
      const token=crypto.randomUUID();this.drag={item,token};e.dataTransfer.setData(dragType,token);e.dataTransfer.effectAllowed='move';el.addClass('is-dragging');
    };
    el.ondragend=()=>{el.classList.remove('is-dragging');this.endDrag();};
  }
  private endDrag():void{
    this.drag=undefined;this.clearDropPreview();
    this.flushDeferred();
  }
  private flushDeferred():void{if(this.drag||this.externalDragging||this.resizing||this.selecting||this.saving||this.closed)return;if(this.deferredRefresh){const force=this.deferredForce;this.deferredRefresh=false;this.deferredForce=false;void this.refresh(force);}else if(this.deferredTimerRefresh)this.refreshTimer();}
  private clearDropPreview():void{this.contentEl.querySelectorAll('.is-drop-target').forEach(el=>el.classList.remove('is-drop-target'));this.contentEl.querySelectorAll('.tsc-drop-preview').forEach(el=>el.remove());}
  private dropTarget(el:HTMLElement,day:Date,timed:boolean):void{
    const minute=(y:number)=>Math.min(1425,snapCalendarMinute((y-el.getBoundingClientRect().top)/el.getBoundingClientRect().height*1440));
    el.ondragover=e=>{
      const external=canReadCalendarTaskDrag(this.host.app,e.dataTransfer);
      if(this.saving||!e.dataTransfer||!external&&(!this.drag||!e.dataTransfer.types.includes(dragType))||timed&&this.drag?.item.kind==='event'&&this.drag.item.event.allDay)return;
      this.externalDragging=external;
      this.win.clearTimeout(this.externalDragTimer);if(external)this.externalDragTimer=this.win.setTimeout(()=>{this.externalDragging=false;this.clearDropPreview();this.flushDeferred();},350);
      e.preventDefault();e.dataTransfer.dropEffect='move';this.clearDropPreview();el.addClass('is-drop-target');
      if(timed){const at=minute(e.clientY),preview=el.createDiv({cls:'tsc-drop-preview',text:clockLabel(at)});preview.style.top=`${at/1440*100}%`;}
    };
    el.ondragleave=e=>{if(!el.contains(e.relatedTarget as Node|null))this.clearDropPreview();};
    el.ondrop=e=>{
      const drag=this.drag,external=readCalendarTaskDrag(this.host.app,e.dataTransfer);
      if(this.saving||!e.dataTransfer||!external&&(!drag||e.dataTransfer.getData(dragType)!==drag.token))return;
      const item:CalendarDrag=external?{kind:'task',task:external}:drag!.item;
      if(timed&&item.kind==='event'&&item.event.allDay)return;
      e.preventDefault();e.stopPropagation();const at=timed?minute(e.clientY):undefined;
      this.suppressClickUntil=Date.now()+300;this.drag=undefined;this.externalDragging=false;endCalendarTaskDrag(this.host.app);this.clearDropPreview();this.selected=new Date(day);this.saveLayout();
      void this.perform(()=>this.moveItem(item,day,at));
    };
  }
  private async moveItem(item:CalendarDrag,day:Date,minute?:number):Promise<void>{
    if(item.kind==='task'){await this.host.scheduleTask!(item.task,dayKey(day),minute);return;}
    const detail=await this.host.apple.detail(item.event);
    if(this.closed)throw Error('日历已关闭，操作已取消');
    if(detail.revision!==item.event.revision)throw Error('日程已在苹果日历中更新，请刷新后重新调整');
    const draft=eventMoveDraft(detail,dayKey(day),minute);
    if(draft.start===detail.start&&draft.end===detail.end)return;
    const saved=await this.host.apple.save(draft);
    await this.preserveEventLinks(detail,saved);
  }
  private async preserveEventLinks(before:CalendarEvent,after:CalendarEvent){
    try{await this.host.eventMoved?.(before,after);}catch{throw Error('日程已保存，但笔记关联更新失败，请重新关联已有笔记');}
  }
  private resizeHandle(chip:HTMLElement,column:HTMLElement,day:Date,item:CalendarDrag):void{
    if(!this.canDrag(item)||item.kind==='event'&&(item.event.allDay||Date.parse(item.event.end)>+addDays(day,1)||Date.parse(item.event.end)<=+day))return;
    const handle=chip.createSpan({cls:'tsc-resize-handle',attr:{title:'拖动调整结束时间；精确时间可打开编辑'}});
    handle.onpointerdown=e=>{
      if(e.button!==0||e.isPrimary===false||this.closed||this.saving||this.drag||this.externalDragging||this.resizing||this.selecting)return;
      const rect=column.getBoundingClientRect();if(rect.height<=0||rect.width<=0||column.clientWidth<=0)return;
      e.preventDefault();e.stopPropagation();
      const original=chip.style.height,originalTitle=handle.title,pointer=e.pointerId,initialY=e.clientY;
      const start=item.kind==='task'?item.task.startMinute!:Date.parse(item.event.start)<+day?0:new Date(item.event.start).getHours()*60+new Date(item.event.start).getMinutes();
      const oldEnd=item.kind==='task'?item.task.endMinute??start+30:dayKey(new Date(item.event.end))>dayKey(day)?1440:new Date(item.event.end).getHours()*60+new Date(item.event.end).getMinutes();
      let end=oldEnd,moved=false,active=true;const wasDraggable=chip.draggable;chip.draggable=false;chip.addClass('is-resizing');
      const move=(event:PointerEvent)=>{
        if(!active||event.pointerId!==pointer)return;
        const current=column.getBoundingClientRect();
        if(!column.isConnected||current.height<=0||current.width<=0||column.clientWidth<=0){cancel();return;}
        // Do not snap a manually entered minute merely because the pointer jitters.
        if(!moved&&Math.abs(event.clientY-initialY)<4)return;moved=true;
        // A scroll or split-pane resize changes the grid's coordinates mid-gesture.
        end=Math.min(item.kind==='task'?1439:1440,Math.max(start+15,snapCalendarMinute((event.clientY-current.top)/current.height*1440)));
        chip.style.height=`max(28px,${(end-start)/1440*100}%)`;
        handle.title=`结束 ${clockLabel(Math.min(1439,end))}`;
        chip.dataset.rangeLabel=`${clockLabel(start)}–${end===1440?'24:00':clockLabel(end)} · ${end-start} 分钟`;
      };
      const cleanup=()=>{
        if(!active)return;active=false;
        this.win.removeEventListener('pointermove',move);this.win.removeEventListener('pointerup',up);this.win.removeEventListener('pointercancel',cancelPointer);this.win.removeEventListener('blur',cancel);handle.removeEventListener('lostpointercapture',cancelPointer);
        this.resizing=undefined;chip.style.height=original;chip.draggable=wasDraggable;chip.classList.remove('is-resizing');delete chip.dataset.rangeLabel;handle.title=originalTitle;
        if(handle.hasPointerCapture?.(pointer))handle.releasePointerCapture(pointer);
      };
      const cancel=()=>{if(!active)return;cleanup();this.suppressClickUntil=Date.now()+300;this.flushDeferred();};
      const cancelPointer=(event:PointerEvent)=>{if(event.pointerId===pointer)cancel();};
      const up=(event:PointerEvent)=>{
        if(!active||event.pointerId!==pointer)return;move(event);if(!active)return;cleanup();this.suppressClickUntil=Date.now()+300;
        if(!moved||end===oldEnd){this.flushDeferred();return;}
        void this.perform(async()=>{
          if(item.kind==='task')await this.host.scheduleTask!(item.task,dayKey(day),start,Math.min(1439,end));
          else{const detail=await this.host.apple.detail(item.event);if(this.closed)throw Error('日历已关闭，操作已取消');if(detail.revision!==item.event.revision)throw Error('日程已更新，请刷新后再调整');const saved=await this.host.apple.save(eventResizeDraft(detail,dayKey(day),end));await this.preserveEventLinks(detail,saved);}
        });
      };
      this.resizing=cancel;this.win.addEventListener('pointermove',move);this.win.addEventListener('pointerup',up);this.win.addEventListener('pointercancel',cancelPointer);this.win.addEventListener('blur',cancel);handle.addEventListener('lostpointercapture',cancelPointer);
      try{handle.setPointerCapture?.(pointer);}catch{}
    };
  }
  private selectTimeRange(column:HTMLElement,day:Date):void {
    column.onpointerdown=e=>{
      // A task/event/resize handle owns its own gesture; only the bare grid selects.
      if(e.target!==column||e.button!==0||e.isPrimary===false||this.closed||this.saving||this.drag||this.externalDragging||this.resizing||this.selecting)return;
      const rect=column.getBoundingClientRect();if(rect.height<=0||rect.width<=0||column.clientWidth<=0)return;
      e.preventDefault();
      const pointer=e.pointerId,anchor=(e.clientY-rect.top)/rect.height*1440,initialY=e.clientY;
      let range=calendarTimeRange(anchor,anchor),preview:HTMLElement|undefined,previewLabel:HTMLElement|undefined,previewTime:HTMLElement|undefined,previewDuration:HTMLElement|undefined,moved=false,active=true;
      const move=(event:PointerEvent)=>{
        if(!active||event.pointerId!==pointer)return;
        if(!moved&&Math.abs(event.clientY-initialY)<4)return;moved=true;
        const current=column.getBoundingClientRect();if(!column.isConnected||current.height<=0||current.width<=0||column.clientWidth<=0){cancel();return;}
        range=calendarTimeRange(anchor,(event.clientY-current.top)/current.height*1440);
        if(!preview){preview=column.createDiv({cls:'tsc-range-preview',attr:{role:'status','aria-live':'polite'}});previewLabel=preview.createDiv({cls:'tsc-week-selection-preview'});previewTime=previewLabel.createSpan({cls:'tsc-preview-time'});previewDuration=previewLabel.createSpan({cls:'tsc-preview-duration'});}
        preview.dataset.start=String(range.start);preview.dataset.end=String(range.end);
        preview.dataset.placement=range.start<60?'below':'above';
        preview.style.top=`${range.start/1440*100}%`;preview.style.height=`${(range.end-range.start)/1440*100}%`;
        previewTime!.textContent=`${clockLabel(range.start)}–${clockLabel(range.end)}`;previewDuration!.textContent=`${range.end-range.start} 分钟`;
        const visibleTop=Math.max(this.main.getBoundingClientRect().top,this.main.querySelector('.tsc-week-header')?.getBoundingClientRect().bottom??0);
        if(preview.getBoundingClientRect().top-previewLabel!.getBoundingClientRect().height-4<visibleTop+4)preview.dataset.placement='below';
        column.addClass('is-selecting-range');
      };
      const cleanup=()=>{
        if(!active)return;active=false;
        this.win.removeEventListener('pointermove',move);this.win.removeEventListener('pointerup',up);this.win.removeEventListener('pointercancel',cancelPointer);this.win.removeEventListener('blur',cancel);column.removeEventListener('lostpointercapture',cancelPointer);
        preview?.remove();column.classList.remove('is-selecting-range');this.selecting=undefined;
        if(column.hasPointerCapture?.(pointer))column.releasePointerCapture(pointer);
      };
      const cancel=()=>{cleanup();this.suppressClickUntil=Date.now()+300;this.flushDeferred();};
      const cancelPointer=(event:PointerEvent)=>{if(event.pointerId===pointer)cancel();};
      const up=(event:PointerEvent)=>{
        if(!active||event.pointerId!==pointer)return;move(event);if(!active)return;cleanup();
        if(!moved){this.flushDeferred();return;}
        this.suppressClickUntil=Date.now()+300;
        const start=new Date(day),end=new Date(day);start.setHours(0,range.start,0,0);end.setHours(0,range.end,0,0);
        this.select(day);this.openEvent(undefined,start,end);this.flushDeferred();
      };
      this.selecting=cancel;
      this.win.addEventListener('pointermove',move);this.win.addEventListener('pointerup',up);this.win.addEventListener('pointercancel',cancelPointer);this.win.addEventListener('blur',cancel);column.addEventListener('lostpointercapture',cancelPointer);
      // Capture can be unavailable after window reparenting; window listeners still clean up.
      try{column.setPointerCapture?.(pointer);}catch{}
    };
  }
  private openEvent(event?:CalendarEvent,date?:Date,endDate?:Date):void {
    if(this.closed||this.saving)return;
    if(!this.host.appleSettings().enabled) { new AppleCalendarConnectionModal(this.host).open(); return; }
    const selected=new Date(date??this.selected);
    if(!date) selected.setHours(9,0,0,0);
    new CalendarEventModal(this.host,selected,event,endDate).open();
  }
  private iconButton(parent:HTMLElement,icon:string,title:string,callback:()=>void):HTMLButtonElement {
    const button=parent.createEl('button',{cls:'tsc-icon-button',attr:{'aria-label':title,title}}); setIcon(button,icon); button.onclick=callback; return button;
  }
}
