import test from 'node:test';
import assert from 'node:assert/strict';
import type { App, TFile } from 'obsidian';
import type { CalendarEvent } from '../src/calendar-model';
import { CALENDAR_EVENT_PROPERTY as PROPERTY, CalendarNoteLinks, calendarEventNoteKey, calendarEventKeys, updateCalendarEventKeys } from '../src/calendar-note-links';

const event = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'event:id', calendarId: 'calendar:id', title: '项目会议', start: '2026-10-11T09:00:00+08:00',
  end: '2026-10-11T10:00:00+08:00', allDay: false, location: '', notes: '', revision: '1', recurring: false,
  editable: true, color: '#123456', ...overrides
});
function host() {
  type File = TFile & { properties: Record<string, unknown> };
  const files: File[] = [], opened: File[] = [];
  const listeners = new Map<string, Set<Function>>();
  let scans = 0, writes = 0, creations = 0, changed = 0;
  const emit = (name: string, ...args: unknown[]) => { for (const fn of listeners.get(name) || []) fn(...args); };
  const events = {
    on: (name: string, fn: Function) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(fn); return { name, fn }; },
    offref: (ref: { name: string; fn: Function }) => listeners.get(ref.name)?.delete(ref.fn)
  };
  const add = (path: string, properties: Record<string, unknown> = {}): File => {
    const file = { path, extension: 'md', properties } as File; files.push(file); return file;
  };
  const app = {
    vault: { ...events, getMarkdownFiles: () => { scans++; return files; }, getAbstractFileByPath: (path: string) => files.find(file => file.path === path) },
    metadataCache: { ...events, getFileCache: (file: File) => ({ frontmatter: file.properties }) },
    fileManager: { processFrontMatter: async (file: File, fn: (properties: Record<string, unknown>) => void) => {
      writes++; const clone = structuredClone(file.properties); fn(clone); file.properties = clone;
      emit('changed', file, '', { frontmatter: clone });
    } }
  } as unknown as App;
  const links = new CalendarNoteLinks(app, {
    createNote: async () => { creations++; await Promise.resolve(); return add(`会议 ${creations}.md`); },
    openNote: async file => { opened.push(file as File); }, changed: () => { changed++; }
  });
  return { app, links, add, files, opened, emit, counts: () => ({ scans, writes, creations, changed }),
    cache: (file: File) => emit('changed', file, '', { frontmatter: file.properties }),
    delete: (file: File) => { files.splice(files.indexOf(file), 1); emit('delete', file); },
    listeners: () => [...listeners.values()].reduce((total, set) => total + set.size, 0) };
}

