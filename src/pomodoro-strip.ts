import {Component, setIcon} from 'obsidian';
import {PomodoroController, type PomodoroSnapshot} from './pomodoro';

let nextStripId = 0;

function clockText(ms: number, remaining: boolean): string {
  const seconds = Math.max(0, remaining ? Math.ceil(ms / 1000) : Math.floor(ms / 1000));
  const tail = String(seconds % 60).padStart(2, '0');
  return seconds >= 3600
    ? `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${tail}`
    : `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${tail}`;
}

function text(el: HTMLElement, value: string): void {
  if (el.textContent !== value) el.textContent = value;
}

function followingPhase(snapshot: PomodoroSnapshot, longBreakEvery: number): 'focus' | 'short-break' | 'long-break' {
  const {session, cycle, records} = snapshot.state;
  if (session.phase !== 'focus') return 'focus';
  const outcome = session.outcome ?? records.find(record => record.id === session.id)?.outcome;
  return outcome !== 'stopped' && cycle > 0 && cycle % longBreakEvery === 0 ? 'long-break' : 'short-break';
}

/** A subscribed sidebar surface; the controller remains the only clock and store owner. */
export class PomodoroStrip extends Component {
  private active = false;
  private pendingAction = false;
  private opening = false;
  private menuOpen = false;
  private menuSession?: string;
  private actionError = '';
  private errorState?: PomodoroSnapshot['state'];
  private latest?: PomodoroSnapshot;
  private chromeKey?: string;
  private root!: HTMLElement;
  private title!: HTMLElement;
  private clock!: HTMLElement;
  private progress!: HTMLElement | SVGPathElement;
  private primary!: HTMLButtonElement;
  private primaryIcon!: HTMLElement;
  private more!: HTMLButtonElement;
  private expand!: HTMLButtonElement;
  private feedback!: HTMLElement;
  private status!: HTMLElement;
  private error!: HTMLElement;
  private stop!: HTMLButtonElement;
  private cancel!: HTMLButtonElement;
  private panelPhase?: HTMLElement;
  private panelPhaseIcon?: HTMLElement;
  private panelState?: HTMLElement;
  private panelCaption?: HTMLElement;
  private primaryText?: HTMLElement;

  constructor(
    private el: HTMLElement,
    private controller: PomodoroController,
    private onOpen: () => Promise<void>,
    private presentation: 'compact' | 'panel' = 'compact',
  ) { super(); }

  onload(): void {
    this.active = true;
    this.build();
    this.register(this.controller.subscribe(snapshot => this.update(snapshot)));
  }

