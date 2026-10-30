#!/usr/bin/env node
/**
 * MultiHD Launcher — independent verification harness (checker-owned)
 * ====================================================================
 * Verifies the VS Code port in this repository against the frozen coordination
 * contract (<workspace>/multihd-port/CONTRACT.md) and the authoritative Qt6
 * reference app (/home/bismillah/QuestaLauncher).
 *
 * Plain Node — no additional npm dependencies. May spawn:
 *   - `npm run compile`            (local node_modules/.bin/tsc)
 *   - `vsce` / `npx @vscode/vsce`  (packaging)
 *   - `unzip`                      (inspect the produced .vsix)
 *
 * Usage:
 *   node verify/run-checks.js [options]
 *
 * Options:
 *   --json             machine-readable JSON on stdout
 *   --verbose          show PASS details too
 *   --skip-build       do not run `npm run compile` (uses existing out/)
 *   --skip-package     do not run vsce packaging
 *   --only <regex>     run only checks whose id/title matches regex
 *   --report <path>    write the human-readable report to <path>
 *   --keep-temp        keep temporary fixture workspaces
 *   --help             this text
 *
 * Exit codes: 0 = no FAIL, 1 = at least one FAIL, 2 = harness/internal error.
 *
 * Independently derived expectations live in verify/fixtures/ (see
 * verify/fixtures/README.md and checks/BASELINE.md §0/§4 for C++ line refs).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const os = require('os');

// ─────────────────────────────── constants ────────────────────────────────
const TARGET = path.resolve(__dirname, '..');
const VERIFY_DIR = __dirname;
const FIXTURES = path.join(VERIFY_DIR, 'fixtures');
const EXPECTED = path.join(FIXTURES, 'expected');
const PROJECTS = path.join(FIXTURES, 'projects');
const OUT_DIR = path.join(TARGET, 'out');
const QT_SVG = '/home/bismillah/QuestaLauncher/multihd_launcher.svg';

const TS = '2026-10-30T16:45:12'; // injected timestamp for golden files
const GWIN_DEFAULT = 'GW1NR-LV9QN88PC6/I5';

const EXPECTED_MANIFEST = {
  name: 'multihd-launcher',
  displayName: 'MultiHD Launcher',
  version: '2.0.0',
  publisher: 'bismillah',
  icon: 'images/icon.png',
  description:
    'Multi-HDL launcher for Questa FSE, Quartus Prime and Gowin EDA — generated project files, ' +
    'compile order, per-file exclusion, library manager and one-click launch inside VS Code.',
  repository: 'https://github.com/OpenNoorIlm/VSQuestaLauncher',
  galleryBanner: { color: '#0d0d1a', theme: 'dark' },
  commandPrefix: 'multihdLauncher.',
  settingsTitle: 'MultiHD Launcher',
  settings: {
    'multihdLauncher.vsimPath': { type: 'string', default: '' },
    'multihdLauncher.questaBin': { type: 'string', default: '' },
    'multihdLauncher.licenseFile': { type: 'string', default: '' },
    'multihdLauncher.saltLicenseServer': { type: 'string', default: '' },
    'multihdLauncher.licenseServer': { type: 'string', default: '' },
    'multihdLauncher.alteraLicenseFile': { type: 'string', default: '' },
    'multihdLauncher.mtiVcoMode': { type: 'string', default: '64' },
    'multihdLauncher.defaultFolder': { type: 'string', default: '' },
    'multihdLauncher.quartusPath': { type: 'string', default: '' },
    'multihdLauncher.gowinPath': { type: 'string', default: '' },
    'multihdLauncher.extraVlogArgs': { type: 'string', default: '-reportprogress 300' },
    'multihdLauncher.autoOpenGui': { type: 'boolean', default: false }
  }
};

// CONTRACT.md §4 — exact command table.
const EXPECTED_COMMANDS = {
  'multihdLauncher.openLauncher': '🚀 Open MultiHD Launcher',
  'multihdLauncher.run': '▶ Run CLI',
  'multihdLauncher.runGui': '🖥 Run GUI',
  'multihdLauncher.showWaveform': '〰 Show WaveForm',
  'multihdLauncher.launchQuesta': '⬡ Launch Questa',
  'multihdLauncher.launchQuartus': '◈ Launch Quartus Prime',
  'multihdLauncher.launchGowin': '◆ Launch Gowin EDA',
  'multihdLauncher.setConfig': '⚙ Configuration',
  'multihdLauncher.setLicense': '🔑 Set License',
  'multihdLauncher.setPriority': '⇅ Compile Order',
  'multihdLauncher.excludeFiles': '✕ Exclude Files',
  'multihdLauncher.libraryManager': '📦 Library Manager',
  'multihdLauncher.gowinCst': '◆ Gowin CST Editor',
  'multihdLauncher.installHelpers': '⬇ Install / License Helpers',
  'multihdLauncher.editConf': '⚙ Edit conf.svconf',
  'multihdLauncher.helpDocs': '❓ MultiHD Launcher Help',
  'multihdLauncher.helpDeps': '📦 Dependency Resolver'
};

// CONTRACT.md §4 — runtime-only legacy aliases (must NOT be in the manifest).
const EXPECTED_LEGACY_ALIASES = [
  'questaLauncher.run',
  'questaLauncher.runGui',
  'questaLauncher.showWaveform',
  'questaLauncher.setQuestaPath',
  'questaLauncher.editConf',
  'questaLauncher.setPriority',
  'questaLauncher.setLicense',
  'questaLauncher.helpDocs',
  'questaLauncher.helpDeps'
];

// CONTRACT.md §10 — exact Qt install/license URLs (F10).
const EXPECTED_URLS = [
  'https://www.intel.com/content/www/us/en/software-kit/825277/questa-intel-fpgas-standard-edition-software-version-23-1-1.html',
  'https://licensing.intel.com/psg/s/sales-signup-evaluationlicenses'
];

// CONTRACT.md §8 F1/F2/F5 — panel strings.
const UI_STRINGS = {
  launcher: [
    [/QUESTA FSE\s+•\s+QUARTUS PRIME\s+•\s+GOWIN EDA/, 'subtitle QUESTA FSE • QUARTUS PRIME • GOWIN EDA'],
    [/LICENSE OK/, 'license badge ✓ LICENSE OK'],
    [/LICENSE NOT SET/, 'license badge ⚠ LICENSE NOT SET'],
    [/EXCLUDED FILES/, 'EXCLUDED FILES panel'],
    [/no files excluded/, 'empty exclusion placeholder'],
    [/restore/, 'per-file ↩ restore'],
    [/COMPILE ORDER/, 'COMPILE ORDER action'],
    [/DISINCLUDE/, 'DISINCLUDE action'],
    [/LIBRARIES/, 'LIBRARIES action'],
    [/COMPILE FOR/, 'COMPILE FOR section'],
    [/Questa\s*\/\s*Modelsim/, '⬡ Questa / Modelsim checkbox'],
    [/Quartus Prime/, '◈ Quartus Prime checkbox'],
    [/Gowin EDA/, '◆ Gowin EDA checkbox'],
    [/INSTALL QUESTA/, '⬇ INSTALL QUESTA'],
    [/LICENSE REQUEST/, '🔑 LICENSE REQUEST'],
    [/LAUNCH/, 'LAUNCH button'],
    [/no license/i, 'license-warning LAUNCH state'],
    [/Browse/, 'project folder Browse'],
    [/HD LAUNCHER|multihd_launcher|MULTI/, 'new logo (MULTI / HD LAUNCHER)']
  ],
  config: [
    [/vsim binary/i, 'vsim field'],
    [/license file/i, 'license field'],
    [/default folder/i, 'default folder field'],
    [/Quartus binary/i, 'Quartus binary field'],
    [/Gowin IDE binary/i, 'Gowin IDE binary field'],
    [/SALT_LICENSE_SERVER/, 'SALT_LICENSE_SERVER field'],
    [/MTI_VCO_MODE/, 'MTI_VCO_MODE field'],
    [/LICENSE FILE NOT SET|license file not set/i, 'banner: not set'],
    [/LICENSE FILE NOT FOUND|license file not found/i, 'banner: not found'],
    [/License file found|license ok/i, 'banner: found OK'],
    [/Browse/, 'per-field Browse']
  ],
  priority: [
    [/REVERSE/, 'REVERSE button'],
    [/RESET/, 'RESET button'],
    [/DONE/, 'DONE button'],
    [/COMPILE ORDER/i, 'heading'],
    [/\[01\]|priority|ordered/i, 'badge/priority semantics']
  ],
  exclude: [
    [/Select all _tb\.sv/, 'quick select _tb'],
    [/Select all \.sv/, 'quick select all'],
    [/Clear all/, 'clear all'],
    [/DISINCLUDE|exclude/i, 'exclusion heading'],
    [/hidden/, 'DISINCLUDE [N hidden] badge'],
    [/restore/, 'restore chip']
  ]
};

// CONTRACT.md §2 — dark cyber palette (F11).
const THEME_TOKENS = [
  '#0d0d1a', '#131326', '#00e5ff', '#00ff88', '#ffaa00', '#ff4444', '#cc4444',
  '#aaaaff', '#bb88ff', '#446688', '#8899bb', '#e0e0e0', 'Courier New'
];

const SCENARIOS = {
  basic: {
    projectName: 'basic',
    files: ['alpha.sv', 'beta.sv', 'gamma_tb.sv'],
    runDoFiles: ['alpha.sv', 'beta.sv', 'gamma_tb.sv'],
    quartusActive: ['alpha.sv', 'beta.sv', 'gamma_tb.sv'],
    topModule: 'gamma_tb',
    topFile: 'beta.sv',
    gowinActive: ['alpha.sv', 'beta.sv', 'gamma_tb.sv']
  },
  exclusions: {
    projectName: 'exclusions',
    files: ['a.sv', 'b.sv', 'c_tb.sv'],
    runDoFiles: ['a.sv', 'c_tb.sv'], // b.sv excluded
    quartusActive: ['a.sv', 'c_tb.sv'],
    topModule: 'c_tb',
    topFile: 'a.sv',
    gowinActive: ['a.sv', 'c_tb.sv']
  },
  priority: {
    projectName: 'priority',
    files: ['x.sv', 'y.sv', 'z_tb.sv'],
    // Qt: Questa honours the custom order verbatim; Quartus/Gowin use the
    // deterministic active-file order (non-tb alpha, then tb alpha).
    runDoFiles: ['y.sv', 'z_tb.sv', 'x.sv'],
    quartusActive: ['x.sv', 'y.sv', 'z_tb.sv'],
    topModule: 'z_tb',
    topFile: 'y.sv',
    gowinActive: ['x.sv', 'y.sv', 'z_tb.sv']
  },
  'gowin-ports': {
    projectName: 'gowin-ports',
    files: ['top.sv'],
    runDoFiles: ['top.sv'],
    quartusActive: ['top.sv'],
    topModule: 'top',
    topFile: 'top.sv',
    gowinActive: ['top.sv']
  }
};

// ─────────────────────────────── CLI options ──────────────────────────────
const argv = process.argv.slice(2);
function flag(name) { return argv.includes('--' + name); }
function opt(name, def) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
}
const OPTS = {
  json: flag('json'),
  verbose: flag('verbose'),
  skipBuild: flag('skip-build'),
  skipPackage: flag('skip-package'),
  keepTemp: flag('keep-temp'),
  help: flag('help') || flag('h'),
  report: opt('report', null),
  only: opt('only', null)
};

// ─────────────────────────────── reporting ────────────────────────────────
const C = process.stdout.isTTY
  ? { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m', bold: '\x1b[1m', magenta: '\x1b[35m' }
  : { reset: '', red: '', green: '', yellow: '', cyan: '', dim: '', bold: '', magenta: '' };

class SkipError extends Error { constructor(reason) { super(reason); this.status = 'SKIP'; } }
class WarnError extends Error { constructor(reason) { super(reason); this.status = 'WARN'; } }
function skip(reason) { throw new SkipError(reason); }
function warn(reason) { throw new WarnError(reason); }

const checks = [];
const ctx = {
  pkg: null,
  pkgError: null,
  build: { ok: null, out: '', err: '', code: null },
  tmp: null,
  corpus: null,
  modules: {},
  scenarios: {},
  package: {}
};
let results = [];

function addCheck(group, id, title, fn) {
  checks.push({ group, id, title, fn });
}

function filterCheck(c) {
  if (!OPTS.only) return true;
  try { const re = new RegExp(OPTS.only, 'i'); return re.test(c.id) || re.test(c.title); }
  catch { return true; }
}

async function runChecks() {
  for (const c of checks) {
    if (!filterCheck(c)) continue;
    const started = Date.now();
    const rec = { group: c.group, id: c.id, title: c.title, status: 'PASS', detail: '', ms: 0 };
    try {
      const detail = await c.fn();
      rec.status = 'PASS';
      rec.detail = typeof detail === 'string' ? detail : '';
    } catch (e) {
      if (e && e.status === 'SKIP') { rec.status = 'SKIP'; rec.detail = e.message; }
      else if (e && e.status === 'WARN') { rec.status = 'WARN'; rec.detail = e.message; }
      else { rec.status = 'FAIL'; rec.detail = (e && e.message) || String(e); }
    }
    rec.ms = Date.now() - started;
    results.push(rec);
    if (OPTS.json) continue;
    const tag = { PASS: C.green + '[PASS]' + C.reset, FAIL: C.red + '[FAIL]' + C.reset, WARN: C.yellow + '[WARN]' + C.reset, SKIP: C.dim + '[SKIP]' + C.reset }[rec.status];
    process.stdout.write(`${tag} ${C.bold}${rec.id}${C.reset} ${rec.title}\n`);
    if (rec.detail && (rec.status !== 'PASS' || OPTS.verbose)) {
      for (const line of String(rec.detail).split('\n')) {
        process.stdout.write(`       ${C.dim}${line}${C.reset}\n`);
      }
    }
  }
}

// ─────────────────────────────── helpers ──────────────────────────────────
function rel(p) { return path.relative(TARGET, p) || p; }
function exists(p) { try { return fs.existsSync(p); } catch { return false; } }
function readText(p) { return fs.readFileSync(p, 'utf8'); }
function readJSON(p) { return JSON.parse(readText(p)); }

function walk(dir, filter, acc) {
  acc = acc || [];
  if (!exists(dir)) return acc;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'verify') continue;
      walk(p, filter, acc);
    } else if (!filter || filter(p)) {
      acc.push(p);
    }
  }
  return acc;
}

function sh(cmd, args, opts) {
  opts = opts || {};
  const res = cp.spawnSync(cmd, args, {
    cwd: opts.cwd || TARGET,
    encoding: 'utf8',
    timeout: opts.timeout || 120000,
    env: Object.assign({}, process.env, opts.env || {}),
    maxBuffer: 20 * 1024 * 1024
  });
  return {
    cmd: cmd + ' ' + args.join(' '),
    code: res.status,
    out: (res.stdout || '').toString(),
    err: (res.stderr || '').toString(),
    signal: res.signal,
    error: res.error
  };
}

function firstDiff(expected, actual) {
  const e = expected.split('\n');
  const a = actual.split('\n');
  const n = Math.max(e.length, a.length);
  for (let i = 0; i < n; i++) {
    if (e[i] !== a[i]) {
      const from = Math.max(0, i - 2);
      const to = Math.min(n, i + 3);
      const lines = [];
      for (let j = from; j < to; j++) {
        const mark = j === i ? '>>' : '  ';
        lines.push(`${mark} expected[${j + 1}]: ${JSON.stringify(e[j] === undefined ? '<missing>' : e[j])}`);
        lines.push(`${mark} actual  [${j + 1}]: ${JSON.stringify(a[j] === undefined ? '<missing>' : a[j])}`);
      }
      return `first difference at line ${i + 1} (expected ${e.length} lines, actual ${a.length})\n` + lines.join('\n');
    }
  }
  return null;
}

function normEof(s) {
  s = String(s).replace(/\r\n/g, '\n');
  s = s.replace(/\n+$/, '');
  return s.length ? s + '\n' : '';
}

function compareText(label, expectedContent, actualContent) {
  if (normEof(expectedContent) === normEof(actualContent)) return true;
  const diff = firstDiff(normEof(expectedContent), normEof(actualContent));
  throw new Error(`${label} does not match the Qt-derived golden.\n${diff}`);
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

function assertFileEquals(expectedPath, actualContent, label) {
  const expected = readText(expectedPath);
  compareText(label + ' (vs ' + rel(expectedPath) + ')', expected, actualContent);
}

function expectedText(relPath) { return readText(path.join(EXPECTED, relPath)); }

function readIfExists(p) { return exists(p) ? readText(p) : null; }

function assertNoCR(label, content) {
  if (content.includes('\r')) throw new Error(`${label}: contains CR/CRLF — contract requires LF-only generated files`);
}

function scanLines(files, re, allowance) {
  const hits = [];
  for (const f of files) {
    let text;
    try { text = readText(f); } catch { continue; }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      re.lastIndex = 0;
      if (!re.test(line)) continue;
      if (allowance && allowance(line, f, lines, i)) continue;
      hits.push({ file: rel(f), line: i + 1, text: line.trim() });
    }
  }
  return hits;
}

function formatHits(hits, max) {
  max = max || 12;
  const shown = hits.slice(0, max).map(h => `  ${h.file}:${h.line}  ${h.text.slice(0, 160)}`);
  if (hits.length > max) shown.push(`  … ${hits.length - max} more`);
  return shown.join('\n');
}

function pngInfo(file) {
  const b = fs.readFileSync(file);
  if (b.length < 33) return { ok: false, reason: 'file too small' };
  const sig = b.slice(0, 8).toString('hex');
  if (sig !== '89504e470d0a1a0a') return { ok: false, reason: 'not a PNG (bad signature)' };
  const type = b.toString('ascii', 12, 16);
  if (type !== 'IHDR') return { ok: false, reason: 'missing IHDR chunk' };
  return {
    ok: true,
    width: b.readUInt32BE(16),
    height: b.readUInt32BE(20),
    bitDepth: b[24],
    colorType: b[25],
    bytes: b.length
  };
}

function makeVscodeStub() {
  const fn = function () {};
  return new Proxy(fn, {
    get(target, prop) {
      if (prop === Symbol.toPrimitive) return () => '';
      if (prop === 'then') return undefined;
      if (prop === 'toString') return () => '[vscode-stub]';
      if (prop === 'inspect') return () => '[vscode-stub]';
      if (!(prop in target)) target[prop] = makeVscodeStub();
      return target[prop];
    },
    apply() { return makeVscodeStub(); },
    construct() { return makeVscodeStub(); },
    set() { return true; }
  });
}

function requireFresh(file) {
  const resolved = require.resolve(file);
  delete require.cache[resolved];
  return require(resolved);
}

function requireWithVscodeStub(file) {
  const Module = require('module');
  const origLoad = Module._load;
  Module._load = function (request) {
    if (request === 'vscode') return makeVscodeStub();
    return origLoad.apply(this, arguments);
  };
  try { return requireFresh(file); }
  finally { Module._load = origLoad; }
}

function loadToolModule(name) {
  const p = path.join(OUT_DIR, 'tools', name + '.js');
  if (!exists(p)) throw new Error(`missing compiled module: out/tools/${name}.js (expected from CONTRACT §6/§7.2)`);
  if (ctx.modules[name]) return ctx.modules[name];
  let mod;
  try { mod = requireFresh(p); } catch (e) { throw new Error(`cannot require out/tools/${name}.js in plain Node: ${e.message}`); }
  ctx.modules[name] = mod || {};
  return ctx.modules[name];
}

function pickFn(mod, names, moduleLabel) {
  for (const n of names) {
    if (typeof mod[n] === 'function') return mod[n];
  }
  if (mod.default && typeof mod.default === 'object') {
    for (const n of names) if (typeof mod.default[n] === 'function') return mod.default[n];
  }
  throw new Error(`${moduleLabel} does not export any of: ${names.join(', ')}`);
}

function compiledFiles() {
  return walk(OUT_DIR, p => p.endsWith('.js'));
}

function compiledCorpus() {
  if (ctx.corpus) return ctx.corpus;
  const files = compiledFiles();
  assert(files.length > 0, 'out/ contains no compiled .js files — run `npm run compile`');
  ctx.corpus = { files: files.map(f => ({ file: f, text: readText(f) })) };
  return ctx.corpus;
}

function corpusText(filterFn) {
  return compiledCorpus().files.filter(f => !filterFn || filterFn(f.file)).map(f => f.text).join('\n');
}

function findInCorpus(re) {
  const hits = [];
  for (const f of compiledCorpus().files) {
    const lines = f.text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      re.lastIndex = 0;
      if (re.test(lines[i])) hits.push({ file: rel(f.file), line: i + 1, text: lines[i].trim() });
    }
  }
  return hits;
}

function requireString(re, label, filesFilter) {
  const text = corpusText(filesFilter);
  re.lastIndex = 0;
  if (!re.test(text)) throw new Error(`compiled output is missing expected string: ${label} (${re})`);
  return true;
}

function requireAllStrings(corpusName, pairs, filesFilter) {
  const missing = [];
  for (const [re, label] of pairs) {
    re.lastIndex = 0;
    if (!re.test(corpusText(filesFilter))) missing.push(label);
  }
  if (missing.length) {
    throw new Error(`compiled output is missing ${missing.length} required UI string(s):\n  - ` + missing.join('\n  - '));
  }
  return true;
}

function tmpPath(...parts) { return path.join(ctx.tmp, ...parts); }

function makeScenarioWorkspace(name) {
  const src = path.join(PROJECTS, name);
  assert(exists(src), `fixture project missing: ${rel(src)}`);
  const dst = tmpPath('ws-' + name);
  fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(src, dst, { recursive: true });
  return dst;
}

function ensureTmp() {
  if (!ctx.tmp) ctx.tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'multihd-verify-'));
  return ctx.tmp;
}

function listFiles(dir) {
  const out = [];
  function rec(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) rec(p); else out.push(p);
    }
  }
  if (exists(dir)) rec(dir);
  return out;
}

function readGolden(relPath) { return expectedText(relPath); }

function passDetail(extra) { return extra || ''; }

function unzipAvailable() {
  if (ctx.unzip === undefined) {
    const r = sh('unzip', ['-v'], { timeout: 20000 });
    ctx.unzip = r.code === 0;
  }
  return ctx.unzip;
}
function zipList(file) {
  if (!unzipAvailable()) return null;
  const r = sh('unzip', ['-Z1', file], { timeout: 60000 });
  return r.code === 0 ? r.out.split('\n').filter(Boolean) : null;
}
function zipRead(file, entry) {
  if (!unzipAvailable()) return null;
  const r = sh('unzip', ['-p', file, entry], { timeout: 60000 });
  return r.code === 0 ? r.out : null;
}

function basenameAny(item) {
  if (typeof item === 'string') return path.basename(item);
  if (item && typeof item.path === 'string') return path.basename(item.path);
  return null;
}
function resultHasPath(list, wanted) {
  if (!Array.isArray(list)) return false;
  return list.some(item => {
    const b = basenameAny(item);
    return b === wanted || (typeof item === 'string' && item.endsWith(wanted)) || (item && item.path && item.path.endsWith(wanted));
  });
}

// ─────────────────────────── package.json helpers ─────────────────────────
function getPkg() {
  if (ctx.pkg) return ctx.pkg;
  const p = path.join(TARGET, 'package.json');
  if (!exists(p)) throw new Error('package.json not found');
  try { ctx.pkg = readJSON(p); } catch (e) { throw new Error('package.json is not valid JSON: ' + e.message); }
  return ctx.pkg;
}

function manifestCommands() {
  const pkg = getPkg();
  const arr = (pkg.contributes && pkg.contributes.commands) || [];
  const map = new Map();
  for (const c of arr) {
    if (!c || typeof c.command !== 'string') continue;
    map.set(c.command, c);
  }
  return map;
}

function manifestSettings() {
  const pkg = getPkg();
  const cfg = (pkg.contributes && pkg.contributes.configuration) || null;
  const out = {};
  if (!cfg) return { title: null, properties: out };
  if (Array.isArray(cfg)) {
    for (const c of cfg) Object.assign(out, c.properties || {});
    return { title: cfg[0] ? cfg[0].title : null, properties: out };
  }
  out.properties = Object.assign({}, cfg.properties || {});
  return { title: cfg.title || null, properties: out.properties };
}

function requireBuildOk() {
  if (ctx.build.ok === null) skip('build check has not run');
  if (!ctx.build.ok) skip('`npm run compile` failed — runtime checks skipped (see B1 output)');
}

function requirePackageOk() {
  if (!ctx.package.ok) skip('vsce packaging has not succeeded — the packaged-artifact checks are skipped');
}

// ══════════════════════════════════════════════════════════════════════════
// GROUP: MANIFEST  (CONTRACT §2/§4/§5)
// ══════════════════════════════════════════════════════════════════════════

addCheck('MANIFEST', 'M1', 'identity: name / displayName / version / publisher', () => {
  const pkg = getPkg();
  const errs = [];
  for (const k of ['name', 'displayName', 'version', 'publisher']) {
    if (pkg[k] !== EXPECTED_MANIFEST[k]) errs.push(`${k}: expected ${JSON.stringify(EXPECTED_MANIFEST[k])}, got ${JSON.stringify(pkg[k])}`);
  }
  if (errs.length) throw new Error(errs.join('\n'));
  return 'name=multihd-launcher displayName="MultiHD Launcher" version=2.0.0 publisher=bismillah';
});

addCheck('MANIFEST', 'M2', 'description / galleryBanner / repository / categories / keywords', () => {
  const pkg = getPkg();
  const errs = [];
  if (pkg.description !== EXPECTED_MANIFEST.description) errs.push('description does not match the frozen CONTRACT §2 string');
  const gb = pkg.galleryBanner || {};
  if (gb.color !== EXPECTED_MANIFEST.galleryBanner.color || gb.theme !== EXPECTED_MANIFEST.galleryBanner.theme) {
    errs.push(`galleryBanner: expected ${JSON.stringify(EXPECTED_MANIFEST.galleryBanner)}, got ${JSON.stringify(gb)}`);
  }
  const repo = (pkg.repository && (pkg.repository.url || pkg.repository)) || '';
  if (repo !== EXPECTED_MANIFEST.repository) errs.push(`repository.url: expected ${EXPECTED_MANIFEST.repository}, got ${JSON.stringify(repo)}`);
  if (!Array.isArray(pkg.categories) || pkg.categories.length === 0) errs.push('categories must be a non-empty array');
  const kw = (pkg.keywords || []).map(k => String(k).toLowerCase()).join(' ');
  for (const k of ['questa', 'quartus', 'gowin']) if (!kw.includes(k)) errs.push(`keywords should include "${k}"`);
  if (errs.length) throw new Error(errs.join('\n'));
  return 'frozen description + galleryBanner + repository URL + categories/keywords present';
});

addCheck('MANIFEST', 'M3', 'icon field points to existing PNG asset', () => {
  const pkg = getPkg();
  if (pkg.icon !== EXPECTED_MANIFEST.icon) throw new Error(`icon: expected "${EXPECTED_MANIFEST.icon}", got ${JSON.stringify(pkg.icon)}`);
  const iconPath = path.join(TARGET, pkg.icon);
  if (!exists(iconPath)) throw new Error(`icon file referenced by manifest does not exist: ${pkg.icon}`);
  const info = pngInfo(iconPath);
  if (!info.ok) throw new Error(`icon is not a valid PNG: ${info.reason}`);
  return `icon=${pkg.icon} PNG ${info.width}x${info.height} (${info.bytes} bytes)`;
});

addCheck('MANIFEST', 'M4', 'main / engines / activationEvents / scripts', () => {
  const pkg = getPkg();
  const errs = [];
  if (pkg.main !== './out/extension.js') errs.push(`main: expected "./out/extension.js", got ${JSON.stringify(pkg.main)}`);
  const eng = (pkg.engines && pkg.engines.vscode) || '';
  if (!/^\^?1\.\d+(\.\d+)?$/.test(eng)) errs.push(`engines.vscode looks invalid: ${JSON.stringify(eng)}`);
  if (typeof pkg.scripts !== 'object' || !pkg.scripts) errs.push('scripts object missing');
  else {
    if (!pkg.scripts.compile) errs.push('scripts.compile missing');
    if (!pkg.scripts['vscode:prepublish']) errs.push('scripts["vscode:prepublish"] missing');
    if (!pkg.scripts.package) errs.push('scripts.package missing (convenience packaging script)');
  }
  if (!Array.isArray(pkg.activationEvents) || pkg.activationEvents.length === 0) errs.push('activationEvents missing');
  if (errs.length) throw new Error(errs.join('\n'));
  return `main=${pkg.main} engines.vscode=${eng} activationEvents=${pkg.activationEvents.length}`;
});

addCheck('MANIFEST', 'M5', 'commands: exact 17 frozen IDs + titles', () => {
  const map = manifestCommands();
  const errs = [];
  const expectedIds = Object.keys(EXPECTED_COMMANDS);
  for (const id of expectedIds) {
    if (!map.has(id)) { errs.push(`missing command: ${id}`); continue; }
    const title = map.get(id).title;
    if (title !== EXPECTED_COMMANDS[id]) errs.push(`${id} title: expected ${JSON.stringify(EXPECTED_COMMANDS[id])}, got ${JSON.stringify(title)}`);
  }
  for (const id of map.keys()) {
    if (!expectedIds.includes(id)) errs.push(`unexpected command in manifest: ${id}`);
  }
  if (errs.length) throw new Error(errs.join('\n'));
  return `all ${expectedIds.length} frozen commands present with exact titles`;
});

addCheck('MANIFEST', 'M6', 'menus reference declared commands and required contexts', () => {
  const pkg = getPkg();
  const menus = (pkg.contributes && pkg.contributes.menus) || {};
  const known = manifestCommands();
  const errs = [];
  for (const [where, entries] of Object.entries(menus)) {
    for (const e of entries || []) {
      if (!e || !e.command) { errs.push(`${where}: entry without command`); continue; }
      if (!known.has(e.command) && !e.command.startsWith('workbench.')) errs.push(`${where} references undeclared command ${e.command}`);
      if (!e.when) errs.push(`${where}: ${e.command} has no "when" clause`);
    }
  }
  const titleCmds = ((menus['editor/title']) || []).map(e => e.command);
  for (const c of ['multihdLauncher.openLauncher', 'multihdLauncher.run', 'multihdLauncher.launchQuesta', 'multihdLauncher.setPriority', 'multihdLauncher.setConfig']) {
    if (!titleCmds.includes(c)) errs.push(`editor/title is missing ${c}`);
  }
  const confEntries = ((menus['editor/title']) || []).filter(e => (e.when || '').includes('conf.svconf')).map(e => e.command);
  for (const c of ['multihdLauncher.editConf', 'multihdLauncher.helpDocs']) if (!confEntries.includes(c)) errs.push(`editor/title (conf.svconf) missing ${c}`);
  const explorer = ((menus['explorer/context']) || []).map(e => e.command);
  for (const c of ['multihdLauncher.launchQuartus', 'multihdLauncher.launchGowin', 'multihdLauncher.excludeFiles', 'multihdLauncher.libraryManager', 'multihdLauncher.gowinCst']) {
    if (!explorer.includes(c)) errs.push(`explorer/context is missing ${c}`);
  }
  if (errs.length) throw new Error(errs.join('\n'));
  return `${Object.keys(menus).length} menu sections; editor/title has ${titleCmds.length} entries`;
});

addCheck('MANIFEST', 'M7', 'settings: exact frozen keys / types / defaults / section title', () => {
  const { title, properties } = manifestSettings();
  const errs = [];
  if (title !== EXPECTED_MANIFEST.settingsTitle) errs.push(`configuration.title: expected "MultiHD Launcher", got ${JSON.stringify(title)}`);
  for (const [key, spec] of Object.entries(EXPECTED_MANIFEST.settings)) {
    const p = properties[key];
    if (!p) { errs.push(`missing setting ${key}`); continue; }
    if (p.type !== spec.type) errs.push(`${key}.type: expected ${spec.type}, got ${JSON.stringify(p.type)}`);
    if (JSON.stringify(p.default) !== JSON.stringify(spec.default)) errs.push(`${key}.default: expected ${JSON.stringify(spec.default)}, got ${JSON.stringify(p.default)}`);
  }
  for (const key of Object.keys(properties)) {
    if (!EXPECTED_MANIFEST.settings[key]) errs.push(`unexpected setting ${key}`);
    if (!key.startsWith('multihdLauncher.')) errs.push(`setting outside multihdLauncher namespace: ${key}`);
  }
  if (errs.length) throw new Error(errs.join('\n'));
  return `all ${Object.keys(EXPECTED_MANIFEST.settings).length} frozen settings present`;
});

addCheck('MANIFEST', 'M8', 'svconf language + grammar preserved and files valid', () => {
  const pkg = getPkg();
  const c = pkg.contributes || {};
  const errs = [];
  const lang = (c.languages || []).find(l => l.id === 'svconf');
  if (!lang) errs.push('contributes.languages is missing the svconf language (F12 preserve)');
  else {
    if (!Array.isArray(lang.extensions) || !lang.extensions.includes('.svconf')) errs.push('svconf language must map .svconf');
    const cfgFile = path.join(TARGET, lang.configuration || '');
    if (!lang.configuration || !exists(cfgFile)) errs.push('svconf language-configuration.json missing');
    else { try { readJSON(cfgFile); } catch (e) { errs.push('language-configuration.json invalid JSON'); } }
  }
  const gram = (c.grammars || []).find(g => g.language === 'svconf');
  if (!gram) errs.push('contributes.grammars is missing the svconf grammar (F12 preserve)');
  else {
    if (gram.scopeName !== 'source.svconf') errs.push(`grammar scopeName expected source.svconf, got ${JSON.stringify(gram.scopeName)}`);
    const gp = path.join(TARGET, gram.path || '');
    if (!gram.path || !exists(gp)) errs.push('svconf grammar file missing');
    else {
      try {
        const json = readJSON(gp);
        if (!json.scopeName) errs.push('grammar JSON has no scopeName');
      } catch (e) { errs.push('svconf grammar JSON invalid'); }
    }
  }
  if (errs.length) throw new Error(errs.join('\n'));
  return 'svconf language + syntax grammar intact';
});

addCheck('MANIFEST', 'M9', 'dependencies / tsconfig strict (CONTRACT §10)', () => {
  const pkg = getPkg();
  const errs = [];
  if (pkg.dependencies && Object.keys(pkg.dependencies).length) {
    errs.push(`runtime "dependencies" present — CONTRACT §10 forbids new runtime deps: ${Object.keys(pkg.dependencies).join(', ')}`);
  }
  const allowedDev = new Set(['@types/node', '@types/vscode', 'typescript']);
  for (const dep of Object.keys(pkg.devDependencies || {})) {
    if (!allowedDev.has(dep)) errs.push(`unexpected devDependency: ${dep}`);
  }
  const tsconfig = path.join(TARGET, 'tsconfig.json');
  if (!exists(tsconfig)) errs.push('tsconfig.json missing');
  else {
    let ts;
    try { ts = readJSON(tsconfig); } catch (e) { errs.push('tsconfig.json invalid JSON'); }
    if (ts) {
      const co = ts.compilerOptions || {};
      if (co.strict !== true) errs.push('tsconfig compilerOptions.strict must be true');
      if (co.outDir !== './out') errs.push(`tsconfig outDir expected ./out, got ${JSON.stringify(co.outDir)}`);
      if (co.rootDir !== './src') errs.push(`tsconfig rootDir expected ./src, got ${JSON.stringify(co.rootDir)}`);
      if (co.module !== 'commonjs') errs.push(`tsconfig module expected commonjs, got ${JSON.stringify(co.module)}`);
    }
  }
  if (errs.length) throw new Error(errs.join('\n'));
  return 'no runtime deps; only allowed devDependencies; strict TS config intact';
});

addCheck('MANIFEST', 'M10', 'package-lock.json consistent with package.json', () => {
  const pkg = getPkg();
  const lockPath = path.join(TARGET, 'package-lock.json');
  if (!exists(lockPath)) throw new Error('package-lock.json missing');
  let lock;
  try { lock = readJSON(lockPath); } catch (e) { throw new Error('package-lock.json invalid JSON'); }
  const root = (lock.packages && lock.packages['']) || {};
  const name = root.name || lock.name;
  const version = root.version || lock.version;
  if (name !== pkg.name || version !== pkg.version) {
    throw new WarnError(`package-lock.json still says ${JSON.stringify(name)} v${version} while package.json says ${pkg.name} v${pkg.version} — run "npm install --package-lock-only" (WARN, not shipped in vsix)`);
  }
  return 'lock name/version consistent';
});

// ══════════════════════════════════════════════════════════════════════════
// GROUP: ASSETS  (CONTRACT §2 naming/logo, F13)
// ══════════════════════════════════════════════════════════════════════════

addCheck('ASSETS', 'A1', 'images/icon.png is a real 256x256 PNG from the Qt logo', () => {
  const p = path.join(TARGET, 'images/icon.png');
  if (!exists(p)) throw new Error('images/icon.png missing');
  const info = pngInfo(p);
  if (!info.ok) throw new Error(`images/icon.png invalid: ${info.reason}`);
  if (info.width !== 256 || info.height !== 256) throw new Error(`images/icon.png is ${info.width}x${info.height}; CONTRACT §2 requires 256x256 (>=128 hard minimum)`);
  if (info.bytes < 1024) throw new Error(`images/icon.png suspiciously small (${info.bytes} bytes) — likely a placeholder`);
  return `valid PNG ${info.width}x${info.height}, ${info.bytes} bytes, bitDepth=${info.bitDepth} colorType=${info.colorType}`;
});

addCheck('ASSETS', 'A2', 'images/multihd_launcher.svg matches the Qt logo', () => {
  const p = path.join(TARGET, 'images/multihd_launcher.svg');
  if (!exists(p)) throw new Error('images/multihd_launcher.svg missing (CONTRACT §2/F13)');
  const actual = readText(p);
  if (!/<svg[\s>]/i.test(actual)) throw new Error('multihd_launcher.svg does not look like SVG');
  if (exists(QT_SVG)) {
    const qt = readText(QT_SVG);
    if (qt === actual) return 'byte-identical to /home/bismillah/QuestaLauncher/multihd_launcher.svg';
    const norm = s => s.replace(/\r\n/g, '\n').replace(/>\s+</g, '><').trim();
    if (norm(qt) === norm(actual)) return 'identical to Qt logo (whitespace-normalized)';
    // branded fallback per assignment: must be the MultiHD branding
    const branded = /MULTI/i.test(actual) && /HD LAUNCHER/i.test(actual) && /#00e5ff/i.test(actual);
    if (!branded) throw new Error('SVG differs from the Qt multihd_launcher.svg and does not carry the MultiHD branding (MULTI / HD LAUNCHER / #00e5ff)');
    throw new WarnError('SVG is branded like the Qt logo but not byte-identical (WARN)');
  }
  if (!/MULTI/i.test(actual) || !/HD LAUNCHER/i.test(actual)) throw new Error('SVG has no MultiHD branding text');
  return 'MultiHD-branded SVG (Qt reference file unavailable for byte comparison)';
});

addCheck('ASSETS', 'A3', 'no stale questa_launcher.svg / .png logo assets', () => {
  const stale = [];
  for (const name of ['questa_launcher.svg', 'questa_launcher.png', 'questaLauncher.svg']) {
    const p = path.join(TARGET, 'images', name);
    if (exists(p)) stale.push('images/' + name);
  }
  if (stale.length) throw new Error('stale logo asset(s) still present (F13 forbids questa_launcher branding outside archival notes):\n  ' + stale.join('\n  '));
  return 'no stale questa_launcher image assets';
});

// ══════════════════════════════════════════════════════════════════════════
// GROUP: DOCS  (CONTRACT §2, F13)
// ══════════════════════════════════════════════════════════════════════════

function docPath(name) { return path.join(TARGET, name); }

addCheck('DOCS', 'D1', 'README retitled MultiHD Launcher with archival note', () => {
  const p = docPath('README.md');
  if (!exists(p)) throw new Error('README.md missing');
  const text = readText(p);
  const errs = [];
  if (!/^#\s+MultiHD Launcher/m.test(text)) errs.push('README title is not "# MultiHD Launcher"');
  if (!/previously|formerly|renamed|archival/i.test(text)) errs.push('README has no short archival note (previously QuestaLauncher / VSQuestaLauncher) required by CONTRACT §2');
  if (/\bQuesta Launcher\b/.test(text) && !/previously|formerly|renamed|archival/i.test(text)) errs.push('stale "Questa Launcher" title without archival framing');
  if (errs.length) throw new Error(errs.join('\n'));
  return 'README retitled with archival rename note';
});

addCheck('DOCS', 'D2', 'DEPENDENCY.md and COMMANDS.md retitled', () => {
  const errs = [];
  for (const f of ['DEPENDENCY.md', 'COMMANDS.md']) {
    const p = docPath(f);
    if (!exists(p)) { errs.push(f + ' missing'); continue; }
    const text = readText(p);
    if (!/^#\s+MultiHD Launcher/m.test(text) && !/MultiHD Launcher/.test(text.split('\n')[0])) errs.push(`${f} title is not MultiHD Launcher: ${JSON.stringify(text.split('\n')[0])}`);
  }
  if (errs.length) throw new Error(errs.join('\n'));
  return 'both project docs retitled';
});

addCheck('DOCS', 'D3', 'markdown image/link references resolve on disk', () => {
  const errs = [];
  for (const f of ['README.md', 'DEPENDENCY.md', 'COMMANDS.md']) {
    const p = docPath(f);
    if (!exists(p)) continue;
    const text = readText(p);
    const refs = [];
    const imgRe = /<img[^>]*src="([^"]+)"/g;
    const mdRe = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g;
    let m;
    while ((m = imgRe.exec(text))) refs.push(m[1]);
    while ((m = mdRe.exec(text))) refs.push(m[1]);
    for (const ref of refs) {
      if (/^(https?:|mailto:|#)/i.test(ref)) continue;
      const clean = ref.split('#')[0];
      if (!clean) continue;
      const target = path.resolve(path.dirname(p), clean);
      if (!exists(target)) errs.push(`${f}: broken reference ${JSON.stringify(ref)} (missing ${rel(target)})`);
    }
  }
  if (errs.length) throw new Error(errs.join('\n'));
  return 'all relative markdown image/link targets exist';
});

addCheck('DOCS', 'D4', 'artifact naming: multihd-launcher-2.0.0.vsix documented', () => {
  const errs = [];
  const docs = ['README.md', 'COMMANDS.md', 'DEPENDENCY.md'].filter(f => exists(docPath(f)));
  const all = docs.map(f => readText(docPath(f))).join('\n');
  if (!/multihd-launcher-2\.0\.0\.vsix/.test(all)) errs.push('docs never mention the deliverable artifact "multihd-launcher-2.0.0.vsix"');
  if (!/v?2\.0\.0/.test(all)) errs.push('docs never mention version 2.0.0');
  // stale artifact instructions outside archival notes
  const stale = [];
  for (const f of docs) {
    const lines = readText(docPath(f)).split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!/questa-launcher-\d+\.\d+\.\d+\.vsix/.test(line)) continue;
      if (/previously|formerly|renamed|archival|legacy|old\b|history/i.test(line)) continue;
      stale.push(`${f}:${i + 1} ${line.trim()}`);
    }
  }
  if (stale.length) errs.push('stale artifact instructions:\n  ' + stale.join('\n  '));
  if (errs.length) throw new Error(errs.join('\n'));
  return 'docs reference multihd-launcher-2.0.0.vsix and v2.0.0';
});

addCheck('DOCS', 'D5', 'docs describe the new feature surface', () => {
  const text = ['README.md', 'COMMANDS.md', 'DEPENDENCY.md'].filter(f => exists(docPath(f))).map(f => readText(docPath(f))).join('\n');
  const missing = [];
  for (const [re, label] of [
    [/Quartus/i, 'Quartus Prime'],
    [/Gowin/i, 'Gowin EDA'],
    [/CST|constraint/i, 'Gowin constraint editor'],
    [/[Ll]ibrary/, 'library manager'],
    [/[Ee]xclu|[Dd]isinclude/, 'per-file exclusion'],
    [/[Cc]onfig/, 'configuration'],
    [/[Ii]nstall/, 'install helpers']
  ]) if (!re.test(text)) missing.push(label);
  if (missing.length) throw new Error('docs do not mention: ' + missing.join(', '));
  return 'docs cover Quartus/Gowin/CST/library/exclusion/config/install';
});

addCheck('DOCS', 'D6', 'deliverable .vsix present in repo (validated when present)', () => {
  const artifacts = fs.readdirSync(TARGET).filter(f => /^multihd-launcher-\d+\.\d+\.\d+\.vsix$/.test(f));
  if (artifacts.length === 0) throw new WarnError('no multihd-launcher-*.vsix in repo root yet — Lead packages at the end (P1 builds to a temp dir)');
  const wanted = 'multihd-launcher-2.0.0.vsix';
  if (!artifacts.includes(wanted)) throw new WarnError(`found ${artifacts.join(', ')}, expected ${wanted}`);
  return `artifact present: ${wanted} (${fs.statSync(path.join(TARGET, wanted)).size} bytes)`;
});

addCheck('DOCS', 'D7', 'LICENSE file present (vsce metadata)', () => {
  if (!exists(path.join(TARGET, 'LICENSE'))) throw new Error('LICENSE file missing');
  return 'LICENSE present';
});

// ══════════════════════════════════════════════════════════════════════════
// GROUP: BUILD (F14)
// ══════════════════════════════════════════════════════════════════════════

addCheck('BUILD', 'B1', '`npm run compile` exits cleanly (strict TS)', () => {
  if (OPTS.skipBuild) {
    ctx.build = { ok: exists(path.join(OUT_DIR, 'extension.js')), out: '', err: '--skip-build', code: 0 };
    return 'skipped via --skip-build (existing out/ used)';
  }
  const r = sh('npm', ['run', 'compile'], { timeout: 300000 });
  ctx.build = { ok: r.code === 0, out: r.out, err: r.err, code: r.code };
  const diagnostics = (r.out + '\n' + r.err).split('\n').filter(l => /error TS\d+/.test(l));
  if (r.code !== 0 || diagnostics.length) {
    const lines = diagnostics.slice(0, 20);
    throw new Error(`compile FAILED (exit ${r.code}, ${diagnostics.length} TS error(s)):\n` + (lines.length ? lines.join('\n') : (r.out + '\n' + r.err).split('\n').slice(-12).join('\n')));
  }
  const outEntry = path.join(OUT_DIR, 'extension.js');
  if (!exists(outEntry)) throw new Error('compile reported success but out/extension.js is missing');
  return `tsc clean (exit 0); out/extension.js ${fs.statSync(outEntry).size} bytes`;
});

addCheck('BUILD', 'B2', 'compiled entry registers every manifest command', () => {
  requireBuildOk();
  const entry = path.join(OUT_DIR, 'extension.js');
  if (!exists(entry)) throw new Error('out/extension.js missing');
  const text = readText(entry);
  const registered = new Set();
  // Command ids may be registered directly (vscode.commands.registerCommand) or via
  // helpers such as registerFileCommand/registerSimpleCommand (contract §4 layout).
  const re = /(?:registerCommand|[Rr]egister[A-Za-z]*Command)\s*\(\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(text))) registered.add(m[1]);
  const expected = Object.keys(EXPECTED_COMMANDS);
  const missing = expected.filter(id => !registered.has(id));
  if (missing.length) throw new Error('extension.js does not register: ' + missing.join(', '));
  if (registered.size < expected.length) throw new Error(`only ${registered.size} registerCommand occurrences found (expected >= ${expected.length})`);
  return `${registered.size} registerCommand() occurrences; all ${expected.length} manifest commands registered`;
});

addCheck('BUILD', 'B3', 'out/tools modules exist and load in plain Node (vscode-free)', () => {
  requireBuildOk();
  const expected = ['util', 'questa', 'quartus', 'gowin', 'library'];
  const missing = expected.filter(n => !exists(path.join(OUT_DIR, 'tools', n + '.js')));
  if (missing.length) throw new Error('missing compiled tool modules: out/tools/' + missing.join('.js, out/tools/') + '.js (CONTRACT §6/§7.2)');
  const srcTools = walk(path.join(TARGET, 'src', 'tools'), p => p.endsWith('.ts'));
  const leaks = [];
  for (const f of srcTools) {
    const t = readText(f);
    if (/from\s+['"]vscode['"]/.test(t) || /require\(\s*['"]vscode['"]\s*\)/.test(t)) leaks.push(rel(f));
  }
  if (leaks.length) throw new Error('src/tools must be vscode-free (CONTRACT §6): ' + leaks.join(', '));
  // plain-node load (no stub) proves vscode-free at runtime
  const loaded = [];
  for (const n of expected) { loadToolModule(n); loaded.push(n); }
  return `loaded ${loaded.join(', ')} in plain Node without a vscode stub`;
});

addCheck('BUILD', 'B4', 'out/ui panels exist and export the frozen show*Panel functions', () => {
  requireBuildOk();
  const panels = [
    ['launcherPanel', 'showLauncherPanel'],
    ['configPanel', 'showConfigPanel'],
    ['excludePanel', 'showExcludePanel'],
    ['priorityPanel', 'showPriorityPanel'],
    ['cstPanel', 'showCstPanel'],
    ['libraryPanel', 'showLibraryPanel']
  ];
  const errs = [];
  for (const [file, fn] of panels) {
    const p = path.join(OUT_DIR, 'ui', file + '.js');
    if (!exists(p)) { errs.push(`missing out/ui/${file}.js`); continue; }
    let mod;
    try { mod = requireWithVscodeStub(p); } catch (e) { errs.push(`out/ui/${file}.js failed to load with vscode stub: ${e.message}`); continue; }
    const found = (typeof mod[fn] === 'function') || (mod.default && typeof mod.default[fn] === 'function');
    if (!found) errs.push(`out/ui/${file}.js does not export ${fn}()`);
  }
  const entry = path.join(OUT_DIR, 'extension.js');
  if (exists(entry)) {
    try {
      const mod = requireWithVscodeStub(entry);
      if (typeof mod.activate !== 'function') errs.push('out/extension.js does not export activate()');
      if (typeof mod.deactivate !== 'function' && mod.deactivate !== undefined) errs.push('out/extension.js deactivate export is not a function');
    } catch (e) { errs.push('out/extension.js failed to load with vscode stub: ' + e.message); }
  } else errs.push('out/extension.js missing');
  if (errs.length) throw new Error(errs.join('\n'));
  return `${panels.length} panels export their frozen host entry points; extension exports activate()`;
});

addCheck('BUILD', 'B5', 'frozen models.ts / ui/api.ts contract types present', () => {
  const models = path.join(TARGET, 'src', 'models.ts');
  const api = path.join(TARGET, 'src', 'ui', 'api.ts');
  if (!exists(models)) throw new Error('src/models.ts missing (CONTRACT §7.1)');
  if (!exists(api)) throw new Error('src/ui/api.ts missing (CONTRACT §7.3)');
  const mt = readText(models);
  const mtMissing = ['TargetTool', 'SvConf', 'ProjectInfo', 'ConfigValues', 'LogKind', 'LaunchContext'].filter(n => !new RegExp(`\\b${n}\\b`).test(mt));
  const apiText = readText(api);
  const apiMissing = ['LauncherState', 'LauncherAction', 'LauncherHost', 'LauncherPanelHandle', 'ConfigHost', 'ExcludeHost', 'PriorityHost', 'CstHost', 'LibraryHost'].filter(n => !new RegExp(`\\b${n}\\b`).test(apiText));
  const errs = [];
  if (mtMissing.length) errs.push('src/models.ts missing exported names: ' + mtMissing.join(', '));
  if (apiMissing.length) errs.push('src/ui/api.ts missing contract types: ' + apiMissing.join(', '));
  if (errs.length) throw new Error(errs.join('\n'));
  return 'models.ts + ui/api.ts frozen type surface present';
});

// ══════════════════════════════════════════════════════════════════════════
// GROUP: FEATURE SURFACE (F1–F13 static checks on compiled output)
// ══════════════════════════════════════════════════════════════════════════

function uiCorpus() {
  const files = compiledCorpus().files.filter(f => /\/ui\//.test(f.file.replace(/\\/g, '/')));
  assert(files.length > 0, 'no compiled out/ui/*.js files');
  return files.map(f => f.text).join('\n');
}

addCheck('SURFACE', 'F1', 'launcher panel contains the Qt main-window feature set', () => {
  requireBuildOk();
  const text = uiCorpus();
  const missing = [];
  for (const [re, label] of UI_STRINGS.launcher) { re.lastIndex = 0; if (!re.test(text)) missing.push(label); }
  if (missing.length) throw new Error('launcher panel is missing:\n  - ' + missing.join('\n  - '));
  return `${UI_STRINGS.launcher.length} launcher UI invariants present`;
});

addCheck('SURFACE', 'F2', 'config panel contains the 7 Qt fields + license banner', () => {
  requireBuildOk();
  const text = uiCorpus();
  const missing = [];
  for (const [re, label] of UI_STRINGS.config) { re.lastIndex = 0; if (!re.test(text)) missing.push(label); }
  if (missing.length) throw new Error('config panel is missing:\n  - ' + missing.join('\n  - '));
  return `${UI_STRINGS.config.length} config UI invariants present`;
});

addCheck('SURFACE', 'F3', 'license guard wired (blocked launch + config affordance)', () => {
  requireBuildOk();
  const text = corpusText();
  const missing = [];
  if (!/\[Questa\]\s*BLOCKED/.test(text)) missing.push('log line "[Questa] BLOCKED"');
  if (!/no license/i.test(text)) missing.push('no-license message');
  if (!/LICENSE NOT SET|license.*not.*set/i.test(text)) missing.push('license-not-set state');
  if (missing.length) throw new Error('license guard surface missing:\n  - ' + missing.join('\n  - '));
  return 'license guard strings + warning state present (behaviour reviewed in Phase B)';
});

addCheck('SURFACE', 'F4', 'compile-order panel has Qt dialog controls', () => {
  requireBuildOk();
  const text = uiCorpus();
  const missing = [];
  for (const [re, label] of UI_STRINGS.priority) { re.lastIndex = 0; if (!re.test(text)) missing.push(label); }
  if (missing.length) throw new Error('compile-order UI missing:\n  - ' + missing.join('\n  - '));
  return 'REVERSE / RESET / DONE / badge semantics present';
});

addCheck('SURFACE', 'F5', 'exclusion panel has checklists + quick selects + chips', () => {
  requireBuildOk();
  const text = uiCorpus();
  const missing = [];
  for (const [re, label] of UI_STRINGS.exclude) { re.lastIndex = 0; if (!re.test(text)) missing.push(label); }
  if (missing.length) throw new Error('exclusion UI missing:\n  - ' + missing.join('\n  - '));
  return 'quick-selects / DISINCLUDE badge / restore chips present';
});

addCheck('SURFACE', 'F6', 'Questa launch flow wired (GUI spawn + env + run.do)', () => {
  requireBuildOk();
  const text = corpusText();
  const errs = [];
  for (const [re, label] of [
    [/-gui/, "vsim '-gui' spawn flag"],
    [/-do/, "vsim '-do' argument"],
    [/LM_LICENSE_FILE/, 'LM_LICENSE_FILE env'],
    [/SALT_LICENSE_SERVER/, 'SALT_LICENSE_SERVER env'],
    [/MTI_VCO_MODE/, 'MTI_VCO_MODE env'],
    [/legacy.*vsim|vsimPath/, 'vsimPath setting usage'],
    [/run\.do/, 'run.do generation']
  ]) if (!re.test(text)) errs.push('missing ' + label);
  if (errs.length) throw new Error(errs.join('\n'));
  return 'Questa GUI spawn + env vars + run.do wiring present';
});

addCheck('SURFACE', 'F7', 'Quartus Prime flow wired (.qpf/.qsf/.sdc/output_files)', () => {
  requireBuildOk();
  const text = corpusText();
  const missing = [];
  for (const [re, label] of [[/\.qpf/, '.qpf'], [/\.qsf/, '.qsf'], [/\.sdc/, '.sdc'], [/output_files/, 'output_files/'], [/quartus/i, 'quartus binary']]) {
    if (!re.test(text)) missing.push(label);
  }
  if (missing.length) throw new Error('Quartus surface missing: ' + missing.join(', '));
  return 'Quartus generator + launch path present (goldens G6–G10)';
});

addCheck('SURFACE', 'F8', 'Gowin EDA flow wired (.cst/.f/.gprj/impl/pnr + devices)', () => {
  requireBuildOk();
  const text = corpusText();
  const missing = [];
  for (const [re, label] of [[/\.gprj/, '.gprj'], [/\.cst/, '.cst'], [/impl\/pnr/, 'impl/pnr/'], [/gw_ide/, 'gw_ide binary']]) {
    if (!re.test(text)) missing.push(label);
  }
  const devices = ['GW1NR-LV9QN88PC6/I5', 'GW1N-LV1QN48C6/I5', 'GW1NSR-LV4CQN48PC7/I6', 'GW2AR-LV18QN88C8/I7', 'GW1N-LV4LQ144C6/I5', 'GW5A-LV25MG121NES'];
  const missingDev = devices.filter(d => !text.includes(d));
  if (missingDev.length) missing.push('device PN strings: ' + missingDev.join(', '));
  if (missing.length) throw new Error('Gowin surface missing: ' + missing.join(', '));
  return 'Gowin generators + device table + launch path present (goldens G11–G21)';
});

addCheck('SURFACE', 'F9', 'library manager wired (registry/work dbs/project deps/-L)', () => {
  requireBuildOk();
  const text = corpusText();
  const missing = [];
  for (const [re, label] of [
    [/questa_libs\.json/, 'questa_libs.json'],
    [/registry\.json/, 'registry.json'],
    [/\.questa_libs/, '~/.questa_libs root'],
    [/vlib/, 'vlib'],
    [/vlog/, 'vlog'],
    [/"-L"|'-L'/, '-L link flags']
  ]) if (!re.test(text)) missing.push(label);
  if (missing.length) throw new Error('library-manager surface missing: ' + missing.join(', '));
  return 'library registry/deps/compile surface present (behavioural tests G22–G27)';
});

addCheck('SURFACE', 'F10', 'install/license helpers open the exact Qt URLs', () => {
  requireBuildOk();
  const text = corpusText();
  const missing = EXPECTED_URLS.filter(u => !text.includes(u));
  if (missing.length) throw new Error('exact Qt URLs missing from compiled output:\n  ' + missing.join('\n  '));
  return 'both exact Intel URLs present';
});

addCheck('SURFACE', 'F11', 'webviews use the frozen dark-cyber palette (F11)', () => {
  requireBuildOk();
  const text = uiCorpus();
  const missing = THEME_TOKENS.filter(t => !text.includes(t));
  if (missing.length) throw new Error('palette tokens missing from out/ui/*.js: ' + missing.join(', '));
  const extras = [];
  if (!/linear-gradient\(90deg,\s*#0057a8,\s*#00b4d8\)|#0057a8.*#00b4d8/i.test(text)) extras.push('launch gradient #0057a8→#00b4d8');
  if (!/rgba\(\s*0\s*,\s*229\s*,\s*255/i.test(text)) extras.push('cyan grid/brackets rgba(0,229,255,…)');
  if (!/rgba\(\s*0\s*,\s*180\s*,\s*255|box-shadow/i.test(text)) extras.push('glow rgba(0,180,255,…)/box-shadow');
  if (!/monospace|Courier New/i.test(text)) extras.push('monospace font');
  if (extras.length) throw new Error('theme detail missing: ' + extras.join(', '));
  return 'palette + gradient + grid/bracket + glow + monospace present';
});

addCheck('SURFACE', 'F12', 'preserved v1.9.1 features + runtime legacy aliases (F12)', () => {
  requireBuildOk();
  const entry = readText(path.join(OUT_DIR, 'extension.js'));
  const errs = [];
  for (const id of EXPECTED_LEGACY_ALIASES) {
    if (!entry.includes(`'${id}'`) && !entry.includes(`"${id}"`)) errs.push(`legacy alias not registered in extension.js: ${id}`);
  }
  const map = manifestCommands();
  for (const id of ['multihdLauncher.run', 'multihdLauncher.runGui', 'multihdLauncher.showWaveform', 'multihdLauncher.editConf', 'multihdLauncher.helpDocs', 'multihdLauncher.helpDeps']) {
    if (!map.has(id)) errs.push('preserved command missing from manifest: ' + id);
  }
  const text = corpusText();
  if (!/quit -f/.test(text)) errs.push('CLI run.do variant ("quit -f") missing');
  if (!/wave\.do|vsim\.wlf|wlf/.test(text)) errs.push('Show WaveForm support missing');
  if (!/conf\.svconf/.test(text)) errs.push('conf.svconf support missing');
  if (errs.length) throw new Error(errs.join('\n'));
  return 'run/runGui/showWaveform/editConf/help* preserved; 9 legacy aliases registered; conf.svconf intact';
});

addCheck('SURFACE', 'F13', 'new webviews are CSP-guarded (CONTRACT §10)', () => {
  requireBuildOk();
  const uiDir = path.join(OUT_DIR, 'ui');
  const baseP = path.join(uiDir, 'base.js');
  if (!exists(baseP)) throw new Error('out/ui/base.js (shared webview shell) missing');
  const base = readText(baseP);
  const errs = [];
  if (!/Content-Security-Policy/.test(base)) errs.push('shared webview shell (out/ui/base.js) has no Content-Security-Policy <meta>');
  if (!/nonce/i.test(base)) errs.push('shared webview shell CSP does not use a script nonce');
  const panels = ['launcherPanel', 'configPanel', 'excludePanel', 'priorityPanel', 'cstPanel', 'libraryPanel'];
  const inlineHits = [];
  for (const name of panels) {
    const p = path.join(uiDir, name + '.js');
    if (!exists(p)) { errs.push(`missing out/ui/${name}.js`); continue; }
    const t = readText(p);
    if (!/require\(['"]\.\/base['"]\)/.test(t) && !/Content-Security-Policy/.test(t)) {
      errs.push(`${name}.js does not use the shared CSP shell (out/ui/base.js)`);
    }
    const re = /\son(?:click|change|input|submit|load)\s*=/g;
    if (re.test(t)) inlineHits.push(name + '.js');
  }
  if (errs.length) throw new Error(errs.join('\n'));
  if (inlineHits.length) throw new WarnError('CSP shell present but inline event handlers remain in new panel(s): ' + inlineHits.join(', ') + ' (CONTRACT §10 prefers nonce scripts)');
  return 'shared nonce CSP shell + 6 panels wired through it, no inline handlers';
});

// ══════════════════════════════════════════════════════════════════════════
// GROUP: STALE-NAME SCAN (F13)
// ══════════════════════════════════════════════════════════════════════════

function staleScanFiles() {
  const files = [];
  for (const f of ['package.json', 'README.md', 'COMMANDS.md', 'DEPENDENCY.md']) {
    const p = path.join(TARGET, f);
    if (exists(p)) files.push(p);
  }
  const srcFiles = walk(path.join(TARGET, 'src'), p => p.endsWith('.ts'));
  // out/ is only trustworthy after a clean compile (B1). Stale compiled v1.9.1 files would
  // otherwise produce false positives — the source tree is authoritative until then.
  const outFiles = (ctx.build.ok === true && exists(OUT_DIR)) ? walk(OUT_DIR, p => p.endsWith('.js') && !p.endsWith('.map')) : [];
  const assetFiles = walk(path.join(TARGET, 'images'), p => p.endsWith('.svg'));
  const synFiles = walk(path.join(TARGET, 'syntaxes'), p => p.endsWith('.json'));
  return files.concat(srcFiles, outFiles, assetFiles, synFiles);
}

function nearestHeading(lines, idx) {
  const start = /^#{1,6}\s+/.test(lines[idx] || '') ? idx - 1 : idx;
  for (let i = start; i >= Math.max(0, start - 200); i--) {
    const m = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (m) return m[2];
  }
  return null;
}

function markdownSectionContext(lines, idx) {
  const heading = nearestHeading(lines, idx);
  if (heading && /changelog|history|archival|release|renam|upgrad|migrat|legacy/i.test(heading)) return true;
  return false;
}

function docArchivalWindow(lines, idx) {
  const win = lines.slice(Math.max(0, idx - 12), idx + 4).join('\n');
  return /archiv|original title|previously|formerly|renamed|legacy|old command|old setting|old version|history|changelog|upgrade|hidden.*registered|still registered/i.test(win);
}

function repoPathMention(line) {
  // The repository/working folder is literally named VSQuestaLauncher — not branding.
  return /Downloads[\\/]+VSQuestaLauncher/.test(line) ||
    /(?:^|[\s"'`(])VSQuestaLauncher[\\/]/.test(line) ||
    /[\\/]VSQuestaLauncher(?:$|[\s"'`)\\/])/.test(line) ||
    /(?:^|\s)cd\s+[^\n]*VSQuestaLauncher/.test(line) ||
    /VSQuestaLauncher\)\s*(?:source|project|repo)/i.test(line) ||
    /VSQuestaLauncher\s+(?:source|project|repo)\s+(?:directory|folder)/i.test(line);
}

function staleAllowance(line, file, lines, idx) {
  const f = file.replace(/\\/g, '/');
  if (/github\.com\/OpenNoorIlm\/VSQuestaLauncher/.test(line)) return true; // required actual remote (CONTRACT §2)
  if (/previously|formerly|renamed|rename|archival|legacy|migrat|URL continuity|old name|old id|old command|old setting|historical/i.test(line)) return true;
  if (/\.md$/i.test(f)) {
    if (markdownSectionContext(lines, idx)) return true;
    if (docArchivalWindow(lines, idx)) return true;
    // Legacy command-alias tables are explicitly archival documentation (CONTRACT §4/F13)
    if (/`questaLauncher\./.test(line) && /legacy alias/i.test(lines.join('\n'))) return true;
  }
  if (repoPathMention(line)) return true;
  // legacy runtime aliases / settings fallback: allow within a legacy/alias/fallback comment block (±4 lines)
  if (f.startsWith(TARGET + '/src') || f.startsWith(TARGET + '/out')) {
    const window = lines.slice(Math.max(0, idx - 30), idx + 3).join('\n');
    if (/legacy|alias|fallback|migrat/i.test(window)) return true;
  }
  if (/\.md$/i.test(f) && /^\s*[-*|]\s*v?1\.\d+/.test(line)) return true; // changelog table rows for old versions
  return false;
}

const STALE_PATTERNS = [
  { re: /VSQuestaLauncher/, label: 'VSQuestaLauncher' },
  { re: /\bQuesta Launcher\b/, label: 'Questa Launcher' },
  { re: /questa-launcher/i, label: 'questa-launcher slug' },
  { re: /questaLauncher\./, label: 'questaLauncher.* namespace' }
];

addCheck('STALE', 'S1', 'no stale Questa Launcher branding outside archival notes / legacy aliases (F13)', () => {
  const files = staleScanFiles();
  const flagged = [];
  for (const pat of STALE_PATTERNS) {
    flagged.push(...scanLines(files, pat.re, staleAllowance).map(h => Object.assign({ pattern: pat.label }, h)));
  }
  // de-duplicate by file:line
  const seen = new Set();
  const uniq = flagged.filter(h => {
    const k = h.file + ':' + h.line;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (uniq.length) {
    throw new Error(`${uniq.length} stale-branding hit(s) outside allowed archival/legacy contexts (F13):\n` + formatHits(uniq, 15));
  }
  return `scanned ${files.length} files — clean`;
});

addCheck('STALE', 'S2', 'manifest has no legacy namespace; aliases are runtime-only', () => {
  const pkg = getPkg();
  const errs = [];
  for (const id of Object.keys(EXPECTED_COMMANDS)) {
    if (!id.startsWith(EXPECTED_MANIFEST.commandPrefix)) errs.push(`command ${id} outside multihdLauncher namespace`);
  }
  for (const id of manifestCommands().keys()) {
    if (EXPECTED_LEGACY_ALIASES.includes(id)) errs.push(`legacy alias ${id} must NOT be in the manifest (runtime-only per CONTRACT §4)`);
  }
  const { properties } = manifestSettings();
  for (const key of Object.keys(properties)) {
    if (EXPECTED_LEGACY_ALIASES.some(a => a.startsWith(key))) errs.push(`legacy setting in manifest: ${key}`);
  }
  const text = readText(path.join(TARGET, 'package.json'));
  if (/questaLauncher\./.test(text)) errs.push('package.json contains questaLauncher.* namespace (must be runtime-only)');
  if (errs.length) throw new Error(errs.join('\n'));
  return 'manifest uses multihdLauncher.* only';
});

// ══════════════════════════════════════════════════════════════════════════
// GROUP: SECURITY / CORRECTNESS static scans (CONTRACT §10)
// ══════════════════════════════════════════════════════════════════════════

function srcFiles() { return walk(path.join(TARGET, 'src'), p => p.endsWith('.ts')); }

addCheck('SECURITY', 'X1', 'no spawn(..., { shell: true }) (command-injection risk)', () => {
  const hits = scanLines(srcFiles(), /shell\s*:\s*true/);
  if (hits.length) throw new Error('shell:true found — CONTRACT §10 forbids building shell command strings:\n' + formatHits(hits));
  return 'no shell:true in src/';
});

addCheck('SECURITY', 'X2', 'no dynamic child_process.exec/execSync command strings', () => {
  const hits = [];
  for (const f of srcFiles()) {
    const lines = readText(f).split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = /(?:child_process\.)?(?:execSync|exec)\s*\(/.exec(line);
      if (!m) continue;
      const ctxText = lines.slice(i, i + 4).join('\n');
      const open = ctxText.indexOf('(', m.index);
      const snippet = ctxText.slice(open, open + 320);
      if (/\$\{/.test(snippet) || /`/.test(snippet.slice(0, 200))) {
        hits.push({ file: rel(f), line: i + 1, text: line.trim() });
      }
    }
  }
  if (hits.length) throw new Error('dynamic exec/execSync command string — use spawn/execFile with an argv array (CONTRACT §10):\n' + formatHits(hits));
  return 'no template-literal exec/execSync in src/';
});

addCheck('SECURITY', 'X3', 'no eval / new Function', () => {
  const hits = scanLines(srcFiles(), /\beval\s*\(|new\s+Function\s*\(/);
  if (hits.length) throw new Error('eval/new Function found:\n' + formatHits(hits));
  return 'no eval/new Function';
});

addCheck('SECURITY', 'X4', 'POSIX-only `which` execSync usage replaced by portable argv lookup', () => {
  const hits = scanLines(srcFiles(), /execSync\s*\(\s*['"`]which/);
  if (hits.length) throw new WarnError('execSync("which …") is POSIX-only; prefer execFile("which"/"where",[…]) or a platform check:\n' + formatHits(hits));
  return 'no POSIX-only which execSync';
});

addCheck('SECURITY', 'X5', 'path building uses path.join (string "/" concatenation scan)', () => {
  const all = scanLines(srcFiles(), /['"]\/['"]\s*\+|\+\s*['"]\/['"]/);
  const hits = all.filter(h => {
    const t = h.text.trim();
    return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
  });
  if (hits.length) throw new WarnError(`${hits.length} string-concatenated path separator(s) found — prefer path.join (CONTRACT §10):\n` + formatHits(hits, 8));
  return 'no literal path-separator concatenation found in code';
});

// ══════════════════════════════════════════════════════════════════════════
// GROUP: PACKAGE (F14)
// ══════════════════════════════════════════════════════════════════════════

function resolveVsce() {
  const r1 = sh('vsce', ['--version'], { timeout: 60000 });
  if (r1.code === 0) return { exe: 'vsce', prefix: [], version: r1.out.trim() };
  const local = path.join(TARGET, 'node_modules', '.bin', 'vsce');
  if (exists(local)) {
    const r2 = sh(local, ['--version'], { timeout: 60000 });
    if (r2.code === 0) return { exe: local, prefix: [], version: r2.out.trim() };
  }
  const r3 = sh('npx', ['--yes', '@vscode/vsce', '--version'], { timeout: 180000 });
  if (r3.code === 0) return { exe: 'npx', prefix: ['--yes', '@vscode/vsce'], version: r3.out.trim() };
  return null;
}

addCheck('PACKAGE', 'P1', '`vsce package --no-dependencies` produces multihd-launcher-2.0.0.vsix', () => {
  if (OPTS.skipPackage) { ctx.package.ok = false; skip('--skip-package'); }
  requireBuildOk();
  const vsce = resolveVsce();
  if (!vsce) throw new Error('vsce not available (tried global `vsce`, node_modules/.bin/vsce, `npx @vscode/vsce`)');
  const outDir = tmpPath('package');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, EXPECTED_MANIFEST.name + '-' + EXPECTED_MANIFEST.version + '.vsix');
  const args = vsce.prefix.concat(['package', '--no-dependencies', '--out', outFile]);
  const r = sh(vsce.exe, args, { timeout: 300000 });
  ctx.package.out = (r.out || '') + '\n' + (r.err || '');
  if (r.code !== 0 || !exists(outFile)) {
    throw new Error(`vsce package failed (exit ${r.code})${exists(outFile) ? '' : ' — no .vsix produced'}:\n` + (r.out + '\n' + r.err).split('\n').slice(-20).join('\n'));
  }
  const size = fs.statSync(outFile).size;
  if (size < 1024) throw new Error(`produced .vsix is implausibly small (${size} bytes)`);
  ctx.package.ok = true;
  ctx.package.file = outFile;
  ctx.package.size = size;
  const errors = (r.out + '\n' + r.err).split('\n').filter(l => /^\s*ERROR/.test(l));
  if (errors.length) throw new WarnError(`vsce reported ERROR lines (packaging still produced a vsix):\n  ${errors.join('\n  ')}`);
  return `${path.basename(outFile)} (${size} bytes), vsce ${vsce.version}`;
});

addCheck('PACKAGE', 'P2', '.vsix contents include manifest, compiled code, icon, docs', () => {
  requirePackageOk();
  if (!unzipAvailable()) skip('system `unzip` not available — cannot inspect .vsix');
  const list = zipList(ctx.package.file);
  if (!list) throw new Error('could not list .vsix entries with unzip');
  const lower = list.map(n => n.toLowerCase());
  const need = [
    'extension/package.json',
    'extension/out/extension.js',
    'extension/images/icon.png'
  ];
  const missing = need.filter(n => !list.includes(n));
  // vsce normalises doc filenames (README.md -> readme.md, LICENSE -> LICENSE.txt)
  if (!lower.includes('extension/readme.md') && !list.includes('extension/README.md')) missing.push('extension/readme.md (packaged README)');
  if (!list.some(n => /^extension\/LICENSE(\.txt)?$/.test(n))) missing.push('extension/LICENSE(.txt)');
  if (missing.length) throw new Error('.vsix is missing required entries:\n  ' + missing.join('\n  '));
  const tools = ['questa', 'quartus', 'gowin', 'library'].filter(n => !list.includes('extension/out/tools/' + n + '.js'));
  if (tools.length) throw new Error('.vsix is missing compiled tools: ' + tools.join(', '));
  const stale = list.filter(n => /questa_launcher\.(svg|png)$/.test(n));
  if (stale.length) throw new Error('stale logo assets packaged in .vsix: ' + stale.join(', '));
  return `${list.length} entries; required files + tools present; no stale logo`;
});

addCheck('PACKAGE', 'P3', '.vsix manifest matches frozen identity', () => {
  requirePackageOk();
  if (!unzipAvailable()) skip('system `unzip` not available');
  const raw = zipRead(ctx.package.file, 'extension/package.json');
  if (!raw) throw new Error('could not read extension/package.json from .vsix');
  let pkg;
  try { pkg = JSON.parse(raw); } catch (e) { throw new Error('packaged package.json is not valid JSON: ' + e.message); }
  const errs = [];
  for (const k of ['name', 'displayName', 'version', 'publisher', 'icon']) {
    if (pkg[k] !== getPkg()[k]) errs.push(`${k}: packaged ${JSON.stringify(pkg[k])} != source ${JSON.stringify(getPkg()[k])}`);
  }
  if (!pkg.contributes || !Array.isArray(pkg.contributes.commands)) errs.push('packaged manifest lost contributes.commands');
  if (errs.length) throw new Error(errs.join('\n'));
  return `packaged manifest: ${pkg.name} v${pkg.version} "${pkg.displayName}" icon=${pkg.icon}`;
});

// ══════════════════════════════════════════════════════════════════════════
// GROUP: RUNTIME GOLDEN TESTS (plain-Node, vscode-free tools — F6/F7/F8/F9)
// ══════════════════════════════════════════════════════════════════════════

function tool(name) { return loadToolModule(name); }

function fnOf(moduleName, exportName) {
  const mod = tool(moduleName);
  if (typeof mod[exportName] !== 'function') {
    throw new Error(`out/tools/${moduleName}.js does not export ${exportName}() (frozen CONTRACT §7.2)`);
  }
  return mod[exportName];
}

function valueOf(moduleName, exportName) {
  const mod = tool(moduleName);
  if (mod[exportName] === undefined) throw new Error(`out/tools/${moduleName}.js does not export ${exportName} (frozen CONTRACT §7.2)`);
  return mod[exportName];
}

addCheck('RUNTIME', 'G1', 'util.isoNow(): local Qt::ISODate format, correct time window', () => {
  requireBuildOk();
  const isoNow = fnOf('util', 'isoNow');
  const v = isoNow();
  assert(typeof v === 'string', 'isoNow() must return a string');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(v)) throw new Error(`isoNow() returned ${JSON.stringify(v)}; expected local YYYY-MM-DDTHH:MM:SS (Qt::ISODate parity, no ms/zone)`);
  const parsed = new Date(v);
  if (isNaN(parsed.getTime())) throw new Error(`isoNow() returned an unparseable time: ${v}`);
  const drift = Math.abs(Date.now() - parsed.getTime());
  if (drift > 120000) throw new Error(`isoNow() differs from current local time by ${(drift / 1000).toFixed(1)}s (${v})`);
  return `isoNow()="${v}" (local, no zone/ms)`;
});

addCheck('RUNTIME', 'G2', 'Questa buildRunDo(): exact Qt run.do (basic fixture)', () => {
  requireBuildOk();
  const buildRunDo = fnOf('questa', 'buildRunDo');
  const ws = makeScenarioWorkspace('basic');
  const out = buildRunDo({
    dir: ws,
    files: SCENARIOS.basic.runDoFiles.slice(),
    topModule: SCENARIOS.basic.topModule,
    libs: [],
    libFlags: [],
    timestamp: TS,
    mode: 'gui'
  });
  if (typeof out !== 'string') throw new Error('buildRunDo() must return the run.do content string (CONTRACT §7.2)');
  assertNoCR('run.do', out);
  assertFileEquals(path.join(EXPECTED, 'basic', 'run.do'), out, 'run.do');
  return 'matches Qt generateRunDo() golden (header, vlib/vlog/vopt/vsim, add wave, run -all)';
});

addCheck('RUNTIME', 'G3', 'Questa buildRunDo(): dependency libs + -L flags (Qt parity)', () => {
  requireBuildOk();
  const buildRunDo = fnOf('questa', 'buildRunDo');
  const ws = makeScenarioWorkspace('basic');
  const out = buildRunDo({
    dir: ws,
    files: SCENARIOS.basic.runDoFiles.slice(),
    topModule: SCENARIOS.basic.topModule,
    libs: [{ name: 'uart_lib', workDbPath: '/home/u/.questa_libs/work/uart_lib', sourceFiles: ['/libs/uart/uart.sv', '/libs/uart/uart_pkg.sv'] }],
    libFlags: ['-L', '/home/u/.questa_libs/work/uart_lib'],
    timestamp: TS,
    mode: 'gui'
  });
  assertNoCR('run.do', out);
  assertFileEquals(path.join(EXPECTED, 'basic', 'run-with-libs.do'), out, 'run.do (with deps)');
  return 'per-dep vlog line + -L flags in vlog/vopt/vsim match Qt';
});

addCheck('RUNTIME', 'G4', 'Questa buildRunDo(): CLI variant preserved (no wave, quit -f)', () => {
  requireBuildOk();
  const buildRunDo = fnOf('questa', 'buildRunDo');
  const ws = makeScenarioWorkspace('basic');
  const out = buildRunDo({
    dir: ws,
    files: SCENARIOS.basic.runDoFiles.slice(),
    topModule: SCENARIOS.basic.topModule,
    libs: [],
    libFlags: [],
    timestamp: TS,
    mode: 'cli'
  });
  assertNoCR('run.do', out);
  assertFileEquals(path.join(EXPECTED, 'basic', 'run-cli.do'), out, 'run.do (cli)');
  if (/add wave/.test(out)) throw new Error('CLI run.do must not contain "add wave" (v1.9.1 CLI behaviour, F12)');
  if (!/quit -f\s*$/.test(out.trim() + '\n')) throw new Error('CLI run.do must end with "quit -f"');
  return 'CLI variant matches preserved v1.9.1 flow with Qt header';
});

addCheck('RUNTIME', 'G5', 'Questa writeRunDo(): writes <dir>/run.do and returns {path, content}', () => {
  requireBuildOk();
  const writeRunDo = fnOf('questa', 'writeRunDo');
  const ws = makeScenarioWorkspace('basic');
  const opts = {
    dir: ws,
    files: SCENARIOS.basic.runDoFiles.slice(),
    topModule: SCENARIOS.basic.topModule,
    libs: [],
    libFlags: [],
    timestamp: TS,
    mode: 'gui'
  };
  const res = writeRunDo(opts);
  assert(res && typeof res === 'object', 'writeRunDo() must return an object (CONTRACT §7.2)');
  assert(typeof res.path === 'string' && res.path.length > 0, 'writeRunDo().path missing');
  assert(typeof res.content === 'string' && res.content.length > 0, 'writeRunDo().content missing');
  const expectedPath = path.join(ws, 'run.do');
  if (path.resolve(res.path) !== path.resolve(expectedPath)) throw new Error(`writeRunDo().path expected ${expectedPath}, got ${res.path}`);
  if (!exists(expectedPath)) throw new Error('writeRunDo() did not create run.do on disk');
  const disk = readText(expectedPath);
  assertFileEquals(path.join(EXPECTED, 'basic', 'run.do'), disk, 'run.do on disk');
  compareText('writeRunDo().content', readGolden('basic/run.do'), res.content);
  return 'run.do written and returned content matches golden';
});

function quartusOptsFor(name) {
  const s = SCENARIOS[name];
  const ws = makeScenarioWorkspace(name);
  return { ws, opts: { dir: ws, projectName: s.projectName, activeFiles: s.quartusActive.slice(), timestamp: TS } };
}

addCheck('RUNTIME', 'G6', 'Quartus buildQuartusContents(): exact .qpf/.qsf/.sdc (basic)', () => {
  requireBuildOk();
  const buildQuartusContents = fnOf('quartus', 'buildQuartusContents');
  const { opts } = quartusOptsFor('basic');
  const res = buildQuartusContents(opts);
  assert(res && typeof res === 'object', 'buildQuartusContents() must return {qpf,qsf,sdc,topEntity}');
  for (const k of ['qpf', 'qsf', 'sdc']) assert(typeof res[k] === 'string', `buildQuartusContents().${k} missing/not a string`);
  assertNoCR('qpf', res.qpf); assertNoCR('qsf', res.qsf); assertNoCR('sdc', res.sdc);
  assertFileEquals(path.join(EXPECTED, 'basic', 'quartus', 'basic.qpf'), res.qpf, '.qpf');
  assertFileEquals(path.join(EXPECTED, 'basic', 'quartus', 'basic.qsf'), res.qsf, '.qsf');
  assertFileEquals(path.join(EXPECTED, 'basic', 'quartus', 'basic.sdc'), res.sdc, '.sdc');
  if (res.topEntity !== 'beta') throw new Error(`topEntity expected "beta" (last non-tb active file), got ${JSON.stringify(res.topEntity)}`);
  return '.qpf/.qsf/.sdc + topEntity match Qt generateQuartusFiles() goldens';
});

addCheck('RUNTIME', 'G7', 'Quartus buildQuartusContents(): exclusions applied (a.sv + c_tb.sv)', () => {
  requireBuildOk();
  const buildQuartusContents = fnOf('quartus', 'buildQuartusContents');
  const { opts } = quartusOptsFor('exclusions');
  const res = buildQuartusContents(opts);
  assertFileEquals(path.join(EXPECTED, 'exclusions', 'quartus', 'exclusions.qpf'), res.qpf, '.qpf (exclusions)');
  assertFileEquals(path.join(EXPECTED, 'exclusions', 'quartus', 'exclusions.qsf'), res.qsf, '.qsf (exclusions)');
  assertFileEquals(path.join(EXPECTED, 'exclusions', 'quartus', 'exclusions.sdc'), res.sdc, '.sdc (exclusions)');
  if (res.topEntity !== 'a') throw new Error(`topEntity expected "a", got ${JSON.stringify(res.topEntity)}`);
  return 'excluded-file list produces the Qt-derived .qsf (b.sv absent)';
});

addCheck('RUNTIME', 'G8', 'Quartus buildQuartusContents(): project name + top entity rules (priority)', () => {
  requireBuildOk();
  const buildQuartusContents = fnOf('quartus', 'buildQuartusContents');
  const { opts } = quartusOptsFor('priority');
  const res = buildQuartusContents(opts);
  assertFileEquals(path.join(EXPECTED, 'priority', 'quartus', 'priority.qpf'), res.qpf, '.qpf (priority)');
  assertFileEquals(path.join(EXPECTED, 'priority', 'quartus', 'priority.qsf'), res.qsf, '.qsf (priority)');
  assertFileEquals(path.join(EXPECTED, 'priority', 'quartus', 'priority.sdc'), res.sdc, '.sdc (priority)');
  if (res.topEntity !== 'y') throw new Error(`topEntity expected "y" (last non-tb in active order), got ${JSON.stringify(res.topEntity)}`);
  return 'project name from dir + topEntity from last non-tb file';
});

addCheck('RUNTIME', 'G9', 'Quartus generateQuartusFiles(): writes files + creates output_files/', () => {
  requireBuildOk();
  const generateQuartusFiles = fnOf('quartus', 'generateQuartusFiles');
  const { ws, opts } = quartusOptsFor('basic');
  const res = generateQuartusFiles(opts);
  assert(res && typeof res === 'object', 'generateQuartusFiles() must return GenerationResult');
  assert(Array.isArray(res.written), 'GenerationResult.written must be an array');
  for (const f of ['basic.qpf', 'basic.qsf', 'basic.sdc']) {
    if (!resultHasPath(res.written, f)) throw new Error(`GenerationResult.written does not include ${f}: ${JSON.stringify(res.written.map(basenameAny))}`);
    const disk = path.join(ws, f);
    if (!exists(disk)) throw new Error(`${f} was reported written but is missing on disk`);
  }
  assertFileEquals(path.join(EXPECTED, 'basic', 'quartus', 'basic.qpf'), readText(path.join(ws, 'basic.qpf')), '.qpf on disk');
  assertFileEquals(path.join(EXPECTED, 'basic', 'quartus', 'basic.qsf'), readText(path.join(ws, 'basic.qsf')), '.qsf on disk');
  assertFileEquals(path.join(EXPECTED, 'basic', 'quartus', 'basic.sdc'), readText(path.join(ws, 'basic.sdc')), '.sdc on disk');
  const dirs = (res.dirs || []).map(d => String(d).replace(/\\/g, '/'));
  if (!dirs.some(d => d.endsWith('output_files'))) throw new Error(`GenerationResult.dirs should report output_files/, got ${JSON.stringify(res.dirs)}`);
  if (!exists(path.join(ws, 'output_files')) || !fs.statSync(path.join(ws, 'output_files')).isDirectory()) throw new Error('output_files/ directory was not created on disk');
  return `wrote qpf/qsf/sdc and created output_files/ (${res.written.length} written entries)`;
});

addCheck('RUNTIME', 'G10', 'Quartus generateQuartusFiles(): existing .sdc not overwritten (Qt rule)', () => {
  requireBuildOk();
  const generateQuartusFiles = fnOf('quartus', 'generateQuartusFiles');
  const { ws, opts } = quartusOptsFor('basic');
  const sentinel = '# hand-edited SDC — must be preserved\ncreate_clock -period 20.000 -name clk [get_ports clk]\n';
  const sdcPath = path.join(ws, 'basic.sdc');
  fs.writeFileSync(sdcPath, sentinel, 'utf8');
  const res = generateQuartusFiles(opts);
  if (!exists(sdcPath)) throw new Error('.sdc disappeared');
  if (readText(sdcPath) !== sentinel) throw new Error('.sdc was overwritten — Qt only writes the template when the file is absent (mainwindow.cpp:738-762)');
  const skipped = (res.skipped || []).map(basenameAny).filter(Boolean);
  const written = (res.written || []).map(basenameAny).filter(Boolean);
  if (!skipped.includes('basic.sdc') && written.includes('basic.sdc')) {
    throw new Error(`GenerationResult should report basic.sdc as skipped, got skipped=${JSON.stringify(skipped)} written=${JSON.stringify(written)}`);
  }
  return 'existing .sdc preserved; reported via skipped[]';
});

addCheck('RUNTIME', 'G11', 'Gowin parsePorts(): Qt regex on beta.sv', () => {
  requireBuildOk();
  const parsePorts = fnOf('gowin', 'parsePorts');
  const svText = readText(path.join(PROJECTS, 'basic', 'beta.sv'));
  const res = parsePorts(svText);
  assert(Array.isArray(res), 'parsePorts() must return an array');
  const expected = JSON.parse(readGolden('basic/ports.json'));
  const normalized = res.map(p => ({ name: p.name, direction: p.direction, width: p.width || '' }));
  try { assert(JSON.stringify(normalized) === JSON.stringify(expected), 'port list mismatch'); }
  catch (e) {
    throw new Error(`parsePorts(beta.sv) mismatch.\nexpected: ${JSON.stringify(expected)}\nactual:   ${JSON.stringify(normalized)}`);
  }
  return `parsed ${res.length} ports: ${normalized.map(p => p.name).join(', ')}`;
});

addCheck('RUNTIME', 'G12', 'Gowin parsePorts(): comments/widths/inout/dedupe/keyword filtering (top.sv)', () => {
  requireBuildOk();
  const parsePorts = fnOf('gowin', 'parsePorts');
  const svText = readText(path.join(PROJECTS, 'gowin-ports', 'top.sv'));
  const res = parsePorts(svText).map(p => ({ name: p.name, direction: p.direction, width: p.width || '' }));
  const expected = JSON.parse(readGolden('gowin-ports/ports.json'));
  // Qt parser also matches identifiers inside `module`/`endmodule`-free text; compare names+directions+widths.
  try { assert(JSON.stringify(res) === JSON.stringify(expected), 'port list mismatch'); }
  catch (e) {
    throw new Error(`parsePorts(top.sv) mismatch.\nexpected: ${JSON.stringify(expected)}\nactual:   ${JSON.stringify(res)}`);
  }
  return `parsed ${res.length} ports incl. inout/width/keywords: ${res.map(p => p.name).join(', ')}`;
});

addCheck('RUNTIME', 'G13', 'Gowin parsePorts(): empty and dedupe edge cases', () => {
  requireBuildOk();
  const parsePorts = fnOf('gowin', 'parsePorts');
  const empty = parsePorts('// no ports here\nmodule m;\nendmodule\n');
  assert(Array.isArray(empty) && empty.length === 0, 'comment/keyword-only text must yield []');
  const dup = parsePorts('module m(input clk, input clk, output y);\nendmodule\n').map(p => ({ name: p.name, direction: p.direction, width: p.width || '' }));
  if (dup.length !== 2 || dup[0].name !== 'clk' || dup[1].name !== 'y') {
    throw new Error('duplicate port names must be de-duplicated by name (Qt QSet "seen"): got ' + JSON.stringify(dup));
  }
  const blockComment = parsePorts('/* input hidden */\nmodule m(output o);\nendmodule\n').map(p => p.name);
  if (blockComment.includes('hidden')) throw new Error('block comments must be stripped before port parsing');
  return 'empty list, dedupe, comment stripping behave like Qt parsePorts()';
});

