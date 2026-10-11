import {preserveTaskRowFocus} from './ui-focus';
import {TaskScheduleModal} from './task-schedule-view';
import {App,Component,Modal,Notice,TFile,setIcon} from 'obsidian';
import {localDay} from './filing';
import {TaskPlanner} from './task-planner';
import {PlannedTask} from './task-planner-model';
import {clockLabel,dayTimeline,journalRecords,scheduleText,timeSlot,timelineGaps,TimelineItem} from './day-timeline-model';
export type DayTimelineState={collapsed?:boolean;hideDone?:boolean;untimedOpen?:boolean};
/** Reuses the task index; the clock tick only updates the visible day, never scans files. */
export class DayTimeline extends Component {
 private records:TimelineItem[]=[];private active=false;private limit=40;private body!:HTMLElement;private clock!:HTMLElement;private toggle!:HTMLButtonElement;private done!:HTMLButtonElement;
 constructor(private app:App,private el:HTMLElement,private planner:TaskPlanner,private day:string,private journal:{path:string;text:string}|undefined,private state:DayTimelineState,private add:(text:string)=>Promise<void>,private embedded=false){super();this.records=journal?journalRecords(journal.text,journal.path):[];}
 private button(parent:HTMLElement,label:string,icon:string,run:()=>unknown){const b=parent.createEl('button',{attr:{'aria-label':label,title:label}});setIcon(b,icon);b.onclick=()=>{b.disabled=true;Promise.resolve().then(run).catch(e=>new Notice(String(e))).finally(()=>b.disabled=false);};return b;}
 onload(){this.active=true;this.el.addClass('ts-day-timeline');this.el.toggleClass('is-embedded',this.embedded);this.el.setAttribute('aria-label','所选日期时间线');this.el.dataset.day=this.day;
  const head=this.el.createDiv('ts-day-timeline-head');if(!this.embedded){head.createEl('h3',{text:'时间线'});head.createSpan({cls:'ts-day-timeline-date',text:this.day===localDay()?'今天':`${Number(this.day.slice(5,7))}月${Number(this.day.slice(8))}日`});}
  this.clock=head.createSpan('ts-day-timeline-clock');const actions=head.createDiv('ts-day-timeline-actions');
  this.done=this.button(actions,'隐藏已完成事项','check-check',()=>{this.state.hideDone=!this.state.hideDone;this.app.workspace.requestSaveLayout();this.render();});
  if(!this.embedded)this.button(actions,'新增时间安排','plus',()=>this.edit());
  this.toggle=this.button(actions,'收起时间线','chevron-up',()=>{this.state.collapsed=!this.state.collapsed;this.app.workspace.requestSaveLayout();this.render();});
  this.toggle.hidden=this.embedded;this.body=this.el.createDiv('ts-day-timeline-body');this.register(this.planner.subscribe(()=>this.render()));this.registerInterval(window.setInterval(()=>this.render(),60000));
  this.body.setText('正在读取时间安排…');void this.planner.ready().then(()=>this.render()).catch(e=>{if(this.active)this.body.setText('时间安排暂时无法读取：'+String(e));});
 }
 private async open(path:string,line:number){const file=this.app.vault.getAbstractFileByPath(path);if(!(file instanceof TFile))throw Error('来源已移动或删除，请刷新');const leaf=this.app.workspace.getLeavesOfType('markdown').find(l=>(l.view as {file?:TFile}).file===file)||this.app.workspace.getLeaf('tab');await leaf.openFile(file,{eState:{line}});await this.app.workspace.revealLeaf(leaf);}
 edit(task?:PlannedTask,startAt?:string,endAt?:string){if(task){new TaskScheduleModal(this.app,this.planner,task,this.day).open();return;}const m=new Modal(this.app);m.modalEl.addClass('ts-timeline-modal');m.modalEl.addClass('ts-calendar-plugin');m.titleEl.setText('新增时间安排');m.contentEl.createEl('p',{text:this.day,cls:'ts-muted'});
  const title=m.contentEl.createEl('input',{type:'text',value:'',attr:{placeholder:'准备做什么？','aria-label':'时间安排内容'}});
  const times=m.contentEl.createDiv('ts-timeline-time-fields');const field=(label:string,value:string)=>{const wrap=times.createEl('label');wrap.createSpan({text:label});return wrap.createEl('input',{type:'time',value,attr:{'aria-label':label}});};
  const now=new Date(),start=field('开始时间',startAt||clockLabel(now.getHours()*60+now.getMinutes())),end=field('结束时间（可选）',endAt||'');
  const error=m.contentEl.createDiv({cls:'ts-timeline-error',attr:{role:'alert'}});const save=m.contentEl.createEl('button',{text:'保存安排',cls:'mod-cta'});
  const submit=async()=>{if(save.disabled)return;try{const text=scheduleText(title.value,start.value,end.value);save.disabled=true;await this.add(text);m.close();}catch(e){error.setText(e instanceof Error?e.message:String(e));save.disabled=false;}};
  save.onclick=()=>void submit();title.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();void submit();}};m.open();title.focus();
 }
 private taskCheck(parent:HTMLElement,task:PlannedTask){const check=parent.createEl('input',{type:'checkbox',attr:{'aria-label':`${task.checked?'重新打开':'完成'}任务：${task.title}`}});check.checked=task.checked;check.disabled=!this.planner.canToggle(task);if(task.recurring)check.title=check.disabled?'重复任务需要启用 Tasks 7.2 或更新版本，也可以在原文完成':task.checked?'通过 Tasks 重新打开此任务':'通过 Tasks 完成，并按重复规则生成下一项';check.onchange=()=>{const restore=this.preserveFocus();check.disabled=true;void this.planner.update(task,{checked:check.checked}).catch(e=>{new Notice(String(e));this.render();}).finally(restore);};}
 private row(parent:HTMLElement,item:TimelineItem){
  const row=parent.createDiv('ts-timeline-item');row.dataset.path=item.path;row.dataset.line=String(item.line);row.dataset.kind=item.kind;row.dataset.priority=item.task&&item.task.priority<=1?'high':'normal';row.toggleClass('is-done',!!item.task?.checked);row.toggleClass('has-conflict',!!item.conflict);
  const duration=item.slot.end!==undefined?item.slot.end-item.slot.start:0;row.style.setProperty('--node-height',`${Math.min(72,36+duration*.32)}px`);
  const now=new Date(),minute=now.getHours()*60+now.getMinutes(),current=this.day===localDay()&&!item.task?.checked&&item.slot.end!==undefined&&minute>=item.slot.start&&minute<item.slot.end;row.toggleClass('is-current',current);
  const icon=item.kind==='record'?'notebook-pen':item.task?.checked?'check':/阅读|读书|read|book/i.test(item.title)?'book-open':/写作|整理|write|专注/i.test(item.title)?'pencil':/会议|讨论|meet/i.test(item.title)?'messages-square':/休息|咖啡|break/i.test(item.title)?'coffee':'circle-dot';
  const node=row.createSpan({cls:'ts-timeline-node',attr:{'aria-hidden':'true'}});setIcon(node,icon);
  const card=row.createDiv('ts-timeline-card'),time=card.createDiv('ts-timeline-time');time.createSpan({text:clockLabel(item.slot.start)});if(item.slot.end!==undefined){time.createSpan({cls:'ts-timeline-end',text:'– '+clockLabel(item.slot.end)});time.createSpan({cls:'ts-timeline-duration',text:`${duration} 分钟`});}if(current)time.createSpan({cls:'ts-timeline-active-label',text:'进行中'});
  const heading=card.createDiv('ts-timeline-card-heading');const title=heading.createEl('button',{cls:'ts-timeline-title',text:item.title,attr:{title:'打开来源：'+item.path,'aria-label':'打开来源：'+item.title}});title.onclick=()=>void this.open(item.path,item.line).catch(e=>new Notice(String(e)));if(item.task)this.taskCheck(heading,item.task);
  if(item.conflict||item.slot.invalidRange)card.createSpan({cls:'ts-timeline-conflict',text:item.conflict?'时间重叠':'请检查结束时间'});
  const meta=card.createDiv('ts-timeline-meta');this.button(meta,'来源：'+item.path,'link',()=>this.open(item.path,item.line));if(item.task)this.button(meta,'调整时间：'+item.title,'clock-3',()=>this.edit(item.task));
 }
 private preserveFocus(){return preserveTaskRowFocus(this.el,'.ts-timeline-item,.ts-timeline-untimed-row','.ts-day-timeline-actions button');}
 render(){if(!this.active)return;const restore=this.preserveFocus();try{this.renderContents();}finally{restore();}}
 private renderContents(){const scroll=this.body.scrollTop;const now=new Date(),minute=now.getHours()*60+now.getMinutes(),today=this.day===localDay();this.clock.setText(today?clockLabel(minute):'');this.body.hidden=!this.embedded&&!!this.state.collapsed;
  this.toggle.setAttribute('aria-expanded',String(!this.state.collapsed));this.toggle.setAttribute('aria-label',this.state.collapsed?'展开时间线':'收起时间线');this.toggle.title=this.state.collapsed?'展开时间线':'收起时间线';setIcon(this.toggle,this.state.collapsed?'chevron-down':'chevron-up');
  this.done.setAttribute('aria-pressed',String(!!this.state.hideDone));this.done.setAttribute('aria-label',this.state.hideDone?'显示已完成事项':'隐藏已完成事项');this.done.title=this.state.hideDone?'显示已完成事项':'隐藏已完成事项';this.body.empty();if(!this.embedded&&this.state.collapsed)return;
  if(this.planner.failures.size)this.body.createDiv({cls:'ts-timeline-error',text:'部分任务来源暂时无法读取'});
  const all=dayTimeline(this.planner.all(),this.day,this.records),items=this.state.hideDone?all.items.filter(i=>!i.task?.checked):all.items,untimed=this.state.hideDone?all.untimed.filter(t=>!t.checked):all.untimed,list=this.body.createDiv('ts-timeline-track'),gaps=timelineGaps(all.items);let inserted=false,gapIndex=0;
  const marker=()=>{const row=list.createDiv('ts-timeline-now');row.createSpan({text:clockLabel(minute)});row.createSpan({text:'现在'});inserted=true;};
  for(const item of items.slice(0,this.limit)){while(gapIndex<gaps.length&&gaps[gapIndex].end<=item.slot.start){const gap=gaps[gapIndex++],button=this.button(list,`安排空档 ${clockLabel(gap.start)}–${clockLabel(gap.end)}`,'plus',()=>this.edit(undefined,clockLabel(gap.start),clockLabel(gap.end)));button.addClass('ts-timeline-gap');button.createSpan({text:`${gap.end-gap.start} 分钟空档`});}if(today&&!inserted&&item.slot.start>=minute)marker();this.row(list,item);}if(today&&!inserted&&items.length<=this.limit)marker();
  if(!items.length)this.body.createDiv({cls:'ts-timeline-empty',text:'这一天还没有时间安排。点击 ＋，或在任务前写 09:00 - 10:00。'});
  if(items.length>this.limit){const more=this.body.createEl('button',{cls:'ts-timeline-more',text:`显示更多（剩余 ${items.length-this.limit}）`});more.onclick=()=>{this.limit+=40;this.render();};}
  if(untimed.length){const details=this.body.createEl('details',{cls:'ts-timeline-untimed'});details.open=!!this.state.untimedOpen;details.createEl('summary',{text:`未定时间 · ${untimed.length}`});details.ontoggle=()=>{this.state.untimedOpen=details.open;};for(const task of untimed.slice(0,this.limit)){const row=details.createDiv('ts-timeline-untimed-row');row.dataset.path=task.path;row.dataset.line=String(task.line);this.taskCheck(row,task);const title=row.createEl('button',{cls:'ts-timeline-title',text:task.title});title.onclick=()=>void this.open(task.path,task.line).catch(e=>new Notice(String(e)));this.button(row,'安排时间：'+task.title,'clock-3',()=>this.edit(task));}if(untimed.length>this.limit){const more=details.createEl('button',{text:'显示更多未定时间事项'});more.onclick=()=>{this.limit+=40;this.render();};}}
  this.body.scrollTop=scroll;
 }
 onunload(){this.active=false;this.el.empty();}
}
