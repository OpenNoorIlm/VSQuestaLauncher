// ─────────────────────────────────────────────────────────────────────────────
// MultiHD Launcher — global library manager (Questa work databases).
//
// Qt reference: /home/bismillah/QuestaLauncher/librarymanager.cpp + .h
//
// Layout (identical to Qt):
//   ~/.questa_libs/registry.json              {"<name>": {compiled, compiledAt, sourcePath}}
//   ~/.questa_libs/work/<name>                compiled work database
//   <projectDir>/questa_libs.json             {"dependencies": ["lib", …]}
//
// Validation/error strings are verbatim Qt. Persistence uses Qt's indented JSON
// (4 spaces, sorted keys, trailing newline). Compilation uses `spawnSync` with
// argument arrays only (no shell strings).
//
// NOTE: no `vscode` import, Node builtins only (checked in plain Node).
// ─────────────────────────────────────────────────────────────────────────────

import { spawnSync, SpawnSyncReturns } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ensureDir,
  isoNow,
  isDirectory,
  listFilesWithSuffix,
  pathExists,
  qtJsonIndented,
  readTextFile,
} from './util';
import type { JsonValue } from './util';

export interface LibEntry {
  name: string;
  sourcePath: string;
  compiled: boolean;
  /** ISO timestamp (empty string when never compiled — Qt `QDateTime::toString` of an invalid date). */
  compiledAt: string;
}

/** Root dir for all compiled work dbs (`~/.questa_libs/work`). */
const GLOBAL_DIR_NAME = '.questa_libs';
const REGISTRY_FILE_NAME = 'registry.json';
const WORK_DIR_NAME = 'work';
const PROJECT_DEPS_FILE_NAME = 'questa_libs.json';

/** Extract stderr text from a spawnSync result (Qt `readAllStandardError`). */
function stderrOf(result: SpawnSyncReturns<string>): string {
  if (result.stderr === undefined || result.stderr === null) return '';
  return typeof result.stderr === 'string' ? result.stderr : String(result.stderr);
}

/** Read project deps with Qt `projectDeps()` semantics (unreadable/invalid ⇒ []). */
function readDepsFile(depsPath: string): string[] {
  const text = readTextFile(depsPath);
  if (text === undefined) return [];
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return [];
  }
  if (root === null || typeof root !== 'object' || Array.isArray(root)) return [];
  const raw = (root as Record<string, unknown>)['dependencies'];
  if (!Array.isArray(raw)) return [];
  // Qt: `for (v : arr) deps << v.toString()` — non-strings become "".
  return raw.map((v: unknown) => (typeof v === 'string' ? v : ''));
}

function entryFromJson(name: string, value: unknown): LibEntry {
  const obj: Record<string, unknown> =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    name,
    sourcePath: typeof obj['sourcePath'] === 'string' ? obj['sourcePath'] : '',
    compiled: typeof obj['compiled'] === 'boolean' ? obj['compiled'] : false,
    compiledAt: typeof obj['compiledAt'] === 'string' ? obj['compiledAt'] : '',
  };
}

export class LibraryManager {
  private readonly registryPath: string;
  private readonly workRoot: string;
  private libs: LibEntry[];

  constructor(registryPath: string, workRoot: string) {
    this.registryPath = registryPath;
    this.workRoot = workRoot;
    try {
      ensureDir(workRoot);
    } catch {
      // Qt: QDir().mkpath() failure is ignored.
    }
    this.libs = [];
    this.load();
  }

  /** Registry/`work` under `~/.questa_libs` (same defaults as Qt). */
  static createDefault(): LibraryManager {
    const home = os.homedir();
    const globalRoot = path.join(home, GLOBAL_DIR_NAME);
    return new LibraryManager(
      path.join(globalRoot, REGISTRY_FILE_NAME),
      path.join(globalRoot, WORK_DIR_NAME),
    );
  }