addCheck('RUNTIME', 'G14', 'Gowin buildCstTemplate(): exact Qt template (ports + device)', () => {
  requireBuildOk();
  const buildCstTemplate = fnOf('gowin', 'buildCstTemplate');
  const ports = JSON.parse(readGolden('basic/ports.json'));
  const out = buildCstTemplate(ports, GWIN_DEFAULT);
  assertNoCR('cst', out);
  assertFileEquals(path.join(EXPECTED, 'basic', 'gowin', 'basic.cst'), out, 'basic.cst');
  return 'template matches Qt buildTemplate() golden (inputs/outputs groups, IO_LOC/IO_PORT)';
});

addCheck('RUNTIME', 'G15', 'Gowin buildCstTemplate(): device override, inout grouping, no-device header', () => {
  requireBuildOk();
  const buildCstTemplate = fnOf('gowin', 'buildCstTemplate');
  const ports = JSON.parse(readGolden('gowin-ports/ports.json'));
  assertFileEquals(path.join(EXPECTED, 'gowin-ports', 'gowin-ports.cst'), buildCstTemplate(ports, GWIN_DEFAULT), 'gowin-ports.cst (default device)');
  assertFileEquals(path.join(EXPECTED, 'gowin-ports', 'cst-device2.cst'), buildCstTemplate(ports, 'GW2AR-LV18QN88C8/I7'), 'cst-device2.cst (device override)');
  const noDev = buildCstTemplate(ports, '');
  if (noDev.includes('// Device:')) throw new Error('empty device must omit the "// Device:" line (gowincstdialog.cpp:281-284)');
  return 'device override + inout group + empty-device header verified';
});

