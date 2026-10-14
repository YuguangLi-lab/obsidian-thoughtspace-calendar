import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advancePomodoro, createPomodoroState, defaultPomodoroConfig, normalizePomodoroConfig,
  normalizePomodoroState, pomodoroRemaining, pomodoroElapsed, timerSegments, transitionPomodoro,
  MAX_TIMER_DURATION_MS, MAX_TIMER_SEGMENTS,
  type PomodoroConfig, type PomodoroState,
} from '../src/pomodoro-model';

const MINUTE = 60_000;
const config: PomodoroConfig = { focusMinutes: 1, shortBreakMinutes: 1, longBreakMinutes: 2, longBreakEvery: 4 };
const task = { title: '阅读文献', path: '研究/任务.md', line: 0, source: '- [ ] 阅读文献' };
function started(now = 1_000_000): PomodoroState {
  return transitionPomodoro(createPomodoroState(config, now), { type: 'start', target: task }, config, now);
}

test('background wake and midnight rollover recover the absolute deadline once', () => {
  const now = new Date('2026-10-13T23:59:30+08:00').getTime();
  const initial = started(now);
  const persisted = JSON.parse(JSON.stringify(initial));
  const recovered = normalizePomodoroState(persisted, config, now + 7 * 24 * 60 * MINUTE);
  assert.equal(recovered.session.status, 'finished');
  assert.equal(recovered.session.phase, 'focus');
  assert.equal(recovered.cycle, 1);
  assert.equal(recovered.records.length, 1);
  assert.equal(recovered.records[0].completedAt, now + MINUTE);
  assert.deepEqual(recovered.records[0].target, task);
  assert.equal(advancePomodoro(recovered, now + 8 * 24 * 60 * MINUTE), recovered);
  assert.deepEqual(initial, persisted);
});

test('pause and resume preserve the remaining time across a long pause', () => {
  const initial = started();
  const paused = transitionPomodoro(initial, { type: 'pause' }, config, 1_020_000);
  assert.equal(paused.session.status, 'paused');
  assert.equal(paused.session.remainingMs, 40_000);
  assert.equal(paused.session.deadline, undefined);
  assert.equal(pomodoroRemaining(paused, 9_000_000), 40_000);
  const resumed = transitionPomodoro(paused, { type: 'resume' }, config, 9_000_000);
  assert.equal(resumed.session.deadline, 9_040_000);
  assert.equal(resumed.session.startedAt, 1_000_000);
  assert.equal(pomodoroRemaining(resumed, 9_010_000), 30_000);
  const finished = advancePomodoro(resumed, 9_040_000);
  assert.equal(finished.cycle, 1);
  assert.equal(finished.records[0].startedAt, 1_000_000);
  assert.equal(finished.records[0].durationMs, MINUTE);
  assert.equal(initial.session.status, 'running');
  assert.equal(paused.session.status, 'paused');
});

test('repeated completion calls and repeated recovery do not add another focus record', () => {
  const initial = started();
  const completed = advancePomodoro(initial, 1_060_000);
  const staleRunningWithRecord = { ...initial, records: completed.records, cycle: completed.cycle };
  const second = advancePomodoro(staleRunningWithRecord, 1_070_000);
  assert.equal(second.cycle, 1);
  assert.equal(second.records.length, 1);
  const recovered = normalizePomodoroState(JSON.parse(JSON.stringify(second)), config, 2_000_000);
  assert.equal(recovered.cycle, 1);
  assert.equal(recovered.records.length, 1);
});

test('skip moves to idle next phase without crediting incomplete focus', () => {
  const initial = started();
  const next = transitionPomodoro(initial, { type: 'next' }, config, 1_015_000);
  assert.equal(next.session.phase, 'short-break');
  assert.equal(next.session.status, 'idle');
  assert.equal(next.cycle, 0);
  assert.equal(next.records.length, 0);
  assert.deepEqual(next.session.target, task);
  assert.notEqual(next.session.id, initial.session.id);
  const nextFocus = transitionPomodoro(next, { type: 'next' }, config, 1_016_000);
  assert.equal(nextFocus.session.phase, 'focus');
  assert.equal(nextFocus.session.status, 'idle');
});

