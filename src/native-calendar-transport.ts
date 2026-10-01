import { execFile, type ChildProcess } from 'node:child_process';
import { CalendarBridgeError, type CalendarBridgeTransport, type BridgeRequest } from './apple-calendar';
export class NativeCalendarTransport implements CalendarBridgeTransport {
  private children = new Set<ChildProcess>();
  private disposed=false;
  constructor(private executable:string) {}
  call<T>(request:BridgeRequest):Promise<T> {
    if(this.disposed) return Promise.reject(new CalendarBridgeError('closed','日历联动已关闭'));
    if(process.platform!=='darwin') return Promise.reject(new CalendarBridgeError('unsupported','苹果日历联动目前支持 macOS'));
    return new Promise((resolve,reject)=> {
      const child=execFile(this.executable,[],{
        timeout:request.action==='request'?170000:20000,
        maxBuffer:8*1024*1024, windowsHide:true
      },(error,stdout)=> {
        this.children.delete(child);
        let response:{ok:boolean;data:T;error?:{code:string;message:string}};
        try { response=JSON.parse(stdout); }
        catch { reject(new CalendarBridgeError('bridge_unavailable',
          request.action==='save'?'未能确认保存结果，请刷新苹果日历后再操作，避免重复创建。':
          '苹果日历接口未响应。请检查插件内的原生接口文件和系统日历授权。')); return; }
        if(this.disposed) { reject(new CalendarBridgeError('closed','日历联动已关闭')); return; }
        if(!response.ok||error) { reject(new CalendarBridgeError(response.error?.code??'native_error',response.error?.message??'苹果日历操作失败')); return; }
        resolve(response.data);
      });
      this.children.add(child);
      child.stdin?.on('error',()=>{});
      child.stdin?.end(JSON.stringify(request));
    });
  }
  dispose():void { this.disposed=true; for(const child of this.children) child.kill(); this.children.clear(); }
}