addCheck('RUNTIME', 'G16', 'Gowin buildCstTemplate(): no-port fallback comment block', () => {
  requireBuildOk();
  const buildCstTemplate = fnOf('gowin', 'buildCstTemplate');
  assertFileEquals(path.join(EXPECTED, 'gowin-ports', 'ports-empty.cst'), buildCstTemplate([], GWIN_DEFAULT), 'ports-empty.cst');
  return 'empty-port fallback matches Qt (no ports auto-detected — add constraints manually)';
});

addCheck('RUNTIME', 'G17', 'Gowin GOWIN_DEVICES table + DEFAULT_GOWIN_DEVICE (Qt parity)', () => {
  requireBuildOk();
  const devices = valueOf('gowin', 'GOWIN_DEVICES');
  const def = valueOf('gowin', 'DEFAULT_GOWIN_DEVICE');
  // CONTRACT §7.2/F8: GOWIN_DEVICES = the 6 known Qt devices; the Qt table's 7th
  // "Custom device …" combo entry is UI-only (empty device string ⇒ default fallback).
  if (!Array.isArray(devices) || devices.length < 6) throw new Error(`GOWIN_DEVICES must contain the 6 known Qt devices, got ${Array.isArray(devices) ? devices.length : typeof devices}`);
  if (devices.length > 7) throw new Error(`GOWIN_DEVICES has ${devices.length} entries; Qt has 6 known devices (+ optional UI-only Custom)`);
  const known = [
    ['GW1NR-LV9QN88PC6/I5', 'GW1NR-LV9QN88PC6/I5'],
    ['GW1N-LV1QN48C6/I5', 'GW1N-LV1QN48C6/I5'],
    ['GW1NSR-LV4CQN48PC7/I6', 'GW1NSR-LV4CQN48PC7/I6'],
    ['GW2AR-LV18QN88C8/I7', 'GW2AR-LV18QN88C8/I7'],
    ['GW1N-LV4LQ144C6/I5', 'GW1N-LV4LQ144C6/I5'],
    ['GW5A-LV25MG121NES', 'GW5A-LV25MG121NES']
  ];
  const errs = [];
  known.forEach(([name, pn], i) => {
    const d = devices[i] || {};
    if (d.name !== name) errs.push(`device[${i}].name expected ${name}, got ${JSON.stringify(d.name)}`);
    if (d.pn !== pn) errs.push(`device[${i}].pn expected ${pn}, got ${JSON.stringify(d.pn)}`);
    if (typeof d.label !== 'string' || !d.label) errs.push(`device[${i}].label missing`);
  });
  devices.slice(6).forEach((d, k) => {
    if (d && (d.name !== '' || d.pn !== '')) errs.push(`extra device[${6 + k}] must have empty name/pn (Qt "Custom device …" row): ${JSON.stringify(d)}`);
  });
  if (def !== GWIN_DEFAULT) errs.push(`DEFAULT_GOWIN_DEVICE expected ${GWIN_DEFAULT}, got ${JSON.stringify(def)}`);
  // F8: CST dialog exposes a "Custom device …" option
  const cstText = corpusText(f => /cstPanel/.test(f));
  if (!/Custom device/i.test(cstText)) errs.push('CST panel does not offer a "Custom device …" option');
  // Qt fallback: empty device/pn ⇒ default device in generated .gprj (mainwindow.cpp:784-786)
  const buildGowinContents = fnOf('gowin', 'buildGowinContents');
  const fallback = buildGowinContents({
    dir: tmpPath('gowin-fallback'), projectName: 'fallback', activeFiles: ['top.sv'], topFile: 'top.sv',
    timestamp: TS, device: '', pn: '', cstContent: ''
  });
  if (!String(fallback.gprj).includes('name="' + GWIN_DEFAULT + '"')) {
    errs.push(`empty device must fall back to ${GWIN_DEFAULT} in .gprj (Qt mainwindow.cpp:784-786)`);
  }
  if (errs.length) throw new Error(errs.join('\n'));
  return `6 known devices exact, DEFAULT=${def}, empty-device fallback + Custom UI option verified`;
});