test('reset keeps target and cycle while starting the current phase afresh', () => {
  const initial = started();
  const reset = transitionPomodoro(initial, { type: 'reset' }, config, 1_015_000);
  assert.equal(reset.session.phase, 'focus');
  assert.equal(reset.session.status, 'idle');
  assert.equal(reset.session.remainingMs, MINUTE);
  assert.equal(reset.session.deadline, undefined);
  assert.equal(reset.session.startedAt, undefined);
  assert.deepEqual(reset.session.target, task);
  assert.equal(reset.cycle, 0);
  assert.equal(reset.records.length, 0);
  const finished = advancePomodoro(initial, 1_060_000);
  const afterFinish = transitionPomodoro(finished, { type: 'reset' }, config, 1_070_000);
  assert.equal(afterFinish.cycle, 1);
  assert.equal(afterFinish.records.length, 1);
});

test('finished start immediately starts rest and the fourth completed focus selects long rest', () => {
  let now = 1_000_000;
  let state = started(now);
  for (let focus = 1; focus <= 4; focus++) {
    now += MINUTE;
    state = advancePomodoro(state, now);
    assert.equal(state.cycle, focus);
    assert.equal(state.records.length, focus);
    state = transitionPomodoro(state, { type: 'start' }, config, now);
    assert.equal(state.session.phase, focus === 4 ? 'long-break' : 'short-break');
    assert.equal(state.session.status, 'running');
    assert.deepEqual(state.session.target, task);
    if (focus < 4) {
      now += MINUTE;
      state = advancePomodoro(state, now);
      assert.equal(state.records.length, focus);
      state = transitionPomodoro(state, { type: 'start' }, config, now);
      assert.equal(state.session.phase, 'focus');
    }
  }
  assert.equal(state.session.durationMs, 2 * MINUTE);
  const finishedRest = advancePomodoro(state, now + 2 * MINUTE);
  assert.equal(finishedRest.cycle, 4);
  assert.equal(finishedRest.records.length, 4);
  const fifth = transitionPomodoro(finishedRest, { type: 'next' }, config, now + 2 * MINUTE);
  const skipped = transitionPomodoro(fifth, { type: 'next' }, config, now + 2 * MINUTE);
  assert.equal(skipped.session.phase, 'short-break');
});

test('pause, resume and same-target start are safe no-ops when their state does not apply', () => {
  const idle = createPomodoroState(config, 1_000_000);
  assert.equal(transitionPomodoro(idle, { type: 'pause' }, config, 1_000_000), idle);
  assert.equal(transitionPomodoro(idle, { type: 'resume' }, config, 1_000_000), idle);
  const running = started();
  assert.equal(transitionPomodoro(running, { type: 'start', target: { ...task } }, config, 1_005_000), running);
  const paused = transitionPomodoro(running, { type: 'pause' }, config, 1_010_000);
  assert.equal(transitionPomodoro(paused, { type: 'pause' }, config, 1_020_000), paused);
  assert.equal(transitionPomodoro(paused, { type: 'start' }, config, 1_030_000).session.deadline, 1_080_000);
  const finished = transitionPomodoro(running, { type: 'pause' }, config, 1_060_000);
  assert.equal(finished.session.status, 'finished');
  assert.equal(finished.records.length, 1);
});

test('a different target cannot replace running or paused focus, including unassigned focus', () => {
  const running = started();
  const other = { ...task, title: '分析数据', line: 1 };
  assert.throws(() => transitionPomodoro(running, { type: 'start', target: other }, config, 1_010_000), /请先重置或跳过/);
  const paused = transitionPomodoro(running, { type: 'pause' }, config, 1_010_000);
  assert.throws(() => transitionPomodoro(paused, { type: 'start', target: other }, config, 1_020_000), /请先重置或跳过/);
  const unassigned = transitionPomodoro(createPomodoroState(config, 1_000_000), { type: 'start' }, config, 1_000_000);
  assert.throws(() => transitionPomodoro(unassigned, { type: 'start', target: task }, config, 1_010_000), /请先重置或跳过/);
  const reset = transitionPomodoro(paused, { type: 'reset' }, config, 1_020_000);
  assert.deepEqual(transitionPomodoro(reset, { type: 'start', target: other }, config, 1_020_000).session.target, other);
  assert.throws(() => transitionPomodoro(reset, { type: 'start', target: { title: '\n ' } }, config, 1_020_000), /标题不能为空/);
});

