import {App,Modal} from 'obsidian';
import {TaskPlanner} from './task-planner';
import {PlannedTask,isToday} from './task-planner-model';
import {clockLabel,scheduleText,timeSlot} from './task-time';
import {themeSurface} from './ui-tokens';
import {mountTimeRangePicker,type TimeRangeControl} from './time-range-selection';
import {timeRangeEscape} from './time-range-keymap';

/** One explicit-save editor shared by list, quadrants and timeline. */
export class TaskScheduleModal extends Modal {
 private timeRange?:TimeRangeControl;
 private pending=false;private closed=false;
 constructor(app:App,private planner:TaskPlanner,private task:PlannedTask,private day:string){super(app);}
 onOpen(){
  this.closed=false;
  themeSurface(this.modalEl);this.modalEl.addClass('ts-task-schedule-modal');
  this.titleEl.setText('安排任务');
  const task=this.task,slot=timeSlot(task.text),display=timeSlot(task.title);
  this.contentEl.createDiv({cls:'ts-schedule-task-name',text:display?.title||task.title});
  this.contentEl.createDiv({cls:'ts-schedule-source',text:task.path,attr:{title:task.path}});
  const form=this.contentEl.createEl('form');
  const dates=form.createDiv('ts-schedule-fields');
  const field=(parent:HTMLElement,label:string,type:string,value:string)=>{const wrap=parent.createEl('label');wrap.createSpan({text:label});return wrap.createEl('input',{type,value,attr:{'aria-label':label}});};
  const scheduled=field(dates,'计划日期','date',task.scheduled||(!task.due&&!task.day?this.day:''));
  const due=field(dates,'截止日期','date',task.due||'');
  const section=form.createDiv('ts-schedule-time-section');
  const heading=section.createDiv('ts-schedule-section-heading');heading.createSpan({text:'具体时间'});
  const clear=heading.createEl('button',{type:'button',text:'清除时间'});
  clear.type='button';
  const times=section.createDiv('ts-schedule-fields');
  const start=field(times,'开始时间','time',slot?clockLabel(slot.start):'');
  const end=field(times,'结束时间（可选）','time',slot?.endInput||'');
  this.timeRange=mountTimeRangePicker(section,start,end,timeRangeEscape(this.app,this.scope));
  const presets=section.createDiv({cls:'ts-schedule-presets',attr:{role:'group','aria-label':'快捷时长'}});
  const durationButtons:{button:HTMLButtonElement;duration:number}[]=[];
  for(const duration of [15,30,60,90]){const b=presets.createEl('button',{type:'button',text:duration+' 分钟',attr:{'aria-label':'时长 '+duration+' 分钟'}});b.type='button';durationButtons.push({button:b,duration});b.onclick=()=>{const value=timeSlot(start.value);if(value&&value.start+duration<1440){end.value=clockLabel(value.start+duration);refresh();}};}
  const status=section.createDiv({cls:'ts-schedule-status',attr:{'aria-live':'polite'}});
  const conflict=section.createDiv({cls:'ts-schedule-conflict',attr:{'aria-live':'polite'}});
  const priorityLabel=form.createEl('label',{cls:'ts-schedule-priority'});priorityLabel.createSpan({text:'优先级'});
  const priority=priorityLabel.createEl('select',{attr:{'aria-label':'优先级'}});
  for(const [value,text]of ['最高','高','中','普通','低','最低'].entries())priority.createEl('option',{value:String(value),text});priority.value=String(task.priority);
  const error=form.createDiv({cls:'ts-schedule-error',attr:{role:'alert'}});
  const footer=form.createDiv('ts-schedule-footer');const cancel=footer.createEl('button',{type:'button',text:'取消'});cancel.type='button';cancel.onclick=()=>this.close();
  const save=footer.createEl('button',{type:'submit',cls:'mod-cta',text:'保存安排'});
  save.type='submit';
  const refresh=()=>{
   this.timeRange?.refresh();
   error.empty();const first=timeSlot(start.value),last=timeSlot(end.value),length=first&&last?last.start-first.start:0;
   clear.disabled=!start.value&&!end.value;
   for(const {button,duration}of durationButtons){button.disabled=!first||first.start+duration>=1440;button.setAttribute('aria-pressed',String(length===duration));}
   const date=scheduled.value||due.value||task.day||this.day;
   status.setText(!first?'不设时间 · 只安排日期':length>0?`${length} 分钟 · ${date}`:end.value?'结束时间须晚于开始时间':`仅设开始时间 · ${date}`);
   const overlaps=first&&last&&length>0?this.planner.all().filter(other=>!other.checked&&!(other.path===task.path&&other.line===task.line)&&isToday(other,date)).filter(other=>{const value=timeSlot(other.text);return value?.end!==undefined&&first.start<value.end&&last.start>value.start;}):[];
   conflict.hidden=!overlaps.length;conflict.setText(overlaps.length?`与 ${overlaps.length} 项未完成任务时间重叠，仍可保存。`:'');
  };
  clear.onclick=()=>{start.value='';end.value='';refresh();start.focus();};
  for(const input of [scheduled,due,start,end])input.oninput=refresh;
  form.onsubmit=e=>{e.preventDefault();if(this.closed||this.pending||save.disabled)return;const focused=this.contentEl.ownerDocument.activeElement as HTMLElement|null;
   void (async()=>{try{
    if(end.value&&!start.value)throw Error('请先填写开始时间');
    if(start.value)scheduleText(slot?.title||task.text,start.value,end.value);
    this.pending=true;form.querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLSelectElement>('input,button,select').forEach(el=>el.disabled=true);this.timeRange?.refresh();
    // Keep all metadata on the original line; one process call also gives one undo receipt.
    await this.planner.update(task,{scheduled:scheduled.value||(!due.value&&!task.day&&start.value?this.day:''),due:due.value,priority:Number(priority.value),time:start.value?{start:start.value,end:end.value}:null});
    if(!this.closed)this.close();
   }catch(reason){if(!this.closed){form.querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLSelectElement>('input,button,select').forEach(el=>el.disabled=false);refresh();error.setText(reason instanceof Error?reason.message:String(reason));if(focused&&form.contains(focused))focused.focus();}}finally{this.pending=false;}})();
  };
  // Enter inside native date/time controls should never submit while composing text.
  form.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.isComposing)e.preventDefault();});
  refresh();start.focus();
 }
 onClose(){this.closed=true;this.timeRange?.destroy();this.timeRange=undefined;this.contentEl.empty();}
}