function gowinOptsFor(name) {
  const s = SCENARIOS[name];
  const ws = makeScenarioWorkspace(name);
  const cstContent = readGolden(name + '/gowin/' + name + '.cst');
  return {
    ws,
    cstContent,
    opts: {
      dir: ws,
      projectName: s.projectName,
      activeFiles: s.gowinActive.slice(),
      topFile: s.topFile,
      timestamp: TS,
      device: GWIN_DEFAULT,
      pn: GWIN_DEFAULT,
      cstContent
    }
  };
}

addCheck('RUNTIME', 'G18', 'Gowin buildGowinContents(): exact .f/.gprj + .cst passthrough (basic)', () => {
  requireBuildOk();
  const buildGowinContents = fnOf('gowin', 'buildGowinContents');
  const { cstContent, opts } = gowinOptsFor('basic');
  const res = buildGowinContents(opts);
  assert(res && typeof res === 'object', 'buildGowinContents() must return {cst,f,gprj}');
  for (const k of ['cst', 'f', 'gprj']) assert(typeof res[k] === 'string', `buildGowinContents().${k} missing`);
  assertNoCR('.f', res.f); assertNoCR('.gprj', res.gprj);
  if (res.cst !== cstContent) throw new Error('.cst must be the supplied cstContent (Qt writes dialog content verbatim, mainwindow.cpp:788-796)');
  assertFileEquals(path.join(EXPECTED, 'basic', 'gowin', 'basic.f'), res.f, '.f');
  assertFileEquals(path.join(EXPECTED, 'basic', 'gowin', 'basic.gprj'), res.gprj, '.gprj');
  return '.f/.gprj goldens match; .cst passthrough correct';
});