test('config normalization rejects nonnumbers and clamps all configured ranges', () => {
  assert.deepEqual(normalizePomodoroConfig(null), defaultPomodoroConfig);
  assert.deepEqual(normalizePomodoroConfig({ focusMinutes: Infinity, shortBreakMinutes: NaN,
    longBreakMinutes: '10', longBreakEvery: null }), defaultPomodoroConfig);
  assert.deepEqual(normalizePomodoroConfig({ focusMinutes: 999, shortBreakMinutes: -5,
    longBreakMinutes: 99, longBreakEvery: 1 }), {
    focusMinutes: 180, shortBreakMinutes: 1, longBreakMinutes: 60, longBreakEvery: 2,
  });
  assert.equal(normalizePomodoroConfig({ longBreakEvery: 99 }).longBreakEvery, 12);
});

test('malformed persisted state is bounded and invalid deadlines preserve a paused recoverable session', () => {
  const raw = { session: { id: '\u0000 ', phase: 'invalid', status: 'running', durationMs: NaN,
    remainingMs: 999_999_999, deadline: Infinity, startedAt: -1,
    target: { title: 'x'.repeat(2000), path: 'p'.repeat(3000), source: 's'.repeat(9000), line: -1 } },
    cycle: Infinity, records: [{ id: 'bad', startedAt: 20, completedAt: 10, durationMs: MINUTE }] };
  const recovered = normalizePomodoroState(raw, config, 1_000_000);
  assert.equal(recovered.session.phase, 'focus');
  assert.equal(recovered.session.status, 'paused');
  assert.equal(recovered.session.durationMs, MINUTE);
  assert.equal(recovered.session.remainingMs, MINUTE);
  assert.equal(recovered.session.deadline, undefined);
  assert.equal(recovered.session.target?.title.length, 500);
  assert.equal(recovered.session.target?.path?.length, 2048);
  assert.equal(recovered.session.target?.source?.length, 2000);
  assert.equal(recovered.session.target?.line, undefined);
  assert.equal(recovered.cycle, 0);
  assert.deepEqual(recovered.records, []);
  assert.equal(raw.session.remainingMs, 999_999_999);
  const fakeFuture = normalizePomodoroState({ ...started(), session: { ...started().session,
    deadline: 99_000_000, remainingMs: 20_000 } }, config, 1_000_000);
  assert.equal(fakeFuture.session.deadline, 1_020_000);
  assert.equal(pomodoroRemaining(fakeFuture, 1_000_000), 20_000);
  const invalidEnums = normalizePomodoroState({ session: { phase: 'unknown', status: 'unknown',
    durationMs: -1, remainingMs: 0, deadline: 1, startedAt: 1 } }, config, 1_000_000);
  assert.equal(invalidEnums.session.status, 'idle');
  assert.equal(invalidEnums.session.remainingMs, MINUTE);
  assert.equal(invalidEnums.session.startedAt, undefined);
  for (const corruptTime of [{ startedAt: undefined, deadline: 900_000 },
    { startedAt: 1_000_000, deadline: 900_000 },
    { startedAt: 1_000_000, deadline: 1_005_000 },
    { startedAt: 0, deadline: 0 }]) {
    const corrupt = normalizePomodoroState({ ...started(), session: { ...started().session, ...corruptTime } }, config, 1_010_000);
    assert.equal(corrupt.session.status, 'paused');
    assert.equal(corrupt.records.length, 0);
    assert.equal(corrupt.cycle, 0);
  }
});

test('record history rejects malformed entries, deduplicates ids and remains limited to 200', () => {
  const records = Array.from({ length: 230 }, (_, i) => ({ id: `record-${i}`, startedAt: i * MINUTE,
    completedAt: (i + 1) * MINUTE, durationMs: MINUTE }));
  const recovered = normalizePomodoroState({ records: [...records,
    { ...records[229], target: { title: '最新任务' } },
    { id: 'nan', startedAt: NaN, completedAt: 3_000_000, durationMs: MINUTE },
    { id: 'reversed', startedAt: 2_000_000, completedAt: 1_000_000, durationMs: MINUTE },
    { id: 'oversize', startedAt: 0, completedAt: 1_000_000, durationMs: 181 * MINUTE },
    null, 'bad'], cycle: -10 }, config, 50_000_000);
  assert.equal(recovered.records.length, 200);
  assert.equal(recovered.records[0].id, 'record-30');
  assert.equal(recovered.records[199].target?.title, '最新任务');
  assert.equal(new Set(recovered.records.map(record => record.id)).size, 200);
  assert.equal(recovered.cycle, 0);
  const completed = advancePomodoro({ ...started(50_000_000), records: recovered.records }, 50_060_000);
  assert.equal(completed.records.length, 200);
  assert.equal(completed.records[0].id, 'record-31');
});

