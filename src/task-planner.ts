import {App,Component,TFile} from 'obsidian';
import {localDay} from './filing';
import {isWorkspaceFile} from './workspace';
import {changeTask,planTasks,PlannedTask} from './task-planner-model';
import {replaceTaskSpan,tasksToggleApi,tasksToggleLines,TASKS_REQUIRED} from './tasks-integration';
type QueuedUpdate={task:PlannedTask};
type QueuedFollower={before:PlannedTask;line:number;source:string};
/** Bounded concurrent initial read; thereafter only changed files are read. Store tasks, not note bodies. */
export class TaskPlanner extends Component {
 private entries=new Map<TFile,{root:string;key:string;tasks:PlannedTask[]}>();private listeners=new Set<()=>void>();private pending=new Set<TFile>();private timer?:number;private running?:Promise<void>;private stopped=false;private initialized=false;private scan?:Promise<void>;
 private revisions=new WeakMap<TFile,number>();private reads=new WeakMap<TFile,number>();private dirty=new WeakSet<TFile>();
 private notificationPending=false;private mutationDepth=0;
 private invalidate(file:TFile){this.revisions.set(file,(this.revisions.get(file)||0)+1);this.dirty.add(file);}
 readonly failures=new Set<string>();
 private undo?:{file:TFile;line:number;before:string[];after:string[];occurrences?:{line:number;source:string}[]};
 private writes:Promise<void>=Promise.resolve();
 private queuedUpdates=new Set<QueuedUpdate>();
 private focusIds=new WeakMap<PlannedTask,string>();private focusSequence=0;
 /** UI identity only: it never authorizes a write to an old occurrence. */
 focusKey(task:PlannedTask){let key=this.focusIds.get(task);if(!key){key=String(++this.focusSequence);this.focusIds.set(task,key);}return key;}
 constructor(private app:App,private root:()=>string){super();}
 onload(){this.stopped=false;const changed=(f:unknown)=>{if(f instanceof TFile&&f.extension==='md'){this.invalidate(f);this.pending.add(f);this.schedule();}};this.registerEvent(this.app.vault.on('modify',changed));this.registerEvent(this.app.vault.on('create',changed));this.registerEvent(this.app.vault.on('delete',()=>{this.pruneDeleted();this.emit();}));this.registerEvent(this.app.vault.on('rename',f=>{if(f instanceof TFile)changed(f);else for(const file of this.app.vault.getMarkdownFiles())if(file.path.startsWith(f.path+'/'))changed(file);}));}
 subscribe(fn:()=>void){this.listeners.add(fn);return()=>{this.listeners.delete(fn);};}
 private emit(){if(this.stopped||this.mutationDepth||!this.notificationPending)return;this.notificationPending=false;for(const fn of this.listeners)fn();}
 private removeEntry(file:TFile){const old=this.entries.get(file);if(old?.tasks.length)this.notificationPending=true;this.entries.delete(file);}
 private pruneDeleted(){for(const [file]of this.entries)if(this.app.vault.getAbstractFileByPath(file.path)!==file)this.removeEntry(file);for(const path of this.failures)if(!this.app.vault.getAbstractFileByPath(path)){this.failures.delete(path);this.notificationPending=true;}}
 private schedule(){if(this.stopped||!this.initialized)return;window.clearTimeout(this.timer);this.timer=window.setTimeout(()=>{void this.flush();},180);}
 private async read(file:TFile,force=false){
  if(this.stopped)return;const path=file.path,key=`${path}:${file.stat.mtime}:${file.stat.size}`,root=this.root();
  if(!isWorkspaceFile(file)||this.app.vault.getAbstractFileByPath(path)!==file){this.removeEntry(file);return;}
  const cached=this.entries.get(file);if(!force&&!this.dirty.has(file)&&cached?.key===key&&cached.root===root)return;
  const revision=this.revisions.get(file)||0,read=(this.reads.get(file)||0)+1;this.reads.set(file,read);
  const current=()=>!this.stopped&&this.reads.get(file)===read&&(this.revisions.get(file)||0)===revision&&file.path===path&&root===this.root()&&this.app.vault.getAbstractFileByPath(path)===file;
  try{
   const text=await (force||this.dirty.has(file)?this.app.vault.read(file):this.app.vault.cachedRead(file));
   if(!current())return;
   if(key!==`${file.path}:${file.stat.mtime}:${file.stat.size}`){this.invalidate(file);this.pending.add(file);this.schedule();return;}
   const parsed=planTasks(text,path,root),previous=this.entries.get(file)?.tasks;
   // A new read is not necessarily a new occurrence. Preserve row identity and
   // skip rebuilding every open task view when only unrelated prose changed.
   const same=previous?.length===parsed.length&&parsed.every((task,index)=>{const old=previous[index];return old.source===task.source&&old.line===task.line&&old.path===task.path&&old.day===task.day&&old.text===task.text;});
   const tasks=same?previous!:parsed.map(task=>({...task,indexRevision:read}));
   if(!same&&(parsed.length||previous?.length))this.notificationPending=true;
   this.entries.set(file,{key,root,tasks});this.dirty.delete(file);if(this.failures.delete(path))this.notificationPending=true;return text;
  }catch{if(current()){this.removeEntry(file);if(!this.failures.has(path))this.notificationPending=true;this.failures.add(path);}}
 }

