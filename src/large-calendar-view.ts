import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import { addDays, dayKey, eventsOnDay, movePeriod, occurrenceKey, parseDay, timedSegments, visibleDays, type CalendarEvent, type CalendarMode, type CalendarTask } from './calendar-model';
import { AppleCalendarConnectionModal, CalendarEventModal, type CalendarHost } from './calendar-modals';

export interface LargeCalendarHost extends CalendarHost {
  tasks(start:Date,end:Date):Promise<CalendarTask[]>;
  openJournal(date:Date):Promise<void>;
  openTask(task:CalendarTask):Promise<void>;
  lunar?(date:Date):string;
}
const weekday=['一','二','三','四','五','六','日'];
const time=(date:string)=>new Date(date).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
// Obsidian briefly replaces unregistered custom views during plugin reload. Its placeholder
// drops view state. Keep only three small navigation values on the existing leaf, whose
// lifetime Obsidian controls; no global cache, note content or additional settings writes.
const resumeState=Symbol.for('thoughtspace-calendar.large-calendar-resume');

export class LargeCalendarView extends ItemView {
  static readonly type='thoughtspace-large-calendar';
  private mode:CalendarMode='month';
  private selected=new Date();
  private anchor=new Date();
  private events:CalendarEvent[]=[];
  private tasks:CalendarTask[]=[];
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
    this.iconButton(actions,'refresh-cw','刷新日程和任务',()=>void this.refresh(true));
    this.iconButton(actions,'calendar-cog','苹果日历连接与选择',()=>new AppleCalendarConnectionModal(this.host).open());
    const create=actions.createEl('button',{cls:'mod-cta tsc-add-event'}); setIcon(create.createSpan(),'plus'); create.createSpan({text:'新日程'});
    create.onclick=()=>this.openEvent();
    const body=this.contentEl.createDiv({cls:'tsc-large-body'});
    this.main=body.createDiv({cls:'tsc-large-main'}); this.agenda=body.createEl('aside',{cls:'tsc-day-agenda'});
    this.status=this.contentEl.createDiv({cls:'tsc-large-status',attr:{role:'status','aria-live':'polite'}});
    // Refresh external edits only while this pane is visible. No calendar database scans in hidden panes.
    this.registerDomEvent(this.win,'focus',()=> { if(this.visible()) void this.refresh(); });
    this.timer=this.win.setInterval(()=> { if(this.visible()&&this.host.appleSettings().enabled) void this.refresh(); },60000);
    this.register(()=>this.win.clearInterval(this.timer));
    await this.refresh();
  }
  async onClose():Promise<void> { (this.leaf as unknown as Record<symbol,unknown>)[resumeState]=this.getState();this.closed=true; this.revision++;this.win?.clearInterval(this.timer); this.contentEl.empty(); }
  private visible():boolean { return !this.closed && this.contentEl.isConnected && this.contentEl.getBoundingClientRect().width>0 && !this.contentEl.ownerDocument.hidden; }
  private navigate(direction:number):void { this.anchor=movePeriod(this.anchor,this.mode,direction); this.selected=new Date(this.anchor);this.saveLayout(); void this.refresh(); }
  async refresh(force=false):Promise<void> {
    if(this.closed) return;
    const revision=++this.revision; const days=visibleDays(this.anchor,this.mode), end=addDays(days.at(-1)!,1);
    this.title.textContent=this.mode==='month'?`${this.anchor.getFullYear()} 年 ${this.anchor.getMonth()+1} 月`:
      `${days[0].getMonth()+1} 月 ${days[0].getDate()} 日 — ${days[6].getMonth()+1} 月 ${days[6].getDate()} 日`;
    for(const [mode,button] of this.modeButtons) button.setAttribute('aria-pressed',String(mode===this.mode));
    this.status.textContent='正在加载…';
    const results=await Promise.allSettled([this.host.apple.events(days[0],end,force),this.host.tasks(days[0],end)]);
    if(this.closed||revision!==this.revision) return;
    const [apple,tasks]=results;
    this.events=apple.status==='fulfilled'?apple.value.events:[];
    this.tasks=tasks.status==='fulfilled'?tasks.value:[];
    this.renderCalendar(days); this.renderAgenda();
    if(apple.status==='rejected') this.status.textContent=apple.reason instanceof Error?apple.reason.message:'苹果日程加载失败';
    else if(tasks.status==='rejected') this.status.textContent='本地任务加载失败，可点击刷新重试';
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
      cell.toggleClass('is-other-month',day.getMonth()!==this.anchor.getMonth());
      cell.toggleClass('is-selected',key===dayKey(this.selected)); cell.toggleClass('is-today',key===today);
      const head=cell.createDiv({cls:'tsc-day-header'});
      const select=head.createEl('button',{text:String(day.getDate()),cls:'tsc-day-number',attr:{'aria-label':`${key}，查看日程和任务`}});
      select.onclick=()=>this.select(day);
      const lunar=this.host.lunar?.(day); if(lunar) head.createSpan({text:lunar,cls:'tsc-cell-lunar'});
      this.iconButton(head,'plus','在此日新建日程',()=> { const at=new Date(day); at.setHours(9); this.openEvent(undefined,at); }).addClass('tsc-day-add');
      const events=eventsOnDay(this.events,day);
      for(const event of events.slice(0,3)) this.eventChip(cell,event);
      const tasks=this.tasks.filter(task=>task.date===key&&!task.completed);
      if(tasks.length) {
        const badge=cell.createEl('button',{cls:'tsc-cell-tasks',text:`${tasks.length} 项待办`}); badge.onclick=()=>this.select(day);
      }
      if(events.length>3) {
        const more=cell.createEl('button',{text:`+${events.length-3} 项日程`,cls:'tsc-cell-more'}); more.onclick=()=>this.select(day);
      }
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
    const header=scroll.createDiv({cls:'tsc-week-header'}); header.createSpan();
    days.forEach((date,i)=> {
      const button=header.createEl('button',{cls:'tsc-week-heading',attr:{'data-date':dayKey(date)}});
      button.createSpan({text:`周${weekday[i]}`}); button.createEl('strong',{text:String(date.getDate())});
      button.toggleClass('is-today',dayKey(date)===dayKey(new Date())); button.onclick=()=>this.select(date);
    });
    const allDay=scroll.createDiv({cls:'tsc-week-allday'}); allDay.createSpan({text:'全天'});
    for(const day of days) {
      const column=allDay.createDiv(); const events=eventsOnDay(this.events,day).filter(e=>e.allDay);
      for(const event of events.slice(0,3)) this.eventChip(column,event);
      if(events.length>3) {
        const more=column.createEl('button',{text:`+${events.length-3} 项`,cls:'tsc-cell-more'}); more.onclick=()=>this.select(day);
      }
    }
    const body=scroll.createDiv({cls:'tsc-week-timegrid'});
    const axis=body.createDiv({cls:'tsc-hour-axis'});
    for(let hour=0;hour<24;hour++) axis.createSpan({text:`${String(hour).padStart(2,'0')}:00`});
    for(const day of days) {
      const column=body.createDiv({cls:'tsc-week-column',attr:{'data-date':dayKey(day)}});
      const taskEvents=new Map<CalendarEvent,CalendarTask>();
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
        const chip=task?column.createEl('button',{cls:'tsc-event-chip tsc-task-chip',text:task.text}):this.eventChip(column,segment.event);
        if(task) { chip.style.setProperty('--event-accent','#6b997a'); chip.onclick=(e)=> { e.stopPropagation(); void this.host.openTask(task); }; }
        chip.addClass('tsc-week-event');
        chip.style.top=`${segment.start/1440*100}%`; chip.style.height=`max(28px, ${Math.max(15,segment.end-segment.start)/1440*100}%)`;
        chip.style.left=`calc(${segment.lane/segment.lanes*100}% + 3px)`;
        chip.style.width=`calc(${100/segment.lanes}% - 6px)`;
      }
      if(segments.length>60) {
        const more=column.createEl('button',{text:`另有 ${segments.length-60} 项`,cls:'tsc-week-overflow'});
        more.onclick=(e)=> { e.stopPropagation(); this.select(day); };
      }
      column.onclick=(e)=> {
        if(e.target!==column) return;
        const rect=column.getBoundingClientRect();
        const minute=Math.max(0,Math.min(1410,Math.round((e.clientY-rect.top)/rect.height*1440/30)*30));
        const date=new Date(day); date.setHours(0,minute,0,0); this.openEvent(undefined,date);
      };
      if(dayKey(day)===dayKey(new Date())) {
        const now=new Date(); const line=column.createDiv({cls:'tsc-now-line'}); line.style.top=`${(now.getHours()*60+now.getMinutes())/1440*100}%`;
      }
    }
  }
  private eventChip(parent:HTMLElement,event:CalendarEvent):HTMLButtonElement {
    const chip=parent.createEl('button',{cls:'tsc-event-chip',attr:{title:`${event.title}${event.allDay?' · 全天':` · ${time(event.start)}–${time(event.end)}`}`}});
    chip.style.setProperty('--event-accent',/^#[0-9a-f]{6}$/i.test(event.color)?event.color:'#447c83');
    chip.dataset.occurrence=occurrenceKey(event);
    if(!event.allDay) chip.createEl('small',{text:time(event.start)});
    chip.createSpan({text:event.title}); chip.onclick=(e)=> { e.stopPropagation(); this.openEvent(event); }; return chip;
  }
  private renderAgenda():void {
    this.agenda.empty();
    const head=this.agenda.createDiv({cls:'tsc-agenda-heading'});
    head.createSpan({text:this.selected.toLocaleDateString('zh-CN',{weekday:'long'}),cls:'tsc-eyebrow'});
    head.createEl('h3',{text:`${this.selected.getMonth()+1} 月 ${this.selected.getDate()} 日`});
    const actions=head.createDiv({cls:'tsc-agenda-actions'});
    const journal=actions.createEl('button',{text:'打开日记'}); journal.onclick=()=>void this.host.openJournal(new Date(this.selected));
    this.iconButton(actions,'plus','新建日程',()=>this.openEvent());
    const events=eventsOnDay(this.events,new Date(this.selected.getFullYear(),this.selected.getMonth(),this.selected.getDate()));
    this.agenda.createEl('h4',{text:`日程 · ${events.length}`});
    const list=this.agenda.createDiv({cls:'tsc-agenda-list'});
    if(!events.length) list.createEl('p',{text:'没有日程安排',cls:'tsc-muted'});
    let shown=0;
    const appendEvents=()=> {
    for(const event of events.slice(shown,shown+50)) {
      const row=list.createEl('button',{cls:'tsc-agenda-event'});
      row.createSpan({text:event.allDay?'全天':`${time(event.start)}–${time(event.end)}`,cls:'tsc-agenda-time'});
      row.createEl('strong',{text:event.title}); if(event.location) row.createEl('small',{text:event.location});
      row.style.setProperty('--event-accent',/^#[0-9a-f]{6}$/i.test(event.color)?event.color:'#447c83');
      row.onclick=()=>this.openEvent(event);
    }
    shown=Math.min(shown+50,events.length);
    };
    appendEvents();
    if(shown<events.length) {
      const more=this.agenda.createEl('button',{text:`展开更多（${events.length-shown} 项）`,cls:'tsc-agenda-more'});
      more.onclick=()=> { appendEvents(); more.textContent=`展开更多（${events.length-shown} 项）`; more.hidden=shown>=events.length; };
    }
    const tasks=this.tasks.filter(task=>task.date===dayKey(this.selected));
    this.agenda.createEl('h4',{text:`待办 · ${tasks.filter(t=>!t.completed).length}`});
    const taskList=this.agenda.createDiv({cls:'tsc-agenda-list'});
    if(!tasks.length) taskList.createEl('p',{text:'没有当日待办',cls:'tsc-muted'});
    for(const task of tasks.slice(0,100)) {
      const row=taskList.createEl('button',{cls:'tsc-agenda-task'}); setIcon(row.createSpan(),task.completed?'circle-check':'circle');
      row.createSpan({text:task.text}); row.toggleClass('is-completed',task.completed); row.onclick=()=>void this.host.openTask(task);
    }
    if(tasks.length>100) taskList.createEl('p',{text:`另有 ${tasks.length-100} 项，请在任务管理中查看`,cls:'tsc-muted'});
  }
  private openEvent(event?:CalendarEvent,date?:Date):void {
    if(!this.host.appleSettings().enabled) { new AppleCalendarConnectionModal(this.host).open(); return; }
    const selected=new Date(date??this.selected);
    if(!date) selected.setHours(9,0,0,0);
    new CalendarEventModal(this.host,selected,event).open();
  }
  private iconButton(parent:HTMLElement,icon:string,title:string,callback:()=>void):HTMLButtonElement {
    const button=parent.createEl('button',{cls:'tsc-icon-button',attr:{'aria-label':title,title}}); setIcon(button,icon); button.onclick=callback; return button;
  }
}