test('clock rollback and negative or invalid clocks never increase remaining time beyond the session', () => {
  const initial = started();
  assert.equal(pomodoroRemaining(initial, 900_000), MINUTE);
  assert.equal(pomodoroRemaining(initial, -500), MINUTE);
  assert.equal(pomodoroRemaining(initial, NaN), MINUTE);
  const paused = transitionPomodoro(initial, { type: 'pause' }, config, 1_020_000);
  const resumed = transitionPomodoro(paused, { type: 'resume' }, config, 900_000);
  assert.equal(pomodoroRemaining(resumed, 800_000), 40_000);
  assert.equal(pomodoroRemaining(resumed, 939_999), 1);
  const ended = advancePomodoro(resumed, 940_000);
  assert.equal(ended.records.length, 1);
  assert.ok(ended.records[0].completedAt >= ended.records[0].startedAt);
  const negative = started(-200);
  assert.equal(negative.session.startedAt, 0);
  assert.equal(negative.session.deadline, MINUTE);
  assert.equal(advancePomodoro(negative, MINUTE).cycle, 1);
});

test('same-clock resets generate distinct ids and duration changes apply to new sessions', () => {
  const a = createPomodoroState(config, 0);
  const b = createPomodoroState(config, 0);
  assert.notEqual(a.session.id, b.session.id);
  const changed = { ...config, focusMinutes: 90 };
  const recovered = normalizePomodoroState(started(), changed, 1_005_000);
  assert.equal(recovered.session.durationMs, MINUTE);
  const reset = transitionPomodoro(recovered, { type: 'reset' }, changed, 1_005_000);
  assert.equal(reset.session.durationMs, 90 * MINUTE);
});

test('explicit task focus starts another focus after completed focus without entering rest', () => {
  const finished = advancePomodoro(started(), 1_060_000);
  const other = { ...task, title: '分析数据', line: 1 };
  const focus = transitionPomodoro(finished, { type: 'focus', target: other }, config, 1_070_000);
  assert.equal(focus.session.phase, 'focus');
  assert.equal(focus.session.status, 'running');
  assert.equal(focus.session.durationMs, MINUTE);
  assert.equal(focus.session.deadline, 1_130_000);
  assert.deepEqual(focus.session.target, other);
  assert.equal(focus.cycle, 1);
  assert.deepEqual(focus.records, finished.records);
  assert.notEqual(focus.session.id, finished.session.id);
});

test('explicit task focus skips idle, running, paused and completed rest without credit', () => {
  const other = { ...task, title: '分析数据', line: 1 };
  const finished = advancePomodoro(started(), 1_060_000);
  const idleRest = transitionPomodoro(finished, { type: 'next' }, config, 1_070_000);
  const runningRest = transitionPomodoro(idleRest, { type: 'start' }, config, 1_070_000);
  const pausedRest = transitionPomodoro(runningRest, { type: 'pause' }, config, 1_080_000);
  const finishedRest = advancePomodoro(runningRest, 1_130_000);
  for (const rest of [idleRest, runningRest, pausedRest, finishedRest]) {
    const now = rest.session.status === 'finished' ? 1_140_000 : 1_090_000;
    const focus = transitionPomodoro(rest, { type: 'focus', target: other }, config, now);
    assert.equal(focus.session.phase, 'focus');
    assert.equal(focus.session.status, 'running');
    assert.equal(focus.session.deadline, now + MINUTE);
    assert.deepEqual(focus.session.target, other);
    assert.equal(focus.cycle, 1);
    assert.deepEqual(focus.records, finished.records);
  }
});