addCheck('RUNTIME', 'G19', 'Gowin buildGowinContents(): exclusions + top file (exclusions)', () => {
  requireBuildOk();
  const buildGowinContents = fnOf('gowin', 'buildGowinContents');
  const { cstContent, opts } = gowinOptsFor('exclusions');
  const res = buildGowinContents(opts);
  if (res.cst !== cstContent) throw new Error('.cst passthrough mismatch (exclusions)');
  assertFileEquals(path.join(EXPECTED, 'exclusions', 'gowin', 'exclusions.f'), res.f, '.f (exclusions)');
  assertFileEquals(path.join(EXPECTED, 'exclusions', 'gowin', 'exclusions.gprj'), res.gprj, '.gprj (exclusions)');
  return 'excluded b.sv absent; top module from a.sv matches Qt';
});

addCheck('RUNTIME', 'G20', 'Gowin buildGowinContents(): custom order does not leak into .f/.gprj (priority)', () => {
  requireBuildOk();
  const buildGowinContents = fnOf('gowin', 'buildGowinContents');
  const { cstContent, opts } = gowinOptsFor('priority');
  const res = buildGowinContents(opts);
  if (res.cst !== cstContent) throw new Error('.cst passthrough mismatch (priority)');
  assertFileEquals(path.join(EXPECTED, 'priority', 'gowin', 'priority.f'), res.f, '.f (priority)');
  assertFileEquals(path.join(EXPECTED, 'priority', 'gowin', 'priority.gprj'), res.gprj, '.gprj (priority)');
  return 'Gowin uses deterministic active order, top=y.sv (Qt launchForGowin passes activeFiles)';
});

