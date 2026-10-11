import type { App, EventRef, TAbstractFile, TFile } from 'obsidian';
import type { CalendarEvent } from './calendar-model';

/** An ordinary list property: links travel with Markdown files and work in Bases. */
export const CALENDAR_EVENT_PROPERTY = 'thoughtspace-calendar-events';
type NoteEvent = Pick<CalendarEvent, 'calendarId' | 'id' | 'start' | 'recurring'>;

export function calendarEventNoteKey(event: NoteEvent): string {
  if (!event.id || !event.calendarId) throw new Error('日程标识缺失，请刷新日历后重试');
  const start = event.recurring ? new Date(event.start).toISOString() : null;
  return `apple:${JSON.stringify([1, event.calendarId, event.id, start])}`;
}

function isEventKey(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith('apple:')) return false;
  try {
    const key: unknown = JSON.parse(value.slice(6));
    return Array.isArray(key) && key.length === 4 && key[0] === 1 &&
      typeof key[1] === 'string' && !!key[1] && typeof key[2] === 'string' && !!key[2] &&
      (key[3] === null || (typeof key[3] === 'string' && Number.isFinite(Date.parse(key[3]))));
  } catch { return false; }
}

export function calendarEventKeys(frontmatter: Record<string, unknown> | undefined): string[] {
  const value = frontmatter?.[CALENDAR_EVENT_PROPERTY];
  return [...new Set((Array.isArray(value) ? value : [value]).filter(isEventKey))];
}

/** Mutate only our property; foreign/unknown string values are deliberately retained. */
export function updateCalendarEventKeys(
  frontmatter: Record<string, unknown>, add: string[], remove: string[] = []
): string[] {
  const original = frontmatter[CALENDAR_EVENT_PROPERTY];
  if (original !== undefined && original !== null && typeof original !== 'string' &&
      !(Array.isArray(original) && original.every(value => typeof value === 'string'))) {
    throw new Error(`笔记属性 ${CALENDAR_EVENT_PROPERTY} 应为文本列表，请先检查原文`);
  }
  if (!add.every(isEventKey)) throw new Error('日程关联标识无效');
  const values = Array.isArray(original) ? original : typeof original === 'string' ? [original] : [];
  const removed = new Set(remove);
  const next = [...new Set([...values.filter(value => !removed.has(value)), ...add])];
  if (next.length) frontmatter[CALENDAR_EVENT_PROPERTY] = next;
  else delete frontmatter[CALENDAR_EVENT_PROPERTY];
  return next.filter(isEventKey);
}

export interface CalendarNoteLinksOptions {
  createNote(event: CalendarEvent): Promise<TFile>;
  openNote(file: TFile): Promise<void>;
  changed?(): void;
}

/** Metadata-only reverse index. No note bodies are scanned or sent to Apple. */
export class CalendarNoteLinks {
  private byEvent = new Map<string, Set<TFile>>();
  private byFile = new Map<TFile, Set<string>>();
  private subscriptions: Array<{ offref(ref: EventRef): void; ref: EventRef }> = [];
  private pendingCreate = new Map<string, Promise<TFile>>();
  private writes: Promise<unknown> = Promise.resolve();
  private stopped = false;

  constructor(private app: App, private options: CalendarNoteLinksOptions) {
    const metadata = app.metadataCache, vault = app.vault;
    this.subscriptions.push({ offref: ref => metadata.offref(ref), ref: metadata.on('changed', (file, _data, cache) => {
      if (this.index(file, calendarEventKeys(cache.frontmatter))) this.options.changed?.();
    }) });
    this.subscriptions.push({ offref: ref => vault.offref(ref), ref: vault.on('delete', file => {
      if (this.removeTree(file)) this.options.changed?.();
    }) });
    this.subscriptions.push({ offref: ref => vault.offref(ref), ref: vault.on('rename', file => {
      // TFile identities survive native and folder renames. Re-read cached properties only.
      let affected = false;
      for (const note of this.byFile.keys()) {
        if (note === file || note.path.startsWith(`${file.path}/`)) {
          affected = true;
          if (note.extension !== 'md') this.index(note, []);
        }
      }
      if (isMarkdown(file)) affected = this.index(file, calendarEventKeys(metadata.getFileCache(file)?.frontmatter)) || affected;
      if (affected) this.options.changed?.();
    }) });
    for (const file of vault.getMarkdownFiles()) this.index(file, calendarEventKeys(metadata.getFileCache(file)?.frontmatter));
  }