test('explicit task focus preserves active focus and rejects replacing its task', () => {
  const running = started();
  const paused = transitionPomodoro(running, { type: 'pause' }, config, 1_010_000);
  const other = { ...task, title: '分析数据', line: 1 };
  for (const active of [running, paused]) {
    assert.throws(() => transitionPomodoro(active, { type: 'focus', target: other }, config, 1_020_000), /请先重置或跳过/);
  }
  assert.equal(transitionPomodoro(running, { type: 'focus', target: { ...task } }, config, 1_010_000), running);
  const resumed = transitionPomodoro(paused, { type: 'focus', target: task }, config, 1_030_000);
  assert.equal(resumed.session.id, paused.session.id);
  assert.equal(resumed.session.deadline, 1_080_000);
  assert.equal(resumed.session.remainingMs, 50_000);
  const idle = createPomodoroState(config, 1_000_000);
  const fresh = transitionPomodoro(idle, { type: 'focus', target: task }, config, 1_000_000);
  assert.equal(fresh.session.id, idle.session.id);
  assert.equal(fresh.session.phase, 'focus');
  assert.equal(fresh.session.status, 'running');
  assert.deepEqual(fresh.session.target, task);
});

test('countdown mode accepts custom durations up to one day without changing Pomodoro settings', () => {
  const idle = createPomodoroState(config, 1_000_000);
  const selected = transitionPomodoro(idle, { type: 'select-mode', mode: 'countdown', durationMinutes: 2000 }, config, 1_000_000);
  assert.equal(selected.session.mode, 'countdown');
  assert.equal(selected.session.durationMs, 1440 * MINUTE);
  const shortened = transitionPomodoro(selected, { type: 'duration', minutes: -1 }, config, 1_000_000);
  assert.equal(shortened.session.durationMs, MINUTE);
  assert.equal(shortened.session.id, selected.session.id);
  const running = transitionPomodoro(shortened, { type: 'timer', target: task }, config, 1_000_000);
  assert.throws(() => transitionPomodoro(running, { type: 'duration', minutes: 2 }, config, 1_010_000), /开始前/);
  const finished = advancePomodoro(running, 1_060_000);
  assert.equal(finished.records[0].mode, 'countdown');
  assert.equal(finished.records[0].outcome, 'completed');
  assert.equal(finished.cycle, 0);
  assert.equal(config.focusMinutes, 1);
});

test('active segments and actual duration exclude paused gaps and restore exactly', () => {
  const running = started();
  const paused = transitionPomodoro(running, { type: 'pause' }, config, 1_020_000);
  assert.equal(pomodoroElapsed(paused, 9_000_000), 20_000);
  assert.deepEqual(timerSegments(paused, 9_000_000), [{ start: 1_000_000, end: 1_020_000 }]);
  const resumed = transitionPomodoro(paused, { type: 'resume' }, config, 9_000_000);
  assert.equal(pomodoroElapsed(resumed, 9_005_000), 25_000);
  assert.deepEqual(timerSegments(resumed, 9_005_000), [
    { start: 1_000_000, end: 1_020_000 }, { start: 9_000_000, end: 9_005_000 },
  ]);
  const finished = normalizePomodoroState(JSON.parse(JSON.stringify(resumed)), config, 20_000_000);
  assert.equal(finished.records[0].durationMs, MINUTE);
  assert.deepEqual(finished.records[0].segments, [
    { start: 1_000_000, end: 1_020_000 }, { start: 9_000_000, end: 9_040_000 },
  ]);
  const restored = normalizePomodoroState(JSON.parse(JSON.stringify(finished)), config, 20_000_000);
  assert.deepEqual(restored.records, finished.records);
  assert.equal(restored.records.length, 1);
});

test('explicit stop records partial actual work once and does not credit a Pomodoro cycle', () => {
  const running = started();
  const paused = transitionPomodoro(running, { type: 'pause' }, config, 1_020_000);
  const resumed = transitionPomodoro(paused, { type: 'resume' }, config, 9_000_000);
  const stopped = transitionPomodoro(resumed, { type: 'stop' }, config, 9_005_000);
  assert.equal(stopped.session.status, 'finished');
  assert.equal(stopped.records[0].durationMs, 25_000);
  assert.equal(stopped.records[0].outcome, 'stopped');
  assert.equal(stopped.records[0].phase, 'focus');
  assert.equal(stopped.cycle, 0);
  assert.equal(transitionPomodoro(stopped, { type: 'stop' }, config, 9_006_000), stopped);
  const restored = normalizePomodoroState(stopped, config, 9_010_000);
  assert.equal(restored.records[0].durationMs, 25_000);
  const stoppedPaused = transitionPomodoro(paused, { type: 'stop' }, config, 9_000_000);
  assert.equal(stoppedPaused.records[0].completedAt, 1_020_000);
  assert.equal(stoppedPaused.records[0].durationMs, 20_000);
});

