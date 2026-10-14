import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import postcss from 'postcss';

const qaRequire = createRequire(path.resolve(process.env.QA_DEPENDENCIES || '.', 'package.json'));
let playwright;
try { playwright = qaRequire('@playwright/test'); }
catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; playwright = qaRequire('playwright'); }
const {chromium} = playwright;
const out = 'qa/pomodoro-strip-output'; mkdirSync(out, {recursive: true});
await build({entryPoints: ['qa/pomodoro-strip-preview.ts'], bundle: true, format: 'esm', outfile: out + '/preview.js',
  alias: {obsidian: path.resolve('qa/pomodoro-strip-obsidian-stub.ts')}, platform: 'browser'});
const existingCss = postcss.parse(readFileSync('styles.css', 'utf8'));
existingCss.walkRules(rule => { if (rule.selector.includes('ts-calendar-pomodoro-strip')) rule.remove(); });
const css = existingCss.toString() + '\n' + readFileSync('src/pomodoro.css', 'utf8');
const stripCss = readFileSync('src/pomodoro-strip.css', 'utf8');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
:root{--font-interface:system-ui;--font-monospace:ui-monospace,monospace;--interactive-accent:#376f6c;--background-primary:#fff;--background-secondary:#f5f7f7;--text-normal:#243331;--text-muted:#6b7976;--text-faint:#81908c;--text-on-accent:white;--text-error:#a92d38;--color-green:#36745f;--background-modifier-border:#dce4e1;--background-modifier-hover:#eaf0ec;--text-accent:#376f6c}
body.theme-dark{--background-primary:#202625;--background-secondary:#282e2c;--text-normal:#e2e8e5;--text-muted:#a8b8b1;--text-faint:#8b9b94;--background-modifier-border:#3c4943;--text-on-accent:#202625;--interactive-accent:#9abfaf}
*{box-sizing:border-box}body{margin:0;background:var(--background-primary);color:var(--text-normal);font-family:var(--font-interface)}.host{width:230px;margin:16px}#full{width:280px;margin:16px}button,input{font:inherit;border:1px solid var(--background-modifier-border);border-radius:6px;background:var(--background-primary);color:inherit;padding:7px}button{cursor:pointer}button:focus-visible{outline:2px solid var(--interactive-accent);outline-offset:2px}button:disabled{opacity:.5}
${css}</style><style id="strip-style">${stripCss}</style></head><body class="theme-light"><div id="first" class="host"></div><div id="second" class="host"></div><div id="showcase" class="host"></div><div id="full"></div><script type="module" src="/preview.js"></script></body></html>`;
writeFileSync(out + '/index.html', html);
const server = createServer((req, res) => { res.setHeader('Content-Type', req.url === '/preview.js' ? 'application/javascript' : 'text/html'); res.end(req.url === '/preview.js' ? readFileSync(out + '/preview.js') : html); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({...(process.env.CHROME_EXECUTABLE ? {executablePath: process.env.CHROME_EXECUTABLE} : {}), headless: true});
const page = await browser.newPage({viewport: {width: 520, height: 1050}});
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
const root = page.locator('#first');
const panelRoot = page.locator('#showcase');
const panelButton = name => panelRoot.getByRole('button', {name, exact: true});
const button = name => root.getByRole('button', {name, exact: true});
const state = () => page.evaluate(() => window.qaStrip.state());
const advance = ms => page.evaluate(ms => window.qaStrip.advance(ms), ms);
const ready = () => page.waitForFunction(() => !window.qaStrip.state().busy && document.querySelector('#first .ts-calendar-pomodoro-strip').getAttribute('aria-busy') === 'false');
const check = label => checks.push(label);
const clock = () => root.locator('.ts-calendar-pomodoro-strip-clock').textContent();
const panelClock = () => panelRoot.locator('.ts-calendar-pomodoro-strip-clock').textContent();
async function layout(theme, width, suffix, expanded = suffix !== 'running') {
  await page.evaluate(({theme, width}) => { document.body.className = 'theme-' + theme; for (const host of document.querySelectorAll('.host')) host.style.width = width + 'px'; }, {theme, width});
  const geometry = await root.evaluate(host => {
    const strip = host.firstElementChild, rect = strip.getBoundingClientRect();
    return {overflow: host.scrollWidth > host.getBoundingClientRect().width + 1 || strip.scrollWidth > rect.width + 1,
      height: rect.height, controls: [...strip.querySelectorAll('button')].filter(button => button.getBoundingClientRect().width).every(button => { const r = button.getBoundingClientRect(); return r.left >= rect.left && r.right <= rect.right + 1; })};
  });
  assert.equal(geometry.overflow, false); assert.equal(geometry.controls, true); assert(geometry.height <= 61);
  assert(expanded ? geometry.height >= 58 : geometry.height <= 40);
  assert.equal(await root.locator('.ts-calendar-pomodoro-strip-feedback').getAttribute('data-expanded'), String(expanded));
  await root.screenshot({path: `${out}/${theme}-${width}-${suffix}.png`});
  check(`${theme} ${width}px ${suffix} fits ${expanded ? 'two short rows' : 'one compact row'}`);
}

async function panelLayout(theme, width, suffix, feedback = false) {
  await page.evaluate(({theme, width}) => { document.body.className = 'theme-' + theme; for (const host of document.querySelectorAll('.host')) host.style.width = width + 'px'; }, {theme, width});
  const geometry = await panelRoot.evaluate(host => {
    const strip = host.firstElementChild, rect = strip.getBoundingClientRect(), clock = strip.querySelector('.ts-calendar-pomodoro-strip-clock');
    return {height: rect.height, font: parseFloat(getComputedStyle(clock).fontSize), hours: clock.dataset.hours === 'true',
      overflow: strip.scrollWidth > rect.width + 1 || clock.scrollWidth > clock.clientWidth + 1,
      primary: strip.querySelector('.ts-calendar-pomodoro-strip-primary').getBoundingClientRect().height,
      controls: [...strip.querySelectorAll('button')].filter(button => button.getBoundingClientRect().width).every(button => { const r = button.getBoundingClientRect(); return r.left >= rect.left && r.right <= rect.right + 1; })};
  });
  assert.equal(geometry.overflow, false); assert.equal(geometry.controls, true);
  assert(geometry.height >= 200 && geometry.height <= (feedback ? 310 : 270));
  assert(geometry.font >= (geometry.hours ? 32 : 42)); assert(geometry.primary >= 36);
  await panelRoot.screenshot({path: `${out}/${theme}-${width}-panel-${suffix}.png`});
  check(`${theme} ${width}px panel ${suffix} keeps a generous clock, arc and primary action inside its height budget`);
}

try {
  await page.goto(`http://127.0.0.1:${server.address().port}`); await ready();
  assert.equal(await clock(), '25:00'); assert.equal(await root.locator('.ts-calendar-pomodoro-strip-title').textContent(), '番茄专注');
  assert.equal(await page.evaluate(() => window.qaStrip.subscriptions()), 4); check('two compact strips, a timer panel and the independent timer share the controller subscription');
  for (const theme of ['light', 'dark']) for (const width of [230, 280, 420]) await layout(theme, width, 'idle', false);
  for (const theme of ['light', 'dark']) for (const width of [230, 280, 420]) await panelLayout(theme, width, 'idle');
  assert.equal(await panelRoot.locator('.ts-calendar-pomodoro-strip-title').textContent(), '自由专注');
  check('unassigned panel focus uses a clear free-focus caption');
  assert.equal(await root.locator('.ts-calendar-pomodoro-strip-status').getAttribute('aria-live'), 'polite');
  assert.equal(await root.locator('.ts-calendar-pomodoro-strip-feedback').evaluate(el => getComputedStyle(el).clipPath), 'inset(50%)');
  check('healthy status remains accessible through live text and tooltip without taking a visible row');
  await button('开始专注').click(); await ready();
  await button('暂停').focus();
  await page.evaluate(() => { window.clockNode = document.querySelector('#first .ts-calendar-pomodoro-strip-clock'); window.primaryNode = document.activeElement; window.rootNode = document.querySelector('#first .ts-calendar-pomodoro-strip'); window.rootMutations = []; window.observer = new MutationObserver(records => window.rootMutations.push(...records.map(record => ({type: record.type, cls: record.target.className})))); window.observer.observe(window.rootNode, {subtree: true, childList: true, attributes: true, characterData: true}); });
  const beforeWrites = await page.evaluate(() => window.qaStrip.writes()); await advance(10_000);
  assert.equal(await clock(), '24:50'); assert.equal(await page.evaluate(() => document.querySelector('#first .ts-calendar-pomodoro-strip-clock') === window.clockNode && document.querySelector('#first .ts-calendar-pomodoro-strip') === window.rootNode && document.activeElement === window.primaryNode), true);
  assert.equal(await page.evaluate(() => window.qaStrip.writes()), beforeWrites);
  assert.equal(await page.evaluate(() => { window.observer.disconnect(); return window.rootMutations.every(record => String(record.cls).includes('strip-clock') || String(record.cls).includes('strip-progress')); }), true);
  assert.equal(await page.locator('#second .ts-calendar-pomodoro-strip-clock').textContent(), '24:50'); check('ticks mutate only clock/progress, keep keyboard focus and DOM nodes, and do not persist');
  assert.equal(await panelClock(), '24:50'); check('panel clock tracks compact clock through the same controller');
  await button('暂停').click(); await ready(); await advance(60_000); assert.equal(await clock(), '24:50');
  await button('继续').click(); await ready(); await advance(24 * 60_000 + 50_000); await ready();
  assert.equal((await state()).state.records.length, 1); assert.equal((await state()).state.session.status, 'finished');
  assert.match(await root.locator('.ts-calendar-pomodoro-strip-status').textContent(), /开始短休息/);
  await layout('light', 230, 'focus-finished', true);
  await button('开始休息').click(); await ready(); assert.equal((await state()).state.session.phase, 'short-break');
  await advance(5 * 60_000); await button('开始专注').click(); await ready(); check('pause excludes elapsed time and completed focus starts the existing short-break transition');
  for (let cycle = 2; cycle <= 4; cycle++) {
    await advance(25 * 60_000); await ready();
    if (cycle === 4) {
      assert.match(await root.locator('.ts-calendar-pomodoro-strip-status').textContent(), /开始长休息/);
      assert.equal(await panelClock(), '15:00'); assert.equal(await panelRoot.locator('.ts-calendar-pomodoro-strip-panel-phase').textContent(), '长休息');
      check('completed fourth focus previews the long break that the primary action will start');
    }
    await button('开始休息').click(); await ready();
    assert.equal((await state()).state.session.phase, cycle === 4 ? 'long-break' : 'short-break');
    if (cycle < 4) { await advance(5 * 60_000); await button('开始专注').click(); await ready(); }
  }
  check('four focus cycles keep the existing long-break cadence');
  await advance(15 * 60_000); await ready();
  await page.evaluate(() => window.qaStrip.controller.selectMode('countdown', 15)); await ready();
  assert.equal((await state()).state.session.mode, 'countdown'); assert.equal((await state()).state.session.durationMs, 15 * 60_000);
  assert.equal(await clock(), '25:00'); assert.equal(await root.locator('.ts-calendar-pomodoro-strip-title').textContent(), '番茄专注');
  assert.equal(await root.locator('.ts-calendar-pomodoro-strip').getAttribute('title'), '番茄专注 · 准备番茄专注');
  assert.equal(await panelRoot.locator('.ts-calendar-pomodoro-strip-panel-caption').textContent(), '准备开始');
  check('idle countdown presents Pomodoro focus and its preset without changing the stored countdown');
  await page.evaluate(() => window.qaStrip.controller.selectMode('stopwatch')); await ready();
  assert.equal(await clock(), '25:00'); assert.equal(await root.locator('.ts-calendar-pomodoro-strip-title').textContent(), '番茄专注');
  await page.evaluate(() => window.qaStrip.focusMinutes(17)); assert.equal(await clock(), '17:00');
  await layout('dark', 230, 'idle-stopwatch', false);
  await page.evaluate(() => window.qaStrip.focusMinutes(25));
  check('idle stopwatch displays the configured focus preset and updates it when the configuration changes');
  await button('开始番茄专注').click(); await ready(); assert.equal((await state()).state.session.mode, 'pomodoro'); check('idle non-Pomodoro starts a fresh Pomodoro focus');
  await advance(1_000); await page.evaluate(() => window.qaStrip.controller.stop()); await ready();
  assert.equal(await panelClock(), '05:00'); assert.equal(await panelRoot.locator('.ts-calendar-pomodoro-strip-panel-phase').textContent(), '短休息');
  assert.equal(await panelRoot.locator('.ts-calendar-pomodoro-strip-title').textContent(), '休息片刻');
  assert.match(await root.locator('.ts-calendar-pomodoro-strip-status').textContent(), /开始短休息/);
  await panelButton('开始短休息').click(); await ready(); assert.equal((await state()).state.session.phase, 'short-break');
  await panelButton('暂停').click(); await ready(); assert.equal((await state()).state.session.status, 'paused');
  await button('继续').click(); await ready(); await advance(1_000); await page.evaluate(() => window.qaStrip.controller.stop()); await ready();
  assert.equal(await panelClock(), '25:00'); assert.equal(await panelRoot.locator('.ts-calendar-pomodoro-strip-panel-phase').textContent(), '番茄专注');
  check('stopped fourth-cycle focus previews short break; shared panel and compact actions preserve the real next stage');
  await page.evaluate(() => window.qaStrip.controller.startTimer({title: '整理临床研究数据和非常长的事项名称，保持侧栏可读'}, 'countdown', 15)); await ready(); await advance(10_000);
  await button('暂停').click(); await ready(); assert.equal((await state()).state.session.mode, 'countdown');
  assert.match(await root.locator('.ts-calendar-pomodoro-strip-status').textContent(), /倒计时 · 已暂停/);
  for (const theme of ['light', 'dark']) for (const width of [230, 280, 420]) await panelLayout(theme, width, 'paused-countdown');
  await panelButton('继续').click(); await ready(); assert.equal((await state()).state.session.mode, 'countdown');
  await advance(14 * 60_000 + 50_000); await ready();
  assert.equal(await clock(), '25:00'); assert.equal(await root.locator('.ts-calendar-pomodoro-strip-title').textContent(), '番茄专注');
  assert.equal((await state()).state.session.mode, 'countdown');
  await layout('light', 230, 'countdown-finished', false);
  check('finished countdown presents the focus action rather than an exhausted countdown');
  await button('开始番茄专注').click(); await ready(); assert.equal((await state()).state.session.mode, 'pomodoro'); check('active countdown remains countdown through pause/resume; finished countdown starts Pomodoro');
  await advance(1_000); await page.evaluate(() => window.qaStrip.controller.stop());
  await page.evaluate(() => window.qaStrip.controller.startTimer({title: '整理临床研究数据和非常长的事项名称，保持侧栏可读'}, 'stopwatch')); await ready(); await advance(3_620_000);
  assert.equal(await clock(), '01:00:20'); assert.match(await root.locator('.ts-calendar-pomodoro-strip-status').textContent(), /正计时 · 累计用时/);
  await panelButton('暂停').focus();
  await panelRoot.evaluate(host => { window.panelClockNode = host.querySelector('.ts-calendar-pomodoro-strip-clock'); window.panelPrimaryNode = document.activeElement; window.panelRootNode = host.firstElementChild; window.panelMutations = []; window.panelObserver = new MutationObserver(records => window.panelMutations.push(...records.map(record => record.target.getAttribute?.('class') || ''))); window.panelObserver.observe(window.panelRootNode, {subtree: true, childList: true, attributes: true, characterData: true}); });
  const panelWrites = await page.evaluate(() => window.qaStrip.writes()); await advance(1_000);
  assert.equal(await panelClock(), '01:00:21'); assert.equal(await page.evaluate(() => document.querySelector('#showcase .ts-calendar-pomodoro-strip-clock') === window.panelClockNode && document.activeElement === window.panelPrimaryNode), true);
  assert.equal(await page.evaluate(() => { window.panelObserver.disconnect(); return window.panelMutations.every(cls => cls.includes('strip-clock') || cls.includes('strip-progress')); }), true);
  assert.equal(await page.evaluate(() => window.qaStrip.writes()), panelWrites); check('panel ticks only clock and arc progress, preserving focused controls and storage');
  for (const theme of ['light', 'dark']) for (const width of [230, 280, 420]) await layout(theme, width, 'running');
  for (const theme of ['light', 'dark']) for (const width of [230, 280, 420]) await panelLayout(theme, width, 'running-stopwatch');
  await button('更多计时操作').click(); assert.equal(await button('结束并记录').isVisible(), true); assert.equal((await state()).state.session.status, 'running');
  await page.keyboard.press('Escape'); assert.equal(await button('结束并记录').isVisible(), false); assert.equal(await button('更多计时操作').evaluate(el => document.activeElement === el), true); check('stop requires an explicit second action, and Escape restores the disclosure focus');
  await button('更多计时操作').click();
  for (const theme of ['light', 'dark']) for (const width of [230, 280, 420]) await layout(theme, width, 'end-menu');
  await page.evaluate(() => window.qaStrip.failSave(true)); await button('结束并记录').click();
  await root.getByRole('alert').filter({hasText: '磁盘写入失败'}).waitFor(); await ready();
  assert.equal((await state()).state.session.status, 'running'); assert.equal(await button('结束并记录').isEnabled(), true);
  for (const theme of ['light', 'dark']) for (const width of [230, 280, 420]) await layout(theme, width, 'save-error');
  for (const theme of ['light', 'dark']) for (const width of [230, 280, 420]) await panelLayout(theme, width, 'save-error', true);
  check('failed save retains the active mode and session, exposes error, and releases retry controls');
  await page.evaluate(() => { window.qaStrip.failSave(false); return window.qaStrip.controller.resume(); });
  assert.equal(await root.getByRole('alert').isVisible(), false); check('successful external no-op clears controller errors without leaving a stale strip error');
  await page.evaluate(() => { window.qaStrip.failSave(false); window.qaStrip.blockSave(); });
  await button('结束并记录').click(); await page.waitForFunction(() => window.qaStrip.state().busy);
  assert.equal(await button('暂停').isDisabled(), true); assert.equal(await button('结束并记录').isDisabled(), true);
  assert.match(await root.locator('.ts-calendar-pomodoro-strip-status').textContent(), /正在保存/); check('busy save is visible and disables overlapping transition gestures');
  await page.evaluate(() => window.qaStrip.allowSave()); await ready();
  assert.equal((await state()).state.session.status, 'finished'); assert.equal((await state()).state.records.at(-1).outcome, 'stopped'); assert.equal((await state()).state.records.at(-1).durationMs, 3_621_000);
  assert.equal(await clock(), '25:00'); assert.equal(await root.locator('.ts-calendar-pomodoro-strip-title').textContent(), '番茄专注');
  await layout('dark', 230, 'stopwatch-finished', false);
  check('finished stopwatch shows the focus preset while retaining its completed record');
  assert.equal(await button('开始番茄专注').evaluate(el => document.activeElement === el), true); check('explicit end records actual stopwatch seconds and returns keyboard focus to the next primary action');
  await button('展开完整计时器').click(); assert.equal(await page.evaluate(() => window.qaStrip.opens()), 1);
  await page.evaluate(() => window.qaStrip.failOpen(true)); await button('展开完整计时器').click(); await root.getByRole('alert').filter({hasText: '展开失败'}).waitFor(); assert.equal(await button('展开完整计时器').isEnabled(), true); check('expand callback handles failure without changing the timer');
  const panelGeometry = () => page.locator('#full').evaluate(el => [...el.querySelectorAll('.ts-calendar-pomodoro-timer,.ts-calendar-pomodoro-actions,.ts-calendar-pomodoro-clock')].map(item => { const rect = item.getBoundingClientRect(); return [rect.width, rect.height, getComputedStyle(item).fontSize]; }));
  const fullBefore = await panelGeometry(); await page.evaluate(() => document.getElementById('strip-style').disabled = true); assert.deepEqual(await panelGeometry(), fullBefore); await page.evaluate(() => document.getElementById('strip-style').disabled = false); check('strip CSS does not change the independent timer geometry or fonts');
  await page.evaluate(() => { window.qaStrip.failOpen(false); window.qaStrip.blockOpen(); }); await button('展开完整计时器').click();
  await page.evaluate(() => { window.detachedRoot = document.querySelector('#first .ts-calendar-pomodoro-strip'); window.detachedMarkup = window.detachedRoot.innerHTML; window.qaStrip.close(); window.qaStrip.allowOpen(); });
  await advance(10_000); assert.equal(await page.evaluate(() => window.detachedRoot.innerHTML === window.detachedMarkup), true); assert.equal(await page.evaluate(() => window.qaStrip.subscriptions()), 1); assert.equal(await root.locator('.ts-calendar-pomodoro-strip').count(), 0); check('unload removes both subscriptions and ignores late open completion and controller ticks');
  await page.evaluate(() => window.qaStrip.mount()); await ready(); assert.equal(await page.evaluate(() => window.qaStrip.subscriptions()), 4);
  await button('开始番茄专注').click(); await ready(); await advance(10_000);
  await page.evaluate(() => window.qaStrip.blockSave()); await button('暂停').click(); await page.waitForFunction(() => window.qaStrip.state().busy);
  await page.evaluate(() => { window.detachedRoot = document.querySelector('#first .ts-calendar-pomodoro-strip'); window.detachedMarkup = window.detachedRoot.innerHTML; window.qaStrip.closeAll(); window.qaStrip.allowSave(); });
  await page.evaluate(() => window.qaStrip.controller.settled()); assert.equal(await page.evaluate(() => window.detachedRoot.innerHTML === window.detachedMarkup), true); assert.equal(await page.evaluate(() => window.qaStrip.subscriptions()), 0); assert.equal((await state()).state.session.status, 'paused'); check('controller transition completes after strip disposal without updating detached DOM or leaking listeners');
  assert.deepEqual(errors, []); check('no browser runtime errors');
  writeFileSync(out + '/result.json', JSON.stringify({checks: checks.length, passed: checks, errors}, null, 2) + '\n');
  console.log(JSON.stringify({checks: checks.length, errors}));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