test('one-off event links survive moving time and renaming titles', () => {
  assert.equal(calendarEventNoteKey(event()), calendarEventNoteKey(event({ title: '新标题', start: '2026-10-12T12:00:00Z' })));
});
test('recurring event occurrences are distinct and time-zone-equivalent starts agree', () => {
  const a = calendarEventNoteKey(event({ recurring: true }));
  assert.notEqual(a, calendarEventNoteKey(event({ recurring: true, start: '2026-10-12T01:00:00Z' })));
  assert.equal(a, calendarEventNoteKey(event({ recurring: true, start: '2026-10-11T01:00:00Z' })));
});
test('identifiers cannot collide through separator characters', () => {
  assert.notEqual(calendarEventNoteKey(event({ calendarId: 'a:b', id: 'c' })), calendarEventNoteKey(event({ calendarId: 'a', id: 'b:c' })));
  assert.throws(() => calendarEventNoteKey(event({ id: '' })));
  assert.throws(() => calendarEventNoteKey(event({ recurring: true, start: 'bad' })));
});
test('only valid, unique provider keys are indexed from metadata', () => {
  const key = calendarEventNoteKey(event());
  assert.deepEqual(calendarEventKeys({ [PROPERTY]: [key, key, 'apple:broken', 'user text', 5] }), [key]);
  assert.deepEqual(calendarEventKeys({ [PROPERTY]: key }), [key]);
  assert.deepEqual(calendarEventKeys(undefined), []);
});
test('link updates preserve native properties and unknown text; unlink removes only its key', () => {
  const key = calendarEventNoteKey(event());
  const properties: Record<string, unknown> = { tags: ['计划'], status: 'active', [PROPERTY]: ['legacy text'] };
  updateCalendarEventKeys(properties, [key, key]);
  assert.deepEqual(properties, { tags: ['计划'], status: 'active', [PROPERTY]: ['legacy text', key] });
  updateCalendarEventKeys(properties, [], [key]);
  assert.deepEqual(properties[PROPERTY], ['legacy text']);
  const own: Record<string, unknown> = { [PROPERTY]: [key] };
  updateCalendarEventKeys(own, [], [key]); assert.equal(PROPERTY in own, false);
});
test('unexpected property types fail without destroying user metadata', () => {
  for (const value of [{ a: 'b' }, 10, [calendarEventNoteKey(event()), 1]]) {
    const properties: Record<string, unknown> = { [PROPERTY]: value }, before = structuredClone(properties);
    assert.throws(() => updateCalendarEventKeys(properties, [calendarEventNoteKey(event())]));
    assert.deepEqual(properties, before);
  }
});
test('link and unlink use current frontmatter, retain unrelated properties, and never read bodies', async () => {
  const h = host(), file = h.add('会议.md', { tags: ['meeting'] });
  await h.links.link(event(), file);
  assert.deepEqual(h.links.linkedNotes(event()), [file]);
  assert.deepEqual(file.properties.tags, ['meeting']);
  await h.links.unlink(event(), file);
  assert.deepEqual(h.links.linkedNotes(event()), []);
  assert.deepEqual(file.properties, { tags: ['meeting'] });
  assert.equal(h.counts().scans, 1); h.links.dispose();
});
test('concurrent links to the same note preserve both event associations', async () => {
  const h = host(), file = h.add('会议.md'), a = event(), b = event({ id: 'second' });
  await Promise.all([h.links.link(a, file), h.links.link(b, file)]);
  assert.deepEqual(calendarEventKeys(file.properties), [calendarEventNoteKey(a), calendarEventNoteKey(b)]);
  assert.equal(h.links.linkedNotes(a).length, 1); assert.equal(h.links.linkedNotes(b).length, 1); h.links.dispose();
});
test('metadata edits update links immediately without rescanning vault files', async () => {
  const h = host(), file = h.add('会议.md');
  file.properties[PROPERTY] = [calendarEventNoteKey(event())]; h.cache(file);
  assert.equal(h.links.linkedNotes(event()).length, 1);
  delete file.properties[PROPERTY]; h.cache(file);
  assert.equal(h.links.linkedNotes(event()).length, 0);
  assert.equal(h.counts().scans, 1); assert.equal(h.counts().writes, 0); h.links.dispose();
});
test('native and folder renames retain association and return latest paths', async () => {
  const h = host(), file = h.add('原文件夹/会议.md'); await h.links.link(event(), file);
  file.path = '原文件夹/新名字.md'; h.emit('rename', file, '原文件夹/会议.md');
  assert.equal(h.links.linkedNotes(event())[0].path, file.path);
  file.path = '新文件夹/新名字.md'; h.emit('rename', { path: '新文件夹' }, '原文件夹');
  assert.equal(h.links.linkedNotes(event())[0].path, file.path); h.links.dispose();
});
test('deleted notes and recycled paths cannot open stale objects', async () => {
  const h = host(), file = h.add('会议.md'); await h.links.link(event(), file);
  h.delete(file); h.add('会议.md');
  assert.deepEqual(h.links.linkedNotes(event()), []);
  await assert.rejects(h.links.link(event(), file), /不存在/); h.links.dispose();
});
test('folder deletion clears indexed descendants and md-to-txt conversion clears association', async () => {
  const h = host(), a = h.add('文件夹/A.md'), b = h.add('B.md');
  await h.links.link(event(), a); await h.links.link(event(), b);
  h.emit('delete', { path: '文件夹' }); assert.deepEqual(h.links.linkedNotes(event()), [b]);
  b.extension = 'txt'; b.path = 'B.txt'; h.emit('rename', b, 'B.md');
  assert.deepEqual(h.links.linkedNotes(event()), []); h.links.dispose();
});
test('concurrent open-or-create requests create one note and later calls reuse it', async () => {
  const h = host(); const [a, b] = await Promise.all([h.links.openOrCreate(event()), h.links.openOrCreate(event())]);
  assert.equal(a, b); assert.equal(h.counts().creations, 1);
  await h.links.openOrCreate(event({ title: '改名', start: '2026-10-12T01:00:00Z' }));
  assert.equal(h.counts().creations, 1); assert.equal(h.opened.length, 3); h.links.dispose();
});
test('moving a recurring occurrence migrates only that occurrence and keeps note content properties', async () => {
  const h = host(), a = event({ recurring: true }), b = event({ recurring: true, start: '2026-10-12T01:00:00Z' });
  const moved = event({ recurring: true, start: '2026-10-11T02:00:00Z' }), file = h.add('会议.md');
  await h.links.link(a, file); await h.links.link(b, file); await h.links.rekey(a, moved);
  assert.equal(h.links.linkedNotes(a).length, 0); assert.equal(h.links.linkedNotes(moved).length, 1);
  assert.equal(h.links.linkedNotes(b).length, 1); h.links.dispose();
});
test('a failed write does not block later valid links', async () => {
  const h = host(), broken = h.add('错误.md', { [PROPERTY]: {} }), valid = h.add('有效.md');
  await assert.rejects(h.links.link(event(), broken), /文本列表/);
  await h.links.link(event(), valid); assert.deepEqual(h.links.linkedNotes(event()), [valid]); h.links.dispose();
});
test('disposing releases event subscriptions and rejects pending mutations', async () => {
  const h = host(), file = h.add('会议.md'); assert.equal(h.listeners(), 3);
  h.links.dispose(); assert.equal(h.listeners(), 0); assert.deepEqual(h.links.linkedNotes(event()), []);
  await assert.rejects(h.links.link(event(), file), /已关闭/);
  await assert.rejects(h.links.openOrCreate(event()), /已关闭/);
});