 async ready(){if(!this.initialized){if(!this.scan)this.scan=(async()=>{const files=this.app.vault.getMarkdownFiles().filter(isWorkspaceFile);let cursor=0;await Promise.all(Array.from({length:4},async()=>{while(cursor<files.length&&!this.stopped)await this.read(files[cursor++]);}));this.initialized=true;})();await this.scan;}for(const path of this.failures){const f=this.app.vault.getAbstractFileByPath(path);if(f instanceof TFile)this.pending.add(f);else{this.failures.delete(path);this.notificationPending=true;}}for(const [f,e] of this.entries)if(e.root!==this.root())this.pending.add(f);await this.flush();}
 async flush():Promise<void>{if(this.running){await this.running;if(this.pending.size)return this.flush();return;}this.running=(async()=>{while(this.pending.size&&!this.stopped){const files=[...this.pending];this.pending.clear();for(const file of files)await this.read(file);}this.emit();})();try{await this.running;}finally{this.running=undefined;}}
 all(){return [...this.entries.values()].flatMap(e=>e.tasks);}
 canToggle(task:PlannedTask){return !task.recurring||!!tasksToggleApi(this.app);}
 private mutate(run:()=>Promise<void>):Promise<void>{
  const next=this.writes.then(async()=>{if(this.stopped)throw Error('插件已重载，请重新打开任务面板');this.mutationDepth++;try{await run();}finally{this.mutationDepth--;this.emit();}});
  this.writes=next.catch(()=>{});return next;
 }
 private queuedFollowers(file:TFile,text:string,line:number,removed:number,after:readonly string[],sameOccurrence=false):QueuedFollower[]{
  if(this.dirty.has(file))return [];
  const followers:QueuedFollower[]=[],lines=text.split('\n');
  // Capture all validated indexed rows, so clicks enqueued while process is
  // still completing can use the same mapping after its exact result is read.
  for(const row of this.entries.get(file)?.tasks||[]){
   if(row.path!==file.path)continue;
   const replaced=row.line>=line&&row.line<line+removed;
   if(replaced&&(!sameOccurrence||row.line!==line))continue;
   if(lines[row.line]!==row.source)continue;
   followers.push({before:row,line:row.line+(row.line>=line+removed?after.length-removed:0),source:replaced?after[0]:row.source});
  }
  return followers;
 }
 private rebaseFollowers(file:TFile,followers:QueuedFollower[],expected:string|undefined,indexedText:string|undefined){
  // A concurrent external edit or superseded read invalidates this mapping.
  if(expected===undefined||indexedText!==expected||this.dirty.has(file))return;
  const previousRows=new Map(followers.map(follower=>[follower.before.line,follower])),indexedRows=new Map(this.entries.get(file)?.tasks.map(row=>[row.line,row]));
  // Transfer focus only through the validated transaction's exact follower map.
  // Generated occurrences get fresh identities even when source strings collide.
  for(const follower of followers){const current=indexedRows.get(follower.line),key=this.focusIds.get(follower.before);if(key&&current?.source===follower.source)this.focusIds.set(current,key);}
  for(const intent of this.queuedUpdates){
   const row=intent.task;if(row.path!==file.path)continue;const follower=previousRows.get(row.line);
   if(!follower||row.indexRevision!==follower.before.indexRevision||row.source!==follower.before.source)continue;
   const current=indexedRows.get(follower.line);if(current?.source===follower.source)intent.task=current;
  }
 }
 update(original:PlannedTask,change:Parameters<typeof changeTask>[2]){
  const intent={task:original};this.queuedUpdates.add(intent);
  return this.mutate(async()=>{
  const task=intent.task;
  const file=this.app.vault.getAbstractFileByPath(task.path);if(!(file instanceof TFile))throw Error('任务来源笔记已移动或删除，请刷新');
  const update={...change},repeatingToggle=task.recurring&&update.checked!==undefined&&update.checked!==task.checked;
  const api=repeatingToggle?tasksToggleApi(this.app):undefined;
  if(repeatingToggle&&!api)throw Error(TASKS_REQUIRED);
  if(repeatingToggle&&Object.entries(update).some(([key,value])=>key!=='checked'&&value!==undefined))throw Error('请先保存任务属性，再切换重复任务状态');
  if(!repeatingToggle&&update.completedOn===undefined&&update.checked!==undefined&&update.checked!==task.checked)update.completedOn=update.checked?localDay():'';
  if(task.recurring&&!repeatingToggle)delete update.checked;
  let receipt:typeof this.undo,expected:string|undefined;
  let followers:QueuedFollower[]=[];
  await this.app.vault.process(file,text=>{
   if(this.stopped)throw Error('插件已重载，请重新打开任务面板');
   if(file.path!==task.path||this.app.vault.getAbstractFileByPath(task.path)!==file)throw Error('任务来源笔记已移动或删除，请刷新');
   let next:string,after:string[];
   if(task.recurring){
    // An external Tasks completion may leave an identical undated next row.
    // Until its modify event has been indexed, source/revision checks alone
    // cannot distinguish that new occurrence from the old checkbox.
    if(this.dirty.has(file))throw Error('任务原文正在刷新，请稍后重试');
    // Attribute edits also require occurrence identity: an identical undated
    // next row must never receive an old occurrence's schedule or priority.
    const lines=text.split('\n');if(lines[task.line]!==task.source)throw Error('任务原文已变化，请刷新后再操作');
    // Undated recurrences may generate an identical next row at the same line.
    // Source equality alone cannot distinguish the two occurrences.
    const current=this.entries.get(file)?.tasks.find(row=>row.line===task.line);
    if(current?.indexRevision!==task.indexRevision)throw Error('任务版本已变化，请刷新后再操作');
   }
   if(repeatingToggle){
    const lines=text.split('\n'),currentApi=tasksToggleApi(this.app);if(!currentApi)throw Error(TASKS_REQUIRED);
    after=tasksToggleLines(currentApi,task,text.includes('\r\n')?'\r\n':'\n');
    lines.splice(task.line,1,...after);next=lines.join('\n');
   }else{next=changeTask(text,task,update);after=[next.split('\n')[task.line]];}
   if(next!==text){
    receipt={file,line:task.line,before:[task.source],after};expected=next;
    // Content edits can introduce a recurrence on a formerly ordinary task.
    // Its identical next occurrence needs the same undo guard as an existing rule.
    if(task.recurring||update.content!==undefined){const rows=planTasks(next,file.path,this.root());if(task.recurring||rows.some(row=>row.line===task.line&&row.recurring))receipt.occurrences=rows.map(({line,source})=>({line,source}));}
    // Carry forward already queued rows from this exact index. Attribute edits
    // preserve the same occurrence, but a Tasks toggle replaces it: never
    // rebase that occurrence onto an identical undated next occurrence.
    followers=this.queuedFollowers(file,text,task.line,1,after,!repeatingToggle);
   }return next;
  });
  if(this.stopped)return;
  if(receipt){this.undo=receipt;this.notificationPending=true;}this.invalidate(file);
  const indexedText=await this.read(file,true);
  this.rebaseFollowers(file,followers,expected,indexedText);
  await this.flush();
 }).finally(()=>this.queuedUpdates.delete(intent));}

