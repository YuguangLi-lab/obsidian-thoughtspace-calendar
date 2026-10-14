import {Component} from 'obsidian';
import {PomodoroController} from '../src/pomodoro';
import {PomodoroStrip} from '../src/pomodoro-strip';
import {PomodoroPanel} from '../src/pomodoro-view';
import {defaultPomodoroConfig, type PomodoroState} from '../src/pomodoro-model';

let now = new Date().setHours(9, 0, 0, 0), saved: PomodoroState | undefined;
let writes = 0, failSave = false, openError = false, opens = 0, subscriptions = 0;
let saveGate: Promise<void> | undefined, releaseSave: (() => void) | undefined;
let openGate: Promise<void> | undefined, releaseOpen: (() => void) | undefined;
let config = {...defaultPomodoroConfig};
const controller = new PomodoroController({
  load: async () => saved || null,
  save: async state => {
    await saveGate;
    if (failSave) throw Error('模拟磁盘写入失败');
    writes++; saved = structuredClone(state);
  },
}, () => config, {now: () => now, interval: false});
await controller.initialize();
const subscribe = controller.subscribe.bind(controller);
controller.subscribe = listener => {
  subscriptions++;
  const off = subscribe(listener);
  let subscribed = true;
  return () => { if (subscribed) { subscribed = false; subscriptions--; off(); } };
};
const scope = new Component(); scope.load();
let strips: PomodoroStrip[] = [];
const mount = () => {
  for (const id of ['first', 'second', 'showcase']) strips.push(scope.addChild(new PomodoroStrip(document.getElementById(id)!, controller, async () => {
    opens++; await openGate;
    if (openError) throw Error('模拟展开失败');
  }, id === 'showcase' ? 'panel' : 'compact')));
};
mount();
const panel = new PomodoroPanel(document.getElementById('full')!, controller); panel.load();
(window as any).qaStrip = {
  controller,
  state: () => controller.snapshot(),
  advance: async (ms: number) => { now += ms; controller.tick(); await controller.settled(); },
  writes: () => writes,
  opens: () => opens,
  subscriptions: () => subscriptions,
  focusMinutes: (value: number) => { config = {...config, focusMinutes: value}; controller.tick(); },
  failSave: (value: boolean) => failSave = value,
  failOpen: (value: boolean) => openError = value,
  blockSave: () => { saveGate = new Promise<void>(resolve => releaseSave = resolve); },
  allowSave: () => { releaseSave?.(); saveGate = undefined; },
  blockOpen: () => { openGate = new Promise<void>(resolve => releaseOpen = resolve); },
  allowOpen: () => { releaseOpen?.(); openGate = undefined; },
  close: () => { for (const strip of strips) scope.removeChild(strip); strips = []; },
  closeAll: () => { for (const strip of strips) scope.removeChild(strip); strips = []; panel.unload(); },
  mount,
};
