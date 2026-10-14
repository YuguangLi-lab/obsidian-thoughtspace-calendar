import {advancePomodoro,createPomodoroState,normalizePomodoroConfig,normalizePomodoroState,pomodoroElapsed,pomodoroRemaining,transitionPomodoro, type PomodoroAction,type PomodoroConfig,type PomodoroState,type PomodoroTarget,type TimerMode} from './pomodoro-model';

export interface PomodoroActions {
 startTask(task:{title:string;path:string;line:number;source:string}):Promise<void>;
 open():Promise<void>;
}
export interface PomodoroStore {load():Promise<unknown>;save(state:PomodoroState):Promise<void>;}
export interface PomodoroSnapshot {state:PomodoroState;remainingMs:number;elapsedMs:number;error?:string;busy:boolean;}
type Options={now?:()=>number;onFinished?:(state:PomodoroState)=>void;interval?:boolean};

/** One clock per plugin, persisted at transitions rather than on each display tick. */
export class PomodoroController {
 private state:PomodoroState;
 private listeners=new Set<(snapshot:PomodoroSnapshot)=>void>();
 private clock?:ReturnType<typeof setInterval>;
 private now:()=>number;
 private active=true;
 private loaded=false;
 private pending?:Promise<void>;
 private error?:string;
 private retryAfter=0;
 constructor(private store:PomodoroStore,private getConfig:()=>PomodoroConfig,private options:Options={}){
  this.now=options.now||Date.now;this.state=createPomodoroState(this.config,this.now());
 }
 get config(){return normalizePomodoroConfig(this.getConfig());}
 snapshot():PomodoroSnapshot{const now=this.now();return {state:this.state,remainingMs:pomodoroRemaining(this.state,now),elapsedMs:pomodoroElapsed(this.state,now),error:this.error,busy:!!this.pending||!this.loaded};}
 subscribe(listener:(snapshot:PomodoroSnapshot)=>void){this.listeners.add(listener);listener(this.snapshot());return ()=>this.listeners.delete(listener);}
 private emit(){if(this.active){const snapshot=this.snapshot();for(const listener of [...this.listeners]){try{listener(snapshot);}catch(error){console.error('ThoughtSpace Pomodoro UI:',error);}}}}
 async initialize(){
  if(this.loaded||!this.active)return;
  try{
   const raw=await this.store.load();if(!this.active)return;
   const normalized=normalizePomodoroState(raw,this.config,this.now());
   if(raw!=null&&JSON.stringify(raw)!==JSON.stringify(normalized))await this.store.save(normalized);
   if(!this.active)return;this.state=normalized;this.loaded=true;this.error=undefined;
   if(this.options.interval!==false)this.clock=setInterval(()=>this.tick(),1000);
  }catch(error){this.error='番茄钟记录暂时无法读取：'+String(error);throw error;}finally{this.emit();}
 }
 private perform(action?:PomodoroAction):Promise<void>{
  if(!this.active)return Promise.reject(Error('番茄钟已关闭'));
  if(!this.loaded)return Promise.reject(Error(this.error||'番茄钟正在加载'));
  // Ignore overlapping display clicks and reject conflicting API operations explicitly.
  if(this.pending)return Promise.reject(Error('番茄钟正在保存，请稍后再试'));
  const work=Promise.resolve().then(async()=>{
   if(!this.active)throw Error('番茄钟已关闭');
   const now=this.now(),advanced=advancePomodoro(this.state,now);
   const next=action?transitionPomodoro(advanced,action,this.config,now):advanced;
   const completion=advanced.session.status==='finished'&&this.state.session.status==='running'?advanced:
    next.session.status==='finished'&&this.state.session.status!=='finished'&&next.records.some(record=>record.id===this.state.session.id&&record.outcome==='completed')?next:undefined;
   if(next!==this.state){await this.store.save(next);this.state=next;}
   this.error=undefined;this.retryAfter=0;
   if(completion&&this.active)this.options.onFinished?.(completion);
  }).catch(error=>{this.error=String(error);throw error;}).finally(()=>{this.pending=undefined;this.emit();});
  this.pending=work;this.emit();return work;
 }
 tick(){
  if(!this.active||!this.loaded)return;
  if(this.state.session.status==='running'&&this.state.session.mode!=='stopwatch'&&pomodoroRemaining(this.state,this.now())===0&&!this.pending&&this.now()>=this.retryAfter){
   void this.perform().catch(()=>{this.retryAfter=this.now()+30_000;});
  }else this.emit();
 }
 start(target?:PomodoroTarget){return this.perform({type:'start',...(target?{target}:{})});}
 startFocus(target?:PomodoroTarget){return this.perform({type:'focus',...(target?{target}:{})});}
 startTimer(target?:PomodoroTarget,mode?:TimerMode,durationMinutes?:number){return this.perform({type:'timer',...(target?{target}:{}),...(mode?{mode}:{}),...(durationMinutes!==undefined?{durationMinutes}:{})});}
 selectMode(mode:TimerMode,durationMinutes?:number){return this.perform({type:'select-mode',mode,...(durationMinutes!==undefined?{durationMinutes}:{})});}
 setDuration(minutes:number){return this.perform({type:'duration',minutes});}
 stop(){return this.perform({type:'stop'});}
 adjust(minutes:number){return this.perform({type:'adjust',minutes});}
 pause(){return this.perform({type:'pause'});}
 resume(){return this.perform({type:'resume'});}
 reset(){return this.perform({type:'reset'});}
 next(){return this.perform({type:'next'});}
 async configure(){await this.settled();if(this.active&&this.loaded&&this.state.session.status==='idle'&&this.state.session.mode==='pomodoro')await this.reset();else this.emit();}
 async settled(){await this.pending?.catch(()=>{});}
 dispose(){this.active=false;if(this.clock)clearInterval(this.clock);this.clock=undefined;this.listeners.clear();}
}
