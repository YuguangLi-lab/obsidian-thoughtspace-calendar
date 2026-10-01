import type { AppleCalendar, AppleCalendarSettings, CalendarEvent, EventDraft } from './calendar-model';

export type Authorization = 'authorized' | 'not_determined' | 'denied' | 'restricted' | 'write_only';
export interface BridgeRequest { action:string; start?:string; end?:string; calendarIds?:string[]; draft?:EventDraft; eventId?:string; originalStart?:string }
export interface CalendarBridgeTransport { call<T>(request:BridgeRequest):Promise<T>; dispose():void }
export class CalendarBridgeError extends Error {
  constructor(public code:string,message:string) { super(message); this.name='CalendarBridgeError'; }
}

export class AppleCalendarClient {
  private cache=new Map<string,{time:number;value:{events:CalendarEvent[];truncated:boolean}}>();
  private pending=new Map<string,Promise<{events:CalendarEvent[];truncated:boolean}>>();
  private generation=0;
  private writes:Promise<unknown>=Promise.resolve();
  private closed=false;
  constructor(private transport:CalendarBridgeTransport, private settings:()=>AppleCalendarSettings) {}
  status():Promise<{authorization:Authorization}> { return this.transport.call({action:'status'}); }
  authorize():Promise<{authorization:Authorization}> { return this.transport.call({action:'request'}); }
  calendars():Promise<{calendars:AppleCalendar[];defaultCalendarId:string}> { return this.transport.call({action:'calendars'}); }
  async detail(event:CalendarEvent):Promise<CalendarEvent> {
    if(this.closed||!this.settings().enabled) throw new CalendarBridgeError('disabled','请先连接苹果日历');
    const result=await this.transport.call<{event:CalendarEvent}>({action:'event',eventId:event.id,originalStart:event.start});
    return result.event;
  }
  async events(start:Date,end:Date,force=false):Promise<{events:CalendarEvent[];truncated:boolean}> {
    const settings=this.settings();
    if(this.closed||!settings.enabled||!settings.selectedCalendarIds.length) return {events:[],truncated:false};
    if(!(end>start)||end.getTime()-start.getTime()>62*86400000) throw new CalendarBridgeError('invalid_range','只加载可见日期，最多 62 天');
    const ids=[...new Set(settings.selectedCalendarIds)].sort();
    const key=JSON.stringify([start.toISOString(),end.toISOString(),ids]);
    const cached=this.cache.get(key);
    if(!force&&cached&&Date.now()-cached.time<45000) return cached.value;
    const pending=this.pending.get(key); if(pending) return pending;
    const generation=this.generation;
    const promise=this.transport.call<{events:CalendarEvent[];truncated:boolean}>({
      action:'events',start:start.toISOString(),end:end.toISOString(),calendarIds:ids
    }).then(value=> {
      if(generation===this.generation&&!this.closed&&this.settings().enabled) {
        this.cache.set(key,{time:Date.now(),value});
        while(this.cache.size>12) this.cache.delete(this.cache.keys().next().value!);
      }
      return generation===this.generation?value:{events:[],truncated:false};
    }).finally(()=> { if(this.pending.get(key)===promise) this.pending.delete(key); });
    this.pending.set(key,promise); return promise;
  }
  save(draft:EventDraft):Promise<CalendarEvent> {
    const run=async()=> {
      if(this.closed||!this.settings().enabled) throw new CalendarBridgeError('disabled','请先连接苹果日历');
      const result=await this.transport.call<{event:CalendarEvent}>({action:'save',draft});
      this.invalidate(); return result.event;
    };
    const result=this.writes.then(run,run);
    this.writes=result.catch(()=>{}); return result;
  }
  invalidate():void { this.generation++; this.cache.clear(); this.pending.clear(); }
  dispose():void { this.closed=true; this.invalidate(); this.transport.dispose(); }
}