  /** `<projectDir>/questa_libs.json`. */
  static projectDepsPath(projectDir: string): string {
    return path.join(projectDir, PROJECT_DEPS_FILE_NAME);
  }

  /** Static form of `projectDeps()` (usable without an instance). */
  static readProjectDeps(projectDir: string): string[] {
    return readDepsFile(LibraryManager.projectDepsPath(projectDir));
  }

  /** All registered libraries, in registry order (Qt: QJsonObject ⇒ alphabetical on load). */
  libraries(): LibEntry[] {
    return this.libs.map((e) => ({ ...e }));
  }

  hasLibrary(name: string): boolean {
    return this.libs.some((e) => e.name === name);
  }

  library(name: string): LibEntry | undefined {
    const found = this.libs.find((e) => e.name === name);
    return found === undefined ? undefined : { ...found };
  }

  /**
   * Register a library folder (Qt `addLibrary`, librarymanager.cpp:98-120).
   * Errors are verbatim Qt strings; `ok` means the registry was updated.
   */
  addLibrary(name: string, sourcePath: string): { ok: boolean; error?: string } {
    if (name.trim() === '') {
      return { ok: false, error: 'Library name cannot be empty.' };
    }
    if (name.includes(' ') || name.includes('/') || name.includes('\\')) {
      return { ok: false, error: 'Library name must be a single word with no spaces or slashes.' };
    }
    if (this.hasLibrary(name)) {
      return { ok: false, error: 'A library named "' + name + '" already exists.' };
    }
    if (!isDirectory(sourcePath)) {
      return { ok: false, error: 'Source path does not exist:\n' + sourcePath };
    }
    if (listFilesWithSuffix(sourcePath, '.sv').length === 0) {
      return { ok: false, error: 'No .sv files found in:\n' + sourcePath };
    }

    this.libs.push({ name, sourcePath, compiled: false, compiledAt: '' });
    this.save();
    return { ok: true };
  }

  /**
   * Unregister a library and delete its compiled work database
   * (Qt `removeLibrary`, librarymanager.cpp:123-137).
   */
  removeLibrary(name: string): { ok: boolean; error?: string } {
    const index = this.libs.findIndex((e) => e.name === name);
    if (index === -1) {
      return { ok: false, error: 'Library "' + name + '" not found.' };
    }
    this.libs.splice(index, 1);
    this.save();
    try {
      fs.rmSync(this.workDbPath(name), { recursive: true, force: true });
    } catch {
      // Qt ignores removeRecursively() failure.
    }
    return { ok: true };
  }

  /**
   * Compile a library's `.sv` sources into `<workRoot>/<name>`.
   *
   * Qt `compileLibrary` (librarymanager.cpp:140-204):
   *  1. `vsim` binary path ⇒ `binDir`; `vlog` must exist at `binDir/vlog`;
   *  2. collect every `*.sv` in the source folder (no `-sv` flag — Qt parity, see
   *     CONTRACT D8);
   *  3. if the work DB does not exist: `vlib <dbPath>` (10 s timeout);
   *  4. `vlog -work <dbPath> <sv paths…>` (60 s timeout);
   *  5. mark `compiled = true`, `compiledAt = isoNow()`, persist.
   */
  async compileLibrary(
    name: string,
    vsimBinaryPath: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const entry = this.library(name);
    if (!entry) {
      return { ok: false, error: 'Library "' + name + '" not registered.' };
    }

    // Qt QFileInfo(vsimBinaryPath).absolutePath(): resolve relative vsim paths first.
    const binDir = path.dirname(path.resolve(vsimBinaryPath));
    const vlib = path.join(binDir, 'vlib');
    const vlog = path.join(binDir, 'vlog');

    if (!pathExists(vlog)) {
      return {
        ok: false,
        error: 'vlog not found at:\n' + vlog + '\nCheck the vsim path in Configuration.',
      };
    }

    const svFiles = listFilesWithSuffix(entry.sourcePath, '.sv');
    if (svFiles.length === 0) {
      return { ok: false, error: 'No .sv files found in:\n' + entry.sourcePath };
    }
    const svPaths = svFiles.map((f) => path.join(entry.sourcePath, f));
    const dbPath = this.workDbPath(name);

    // Step 1 — vlib (only when the work DB does not exist yet).
    if (!pathExists(dbPath)) {
      const vlibResult = spawnSync(vlib, [dbPath], { timeout: 10000, encoding: 'utf8' });
      if (vlibResult.error || vlibResult.status !== 0) {
        return { ok: false, error: 'vlib failed:\n' + stderrOf(vlibResult) };
      }
    }

    // Step 2 — vlog -work <db> <all .sv paths>
    const vlogArgs = ['-work', dbPath, ...svPaths];
    const vlogResult = spawnSync(vlog, vlogArgs, { timeout: 60000, encoding: 'utf8' });
    if (vlogResult.error || vlogResult.status !== 0) {
      return { ok: false, error: 'vlog compilation failed:\n' + stderrOf(vlogResult) };
    }

    // Step 3 — mark compiled + persist.
    const index = this.libs.findIndex((e) => e.name === name);
    if (index !== -1) {
      this.libs[index].compiled = true;
      this.libs[index].compiledAt = isoNow();
    }
    this.save();
    return { ok: true };
  }