addCheck('RUNTIME', 'G21', 'Gowin generateGowinFiles(): writes .cst/.f/.gprj + creates impl/pnr/', () => {
  requireBuildOk();
  const generateGowinFiles = fnOf('gowin', 'generateGowinFiles');
  const { ws, cstContent, opts } = gowinOptsFor('basic');
  const res = generateGowinFiles(opts);
  assert(res && typeof res === 'object', 'generateGowinFiles() must return GenerationResult');
  assert(Array.isArray(res.written), 'GenerationResult.written must be an array');
  for (const f of ['basic.cst', 'basic.f', 'basic.gprj']) {
    if (!resultHasPath(res.written, f)) throw new Error(`GenerationResult.written does not include ${f}: ${JSON.stringify(res.written.map(basenameAny))}`);
    if (!exists(path.join(ws, f))) throw new Error(`${f} was reported written but is missing on disk`);
  }
  if (readText(path.join(ws, 'basic.cst')) !== cstContent) throw new Error('.cst on disk must equal the supplied cstContent');
  assertFileEquals(path.join(EXPECTED, 'basic', 'gowin', 'basic.f'), readText(path.join(ws, 'basic.f')), '.f on disk');
  assertFileEquals(path.join(EXPECTED, 'basic', 'gowin', 'basic.gprj'), readText(path.join(ws, 'basic.gprj')), '.gprj on disk');
  const dirs = (res.dirs || []).map(d => String(d).replace(/\\/g, '/'));
  if (!dirs.some(d => d.endsWith('impl/pnr'))) throw new Error(`GenerationResult.dirs should report impl/pnr, got ${JSON.stringify(res.dirs)}`);
  if (!exists(path.join(ws, 'impl', 'pnr'))) throw new Error('impl/pnr/ directory was not created on disk');
  return `wrote cst/f/gprj (${res.written.length} entries) and created impl/pnr/`;
});

