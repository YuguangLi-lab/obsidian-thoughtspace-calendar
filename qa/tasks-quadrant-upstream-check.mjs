/**
 * Reproducible contract check against an explicitly supplied official Tasks bundle.
 *
 * TASKS_PLUGIN_MAIN=/absolute/path/to/tasks/main.js \
 *   node qa/tasks-quadrant-upstream-check.mjs > /tmp/tasks-upstream-report.json
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
const localModule = {exports: {}};
const localCode = buildSync({
  stdin: {contents: "export {tasksToggleLines} from './tasks-integration'; export {planTasks} from './task-planner-model'; export {quadrantOverride} from './task-quadrants';", resolveDir: fileURLToPath(new URL('../src', import.meta.url)), loader: 'ts'},
  bundle: true, write: false, format: 'cjs', platform: 'node',
}).outputFiles[0].text;
new Function('module', 'exports', localCode)(localModule, localModule.exports);
const {tasksToggleLines, planTasks, quadrantOverride} = localModule.exports;

async function apiFor(settings = {}) {
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
  return api;
}

const checks = [];
for (const fixture of [
 {name:'nested-four-space-repeat',prefix:'- [ ] Parent\n',source:'    - [ ] Read 🔁 every day 📅 2026-10-11 ^read'},
 {name:'nested-tab-repeat',prefix:'- [ ] Parent\n',source:'\t- [ ] Read 🔁 every day 📅 2026-10-11 ^read'},
 {name:'nested-quoted-repeat',prefix:'> - [ ] Parent\n',source:'>     - [ ] Read 🔁 every day 📅 2026-10-11 ^read'},
 {name:'legacy-quadrant-with-dual-dates',source:'- [ ] 09:00 Read 🔁 every day ⏳ 2026-10-10 📅 2026-10-11 <!-- thoughtspace:quadrant=q2 --> ^read'},
 {name:'new-quadrant-between-description-and-metadata',source:'- [ ] 09:00 Read <!-- thoughtspace:quadrant=q2 --> 🔁 every day ⏳ 2026-10-10 📅 2026-10-11 ^read'},
 {name:'legacy-quadrant-reopen-removes-completion',source:'- [x] Read 🔁 every day ⏳ 2026-10-10 📅 2026-10-11 ✅ 2026-10-11 <!-- thoughtspace:quadrant=q2 --> ^read'},
 {name:'dataview-quadrant-and-block-reference',source:'> 2. [ ] 09:15 Read (repeat:: every day) [scheduled:: 2026-10-11] (due:: 2026-10-12) <!-- thoughtspace:quadrant=q1 --> ^read',settings:{taskFormat:'dataview'}},
 {name:'dataview-quadrant-reopen-removes-completion',source:'- [x] Read [repeat:: every day] [due:: 2026-10-11] [completion:: 2026-10-11] <!-- thoughtspace:quadrant=q2 --> ^read',settings:{taskFormat:'dataview'}},
 {name:'literal-marker-in-code-not-relocated',source:'- [ ] Read `<!-- thoughtspace:quadrant=q3 -->` 🔁 every day 📅 2026-10-11 ^read'},
 {name:'undated-repeat-retains-quadrant',source:'- [ ] Read 🔁 every day <!-- thoughtspace:quadrant=q2 --> ^read'},
]) {
 const api = await apiFor(fixture.settings);
 const planned = planTasks((fixture.prefix||'')+fixture.source,'Contract-fixture.md','Journal').at(-1);
 const raw = api.executeToggleTaskDoneCommand(fixture.source,planned.path);
 const corrected = tasksToggleLines(api, planned);
 const parsed = planTasks((fixture.prefix||'')+corrected.join('\n'),planned.path,'Journal').slice(fixture.prefix ? 1 : 0);
 assert.equal(parsed.length,planned.checked?1:2);
 assert.equal(parsed.filter(t=>t.checked).length,planned.checked?0:1);
 assert.equal(corrected.filter(t=>t.endsWith(' ^read')).length,1);
 if(planned.checked)assert.equal(parsed[0].completedOn,undefined);
 const quadrant=quadrantOverride(fixture.source);
 if(quadrant)for(const task of parsed)assert.equal(quadrantOverride(task.text),quadrant);
 if(fixture.name==='literal-marker-in-code-not-relocated')assert.equal(corrected.join('\n'),raw);
 checks.push({name:fixture.name,passed:true,source:fixture.source,rawOutput:raw,correctedOutput:corrected.join('\n')});
}
console.log(JSON.stringify({reference:'Tasks 8.5.0 official API',referenceUrl:'https://github.com/obsidian-tasks-group/obsidian-tasks/releases/tag/8.5.0',clock:'2026-10-11T12:00:00+08:00',bundleSha256:createHash('sha256').update(code).digest('hex'),tests:checks.length,passed:checks.length,results:checks},null,2));