  private build(): void {
    const doc = this.el.ownerDocument;
    this.root = doc.createElement('div');
    this.root.className = 'ts-calendar-plugin ts-calendar-pomodoro-strip';
    this.root.dataset.presentation = this.presentation;
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', '侧栏专注计时');
    this.el.append(this.root);
    const row = this.create('div', 'ts-calendar-pomodoro-strip-row');
    let tools = row;
    if (this.presentation === 'panel') {
      tools = this.create('div', 'ts-calendar-pomodoro-strip-panel-header', row);
      const heading = this.create('div', 'ts-calendar-pomodoro-strip-panel-heading', tools);
      this.panelPhaseIcon = this.create('span', 'ts-calendar-pomodoro-strip-panel-phase-icon', heading);
      this.panelPhaseIcon.setAttribute('aria-hidden', 'true');
      this.panelPhase = this.create('span', 'ts-calendar-pomodoro-strip-panel-phase', heading);
      this.panelState = this.create('span', 'ts-calendar-pomodoro-strip-panel-state', tools);
      this.panelState.setAttribute('aria-hidden', 'true');
    }
    this.title = this.create('span', 'ts-calendar-pomodoro-strip-title', row);
    this.clock = this.create('span', 'ts-calendar-pomodoro-strip-clock', row);
    this.clock.setAttribute('role', 'timer');
    this.clock.setAttribute('aria-live', 'off');
    this.clock.setAttribute('aria-atomic', 'true');
    if (this.presentation === 'panel') this.panelCaption = this.create('span', 'ts-calendar-pomodoro-strip-panel-caption', row);
    this.primary = this.button(row, '开始专注', '');
    this.primary.classList.add('ts-calendar-pomodoro-strip-primary');
    this.primaryIcon = this.create('span', '', this.primary);
    this.primaryIcon.setAttribute('aria-hidden', 'true');
    if (this.presentation === 'panel') this.primaryText = this.create('span', 'ts-calendar-pomodoro-strip-primary-text', this.primary);
    this.listen(this.primary, 'click', () => void this.primaryAction());
    this.more = this.button(tools, '更多计时操作', 'ellipsis');
    this.more.classList.add('ts-calendar-pomodoro-strip-more');
    this.more.setAttribute('aria-expanded', 'false');
    this.listen(this.more, 'click', () => this.toggleMenu());
    this.expand = this.button(tools, '展开完整计时器', 'maximize-2');
    this.listen(this.expand, 'click', () => void this.open());

    this.feedback = this.create('div', 'ts-calendar-pomodoro-strip-feedback');
    this.feedback.id = `ts-pomodoro-strip-feedback-${++nextStripId}`;
    this.more.setAttribute('aria-controls', this.feedback.id);
    this.status = this.create('span', 'ts-calendar-pomodoro-strip-status', this.feedback);
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.status.setAttribute('aria-atomic', 'true');
    this.error = this.create('span', 'ts-calendar-pomodoro-strip-error', this.feedback);
    this.error.setAttribute('role', 'alert');
    this.error.hidden = true;
    this.stop = this.button(this.feedback, '结束并记录', '');
    this.stop.classList.add('ts-calendar-pomodoro-strip-stop');
    text(this.stop, '结束并记录');
    this.stop.title = '结束本次计时，保存实际用时';
    this.stop.hidden = true;
    this.listen(this.stop, 'click', () => void this.run(() => this.controller.stop()));
    this.cancel = this.button(this.feedback, '取消结束计时', 'x');
    this.cancel.classList.add('ts-calendar-pomodoro-strip-cancel');
    this.cancel.hidden = true;
    this.listen(this.cancel, 'click', () => this.closeMenu(true));
    this.listen(this.root, 'keydown', (event: KeyboardEvent) => {
      if (event.key === 'Escape' && this.menuOpen) {
        event.preventDefault(); event.stopPropagation(); this.closeMenu(true);
      }
    });
    const track = this.create('div', 'ts-calendar-pomodoro-strip-track', this.presentation === 'panel' ? row : this.root);
    track.setAttribute('aria-hidden', 'true');
    if (this.presentation === 'panel') {
      const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 200 110');
      svg.setAttribute('class', 'ts-calendar-pomodoro-strip-ring');
      for (const cls of ['ts-calendar-pomodoro-strip-ring-track', 'ts-calendar-pomodoro-strip-progress']) {
        const arc = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
        arc.setAttribute('d', 'M 3 102 A 97 92 0 0 1 197 102');
        arc.setAttribute('class', cls); arc.setAttribute('pathLength', '100');
        svg.append(arc);
        if (cls === 'ts-calendar-pomodoro-strip-progress') this.progress = arc;
      }
      track.append(svg);
    } else this.progress = this.create('div', 'ts-calendar-pomodoro-strip-progress', track);
  }

  private create(tag: string, cls: string, parent = this.root): HTMLElement {
    const el = this.el.ownerDocument.createElement(tag);
    if (cls) el.className = cls;
    parent.append(el); return el;
  }

  private button(parent: HTMLElement, label: string, icon: string): HTMLButtonElement {
    const button = this.create('button', 'ts-calendar-pomodoro-strip-button', parent) as HTMLButtonElement;
    button.type = 'button'; button.setAttribute('aria-label', label); button.title = label;
    if (icon) setIcon(button, icon);
    return button;
  }

  private listen<K extends keyof HTMLElementEventMap>(el: HTMLElement, event: K, listener: (event: HTMLElementEventMap[K]) => void): void {
    el.addEventListener(event, listener as EventListener);
    this.register(() => el.removeEventListener(event, listener as EventListener));
  }