 canUndo(){return !!this.undo;}
 undoLast(){return this.mutate(async()=>{
  const record=this.undo;if(!record)return;if(this.app.vault.getAbstractFileByPath(record.file.path)!==record.file)throw Error('任务来源文件已删除');
  let expected:string|undefined,followers:QueuedFollower[]=[];
  await this.app.vault.process(record.file,text=>{
   if(this.stopped)throw Error('插件已重载，请重新打开任务面板');if(this.app.vault.getAbstractFileByPath(record.file.path)!==record.file)throw Error('任务来源文件已删除');
   // An undated Tasks occurrence can recreate exactly the same two-line span.
   // Compare the task index of the actual transaction body, while permitting
   // independent prose edits that leave task rows and their positions intact.
   if(record.occurrences){const rows=planTasks(text,record.file.path,this.root());if(rows.length!==record.occurrences.length||rows.some((row,index)=>row.line!==record.occurrences![index].line||row.source!==record.occurrences![index].source))throw Error('任务原文已变化，无法安全撤销，请打开原文检查');}
   const next=replaceTaskSpan(text,record.line,record.after,record.before);if(next!==text){expected=next;followers=this.queuedFollowers(record.file,text,record.line,record.after.length,record.before);}return next;
  });
  if(this.undo===record){this.undo=undefined;this.notificationPending=true;}this.invalidate(record.file);const indexedText=await this.read(record.file,true);this.rebaseFollowers(record.file,followers,expected,indexedText);await this.flush();
 });}
 async rescan(){await this.ready();this.pruneDeleted();const files=this.app.vault.getMarkdownFiles().filter(isWorkspaceFile);let cursor=0;await Promise.all(Array.from({length:4},async()=>{while(cursor<files.length&&!this.stopped)await this.read(files[cursor++],true);}));await this.flush();}

 onunload(){this.stopped=true;window.clearTimeout(this.timer);this.entries.clear();this.pending.clear();this.listeners.clear();this.undo=undefined;this.notificationPending=false;this.queuedUpdates.clear();}
}
