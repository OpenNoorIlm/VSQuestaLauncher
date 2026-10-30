#!/usr/bin/env node
/**
 * verify/activation-test.js — extension activation smoke test (mock VS Code host)
 *
 * Loads the compiled extension outside VS Code, installs a mock `vscode` module
 * (verify/vscode-mock.js), calls `activate(context)` and drives a few commands.
 * Catches runtime errors that `tsc` cannot (bad API usage, missing exports,
 * synchronous throws / unhandled promise rejections in command handlers).
 *
 * Prints one JSON object on stdout; exit code 0 = PASS, 1 = FAIL.
 * Invoked by run-checks.js (check ACT1) as a child process so module state is isolated.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { installMock } = require('./vscode-mock');

const TARGET = path.resolve(__dirname, '..');
const OUT_ENTRY = path.join(TARGET, 'out', 'extension.js');

const completed = [];
function record(id, pass, detail) { completed.push({ id, status: pass ? 'PASS' : 'FAIL', detail: detail || '' }); }
function fail(detail) { return { id: 'FATAL', status: 'FAIL', detail }; }

const unhandled = [];
process.on('unhandledRejection', (reason) => {
  unhandled.push(reason instanceof Error ? reason.stack || reason.message : String(reason));
});
process.on('uncaughtException', (err) => {
  unhandled.push('uncaughtException: ' + (err && err.stack ? err.stack : String(err)));
});

function timeout(promise, ms, label) {
  let timer;
  const t = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label + ' did not settle within ' + ms + 'ms')), ms);
    timer.unref && timer.unref();
  });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}

async function main() {
  const result = { ok: false, checks: completed, registered: [], legacyAliases: [], messages: [], notes: [] };

  // ── read the manifest command list (source of truth for expected ids) ──
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(TARGET, 'package.json'), 'utf8'));
  } catch (e) {
    record('manifest', false, 'cannot read package.json: ' + e.message);
    return finish(result);
  }
  const manifestIds = ((pkg.contributes && pkg.contributes.commands) || []).map(c => c.command);
  const expectedLegacy = [
    'questaLauncher.run',
    'questaLauncher.runGui',
    'questaLauncher.showWaveform',
    'questaLauncher.setQuestaPath',
    'questaLauncher.setConfig',
    'questaLauncher.editConf',
    'questaLauncher.setPriority',
    'questaLauncher.setLicense',
    'questaLauncher.helpDocs',
    'questaLauncher.helpDeps'
  ];

  // ── install mock + load extension ──
  const mock = installMock();
  const { vscode, sink } = mock;
  let ext;
  try {
    delete require.cache[require.resolve(OUT_ENTRY)];
    ext = require(OUT_ENTRY);
    record('require', true, 'out/extension.js loaded with mocked vscode');
  } catch (e) {
    record('require', false, 'requiring out/extension.js threw: ' + (e && e.stack ? e.stack : e));
    mock.restore();
    return finish(result);
  }

  // ── fake ExtensionContext ──
  const memento = () => {
    const m = new Map();
    return {
      get: (k, d) => (m.has(k) ? m.get(k) : d),
      update: (k, v) => { if (v === undefined) m.delete(k); else m.set(k, v); return Promise.resolve(); },
      keys: () => Array.from(m.keys()),
      setKeysForSync: () => {}
    };
  };
  const fakeContext = {
    subscriptions: [],
    extensionPath: TARGET,
    extension: { packageJSON: { name: 'multihd-launcher', version: '2.0.0' } },
    extensionUri: vscode.Uri.file(TARGET),
    storageUri: vscode.Uri.file('/tmp/multihd-mock-storage'),
    globalStorageUri: vscode.Uri.file('/tmp/multihd-mock-global-storage'),
    logUri: vscode.Uri.file('/tmp/multihd-mock-log'),
    globalStoragePath: '/tmp/multihd-mock-global-storage',
    storagePath: '/tmp/multihd-mock-storage',
    logPath: '/tmp/multihd-mock-log',
    extensionMode: 1,
    workspaceState: memento(),
    globalState: memento(),
    secrets: {
      get: () => Promise.resolve(undefined),
      store: () => Promise.resolve(),
      delete: () => Promise.resolve(),
      onDidChange: () => new vscode.Disposable()
    },
    environmentVariableCollection: {
      persistent: true, replace() {}, append() {}, prepend() {}, get() { return undefined; }, forEach() {}, delete() {}, clear() {}
    }
  };

  // ── activate() ──
  try {
    const maybe = ext.activate(fakeContext);
    if (maybe && typeof maybe.then === 'function') await timeout(maybe, 5000, 'activate() promise');
    record('activate', true, 'activate(context) completed without throwing');
  } catch (e) {
    record('activate', false, 'activate() threw: ' + (e && e.stack ? e.stack : e));
    mock.restore();
    return finish(result);
  }

  // ── registrations ──
  const registered = Array.from(sink.commands.keys()).sort();
  result.registered = registered;
  const missingManifest = manifestIds.filter(id => !registered.includes(id));
  record('register-manifest', missingManifest.length === 0,
    missingManifest.length ? 'missing manifest commands: ' + missingManifest.join(', ') : `all ${manifestIds.length} manifest commands registered`);
  const missingLegacy = expectedLegacy.filter(id => !registered.includes(id));
  record('register-legacy', missingLegacy.length === 0,
    missingLegacy.length ? 'missing legacy aliases: ' + missingLegacy.join(', ') : `all ${expectedLegacy.length} legacy aliases registered`);
  result.legacyAliases = expectedLegacy.filter(id => registered.includes(id));
  const unexpected = registered.filter(id => !manifestIds.includes(id) && !expectedLegacy.includes(id));
  if (unexpected.length) result.notes.push('extra registered commands: ' + unexpected.join(', '));

  // ── drive commands ──
  async function invoke(id, ...args) {
    const before = sink.messages.length;
    const handler = sink.commands.get(id);
    if (!handler) { record('invoke:' + id, false, 'command is not registered'); return { threw: true, messages: [] }; }
    try {
      const maybe = handler(...args);
      if (maybe && typeof maybe.then === 'function') await timeout(maybe, 5000, `command ${id}`);
      const messages = sink.messages.slice(before);
      record('invoke:' + id, true, `resolved without throwing${messages.length ? ' (user feedback: ' + messages.map(m => m.kind).join(',') + ')' : ' (no user feedback)'}`);
      return { threw: false, messages };
    } catch (e) {
      const messages = sink.messages.slice(before);
      record('invoke:' + id, false, 'threw: ' + (e && e.stack ? e.stack : e));
      return { threw: true, messages };
    }
  }

  const openRes = await invoke('multihdLauncher.openLauncher');
  await invoke('multihdLauncher.setConfig');
  const launchRes = await invoke('multihdLauncher.launchQuesta');

  // graceful no-project path: must not throw; should warn/log or resolve harmlessly
  if (!launchRes.threw) {
    const warned = launchRes.messages.length > 0 || sink.output.length > 0 || sink.panels.length > 0;
    record('launch-no-project-graceful', warned,
      warned
        ? 'no-project launch produced graceful feedback (' + (launchRes.messages.map(m => m.kind).join(',') || 'output/panel') + ')'
        : 'no-project launch silently resolved with no warning/output/panel — expected a graceful warning path');
  }

  // ── no vscode import in compiled tools (CONTRACT §6) ──
  const toolsDir = path.join(TARGET, 'out', 'tools');
  const toolFiles = fs.existsSync(toolsDir) ? fs.readdirSync(toolsDir).filter(f => f.endsWith('.js')) : [];
  const leaks = toolFiles.filter(f => /require\(\s*['"]vscode['"]\s*\)/.test(fs.readFileSync(path.join(toolsDir, f), 'utf8')));
  record('tools-vscode-free', leaks.length === 0, leaks.length ? 'out/tools imports vscode: ' + leaks.join(', ') : `${toolFiles.length} compiled tools are vscode-free`);

  // ── deactivate() should not throw ──
  if (typeof ext.deactivate === 'function') {
    try { ext.deactivate(); record('deactivate', true, 'deactivate() did not throw'); }
    catch (e) { record('deactivate', false, 'deactivate() threw: ' + (e && e.stack ? e.stack : e)); }
  }

  // give any dangling promises a tick, then check unhandled rejections
  await new Promise(r => setTimeout(r, 100));
  record('unhandled-rejections', unhandled.length === 0,
    unhandled.length ? 'unhandled rejection/uncaught exception during activation test:\n' + unhandled.join('\n') : 'no unhandled rejections');

  result.messages = sink.messages.map(m => m.kind + ': ' + m.message);
  result.notes.push('panels created: ' + sink.panels.length + ' (webviews: ' + sink.panels.map(p => p.title).join(', ') + ')');
  result.notes.push('openExternal: ' + (sink.openExternal.join(', ') || '(none)'));
  mock.restore();
  return finish(result);
}

function finish(result) {
  result.ok = result.checks.length > 0 && result.checks.every(c => c.status === 'PASS');
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exitCode = result.ok ? 0 : 1;
}

main().catch(e => {
  record('fatal', false, 'activation harness error: ' + (e && e.stack ? e.stack : e));
  const result = { ok: false, checks: completed, registered: [], legacyAliases: [], messages: [], notes: [] };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exitCode = 1;
});