test('stopwatch counts active time across reload, never auto completes, and is bounded at seven days', () => {
  const idle = createPomodoroState(config, 1_000_000);
  const running = transitionPomodoro(idle, { type: 'timer', mode: 'stopwatch', target: task }, config, 1_000_000);
  assert.equal(running.session.deadline, undefined);
  assert.equal(pomodoroRemaining(running, 1_500_000), 0);
  const restored = normalizePomodoroState(JSON.parse(JSON.stringify(running)), config, 1_500_000);
  assert.equal(pomodoroElapsed(restored, 1_500_000), 500_000);
  assert.equal(restored.session.status, 'running');
  assert.equal(advancePomodoro(restored, 1_000_000 + MAX_TIMER_DURATION_MS * 2), restored);
  assert.equal(pomodoroElapsed(restored, 1_000_000 + MAX_TIMER_DURATION_MS * 2), MAX_TIMER_DURATION_MS);
  const stopped = transitionPomodoro(restored, { type: 'stop' }, config, 1_000_000 + MAX_TIMER_DURATION_MS * 2);
  assert.equal(stopped.records[0].durationMs, MAX_TIMER_DURATION_MS);
  assert.equal(stopped.records[0].mode, 'stopwatch');
  assert.equal(stopped.records[0].outcome, 'stopped');
  assert.equal(stopped.cycle, 0);
});

test('countdown adjustments add or remove remaining time without rewriting prior active intervals', () => {
  const running = transitionPomodoro(createPomodoroState(config, 1_000_000), { type: 'timer', mode: 'countdown', durationMinutes: 2 }, config, 1_000_000);
  const extended = transitionPomodoro(running, { type: 'adjust', minutes: 1 }, config, 1_030_000);
  assert.equal(pomodoroRemaining(extended, 1_030_000), 150_000);
  assert.equal(pomodoroElapsed(extended, 1_030_000), 30_000);
  assert.equal(extended.session.deadline, 1_180_000);
  assert.equal(extended.session.id, running.session.id);
  const paused = transitionPomodoro(extended, { type: 'pause' }, config, 1_040_000);
  const reduced = transitionPomodoro(paused, { type: 'adjust', minutes: -1 }, config, 9_000_000);
  assert.equal(reduced.session.status, 'paused');
  assert.equal(reduced.session.remainingMs, 80_000);
  assert.equal(pomodoroElapsed(reduced, 9_000_000), 40_000);
  assert.deepEqual(timerSegments(reduced, 9_000_000), [{ start: 1_000_000, end: 1_040_000 }]);
  const ended = transitionPomodoro(reduced, { type: 'adjust', minutes: -10 }, config, 9_000_000);
  assert.equal(ended.session.status, 'finished');
  assert.equal(ended.records[0].durationMs, 40_000);
  assert.equal(ended.records[0].outcome, 'completed');
  assert.equal(ended.cycle, 0);
  const stopwatch = transitionPomodoro(ended, { type: 'timer', mode: 'stopwatch' }, config, 9_000_000);
  assert.throws(() => transitionPomodoro(stopwatch, { type: 'adjust', minutes: 5 }, config, 9_010_000), /倒计时/);
});

test('active timer refuses mode, task, and linked calendar context changes without losing its state', () => {
  const linked = { title: '写作', eventId: 'event-a', calendarId: 'calendar-a', plannedStart: 1_000_000,
    plannedEnd: 1_120_000, plannedDurationMs: 120_000 };
  const running = transitionPomodoro(createPomodoroState(config, 1_000_000), { type: 'timer', target: linked, mode: 'countdown', durationMinutes: 2 }, config, 1_000_000);
  assert.deepEqual(running.session.target, linked);
  for (const status of [running, transitionPomodoro(running, { type: 'pause' }, config, 1_010_000)]) {
    assert.throws(() => transitionPomodoro(status, { type: 'select-mode', mode: 'stopwatch' }, config, 1_020_000), /切换模式/);
    assert.throws(() => transitionPomodoro(status, { type: 'timer', mode: 'stopwatch' }, config, 1_020_000), /另一种计时/);
    assert.throws(() => transitionPomodoro(status, { type: 'timer', target: { ...linked, eventId: 'event-b' } }, config, 1_020_000), /已有专注任务/);
    assert.throws(() => transitionPomodoro(status, { type: 'focus', target: task }, config, 1_020_000), /已有计时/);
  }
  assert.equal(transitionPomodoro(running, { type: 'timer', target: { ...linked }, mode: 'countdown', durationMinutes: 30 }, config, 1_020_000), running);
  assert.equal(running.session.durationMs, 120_000);
  assert.equal(running.records.length, 0);
});

