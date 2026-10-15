import {ChineseCalendar,ChineseCalendarOptions,chineseDayPresentation} from './chinese-calendar';
import {preserveTaskFilterFocus} from './ui-focus';
import {DayTimeline,DayTimelineState} from './day-timeline-view';
import {TaskPlanner} from './task-planner';
import {TaskPanel,TaskPanelState} from './task-planner-view';
import { Component, ItemView, MarkdownRenderer, Menu, Modal, Notice, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import { localDay } from './filing';
import { adjacentJournalDay, calendarKeyDay, appendJournalTask, dateOf, isoWeek, periodSpec, journalPaths, monthDisplayGrid, reviewContent, shiftDay, shiftMonth, weekDays, journalExcerpt } from './calendar-tools';
import { extractTasks, Task, toggleTask } from './model';
import { TextModal } from './content-tools';
import {journalPresentation} from './journal-presentation';
import type {PomodoroActions,PomodoroController} from './pomodoro';
import {PomodoroStrip} from './pomodoro-strip';
import {PomodoroPanel} from './pomodoro-view';
import type {PomodoroTarget} from './pomodoro-model';
export const JOURNAL='thoughtspace-journal';
export const CALENDAR='thoughtspace-calendar';
export interface JournalHost {
  settings:ChineseCalendarOptions&{journalFolder:string;surfaceStyle?:'soft'|'paper';accent?:string;glassEffects?:boolean};getJournalFile(day?:string):Promise<TFile>;editJournal(file:TFile):void;
  ensureDock?(reveal?:boolean):Promise<WorkspaceLeaf>;createUnique(folder:string,title:string,extension:string,text:string):Promise<TFile>;
  quickCapture():void;taskPlanner?:TaskPlanner;pomodoroActions?:PomodoroActions;pomodoro?:PomodoroController;
  currentBoard?:{file:TFile|null};journalLinks?:{sync(day:string,file:TFile):Promise<void>};
  selectJournalDay?(day:string):Promise<void>;selectJournalMonth?(day:string,month:string,todo:boolean):Promise<void>;
  openLargeCalendar?(day?:string):Promise<void>;
  openTimerTarget?(target:PomodoroTarget):Promise<void>;
}
type Entry={day:string;file:TFile;text:string;tasks:Task[]};
export class JournalView extends ItemView {
  private renderScope?:Component;private generation=0;private closed=false;private day=localDay();private month=this.day.slice(0,7);private today=localDay();
  private timerPanel?:PomodoroPanel;private timerPanelElement?:HTMLElement;
  private topPane:'calendar'|'timer'='calendar';private topPanels?:{calendar:HTMLElement;timer:HTMLElement};private topButtons?:Map<'calendar'|'timer',HTMLButtonElement>;
  private mode:'day'|'week'|'agenda'='day';private query='';private onlyTodo=false;private refreshTimer?:number;
  private timelineState:DayTimelineState={};private taskPanelState:TaskPanelState={};private calendarCollapsed=false;private linkedNotesOpen=new Set<string>();
  private pendingTasks=new Set<string>();private sort:'newest'|'oldest'='newest';private focusedDay=this.day;private drafts=new Map<string,string>();private visibleEntries=new Map<string,Entry>();
  private chinese=new ChineseCalendar();private calendarView:'month'|'year'='month';
  private cache=new Map<string,{key:string;text:string}>();
  constructor(leaf:WorkspaceLeaf,private host:JournalHost,private part:'combined'|'calendar'|'entries'='combined'){super(leaf);}
  getViewType(){return this.part==='calendar'?CALENDAR:JOURNAL;}getDisplayText(){return this.part==='calendar'?'日历':this.part==='entries'?'日记与清单':'日历与日记';}getIcon(){return this.part==='entries'?'notebook-pen':'calendar-days';}
  getState(){return {topPane:this.topPane,calendarView:this.calendarView,timeline:{...this.timelineState},day:this.day,month:this.month,mode:this.mode,sort:this.sort,onlyTodo:this.onlyTodo,calendarCollapsed:this.calendarCollapsed,taskView:this.taskPanelState.view||'list'};}
  async setState(state:Record<string,unknown>){if(state.topPane==='calendar'||state.topPane==='timer')this.topPane=state.topPane;if(state.calendarView==='month'||state.calendarView==='year')this.calendarView=state.calendarView;if(state.timeline&&typeof state.timeline==='object'){for(const key of ['collapsed','hideDone','untimedOpen'] as const){const value=(state.timeline as Record<string,unknown>)[key];if(typeof value==='boolean')this.timelineState[key]=value;}}if(state.taskView==='list'||state.taskView==='quadrants'||state.taskView==='timeline')this.taskPanelState={...this.taskPanelState,view:state.taskView};if(typeof state.calendarCollapsed==='boolean')this.calendarCollapsed=state.calendarCollapsed;if(state.sort==='newest'||state.sort==='oldest')this.sort=state.sort;if(typeof state.onlyTodo==='boolean')this.onlyTodo=state.onlyTodo;try{if(typeof state.day==='string'){dateOf(state.day);this.day=state.day;}if(typeof state.month==='string'){dateOf(`${state.month}-01`);this.month=state.month;}if(state.mode==='day'||state.mode==='week'||state.mode==='agenda')this.mode=state.mode;}catch{this.day=localDay();this.month=this.day.slice(0,7);}this.focusedDay=this.day;if(this.contentEl.isConnected)await this.refresh();}
  async onOpen(){this.closed=false;this.contentEl.addClass('ts-journal');this.contentEl.addClass('ts-calendar-plugin');if(this.host.ensureDock){const space=this.addAction('network','打开知识空间',()=>{void this.host.ensureDock?.(true);});this.register(()=>space.remove());}
    const changed=(path:string)=>{if(path.startsWith(this.host.settings.journalFolder+'/')){this.cache.delete(path);this.schedule();}};
    this.registerEvent(this.app.vault.on('modify',f=>changed(f.path)));this.registerEvent(this.app.vault.on('create',f=>changed(f.path)));this.registerEvent(this.app.vault.on('delete',f=>changed(f.path)));
    this.registerEvent(this.app.vault.on('rename',(f,old)=>{changed(old);changed(f.path);}));
    this.registerInterval(window.setInterval(()=>{const today=localDay();if(today!==this.today){if(this.day===this.today){this.day=today;this.month=today.slice(0,7);}this.today=today;this.schedule();}},30000));
    await this.refresh();
  }
  private schedule(){if(this.closed)return;window.clearTimeout(this.refreshTimer);this.refreshTimer=window.setTimeout(()=>{this.refreshTimer=undefined;void this.refresh();},120);}
  todayPath(day=localDay()){return journalPaths(day,this.host.settings.journalFolder)[0];}
  private find(day:string,root=this.host.settings.journalFolder){for(const path of journalPaths(day,root)){const f=this.app.vault.getAbstractFileByPath(path);if(f instanceof TFile)return f;}return undefined;}
  async showDay(day:string,sync=true){dateOf(day);if(sync&&this.part!=='combined'&&this.host.selectJournalDay){await this.host.selectJournalDay(day);return;}this.calendarView='month';this.day=day;this.focusedDay=day;this.month=day.slice(0,7);this.mode='day';this.app.workspace.requestSaveLayout();await this.refresh();}
  private async shiftWeek(amount:number){this.day=shiftDay(this.day,amount*7);this.month=this.day.slice(0,7);this.app.workspace.requestSaveLayout();await this.refresh();}
  private async openNote(file:TFile){const existing=this.app.workspace.getLeavesOfType('markdown').find(l=>(l.view as {file?:TFile}).file===file);const leaf=existing||this.app.workspace.getLeaf('tab');if(!existing)await leaf.openFile(file);await this.app.workspace.revealLeaf(leaf);this.app.workspace.setActiveLeaf(leaf,{focus:true});}
  async openDay(day:string){await this.showDay(day);if(this.part==='calendar')return this.find(day);const file=await this.host.getJournalFile(day);if(this.day===day){await this.openNote(file);await this.refresh();}return file;}
  private control(parent:HTMLElement,label:string,icon:string,fn:()=>unknown,showText=false){const b=parent.createEl('button',{attr:{'aria-label':label,title:label}});if(icon)setIcon(b.createSpan({attr:{'aria-hidden':'true'}}),icon);if(!icon||showText)b.createSpan({text:label});b.onclick=()=>{b.disabled=true;Promise.resolve().then(fn).catch(e=>new Notice(String(e))).finally(()=>b.disabled=false);};return b;}
  private async entry(day:string):Promise<Entry|undefined>{const file=this.find(day);if(!file)return;const key=`${file.stat.mtime}:${file.stat.size}`;let cached=this.cache.get(file.path);if(cached?.key!==key){cached={key,text:await this.app.vault.cachedRead(file)};this.cache.set(file.path,cached);let chars=[...this.cache.values()].reduce((sum,item)=>sum+item.text.length,0);while(this.cache.size>96||chars>1048576){const oldest=this.cache.keys().next().value;if(!oldest)break;chars-=this.cache.get(oldest)!.text.length;this.cache.delete(oldest);}}return {day,file,text:cached.text,tasks:extractTasks(cached.text)};}
  private periodQueue:Promise<unknown>=Promise.resolve();
  createReview(kind:'week'|'month'|'quarter'|'year',anchor=kind==='week'?this.day:`${this.month}-01`):Promise<TFile>{
    const spec=periodSpec(kind,anchor),root=this.host.settings.journalFolder;
    const work=this.periodQueue.catch(()=>{}).then(async()=>{
      const folder=`${root}/周期/${spec.year}`,paths=[`${folder}/${spec.title}.md`,...(spec.legacyTitle?[`${root}/回顾/${spec.days[0].slice(0,4)}/${spec.legacyTitle}.md`]:[])];
      for(const path of paths){const existing=this.app.vault.getAbstractFileByPath(path);if(existing instanceof TFile){await this.openNote(existing);return existing;}}
      const entries=spec.days.flatMap(day=>{const file=this.find(day,root);return file?[{day,path:file.path}]:[];});
      const file=await this.host.createUnique(folder,spec.title,'md',reviewContent(spec.title,entries));await this.openNote(file);return file;
    });this.periodQueue=work;return work;
  }
  private openDatePicker(){
    const modal=new Modal(this.app);modal.modalEl.addClass('ts-calendar-plugin');modal.modalEl.addClass('ts-journal-jump-modal');modal.titleEl.setText('跳转日期');
    const input=modal.contentEl.createEl('input',{cls:'ts-calendar-jump',type:'date',value:this.day,attr:{'aria-label':'跳转日期'}});
    this.control(modal.contentEl,'查看日期','arrow-right',async()=>{await this.showDay(input.value);modal.close();},true);
    input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();void this.showDay(input.value).then(()=>modal.close()).catch(e=>new Notice(String(e)));}};
    const months=modal.contentEl.createDiv('ts-journal-month-picker');let year=Number(this.month.slice(0,4));
    const nav=modal.contentEl.createDiv('ts-journal-picker-year');const label=nav.createSpan();
    const render=()=>{label.setText(String(year));months.empty();for(let i=1;i<=12;i++){const month=`${year}-${String(i).padStart(2,'0')}`;const b=this.control(months,`${i}月`,'',async()=>{this.month=month;this.focusedDay=month+'-01';this.app.workspace.requestSaveLayout();await this.refresh();modal.close();});b.toggleClass('is-selected',month===this.month);}};
    this.control(nav,'上一年','chevron-left',()=>{if(year>1000)year--;render();});this.control(nav,'下一年','chevron-right',()=>{if(year<9998)year++;render();});render();modal.open();input.focus();
  }
  private knownDays(){const root=this.host.settings.journalFolder;return this.app.vault.getMarkdownFiles().flatMap(f=>{const day=f.basename;try{dateOf(day);return journalPaths(day,root).includes(f.path)?[day]:[];}catch{return [];}});}
  private async jumpEntry(direction:-1|1){const target=adjacentJournalDay(this.knownDays(),this.day,direction);if(target)await this.showDay(target);}
  private async calendarKey(event:KeyboardEvent,day:string){
    const target=calendarKeyDay(day,event.key,event.shiftKey);if(!target)return;event.preventDefault();event.stopPropagation();this.focusedDay=target;
    if(target.slice(0,7)!==this.month){this.month=target.slice(0,7);this.app.workspace.requestSaveLayout();await this.refresh();}
    this.contentEl.querySelectorAll<HTMLButtonElement>('.ts-calendar-day').forEach(b=>b.tabIndex=b.dataset.day===target?0:-1);
    this.contentEl.querySelector<HTMLButtonElement>(`[data-day="${target}"]`)?.focus();
  }
  async appendTask(task:string){const day=this.day;appendJournalTask('',task);const f=await this.host.getJournalFile(day);await this.app.vault.process(f,text=>appendJournalTask(text,task));await this.refresh();}
  async linkBoard(){const day=this.day,board=this.host.currentBoard?.file;if(!(board instanceof TFile))throw Error('请先打开要关联的白板');const link=`[[${board.path}]]`,f=await this.host.getJournalFile(day);await this.app.vault.process(f,text=>text.includes(link)?text:`${text.trimEnd()}\n\n${link}\n`);await this.refresh();}
  private menu(event:MouseEvent,day:string){event.preventDefault();const menu=new Menu();menu.addItem(i=>i.setTitle('查看这一天').setIcon('calendar-days').onClick(()=>void this.showDay(day)));const f=this.find(day);menu.addItem(i=>i.setTitle(f?'打开日记原文':'创建这一天的日记').setIcon('file-plus').onClick(async()=>{try{const file=f||await this.host.getJournalFile(day);await this.showDay(day);this.host.editJournal(file);}catch(e){new Notice(String(e));}}));menu.showAtMouseEvent(event);}
  async refresh(){
    if(this.contentEl.querySelector(".is-task-dragging")){this.schedule();return;}
    if(this.closed)return;const run=++this.generation,day=this.day,month=this.month;const focus=this.contentEl.querySelector<HTMLInputElement>('.ts-calendar-search');const restoreFocus=focus===this.contentEl.ownerDocument.activeElement,pos=focus?.selectionStart||0;const active=this.contentEl.ownerDocument.activeElement as HTMLElement|null;const calendarFocus=active&&this.contentEl.contains(active)&&active.classList.contains('ts-calendar-day')?active.dataset.day:undefined;const restoreTaskFocus=preserveTaskFilterFocus(this.contentEl);const oldScroll=this.contentEl.scrollTop;const quickFocused=this.contentEl.querySelector<HTMLInputElement>('.ts-journal-quick input');const restoreQuick=quickFocused===this.contentEl.ownerDocument.activeElement,quickPos=quickFocused?.selectionStart||0;
    this.contentEl.dataset.calendarUi='quiet';this.contentEl.dataset.calendarDensity=this.host.settings.calendarDensity||'comfortable';this.contentEl.dataset.journalPart=this.part;this.contentEl.dataset.glass=String(this.host.settings.glassEffects!==false);this.contentEl.dataset.surface=this.host.settings.surfaceStyle||'soft';this.contentEl.dataset.accent=this.host.settings.accent||'forest';this.renderScope?.unload();const scope=this.renderScope=new Component();scope.load();
    // The timer belongs to the view, not this disposable journal render. Move its original DOM so file/task refreshes keep unfinished input and the single subscription.
    const timerFocus=this.timerPanelElement?.contains(active)?active as HTMLInputElement:undefined;
    const timerSelection=timerFocus?.tagName==='INPUT'&&timerFocus.type!=='number'?[timerFocus.selectionStart,timerFocus.selectionEnd] as const:undefined;
    this.timerPanelElement?.remove();this.contentEl.empty();this.topPanels=undefined;this.topButtons=undefined;
    this.visibleEntries.clear();
    const layout=this.contentEl.createDiv('ts-journal-layout'),calendarPane=layout.createDiv('ts-journal-calendar-pane'),detailPane=layout.createDiv('ts-journal-detail-pane');
    if(this.part==='entries')calendarPane.remove();if(this.part==='calendar')detailPane.remove();
    let calendarHost=calendarPane,timerHost=calendarPane;
    if(this.part!=='entries'&&this.host.pomodoro&&this.host.pomodoroActions){const panels=this.createTopSwitch(calendarPane);calendarHost=panels.calendar;timerHost=panels.timer;}
    const calendar=calendarHost.createDiv('ts-calendar'),calendarTop=calendar.createDiv('ts-calendar-top');
    calendar.toggleClass('is-collapsed',this.calendarCollapsed);calendar.dataset.view=this.calendarView;
    const nav=calendarTop.createDiv('ts-calendar-nav'),primaryNav=nav.createDiv('ts-calendar-primary-nav'),periodControls=primaryNav.createDiv('ts-calendar-period-label');
    const monthNumber=Number(month.slice(5)),monthNames=['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];
    const year=this.control(periodControls,`打开 ${month.slice(0,4)} 年记`,'',()=>this.createReview('year',`${month.slice(0,4)}-01-01`));
    year.className='ts-calendar-year';year.setText(month.slice(0,4));year.title='点击打开年记；右键跳转日期';year.oncontextmenu=e=>{e.preventDefault();this.openDatePicker();};
    const monthLabel=this.control(periodControls,this.calendarView==='year'?'返回月历':`打开 ${month} 月记`,'',()=>{if(this.calendarView==='year'){this.calendarView='month';this.app.workspace.requestSaveLayout();return this.refresh();}return this.createReview('month',`${month}-01`);});
    monthLabel.className='ts-calendar-month';monthLabel.empty();monthLabel.createSpan({cls:'ts-calendar-month-name',text:this.calendarView==='year'?'年览':monthNames[monthNumber-1]});
    monthLabel.title=this.calendarView==='year'?'返回月历':'点击打开月记；右键跳转日期';monthLabel.oncontextmenu=e=>{e.preventDefault();this.openDatePicker();};
    const monthNav=primaryNav.createDiv('ts-calendar-month-nav'),yearView=this.calendarView==='year';
    this.control(monthNav,yearView?'上一年':'上个月','chevron-left',()=>{this.month=shiftMonth(month,yearView?-12:-1);this.app.workspace.requestSaveLayout();return this.refresh();});
    this.control(monthNav,'今天','',()=>this.showDay(localDay()));
    this.control(monthNav,yearView?'下一年':'下个月','chevron-right',()=>{this.month=shiftMonth(month,yearView?12:1);this.app.workspace.requestSaveLayout();return this.refresh();});
    const calendarHead=calendarTop.createDiv('ts-calendar-heading');
    const collapse=this.control(calendarHead,this.calendarCollapsed?'展开月历':'收起月历',this.calendarCollapsed?'chevron-down':'chevron-up',()=>{this.calendarCollapsed=!this.calendarCollapsed;this.app.workspace.requestSaveLayout();return this.refresh();});
    collapse.className='ts-calendar-collapse';collapse.setAttribute('aria-expanded',String(!this.calendarCollapsed));
    this.control(calendarHead,'收集笔记','plus',()=>this.host.quickCapture()).className='ts-calendar-capture';
    this.control(calendarHead,'更多日历工具','ellipsis',()=>this.calendarTools()).className='ts-calendar-tools';
    const selected=this.chinese.get(day);
    if(this.calendarView==='year')this.renderYear(calendar,month.slice(0,4));
    const displayDates=monthDisplayGrid(month);
    const grid=calendar.createDiv({cls:'ts-calendar-grid',attr:{role:'group','aria-label':'日记月历'}});grid.createSpan({cls:'ts-calendar-week-heading',attr:{'aria-label':'ISO 周数'}});for(const text of ['一','二','三','四','五','六','日'])grid.createSpan({cls:'ts-calendar-weekday',text});
    const cells=new Map<string,HTMLButtonElement>();for(const [index,date] of displayDates.entries()){
      if(index%7===0){const iso=isoWeek(date);const week=this.control(grid,`打开 ${iso.year} 第 ${iso.week} 周周记`,'',()=>this.createReview('week',date));week.className='ts-calendar-week';week.dataset.weekStart=date;week.setText(String(iso.week));}
      const b=this.control(grid,date,'',()=>this.openDay(date));b.className='ts-calendar-day';b.empty();b.createSpan({cls:'ts-calendar-solar-number',text:String(Number(date.slice(8)))});const cn=chineseDayPresentation(this.chinese.get(date),this.host.settings);if(cn.label)b.createSpan({cls:'ts-calendar-lunar-label',text:cn.label});b.dataset.chineseKind=cn.kind;b.dataset.dateTitle=[date,cn.description].filter(Boolean).join(' · ');b.title=b.dataset.dateTitle;b.setAttribute('aria-label',b.title);if(cn.badge){b.createSpan({cls:'ts-calendar-holiday-badge',text:cn.badge,attr:{title:cn.holidayTitle,'aria-hidden':'true'}});b.dataset.holiday=cn.badge==='班'?'work':'rest';}b.dataset.day=date;b.tabIndex=date===(this.focusedDay.slice(0,7)===month?this.focusedDay:month+'-01')?0:-1;b.onfocus=()=>{this.focusedDay=date;};b.toggleClass('is-weekend',index%7>=5);b.toggleClass('is-first-week',index<7);b.toggleClass('is-last-week',index>=displayDates.length-7);b.toggleClass('is-outside',date.slice(0,7)!==month);b.toggleClass('is-today',date===localDay());b.toggleClass('is-selected',date===day);b.setAttribute('aria-pressed',String(date===day));if(date===localDay())b.setAttribute('aria-current','date');b.oncontextmenu=e=>this.menu(e,date);b.onkeydown=e=>{void this.calendarKey(e,date).catch(e=>new Notice(String(e)));};cells.set(date,b);
    }
    grid.hidden=this.calendarView==='year';if(this.host.settings.showHolidays!==false&&selected&&!this.chinese.get(`${month}-01`)?.holidaysKnown)calendar.createDiv({cls:'ts-calendar-data-note',text:`${month.slice(0,4)} 年调休数据未收录`});
    if(this.part!=='entries'){if(this.topPanels)this.renderTimerPanel(timerHost);else this.renderFocusStrip(timerHost,scope);}
    if(timerFocus&&this.topPane==='timer'){timerFocus.focus({preventScroll:true});if(timerSelection&&timerSelection[0]!==null&&timerSelection[1]!==null)timerFocus.setSelectionRange(...timerSelection);}
    const tabs=detailPane.createDiv({cls:'ts-journal-tabs',attr:{role:'group','aria-label':'日记显示方式'}});for(const [id,label] of [['day','日记'],['week','本周清单'],['agenda','本月清单']] as const){const b=this.control(tabs,label,id==='day'?'notebook-pen':id==='week'?'calendar-range':'list-todo',()=>{this.mode=id;this.app.workspace.requestSaveLayout();return this.refresh();},true);b.toggleClass('is-active',this.mode===id);b.setAttribute('aria-pressed',String(this.mode===id));}
    if(this.part==='entries')this.renderFocusStrip(detailPane,scope);
    const content=detailPane.createDiv('ts-journal-content');let agenda:HTMLElement|undefined;
    const weekly=this.mode==='week',week=weekDays(day),periodLabel=weekly?'本周':'本月';
    if(this.mode!=='day'){if(weekly){const range=content.createDiv('ts-journal-week-range');this.control(range,'上一周','chevron-left',()=>this.shiftWeek(-1));range.createSpan({text:`${week[0]} — ${week[6]}`});this.control(range,'下一周','chevron-right',()=>this.shiftWeek(1));}const search=content.createEl('input',{cls:'ts-calendar-search',type:'search',value:this.query,attr:{'aria-label':`搜索${periodLabel}日记`,placeholder:`搜索${periodLabel}日记内容…`}});search.oninput=()=>{this.query=search.value;if(agenda)this.renderAgenda(agenda,this.visibleEntries,weekly,week,month);};if(restoreFocus){search.focus();search.setSelectionRange(pos,pos);}const filterRow=content.createDiv('ts-calendar-filter-row');const filter=this.control(filterRow,this.onlyTodo?'显示全部日记':'只看未完成任务','',()=>{this.onlyTodo=!this.onlyTodo;this.app.workspace.requestSaveLayout();return this.refresh();});filter.className='ts-calendar-filter';filter.setAttribute('aria-pressed',String(this.onlyTodo));const sort=filterRow.createEl('select',{attr:{'aria-label':'日记排序'}});for(const [value,text] of [['newest','最新在前'],['oldest','最早在前']])sort.createEl('option',{value,text});sort.value=this.sort;sort.onchange=()=>{this.sort=sort.value as typeof this.sort;this.app.workspace.requestSaveLayout();if(agenda)this.renderAgenda(agenda,this.visibleEntries,weekly,week,month);};agenda=content.createDiv('ts-calendar-agenda');}
    const failures=new Set<string>(),entries=new Map<string,Entry>(),days=this.part==='entries'&&this.mode==='day'?[day]:[...new Set([...displayDates,...(weekly?week:[])])];let cursor=0;
    await Promise.all(Array.from({length:4},async()=>{while(cursor<days.length&&run===this.generation){const date=days[cursor++];try{const entry=await this.entry(date);if(entry)entries.set(date,entry);}catch{failures.add(date);if(run===this.generation)cells.get(date)?.setAttribute('title',date+' · 暂时无法读取');}}}));
    if(run!==this.generation||this.closed)return;this.visibleEntries=entries;if(calendarFocus&&this.contentEl.ownerDocument.activeElement===this.contentEl.ownerDocument.body)this.contentEl.querySelector<HTMLButtonElement>(`[data-day="${calendarFocus}"]`)?.focus();
    for(const [date,entry] of entries){const b=cells.get(date);if(!b)continue;const pending=entry.tasks.filter(t=>!t.checked&&t.text.trim()).length;b.classList.add('has-entry');b.toggleClass('has-todo',pending>0);b.setAttribute('title',`${b.dataset.dateTitle||date} · 已有日记${pending?` · ${pending}项待办`:''}`);b.setAttribute('aria-label',b.title);if(pending)b.createSpan({cls:'ts-calendar-todo-count',text:String(Math.min(pending,99)),attr:{'aria-hidden':'true'}});}
    if(failures.size)(this.part==='calendar'?calendarPane:content).createDiv({cls:'ts-journal-empty',text:`${failures.size} 篇日记暂时无法读取，日期标记和任务可能不完整。`});
    if(this.part==='calendar'){let entry=entries.get(day);if(!entry)try{entry=await this.entry(day);}catch{}if(run!==this.generation||this.closed)return;this.renderTaskArea(calendarPane,scope,day,restoreQuick,quickPos,entry);restoreTaskFocus();this.contentEl.scrollTop=oldScroll;return;}
    if(agenda){this.renderAgenda(agenda,entries,weekly,week,month);this.contentEl.scrollTop=oldScroll;return;}
    const header=content.createDiv('ts-journal-header');const heading=header.createDiv('ts-journal-heading');const dateTitle=heading.createEl('h2',{attr:{'aria-label':`${Number(day.slice(5,7))}月${Number(day.slice(8))}日`}});dateTitle.createSpan({cls:'ts-journal-month-label',text:`${Number(day.slice(5,7))}月`});dateTitle.createSpan({cls:'ts-journal-day-number',text:String(Number(day.slice(8)))});dateTitle.createSpan({cls:'ts-journal-date-unit',text:'日'});heading.createDiv({cls:'ts-journal-date',text:`${day.slice(0,4)} · ${dateOf(day).toLocaleDateString('zh-CN',{weekday:'long'})}${day===localDay()?' · 今天':''}`});
    const lunarHeading=chineseDayPresentation(this.chinese.get(day),this.host.settings);if(lunarHeading.description)heading.createDiv({cls:'ts-journal-lunar-date',text:lunarHeading.description});
    const history=header.createDiv('ts-journal-history');const known=this.knownDays();const previous=this.control(history,'上一篇日记','chevron-left',()=>this.jumpEntry(-1));previous.disabled=!adjacentJournalDay(known,day,-1);const next=this.control(history,'下一篇日记','chevron-right',()=>this.jumpEntry(1));next.disabled=!adjacentJournalDay(known,day,1);
    const actions=header.createDiv('ts-journal-actions');const candidate=this.find(day);
    if(candidate){this.control(actions,'编辑日记','pencil',()=>this.host.editJournal(candidate),true);this.control(actions,'追加想法','plus',()=>new TextModal(this.app,`追加到 ${day}`,'',async text=>{await this.app.vault.process(candidate,current=>`${current.trimEnd()}\n\n### ${new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} · 随记\n\n${text.trim()}\n`);}).open());this.control(actions,'打开原文','arrow-up-right',()=>this.app.workspace.getLeaf('tab').openFile(candidate));}
    else {this.control(actions,'开始记录','pencil',async()=>{const file=await this.host.getJournalFile(day);this.host.editJournal(file);await this.refresh();},true);content.createDiv({cls:'ts-journal-empty',text:'这一天还没有记录。写下一个想法，留住今天。'});}
    if(!this.host.pomodoro&&this.host.pomodoroActions)this.control(actions,'打开计时器','timer',()=>this.host.pomodoroActions!.open());
    if(this.host.currentBoard?.file)this.control(actions,'关联当前白板','link',()=>this.linkBoard()).className='ts-journal-link-board';
    const body=content.createDiv('ts-journal-body');if(this.part==='combined'){this.renderTaskArea(content,scope,day,restoreQuick,quickPos);restoreTaskFocus();}
    this.contentEl.scrollTop=oldScroll;if(!candidate)return;let entry=entries.get(day);if(!entry)try{entry=await this.entry(day);}catch{content.createDiv({cls:'ts-journal-empty',text:'日记暂时无法读取，请稍后重试。'});return;}if(!entry||run!==this.generation)return;this.visibleEntries.set(day,entry);
    const presentation=journalPresentation(entry.text);try{await MarkdownRenderer.render(this.app,presentation.body.replace(/(?:^## 待办与未完成\r?\n\s*)?```thoughtspace-tasks[^\n]*\n[\s\S]*?```\r?\n?/gm,'').replace(new RegExp('^# '+day+'\\r?\\n'),''),body,candidate.path,scope);if(run!==this.generation){scope.unload();return;}if(presentation.links){const links=body.createEl('details',{cls:'ts-journal-linked-notes'});links.open=this.linkedNotesOpen.has(day);const summary=links.createEl('summary');summary.createSpan({text:'当日新建笔记'});const count=summary.createSpan({cls:'ts-journal-linked-count'});const list=links.createDiv('ts-journal-linked-list');await MarkdownRenderer.render(this.app,presentation.links,list,candidate.path,scope);if(run!==this.generation){scope.unload();return;}count.setText(String(list.querySelectorAll('li').length));links.ontoggle=()=>{if(run!==this.generation)return;if(links.open){this.linkedNotesOpen.add(day);if(this.linkedNotesOpen.size>64)this.linkedNotesOpen.delete(this.linkedNotesOpen.values().next().value!);}else this.linkedNotesOpen.delete(day);};}body.querySelectorAll('input').forEach(i=>i.disabled=true);this.contentEl.scrollTop=oldScroll;}catch(e){if(run===this.generation)body.setText(`日记暂时无法读取：${String(e)}`);}
  }
  private createTopSwitch(parent:HTMLElement){
    const id='ts-sidebar-top-'+crypto.randomUUID(),tabs=parent.createDiv({cls:'ts-journal-top-switch',attr:{role:'tablist','aria-label':'日历或计时'}});
    const panels={calendar:parent.createDiv({cls:'ts-journal-calendar-panel',attr:{id:id+'-calendar',role:'tabpanel','aria-labelledby':id+'-calendar-tab'}}),timer:parent.createDiv({cls:'ts-journal-timer-panel',attr:{id:id+'-timer',role:'tabpanel','aria-labelledby':id+'-timer-tab'}})};
    this.topPanels=panels;this.topButtons=new Map();
    for(const [mode,label,icon] of [['calendar','日历','calendar-days'],['timer','计时','timer']] as const){
      const button=tabs.createEl('button',{attr:{id:id+'-'+mode+'-tab',type:'button',role:'tab','aria-controls':id+'-'+mode,'aria-label':label}});button.dataset.topPane=mode;
      setIcon(button.createSpan({attr:{'aria-hidden':'true'}}),icon);button.createSpan({text:label});
      button.onclick=()=>this.selectTopPane(mode,true);
      button.onkeydown=event=>{const next=event.key==='Home'?'calendar':event.key==='End'?'timer':event.key==='ArrowLeft'||event.key==='ArrowRight'?(mode==='calendar'?'timer':'calendar'):undefined;if(next){event.preventDefault();event.stopPropagation();this.selectTopPane(next,true);}};
      this.topButtons.set(mode,button);
    }
    this.selectTopPane(this.topPane);return panels;
  }
  selectCalendarSurface(mode:'calendar'|'timer'){this.selectTopPane(mode);this.app.workspace.requestSaveLayout();}
  private selectTopPane(mode:'calendar'|'timer',focus=false){
    this.topPane=mode;if(focus)this.topButtons?.get(mode)?.focus({preventScroll:true});
    if(this.topPanels){this.topPanels.calendar.hidden=mode!=='calendar';this.topPanels.timer.hidden=mode!=='timer';}
    for(const [key,button] of this.topButtons||[]){button.setAttribute('aria-selected',String(key===mode));button.tabIndex=key===mode?0:-1;button.toggleClass('is-active',key===mode);}
    if(focus)this.app.workspace.requestSaveLayout();
  }
  private renderTimerPanel(parent:HTMLElement){
    if(!this.host.pomodoro)return;
    if(!this.timerPanelElement){
      this.timerPanelElement=parent.createDiv('ts-journal-focus ts-journal-timer-host');
      this.timerPanel=this.addChild(new PomodoroPanel(this.timerPanelElement,this.host.pomodoro,
        this.host.openTimerTarget?target=>this.host.openTimerTarget!(target):undefined,
        async day=>{if(this.host.openLargeCalendar){await this.host.openLargeCalendar(day);return;}this.selectCalendarSurface('calendar');await this.showDay(day,false);},
      ));
    }else parent.append(this.timerPanelElement);
  }
  private renderFocusStrip(parent:HTMLElement,scope:Component,presentation:'compact'|'panel'='compact'){
    if(this.host.pomodoro&&this.host.pomodoroActions)scope.addChild(new PomodoroStrip(parent.createDiv('ts-journal-focus'),this.host.pomodoro,()=>this.host.pomodoroActions!.open(),presentation));
  }
  private calendarTools(){
    const menu=new Menu(),run=(fn:()=>unknown)=>{void Promise.resolve().then(fn).catch(error=>new Notice(String(error)));};
    menu.addItem(item=>item.setTitle('跳转日期 / 月份').setIcon('calendar-search').onClick(()=>this.openDatePicker()));
    menu.addItem(item=>item.setTitle(this.calendarView==='month'?'切换年历':'切换月历').setIcon(this.calendarView==='month'?'layout-grid':'calendar-days').onClick(()=>run(()=>{this.calendarView=this.calendarView==='month'?'year':'month';this.app.workspace.requestSaveLayout();return this.refresh();})));
    menu.addItem(item=>item.setTitle(`打开 Q${Math.ceil(Number(this.month.slice(5))/3)} 季记`).setIcon('notebook-pen').onClick(()=>run(()=>this.createReview('quarter',this.month+'-01'))));
    if(this.host.openLargeCalendar)menu.addItem(item=>item.setTitle('打开大日历').setIcon('maximize-2').onClick(()=>run(()=>this.host.openLargeCalendar?.(this.day))));
    if(!this.host.pomodoro&&this.host.pomodoroActions)menu.addItem(item=>item.setTitle('打开计时器').setIcon('timer').onClick(()=>run(()=>this.host.pomodoroActions!.open())));
    const button=this.contentEl.querySelector('.ts-calendar-tools');
    if(button){const rect=button.getBoundingClientRect();menu.showAtPosition({x:rect.right,y:rect.bottom});}
  }
  private renderYear(parent:HTMLElement,year:string){
    const quarters=parent.createDiv({cls:'ts-calendar-year-quarters',attr:{role:'group','aria-label':'季度笔记'}});
    for(let q=1;q<=4;q++)this.control(quarters,`${year} Q${q} 季记`,'',()=>this.createReview('quarter',`${year}-${String((q-1)*3+1).padStart(2,'0')}-01`)).setText(`Q${q}`);
    const grid=parent.createDiv({cls:'ts-calendar-year-grid',attr:{role:'group','aria-label':`${year} 年历`}});
    for(let i=1;i<=12;i++){
      const month=`${year}-${String(i).padStart(2,'0')}`,days=monthDisplayGrid(month),recorded=new Set(days.filter(day=>day.startsWith(month)&&this.find(day)));
      const cell=this.control(grid,`查看 ${month}，${recorded.size} 篇日记`,'',()=>{this.month=month;this.focusedDay=month+'-01';this.calendarView='month';this.app.workspace.requestSaveLayout();return this.refresh();});cell.className='ts-calendar-year-month';cell.empty();cell.dataset.month=month;cell.toggleClass('is-selected',month===this.month);cell.setAttribute('aria-pressed',String(month===this.month));
      const header=cell.createSpan({cls:'ts-calendar-mini-header'});header.createEl('strong',{text:`${i}月`});header.createSpan({text:recorded.size?`${recorded.size} 篇`:'',cls:'ts-calendar-mini-count'});
      const mini=cell.createSpan({cls:'ts-calendar-mini-grid',attr:{'aria-hidden':'true'}});for(const text of ['一','二','三','四','五','六','日'])mini.createSpan({text,cls:'ts-calendar-mini-weekday'});for(const day of days){const d=mini.createSpan({text:day.startsWith(month)?String(Number(day.slice(8))):''});d.toggleClass('has-entry',recorded.has(day));d.toggleClass('is-today',day===localDay());}
      cell.oncontextmenu=event=>{event.preventDefault();new Menu().addItem(item=>item.setTitle('打开月记').setIcon('notebook-pen').onClick(()=>{void this.createReview('month',month+'-01').catch(e=>new Notice(String(e)));})).showAtMouseEvent(event);};
    }
  }
  private quickOpenDay?:string;
  private renderTaskArea(parent:HTMLElement,scope:Component,day:string,restoreQuick=false,quickPos=0,entry?:Entry){
    let panel:TaskPanel|undefined;const taskArea=parent.createDiv('ts-journal-task-area');
    const taskHeading=taskArea.createDiv('ts-journal-task-label');taskHeading.createSpan({text:'待办'});
    taskHeading.createSpan({cls:'ts-journal-task-date',text:day===localDay()?'今天':`${Number(day.slice(5,7))}月${Number(day.slice(8))}日`});
    const headingActions=taskHeading.createDiv('ts-journal-task-actions');
    if(!this.host.pomodoro&&this.host.pomodoroActions)this.control(headingActions,'打开计时器','timer',()=>this.host.pomodoroActions!.open()).addClass('ts-journal-task-pomodoro');
    const quick=taskArea.createDiv({cls:'ts-journal-quick',attr:{id:'ts-task-capture-'+crypto.randomUUID()}});
    const input=quick.createEl('input',{type:'text',attr:{placeholder:'记一项待办…','aria-label':'日记待办内容'}});
    const toggle=this.control(headingActions,'新建待办','plus',()=>{if(!panel?.openTimelineEditor())setOpen(this.quickOpenDay!==day,true);});toggle.addClass('ts-journal-task-add');toggle.setAttribute('aria-controls',quick.id);
    const setOpen=(open:boolean,focus=false)=>{this.quickOpenDay=open?day:undefined;quick.hidden=!open;toggle.setAttribute('aria-expanded',String(open));toggle.toggleClass('is-active',open);toggle.title=open?'收起输入（保留草稿）':'新建待办';if(focus)(open?input:toggle).focus();};
    setOpen(this.quickOpenDay===day);input.value=this.drafts.get(day)||'';input.disabled=this.pendingTasks.has(day);
    input.oninput=()=>{this.drafts.delete(day);this.drafts.set(day,input.value);if(this.drafts.size>20)this.drafts.delete(this.drafts.keys().next().value!);};
    if(restoreQuick&&!quick.hidden){input.focus();input.setSelectionRange(quickPos,quickPos);}
    let submitting=false;
    const submit=async()=>{
      if(submitting||this.pendingTasks.has(day))return;
      const value=input.value;appendJournalTask('',value);
      submitting=true;this.pendingTasks.add(day);input.disabled=true;
      try{const file=await this.host.getJournalFile(day);await this.app.vault.process(file,text=>appendJournalTask(text,value));if(this.drafts.get(day)===value)this.drafts.delete(day);if(this.quickOpenDay===day)this.quickOpenDay=undefined;}
      finally{submitting=false;this.pendingTasks.delete(day);input.disabled=false;}
      await this.refresh();if(this.day===day)this.contentEl.querySelector<HTMLButtonElement>('.ts-journal-task-add')?.focus();
    };
    this.control(quick,'添加待办','arrow-up',submit);
    input.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setOpen(false,true);}else if(e.key==='Enter'&&!e.isComposing){e.preventDefault();void submit().catch(e=>new Notice(String(e)));}};
    if(this.host.taskPlanner){const planner=this.host.taskPlanner;panel=scope.addChild(new TaskPanel(this.app,taskArea.createDiv(),planner,day,this.taskPanelState,true,headingActions,this.part==='calendar'?el=>new DayTimeline(this.app,el,planner,day,entry?{path:entry.file.path,text:entry.text}:undefined,this.timelineState,async text=>{const file=await this.host.getJournalFile(day);await this.app.vault.process(file,current=>appendJournalTask(current,text));},true,this.host.pomodoroActions):undefined,this.host.pomodoroActions));}
  }

  private renderAgenda(agenda:HTMLElement,entries:Map<string,Entry>,weekly:boolean,week:string[],month:string){
    agenda.empty();const results=[...entries.values()].filter(e=>(weekly?week.includes(e.day):e.day.startsWith(month))&&e.text.toLocaleLowerCase().includes(this.query.trim().toLocaleLowerCase())&&(!this.onlyTodo||e.tasks.some(t=>!t.checked&&t.text.trim()))).sort((a,b)=>this.sort==='newest'?b.day.localeCompare(a.day):a.day.localeCompare(b.day));agenda.createDiv({cls:'ts-journal-count',text:`${results.length} 篇日记`});for(const e of results){const row=agenda.createDiv('ts-calendar-agenda-row');const stamp=row.createDiv({cls:'ts-agenda-date-stamp',attr:{'aria-hidden':'true'}});stamp.createEl('strong',{text:e.day.slice(8)});stamp.createSpan({text:dateOf(e.day).toLocaleDateString('zh-CN',{weekday:'short'})});const rowBody=row.createDiv('ts-agenda-entry');const rowHead=rowBody.createDiv('ts-calendar-agenda-head');this.control(rowHead,e.day,'',()=>this.showDay(e.day));this.control(rowHead,'打开日记原文','arrow-up-right',()=>this.openNote(e.file));const total=e.tasks.filter(t=>t.text.trim()).length;if(total)rowHead.createSpan({cls:'ts-calendar-agenda-tasks',text:`${e.tasks.filter(t=>t.checked&&t.text.trim()).length}/${total} 完成`});if(this.onlyTodo)this.renderTasks(rowBody,e,true);else rowBody.createDiv({cls:'ts-journal-excerpt',text:journalExcerpt(journalPresentation(e.text).body)||'这一天还没有正文。'});}if(!results.length)agenda.createDiv({cls:'ts-journal-empty',text:'没有匹配的日记。可以切换月份或调整筛选。'});
  }
  private renderTasks(parent:HTMLElement,entry:Entry,onlyTodo=false){const tasks=entry.tasks.filter(t=>t.text.trim()&&(!onlyTodo||!t.checked));if(!tasks.length)return;const box=parent.createDiv('ts-journal-tasks'),done=entry.tasks.filter(t=>t.text.trim()&&t.checked).length,total=entry.tasks.filter(t=>t.text.trim()).length;const header=box.createDiv('ts-journal-task-heading');header.createDiv({cls:'ts-journal-count',text:`任务 ${done} / ${total}`});header.createEl('progress',{attr:{max:String(total),value:String(done),'aria-label':'日记任务完成度'}});for(const task of tasks.slice(0,100)){const label=box.createEl('label');const check=label.createEl('input',{type:'checkbox'});check.checked=task.checked;label.createSpan({text:task.text});check.onchange=()=>{check.disabled=true;void this.app.vault.process(entry.file,text=>toggleTask(text,task)).then(()=>this.refresh()).catch(e=>{new Notice(String(e));void this.refresh();});};}if(tasks.length>100)box.createDiv({text:'显示前 100 项，更多任务请打开原文。',cls:'ts-muted'});}
  async onClose(){this.closed=true;if(this.timerPanel)this.removeChild(this.timerPanel);this.timerPanel=undefined;this.timerPanelElement=undefined;this.generation++;this.renderScope?.unload();window.clearTimeout(this.refreshTimer);this.cache.clear();this.chinese.clear();this.drafts.clear();this.visibleEntries.clear();}
}
