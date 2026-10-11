import {TaskScheduleModal} from './task-schedule-view';
import {startCalendarTaskDrag,endCalendarTaskDrag} from './calendar-task-drag';
import {timeSlot} from './task-time';
import {DayTimeline} from './day-timeline-view';
import {TASK_QUADRANTS,TaskQuadrant,taskQuadrant,quadrantOverride,setTaskQuadrant} from './task-quadrants';
import {App,MarkdownRenderChild,Menu,Modal,Notice,TFile,setIcon} from 'obsidian';
import {dateOf,shiftDay} from './calendar-tools';
import {PlannedTask,TaskFilter,selectTasks,taskDate,taskMatches,groupTasks,TaskGrouping} from './task-planner-model';
import {TaskPlanner} from './task-planner';
import {themeSurface} from './ui-tokens';
import {preserveTaskRowFocus} from './ui-focus';
const modes:[TaskFilter,string][]=[['today','当天待办'],['unfinished','未完成'],['overdue','已逾期'],['upcoming','未来七天'],['inbox','未安排'],['done','当天已完成'],['timeline','时间线'],['completed','全部已完成']];
export type TaskPanelState={filter?:TaskFilter;query?:string;tag?:string;sort?:'priority'|'date'|'source'|'time';limit?:number;filtersOpen?:boolean;group?:TaskGrouping;view?:'list'|'quadrants'|'timeline'};
export class TaskPanel extends MarkdownRenderChild {
 private filter:TaskFilter='today';private query='';private tag='';private sort:'priority'|'date'|'source'|'time'='priority';private limit=30;private active=false;private rows!:HTMLElement;private summary!:HTMLElement;private tabs=new Map<TaskFilter,HTMLButtonElement>();private tagSelect!:HTMLSelectElement;
 private tagOptionsKey?:string;
 private drag?:{task:PlannedTask;token:string;quadrant?:TaskQuadrant};
 private timeline?:DayTimeline;private view:'list'|'quadrants'|'timeline'='list';private viewButtons=new Map<string,HTMLButtonElement>();private quadrantLimits:Record<TaskQuadrant,number>={q1:8,q2:8,q3:8,q4:8};private filterSummary?:HTMLElement;private group:TaskGrouping='none';private undoButton?:HTMLButtonElement;private searchInput?:HTMLInputElement;
 constructor(private app:App,private el:HTMLElement,private planner:TaskPlanner,private day:string,private state:TaskPanelState={},private compact=false,private actionHost?:HTMLElement,private timelineFactory?:(el:HTMLElement)=>DayTimeline){super(el);dateOf(day);Object.assign(this,state);if(this.view==='timeline'&&!timelineFactory)this.view='list';}
 private button(el:HTMLElement,title:string,icon:string,fn:()=>unknown){const b=el.createEl('button',{attr:{'aria-label':title,title}});setIcon(b,icon);b.onclick=()=>{b.disabled=true;Promise.resolve().then(fn).catch(e=>new Notice(String(e))).finally(()=>b.disabled=false);};return b;}
 onload(){this.el.addClass('ts-calendar-plugin');this.registerDomEvent(this.el.ownerDocument,'keydown',e=>{if(e.key==='Escape'&&this.drag){e.preventDefault();this.endDrag();this.render();}});this.active=true;this.el.addClass('ts-task-planner');this.el.setAttribute('aria-label','日记任务中心');const head=this.actionHost||this.el.createDiv('ts-task-planner-head');if(!this.actionHost)head.createEl('h3',{text:this.compact?'任务管理':'待办与未完成'});const headActions=head.createDiv('ts-task-head-actions');this.register(()=>headActions.remove());this.undoButton=this.button(headActions,'撤销上次任务操作','undo-2',()=>this.planner.undoLast());this.button(headActions,'刷新任务','refresh-cw',async()=>{await this.planner.rescan();this.render();});const views=(this.actionHost||this.el).createDiv({cls:'ts-task-view-switch',attr:{role:'group','aria-label':'任务展示方式'}});if(this.actionHost){this.actionHost.prepend(views);this.register(()=>views.remove());}for(const [id,label,icon]of [['list','列表','list'],['quadrants','四象限','layout-grid'],['timeline','时间线','clock-3']] as const){if(id==='timeline'&&!this.timelineFactory)continue;const b=views.createEl('button',{attr:{'aria-label':label+'模式',title:label+'模式'}});setIcon(b.createSpan({attr:{'aria-hidden':'true'}}),icon);b.onclick=()=>{this.view=id;this.state.view=id;this.app.workspace.requestSaveLayout();this.render();};this.viewButtons.set(id,b);}this.summary=this.el.createDiv({cls:'ts-task-summary ts-task-scope-switch',text:'正在读取笔记中的任务…',attr:{role:'group','aria-label':'常用任务范围'}});
  let filterHost=this.el;if(this.compact){const disclosure=this.el.createEl('details',{cls:'ts-task-filter-disclosure'});disclosure.open=!!this.state.filtersOpen;this.filterSummary=disclosure.createEl('summary');disclosure.ontoggle=()=>{if(this.active)this.state.filtersOpen=disclosure.open;};filterHost=disclosure;}
  const tabs=filterHost.createDiv({cls:'ts-task-filters',attr:{role:'group','aria-label':'任务范围'}});for(const [id,label]of modes){const b=tabs.createEl('button',{text:label});b.onclick=()=>this.setFilter(id);this.tabs.set(id,b);}
  const tools=filterHost.createDiv('ts-task-tools');const search=tools.createEl('input',{type:'search',attr:{placeholder:'搜索任务或笔记…','aria-label':'搜索汇总任务'}});search.value=this.query;this.searchInput=search;search.oninput=()=>{this.query=search.value;this.limit=30;this.render();};search.onkeydown=e=>{if(e.key==='Escape'&&!e.isComposing&&search.value){e.preventDefault();e.stopPropagation();search.value='';this.query='';this.limit=30;this.render();}};
  const selects=tools.createDiv('ts-task-selects');this.tagSelect=selects.createEl('select',{attr:{'aria-label':'按任务标签筛选'}});this.tagSelect.onchange=()=>{this.tag=this.tagSelect.value;this.limit=30;this.render();};const sort=selects.createEl('select',{attr:{'aria-label':'任务排序'}});for(const[value,label]of [['priority','优先级排序'],['date','日期排序'],['source','来源排序'],['time','时间排序']])sort.createEl('option',{value,text:label});sort.value=this.sort;sort.onchange=()=>{this.sort=sort.value as typeof this.sort;this.render();};const grouping=filterHost.createEl('select',{cls:'ts-task-group-select',attr:{'aria-label':'任务分组'}});for(const [value,label]of [['none','不分组'],['source','按来源笔记分组'],['date','按安排日期分组'],['priority','按优先级分组']])grouping.createEl('option',{value,text:label});grouping.value=this.group;grouping.onchange=()=>{this.group=grouping.value as TaskGrouping;this.render();};this.rows=this.el.createDiv('ts-task-rows');
  this.register(this.planner.subscribe(()=>this.render()));void this.planner.ready().then(()=>this.render()).catch(e=>{if(this.active)this.summary.setText('任务暂时无法读取：'+String(e));});
 }
 openTimelineEditor(){if(this.view==='timeline'&&this.timeline){this.timeline.edit();return true;}return false;}
 private async open(task:PlannedTask){const f=this.app.vault.getAbstractFileByPath(task.path);if(!(f instanceof TFile))throw Error('来源笔记已移动，请刷新');const old=this.app.workspace.getLeavesOfType('markdown').find(l=>(l.view as {file?:TFile}).file===f);const leaf=old||this.app.workspace.getLeaf('tab');await leaf.openFile(f,{eState:{line:task.line}});await this.app.workspace.revealLeaf(leaf);}
 private edit(task:PlannedTask){new TaskScheduleModal(this.app,this.planner,task,this.day).open();}
 private setFilter(filter:TaskFilter,clear=false){this.filter=filter;this.limit=30;if(clear){this.query='';this.tag='';if(this.searchInput)this.searchInput.value='';}this.render();}
 private editContent(task:PlannedTask){const m=new Modal(this.app);themeSurface(m.modalEl);m.modalEl.addClass('ts-task-edit');m.titleEl.setText('编辑任务');const input=m.contentEl.createEl('input',{type:'text',value:task.text,attr:{'aria-label':'任务完整内容'}});input.style.width='100%';m.contentEl.createEl('p',{cls:'ts-muted',text:'保留需要的标签、日期和重复规则。'});const save=m.contentEl.createEl('button',{text:'保存任务',cls:'mod-cta'});save.onclick=()=>{save.disabled=true;void this.planner.update(task,{content:input.value}).then(()=>m.close()).catch(e=>{new Notice(String(e));save.disabled=false;});};input.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();save.click();}};m.open();input.focus();}
 private menuActions(task:PlannedTask){const actions:{title:string;icon:string;run:()=>unknown}[]=[{title:'安排日期、时间和优先级',icon:'calendar-clock',run:()=>this.edit(task)},{title:'编辑任务内容',icon:'pencil',run:()=>this.editContent(task)},{title:'打开任务原文',icon:'arrow-up-right',run:()=>this.open(task)}];if(!task.checked)actions.push({title:'安排到所选日',icon:'calendar-check',run:()=>this.planner.update(task,{scheduled:this.day})},{title:'安排到七天后',icon:'calendar-plus',run:()=>this.planner.update(task,{scheduled:shiftDay(this.day,7)})},{title:'清除计划与截止日期',icon:'calendar-x',run:()=>this.planner.update(task,{scheduled:'',due:''})});return actions;}
 private more(task:PlannedTask,event:MouseEvent){const menu=new Menu();for(const action of this.menuActions(task))menu.addItem(i=>i.setTitle(action.title).setIcon(action.icon).onClick(()=>{void Promise.resolve().then(action.run).catch(e=>new Notice(String(e)));}));menu.showAtMouseEvent(event);}
 render(){if(!this.active||this.drag)return;const restore=preserveTaskRowFocus(this.el);try{this.renderContents();}finally{restore();}}
 private renderContents(){const all=this.planner.all(),count=(filter:TaskFilter)=>all.reduce((n,task)=>n+Number(taskMatches(task,this.day,filter)),0);
  this.el.dataset.taskView=this.view;for(const [id,b]of this.viewButtons){b.toggleClass('is-active',id===this.view);b.setAttribute('aria-pressed',String(id===this.view));}const grouping=this.el.querySelector<HTMLSelectElement>('.ts-task-group-select');if(grouping)grouping.hidden=this.view==='quadrants';
  if(this.undoButton)this.undoButton.disabled=!this.planner.canUndo();
  if(this.view==='timeline'&&this.timelineFactory){if(!this.timeline){this.rows.empty();this.timeline=this.timelineFactory(this.rows.createDiv());this.addChild(this.timeline);}return;}if(this.timeline){this.removeChild(this.timeline);this.timeline=undefined;}
  const activeElement=this.el.ownerDocument.activeElement,focusedScope=activeElement&&this.summary.contains(activeElement)?activeElement.getAttribute('data-filter'):undefined;
  this.summary.empty();for(const[n,label,filter]of [[count('today'),'当天待办','today'],[count('unfinished'),'全部待办','unfinished'],[count('overdue'),'逾期','overdue'],[count('done'),'当天完成','done']] as const){const stat=this.summary.createEl('button',{attr:{'aria-label':label+'，'+n+' 项',title:filter==='unfinished'?'整个仓库的未完成任务':filter==='done'?this.day+' 已完成任务':filter==='today'?this.day+' 的待办任务':'截止日期已过的未完成任务'}});stat.dataset.filter=filter;stat.setAttribute('aria-pressed',String(this.filter===filter));stat.onclick=()=>this.setFilter(filter,true);stat.createEl('strong',{text:String(n)});stat.createSpan({text:label});}
  if(focusedScope)this.summary.querySelector<HTMLButtonElement>(`button[data-filter="${focusedScope}"]`)?.focus({preventScroll:true});
  for(const [id,b]of this.tabs){b.toggleClass('is-active',this.filter===id);b.setAttribute('aria-pressed',String(this.filter===id));}
  this.filterSummary?.setText(`更多筛选 · ${modes.find(([id])=>id===this.filter)?.[1]||'当天待办'}${this.query||this.tag?' · 已筛选':''}`);
  const tags=[...new Set(all.flatMap(t=>t.tags))].sort();const tagKey=JSON.stringify(tags);if(tagKey!==this.tagOptionsKey){this.tagOptionsKey=tagKey;this.tagSelect.empty();this.tagSelect.createEl('option',{value:'',text:'全部标签'});for(const tag of tags)this.tagSelect.createEl('option',{value:tag,text:tag});}if(this.tag&&!tags.includes(this.tag))this.tag='';this.tagSelect.value=this.tag;
  const tasks=selectTasks(all,this.day,this.filter,this.query,this.tag,this.sort);this.rows.empty();if(this.planner.failures.size)this.rows.createDiv({cls:'ts-task-warning',text:`${this.planner.failures.size} 篇笔记暂时无法读取，结果可能不完整。`});
  if(this.view==='list'||this.query||this.tag){const resultHead=this.rows.createDiv('ts-task-result-header');if(this.view==='list')resultHead.createDiv({cls:'ts-task-result-count',text:`${tasks.length} 项 · ${modes.find(([id])=>id===this.filter)?.[1]}${['today','done','timeline'].includes(this.filter)?' · '+this.day:''}`});if(this.query||this.tag){const reset=resultHead.createEl('button',{text:'清除筛选',attr:{'aria-label':'清除任务搜索和标签'}});reset.onclick=()=>this.setFilter(this.filter,true);}}
  if(this.view==='quadrants'){this.renderQuadrants(tasks);return;}
  const grouped=groupTasks(tasks,this.group);let shown=0;for(const group of grouped){if(shown>=this.limit)break;if(group.label){const h=this.rows.createDiv('ts-task-group-heading');h.createSpan({text:group.label});h.createSpan({text:String(group.tasks.length)});}for(const task of group.tasks){if(shown++>=this.limit)break;this.renderTaskRow(this.rows,task);
  }
  }
  if(tasks.length>this.limit){const more=this.rows.createEl('button',{cls:'ts-task-more',text:`再显示 ${Math.min(30,tasks.length-this.limit)} 项`});more.onclick=()=>{this.limit+=30;this.render();};}
 }
 private renderTaskRow(parent:HTMLElement,task:PlannedTask){
  const row=parent.createDiv('ts-task-row');row.dataset.path=task.path;row.dataset.line=String(task.line);row.toggleClass('is-done',task.checked);row.toggleClass('is-overdue',!!task.due&&task.due<this.day&&!task.checked);
   const top=row.createDiv('ts-task-row-main');const check=top.createEl('input',{type:'checkbox',attr:{'aria-label':`${task.checked?'重新打开':'完成'}任务：${task.title}`}});check.checked=task.checked;check.disabled=!this.planner.canToggle(task);if(task.recurring)check.title=check.disabled?'重复任务需要启用 Tasks 7.2 或更新版本，也可以在原文完成':task.checked?'通过 Tasks 重新打开此任务':'通过 Tasks 完成，并按重复规则生成下一项';check.onchange=()=>{const restore=preserveTaskRowFocus(this.el);check.disabled=true;void this.planner.update(task,{checked:check.checked}).catch(e=>{new Notice(String(e));this.render();}).finally(restore);};
   const slot=timeSlot(task.title),title=top.createDiv('ts-task-title');title.createSpan({text:slot?.title||task.title});
   const meta=row.createDiv('ts-task-meta');const source=meta.createEl('button',{attr:{title:task.path,'aria-label':'打开任务原文'}});setIcon(source.createSpan({cls:'ts-task-source-icon',attr:{'aria-hidden':'true'}}),'file-text');source.createSpan({cls:'ts-task-source-name',text:task.path.split('/').pop()!.replace(/\.md$/i,'')});source.onclick=()=>{void this.open(task).catch(e=>new Notice(String(e)));};if(task.priority!==3)meta.createSpan({cls:'ts-task-priority',text:['最高','高','中','普通','低','最低'][task.priority]});for(const [label,date] of [['截止',task.due],['计划',task.scheduled]])if(date)meta.createSpan({cls:label==='截止'?'ts-task-date is-due':'ts-task-date',text:`${label} ${date.slice(0,4)===this.day.slice(0,4)?date.slice(5).replace('-','/'):date}`,attr:{title:`${label} ${date}`,'aria-label':`${label} ${date}`}});
   const time=this.button(meta,slot?'调整任务时间：'+task.title:'添加任务时间：'+task.title,'clock-3',()=>this.edit(task));time.addClass('ts-task-schedule-chip');time.toggleClass('is-scheduled',!!slot);time.toggleClass('is-invalid',!!slot?.invalidRange);time.createSpan({text:slot?(slot.invalidRange?'检查时间':slot.label):'安排时间'});if(slot?.end!==undefined)time.title=slot.label+' · '+(slot.end-slot.start)+' 分钟 · 点击修改';
   const actions=row.createDiv('ts-task-row-actions');const more=this.button(actions,'更多任务操作','ellipsis',()=>{});more.onclick=e=>this.more(task,e);if(!task.checked)this.button(actions,'顺延至次日','calendar-plus',()=>this.planner.update(task,{scheduled:shiftDay(this.day,1)}));if(taskDate(task)!==this.day&&!task.checked)this.button(actions,'安排到所选日','calendar-check',()=>this.planner.update(task,{scheduled:this.day}));
   if(!task.checked)this.bindTaskDrag(row,task,this.view==='quadrants'?taskQuadrant(task,this.day):undefined);
 }
 private renderQuadrants(tasks:PlannedTask[]){
  const grid=this.rows.createDiv('ts-task-quadrants');
  for(const quadrant of TASK_QUADRANTS){const items=tasks.filter(t=>taskQuadrant(t,this.day)===quadrant.id),box=grid.createEl('section',{cls:'ts-task-quadrant',attr:{'aria-label':quadrant.label}});box.dataset.quadrant=quadrant.id;this.bindQuadrantDrop(box,quadrant.id);const heading=box.createDiv('ts-task-quadrant-head');heading.createEl('h4',{text:quadrant.label});heading.createSpan({text:String(items.length)});box.createDiv({cls:'ts-task-quadrant-hint',text:quadrant.hint});
   for(const task of items.slice(0,this.quadrantLimits[quadrant.id])){this.renderTaskRow(box,task);const row=box.lastElementChild as HTMLElement;const select=row.createEl('select',{cls:'ts-task-quadrant-select',attr:{'aria-label':'调整任务象限：'+task.title}});select.createEl('option',{value:'auto',text:'自动归类'});for(const q of TASK_QUADRANTS)select.createEl('option',{value:q.id,text:q.label});select.value=quadrantOverride(task.text)||'auto';select.onchange=()=>{const restore=preserveTaskRowFocus(this.el);select.disabled=true;void this.planner.update(task,{content:setTaskQuadrant(task.text,select.value as TaskQuadrant|'auto')}).catch(e=>{new Notice(String(e));this.render();}).finally(restore);};}
   if(!items.length)box.createDiv({cls:'ts-task-quadrant-empty',text:'拖动任务到这里'});
   if(items.length>this.quadrantLimits[quadrant.id]){const more=box.createEl('button',{cls:'ts-task-quadrant-more',text:'再显示 '+Math.min(8,items.length-this.quadrantLimits[quadrant.id])+' 项'});more.onclick=()=>{this.quadrantLimits[quadrant.id]+=8;this.render();};}
  }
 }
 private endDrag(){if(this.drag)endCalendarTaskDrag(this.app);this.drag=undefined;this.el.removeClass('is-task-dragging');this.el.querySelectorAll('.is-drag-source,.is-drop-target').forEach(e=>e.removeClass('is-drag-source','is-drop-target'));}
 private bindTaskDrag(row:HTMLElement,task:PlannedTask,quadrant?:TaskQuadrant){
  if(task.checked)return;
  row.draggable=true;row.title=task.title+(quadrant?' · 拖动到其他象限或大日历':' · 拖动到大日历安排时间');
  const grip=row.querySelector('.ts-task-title')!.createSpan({cls:'ts-task-drag-grip',attr:{'aria-hidden':'true'}});setIcon(grip,'grip-vertical');
  let interactive=false;
  row.onpointerdown=e=>{interactive=!!(e.target as Element).closest('button,input,select,option,a,textarea,[contenteditable=true]');};
  row.ondragstart=e=>{
   if(interactive||!e.dataTransfer){e.preventDefault();return;}e.stopPropagation();
   const token=crypto.randomUUID();
   try{e.dataTransfer.setData('application/x-thoughtspace-task',token);startCalendarTaskDrag(this.app,task,e.dataTransfer);}catch(error){e.preventDefault();endCalendarTaskDrag(this.app);new Notice(String(error));return;}
   this.drag={task,token,quadrant};
   row.addClass('is-drag-source');this.el.addClass('is-task-dragging');
  };
  row.ondragend=e=>{e.stopPropagation();this.endDrag();this.render();};
 }
 private bindQuadrantDrop(box:HTMLElement,quadrant:TaskQuadrant){
  const accepts=(e:DragEvent)=>!!this.drag&&!!e.dataTransfer?.types.includes('application/x-thoughtspace-task');
  box.ondragover=e=>{if(!accepts(e))return;e.preventDefault();e.stopPropagation();e.dataTransfer!.dropEffect='move';this.el.querySelectorAll('.is-drop-target').forEach(x=>{if(x!==box)x.removeClass('is-drop-target');});box.addClass('is-drop-target');};
  box.ondragleave=e=>{if(!e.relatedTarget||!box.contains(e.relatedTarget as Node))box.removeClass('is-drop-target');};
  box.ondrop=e=>{
   if(!accepts(e)||e.dataTransfer!.getData('application/x-thoughtspace-task')!==this.drag!.token)return;
   e.preventDefault();e.stopPropagation();const source=this.drag!;this.endDrag();
   if(source.quadrant===quadrant){this.render();return;}
   void this.planner.update(source.task,{content:setTaskQuadrant(source.task.text,quadrant)}).catch(error=>{new Notice(String(error));this.render();});
  };
 }
 onunload(){this.endDrag();Object.assign(this.state,{filter:this.filter,query:this.query,tag:this.tag,sort:this.sort,limit:this.limit,group:this.group,view:this.view});this.active=false;this.el.empty();}
}
