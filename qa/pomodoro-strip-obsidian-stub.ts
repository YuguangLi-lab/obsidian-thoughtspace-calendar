export {Component, ItemView, WorkspaceLeaf, Notice} from './pomodoro-obsidian-stub';
import {setIcon as baseIcon} from './pomodoro-obsidian-stub';

const icons: Record<string, string> = {
  ellipsis: '<circle cx="4" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="20" cy="12" r="1"/>',
  'maximize-2': '<path d="M8 3H3v5M16 21h5v-5M3 3l7 7M21 21l-7-7"/>',
  x: '<path d="m6 6 12 12M6 18 18 6"/>',
};
export function setIcon(el: HTMLElement, name: string): void {
  if (!icons[name]) { baseIcon(el, name); return; }
  el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" width="16" height="16">' + icons[name] + '</svg>';
  el.dataset.icon = name;
}
