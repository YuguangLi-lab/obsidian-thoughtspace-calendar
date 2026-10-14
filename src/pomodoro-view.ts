import {Component, ItemView, setIcon, WorkspaceLeaf} from 'obsidian';
import {PomodoroController, PomodoroSnapshot} from './pomodoro';
import {PomodoroTarget, TimerMode} from './pomodoro-model';
import {timerMinuteLabel, timerRecordsOnDay} from './timer-calendar-model';
import {themeSurface} from './ui-tokens';

export const POMODORO_VIEW = 'thoughtspace-pomodoro';

type Phase = PomodoroSnapshot['state']['session']['phase'];
type SessionStatus = PomodoroSnapshot['state']['session']['status'];
type FinishedRecord = PomodoroSnapshot['state']['records'][number];
const MODES: Record<TimerMode, {label: string; icon: string}> = {
  stopwatch: {label: '正计时', icon: 'timer'},
  countdown: {label: '倒计时', icon: 'hourglass'},
  pomodoro: {label: '番茄钟', icon: 'circle-dot'},
};
const PHASES: Record<Phase, {label: string; icon: string}> = {
  focus: {label: '专注', icon: 'timer'},
  'short-break': {label: '短休息', icon: 'coffee'},
  'long-break': {label: '长休息', icon: 'armchair'},
};

function clockText(ms: number, roundUp = false): string {
  const seconds = Math.max(0, roundUp ? Math.ceil(ms / 1000) : Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const tail = String(seconds % 60).padStart(2, '0');
  return seconds >= 3600 ? `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:${tail}` : `${String(minutes).padStart(2, '0')}:${tail}`;
}
function localDate(value: number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function timeText(value: number): string {
  return new Date(value).toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit', hour12: false});
}
function durationText(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60), tail = seconds % 60;
  return `${minutes} 分${tail ? ` ${tail} 秒` : '钟'}`;
}
function planText(target?: PomodoroTarget): string {
  if (!target) return '';
  const range = target.plannedStart !== undefined && target.plannedEnd !== undefined ? `${timeText(target.plannedStart)}–${timeText(target.plannedEnd)}` : '';
  const duration = target.plannedDurationMs !== undefined ? durationText(target.plannedDurationMs) : '';
  return range || duration ? `计划 ${[range, duration].filter(Boolean).join(' · ')}` : '';
}
function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.setText(text);
}

/** One DOM tree per panel: seconds update its clock and progress without replacing task/calendar nodes. */
export class PomodoroPanel extends Component {
  private active = false;
  private pendingAction = false;
  private openingTarget = false;
  private openingCalendar = false;
  private actionError = '';
  private titleDirty = false;
  private durationDirty = false;
  private inputSession?: string;
  private inputTargetKey?: string;
  private latest?: PomodoroSnapshot;
  private announcementKey?: string;
  private sessionKey?: string;
  private targetKey?: string;
  private recordsReference?: readonly FinishedRecord[];
  private recordsDay?: string;
  private modeButtons = new Map<TimerMode, HTMLButtonElement>();
  private phaseChips = new Map<Phase, HTMLElement>();
  private phaseMinutes = new Map<Phase, HTMLElement>();
  private cadence!: HTMLElement;
  private modeHint!: HTMLElement;
  private stages!: HTMLElement;
  private durationControls!: HTMLElement;
  private durationInput!: HTMLInputElement;
  private presetButtons = new Map<number, HTMLButtonElement>();
  private adjustment!: HTMLElement;
  private adjustmentButtons: HTMLButtonElement[] = [];
  private phaseLabel!: HTMLElement;
  private phaseIcon!: HTMLElement;
  private clock!: HTMLElement;
  private timerStatus!: HTMLElement;
  private progress!: HTMLElement;
  private progressCircle!: SVGCircleElement;
  private progressLabel!: HTMLElement;
  private targetTitle!: HTMLElement;
  private titleInput!: HTMLInputElement;
  private targetSource!: HTMLElement;
  private targetPlan!: HTMLElement;
  private targetActual!: HTMLElement;
  private targetOpen!: HTMLButtonElement;
  private calendarOpen!: HTMLButtonElement;
  private primary!: HTMLButtonElement;
  private primaryIcon!: HTMLElement;
  private primaryText!: HTMLElement;
  private stopButton!: HTMLButtonElement;
  private resetButton!: HTMLButtonElement;
  private nextButton!: HTMLButtonElement;
  private error!: HTMLElement;
  private announcement!: HTMLElement;
  private todayCount!: HTMLElement;
  private todayMinutes!: HTMLElement;
  private recentEmpty!: HTMLElement;
  private recentRecords: FinishedRecord[] = [];
  private recentRows: {row: HTMLElement; title: HTMLElement; meta: HTMLElement; plan: HTMLElement; calendar: HTMLButtonElement}[] = [];

