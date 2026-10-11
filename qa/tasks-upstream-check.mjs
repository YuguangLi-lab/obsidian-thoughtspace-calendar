/**
 * Reproducible contract check against an explicitly supplied official Tasks bundle.
 *
 * TASKS_PLUGIN_MAIN=/absolute/path/to/tasks/main.js \
 *   node qa/tasks-upstream-check.mjs > /tmp/tasks-upstream-report.json
 *
 * The reference fixture is the unmodified Tasks 8.5.0 release main.js. This script
 * never downloads a plugin, opens a vault, invokes plugin.onload(), or writes notes.
 * Only the real public toggle API and its settings initializer run in an isolated
 * VM; Obsidian's UI classes are inert stubs. The bundle path is mandatory.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {buildSync} from 'esbuild';

const path = process.env.TASKS_PLUGIN_MAIN;
if (!path) throw new Error('Set TASKS_PLUGIN_MAIN to an explicitly downloaded official Tasks main.js.');
const code = readFileSync(path, 'utf8');
const require = createRequire(import.meta.url);
process.env.TZ = 'Asia/Shanghai';
const moment = require('moment');
const now = Date.parse('2026-10-11T12:00:00+08:00');
moment.now = () => now;
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
  static [Symbol.hasInstance](value) { return value instanceof Date; }
}
const source = '- [ ] Read 🔁 every day 📅 2026-10-11 ^read';
const next = '- [ ] Read 🔁 every day 📅 2026-10-12';
const done = '- [x] Read 🔁 every day 📅 2026-10-11 ✅ 2026-10-11 ^read';
const localModule = {exports: {}};
const localCode = buildSync({
  stdin: {contents: "export {tasksToggleLines} from './tasks-integration'; export {planTasks} from './task-planner-model';", resolveDir: fileURLToPath(new URL('../src', import.meta.url)), loader: 'ts'},
  bundle: true, write: false, format: 'cjs', platform: 'node',
}).outputFiles[0].text;
new Function('module', 'exports', localCode)(localModule, localModule.exports);
const {tasksToggleLines, planTasks} = localModule.exports;

async function toggle(line, settings = {}) {
  class InertUI {}
  class Plugin {
    constructor(app) { this.app = app; }
    async loadData() { return structuredClone(settings); }
  }
  const obsidian = new Proxy({Plugin, getLanguage: () => 'en', requireApiVersion: () => true}, {
    get: (target, key) => key in target ? target[key] : InertUI,
  });
  const module = {exports: {}};
  const navigator = {language: 'en', userAgent: 'Tasks isolated contract check'};
  const document = {documentElement: {lang: 'en'}, createElement: () => ({})};
  const context = {
    module, exports: module.exports,
    require: id => {
      if (id === 'obsidian') return obsidian;
      if (id === '@codemirror/view') return require(id);
      throw new Error(`Unexpected upstream module: ${id}`);
    },
    // Keep stdout valid JSON; any unexpected upstream diagnostic is separate.
    console: {...console, log: (...args) => console.error(...args)},
    window: {moment, navigator, document}, moment, navigator, document,
    Date: FixedDate, Intl, URL, URLSearchParams, TextEncoder, TextDecoder,
    setTimeout, clearTimeout, setInterval, clearInterval,
    localStorage: {getItem: () => null},
  };
  vm.runInNewContext(code, context, {filename: 'tasks-official-main.js', timeout: 20_000});
  const plugin = new module.exports.default({});
  await plugin.loadSettings();
  const api = plugin.apiV1;
  assert.equal(typeof api.executeToggleTaskDoneCommand, 'function');
  return api.executeToggleTaskDoneCommand(line, 'Contract-fixture.md');
}

const fixtures = [
  {name: 'daily-repeat-and-block-id', line: source, expected: `${next}\n${done}`},
  {name: 'undated-repeat-next-line-is-identical-to-source', line: '- [ ] Read 🔁 every day',
    expected: '- [ ] Read 🔁 every day\n- [x] Read 🔁 every day ✅ 2026-10-11', nextEqualsSource: true},
  {name: 'weekday-friday-to-monday', line: '- [ ] Work 🔁 every weekday 📅 2026-10-09',
    expected: '- [ ] Work 🔁 every weekday 📅 2026-10-12\n- [x] Work 🔁 every weekday 📅 2026-10-09 ✅ 2026-10-11'},
  {name: 'repeat-relative-to-completion', line: source.replace('every day', 'every day when done').replace('2026-10-11', '2026-10-01'),
    expected: `${next.replace('every day', 'every day when done')}\n${done.replace('every day', 'every day when done').replace('📅 2026-10-11', '📅 2026-10-01')}`},
  {name: 'global-filter-missing-falls-back-to-checkbox-only', settings: {globalFilter: '#task'}, line: source,
    expected: source.replace('[ ]', '[x]')},
  {name: 'global-filter-matching-generates-next', settings: {globalFilter: '#task'}, line: source.replace('Read', 'Read #task'),
    expected: `${next.replace('Read', 'Read #task')}\n${done.replace('Read', 'Read #task')}`},
  {name: 'done-date-disabled-still-repeats', settings: {setDoneDate: false}, line: source,
    expected: `${next}\n${done.replace(' ✅ 2026-10-11', '')}`},
  {name: 'recurrence-order-setting', settings: {recurrenceOnNextLine: true}, line: source,
    expected: `${done}\n${next}`},
  {name: 'invalid-recurrence-is-removed-by-upstream', line: source.replace('every day', 'glorp'),
    expected: done.replace(' 🔁 every day', '')},
  {name: 'ended-recurrence-legitimately-returns-one-line', line: source.replace('every day', 'every day until 2026-10-11'),
    expected: done.replace('every day', 'every day until 2026-10-11')},
  {name: 'ended-recurrence-without-done-date-is-ambiguous', settings: {setDoneDate: false},
    line: source.replace('every day', 'every day until 2026-10-11'),
    expected: source.replace('[ ]', '[x]').replace('every day', 'every day until 2026-10-11')},
  {name: 'missing-filter-with-ended-rule-produces-identical-output', settings: {globalFilter: '#task', setDoneDate: false},
    line: source.replace('every day', 'every day until 2026-10-11'),
    expected: source.replace('[ ]', '[x]').replace('every day', 'every day until 2026-10-11')},
  {name: 'reopen-done-task-does-not-generate-next', line: done, expected: source},
  {name: 'callout-prefix-preserved', line: `> ${source}`, expected: `> ${next}\n> ${done}`},
  {name: 'nested-callout-prefix-preserved', line: `> > ${source}`, expected: `> > ${next}\n> > ${done}`},
  {name: 'ordered-list-prefix-preserved', line: source.replace('- ', '1. '),
    expected: `${next.replace('- ', '1. ')}\n${done.replace('- ', '1. ')}`},
  {name: 'dataview-format-and-block-id', settings: {taskFormat: 'dataview'},
    line: '- [ ] Read [repeat:: every day] [due:: 2026-10-11] ^read',
    expected: '- [ ] Read  [repeat:: every day]  [due:: 2026-10-12]\n- [x] Read  [repeat:: every day]  [due:: 2026-10-11]  [completion:: 2026-10-11] ^read'},
  {name: 'dataview-reopen-removes-completion', settings: {taskFormat: 'dataview'},
    line: '- [x] Read [repeat:: every day] [due:: 2026-10-11] [completion:: 2026-10-11] ^read',
    expected: '- [ ] Read  [repeat:: every day]  [due:: 2026-10-11] ^read'},
  {name: 'dataview-round-brackets', settings: {taskFormat: 'dataview'},
    line: '- [ ] Read (repeat:: every day) (due:: 2026-10-11) ^read',
    expected: '- [ ] Read  [repeat:: every day]  [due:: 2026-10-12]\n- [x] Read  [repeat:: every day]  [due:: 2026-10-11]  [completion:: 2026-10-11] ^read'},
];

const results = [];
for (const fixture of fixtures) {
  try {
    const actual = await toggle(fixture.line, fixture.settings);
    assert.equal(actual, fixture.expected);
    if (fixture.nextEqualsSource) assert.equal(actual.split('\n')[0], fixture.line);
    const task = planTasks(fixture.line, 'Contract-fixture.md', 'Journal')[0];
    assert.equal(task.recurring, true, 'Local task parser must recognize the recurring task');
    const api = {executeToggleTaskDoneCommand: () => actual};
    const shouldReject = !task.checked && !actual.includes('\n');
    let bridge;
    if (shouldReject) {
      assert.throws(() => tasksToggleLines(api, task), /Tasks 未生成下一次任务/);
      bridge = 'safely-rejected-before-write';
    } else {
      assert.deepEqual(tasksToggleLines(api, task), actual.split('\n'));
      bridge = 'accepted-unchanged';
    }
    results.push({name: fixture.name, passed: true, settings: fixture.settings || {}, source: fixture.line, actual, bridge,
      ...(fixture.nextEqualsSource ? {nextEqualsSource: true, note: 'Exact source-line checks alone cannot reject a duplicate completion of this unchanged next occurrence.'} : {})});
  } catch (error) {
    results.push({name: fixture.name, passed: false, error: String(error.stack || error)});
  }
}
const report = {
  referenceRelease: '8.5.0',
  referenceUrl: 'https://github.com/obsidian-tasks-group/obsidian-tasks/releases/tag/8.5.0',
  bundlePath: path,
  bundleSha256: createHash('sha256').update(code).digest('hex'),
  clock: '2026-10-11T12:00:00+08:00',
  tests: results.length,
  passed: results.filter(result => result.passed).length,
  bridgeVerified: true,
  limitations: ['Only the real toggle API is exercised; UI, plugin startup, vault persistence, and custom statuses are not tested.',
    'One-line output after recurrence end and with setDoneDate disabled is indistinguishable from a plain-checkbox fallback using this public API alone.'],
  results,
};
console.log(JSON.stringify(report, null, 2));
if (report.passed !== report.tests) process.exitCode = 1;
