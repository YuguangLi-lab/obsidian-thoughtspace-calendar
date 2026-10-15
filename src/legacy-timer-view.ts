import {ItemView, Notice, WorkspaceLeaf} from 'obsidian';
import {POMODORO_VIEW} from './pomodoro-view';

/** Compatibility placeholder for layouts saved before timers moved into the calendar. */
export class LegacyTimerView extends ItemView {
  private closed = false;
  private migrationTimer?:number;
  constructor(leaf: WorkspaceLeaf, private migrate: () => Promise<void>) { super(leaf); }
  getViewType(): string { return POMODORO_VIEW; }
  getDisplayText(): string { return '日历与计时'; }
  getIcon(): string { return 'calendar-days'; }
  async onOpen(): Promise<void> {
    this.closed = false;
    this.contentEl.empty();
    this.contentEl.createDiv({text: '计时功能已移入日历。'});
    const retry = this.contentEl.createEl('button', {text: '在日历中打开'});
    const open = () => {
      if (this.closed) return;
      retry.disabled = true;
      void this.migrate().catch(error => {
        if (!this.closed) new Notice(String(error));
      }).finally(() => { if (!this.closed) retry.disabled = false; });
    };
    retry.onclick = open;
    this.app.workspace.onLayoutReady(() => {
      if(this.closed)return;
      // Let the plugin manager restore the calendar's saved/deferred leaf first.
      this.migrationTimer=window.setTimeout(open,0);
    });
  }
  async onClose(): Promise<void> { this.closed = true; window.clearTimeout(this.migrationTimer); this.contentEl.empty(); }
}
