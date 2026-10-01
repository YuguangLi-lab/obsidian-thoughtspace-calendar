import { App, Modal, Notice, setIcon } from 'obsidian';
import type { AppleCalendarClient } from './apple-calendar';
import { addDays, dayKey, draftFromInputs, parseDateInput, toDateInput, type AppleCalendar, type AppleCalendarSettings, type CalendarEvent } from './calendar-model';

export interface CalendarHost {
  app:App;
  apple:AppleCalendarClient;
  appleSettings():AppleCalendarSettings;
  saveAppleSettings(settings:AppleCalendarSettings):Promise<void>;
  changed():void;
}
function label(parent:HTMLElement,title:string):HTMLLabelElement {
  const el=parent.createEl('label',{cls:'tsc-event-field'}); el.createSpan({text:title}); return el;
}
function iconButton(parent:HTMLElement,icon:string,title:string,callback:()=>void):HTMLButtonElement {
  const button=parent.createEl('button',{cls:'tsc-icon-button',attr:{'aria-label':title,'title':title,'type':'button'}});
  setIcon(button,icon); button.onclick=callback; return button;
}
export class AppleCalendarConnectionModal extends Modal {
  private closed=false;
  private busy=false;
  private calendars:AppleCalendar[]=[];
  constructor(private host:CalendarHost) { super(host.app); }
  onOpen():void { this.modalEl.addClass('tsc-dialog','ts-calendar-plugin'); this.setTitle('苹果日历'); void this.load(); }
  onClose():void { this.closed=true; this.contentEl.empty(); }
  private async load():Promise<void> {
    this.contentEl.empty(); this.contentEl.createEl('p',{text:'正在检查连接…',cls:'tsc-muted'});
    try {
      const status=await this.host.apple.status();
      if(this.closed) return;
      if(status.authorization==='authorized') {
        const result=await this.host.apple.calendars();
        this.calendars=result.calendars; if(this.closed) return;
        this.renderReady(result.defaultCalendarId); return;
      }
      this.contentEl.empty();
      this.contentEl.createEl('p',{text:status.authorization==='denied'?
        '日历权限已关闭。在系统设置 → 隐私与安全性 → 日历中允许访问，然后重新连接。':
        '连接后，可在大日历里查看、新建和修改日程。先授权，再选择显示的日历。',cls:'tsc-connection-copy'});
      const button=this.contentEl.createEl('button',{text:'连接苹果日历',cls:'mod-cta'});
      button.onclick=()=>void this.connect(button);
    } catch(error) { this.showError(error); }
  }
  private async connect(button:HTMLButtonElement):Promise<void> {
    if(this.busy) return; this.busy=true; button.disabled=true; button.textContent='等待 macOS 授权…';
    try {
      const result=await this.host.apple.authorize();
      if(result.authorization!=='authorized') throw new Error('没有获得完整日历权限，请在系统设置中允许访问');
      const data=await this.host.apple.calendars();
      const old=this.host.appleSettings();
      const selected=old.selectedCalendarIds.filter(id=>data.calendars.some(c=>c.id===id));
      if(!selected.length&&data.defaultCalendarId) selected.push(data.defaultCalendarId);
      await this.host.saveAppleSettings({...old,enabled:true,selectedCalendarIds:selected,
        defaultCalendarId:old.defaultCalendarId||data.defaultCalendarId});
      this.host.apple.invalidate(); this.host.changed();
      if(!this.closed) await this.load();
    } catch(error) { if(!this.closed) this.showError(error); }
    finally { this.busy=false; if(!this.closed) button.disabled=false; }
  }
  private renderReady(defaultId:string):void {
    this.contentEl.empty();
    const settings={...this.host.appleSettings(),selectedCalendarIds:[...this.host.appleSettings().selectedCalendarIds]};
    this.contentEl.createEl('p',{text:'选择要显示的日历。订阅日历可查看，可写日历支持创建和修改。',cls:'tsc-connection-copy'});
    const list=this.contentEl.createDiv({cls:'tsc-calendar-picks'});
    for(const calendar of this.calendars) {
      const row=list.createEl('label',{cls:'tsc-calendar-pick'});
      const check=row.createEl('input',{type:'checkbox'}); check.checked=settings.selectedCalendarIds.includes(calendar.id);
      row.createSpan({cls:'tsc-calendar-dot'}).style.backgroundColor=calendar.color;
      const text=row.createDiv(); text.createSpan({text:calendar.title}); text.createEl('small',{text:`${calendar.source}${calendar.editable?'':' · 只读'}`});
      check.onchange=()=> {
        settings.selectedCalendarIds=settings.selectedCalendarIds.filter(id=>id!==calendar.id);
        if(check.checked) settings.selectedCalendarIds.push(calendar.id);
      };
    }
    const select=label(this.contentEl,'新日程的默认日历').createEl('select');
    select.createEl('option',{text:'请选择…',value:''});
    for(const c of this.calendars.filter(c=>c.editable)) select.createEl('option',{text:`${c.title} · ${c.source}`,value:c.id});
    select.value=settings.defaultCalendarId||defaultId; select.onchange=()=>settings.defaultCalendarId=select.value;
    const actions=this.contentEl.createDiv({cls:'tsc-dialog-actions'});
    const disconnect=actions.createEl('button',{text:settings.enabled?'断开连接':'取消'});
    disconnect.onclick=()=>void this.persist({...settings,enabled:false});
    const save=actions.createEl('button',{text:'保存选择',cls:'mod-cta'});
    save.onclick=()=>void this.persist({...settings,enabled:true,defaultCalendarId:select.value});
  }
  private async persist(settings:AppleCalendarSettings):Promise<void> {
    if(this.busy) return; this.busy=true;
    try { await this.host.saveAppleSettings(settings); this.host.apple.invalidate(); this.host.changed(); this.close(); }
    catch(error) { this.showError(error); } finally { this.busy=false; }
  }
  private showError(error:unknown):void {
    const message=error instanceof Error?error.message:'连接失败，请重试';
    this.contentEl.empty(); this.contentEl.createEl('p',{text:message,cls:'tsc-error',attr:{role:'alert'}});
    this.contentEl.createEl('button',{text:'重试'}).onclick=()=>void this.load();
  }
}

