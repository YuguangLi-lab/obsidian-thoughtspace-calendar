import {preserveTaskRowFocus} from './ui-focus';
import {TaskScheduleModal} from './task-schedule-view';
import {App,Component,Modal,Notice,TFile,setIcon} from 'obsidian';
import {localDay} from './filing';
import {TaskPlanner} from './task-planner';
import {PlannedTask} from './task-planner-model';
import {timelineSelection} from './timeline-selection';
import {taskPresentation} from './task-display';
import {startCalendarTaskDrag,canReadCalendarTaskDrag,readCalendarTaskDrag,endCalendarTaskDrag} from './calendar-task-drag';
import {resolveCalendarTask,taskSchedulingChange} from './calendar-scheduling';
import {mountTimeRangePicker} from './time-range-selection';
import {timeRangeEscape} from './time-range-keymap';
import {clockLabel,journalRecords,scheduleText,timeSlot,timelineGaps,TimelineItem} from './day-timeline-model';
import type {PomodoroActions} from './pomodoro';
export type DayTimelineState={collapsed?:boolean;hideDone?:boolean;untimedOpen?:boolean};
/** Reuses the task index; the clock tick only updates the visible day, never scans files. */
export class DayTimeline extends Component {
 private records:TimelineItem[]=[];private query='';private tag='';private active=false;private limit=40;private body!:HTMLElement;private clock!:HTMLElement;private toggle!:HTMLButtonElement;private done!:HTMLButtonElement;
 private dragging=false;private externalDragging=false;private deferredRender=false;private dragTimer?:number;private dropSaving=false;
 constructor(private app:App,private el:HTMLElement,private planner:TaskPlanner,private day:string,private journal:{path:string;text:string}|undefined,private state:DayTimelineState,private add:(text:string)=>Promise<void>,private embedded=false,private pomodoro?:PomodoroActions){super();this.records=journal?journalRecords(journal.text,journal.path):[];}
 private button(parent:HTMLElement,label:string,icon:string,run:()=>unknown){const b=parent.createEl('button',{attr:{'aria-label':label,title:label}});setIcon(b,icon);b.onclick=()=>{b.disabled=true;Promise.resolve().then(run).catch(e=>new Notice(String(e))).finally(()=>b.disabled=false);};return b;}
 onload(){this.active=true;this.el.addClass('ts-day-timeline');this.el.toggleClass('is-embedded',this.embedded);this.el.setAttribute('aria-label','所选日期时间线');this.el.dataset.day=this.day;
  const head=this.el.createDiv('ts-day-timeline-head');if(!this.embedded){head.createEl('h3',{text:'时间线'});head.createSpan({cls:'ts-day-timeline-date',text:this.day===localDay()?'今天':`${Number(this.day.slice(5,7))}月${Number(this.day.slice(8))}日`});}
  this.clock=head.createSpan('ts-day-timeline-clock');const actions=head.createDiv('ts-day-timeline-actions');
  this.done=this.button(actions,'隐藏已完成事项','check-check',()=>{this.state.hideDone=!this.state.hideDone;this.app.workspace.requestSaveLayout();this.render();});
  if(!this.embedded)this.button(actions,'新增时间安排','plus',()=>this.edit());
  this.toggle=this.button(actions,'收起时间线','chevron-up',()=>{this.state.collapsed=!this.state.collapsed;this.app.workspace.requestSaveLayout();this.render();});
  this.toggle.hidden=this.embedded;this.body=this.el.createDiv('ts-day-timeline-body');this.register(this.planner.subscribe(()=>this.render()));this.registerInterval(window.setInterval(()=>this.refreshClock(),60000));
  this.body.setText('正在读取时间安排…');void this.planner.ready().then(()=>this.render()).catch(e=>{if(this.active)this.body.setText('时间安排暂时无法读取：'+String(e));});
 }
 private async open(path:string,line:number){const file=this.app.vault.getAbstractFileByPath(path);if(!(file instanceof TFile))throw Error('来源已移动或删除，请刷新');const leaf=this.app.workspace.getLeavesOfType('markdown').find(l=>(l.view as {file?:TFile}).file===file)||this.app.workspace.getLeaf('tab');await leaf.openFile(file,{eState:{line}});await this.app.workspace.revealLeaf(leaf);}
 edit(task?:PlannedTask,startAt?:string,endAt?:string){if(task){new TaskScheduleModal(this.app,this.planner,task,this.day).open();return;}const m=new Modal(this.app);m.modalEl.addClass('ts-timeline-modal');m.modalEl.addClass('ts-calendar-plugin');m.titleEl.setText('新增时间安排');m.contentEl.createEl('p',{text:this.day,cls:'ts-muted'});
  const title=m.contentEl.createEl('input',{type:'text',value:'',attr:{placeholder:'准备做什么？','aria-label':'时间安排内容'}});
  const times=m.contentEl.createDiv('ts-timeline-time-fields');const field=(label:string,value:string)=>{const wrap=times.createEl('label');wrap.createSpan({text:label});return wrap.createEl('input',{type:'time',value,attr:{'aria-label':label}});};
  const now=new Date(),start=field('开始时间',startAt||clockLabel(now.getHours()*60+now.getMinutes())),end=field('结束时间（可选）',endAt||'');
  const picker=mountTimeRangePicker(m.contentEl,start,end,timeRangeEscape(this.app,m.scope));m.onClose=()=>{picker.destroy();m.contentEl.empty();};
  const error=m.contentEl.createDiv({cls:'ts-timeline-error',attr:{role:'alert'}});const save=m.contentEl.createEl('button',{text:'保存安排',cls:'mod-cta'});
  const submit=async()=>{if(save.disabled)return;try{const text=scheduleText(title.value,start.value,end.value);[title,start,end,save].forEach(el=>el.disabled=true);picker.refresh();await this.add(text);m.close();}catch(e){error.setText(e instanceof Error?e.message:String(e));[title,start,end,save].forEach(el=>el.disabled=false);picker.refresh();}};
  save.onclick=()=>void submit();title.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();void submit();}};m.open();title.focus();
 }
 private taskCheck(parent:HTMLElement,task:PlannedTask){const check=parent.createEl('input',{type:'checkbox',attr:{'aria-label':`${task.checked?'重新打开':'完成'}任务：${task.title}`}});check.checked=task.checked;check.disabled=!this.planner.canToggle(task);if(task.recurring)check.title=check.disabled?'重复任务需要启用 Tasks 7.2 或更新版本，也可以在原文完成':task.checked?'通过 Tasks 重新打开此任务':'通过 Tasks 完成，并按重复规则生成下一项';check.onchange=()=>{const restore=this.preserveFocus();check.disabled=true;void this.planner.update(task,{checked:check.checked}).catch(e=>{new Notice(String(e));this.render();}).finally(restore);};}
 private taskLabels(parent:HTMLElement,presentation:ReturnType<typeof taskPresentation>,limit=2){
  if(!presentation.tags.length&&!presentation.recurrence)return;const labels=parent.createDiv('ts-task-labels');
  for(const tag of presentation.tags.slice(0,limit))labels.createSpan({cls:'ts-task-label is-tag',attr:{title:tag}}).createSpan({text:tag});
  if(presentation.tags.length>limit)labels.createSpan({cls:'ts-task-label',attr:{title:presentation.tags.slice(limit).join(' ')}}).createSpan({text:'+'+(presentation.tags.length-limit)});
  if(presentation.recurrence){const repeat=labels.createSpan({cls:'ts-task-label is-repeat',attr:{title:'重复规则：'+presentation.recurrence,'aria-label':'重复规则：'+presentation.recurrence}});setIcon(repeat.createSpan({attr:{'aria-hidden':'true'}}),'repeat-2');repeat.createSpan({text:'重复'});}
 }
 private clearDropPreview(){this.el.querySelectorAll('.is-timeline-drop-target').forEach(el=>el.removeClass('is-timeline-drop-target'));this.el.querySelectorAll('.ts-timeline-drop-preview').forEach(el=>el.remove());}
 private endDrag(){
  this.el.ownerDocument.defaultView!.clearTimeout(this.dragTimer);this.dragTimer=undefined;const owned=this.dragging;this.dragging=false;this.externalDragging=false;if(owned)endCalendarTaskDrag(this.app);this.el.removeClass('is-timeline-dragging');this.el.querySelectorAll('.is-timeline-drag-source').forEach(el=>el.removeClass('is-timeline-drag-source'));this.clearDropPreview();
  if(this.deferredRender){this.deferredRender=false;this.render();}
 }
 /** The shared opaque token works across side panels and the large calendar. */
 private bindTaskDrag(row:HTMLElement,task:PlannedTask){
  if(task.checked)return;row.draggable=true;row.title='拖动安排时间，或拖到大日历：'+task.title;
  const grip=row.createSpan({cls:'ts-timeline-drag-grip',attr:{'aria-hidden':'true'}});setIcon(grip,'grip-vertical');let interactive=false;
  row.onpointerdown=e=>{interactive=!!(e.target as Element).closest('button,input,select,a,textarea,[contenteditable=true]');};
  row.ondragstart=e=>{if(interactive||this.dropSaving||!e.dataTransfer){e.preventDefault();return;}e.stopPropagation();try{startCalendarTaskDrag(this.app,task,e.dataTransfer);}catch(error){e.preventDefault();new Notice(String(error));return;}
   this.dragging=true;row.addClass('is-timeline-drag-source');this.el.addClass('is-timeline-dragging');};
  row.ondragend=e=>{e.stopPropagation();this.endDrag();};
 }
 private bindDropTarget(target:HTMLElement,startMinute:number){
  const accepts=(e:DragEvent)=>!this.dropSaving&&canReadCalendarTaskDrag(this.app,e.dataTransfer);
  target.ondragover=e=>{if(!accepts(e))return;e.preventDefault();e.stopPropagation();e.dataTransfer!.dropEffect='move';this.externalDragging=true;
   const win=this.el.ownerDocument.defaultView!;win.clearTimeout(this.dragTimer);this.dragTimer=win.setTimeout(()=>{this.externalDragging=false;this.clearDropPreview();if(this.deferredRender&&!this.dragging){this.deferredRender=false;this.render();}},350);
   if(target.hasClass('is-timeline-drop-target'))return;this.clearDropPreview();target.addClass('is-timeline-drop-target');target.createSpan({cls:'ts-timeline-drop-preview',text:'安排至 '+clockLabel(startMinute)});
  };
  target.ondragleave=e=>{if(!target.contains(e.relatedTarget as Node|null))this.clearDropPreview();};
  target.ondrop=e=>{if(!accepts(e))return;const displayed=readCalendarTaskDrag(this.app,e.dataTransfer);if(!displayed)return;e.preventDefault();e.stopPropagation();this.dropSaving=true;endCalendarTaskDrag(this.app);this.endDrag();
   void this.planner.ready().then(()=>{if(!this.active)throw Error('时间线已关闭，安排已取消');const current=resolveCalendarTask(this.planner.all(),displayed);return this.planner.update(current,taskSchedulingChange(displayed,this.day,startMinute));}).catch(error=>{if(this.active)new Notice(String(error));}).finally(()=>{this.dropSaving=false;if(this.deferredRender){this.deferredRender=false;this.render();}});
  };
 }
 private row(parent:HTMLElement,item:TimelineItem){
  const row=parent.createDiv('ts-timeline-item');row.dataset.path=item.path;row.dataset.line=String(item.line);row.dataset.source=item.task?.source||item.title;if(item.task)row.dataset.focusKey=this.planner.focusKey(item.task);row.dataset.kind=item.kind;row.dataset.priority=item.task&&item.task.priority<=1?'high':'normal';row.toggleClass('is-done',!!item.task?.checked);row.toggleClass('has-conflict',!!item.conflict);row.dataset.start=String(item.slot.start);if(item.slot.end!==undefined)row.dataset.end=String(item.slot.end);
  const duration=item.slot.end!==undefined?item.slot.end-item.slot.start:0;row.style.setProperty('--node-height',`${Math.min(72,36+duration*.32)}px`);
  const now=new Date(),minute=now.getHours()*60+now.getMinutes(),current=this.day===localDay()&&!item.task?.checked&&item.slot.end!==undefined&&minute>=item.slot.start&&minute<item.slot.end;row.toggleClass('is-current',current);
  const icon=item.kind==='record'?'notebook-pen':item.task?.checked?'check':/阅读|读书|read|book/i.test(item.title)?'book-open':/写作|整理|write|专注/i.test(item.title)?'pencil':/会议|讨论|meet/i.test(item.title)?'messages-square':/休息|咖啡|break/i.test(item.title)?'coffee':'circle-dot';
  const node=row.createSpan({cls:'ts-timeline-node',attr:{'aria-hidden':'true'}});setIcon(node,icon);
  const card=row.createDiv('ts-timeline-card'),time=item.task?card.createEl('button',{cls:'ts-timeline-time is-editable',attr:{'aria-label':'调整时间：'+item.title,title:'点击调整日期、时间和优先级'}}):card.createDiv('ts-timeline-time');if(item.task)time.onclick=()=>this.edit(item.task);time.createSpan({text:clockLabel(item.slot.start)});if(item.slot.end!==undefined){time.createSpan({cls:'ts-timeline-end',text:'– '+clockLabel(item.slot.end)});time.createSpan({cls:'ts-timeline-duration',text:`${duration} 分钟`});}const activeLabel=time.createSpan({cls:'ts-timeline-active-label',text:'进行中'});activeLabel.hidden=!current;
  const heading=card.createDiv('ts-timeline-card-heading'),presentation=item.task?taskPresentation(item.task):undefined,displayTitle=presentation?(timeSlot(presentation.title)?.title||presentation.title):item.title;const title=heading.createEl('button',{cls:'ts-timeline-title',text:displayTitle,attr:{title:'打开来源：'+item.path,'aria-label':'打开来源：'+item.title}});title.onclick=()=>void this.open(item.path,item.line).catch(e=>new Notice(String(e)));if(item.task)this.taskCheck(heading,item.task);if(presentation)this.taskLabels(card,presentation);
  if(item.conflict||item.slot.invalidRange)card.createSpan({cls:'ts-timeline-conflict',text:item.conflict?'时间重叠':'请检查结束时间'});
  const meta=card.createDiv('ts-timeline-meta'),source=this.button(meta,'来源：'+item.path,'file-text',()=>this.open(item.path,item.line));source.addClass('ts-timeline-source');source.createSpan({text:item.path.split('/').pop()!.replace(/\.md$/i,'')});if(item.task)this.button(meta,'编辑安排：'+item.title,'sliders-horizontal',()=>this.edit(item.task));
  const task=item.task;if(task&&!task.checked&&this.pomodoro)this.button(meta,'开始计时：'+task.title,'timer',()=>this.pomodoro!.startTask(task)).addClass('ts-timeline-pomodoro');
  this.bindDropTarget(row,item.slot.start);if(item.task)this.bindTaskDrag(row,item.task);
 }
 /** Keep cards, focus and expanded sections intact when only the minute changes. */
 private refreshClock(now=new Date()){
  if(!this.active)return;const today=this.day===localDay(now),minute=now.getHours()*60+now.getMinutes(),label=today?clockLabel(minute):'';
  if(this.clock.textContent!==label)this.clock.setText(label);
  if(this.dragging||this.externalDragging||this.dropSaving)return;
  const track=this.body.querySelector<HTMLElement>('.ts-timeline-track');if(!track)return;
  const rows=Array.from(track.querySelectorAll<HTMLElement>('.ts-timeline-item'));
  for(const row of rows){const current=today&&!row.hasClass('is-done')&&row.dataset.end!==undefined&&minute>=Number(row.dataset.start)&&minute<Number(row.dataset.end);row.toggleClass('is-current',current);const label=row.querySelector<HTMLElement>('.ts-timeline-active-label');if(label)label.hidden=!current;}
  const marker=track.querySelector<HTMLElement>('.ts-timeline-now');if(!marker)return;
  const next=rows.find(row=>Number(row.dataset.start)>=minute);marker.hidden=!today||(!next&&track.dataset.hasMore==='true');
  const time=marker.querySelector<HTMLElement>('.ts-timeline-now-time');if(time&&time.textContent!==label)time.setText(label);
  if(!marker.hidden&&marker.nextElementSibling!==(next||null))track.insertBefore(marker,next||null);
 }
 setFilter(query='',tag='',quiet=false){if(this.query===query&&this.tag===tag)return;this.query=query;this.tag=tag;this.limit=40;if(!quiet)this.render();}
 private preserveFocus(){return preserveTaskRowFocus(this.el,'.ts-timeline-item,.ts-timeline-untimed-row','.ts-day-timeline-actions button');}
 render(){if(!this.active)return;if(this.dragging||this.externalDragging||this.dropSaving){this.deferredRender=true;return;}const restore=this.preserveFocus();try{this.renderContents();}finally{restore();}}
 private renderContents(){const scroll=this.body.scrollTop;const now=new Date(),minute=now.getHours()*60+now.getMinutes(),today=this.day===localDay();this.clock.setText(today?clockLabel(minute):'');this.body.hidden=!this.embedded&&!!this.state.collapsed;
  this.toggle.setAttribute('aria-expanded',String(!this.state.collapsed));this.toggle.setAttribute('aria-label',this.state.collapsed?'展开时间线':'收起时间线');this.toggle.title=this.state.collapsed?'展开时间线':'收起时间线';setIcon(this.toggle,this.state.collapsed?'chevron-down':'chevron-up');
  this.done.setAttribute('aria-pressed',String(!!this.state.hideDone));this.done.setAttribute('aria-label',this.state.hideDone?'显示已完成事项':'隐藏已完成事项');this.done.title=this.state.hideDone?'显示已完成事项':'隐藏已完成事项';this.body.empty();if(!this.embedded&&this.state.collapsed)return;
  if(this.planner.failures.size)this.body.createDiv({cls:'ts-timeline-error',text:'部分任务来源暂时无法读取'});
  const all=timelineSelection(this.planner.all(),this.day,this.records,this.query,this.tag),items=this.state.hideDone?all.items.filter(i=>!i.task?.checked):all.items,untimed=this.state.hideDone?all.untimed.filter(t=>!t.checked):all.untimed,list=this.body.createDiv('ts-timeline-track'),gaps=this.query.trim()||this.tag?[]:timelineGaps(all.items);list.dataset.hasMore=String(items.length>this.limit);let gapIndex=0;
  for(const item of items.slice(0,this.limit)){while(gapIndex<gaps.length&&gaps[gapIndex].end<=item.slot.start){const gap=gaps[gapIndex++],button=this.button(list,`安排空档 ${clockLabel(gap.start)}–${clockLabel(gap.end)}`,'plus',()=>this.edit(undefined,clockLabel(gap.start),clockLabel(gap.end)));button.addClass('ts-timeline-gap');button.createSpan({text:`${gap.end-gap.start} 分钟空档`});this.bindDropTarget(button,gap.start);}this.row(list,item);}
  const marker=list.createDiv('ts-timeline-now');marker.createSpan({cls:'ts-timeline-now-time'});marker.createSpan({text:'现在'});this.refreshClock(now);
  if(!items.length)this.body.createDiv({cls:'ts-timeline-empty',text:this.query.trim()||this.tag?'没有匹配的时间安排。可清空搜索或标签筛选。':'这一天还没有时间安排。点击 ＋，或在任务前写 09:00 - 10:00。'});
  if(items.length>this.limit){const more=this.body.createEl('button',{cls:'ts-timeline-more',text:`显示更多（剩余 ${items.length-this.limit}）`});more.onclick=()=>{this.limit+=40;this.render();};}
  if(untimed.length){const details=this.body.createEl('details',{cls:'ts-timeline-untimed'});details.open=!!this.state.untimedOpen;details.createEl('summary',{text:`未定时间 · ${untimed.length}`});details.ontoggle=()=>{this.state.untimedOpen=details.open;};for(const task of untimed.slice(0,this.limit)){const row=details.createDiv('ts-timeline-untimed-row');row.dataset.path=task.path;row.dataset.line=String(task.line);row.dataset.source=task.source;row.dataset.focusKey=this.planner.focusKey(task);this.taskCheck(row,task);const content=row.createDiv('ts-timeline-untimed-content'),presentation=taskPresentation(task),title=content.createEl('button',{cls:'ts-timeline-title',text:presentation.title});title.onclick=()=>void this.open(task.path,task.line).catch(e=>new Notice(String(e)));this.taskLabels(content,presentation,1);if(!task.checked&&this.pomodoro)this.button(row,'开始计时：'+task.title,'timer',()=>this.pomodoro!.startTask(task)).addClass('ts-timeline-pomodoro');this.button(row,'安排时间：'+task.title,'clock-3',()=>this.edit(task));this.bindTaskDrag(row,task);}if(untimed.length>this.limit){const more=details.createEl('button',{text:'显示更多未定时间事项'});more.onclick=()=>{this.limit+=40;this.render();};}}
  this.body.scrollTop=scroll;
 }
 onunload(){this.active=false;this.endDrag();this.el.empty();}
}