test('legacy sessions gain Pomodoro mode and recover only known active time while legacy records stay accepted', () => {
  const legacy = JSON.parse(JSON.stringify(started()));
  delete legacy.session.mode;delete legacy.session.elapsedMs;delete legacy.session.segments;delete legacy.session.activeStartedAt;
  const recovered = normalizePomodoroState(legacy, config, 1_020_000);
  assert.equal(recovered.session.mode, 'pomodoro');
  assert.equal(recovered.session.id, legacy.session.id);
  assert.equal(pomodoroElapsed(recovered, 1_020_000), 20_000);
  assert.deepEqual(timerSegments(recovered, 1_020_000), [{ start: 1_000_000, end: 1_020_000 }]);
  const legacyPaused = { ...legacy, session: { ...legacy.session, status: 'paused', remainingMs: 40_000, deadline: undefined },
    records: [{ id: 'legacy', startedAt: 100_000, completedAt: 4_000_000, durationMs: MINUTE }] };
  const paused = normalizePomodoroState(legacyPaused, config, 9_000_000);
  assert.equal(pomodoroElapsed(paused, 9_000_000), 20_000);
  assert.equal(paused.records[0].mode, undefined);
  assert.equal(paused.records[0].durationMs, MINUTE);
});

test('malformed active intervals are finite, nonoverlapping, capped and bounded in persisted state', () => {
  const raw = { ...started(), session: { ...started().session, status: 'paused', elapsedMs: Infinity,
    segments: [{ start: 1_000_000, end: 1_010_000 }, { start: 1_005_000, end: 1_015_000 },
      { start: NaN, end: Infinity }, { start: 2_000_000, end: 1_000_000 }] } };
  const normalized = normalizePomodoroState(raw, config, 3_000_000);
  assert.deepEqual(timerSegments(normalized, 3_000_000), [{ start: 1_000_000, end: 1_015_000 }]);
  assert.equal(pomodoroElapsed(normalized, 3_000_000), 15_000);
  const many = Array.from({ length: MAX_TIMER_SEGMENTS }, (_, i) => ({ start: 1_000_000 + i * 2000, end: 1_001_000 + i * 2000 }));
  const full = normalizePomodoroState({ ...raw, session: { ...raw.session, mode: 'stopwatch', segments: many } }, config, 5_000_000);
  assert.equal(timerSegments(full, 5_000_000).length, MAX_TIMER_SEGMENTS);
  assert.throws(() => transitionPomodoro(full, { type: 'resume' }, config, 5_000_000), /暂停次数/);
});

test('corrupt current intervals recover paused instead of overlapping or dropping closed work', () => {
  const stopwatch = transitionPomodoro(createPomodoroState(config, 1_000_000), { type: 'timer', mode: 'stopwatch' }, config, 1_000_000);
  const overlapping = normalizePomodoroState({ ...stopwatch, session: { ...stopwatch.session,
    segments: [{ start: 1_000_000, end: 1_010_000 }], activeStartedAt: 1_005_000, elapsedMs: 500_000 } }, config, 1_020_000);
  assert.equal(overlapping.session.status, 'paused');
  assert.equal(pomodoroElapsed(overlapping, 1_020_000), 10_000);
  assert.deepEqual(timerSegments(overlapping, 1_020_000), [{ start: 1_000_000, end: 1_010_000 }]);
  const future = normalizePomodoroState({ ...stopwatch, session: { ...stopwatch.session,
    segments: [{ start: 1_000_000, end: 1_030_000 }, { start: 2_000_000, end: 3_000_000 }], activeStartedAt: 1_000_000 } }, config, 1_020_000);
  assert.equal(future.session.status, 'paused');
  assert.equal(pomodoroElapsed(future, 1_020_000), 20_000);
  const many = Array.from({ length: MAX_TIMER_SEGMENTS }, (_, i) => ({ start: 1_000_000 + i * 2000, end: 1_001_000 + i * 2000 }));
  const fullRunning = normalizePomodoroState({ ...stopwatch, session: { ...stopwatch.session,
    segments: many, activeStartedAt: 2_000_000 } }, config, 2_005_000);
  assert.equal(fullRunning.session.status, 'paused');
  assert.equal(timerSegments(fullRunning, 2_005_000).length, MAX_TIMER_SEGMENTS);
  assert.deepEqual(timerSegments(fullRunning, 2_005_000)[0], many[0]);
  assert.equal(pomodoroElapsed(fullRunning, 2_005_000), 500_000);
});

