import { App, FuzzySuggestModal, Notice, TFile } from 'obsidian';

/** Native Obsidian fuzzy search retains the vault's keyboard and font conventions. */
export class CalendarNotePicker extends FuzzySuggestModal<TFile> {
  constructor(app: App, private onPick: (file: TFile) => Promise<void>, eventTitle?: string) {
    super(app);
    this.setPlaceholder(eventTitle ? `为「${eventTitle}」关联笔记…` : '搜索要关联的笔记…');
  }
  getItems(): TFile[] { return this.app.vault.getMarkdownFiles(); }
  getItemText(file: TFile): string { return file.path.replace(/\.md$/i, ''); }
  onChooseItem(file: TFile): void {
    void this.onPick(file).catch(error => new Notice(error instanceof Error ? error.message : '关联笔记失败，请重试'));
  }
}