  linkedNotes(event: NoteEvent): TFile[] {
    if (this.stopped) return [];
    const key = calendarEventNoteKey(event), notes = [...(this.byEvent.get(key) || [])];
    return notes.filter(file => {
      const exists = this.app.vault.getAbstractFileByPath(file.path) === file && file.extension === 'md';
      if (!exists) this.index(file, []);
      return exists;
    }).sort((a, b) => a.path.localeCompare(b.path));
  }

  async link(event: NoteEvent, file: TFile): Promise<void> {
    await this.change(file, [calendarEventNoteKey(event)]);
  }

  async unlink(event: NoteEvent, file: TFile): Promise<void> {
    await this.change(file, [], [calendarEventNoteKey(event)]);
  }

  /** Use after an occurrence is rescheduled so its reference remains reachable. */
  async rekey(before: NoteEvent, after: NoteEvent): Promise<void> {
    const oldKey = calendarEventNoteKey(before), newKey = calendarEventNoteKey(after);
    if (oldKey === newKey) return;
    const files = this.linkedNotes(before);
    for (const file of files) await this.change(file, [newKey], [oldKey]);
  }

  async openOrCreate(event: CalendarEvent): Promise<TFile> {
    this.assertActive();
    const file = this.linkedNotes(event)[0] || await this.create(event);
    this.assertActive();
    if (this.app.vault.getAbstractFileByPath(file.path) !== file) throw new Error('关联笔记已被移动或删除，请刷新后重试');
    await this.options.openNote(file);
    return file;
  }

  create(event: CalendarEvent): Promise<TFile> {
    this.assertActive();
    const key = calendarEventNoteKey(event), pending = this.pendingCreate.get(key);
    if (pending) return pending;
    const operation = (async () => {
      const file = await this.options.createNote(event);
      await this.link(event, file);
      return file;
    })();
    this.pendingCreate.set(key, operation);
    void operation.finally(() => { if (this.pendingCreate.get(key) === operation) this.pendingCreate.delete(key); }).catch(() => {});
    return operation;
  }

  dispose(): void {
    this.stopped = true;
    for (const { offref, ref } of this.subscriptions) offref(ref);
    this.subscriptions = [];
    this.byEvent.clear(); this.byFile.clear(); this.pendingCreate.clear();
  }

  private assertActive(): void { if (this.stopped) throw new Error('日历插件已关闭'); }

  private change(file: TFile, add: string[], remove: string[] = []): Promise<void> {
    const operation = this.writes.catch(() => {}).then(async () => {
      this.assertActive();
      if (file.extension !== 'md' || this.app.vault.getAbstractFileByPath(file.path) !== file) {
        throw new Error('笔记已不存在，请重新选择');
      }
      let keys: string[] | undefined;
      await this.app.fileManager.processFrontMatter(file, frontmatter => {
        keys = updateCalendarEventKeys(frontmatter, add, remove);
      });
      if (!this.stopped && keys) {
        this.index(file, keys); this.options.changed?.();
      }
    });
    this.writes = operation;
    return operation;
  }

  private index(file: TFile, next: string[]): boolean {
    if (this.stopped) return false;
    const old = this.byFile.get(file) || new Set<string>();
    if (old.size === next.length && next.every(key => old.has(key))) return false;
    for (const key of old) {
      this.byEvent.get(key)?.delete(file);
      if (!this.byEvent.get(key)?.size) this.byEvent.delete(key);
    }
    this.byFile.delete(file);
    if (next.length) this.byFile.set(file, new Set(next));
    for (const key of next) {
      if (!this.byEvent.has(key)) this.byEvent.set(key, new Set());
      this.byEvent.get(key)!.add(file);
    }
    return true;
  }

  private removeTree(file: TAbstractFile): boolean {
    let changed = false;
    for (const note of this.byFile.keys()) {
      if (note === file || note.path.startsWith(`${file.path}/`)) changed = this.index(note, []) || changed;
    }
    return changed;
  }
}

function isMarkdown(file: TAbstractFile): file is TFile {
  return 'extension' in file && file.extension === 'md';
}