test('stopping immediately creates no zero-use work record', () => {
  const stopwatch = transitionPomodoro(createPomodoroState(config, 1_000_000), { type: 'timer', mode: 'stopwatch' }, config, 1_000_000);
  const stopped = transitionPomodoro(stopwatch, { type: 'stop' }, config, 1_000_000);
  assert.equal(stopped.session.status, 'finished');
  assert.equal(stopped.records.length, 0);
  assert.equal(stopped.cycle, 0);
});

test('persisted new records reject zero-use intervals and impossible durations for their mode', () => {
  const base = { startedAt: 0, completedAt: MAX_TIMER_DURATION_MS, outcome: 'stopped' };
  const state = normalizePomodoroState({ records: [
    { ...base, id: 'zero', mode: 'stopwatch', durationMs: 1000, segments: [{ start: 1, end: 1 }] },
    { ...base, id: 'long-countdown', mode: 'countdown', durationMs: 2 * 1440 * MINUTE },
    { ...base, id: 'long-pomodoro', mode: 'pomodoro', durationMs: 181 * MINUTE },
    { ...base, id: 'valid-stopwatch', mode: 'stopwatch', durationMs: 2 * 1440 * MINUTE },
  ] }, config, MAX_TIMER_DURATION_MS);
  assert.deepEqual(state.records.map(record => record.id), ['valid-stopwatch']);
});

test('stopping the fifth focus cannot consume the previous completed-cycle long break', () => {
  let now = 1_000_000;
  let state = started(now);
  for (let focus = 1; focus <= 4; focus++) {
    now += MINUTE;
    state = advancePomodoro(state, now);
    if (focus < 4) state = transitionPomodoro(state, { type: 'focus' }, config, now);
  }
  assert.equal(state.cycle, 4);
  assert.equal(transitionPomodoro(state, { type: 'start' }, config, now).session.phase, 'long-break');
  for (const elapsed of [0, 10_000]) {
    const fifth = transitionPomodoro(state, { type: 'focus' }, config, now);
    const stopped = transitionPomodoro(fifth, { type: 'stop' }, config, now + elapsed);
    assert.equal(stopped.session.outcome, 'stopped');
    assert.equal(stopped.cycle, 4);
    const restored = normalizePomodoroState(JSON.parse(JSON.stringify(stopped)), config, now + elapsed);
    for (const type of ['start', 'next'] as const) {
      assert.equal(transitionPomodoro(restored, { type }, config, now + elapsed).session.phase, 'short-break');
    }
  }
});

test('legacy synthesized active intervals retain their estimation flag through resume, completion and reload', () => {
  const legacy = { session: { id: 'legacy-paused', phase: 'focus', status: 'paused', durationMs: MINUTE,
    remainingMs: 40_000, startedAt: 1_000_000 }, cycle: 0, records: [] };
  const normalized = normalizePomodoroState(legacy, config, 2_000_000);
  assert.equal(normalized.session.segmentsEstimated, true);
  const restored = normalizePomodoroState(JSON.parse(JSON.stringify(normalized)), config, 2_000_000);
  const resumed = transitionPomodoro(restored, { type: 'resume' }, config, 2_000_000);
  const finished = advancePomodoro(resumed, 2_040_000);
  assert.equal(finished.records[0].segmentsEstimated, true);
  assert.equal(finished.records[0].durationMs, MINUTE);
  assert.deepEqual(finished.records[0].segments, [
    { start: 1_000_000, end: 1_020_000 }, { start: 2_000_000, end: 2_040_000 },
  ]);
  assert.equal(normalizePomodoroState(JSON.parse(JSON.stringify(finished)), config, 2_040_000).records[0].segmentsEstimated, true);
  const precise = advancePomodoro(started(), 1_060_000);
  assert.equal(precise.records[0].segmentsEstimated, undefined);
});