  constructor(
    private el: HTMLElement,
    private controller: PomodoroController,
    private onOpenTarget?: (target: PomodoroTarget) => Promise<void>,
    private onShowCalendar?: (day: string) => Promise<void>,
  ) { super(); }

  onload(): void {
    this.active = true;
    this.el.addClass('ts-calendar-plugin', 'ts-calendar-pomodoro');
    this.el.setAttribute('aria-label', '计时器');
    this.build();
    this.register(this.controller.subscribe(snapshot => this.update(snapshot)));
  }

  private build(): void {
    const head = this.el.createDiv('ts-calendar-pomodoro-head');
    const heading = head.createDiv('ts-calendar-pomodoro-heading');
    setIcon(heading.createSpan({cls: 'ts-calendar-pomodoro-heading-icon', attr: {'aria-hidden': 'true'}}), 'clock-3');
    heading.createEl('h3', {text: '计时器'});
    this.cadence = head.createSpan('ts-calendar-pomodoro-cadence');
    const modes = this.el.createDiv({cls: 'ts-calendar-pomodoro-modes', attr: {role: 'group', 'aria-label': '计时模式'}});
    for (const mode of ['stopwatch', 'countdown', 'pomodoro'] as const) {
      const button = modes.createEl('button', {attr: {type: 'button', 'aria-label': MODES[mode].label, title: MODES[mode].label}});
      setIcon(button.createSpan({attr: {'aria-hidden': 'true'}}), MODES[mode].icon);
      button.createSpan({text: MODES[mode].label});
      button.onclick = () => void this.run(() => this.controller.selectMode(mode));
      this.modeButtons.set(mode, button);
    }
    this.modeHint = this.el.createDiv({cls: 'ts-calendar-pomodoro-mode-hint', text: '结束当前计时后可切换模式'});
    this.stages = this.el.createDiv({cls: 'ts-calendar-pomodoro-stages', attr: {role: 'list', 'aria-label': '番茄钟阶段'}});
    for (const phase of ['focus', 'short-break', 'long-break'] as const) {
      const chip = this.stages.createDiv({cls: 'ts-calendar-pomodoro-stage', attr: {role: 'listitem'}});
      chip.createSpan({text: PHASES[phase].label});
      this.phaseMinutes.set(phase, chip.createSpan('ts-calendar-pomodoro-stage-minutes'));
      this.phaseChips.set(phase, chip);
    }
    this.durationControls = this.el.createDiv('ts-calendar-pomodoro-duration-controls');
    const presets = this.durationControls.createDiv({cls: 'ts-calendar-pomodoro-presets', attr: {role: 'group', 'aria-label': '倒计时时长预设'}});
    for (const minutes of [15, 25, 45, 60]) {
      const button = presets.createEl('button', {text: `${minutes}`, attr: {type: 'button', 'aria-label': `倒计时 ${minutes} 分钟`}});
      button.onclick = () => {
        this.durationInput.value = String(minutes); this.durationDirty = true;
        if (this.latest?.state.session.status === 'idle') void this.run(() => this.controller.setDuration(minutes));
        else this.updatePresets();
      };
      this.presetButtons.set(minutes, button);
    }
    const durationField = this.durationControls.createEl('label', {cls: 'ts-calendar-pomodoro-duration-field'});
    durationField.createSpan({text: '自定'});
    this.durationInput = durationField.createEl('input', {type: 'number', attr: {min: '1', max: '1440', step: '1', 'aria-label': '倒计时分钟数', inputmode: 'numeric'}});
    durationField.createSpan({text: '分'});
    this.durationInput.oninput = () => { this.durationDirty = true; this.updatePresets(); };
    this.durationInput.onkeydown = event => {
      if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); void this.primaryAction(); }
    };

    const timer = this.el.createDiv('ts-calendar-pomodoro-timer');
    const face = timer.createDiv('ts-calendar-pomodoro-face');
    this.progress = timer.createDiv({cls: 'ts-calendar-pomodoro-dial', attr: {'aria-live': 'off'}});
    const doc = this.el.ownerDocument, svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 220 220'); svg.setAttribute('class', 'ts-calendar-pomodoro-ring'); svg.setAttribute('aria-hidden', 'true');
    for (const kind of ['track', 'remaining']) {
      const circle = doc.createElementNS('http://www.w3.org/2000/svg', 'circle');
      for (const [name, value] of Object.entries({cx: '110', cy: '110', r: '101', fill: 'none', class: `ts-calendar-pomodoro-ring-${kind}`, pathLength: '100'})) circle.setAttribute(name, value);
      svg.appendChild(circle); if (kind === 'remaining') this.progressCircle = circle;
    }
    this.progress.appendChild(svg);
    this.progressLabel = this.progress.createSpan({cls: 'ts-calendar-pomodoro-progress-label', attr: {'aria-hidden': 'true'}});
    const phase = face.createDiv('ts-calendar-pomodoro-phase');
    this.phaseIcon = phase.createSpan({attr: {'aria-hidden': 'true'}}); this.phaseLabel = phase.createSpan();
    this.clock = face.createDiv({cls: 'ts-calendar-pomodoro-clock', attr: {role: 'timer', 'aria-live': 'off', 'aria-atomic': 'true'}});
    this.timerStatus = face.createDiv('ts-calendar-pomodoro-status');
    this.adjustment = this.el.createDiv({cls: 'ts-calendar-pomodoro-adjustment', attr: {role: 'group', 'aria-label': '调整剩余时间'}});
    for (const minutes of [-5, 5]) this.adjustmentButtons.push(this.actionButton(this.adjustment, `${minutes < 0 ? '−' : '+'}5 分钟`, minutes < 0 ? 'minus' : 'plus', () => this.controller.adjust(minutes)));

    const target = this.el.createDiv('ts-calendar-pomodoro-target'), targetHead = target.createDiv('ts-calendar-pomodoro-target-head');
    targetHead.createSpan({cls: 'ts-calendar-pomodoro-caption', text: '当前事项'});
    const links = targetHead.createDiv('ts-calendar-pomodoro-target-links');
    this.calendarOpen = this.iconButton(links, '在日历查看当前事项', 'calendar-days', () => this.showCalendar(this.currentCalendarDay()));
    this.targetOpen = this.iconButton(links, '打开当前事项的来源', 'arrow-up-right', () => this.openTarget());
    this.targetTitle = target.createDiv('ts-calendar-pomodoro-target-title');
    this.titleInput = target.createEl('input', {cls: 'ts-calendar-pomodoro-title-input', type: 'text', attr: {placeholder: '这次准备做什么？', 'aria-label': '本次计时事项', maxlength: '500'}});
    this.titleInput.oninput = () => { this.titleDirty = true; };
    this.titleInput.onkeydown = event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); void this.primaryAction(); } };
    this.targetSource = target.createDiv('ts-calendar-pomodoro-target-source');
    this.targetPlan = target.createDiv('ts-calendar-pomodoro-target-plan');
    this.targetActual = target.createDiv('ts-calendar-pomodoro-target-actual');

    const actions = this.el.createDiv('ts-calendar-pomodoro-actions');
    this.primary = actions.createEl('button', {cls: 'ts-calendar-pomodoro-primary', attr: {type: 'button'}});
    this.primaryIcon = this.primary.createSpan({attr: {'aria-hidden': 'true'}}); this.primaryText = this.primary.createSpan();
    this.primary.onclick = () => void this.primaryAction();
    this.stopButton = this.actionButton(actions, '结束并记录', 'square', () => this.controller.stop());
    this.stopButton.addClass('ts-calendar-pomodoro-stop'); this.stopButton.title = '结束本次计时，记录实际用时';
    const secondary = actions.createDiv('ts-calendar-pomodoro-secondary');
    this.resetButton = this.actionButton(secondary, '重置', 'rotate-ccw', () => this.controller.reset());
    this.resetButton.setAttribute('aria-label', '重置当前阶段的计时'); this.resetButton.title = '重置当前阶段的计时';
    this.nextButton = this.actionButton(secondary, '跳过', 'skip-forward', () => this.controller.next());
    this.nextButton.setAttribute('aria-label', '跳过当前阶段，准备下一阶段'); this.nextButton.title = '跳过当前阶段，准备下一阶段';
    this.error = this.el.createDiv({cls: 'ts-calendar-pomodoro-error', attr: {role: 'alert'}}); this.error.hidden = true;

    const summary = this.el.createDiv('ts-calendar-pomodoro-summary'), summaryHead = summary.createDiv('ts-calendar-pomodoro-summary-head');
    summaryHead.createSpan({cls: 'ts-calendar-pomodoro-caption', text: '今天'});
    summaryHead.createSpan({cls: 'ts-calendar-pomodoro-summary-hint', text: '实际记录的用时'});
    const stats = summary.createDiv('ts-calendar-pomodoro-stats'), count = stats.createDiv('ts-calendar-pomodoro-stat');
    this.todayCount = count.createEl('strong'); count.createSpan({text: '次记录'});
    const minutes = stats.createDiv('ts-calendar-pomodoro-stat'); this.todayMinutes = minutes.createEl('strong'); minutes.createSpan({text: '分钟'});
    summary.createDiv({cls: 'ts-calendar-pomodoro-recent-head', text: '最近记录'});
    const list = summary.createEl('ul', {cls: 'ts-calendar-pomodoro-recent', attr: {'aria-label': '最近计时记录'}});
    for (let index = 0; index < 3; index++) {
      const row = list.createEl('li', {cls: 'ts-calendar-pomodoro-record'}), mark = row.createSpan({cls: 'ts-calendar-pomodoro-record-mark', attr: {'aria-hidden': 'true'}});
      setIcon(mark, 'check'); const content = row.createDiv('ts-calendar-pomodoro-record-content');
      const title = content.createDiv('ts-calendar-pomodoro-record-title'), meta = content.createDiv('ts-calendar-pomodoro-record-meta'), plan = content.createDiv('ts-calendar-pomodoro-record-plan');
      const calendar = this.iconButton(row, '在日历查看这次计时', 'calendar-days', () => {
        const record = this.recentRecords[index]; return record ? this.showCalendar(localDate(record.startedAt)) : Promise.resolve();
      });
      calendar.addClass('ts-calendar-pomodoro-record-calendar'); this.recentRows.push({row, title, meta, plan, calendar});
    }
    this.recentEmpty = summary.createDiv({cls: 'ts-calendar-pomodoro-empty', text: '结束计时后，实际用时会记录在这里。'});
    this.announcement = this.el.createDiv({cls: 'ts-calendar-pomodoro-announcement', attr: {role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true'}});
  }

  private iconButton(parent: HTMLElement, label: string, icon: string, action: () => Promise<void>): HTMLButtonElement {
    const button = parent.createEl('button', {cls: 'ts-calendar-pomodoro-target-open', attr: {type: 'button', 'aria-label': label, title: label}});
    setIcon(button, icon); button.onclick = () => void action(); return button;
  }
  private actionButton(parent: HTMLElement, label: string, icon: string, action: () => Promise<void>): HTMLButtonElement {
    const button = parent.createEl('button', {attr: {type: 'button', 'aria-label': label}});
    setIcon(button.createSpan({attr: {'aria-hidden': 'true'}}), icon); button.createSpan({text: label});
    button.onclick = () => void this.run(action); return button;
  }
  private statusText(status: SessionStatus, mode: TimerMode, phase: Phase): string {
    if (status === 'running') return mode === 'pomodoro' ? (phase === 'focus' ? '专注进行中' : '休息进行中') : '正在计时';
    if (status === 'paused') return '已暂停';
    if (status === 'finished') return mode === 'pomodoro' ? '本阶段已结束' : '本次计时已结束';
    return mode === 'stopwatch' ? '从 00:00 开始' : '准备开始';
  }

  private update(snapshot: PomodoroSnapshot): void {
    if (!this.active) return;
    this.latest = snapshot;
    const {session} = snapshot.state, {phase, status, mode} = session, config = this.controller.config;
    const active = status === 'running' || status === 'paused';
    const key = `${session.id}:${mode}:${phase}:${status}:${session.durationMs}:${config.focusMinutes}:${config.shortBreakMinutes}:${config.longBreakMinutes}:${config.longBreakEvery}`;
    if (this.sessionKey !== key) {
      this.sessionKey = key; this.el.dataset.phase = phase; this.el.dataset.status = status; this.el.dataset.mode = mode;
      setText(this.cadence, mode === 'pomodoro' ? `每 ${config.longBreakEvery} 轮长休息` : mode === 'stopwatch' ? '记录实际用时' : '按目标时长计时');
      for (const [value, button] of this.modeButtons) button.setAttribute('aria-pressed', String(value === mode));
      this.modeHint.hidden = !active; this.stages.hidden = mode !== 'pomodoro'; this.durationControls.hidden = mode !== 'countdown' || active;
      this.adjustment.hidden = mode !== 'countdown' || !active;
      const durations: Record<Phase, number> = {focus: config.focusMinutes, 'short-break': config.shortBreakMinutes, 'long-break': config.longBreakMinutes};
      for (const [value, chip] of this.phaseChips) {
        chip.toggleClass('ts-calendar-pomodoro-stage-active', value === phase);
        if (value === phase) chip.setAttribute('aria-current', 'step'); else chip.removeAttribute('aria-current');
        setText(this.phaseMinutes.get(value)!, `${value === phase && mode === 'pomodoro' ? session.durationMs / 60000 : durations[value]} 分`);
      }
      const label = mode === 'pomodoro' ? PHASES[phase] : MODES[mode];
      setText(this.phaseLabel, label.label); setIcon(this.phaseIcon, label.icon); setText(this.timerStatus, this.statusText(status, mode, phase));
      const announcementKey = `${mode}:${phase}:${status}`;
      if (this.announcementKey !== announcementKey) {
        if (this.announcementKey !== undefined) setText(this.announcement, `${label.label}，${this.statusText(status, mode, phase)}`);
        this.announcementKey = announcementKey;
      }
      const primaryLabel = status === 'running' ? '暂停' : status === 'paused' ? '继续' : mode === 'pomodoro' ?
        (status === 'finished' ? (phase === 'focus' ? '开始休息' : '开始专注') : (phase === 'focus' ? '开始专注' : '开始休息')) : status === 'finished' ? '再开始一次' : '开始计时';
      setText(this.primaryText, primaryLabel); setIcon(this.primaryIcon, status === 'running' ? 'pause' : 'play');
      this.primary.setAttribute('aria-label', primaryLabel); this.primary.title = primaryLabel;
      this.stopButton.hidden = !active; this.resetButton.hidden = active; this.nextButton.hidden = mode !== 'pomodoro' || active;
      this.titleInput.hidden = active; this.targetTitle.hidden = !active;
      if (mode === 'stopwatch') {
        this.progress.setAttribute('role', 'group'); this.progress.setAttribute('aria-label', '已记录的实际用时');
        for (const name of ['aria-valuemin', 'aria-valuemax', 'aria-valuenow', 'aria-valuetext']) this.progress.removeAttribute(name);
      } else {
        this.progress.setAttribute('role', 'progressbar'); this.progress.setAttribute('aria-label', '当前阶段剩余时间');
        this.progress.setAttribute('aria-valuemin', '0'); this.progress.setAttribute('aria-valuemax', '100');
      }
    }
    if (this.inputSession !== session.id) { this.inputSession = session.id; this.durationDirty = false; }
    const inputTargetKey = JSON.stringify(session.target || null);
    if (this.inputTargetKey !== inputTargetKey) { this.inputTargetKey = inputTargetKey; this.titleDirty = false; }
    if (!this.titleDirty && this.titleInput.value !== (session.target?.title || '')) this.titleInput.value = session.target?.title || '';
    const durationValue = String(Math.max(1, Math.round(session.durationMs / 60000)));
    if (!this.durationDirty && this.durationInput.value !== durationValue) this.durationInput.value = durationValue;
    const displayedMs = mode === 'stopwatch' ? snapshot.elapsedMs : snapshot.remainingMs;
    const displayClock = clockText(displayedMs, mode !== 'stopwatch'); setText(this.clock, displayClock);
    this.clock.dataset.hours = String(displayedMs >= 3600000);
    const fraction = mode === 'stopwatch' ? 1 : Math.max(0, Math.min(1, session.durationMs > 0 ? snapshot.remainingMs / session.durationMs : 0));
    this.progressCircle.setAttribute('stroke-dashoffset', String(100 * (1 - fraction)));
    setText(this.progressLabel, mode === 'stopwatch' ? '↑' : `${Math.round(fraction * 100)}%`);
    if (mode !== 'stopwatch') {
      this.progress.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
      this.progress.setAttribute('aria-valuetext', `剩余 ${durationText(snapshot.remainingMs)}`);
    }
    this.updateTarget(session.target, phase, mode);
    setText(this.targetActual, `实际已用 ${durationText(snapshot.elapsedMs)}`);
    this.targetActual.hidden = !active && status !== 'finished';
    this.updatePresets(); this.updateRecords(snapshot.state.records); this.updatePending(); this.updateError();
  }

  private updatePresets(): void {
    const minutes = Number(this.durationInput.value);
    for (const [value, button] of this.presetButtons) button.setAttribute('aria-pressed', String(value === minutes));
  }
  private updateTarget(target: PomodoroTarget | undefined, phase: Phase, mode: TimerMode): void {
    const key = JSON.stringify([target, phase, mode]); if (key === this.targetKey) return; this.targetKey = key;
    const title = target?.title || (mode === 'pomodoro' && phase !== 'focus' ? '休息片刻' : '自由计时');
    setText(this.targetTitle, title); this.targetTitle.title = title;
    const source = target?.path?.split('/').pop()?.replace(/\.md$/i, '');
    setText(this.targetSource, source || (target?.eventId ? '已关联日历日程' : '可填写事项，也可直接开始'));
    this.targetSource.title = target?.path || ''; setText(this.targetPlan, planText(target)); this.targetPlan.hidden = !planText(target);
    this.targetOpen.hidden = !target?.path || !this.onOpenTarget;
    this.targetOpen.setAttribute('aria-label', target ? `打开来源：${target.title}` : '打开当前事项的来源');
    this.calendarOpen.hidden = !this.onShowCalendar || !target;
  }
  private updateRecords(records: readonly FinishedRecord[]): void {
    const today = localDate(new Date());
    // The controller replaces history at transitions; ticks keep its array unchanged.
    if (records === this.recordsReference && today === this.recordsDay) return;
    this.recordsReference = records; this.recordsDay = today;
    const todayRecords = timerRecordsOnDay(records, new Date());
    setText(this.todayCount, String(todayRecords.length));
    setText(this.todayMinutes, timerMinuteLabel(todayRecords.reduce((sum, record) => sum + record.durationMs, 0)));
    this.recentRecords = records.filter(record => record.durationMs > 0 && !((record.mode || 'pomodoro') === 'pomodoro' && record.phase && record.phase !== 'focus'))
      .sort((a, b) => b.completedAt - a.completedAt).slice(0, 3);
    for (const [index, item] of this.recentRows.entries()) {
      const record = this.recentRecords[index]; item.row.hidden = !record; if (!record) continue;
      const title = record.target?.title || '自由计时', mode = record.mode || 'pomodoro'; setText(item.title, title); item.title.title = title;
      const date = new Date(record.completedAt), dateLabel = localDate(date) === today ? '今天' : `${date.getMonth() + 1}/${date.getDate()}`;
      const modeLabel = mode === 'pomodoro' && record.phase && record.phase !== 'focus' ? PHASES[record.phase].label : MODES[mode].label;
      setText(item.meta, `${dateLabel} ${timeText(record.completedAt)} · ${modeLabel} · ${durationText(record.durationMs)}`);
      const planned = record.target?.plannedDurationMs;
      setText(item.plan, planned !== undefined ? `计划 ${durationText(planned)} / 实际 ${durationText(record.durationMs)}` : record.outcome === 'stopped' ? '主动结束，已记录' : '已完成');
      item.calendar.hidden = !this.onShowCalendar; item.calendar.setAttribute('aria-label', `在日历查看记录：${title}`);
    }
    this.recentEmpty.hidden = this.recentRecords.length > 0;
  }
  private updatePending(): void {
    const busy = this.pendingAction || !!this.latest?.busy, status = this.latest?.state.session.status, active = status === 'running' || status === 'paused';
    for (const button of [this.primary, this.stopButton, this.resetButton, this.nextButton, ...this.adjustmentButtons, ...this.presetButtons.values()]) if (button.disabled !== busy) button.disabled = busy;
    for (const button of this.modeButtons.values()) button.disabled = busy || active;
    this.durationInput.disabled = busy; this.titleInput.disabled = busy;
    this.targetOpen.disabled = this.openingTarget; this.calendarOpen.disabled = this.openingCalendar;
    for (const item of this.recentRows) item.calendar.disabled = this.openingCalendar;
    if (this.el.getAttribute('aria-busy') !== String(busy)) this.el.setAttribute('aria-busy', String(busy));
  }
  private updateError(): void { const message = this.actionError || this.latest?.error || ''; setText(this.error, message); this.error.hidden = !message; }
  private async run(action: () => Promise<void>): Promise<void> {
    if (!this.active || this.pendingAction || this.latest?.busy) return;
    this.pendingAction = true; this.actionError = ''; this.updatePending(); this.updateError();
    try { await action(); } catch (error) {
      this.actionError = this.controller.snapshot().error ? '' : error instanceof Error ? error.message : String(error);
    } finally { this.pendingAction = false; if (this.active) this.update(this.controller.snapshot()); }
  }
  private async primaryAction(): Promise<void> {
    const session = this.latest?.state.session; if (!session) return;
    if (session.status === 'running') return this.run(() => this.controller.pause());
    if (session.status === 'paused') return this.run(() => this.controller.resume());
    const title = this.titleInput.value.trim(), assigned = title ? {...session.target, title} : session.target;
    const minutes = Number(this.durationInput.value);
    if (session.mode === 'countdown' && (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440)) {
      this.actionError = '请输入 1–1440 之间的整数分钟数。'; this.updateError(); this.durationInput.focus(); return;
    }
    await this.run(() => session.mode === 'pomodoro' ? this.controller.start(assigned) : this.controller.startTimer(assigned, session.mode, session.mode === 'countdown' ? minutes : undefined));
  }
  private currentCalendarDay(): string {
    const session = this.latest?.state.session;
    return localDate(session?.target?.plannedStart ?? session?.startedAt ?? Date.now());
  }
  private async showCalendar(day: string): Promise<void> {
    if (!this.active || !this.onShowCalendar || this.openingCalendar) return;
    this.openingCalendar = true; this.actionError = ''; this.updatePending(); this.updateError();
    try { await this.onShowCalendar(day); } catch (error) { this.actionError = error instanceof Error ? error.message : String(error); }
    finally { this.openingCalendar = false; if (this.active) { this.updatePending(); this.updateError(); } }
  }
  private async openTarget(): Promise<void> {
    const target = this.latest?.state.session.target;
    if (!this.active || !target || !this.onOpenTarget || this.openingTarget) return;
    this.openingTarget = true; this.actionError = ''; this.updatePending(); this.updateError();
    try { await this.onOpenTarget(target); } catch (error) { this.actionError = error instanceof Error ? error.message : String(error); }
    finally { this.openingTarget = false; if (this.active) { this.updatePending(); this.updateError(); } }
  }
  onunload(): void { this.active = false; this.el.empty(); }
}

export class PomodoroView extends ItemView {
  private panel?: PomodoroPanel;
  constructor(leaf: WorkspaceLeaf, private controller: PomodoroController, private onOpenTarget?: (target: PomodoroTarget) => Promise<void>, private onShowCalendar?: (day: string) => Promise<void>) { super(leaf); }
  getViewType(): string { return POMODORO_VIEW; }
  getDisplayText(): string { return '计时器'; }
  getIcon(): string { return 'clock-3'; }
  async onOpen(): Promise<void> {
    if (this.panel) this.removeChild(this.panel); this.contentEl.empty(); this.contentEl.addClass('ts-calendar-pomodoro-view'); themeSurface(this.contentEl);
    this.panel = new PomodoroPanel(this.contentEl.createDiv('ts-calendar-pomodoro-host'), this.controller, this.onOpenTarget, this.onShowCalendar); this.addChild(this.panel);
  }
  async onClose(): Promise<void> { if (this.panel) this.removeChild(this.panel); this.panel = undefined; this.contentEl.empty(); }
}