// ───────────────────── LibraryManager behavioural tests (F9) ─────────────────────
function libSetup(tag) {
  const lib = loadToolModule('library');
  const LM = lib.LibraryManager || (lib.default && lib.default.LibraryManager);
  assert(typeof LM === 'function', 'out/tools/library.js must export class LibraryManager (CONTRACT §7.2)');
  assert(typeof LM.createDefault === 'function', 'LibraryManager.createDefault() static missing (CONTRACT §7.2)');
  const root = tmpPath('lib-' + tag);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const registryPath = path.join(root, 'registry.json');
  const workRoot = path.join(root, 'work');
  const mgr = new LM(registryPath, workRoot);
  return { lib, LM, root, registryPath, workRoot, mgr };
}

function makeLibSource(root, name, files) {
  const dir = path.join(root, 'src-' + name);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(dir, f), 'module ' + f.replace(/\.sv$/, '') + '; endmodule\n', 'utf8');
  return dir;
}

function makeFakeQuesta(root, tag, opts) {
  opts = opts || {};
  const bin = path.join(root, 'fakebin-' + tag);
  fs.mkdirSync(bin, { recursive: true });
  const marker = path.join(root, 'calls-' + tag + '.log');
  fs.writeFileSync(marker, '', 'utf8');
  const vsim = path.join(bin, 'vsim');
  fs.writeFileSync(vsim, '#!/bin/sh\nexit 0\n', 'utf8');
  fs.chmodSync(vsim, 0o755);
  const vlib = path.join(bin, 'vlib');
  fs.writeFileSync(vlib, '#!/bin/sh\nmkdir -p "$1"\necho "vlib $*" >> ' + JSON.stringify(marker) + '\nexit 0\n', 'utf8');
  fs.chmodSync(vlib, 0o755);
  const vlog = path.join(bin, 'vlog');
  fs.writeFileSync(vlog, '#!/bin/sh\necho "vlog $*" >> ' + JSON.stringify(marker) + '\nexit ' + (opts.failVlog ? '3' : '0') + '\n', 'utf8');
  fs.chmodSync(vlog, 0o755);
  return { bin, vsim, vlib, vlog, marker };
}

