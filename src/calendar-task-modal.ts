import {Modal} from 'obsidian';
import {dayKey, parseDay, type CalendarTask} from './calendar-model';
import {clockLabel} from './task-time';
import type {LargeCalendarHost} from './large-calendar-view';
import {mountTimeRangePicker,type TimeRangeControl} from './time-range-selection';
import {timeRangeEscape} from './time-range-keymap';

/** Keyboard and touch alternative to dragging. Only the scheduled date/time is changed. */
export class CalendarTaskScheduleModal extends Modal {
  private pending=false;
  private closed=false;
  private timeRange?:TimeRangeControl;
  constructor(private host:LargeCalendarHost,private task:CalendarTask,private date:Date) {super(host.app);}
  onOpen(){
    this.modalEl.addClass('tsc-dialog','ts-calendar-plugin');this.setTitle('安排任务');
    this.contentEl.createEl('p',{text:this.task.text,cls:'tsc-task-modal-title'});
    const form=this.contentEl.createEl('form',{cls:'tsc-event-form'});
    const field=(name:string,type:string)=>{const label=form.createEl('label',{cls:'tsc-event-field'});label.createSpan({text:name});return label.createEl('input',{type});};
    const date=field('安排日期','date');date.required=true;date.value=this.task.date||dayKey(this.date);
    const start=field('开始时间（可选）','time'),end=field('结束时间（可选）','time');
    start.step=end.step='60';start.value=this.task.startMinute===undefined?'':clockLabel(this.task.startMinute);end.value=this.task.endMinute===undefined?'':clockLabel(this.task.endMinute);
    this.timeRange=mountTimeRangePicker(form,start,end,timeRangeEscape(this.app,this.scope));
    form.createEl('small',{text:'保存回原笔记，保留截止日期与块引用。',cls:'tsc-muted'});
    const error=form.createDiv({cls:'tsc-error',attr:{role:'alert'}});
    const actions=form.createDiv({cls:'tsc-dialog-actions'});
    const cancel=actions.createEl('button',{text:'取消',attr:{type:'button'}});cancel.onclick=()=>this.close();
    const save=actions.createEl('button',{text:'保存安排',cls:'mod-cta',attr:{type:'submit'}});
    form.onsubmit=async e=>{
      e.preventDefault();if(this.closed||this.pending||!this.host.scheduleTask)return;const focused=this.contentEl.ownerDocument.activeElement as HTMLElement|null;
      try{
        parseDay(date.value);
        if(end.value&&!start.value)throw Error('请先填写开始时间');
        const minute=(v:string)=>{const [h,m]=v.split(':').map(Number);return h*60+m;};
        if(start.value&&end.value&&minute(end.value)<=minute(start.value))throw Error('结束时间须晚于开始时间');
        this.pending=true;[date,start,end,cancel,save].forEach(el=>el.disabled=true);
        this.timeRange?.refresh();
        await this.host.scheduleTask(this.task,date.value,start.value?minute(start.value):undefined,end.value?minute(end.value):undefined,!start.value&&this.task.startMinute!==undefined);
        this.host.changed();this.close();
      }catch(e){if(!this.closed)error.textContent=e instanceof Error?e.message:String(e);}
      finally{this.pending=false;if(!this.closed){[date,start,end,cancel,save].forEach(el=>el.disabled=false);this.timeRange?.refresh();if(focused&&form.contains(focused))focused.focus();}}
    };
    date.focus();
  }
  onClose(){this.closed=true;this.timeRange?.destroy();this.timeRange=undefined;this.contentEl.empty();}
}
