// ─────────────────────────────────────────────────────────────────────────────
// MultiHD Launcher — Qt-parity launch flows
// (see multihd-port/CONTRACT.md §6 launcher.ts, §8 F3/F6/F7/F8 + §11 D3-D7)
//
// Qt reference: /home/bismillah/QuestaLauncher/mainwindow.cpp
//   launch()             mainwindow.cpp:851-869
//   launchForQuesta()    mainwindow.cpp:872-929
//   launchForQuartus()   mainwindow.cpp:932-969
//   launchForGowin()     mainwindow.cpp:972-1013
//   installQuesta()      mainwindow.cpp:1016-1022
//   openLicenseRequest() mainwindow.cpp:1024-1029
//
// Preserved v1.9.1 flows: Run CLI / Run GUI / Show WaveForm.
//
// D6: the Gowin CST webview is opened by src/extension.ts (no core → ui
// import). This module only prepares the CRC payload and writes/launches.
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { LogKind, ProjectInfo, TargetTool } from '../models';
import {
  buildCstTemplate,
  DEFAULT_GOWIN_DEVICE,
  generateGowinFiles,
  parsePorts,
} from '../tools/gowin';
import { generateQuartusFiles, GenerationResult } from '../tools/quartus';
import { LibraryManager } from '../tools/library';
import { RunDoOptions, writeRunDo } from '../tools/questa';
import { isoNow } from '../tools/util';
import {
  getConfigValues,
  getLicenseStatus,
  resolveGowin,
  resolveQuartus,
  resolveVsim,
} from './config';
import { buildQuestaEnvironment, spawnDetached, spawnStreaming } from './process';
import {
  activeFilesForTools,
  computeTbModule,
  computeTopFile,
  isValidProjectDir,
} from './project';

// ─── Qt install/license URLs (contract §8 F10, verbatim) ─────────────────────

export const INSTALL_QUESTA_URL =
  'https://www.intel.com/content/www/us/en/software-kit/825277/questa-intel-fpgas-standard-edition-software-version-23-1-1.html';
export const LICENSE_REQUEST_URL =
  'https://licensing.intel.com/psg/s/sales-signup-evaluationlicenses';

// ─── runtime wiring ─────────────────────────────────────────────────────────

/** Log sink — extension.ts writes to the Output channel + launcher panel. */
export type LogSink = (line: string, kind?: LogKind) => void;

export interface LauncherRuntime {
  /** v2.0.0 extension context (kept for future panel/state needs). */
  context: vscode.ExtensionContext;
  /** Global library manager instance (undefined when unavailable). */
  libraryManager?: LibraryManager;
  log: LogSink;
}

// ─── validation (Qt QMessageBox parity) ─────────────────────────────────────

/** Qt: "Please select a valid project folder." */
export async function validateProjectDir(projectDir: string | undefined): Promise<boolean> {
  if (!projectDir || !isValidProjectDir(projectDir)) {
    await vscode.window.showWarningMessage('Please select a valid project folder.');
    return false;
  }
  return true;
}

/** Qt: "Please tick at least one target in the COMPILE FOR section." */
export async function validateTargets(targets: TargetTool[]): Promise<boolean> {
  if (targets.length === 0) {
    await vscode.window.showWarningMessage(
      'Please tick at least one target in the COMPILE FOR section.'
    );
    return false;
  }
  return true;
}

// ─── install / license helpers ──────────────────────────────────────────────

export async function openInstallQuesta(runtime: LauncherRuntime): Promise<void> {
  runtime.log('⬇ Opening Questa FSE download page...', 'green');
  await vscode.env.openExternal(vscode.Uri.parse(INSTALL_QUESTA_URL));
}

export async function openLicenseRequest(runtime: LauncherRuntime): Promise<void> {
  runtime.log('🔑 Opening license request page...', 'purple');
  await vscode.env.openExternal(vscode.Uri.parse(LICENSE_REQUEST_URL));
}

// ─── shared helpers ─────────────────────────────────────────────────────────

/**
 * Files compiled by the Questa flows.
 * conf.svconf `compile @(N)` keeps the v1.9.1 truncation semantics; `all`
 * and `list` compile the full ordered list (`list` only changes ordering).
 */
export function questaFilesForCompile(info: ProjectInfo): string[] {
  const mode = info.conf.compileMode;
  if (typeof mode === 'number' && mode > 0) return info.activeFiles.slice(0, mode);
  return info.activeFiles;
}