addCheck('RUNTIME', 'G22', 'LibraryManager: Qt validation rules + registry JSON schema', () => {
  requireBuildOk();
  const t = libSetup('valid');
  const uartDir = makeLibSource(t.root, 'uart', ['uart.sv', 'uart_pkg.sv']);
  const emptyDir = path.join(t.root, 'empty-src');
  fs.mkdirSync(emptyDir, { recursive: true });
  const cases = [
    ['empty name', () => t.mgr.addLibrary('', uartDir), /empty/i],
    ['name with space', () => t.mgr.addLibrary('bad name', uartDir), /space|slashes|single word/i],
    ['name with slash', () => t.mgr.addLibrary('bad/name', uartDir), /slash|single word/i],
    ['nonexistent source path', () => t.mgr.addLibrary('ghost_lib', path.join(t.root, 'does-not-exist')), /exist/i],
    ['source folder without .sv', () => t.mgr.addLibrary('empty_lib', emptyDir), /No \.sv files|no .sv/i]
  ];
  const errs = [];
  for (const [label, call, re] of cases) {
    const r = call();
    if (!r || r.ok !== false) { errs.push(`${label}: addLibrary() must return {ok:false}, got ${JSON.stringify(r)}`); continue; }
    if (typeof r.error !== 'string' || !re.test(r.error)) errs.push(`${label}: unexpected error text ${JSON.stringify(r.error)}`);
  }
  const ok = t.mgr.addLibrary('uart_lib', uartDir);
  if (!ok || ok.ok !== true) throw new Error('valid addLibrary() failed: ' + JSON.stringify(ok));
  const dup = t.mgr.addLibrary('uart_lib', uartDir);
  if (!dup || dup.ok !== false) errs.push('duplicate library name must be rejected');
  if (!t.mgr.hasLibrary('uart_lib')) errs.push('hasLibrary("uart_lib") false after add');
  const entry = t.mgr.library('uart_lib');
  if (!entry || entry.sourcePath !== uartDir) errs.push('library("uart_lib") wrong sourcePath');
  if (!Array.isArray(t.mgr.libraries()) || t.mgr.libraries().length !== 1) errs.push('libraries() should contain exactly 1 entry');
  // registry JSON schema (Qt librarymanager.cpp:29-46,71-81)
  if (!exists(t.registryPath)) errs.push('registry JSON not written');
  else {
    let reg;
    try { reg = readJSON(t.registryPath); } catch (e) { errs.push('registry.json invalid JSON'); }
    if (reg) {
      const e = reg.uart_lib;
      if (!e || typeof e !== 'object') errs.push('registry.json missing "uart_lib" object');
      else {
        if (e.sourcePath !== uartDir) errs.push('registry sourcePath mismatch');
        if (e.compiled !== false) errs.push(`registry compiled must be false for a new library, got ${JSON.stringify(e.compiled)}`);
        if (typeof e.compiledAt !== 'string') errs.push('registry compiledAt must be a string ("" when never compiled)');
      }
    }
  }
  if (errs.length) throw new Error(errs.join('\n'));
  return 'Qt validation errors + registry schema {"<name>":{sourcePath,compiled,compiledAt}} verified';
});

addCheck('RUNTIME', 'G23', 'LibraryManager: remove deletes entry + compiled work DB', () => {
  requireBuildOk();
  const t = libSetup('remove');
  const dir = makeLibSource(t.root, 'spi', ['spi.sv']);
  assert(t.mgr.addLibrary('spi_lib', dir).ok, 'setup: addLibrary failed');
  const db = t.mgr.workDbPath('spi_lib');
  assert(typeof db === 'string' && db.length > 0, 'workDbPath() missing');
  if (path.resolve(db) !== path.resolve(path.join(t.workRoot, 'spi_lib'))) {
    throw new Error(`workDbPath("spi_lib") expected ${path.join(t.workRoot, 'spi_lib')}, got ${db}`);
  }
  fs.mkdirSync(db, { recursive: true });
  fs.writeFileSync(path.join(db, 'sentinel'), 'x');
  const r = t.mgr.removeLibrary('spi_lib');
  if (!r || r.ok !== true) throw new Error('removeLibrary("spi_lib") failed: ' + JSON.stringify(r));
  if (t.mgr.hasLibrary('spi_lib')) throw new Error('library still registered after removeLibrary');
  if (exists(db)) throw new Error('compiled work DB was not recursively deleted (Qt librarymanager.cpp:123-138)');
  const unknown = t.mgr.removeLibrary('not_there');
  if (!unknown || unknown.ok !== false) throw new Error('removeLibrary(unknown) must return {ok:false}');
  return 'entry + ~/.questa_libs/work/<name> removed; unknown library rejected';
});

addCheck('RUNTIME', 'G24', 'LibraryManager: per-project questa_libs.json deps', () => {
  requireBuildOk();
  const t = libSetup('deps');
  const projectDir = path.join(t.root, 'project');
  fs.mkdirSync(projectDir, { recursive: true });
  const set = t.mgr.setProjectDeps(projectDir, ['alpha_lib', 'beta_lib']);
  if (!set || set.ok !== true) throw new Error('setProjectDeps() failed: ' + JSON.stringify(set));
  const depsPath = path.join(projectDir, 'questa_libs.json');
  if (!exists(depsPath)) throw new Error('questa_libs.json not written');
  const parsed = readJSON(depsPath);
  if (JSON.stringify(parsed) !== JSON.stringify({ dependencies: ['alpha_lib', 'beta_lib'] })) {
    throw new Error(`questa_libs.json schema expected {"dependencies":[…]}, got ${JSON.stringify(parsed)}`);
  }
  const read = t.mgr.projectDeps(projectDir);
  if (JSON.stringify(read) !== JSON.stringify(['alpha_lib', 'beta_lib'])) throw new Error(`projectDeps() returned ${JSON.stringify(read)}`);
  const staticPath = t.LM.projectDepsPath(projectDir);
  if (path.basename(staticPath) !== 'questa_libs.json') throw new Error(`projectDepsPath() expected <dir>/questa_libs.json, got ${staticPath}`);
  const staticRead = t.LM.readProjectDeps(projectDir);
  if (JSON.stringify(staticRead) !== JSON.stringify(['alpha_lib', 'beta_lib'])) throw new Error('static readProjectDeps() mismatch');
  const missing = t.mgr.projectDeps(path.join(t.root, 'no-such-project'));
  if (!Array.isArray(missing) || missing.length !== 0) throw new Error('projectDeps() on a dir without questa_libs.json must return []');
  return 'set/read/static project-deps APIs + questa_libs.json schema verified';
});

addCheck('RUNTIME', 'G25', 'LibraryManager: linkFlags = ["-L", workDbPath, …] and skips unknown', () => {
  requireBuildOk();
  const t = libSetup('flags');
  const a = makeLibSource(t.root, 'aa', ['aa.sv']);
  const b = makeLibSource(t.root, 'bb', ['bb.sv']);
  assert(t.mgr.addLibrary('aa_lib', a).ok, 'setup add aa_lib');
  assert(t.mgr.addLibrary('bb_lib', b).ok, 'setup add bb_lib');
  const flags = t.mgr.linkFlags(['aa_lib', 'missing_lib', 'bb_lib']);
  const expected = ['-L', t.mgr.workDbPath('aa_lib'), '-L', t.mgr.workDbPath('bb_lib')];
  if (JSON.stringify(flags) !== JSON.stringify(expected)) {
    throw new Error(`linkFlags mismatch.\nexpected: ${JSON.stringify(expected)}\nactual:   ${JSON.stringify(flags)}`);
  }
  return 'Qt linkFlags() parity (-L <workDbPath> pairs, unknown deps skipped)';
});

addCheck('RUNTIME', 'G26', 'LibraryManager.compileLibrary(): vlib + vlog -work <db> + compiled state', () => {
  requireBuildOk();
  const t = libSetup('compile');
  const dir = makeLibSource(t.root, 'uart', ['uart.sv', 'uart_pkg.sv']);
  assert(t.mgr.addLibrary('uart_lib', dir).ok, 'setup addLibrary failed');
  const fake = makeFakeQuesta(t.root, 'ok');
  const result = t.mgr.compileLibrary('uart_lib', fake.vsim);
  if (result && typeof result.then === 'function') {
    // async — checked below
  } else {
    throw new Error('compileLibrary() must return a Promise (CONTRACT §7.2)');
  }
  return (async () => {
    const r = await result;
    if (!r || r.ok !== true) throw new Error('compileLibrary() failed: ' + JSON.stringify(r));
    const db = t.mgr.workDbPath('uart_lib');
    if (!exists(db)) throw new Error(`vlib did not create work DB ${db}`);
    const calls = readText(fake.marker).split('\n').filter(Boolean);
    if (!calls.some(l => l.startsWith('vlib ') && l.includes(db))) throw new Error(`vlib was not invoked with the work DB.\nmarker:\n${calls.join('\n')}`);
    const vlogCall = calls.find(l => l.startsWith('vlog '));
    if (!vlogCall) throw new Error('vlog was never invoked');
    if (!vlogCall.includes('-work ' + db)) throw new Error(`vlog args missing "-work <db>": ${vlogCall}`);
    for (const f of ['uart.sv', 'uart_pkg.sv']) if (!vlogCall.includes(path.join(dir, f))) throw new Error(`vlog args missing source path ${path.join(dir, f)}: ${vlogCall}`);
    const e = t.mgr.library('uart_lib');
    if (!e || e.compiled !== true) throw new Error('compiled flag not set after successful compileLibrary()');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(e.compiledAt || '')) throw new Error(`compiledAt must be Qt::ISODate local (YYYY-MM-DDTHH:MM:SS), got ${JSON.stringify(e.compiledAt)}`);
    const reg = readJSON(t.registryPath);
    if (!reg.uart_lib || reg.uart_lib.compiled !== true) throw new Error('registry.json not persisted with compiled=true');
    return `vlib+vlog invoked correctly; compiled=true, compiledAt=${e.compiledAt}`;
  })();
});

addCheck('RUNTIME', 'G27', 'LibraryManager.compileLibrary(): vlog failure reported, state unchanged', () => {
  requireBuildOk();
  const t = libSetup('fail');
  const dir = makeLibSource(t.root, 'bad', ['bad.sv']);
  assert(t.mgr.addLibrary('bad_lib', dir).ok, 'setup addLibrary failed');
  const fake = makeFakeQuesta(t.root, 'fail', { failVlog: true });
  const p = t.mgr.compileLibrary('bad_lib', fake.vsim);
  return (async () => {
    const r = await p;
    if (!r || r.ok !== false) throw new Error('compileLibrary() must return {ok:false} when vlog exits non-zero: ' + JSON.stringify(r));
    if (typeof r.error !== 'string' || !/vlog|fail|compile/i.test(r.error)) throw new Error('error text should mention the failing vlog step: ' + JSON.stringify(r.error));
    const e = t.mgr.library('bad_lib');
    if (!e || e.compiled !== false) throw new Error('compiled flag must NOT be set after a failed vlog run');
    return 'non-zero vlog exit surfaced as {ok:false}; compiled state untouched';
  })();
});

// ══════════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════════

function headerInfo() {
  let commit = 'unknown', dirty = 0;
  try {
    const r = sh('git', ['rev-parse', '--short', 'HEAD'], { timeout: 15000 });
    if (r.code === 0) commit = r.out.trim();
    const s = sh('git', ['status', '--porcelain'], { timeout: 15000 });
    if (s.code === 0) dirty = s.out.split('\n').filter(Boolean).length;
  } catch (e) { /* not a git repo */ }
  return {
    target: TARGET,
    commit,
    dirty,
    node: process.version,
    when: new Date().toISOString()
  };
}

function buildReport(info) {
  const lines = [];
  const pad = (s, n) => (s + ' '.repeat(Math.max(0, n - s.length)));
  lines.push('MultiHD Launcher — independent verification harness');
  lines.push('='.repeat(78));
  lines.push(`target : ${info.target}`);
  lines.push(`commit : ${info.commit} (${info.dirty} dirty/untracked change(s))`);
  lines.push(`node   : ${info.node}   time: ${info.when}`);
  lines.push(`fixtures: ${path.relative(TARGET, FIXTURES)} (goldens derived from /home/bismillah/QuestaLauncher C++ source)`);
  lines.push('='.repeat(78));
  let lastGroup = null;
  for (const r of results) {
    if (r.group !== lastGroup) { lines.push(''); lines.push(`── ${r.group} ──`); lastGroup = r.group; }
    lines.push(`${pad('[' + r.status + ']', 8)}${pad(r.id, 6)}${r.title}`);
    if (r.detail) for (const d of String(r.detail).split('\n')) lines.push(`         ${d}`);
  }
  const counts = countResults();
  lines.push('');
  lines.push('='.repeat(78));
  lines.push(`SUMMARY: ${counts.PASS} passed, ${counts.FAIL} failed, ${counts.WARN} warning(s), ${counts.SKIP} skipped (${results.length} checks)`);
  const fails = results.filter(r => r.status === 'FAIL');
  if (fails.length) {
    lines.push('FAILURES:');
    for (const f of fails) lines.push(`  ✗ ${f.id} ${f.title}`);
  }
  lines.push(counts.FAIL === 0 ? 'RESULT: PASS' : 'RESULT: FAIL');
  return lines.join('\n') + '\n';
}

function countResults() {
  const c = { PASS: 0, FAIL: 0, WARN: 0, SKIP: 0 };
  for (const r of results) c[r.status]++;
  return c;
}

async function main() {
  if (OPTS.help) {
    process.stdout.write(readText(__filename).split('\n').slice(0, 40).join('\n') + '\n');
    return 0;
  }
  ensureTmp();
  const info = headerInfo();
  if (!OPTS.json) {
    process.stdout.write(`\n${C.bold}MultiHD Launcher — independent verification harness${C.reset}\n`);
    process.stdout.write(`${C.dim}target: ${info.target}\ncommit: ${info.commit} (${info.dirty} dirty) · node ${info.node}\n`);
    process.stdout.write(`fixtures: ${path.relative(TARGET, FIXTURES)}\n${C.reset}\n`);
  }
  // pre-load fixture expectations sanity (harness self-check)
  const fixtureErr = [];
  for (const f of ['basic/run.do', 'basic/quartus/basic.qpf', 'basic/gowin/basic.cst', 'gowin-ports/ports.json']) {
    if (!exists(path.join(EXPECTED, f))) fixtureErr.push(f);
  }
  if (fixtureErr.length) throw new Error('harness fixtures missing: ' + fixtureErr.join(', '));
  for (const name of Object.keys(SCENARIOS)) {
    if (!exists(path.join(PROJECTS, name))) throw new Error('fixture project missing: verify/fixtures/projects/' + name);
  }

  await runChecks();

  fs.rmSync(path.join(OUT_DIR, '.verify-tmp'), { recursive: true, force: true });
  if (!OPTS.keepTemp && ctx.tmp) { try { fs.rmSync(ctx.tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ } }

  const report = buildReport(info);
  const counts = countResults();
  if (OPTS.report) {
    const rp = path.resolve(process.cwd(), OPTS.report);
    fs.mkdirSync(path.dirname(rp), { recursive: true });
    fs.writeFileSync(rp, report, 'utf8');
  }
  if (OPTS.json) {
    process.stdout.write(JSON.stringify({
      target: info.target,
      commit: info.commit,
      dirty: info.dirty,
      when: info.when,
      result: counts.FAIL === 0 ? 'PASS' : 'FAIL',
      counts,
      checks: results
    }, null, 2) + '\n');
  } else {
    process.stdout.write('\n' + report.split('\n').slice(4).join('\n'));
  }
  return counts.FAIL === 0 ? 0 : 1;
}

if (require.main === module) {
  main()
    .then(code => { process.exitCode = code; })
    .catch(e => {
      process.stderr.write(`\nharness error: ${e && e.stack ? e.stack : e}\n`);
      process.exitCode = 2;
    });
}

module.exports = { main, checks };
