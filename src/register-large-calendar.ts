import { Plugin, type WorkspaceLeaf, Setting, Notice } from 'obsidian';
import { LargeCalendarView, type LargeCalendarHost } from './large-calendar-view';
import { AppleCalendarConnectionModal } from './calendar-modals';

// The existing plugin supplies its shared task index and journal opener here.
// This module never scans the vault again or creates diary files while browsing.
export function registerLargeCalendar(plugin:Plugin,host:LargeCalendarHost):()=>Promise<void> {
  plugin.registerView(LargeCalendarView.type,(leaf:WorkspaceLeaf)=>new LargeCalendarView(leaf,host));
  let opening:Promise<void>|undefined;
  let closed=false;
  const open=():Promise<void>=> {
    if(closed)return Promise.reject(new Error('日历插件已关闭'));if(opening) return opening;
    opening=(async()=> {
      let leaf=plugin.app.workspace.getLeavesOfType(LargeCalendarView.type)[0];
      if(!leaf) { leaf=plugin.app.workspace.getLeaf('tab'); await leaf.setViewState({type:LargeCalendarView.type,active:true}); }
      if(closed)throw Error('日历插件已关闭');await leaf.loadIfDeferred();await plugin.app.workspace.revealLeaf(leaf);
    })().finally(()=>opening=undefined);
    return opening;
  };
  const reveal=()=>void open().catch(error=>new Notice(String(error)));
  plugin.addCommand({id:'open-large-calendar',name:'打开大日历',callback:reveal});
  plugin.addCommand({id:'connect-apple-calendar',name:'苹果日历连接与选择',callback:()=>new AppleCalendarConnectionModal(host).open()});
  plugin.addRibbonIcon('calendar-range','打开大日历',reveal);
  plugin.register(()=>{closed=true;host.apple.dispose();});
  return open;
}

export function renderAppleCalendarSetting(container:HTMLElement,host:LargeCalendarHost,open:()=>Promise<void>):void {
  new Setting(container).setName('大日历').setDesc('在主工作区打开月视图和周时间格，查看日程、待办和日记。')
    .addButton(button=>button.setButtonText('打开').onClick(()=>void open()));
  new Setting(container).setName('苹果日历双向联动').setDesc('macOS 14 及以上。在选择的日历中查看、新建和修改日程。')
    .addButton(button=>button.setButtonText(host.appleSettings().enabled?'管理连接':'连接苹果日历')
      .onClick(()=>new AppleCalendarConnectionModal(host).open()));
}