/** Questa simulation top: `@topmodule` wins, then the Qt `_tb.sv` rule. */
export function questaTopModule(info: ProjectInfo, files: string[]): string {
  return info.conf.topModule || computeTbModule(files, info.topModule);
}

interface RunDoLibraryData {
  libs: RunDoOptions['libs'];
  libFlags: string[];
}

/**
 * Library data for run.do (contract §8 F6/F9, Qt mainwindow.cpp:653-674):
 *   - `-L <workDbPath>` flags for registered project dependencies,
 *   - one `vlog -work <workDbPath> <sv paths>` line per registered dependency,
 *   - warning log line for dependencies that are not compiled yet.
 */
function collectRunDoLibraries(info: ProjectInfo, runtime: LauncherRuntime): RunDoLibraryData {
  const manager = runtime.libraryManager;
  const deps = info.deps ?? [];
  if (!manager) return { libs: [], libFlags: [] };

  const libFlags = manager.linkFlags(deps);
  const libs: RunDoOptions['libs'] = [];

  for (const dependency of deps) {
    if (!manager.hasLibrary(dependency)) continue;
    const entry = manager.library(dependency);
    if (!entry) continue;
    if (!entry.compiled) {
      runtime.log(`⚠ Library "${dependency}" not compiled — open 📦 LIBRARIES.`, 'orange');
    }
    const sourceFiles = listSvSourceFiles(entry.sourcePath);
    libs.push({
      name: dependency,
      workDbPath: manager.workDbPath(dependency),
      sourceFiles,
    });
  }
  return { libs, libFlags };
}

function listSvSourceFiles(sourceDir: string): string[] {
  try {
    return fs
      .readdirSync(sourceDir)
      .filter((name) => !name.startsWith('.') && name.endsWith('.sv'))
      .sort()
      .map((name) => path.join(sourceDir, name));
  } catch {
    return [];
  }
}