  private update(snapshot: PomodoroSnapshot): void {
    if (!this.active) return;
    this.latest = snapshot;
    if (this.actionError && this.errorState !== snapshot.state) this.actionError = '';
    const {session} = snapshot.state;
    if (this.menuOpen && (session.id !== this.menuSession || !['running', 'paused'].includes(session.status))) this.closeMenu(false);
    const focusEntry = session.mode !== 'pomodoro' && (session.status === 'idle' || session.status === 'finished');
    const phasePreview = this.presentation === 'panel' && session.mode === 'pomodoro' && session.status === 'finished';
    const config = this.controller.config;
    const nextPhase = phasePreview ? followingPhase(snapshot, config.longBreakEvery) : session.phase;
    const previewMinutes = nextPhase === 'focus' ? config.focusMinutes : nextPhase === 'short-break' ? config.shortBreakMinutes : config.longBreakMinutes;
    const remaining = focusEntry || session.mode !== 'stopwatch';
    const displayedMs = focusEntry ? config.focusMinutes * 60_000 : phasePreview ? previewMinutes * 60_000 : remaining ? snapshot.remainingMs : snapshot.elapsedMs;
    const displayed = clockText(displayedMs, remaining);
    text(this.clock, displayed);
    if (this.presentation === 'panel' && this.clock.dataset.hours !== String(displayedMs >= 3600_000)) this.clock.dataset.hours = String(displayedMs >= 3600_000);
    // The regular one-second tick only mutates this text and the fine progress line.
    const fraction = focusEntry || phasePreview ? 0 : remaining && session.durationMs > 0
      ? Math.max(0, Math.min(1, 1 - snapshot.remainingMs / session.durationMs)) : 1;
    if (this.presentation === 'panel') this.progress.style.strokeDashoffset = String(100 * (1 - fraction));
    else this.progress.style.transform = `scaleX(${fraction})`;
    const key = JSON.stringify([session.id, session.mode, session.phase, session.status, session.target?.title,
      snapshot.state.cycle, config.focusMinutes, config.shortBreakMinutes, config.longBreakMinutes, config.longBreakEvery, session.outcome, snapshot.busy, snapshot.error,
      this.pendingAction, this.opening, this.menuOpen, this.actionError]);
    if (key === this.chromeKey) return;
    this.chromeKey = key; this.renderChrome(snapshot);
  }

  private renderChrome(snapshot: PomodoroSnapshot): void {
    const {session} = snapshot.state, {mode, phase, status} = session;
    const active = status === 'running' || status === 'paused';
    const focusEntry = mode !== 'pomodoro' && !active;
    const saving = snapshot.busy || this.pendingAction;
    const panel = this.presentation === 'panel';
    const phasePreview = panel && mode === 'pomodoro' && status === 'finished';
    const nextPhase = followingPhase(snapshot, this.controller.config.longBreakEvery);
    const shownPhase = focusEntry ? 'focus' : phasePreview ? nextPhase : phase;
    const phaseLabel = shownPhase === 'focus' ? '番茄专注' : shownPhase === 'short-break' ? '短休息' : '长休息';
    const modeLabel = mode === 'pomodoro' ? phaseLabel : mode === 'stopwatch' ? '正计时' : '倒计时';
    const title = panel ? session.target?.title || (focusEntry || mode === 'pomodoro' && shownPhase === 'focus'
      ? '自由专注' : mode === 'pomodoro' ? '休息片刻' : '自由计时') : focusEntry ? '番茄专注' : session.target?.title || modeLabel;
    text(this.title, title); this.title.title = title;
    this.root.dataset.mode = focusEntry ? 'pomodoro' : mode;
    this.root.dataset.phase = shownPhase; this.root.dataset.status = status;
    this.root.setAttribute('aria-busy', String(saving || this.opening));
    this.clock.title = focusEntry ? '番茄专注预设时长' : phasePreview ? '下一阶段预设时长' : mode === 'stopwatch' ? '累计实际用时' : '剩余时间';
    this.clock.setAttribute('aria-label', this.clock.title);
    const label = status === 'running' ? '暂停' : status === 'paused' ? '继续' : panel
      ? (shownPhase === 'focus' ? '开始专注' : `开始${phaseLabel}`) : mode === 'pomodoro'
      ? ((status === 'finished' ? phase !== 'focus' : phase === 'focus') ? '开始专注' : '开始休息') : '开始番茄专注';
    this.primary.setAttribute('aria-label', label); this.primary.title = label;
    setIcon(this.primaryIcon, status === 'running' ? 'pause' : 'play');
    if (this.primaryText) text(this.primaryText, label);
    this.primary.disabled = saving;
    this.more.disabled = saving || !active;
    this.more.setAttribute('aria-expanded', String(this.menuOpen));
    this.expand.disabled = this.opening;
    this.stop.disabled = saving; this.cancel.disabled = saving;
    this.stop.hidden = !this.menuOpen; this.cancel.hidden = !this.menuOpen;
    const nextLabel = nextPhase === 'focus' ? '专注' : nextPhase === 'short-break' ? '短休息' : '长休息';
    const statusText = focusEntry ? '准备番茄专注' : status === 'paused' ? `${modeLabel} · 已暂停`
      : status === 'running' ? `${modeLabel} · ${mode === 'stopwatch' ? '累计用时' : '进行中'}`
      : status === 'finished' ? (mode === 'pomodoro' ? `本阶段结束 · 开始${nextLabel}` : `${modeLabel}已结束 · 开始番茄专注`)
      : (mode === 'pomodoro' ? `准备${phase === 'focus' ? '专注' : phaseLabel}` : `${modeLabel}待机 · 开始番茄专注`);
    const error = saving ? '' : this.actionError || snapshot.error || '';
    this.root.dataset.error = String(!!error);
    this.error.hidden = !error; this.status.hidden = !!error;
    text(this.error, error); this.error.title = error;
    const hint = saving ? '正在保存…' : this.opening ? '正在打开…' : this.menuOpen ? '保存实际用时' : statusText;
    text(this.status, hint); this.status.title = hint;
    this.feedback.dataset.expanded = String(!!error || this.menuOpen || (!panel && mode === 'pomodoro' && status === 'finished'));
    if (this.panelPhase && this.panelPhaseIcon && this.panelState && this.panelCaption) {
      const shownMode = focusEntry ? '番茄专注' : modeLabel;
      text(this.panelPhase, shownMode);
      setIcon(this.panelPhaseIcon, focusEntry || mode === 'pomodoro' && shownPhase === 'focus' ? 'timer'
        : mode === 'stopwatch' ? 'timer' : mode === 'countdown' ? 'hourglass' : shownPhase === 'long-break' ? 'armchair' : 'coffee');
      text(this.panelState, saving ? '保存中' : this.opening ? '打开中' : error ? '操作失败'
        : status === 'paused' ? '已暂停' : status === 'running' ? '进行中' : '待开始');
      text(this.panelCaption, focusEntry || phasePreview ? '准备开始' : mode === 'stopwatch' ? '累计实际用时' : '剩余时间');
    }
    this.root.title = `${title} · ${hint}`;
  }

