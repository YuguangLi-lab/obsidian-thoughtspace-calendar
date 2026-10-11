import {Plugin,PluginSettingTab,Setting,Notice,TFile,TFolder,WorkspaceLeaf,normalizePath} from 'obsidian';
import {CALENDAR,JOURNAL,JournalView} from './journal-view';
import {JournalLinks} from './journal-links';
import {TaskPlanner} from './task-planner';
import {TaskPanel} from './task-planner-view';
import {TextModal} from './content-tools';
import {journalFolder,localDay} from './filing';
import {journalTaskBlock} from './task-planner-model';
import {calendarSettings,CalendarSettings} from './calendar-settings';
import {safeName} from './model';
import {designTokens,themeSurface} from './ui-tokens';
import {SharedOpen} from './view-opening';
import {AppleCalendarClient} from './apple-calendar';
import {NativeCalendarTransport} from './native-calendar-transport';
import {AppleCalendarSettings,CalendarTask,dayKey,parseDay} from './calendar-model';
import {LargeCalendarView,LargeCalendarHost} from './large-calendar-view';
import {registerLargeCalendar,renderAppleCalendarSetting} from './register-large-calendar';
import {calendarTasks,unscheduledCalendarTasks} from './calendar-task-adapter';
import {resolveCalendarTask,taskSchedulingChange} from './calendar-scheduling';
import {CalendarNoteLinks} from './calendar-note-links';
import {CalendarNotePicker} from './calendar-note-picker';
import {ChineseCalendar,chineseDayPresentation} from './chinese-calendar';
type BoardPlugin={manifest:{version:string};currentBoard?:{file:TFile|null};ensureDock(show?:boolean):Promise<WorkspaceLeaf>};
const run=(fn:()=>unknown)=>{try{void Promise.resolve(fn()).catch(e=>new Notice(String(e)));}catch(e){new Notice(String(e));}};
export default class ThoughtSpaceCalendar extends Plugin{
 readonly calendarApiVersion=1;ready=false;declare settings:CalendarSettings;taskPlanner!:TaskPlanner;journalLinks?:JournalLinks;
 private openings=new SharedOpen<string,WorkspaceLeaf>();private filing:Promise<unknown>=Promise.resolve();private selection=0;
 appleCalendar!:AppleCalendarClient;private largeCalendarHost!:LargeCalendarHost;private openLargePane!:()=>Promise<void>;
 private initialTaskRead?:Promise<void>;private largeRefreshTimer?:number;private chinese=new ChineseCalendar();
 private eventNoteLinks!:CalendarNoteLinks;
 private settingsWrites:Promise<unknown>=Promise.resolve();
 private boardPlugin():BoardPlugin|undefined{return (this.app as unknown as {plugins:{getPlugin(id:string):BoardPlugin|undefined}}).plugins?.getPlugin('thoughtspace');}
 get currentBoard(){return this.boardPlugin()?.currentBoard;}
 get ensureDock(){const board=this.boardPlugin();return board?()=>board.ensureDock(true):undefined;}
 async onload(){
  const board=this.boardPlugin();if(board&&Number(board.manifest.version.split('.')[0])===0&&Number(board.manifest.version.split('.')[1])<94){new Notice('请先重新加载 0.94.0 或更新的思维白板，再启用独立日历。');throw Error('旧版思维白板仍占用日历视图，请重启 Obsidian');}
  const saved=await this.loadData();let legacy:unknown;
  if(saved==null){const path=normalizePath(`${this.app.vault.configDir}/plugins/thoughtspace/data.json`);if(await this.app.vault.adapter.exists(path))legacy=JSON.parse(await this.app.vault.adapter.read(path));}
  this.settings=calendarSettings(saved,legacy);if(saved==null)await this.saveData(this.settings);
  const tokens=designTokens(document);this.register(()=>tokens.remove());
  this.taskPlanner=this.addChild(new TaskPlanner(this.app,()=>this.settings.journalFolder));
  const base=(this.app.vault.adapter as unknown as {getBasePath?:()=>string}).getBasePath?.();
  this.appleCalendar=new AppleCalendarClient(new NativeCalendarTransport(base?`${base}/${this.app.vault.configDir}/plugins/${this.manifest.id}/native/ThoughtSpaceCalendarBridge.app/Contents/MacOS/calendar-bridge`:''),()=>this.settings.appleCalendar);
  this.eventNoteLinks=new CalendarNoteLinks(this.app,{
   createNote:async event=>{if(!this.ready)throw Error('日历插件已关闭');const date=dayKey(new Date(event.start));return this.createUnique(`${this.settings.cardFolder}/日程`,`${date} ${event.title}`,'md',`---\ntype: calendar-event\ndate: ${date}\ncalendar-start: ${JSON.stringify(event.start)}\ncalendar-end: ${JSON.stringify(event.end)}\n---\n\n# ${event.title.replace(/[\r\n]+/g,' ')}\n\n## 记录\n\n## 后续行动\n\n`);},
   openNote:async file=>this.openCalendarNote(file),changed:()=>this.refreshLargeCalendars()
  });
  this.register(()=>this.eventNoteLinks.dispose());
  this.largeCalendarHost={app:this.app,apple:this.appleCalendar,appleSettings:()=>this.settings.appleCalendar,
   saveAppleSettings:async settings=>this.saveAppleCalendarSettings(settings),changed:()=>this.refreshLargeCalendars(true),
   tasks:async(start,end)=>calendarTasks(await this.calendarTaskIndex(),start,end),
   unscheduledTasks:async()=>unscheduledCalendarTasks(await this.calendarTaskIndex()),
   scheduleTask:async(task,date,start,end,clearTime)=>{const current=resolveCalendarTask(await this.calendarTaskIndex(),task);if(!this.ready)throw Error('日历插件已关闭');const change=taskSchedulingChange(task,date,start,end);if(clearTime){if(start!==undefined||end!==undefined)throw Error('清除时间不能同时设置时间');change.time=null;}await this.taskPlanner.update(current,change);},
   toggleTask:async task=>{const current=resolveCalendarTask(await this.calendarTaskIndex(),task);if(!this.ready)throw Error('日历插件已关闭');await this.taskPlanner.update(current,{checked:!current.checked});},
   canToggleTask:task=>{try{return this.ready&&this.taskPlanner.canToggle(resolveCalendarTask(this.taskPlanner.all(),task));}catch{return false;}},
   openJournal:async date=>{const day=dayKey(date);await this.getJournalFile(day);await this.selectJournalDay(day);},
   openTask:async task=>this.openCalendarTask(task),
   eventNotes:event=>this.eventNoteLinks.linkedNotes(event).map(file=>({path:file.path,name:file.basename})),
   openEventNote:async event=>{await this.eventNoteLinks.openOrCreate(event);},
   linkEventNote:event=>{if(!this.ready)throw Error('日历插件已关闭');new CalendarNotePicker(this.app,async file=>{await this.eventNoteLinks.link(event,file);await this.openCalendarNote(file);},event.title).open();},
   eventMoved:async(before,after)=>this.eventNoteLinks.rekey(before,after),
   lunar:date=>chineseDayPresentation(this.chinese.get(dayKey(date)),this.settings).label};
  this.openLargePane=registerLargeCalendar(this,this.largeCalendarHost);
  this.register(this.taskPlanner.subscribe(()=>{window.clearTimeout(this.largeRefreshTimer);this.largeRefreshTimer=window.setTimeout(()=>this.refreshLargeCalendars(),100);}));
  this.register(()=>{window.clearTimeout(this.largeRefreshTimer);this.chinese.clear();});
  this.registerView(CALENDAR,leaf=>new JournalView(leaf,this,'calendar'));this.registerView(JOURNAL,leaf=>new JournalView(leaf,this,'entries'));
  this.registerMarkdownCodeBlockProcessor('thoughtspace-tasks',(source,el,ctx)=>{try{themeSurface(el,this.settings);ctx.addChild(new TaskPanel(this.app,el,this.taskPlanner,source.trim()));}catch(e){el.setText('任务日期无效：'+String(e));}});
  this.addRibbonIcon('calendar-range','ThoughtSpace 日历',()=>run(()=>this.ensureCalendar(true)));
  this.addRibbonIcon('notebook-pen','ThoughtSpace 今日日记',()=>run(()=>this.journal()));
  this.addCommand({id:'show-calendar',name:'打开日历与任务',callback:()=>run(()=>this.ensureCalendar(true))});
  this.addCommand({id:'show-journal',name:'打开日记与清单',callback:()=>run(()=>this.ensureJournal(true))});
  this.addCommand({id:'open-today',name:'打开今日日记',callback:()=>run(()=>this.journal())});
  this.addCommand({id:'capture-note',name:'收集笔记',callback:()=>this.quickCapture()});
  this.addCommand({id:'file-journals-by-month',name:'整理旧日记到年月目录',callback:()=>run(()=>this.fileOldJournals())});
  this.addSettingTab(new CalendarSettingsTab(this.app,this));this.ready=true;
  this.app.workspace.onLayoutReady(()=>{if(this.ready)this.configureLinks();});
 }
 private configureLinks(){if(this.journalLinks){this.removeChild(this.journalLinks);this.journalLinks=undefined;}if(this.settings.linkCreatedNotes)this.journalLinks=this.addChild(new JournalLinks(this.app,this));}
 private async calendarTaskIndex(){if(!this.ready)return [];if(!this.initialTaskRead)this.initialTaskRead=this.taskPlanner.ready().catch(error=>{this.initialTaskRead=undefined;throw error;});await this.initialTaskRead;return this.ready?this.taskPlanner.all():[];}
 private async openCalendarNote(file:TFile){if(!this.ready)throw Error('日历插件已关闭');if(this.app.vault.getAbstractFileByPath(file.path)!==file)throw Error('关联笔记已移动或删除，请刷新');const existing=this.app.workspace.getLeavesOfType('markdown').find(leaf=>(leaf.view as {file?:TFile}).file===file),leaf=existing||this.app.workspace.getLeaf('tab');if(!existing)await leaf.openFile(file);await this.app.workspace.revealLeaf(leaf);this.app.workspace.setActiveLeaf(leaf,{focus:true});}
 private persistSettings(patch:(current:CalendarSettings)=>CalendarSettings){const work=this.settingsWrites.catch(()=>{}).then(async()=>{if(!this.ready)throw Error('日历插件已关闭');const previous=this.settings,settings=patch(previous);await this.saveData(settings);this.settings=settings;return previous;});this.settingsWrites=work;return work;}
 async updateSettings(value:unknown,preserveApple=false){const previous=await this.persistSettings(current=>calendarSettings({...value as CalendarSettings,...(preserveApple?{appleCalendar:current.appleCalendar}:{})}));this.appleCalendar.invalidate();this.configureLinks();if(previous.journalFolder!==this.settings.journalFolder&&this.initialTaskRead)await this.taskPlanner.ready();await this.refreshViews();this.refreshLargeCalendars(true);}
 private async saveAppleCalendarSettings(appleCalendar:AppleCalendarSettings){await this.persistSettings(current=>calendarSettings({...current,appleCalendar}));}
 renderCalendarIntegrationSettings(el:HTMLElement){renderAppleCalendarSetting(el,this.largeCalendarHost,()=>this.openLargeCalendar());}
 private refreshLargeCalendars(force=false){if(!this.ready)return;for(const leaf of this.app.workspace.getLeavesOfType(LargeCalendarView.type)){const view=leaf.view;if(view instanceof LargeCalendarView)run(()=>view.refresh(force));}}
 async openLargeCalendar(day?:string){if(!this.ready)throw Error('日历插件已关闭');await this.openLargePane();if(day)for(const leaf of this.app.workspace.getLeavesOfType(LargeCalendarView.type))if(leaf.view instanceof LargeCalendarView)await leaf.view.showDay(parseDay(day));}
 private async openCalendarTask(task:CalendarTask){if(!this.ready)throw Error('日历插件已关闭');const file=this.app.vault.getAbstractFileByPath(task.source);if(!(file instanceof TFile))throw Error('来源笔记已移动或删除，请刷新');const old=this.app.workspace.getLeavesOfType('markdown').find(l=>(l.view as {file?:TFile}).file===file),leaf=old||this.app.workspace.getLeaf('tab');await leaf.openFile(file,{eState:{line:task.line??0}});await this.app.workspace.revealLeaf(leaf);}
 async refreshViews(){for(const leaf of [...this.app.workspace.getLeavesOfType(CALENDAR),...this.app.workspace.getLeavesOfType(JOURNAL)])if(leaf.view instanceof JournalView)await leaf.view.refresh();}
 private async folder(path:string){let cursor='';for(const part of normalizePath(path).split('/')){if(!part)continue;cursor=cursor?`${cursor}/${part}`:part;const old=this.app.vault.getAbstractFileByPath(cursor);if(old&&!(old instanceof TFolder))throw Error('目录位置存在同名文件：'+cursor);if(!old){try{await this.app.vault.createFolder(cursor);}catch(e){if(!(this.app.vault.getAbstractFileByPath(cursor) instanceof TFolder))throw e;}}}}
 async createUnique(folder:string,title:string,ext:string,text:string):Promise<TFile>{await this.folder(folder);for(let i=0;i<10000;i++){const path=normalizePath(`${folder}/${safeName(title)}${i?' '+(i+1):''}.${ext}`);if(this.app.vault.getAbstractFileByPath(path))continue;try{return await this.app.vault.create(path,text);}catch(e){if(!this.app.vault.getAbstractFileByPath(path))throw e;}}throw Error('无法生成唯一文件名');}
 private serialize<T>(fn:()=>Promise<T>):Promise<T>{const work=this.filing.catch(()=>{}).then(fn);this.filing=work;return work;}
 async ensureJournalFile(day=localDay()):Promise<TFile>{
  const root=this.settings.journalFolder,folder=journalFolder(day,root);
  return this.serialize(async()=>{
   const path=`${folder}/${day}.md`,current=this.app.vault.getAbstractFileByPath(path),legacy=this.app.vault.getAbstractFileByPath(`${root}/${day}.md`);
   if(current&&legacy)new Notice('新旧目录各有日记，已打开年月目录版本；旧日记保留。');
   let file=current||legacy;if(file&&!(file instanceof TFile))throw Error('日记路径被文件夹占用');
   if(!file){await this.folder(folder);try{file=await this.app.vault.create(path,`# ${day}\n\n## 今日想法\n\n## 今日任务\n\n## 阅读与关联\n\n`);}catch(error){file=this.app.vault.getAbstractFileByPath(path);if(!(file instanceof TFile))throw error;}}
   if(!(file instanceof TFile))throw Error('日记无法创建');const text=await this.app.vault.cachedRead(file);if(journalTaskBlock(text,day)!==text)await this.app.vault.process(file,text=>journalTaskBlock(text,day));return file;
  });
 }
 async getJournalFile(day=localDay()){const file=await this.ensureJournalFile(day);await this.journalLinks?.sync(day,file);return file;}
 async fileOldJournals(){const root=this.settings.journalFolder;return this.serialize(async()=>{let moved=0;const skipped:string[]=[],failed:string[]=[];for(const file of this.app.vault.getMarkdownFiles().filter(f=>f.parent?.path===root&&/^\d{4}-\d{2}-\d{2}$/.test(f.basename))){try{const folder=journalFolder(file.basename,root),target=`${folder}/${file.name}`;if(this.app.vault.getAbstractFileByPath(target)){skipped.push(file.path);continue;}const backup=`${this.app.vault.configDir}/plugins/${this.manifest.id}/filing-backups/${Date.now()}-${safeName(file.basename)}.md`;const backupFolder=backup.slice(0,backup.lastIndexOf('/'));if(!await this.app.vault.adapter.exists(backupFolder))await this.app.vault.adapter.mkdir(backupFolder);await this.app.vault.adapter.write(backup,await this.app.vault.read(file));await this.folder(folder);await this.app.fileManager.renameFile(file,target);moved++;}catch(error){failed.push(file.path+'：'+String(error));}}new Notice(`已整理 ${moved} 篇，同名保留 ${skipped.length} 篇，失败 ${failed.length} 篇`,8000);return{moved,skipped,failed};});}
 ensureCalendar(show=false){return this.ensurePane(CALENDAR,show);}
 ensureJournal(show=false){return this.ensurePane(JOURNAL,show);}
 private async ensurePane(type:string,show:boolean):Promise<WorkspaceLeaf>{
  if(!this.ready)throw Error('日历插件已关闭');
  const leaf=await this.openings.run(type,async()=>{let leaf=this.app.workspace.getLeavesOfType(type)[0];if(!leaf){leaf=this.app.workspace.getRightLeaf(false)!;if(!leaf)throw Error('无法创建日历侧栏');await leaf.setViewState({type,active:false});}await leaf.loadIfDeferred();return leaf;});
  if(!this.ready)throw Error('日历插件已关闭');if(show){this.app.workspace.rightSplit.expand();await this.app.workspace.revealLeaf(leaf);}return leaf;
 }
 async selectJournalDay(day:string){const selection=++this.selection;const calendar=await this.ensureCalendar(),journal=await this.ensureJournal(true);if(selection!==this.selection)return;if(calendar.view instanceof JournalView)await calendar.view.showDay(day,false);if(selection!==this.selection)return;if(journal.view instanceof JournalView)await journal.view.showDay(day,false);}
 async selectJournalMonth(day:string,month:string,todo:boolean){const journal=await this.ensureJournal(true);if(journal.view instanceof JournalView)await journal.view.setState({day,month,mode:'agenda',onlyTodo:todo});}
 async journal(){const day=localDay(),file=await this.getJournalFile(day);await this.selectJournalDay(day);return file;}
 editJournal(file:TFile){run(async()=>{const existing=this.app.workspace.getLeavesOfType('markdown').find(l=>(l.view as {file?:TFile}).file===file),leaf=existing||this.app.workspace.getLeaf('tab');if(!existing)await leaf.openFile(file);await this.app.workspace.revealLeaf(leaf);this.app.workspace.setActiveLeaf(leaf,{focus:true});});}
 quickCapture(){new TextModal(this.app,'收集笔记','',async text=>{const title=text.trim().split('\n')[0].replace(/^#+\s*/,'').slice(0,80)||'随手记',file=await this.createUnique(this.settings.cardFolder,title,'md',text);this.editJournal(file);}).open();}
 onunload(){this.ready=false;this.selection++;}
}
class CalendarSettingsTab extends PluginSettingTab{
 constructor(app:ThoughtSpaceCalendar['app'],private calendar:ThoughtSpaceCalendar){super(app,calendar);}
 display(){const el=this.containerEl;el.empty();el.addClass('ts-calendar-plugin');el.createEl('h2',{text:'ThoughtSpace 日历与日记'});el.createEl('p',{text:'独立运行日历、任务和周期笔记；已有 Markdown 文件继续使用。'});let draft={...this.calendar.settings};
  new Setting(el).setName('日记目录').setDesc('新日记保存为 年/月/YYYY-MM-DD.md；修改设置不会搬动旧文件。').addText(t=>t.setValue(draft.journalFolder).onChange(v=>draft.journalFolder=v));
  new Setting(el).setName('收集笔记目录').addText(t=>t.setValue(draft.cardFolder).onChange(v=>draft.cardFolder=v));
  new Setting(el).setName('关联当天新建笔记').setDesc('将当天新建的笔记链接到日记；不复制笔记正文。').addToggle(t=>t.setValue(draft.linkCreatedNotes).onChange(v=>draft.linkCreatedNotes=v));
  el.createEl('h3',{text:'中国农历'});
  for(const [key,title,desc] of [['showLunar','显示农历','日期下方显示农历，月初显示月份。'],['showFestivals','显示节日','节日优先显示；完整名称可悬停查看。'],['showSolarTerms','显示节气','显示二十四节气。'],['showHolidays','显示休班标记','使用内置中国大陆节假日数据；未收录年份不推测调休。']] as const)new Setting(el).setName(title).setDesc(desc).addToggle(t=>t.setValue(draft[key]!==false).onChange(v=>draft[key]=v));
  new Setting(el).setName('日历密度').addDropdown(d=>d.addOptions({comfortable:'舒适',compact:'紧凑'}).setValue(draft.calendarDensity||'comfortable').onChange(v=>draft.calendarDensity=v as CalendarSettings['calendarDensity']));
  new Setting(el).setName('界面风格').addDropdown(d=>d.addOptions({soft:'柔和',paper:'纸张'}).setValue(draft.surfaceStyle).onChange(v=>draft.surfaceStyle=v as CalendarSettings['surfaceStyle']));
  new Setting(el).setName('主题色').addDropdown(d=>d.addOptions({forest:'森林绿',blue:'蓝色',amber:'琥珀',rose:'玫瑰'}).setValue(draft.accent).onChange(v=>draft.accent=v as CalendarSettings['accent']));
  new Setting(el).setName('玻璃效果').addToggle(t=>t.setValue(draft.glassEffects).onChange(v=>draft.glassEffects=v));
  el.createEl('h3',{text:'大日历与苹果日历'});this.calendar.renderCalendarIntegrationSettings(el);
  new Setting(el).setName('保存设置').addButton(b=>b.setButtonText('保存').setCta().onClick(()=>run(async()=>{await this.calendar.updateSettings(draft,true);new Notice('日历设置已保存');})));
  new Setting(el).setName('整理旧日记').setDesc('仅移动根目录的日期笔记，先备份；目标同名时跳过。').addButton(b=>b.setButtonText('整理为年月目录').onClick(()=>run(()=>this.calendar.fileOldJournals())));
 }
}