function combination(values: Array<string | undefined>): string {
  return values
    .map((value) => (value ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

/** Log Qt `↳ <path>` generation lines (contract §8 F7/F8, TEMPLATES §9). */
function logGenerationResult(runtime: LauncherRuntime, result: GenerationResult): void {
  for (const written of result.written) {
    runtime.log(`    ↳ ${written.path}`, 'dim');
  }
  for (const skipped of result.skipped) {
    const reason = /exists/i.test(skipped.reason) ? 'exists — not overwritten' : skipped.reason;
    runtime.log(`    ↳ ${skipped.path}  (${reason})`, 'dim');
  }
  for (const createdDir of result.dirs) {
    const clean = createdDir.replace(/[\\/]+$/, '');
    runtime.log(`    ↳ ${clean}/  (created)`, 'dim');
  }
  for (const warning of result.warnings) {
    runtime.log(`⚠ ${warning}`, 'orange');
  }
}

function streamToLog(runtime: LauncherRuntime, text: string, kind: LogKind = 'dim'): void {
  for (const line of text.split(/\r?\n/)) {
    if (line.trim()) runtime.log(line, kind);
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ─── Questa (Qt parity: Launch Questa command) ──────────────────────────────

/**
 * Qt `launchForQuesta()`:
 *   license guard → Qt-exact run.do → detached
 *   `vsim ['-gui','-do','run.do']` with cwd = project dir (D7, space-safe).
 *
 * Returns true when the process was launched (Quartus/Gowin continue when
 * Questa is blocked, exactly like Qt).
 */
export async function launchQuesta(runtime: LauncherRuntime, info: ProjectInfo): Promise<boolean> {
  const values = getConfigValues();
  const license = getLicenseStatus(values);

  // F3 license guard — Qt mainwindow.cpp:876-885
  if (!license.ok) {
    runtime.log('✗ [Questa] BLOCKED: License file not configured or not found!', 'red');
    const choice = await vscode.window.showErrorMessage(
      'Questa will not start without a valid license file.\n\n' +
        'Open Configuration now to set it up?',
      { modal: true },
      'Open Config'
    );
    if (choice === 'Open Config') {
      await vscode.commands.executeCommand('multihdLauncher.setConfig');
    }
    return false;
  }

  if (info.excludedFiles.length > 0) {
    runtime.log(`✕ ${info.excludedFiles.length} file(s) excluded from this run.`, 'red');
  }
  runtime.log('⬡ [Questa] Generating run.do...', 'cyan');

  // Qt-exact run.do: custom order + exclusions + libraries, no conf extra args (D4).
  const files = questaFilesForCompile(info);
  if (files.length === 0) {
    runtime.log('✗ [Questa] No simulation files remaining after exclusions!', 'red');
    void vscode.window.showErrorMessage(
      'No .sv files left to compile.\nRestore some files from the EXCLUDED FILES panel.'
    );
    return false;
  }
  const topModule = questaTopModule(info, files);
  const libraryData = collectRunDoLibraries(info, runtime);

  const runDo: RunDoOptions = {
    dir: info.dir,
    files,
    topModule,
    libs: libraryData.libs,
    libFlags: libraryData.libFlags,
    timestamp: isoNow(),
    mode: 'gui',
    workLib: 'work',
  };
  writeRunDo(runDo);
  runtime.log(`✓ [Questa] run.do ready — top: ${topModule}`, 'green');

  const vsim = resolveVsim(values);
  runtime.log(`  vsim:    ${vsim.path}`, 'dim');
  runtime.log(`  license: ${license.path}`, 'dim');
  runtime.log('▶ [Questa] Launching...', 'cyan');

  const env = buildQuestaEnvironment(values, vsim.path);
  try {
    const child = spawnDetached(vsim.path, ['-gui', '-do', 'run.do'], {
      cwd: info.dir,
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr?.on('data', (chunk: Buffer) => streamToLog(runtime, chunk.toString()));
    child.on('error', (error: NodeJS.ErrnoException) => {
      runtime.log(`✗ [Questa] Failed to launch vsim: ${error.message}`, 'red');
      if (error.code === 'ENOENT') {
        runtime.log(`  → vsim not found at: ${vsim.path}`, 'dim');
        runtime.log('  → Fix the path in ⚙ CONFIG → vsim binary.', 'dim');
      }
      void vscode.window
        .showErrorMessage(`Cannot launch Questa: ${error.message}`, 'Open Config')
        .then((selection) => {
          if (selection) void vscode.commands.executeCommand('multihdLauncher.setConfig');
        });
    });
  } catch (error) {
    runtime.log(`✗ [Questa] Failed to launch vsim: ${errorText(error)}`, 'red');
    return false;
  }

  runtime.log('✓ [Questa] Launched!', 'green');
  return true;
}

// ─── Quartus Prime (Qt parity: Launch Quartus Prime command) ─────────────────

/** Qt `launchForQuartus()` — generate `.qpf/.qsf/.sdc`, spawn `quartus <qpf>`. */
export async function launchQuartus(runtime: LauncherRuntime, info: ProjectInfo): Promise<void> {
  const active = activeFilesForTools(info.allSvFiles, info.excludedFiles);
  if (active.length === 0) {
    runtime.log('✗ [Quartus] No active .sv files to add.', 'red');
    return;
  }

  runtime.log('◈ [Quartus] Generating project files...', 'orange');
  let result: GenerationResult;
  try {
    result = generateQuartusFiles({
      dir: info.dir,
      projectName: info.projectName,
      activeFiles: active,
      timestamp: isoNow(),
    });
  } catch (error) {
    runtime.log(`✗ [Quartus] Failed to write project files: ${errorText(error)}`, 'red');
    return;
  }
  logGenerationResult(runtime, result);
  runtime.log('✓ [Quartus] Files written.', 'green');

  const values = getConfigValues();
  const quartus = resolveQuartus(values);
  const qpfPath = path.join(info.dir, `${info.projectName}.qpf`);

  if (!quartus.found) {
    runtime.log('⚠ [Quartus] quartus binary not found — files written, open manually.', 'orange');
    runtime.log('  Set Quartus path in ⚙ CONFIG → Quartus binary.', 'dim');
    return;
  }

  runtime.log('▶ [Quartus] Opening Quartus Prime...', 'orange');
  try {
    const child = spawnDetached(quartus.path, [qpfPath], { cwd: info.dir });
    child.on('error', (error: Error) => {
      runtime.log(`⚠ [Quartus] Could not open Quartus Prime: ${error.message}`, 'orange');
      runtime.log('⚠ [Quartus] quartus binary not found — files written, open manually.', 'orange');
    });
  } catch (error) {
    runtime.log(`⚠ [Quartus] Could not open Quartus Prime: ${errorText(error)}`, 'orange');
    runtime.log('⚠ [Quartus] quartus binary not found — files written, open manually.', 'orange');
    return;
  }
  runtime.log('✓ [Quartus] Launched!', 'green');
}

// ─── Gowin EDA (Qt parity: Launch Gowin EDA command) ─────────────────────────

export interface GowinCstRequest {
  dir: string;
  topFile: string;
  svText: string;
  device: string;
  pn: string;
  cst: string;
}

export interface GowinCstPayload {
  cst: string;
  device: string;
  pn: string;
}

/**
 * Build the initial CST editor state (Qt `GowinCstDialog` constructor):
 * top `.sv` file, its text, auto-detected ports template and the default
 * device. Opened by extension.ts (D6); no files are written yet.
 */
export function prepareGowinCst(info: ProjectInfo): GowinCstRequest {
  const active = activeFilesForTools(info.allSvFiles, info.excludedFiles);
  const topFile = computeTopFile(active);
  let svText = '';
  if (topFile) {
    try {
      svText = fs.readFileSync(path.join(info.dir, topFile), 'utf8');
    } catch {
      svText = '';
    }
  }
  const device = DEFAULT_GOWIN_DEVICE;
  const pn = device;
  let cst = '';
  try {
    cst = buildCstTemplate(parsePorts(svText), device);
  } catch {
    cst = '';
  }
  return { dir: info.dir, topFile, svText, device, pn, cst };
}

/**
 * Qt `generateGowinFiles()`: write `.cst/.f/.gprj` + `impl/pnr/`, then (for the
 * Launch Gowin command) spawn `gw_ide <dir>/<project>.gprj`.
 * Called from extension.ts after the CST webview resolves (D6).
 */
export async function writeGowinProject(
  runtime: LauncherRuntime,
  info: ProjectInfo,
  payload: GowinCstPayload,
  launch: boolean
): Promise<void> {
  const active = activeFilesForTools(info.allSvFiles, info.excludedFiles);
  if (active.length === 0) {
    runtime.log('✗ [Gowin] No active .sv files to add.', 'red');
    return;
  }

  const topFile = computeTopFile(active);
  const device = payload.device || DEFAULT_GOWIN_DEVICE;
  const pn = payload.pn || device;

  let result: GenerationResult;
  try {
    result = generateGowinFiles({
      dir: info.dir,
      projectName: info.projectName,
      activeFiles: active,
      topFile,
      timestamp: isoNow(),
      device,
      pn,
      cstContent: payload.cst,
    });
  } catch (error) {
    runtime.log(`✗ [Gowin] Failed to write project files: ${errorText(error)}`, 'red');
    return;
  }
  logGenerationResult(runtime, result);
  runtime.log('✓ [Gowin] Files written.', 'green');

  if (!launch) return;

  const values = getConfigValues();
  const gowin = resolveGowin(values);
  const gprjPath = path.join(info.dir, `${info.projectName}.gprj`);
  if (!gowin.found) {
    runtime.log('⚠ [Gowin] gw_ide not found — files written, open manually.', 'green');
    runtime.log('  Set Gowin path in ⚙ CONFIG → Gowin IDE binary.', 'dim');
    return;
  }

  runtime.log('▶ [Gowin] Opening Gowin IDE...', 'green');
  try {
    const child = spawnDetached(gowin.path, [gprjPath], { cwd: info.dir });
    child.on('error', (error: Error) => {
      runtime.log(`⚠ [Gowin] Could not open Gowin IDE: ${error.message}`, 'green');
      runtime.log('⚠ [Gowin] gw_ide not found — files written, open manually.', 'green');
    });
  } catch (error) {
    runtime.log(`⚠ [Gowin] Could not open Gowin IDE: ${errorText(error)}`, 'green');
    runtime.log('⚠ [Gowin] gw_ide not found — files written, open manually.', 'green');
    return;
  }
  runtime.log('✓ [Gowin] Launched!', 'green');
}

// ─── Preserved v1.9.1 flows: Run CLI / Run GUI / Show WaveForm ───────────────

/**
 * Build run.do for the preserved v1.9.1 flows (D4):
 * `extraVlogArgs` + conf `@vlogargs` / `@vsimargs` / `@work` are honoured.
 */
function writeLegacyRunDo(info: ProjectInfo, mode: 'cli' | 'gui'): {
  path: string;
  topModule: string;
  files: string[];
} {
  const values = getConfigValues();
  const files = questaFilesForCompile(info);
  const topModule = questaTopModule(info, files);
  const libraryData = {
    libs: [] as RunDoOptions['libs'],
    libFlags: [] as string[],
  };
  const extraVlogArgs = combination([values.extraVlogArgs, info.conf.vlogArgs]);
  const result = writeRunDo({
    dir: info.dir,
    files,
    topModule,
    libs: libraryData.libs,
    libFlags: libraryData.libFlags,
    timestamp: isoNow(),
    mode,
    extraVlogArgs: extraVlogArgs || undefined,
    vsimArgs: info.conf.vsimArgs || undefined,
    workLib: info.conf.workLib || 'work',
  });
  return { path: result.path, topModule, files };
}

/** Preserved v1.9.1 Run CLI: headless `vsim -c`, transcript streamed. */
export async function runCliFlow(runtime: LauncherRuntime, info: ProjectInfo): Promise<boolean> {
  const values = getConfigValues();
  const files = questaFilesForCompile(info);
  if (files.length === 0) {
    void vscode.window.showErrorMessage('No .sv files found in directory.');
    return false;
  }

  const { path: runDoPath, topModule } = writeLegacyRunDo(info, 'cli');
  const vsim = resolveVsim(values);
  const env = buildQuestaEnvironment(values, vsim.path);

  runtime.log('▶ MultiHD Launcher  [CLI — headless, no waveform]', 'cyan');
  runtime.log(`  Dir:    ${info.dir}`);
  runtime.log(`  Files:  ${files.join(', ')}`);
  runtime.log(`  run.do: ${runDoPath}`);
  runtime.log(`  vsim:   ${vsim.path}`);
  runtime.log(`  Top:    ${topModule}`);
  runtime.log('─'.repeat(60));

  try {
    // argv-only headless invocation (cwd = dir, so 'run.do' needs no path).
    const child = spawnStreaming(
      vsim.path,
      ['-c', '-do', 'run.do'],
      { cwd: info.dir, env },
      {
        onStdout: (text) => runtime.log(text.replace(/\r?\n$/, '')),
        onStderr: (text) => runtime.log(text.replace(/\r?\n$/, '')),
      }
    );
    child.on('close', (code: number | null) => {
      runtime.log('─'.repeat(60));
      if (code === 0) {
        runtime.log('✓ Simulation complete.', 'green');
        void vscode.window.showInformationMessage('✓ Questa CLI simulation complete.');
      } else {
        runtime.log(`✗ Questa exited with code ${code}`, 'red');
        void vscode.window.showErrorMessage(
          `✗ Questa failed (exit ${code}). See Output → MultiHD Launcher.`
        );
      }
    });
    child.on('error', (error: Error) => {
      runtime.log(`✗ Failed to launch Questa: ${error.message}`, 'red');
      void vscode.window.showErrorMessage(`Cannot launch Questa: ${error.message}`);
    });
  } catch (error) {
    runtime.log(`✗ Failed to launch Questa: ${errorText(error)}`, 'red');
    void vscode.window.showErrorMessage(`Cannot launch Questa: ${errorText(error)}`);
    return false;
  }
  return true;
}

/** Preserved v1.9.1 Run GUI: full Questa GUI with waveforms. */
export async function runGuiFlow(runtime: LauncherRuntime, info: ProjectInfo): Promise<boolean> {
  const values = getConfigValues();
  const files = questaFilesForCompile(info);
  if (files.length === 0) {
    void vscode.window.showErrorMessage('No .sv files found in directory.');
    return false;
  }

  const { path: runDoPath, topModule } = writeLegacyRunDo(info, 'gui');
  const vsim = resolveVsim(values);
  const env = buildQuestaEnvironment(values, vsim.path);

  runtime.log('🖥 MultiHD Launcher  [GUI — with waveforms]', 'cyan');
  runtime.log(`  Dir:    ${info.dir}`);
  runtime.log(`  Files:  ${files.join(', ')}`);
  runtime.log(`  Top:    ${topModule}`);
  runtime.log(`  run.do: ${runDoPath}`);
  runtime.log(`  vsim:   ${vsim.path}`);
  runtime.log('─'.repeat(60));

  try {
    // Launch WITHOUT -c so the GUI opens; pass the run.do absolute path.
    const child = spawnDetached(vsim.path, ['-do', runDoPath], {
      cwd: info.dir,
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr?.on('data', (chunk: Buffer) => streamToLog(runtime, chunk.toString()));
    child.on('error', (error: NodeJS.ErrnoException) => {
      runtime.log(`✗ Failed to launch Questa GUI: ${error.message}`, 'red');
      if (error.code === 'ENOENT') {
        runtime.log(`  → vsim not found at: ${vsim.path}`, 'dim');
        runtime.log('  → Set the correct path via ⚙ CONFIG.', 'dim');
      }
      void vscode.window
        .showErrorMessage(`Cannot launch Questa GUI: ${error.message}. Open ⚙ CONFIG to fix.`, 'Open Config')
        .then((selection) => {
          if (selection) void vscode.commands.executeCommand('multihdLauncher.setConfig');
        });
    });
  } catch (error) {
    runtime.log(`✗ Failed to launch Questa GUI: ${errorText(error)}`, 'red');
    void vscode.window.showErrorMessage(`Cannot launch Questa GUI: ${errorText(error)}`);
    return false;
  }

  void vscode.window.showInformationMessage(
    `🖥 Questa GUI launched for ${topModule} — waveforms loading automatically.`
  );
  runtime.log('✓ Questa GUI launched (PID detached). Close the Questa window when done.', 'green');
  runtime.log(`  DISPLAY: ${env['DISPLAY'] || '(not set)'}`, 'dim');
  runtime.log(`  vsim:    ${vsim.path}`, 'dim');
  return true;
}

/** Preserved v1.9.1 Show WaveForm: reopen the existing vsim.wlf. */
export async function showWaveformFlow(runtime: LauncherRuntime, info: ProjectInfo): Promise<boolean> {
  const dir = info.dir;
  const wlfPath = path.join(dir, 'vsim.wlf');
  const values = getConfigValues();

  if (!fs.existsSync(wlfPath)) {
    const choice = await vscode.window.showWarningMessage(
      'No vsim.wlf found in this directory. Run a simulation first to generate the waveform file.',
      'Run CLI (headless)',
      'Run GUI (with waveforms)'
    );
    if (choice === 'Run CLI (headless)') return runCliFlow(runtime, info);
    if (choice === 'Run GUI (with waveforms)') return runGuiFlow(runtime, info);
    return false;
  }

  const vsim = resolveVsim(values);
  const env = buildQuestaEnvironment(values, vsim.path);
  const waveDo = path.join(dir, 'wave.do');
  fs.writeFileSync(
    waveDo,
    `# wave.do — generated by MultiHD Launcher (Show WaveForm)\n` +
      `add wave -r /*\n` +
      `wave zoom full\n`,
    'utf8'
  );

  runtime.log('〰 MultiHD Launcher  [Show WaveForm only]', 'cyan');
  runtime.log(`  WLF:     ${wlfPath}`);
  runtime.log(`  wave.do: ${waveDo}`);
  runtime.log(`  vsim:    ${vsim.path}`);
  runtime.log('─'.repeat(60));

  try {
    const child = spawnDetached(vsim.path, ['-view', wlfPath, '-do', waveDo], {
      cwd: dir,
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr?.on('data', (chunk: Buffer) => streamToLog(runtime, chunk.toString()));
    child.on('error', (error: NodeJS.ErrnoException) => {
      runtime.log(`✗ Failed to launch WaveForm viewer: ${error.message}`, 'red');
      if (error.code === 'ENOENT') {
        runtime.log(`  → vsim not found at: ${vsim.path}`, 'dim');
        runtime.log('  → Set the correct path via ⚙ CONFIG.', 'dim');
      }
      void vscode.window
        .showErrorMessage(`Cannot open WaveForm: ${error.message}`, 'Open Config')
        .then((selection) => {
          if (selection) void vscode.commands.executeCommand('multihdLauncher.setConfig');
        });
    });
  } catch (error) {
    runtime.log(`✗ Failed to launch WaveForm viewer: ${errorText(error)}`, 'red');
    void vscode.window.showErrorMessage(`Cannot open WaveForm: ${errorText(error)}`);
    return false;
  }

  void vscode.window.showInformationMessage('〰 WaveForm viewer opened — loading vsim.wlf');
  runtime.log('✓ Questa WaveForm viewer launched (PID detached).', 'green');
  runtime.log(`  DISPLAY: ${env['DISPLAY'] || '(not set)'}`, 'dim');
  runtime.log(`  vsim:    ${vsim.path}`, 'dim');
  return true;
}
