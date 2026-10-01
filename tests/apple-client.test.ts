import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AppleCalendarClient,type CalendarBridgeTransport,type BridgeRequest} from '../src/apple-calendar';
import {defaultAppleSettings,type AppleCalendarSettings,type CalendarEvent,type EventDraft} from '../src/calendar-model';
const event:CalendarEvent={id:'e',calendarId:'c',title:'会议',start:'2026-10-01T01:00:00.000Z',end:'2026-10-01T02:00:00.000Z',allDay:false,location:'',notes:'',revision:'a'.repeat(64),recurring:false,editable:true,color:'#447c83'};
const draft:EventDraft={title:event.title,start:event.start,end:event.end,allDay:false,calendarId:'c',location:'',notes:''};
const range=[new Date('2026-10-01T00:00:00Z'),new Date('2026-11-01T00:00:00Z')] as const;
function fixture(handler:(r:BridgeRequest)=>Promise<unknown>=async()=>({events:[event],truncated:false})) {
  let settings:AppleCalendarSettings={...defaultAppleSettings,enabled:true,selectedCalendarIds:['c']};
  const calls:BridgeRequest[]=[]; let disposed=false;
  const transport:CalendarBridgeTransport={call:async<T>(r:BridgeRequest)=>{calls.push(r); return await handler(r) as T;},dispose:()=>{disposed=true;}};
  const client=new AppleCalendarClient(transport,()=>settings);
  return {client,calls,settings,setSettings:(s:AppleCalendarSettings)=>{settings=s;},disposed:()=>disposed};
}
test('未连接时不读取任何日程',async()=> { const f=fixture();f.setSettings({...f.settings,enabled:false});assert.equal((await f.client.events(...range)).events.length,0);assert.equal(f.calls.length,0); });
test('空日历选择不变成全选',async()=> { const f=fixture();f.setSettings({...f.settings,selectedCalendarIds:[]});await f.client.events(...range);assert.equal(f.calls.length,0); });
test('相同可见范围共用缓存',async()=> { const f=fixture();await f.client.events(...range);await f.client.events(...range);assert.equal(f.calls.length,1); });
test('并行刷新只发出一次请求',async()=> { let release!:(x:unknown)=>void; const f=fixture(()=>new Promise(resolve=>release=resolve));const a=f.client.events(...range);const b=f.client.events(...range);release({events:[event],truncated:false});await Promise.all([a,b]);assert.equal(f.calls.length,1); });
test('强制刷新绕过已完成缓存',async()=> {const f=fixture();await f.client.events(...range);await f.client.events(...range,true);assert.equal(f.calls.length,2);});
test('选择改变后的范围不读旧缓存',async()=> {const f=fixture();await f.client.events(...range);f.setSettings({...f.settings,selectedCalendarIds:['d']});await f.client.events(...range);assert.deepEqual(f.calls[1].calendarIds,['d']);});
test('断开连接后丢弃尚在进行的读取结果',async()=> {let release!:(x:unknown)=>void;const f=fixture(()=>new Promise(resolve=>release=resolve));const reading=f.client.events(...range);f.setSettings({...f.settings,enabled:false});f.client.invalidate();release({events:[event],truncated:false});assert.equal((await reading).events.length,0);});
test('读取失败不污染缓存，可重试',async()=> {let count=0;const f=fixture(async()=>{if(!count++)throw Error('失败');return {events:[event],truncated:false};});await assert.rejects(f.client.events(...range));await f.client.events(...range);assert.equal(f.calls.length,2);});
test('超过可见范围拒绝加载',async()=> {const f=fixture();await assert.rejects(f.client.events(range[0],new Date('2027-01-01')));assert.equal(f.calls.length,0);});
test('断开连接禁止写入',async()=> {const f=fixture();f.setSettings({...f.settings,enabled:false});await assert.rejects(f.client.save(draft));assert.equal(f.calls.length,0);});
test('保存后失效读取缓存',async()=> {const f=fixture(async r=>r.action==='save'?{event}:{events:[event],truncated:false});await f.client.events(...range);await f.client.save(draft);await f.client.events(...range);assert.equal(f.calls.length,3);});
test('保存失败不会自动重试或重复创建',async()=> {const f=fixture(async()=>{throw Error('未知保存结果');});await assert.rejects(f.client.save(draft));assert.equal(f.calls.length,1);});
test('写入队列按顺序执行，失败不阻塞后续编辑',async()=> {let count=0;const f=fixture(async()=>{if(!count++)throw Error('第一次失败');return {event};});const a=f.client.save(draft);const b=f.client.save(draft);await assert.rejects(a);assert.equal((await b).id,'e');assert.equal(f.calls.length,2);});
test('清理组件后阻止排队保存和释放原生进程',async()=> {const f=fixture();f.client.dispose();await assert.rejects(f.client.save(draft));assert.equal(f.calls.length,0);assert.equal(f.disposed(),true);});
test('打开编辑器按原场次单独加载完整备注',async()=> {const f=fixture(async()=>({event:{...event,notes:'完整的原备注'}}));const detail=await f.client.detail(event);assert.equal(detail.notes,'完整的原备注');assert.equal(f.calls[0].action,'event');assert.equal(f.calls[0].originalStart,event.start);});