  private refresh(): void {
    if (this.latest) this.update(this.latest);
  }

  private toggleMenu(): void {
    if (!this.active || this.more.disabled) return;
    this.menuOpen = !this.menuOpen;
    this.menuSession = this.latest?.state.session.id;
    this.refresh();
    if (this.menuOpen) this.stop.focus();
  }

  private closeMenu(returnFocus: boolean): void {
    this.menuOpen = false;
    // update() will render after external transitions; the regular path refreshes here.
    this.chromeKey = undefined;
    if (returnFocus) { this.refresh(); this.more.focus(); }
  }

  private async primaryAction(): Promise<void> {
    const session = this.latest?.state.session;
    if (!session) return;
    await this.run(() => session.status === 'running' ? this.controller.pause()
      : session.status === 'paused' ? this.controller.resume()
      : session.mode === 'pomodoro' ? this.controller.start() : this.controller.startFocus());
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (!this.active || this.pendingAction || this.latest?.busy) return;
    const focusedStop = this.el.ownerDocument.activeElement === this.stop;
    this.pendingAction = true; this.actionError = ''; this.refresh();
    try { await action(); }
    catch (error) {
      if (this.active && !this.latest?.error) { this.actionError = String(error); this.errorState = this.latest?.state; }
    } finally {
      if (this.active) {
        this.pendingAction = false; this.refresh();
        if (focusedStop && (this.el.ownerDocument.activeElement === this.stop || this.el.ownerDocument.activeElement === this.el.ownerDocument.body)) {
          (this.stop.hidden ? this.primary : this.stop).focus();
        }
      }
    }
  }

  private async open(): Promise<void> {
    if (!this.active || this.opening) return;
    this.opening = true; this.actionError = ''; this.refresh();
    try { await this.onOpen(); }
    catch (error) {
      if (this.active) { this.actionError = String(error); this.errorState = this.latest?.state; }
    } finally {
      if (this.active) { this.opening = false; this.refresh(); }
    }
  }

  onunload(): void {
    this.active = false;
    this.root?.remove();
  }
}