  /** Per-project dependency list from `<projectDir>/questa_libs.json`. */
  projectDeps(projectDir: string): string[] {
    return readDepsFile(LibraryManager.projectDepsPath(projectDir));
  }

  /**
   * Persist the per-project dependency list (Qt `setProjectDeps`): rewrites the
   * whole `questa_libs.json`, dropping any unknown keys.
   */
  setProjectDeps(projectDir: string, deps: string[]): { ok: boolean; error?: string } {
    const depsPath = LibraryManager.projectDepsPath(projectDir);
    const root: { [key: string]: JsonValue } = { dependencies: deps.slice() };
    try {
      fs.writeFileSync(depsPath, qtJsonIndented(root), 'utf8');
      return { ok: true };
    } catch {
      return { ok: false, error: 'Cannot write ' + depsPath };
    }
  }

  /**
   * `-L` flags for vlog/vopt/vsim: `["-L", workDbPath, …]` for registered deps
   * only (unregistered names are silently skipped — Qt `linkFlags`).
   */
  linkFlags(deps: string[]): string[] {
    const flags: string[] = [];
    for (const dep of deps) {
      if (!this.hasLibrary(dep)) continue;
      flags.push('-L', this.workDbPath(dep));
    }
    return flags;
  }

  /** `<workRoot>/<name>` — the library's Questa work database path. */
  workDbPath(name: string): string {
    return path.join(this.workRoot, name);
  }

  // ── persistence ───────────────────────────────────────────────────────────
  private load(): void {
    this.libs = [];
    const text = readTextFile(this.registryPath);
    if (text === undefined) return;
    let root: unknown;
    try {
      root = JSON.parse(text);
    } catch {
      return;
    }
    if (root === null || typeof root !== 'object' || Array.isArray(root)) return;
    const record = root as Record<string, unknown>;
    // QJsonObject iterates in sorted key order — reproduce that ordering.
    for (const name of Object.keys(record).sort()) {
      this.libs.push(entryFromJson(name, record[name]));
    }
  }

  private save(): void {
    const root: { [key: string]: JsonValue } = {};
    for (const entry of this.libs) {
      root[entry.name] = {
        compiled: entry.compiled,
        compiledAt: entry.compiledAt,
        sourcePath: entry.sourcePath,
      };
    }
    try {
      ensureDir(path.dirname(this.registryPath));
      fs.writeFileSync(this.registryPath, qtJsonIndented(root), 'utf8');
    } catch {
      // Qt's save() silently ignores write failures.
    }
  }
}
