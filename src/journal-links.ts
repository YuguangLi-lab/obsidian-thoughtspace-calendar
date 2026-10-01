import {App,Component,Notice,TFile} from 'obsidian';
import {journalPaths} from './calendar-tools';
import {localDay} from './filing';
import {createdNoteDay,syncCreatedNotes} from './journal-links-model';
interface Host {settings:{journalFolder:string};ensureJournalFile(day:string):Promise<TFile>}
/** Metadata-only day index. Creating/renaming notes never reads their bodies. */
export class JournalLinks extends Component {
  private byDay=new Map<string,Set<TFile>>();private days=new Map<TFile,string>();private root='';private stopped=false;
  private pending=new Map<string,boolean>();private timer?:number;private queue:Promise<unknown>=Promise.resolve();
  constructor(private app:App,private host:Host){super();}
  onload(){this.stopped=false;this.rebuild();
    this.registerEvent(this.app.vault.on('create',file=>{if(!(file instanceof TFile))return;this.ensureIndex();const day=this.add(file);if(day)this.schedule(day,day===localDay());}));
    this.registerEvent(this.app.vault.on('delete',file=>{this.ensureIndex();const affected=[...this.days].filter(([f])=>f===file||f.path.startsWith(file.path+'/'));for(const [f,day] of affected){this.remove(f);this.schedule(day,false);}}));
    this.registerEvent(this.app.vault.on('rename',(file,old)=>{this.ensureIndex();const affected=[...this.days].filter(([f])=>f===file||f.path.startsWith(file.path+'/'));for(const [f,day] of affected){this.remove(f);this.schedule(day,false);}const added=file instanceof TFile?[file]:this.app.vault.getMarkdownFiles().filter(f=>f.path.startsWith(file.path+'/'));for(const f of added){const day=this.add(f);if(day)this.schedule(day,false);}}));
  }
  private remove(file:TFile){const day=this.days.get(file);if(day){this.byDay.get(day)?.delete(file);if(!this.byDay.get(day)?.size)this.byDay.delete(day);}this.days.delete(file);}
  private add(file:TFile){this.remove(file);const day=createdNoteDay(file,this.root);if(day){this.days.set(file,day);if(!this.byDay.has(day))this.byDay.set(day,new Set());this.byDay.get(day)!.add(file);}return day;}
  private rebuild(){this.root=this.host.settings.journalFolder;this.days.clear();this.byDay.clear();this.pending.clear();for(const f of this.app.vault.getMarkdownFiles())this.add(f);}
  private ensureIndex(){if(this.root!==this.host.settings.journalFolder)this.rebuild();}
  private schedule(day:string,create:boolean){if(this.stopped)return;this.pending.set(day,create||this.pending.get(day)||false);window.clearTimeout(this.timer);this.timer=window.setTimeout(()=>{void this.flush().catch(e=>new Notice(String(e)));},250);}
  async flush(){window.clearTimeout(this.timer);this.ensureIndex();const root=this.root,tasks=[...this.pending];this.pending.clear();for(const [day,create] of tasks){if(this.stopped||root!==this.host.settings.journalFolder)return;let file=journalPaths(day,root).map(path=>this.app.vault.getAbstractFileByPath(path)).find((f):f is TFile=>f instanceof TFile);if(!file&&create&&this.byDay.get(day)?.size)file=await this.host.ensureJournalFile(day);if(file)await this.sync(day,file);}await this.queue;}
  sync(day:string,file:TFile):Promise<void>{this.ensureIndex();const root=this.root;const work=this.queue.catch(()=>{}).then(async()=>{if(this.stopped||root!==this.host.settings.journalFolder||this.app.vault.getAbstractFileByPath(file.path)!==file)return;const paths=[...(this.byDay.get(day)||[])].filter(f=>f!==file&&this.app.vault.getAbstractFileByPath(f.path)===f&&createdNoteDay(f,root)===day).map(f=>f.path);const current=await this.app.vault.cachedRead(file);if(syncCreatedNotes(current,paths)===current)return;await this.app.vault.process(file,text=>syncCreatedNotes(text,paths));});this.queue=work;return work;}
  onunload(){this.stopped=true;window.clearTimeout(this.timer);this.pending.clear();this.days.clear();this.byDay.clear();}
}
