import type {PomodoroStore} from './pomodoro';
import type {PomodoroState} from './pomodoro-model';

export interface PomodoroStorageAdapter {
 exists(path:string):Promise<boolean>;
 read(path:string):Promise<string>;
 write(path:string,text:string):Promise<void>;
 rename(path:string,nextPath:string):Promise<void>;
 remove(path:string):Promise<void>;
}

type Lease={active:boolean};
type Queue={tail:Promise<void>;owner?:Lease;sequence:number};
export type DisposablePomodoroStore=PomodoroStore&{dispose():void};
const registryKey=Symbol.for('thoughtspace-calendar.pomodoro-store-queues');

/** Share pending I/O across reloads; desktop callers supply an atomic overwrite. */
export function createPomodoroStore(adapter:PomodoroStorageAdapter,path:string,replace?:(from:string,to:string)=>Promise<void>):DisposablePomodoroStore {
 const carrier=adapter as PomodoroStorageAdapter&Record<symbol,unknown>;
 let registry=carrier[registryKey] as Map<string,Queue>|undefined;
 if(!registry){registry=new Map();carrier[registryKey]=registry;}
 let queue=registry.get(path);
 if(!queue){queue={tail:Promise.resolve(),sequence:0};registry.set(path,queue);}
 const shared=queue,lease:Lease={active:true};
 if(shared.owner)shared.owner.active=false;
 shared.owner=lease;
 const assertActive=()=>{if(!lease.active||shared.owner!==lease)throw Error('番茄钟存储已关闭，请重新加载插件');};
 const enqueue=<T>(work:()=>Promise<T>):Promise<T>=>{
  const result=shared.tail.then(work);
  // A failed operation must not poison later reads, retries or replacement owners.
  shared.tail=result.then(()=>{},()=>{});
  return result;
 };
 return {
  load:async()=>{assertActive();return enqueue(async()=>{
   assertActive();const exists=await adapter.exists(path);assertActive();
   if(!exists)return null;
   const text=await adapter.read(path);assertActive();
   return JSON.parse(text) as unknown;
  });},
  save:async(state:PomodoroState)=>{assertActive();return enqueue(async()=>{
   assertActive();
   const temp=`${path}.tmp-${Date.now().toString(36)}-${(++shared.sequence).toString(36)}-${Math.random().toString(36).slice(2)}`;
   try{
    await adapter.write(temp,JSON.stringify(state,null,2));
    assertActive();
    if(replace)await replace(temp,path);else await adapter.rename(temp,path);
    assertActive();
   }catch(error){await adapter.remove(temp).catch(()=>{});throw error;}
  });},
  dispose:()=>{lease.active=false;if(shared.owner===lease)shared.owner=undefined;},
 };
}