export class CalendarEventModal extends Modal {
  private closed=false;
  private pending=false;
  constructor(private host:CalendarHost,private date:Date,private event?:CalendarEvent) { super(host.app); }
  onOpen():void { this.modalEl.addClass('tsc-dialog','tsc-event-dialog','ts-calendar-plugin'); this.setTitle(this.event?(this.event.editable?'编辑日程':'日程详情'):'新建日程'); void this.render(); }
  onClose():void { this.closed=true; this.contentEl.empty(); }
  private async render():Promise<void> {
    this.contentEl.createEl('p',{text:'正在加载日历…',cls:'tsc-muted'});
    try {
      const [data,detail]=await Promise.all([this.host.apple.calendars(),this.event?this.host.apple.detail(this.event):Promise.resolve(undefined)]);
      const {calendars}=data; if(this.closed) return;
      if(detail) this.event=detail;
      this.contentEl.empty(); const original=this.event;
      const readOnly=original&&!original.editable;
      if(original?.recurring) this.contentEl.createDiv({text:'重复日程 · 本次修改仅影响此场次',cls:'tsc-event-notice'});
      const form=this.contentEl.createEl('form',{cls:'tsc-event-form'});
      const title=label(form,'标题').createEl('input',{type:'text',placeholder:'日程名称'}); title.value=original?.title??''; title.maxLength=500; title.required=true;
      const calendar=label(form,'日历').createEl('select');
      for(const c of calendars.filter(c=>c.editable||c.id===original?.calendarId)) calendar.createEl('option',{value:c.id,text:`${c.title} · ${c.source}`});
      const defaultId=this.host.appleSettings().defaultCalendarId;
      calendar.value=original?.calendarId??(calendars.some(c=>c.id===defaultId&&c.editable)?defaultId:calendars.find(c=>c.editable)?.id??'');
      const toggle=form.createEl('label',{cls:'tsc-event-toggle'}); const allDay=toggle.createEl('input',{type:'checkbox'}); toggle.createSpan({text:'全天'}); allDay.checked=original?.allDay??false;
      const dates=form.createDiv({cls:'tsc-event-dates'});
      const start=label(dates,'开始').createEl('input'); const end=label(dates,'结束').createEl('input');
      let initialStart=original?new Date(original.start):new Date(this.date);
      let initialEnd=original?new Date(original.end):new Date(initialStart.getTime()+3600000);
      const fillDates=()=> {
        start.type=end.type=allDay.checked?'date':'datetime-local';
        start.value=allDay.checked?dayKey(initialStart):toDateInput(initialStart);
        end.value=allDay.checked?dayKey(addDays(initialEnd,-1)):toDateInput(initialEnd);
      };
      fillDates();
      allDay.onchange=()=> {
        const priorAllDay=!allDay.checked;
        const previousStart=start.value, previousEnd=end.value;
        try {
          if(allDay.checked) {
            initialStart=parseDateInput(previousStart,false); initialEnd=addDays(parseDateInput(previousEnd,false),1);
          } else if(priorAllDay) {
            initialStart=parseDateInput(previousStart,true); initialStart.setHours(9);
            initialEnd=parseDateInput(previousEnd,true); initialEnd.setHours(10);
          }
          fillDates(); error.textContent='';
        } catch(err) { allDay.checked=priorAllDay; error.textContent=err instanceof Error?err.message:'请先填写日期'; }
      };
      const location=label(form,'地点').createEl('input',{type:'text',placeholder:'可选'}); location.value=original?.location??''; location.maxLength=2000;
      const notes=label(form,'备注').createEl('textarea',{placeholder:'日程说明、会议链接…'}); notes.value=original?.notes??''; notes.rows=4;
      const error=form.createDiv({cls:'tsc-error',attr:{role:'alert','aria-live':'polite'}});
      const actions=form.createDiv({cls:'tsc-dialog-actions'});
      const cancel=actions.createEl('button',{text:readOnly?'关闭':'取消',attr:{type:'button'}}); cancel.onclick=()=>this.close();
      const submit=readOnly?undefined:actions.createEl('button',{text:original?'保存修改':'创建日程',cls:'mod-cta',attr:{type:'submit'}});
      const fields=[title,calendar,allDay,start,end,location,notes]; for(const field of fields) field.disabled=Boolean(readOnly);
      if(readOnly) error.textContent='此日历为只读，无法修改。';
      form.onsubmit=async(e)=> {
        e.preventDefault(); if(this.pending||readOnly) return;
        error.textContent=''; let draft;
        try { draft=draftFromInputs({title:title.value,calendarId:calendar.value,allDay:allDay.checked,start:start.value,end:end.value,location:location.value,notes:notes.value},original); }
        catch(err) { error.textContent=err instanceof Error?err.message:'请检查日程'; return; }
        this.pending=true; cancel.disabled=true; fields.forEach(f=>f.disabled=true); if(submit) { submit.disabled=true; submit.textContent='正在保存…'; }
        try {
          await this.host.apple.save(draft); this.host.changed(); new Notice(original?'苹果日程已更新':'已创建苹果日程'); this.close();
        } catch(err) {
          if(!this.closed) error.textContent=err instanceof Error?err.message:'保存失败';
        } finally {
          this.pending=false; if(!this.closed) { cancel.disabled=false; fields.forEach(f=>f.disabled=false); if(submit) { submit.disabled=false; submit.textContent=original?'保存修改':'创建日程'; } }
        }
      };
      if(!readOnly) title.focus();
    } catch(error) {
      if(this.closed) return;
      this.contentEl.empty(); this.contentEl.createEl('p',{text:error instanceof Error?error.message:'加载失败',cls:'tsc-error'});
      iconButton(this.contentEl,'settings','连接设置',()=>new AppleCalendarConnectionModal(this.host).open());
    }
  }
}
