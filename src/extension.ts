// ─────────────────────────────────────────────────────────────────────────────
// MultiHD Launcher — extension entry point (v2.0.0)
// (see multihd-port/CONTRACT.md §4 commands, §6 architecture, §7.3 panel hosts,
//  §8 acceptance F1-F13, §11 decisions D1-D10)
//
// Contains: activation, command registration (17 `multihdLauncher.*` commands +
// hidden legacy `questaLauncher.*` aliases), all six panel hosts, Qt-parity
// launch orchestration (incl. the Gowin CST hand-off, D6), and the preserved
// Help / Dependency Resolver panels (v1.9.1 behaviour, rebranded, docs loaded
// from extensionPath at runtime).
//
// The heavy lifting lives in src/core/*; this file only wires VS Code APIs.
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { LogKind, ProjectInfo, TargetTool } from './models';
import {
  getConfigValues,
  getLicenseStatus,
  isLicenseFileOk,
  resolveVsim,
  saveConfigValues,
  updateSetting,
} from './core/config';
import {
  GowinCstPayload,
  LauncherRuntime,
  launchQuartus,
  launchQuesta,
  openInstallQuesta,
  openLicenseRequest,
  prepareGowinCst,
  runCliFlow,
  runGuiFlow,
  showWaveformFlow,
  validateProjectDir,
  validateTargets,
  writeGowinProject,
} from './core/launcher';
import {
  activeFilesForTools,
  buildProjectInfo,
  defaultConfTemplate,
  isValidProjectDir,
  resolveProjectDir,
  resolveProjectDirSync,
  scanSvFiles,
} from './core/project';
import { ProjectStateStore } from './core/state';
import { LibraryManager } from './tools/library';
import type {
  ConfigHost,
  CstHost,
  ExcludeHost,
  LauncherAction,
  LauncherHost,
  LauncherPanelHandle,
  LauncherState,
  LibraryHost,
  PriorityHost,
} from './ui/api';
import { isCyberPanelOpen } from './ui/base';
import { showCstPanel } from './ui/cstPanel';
import { showConfigPanel } from './ui/configPanel';
import { showExcludePanel } from './ui/excludePanel';
import { showLauncherPanel } from './ui/launcherPanel';
import { showLibraryPanel } from './ui/libraryPanel';
import { showPriorityPanel } from './ui/priorityPanel';

// ─── module state ───────────────────────────────────────────────────────────

let extensionContext!: vscode.ExtensionContext;
let outputChannel!: vscode.OutputChannel;
let projectState!: ProjectStateStore;
let libraryManager: LibraryManager | undefined;
let launcherPanel: LauncherPanelHandle | undefined;

/** Current project directory shown by the launcher panel ('' = none). */
let currentProjectDir = '';
/** COMPILE FOR checkbox state (Qt default: Questa ticked). */
const launchTargets: Record<TargetTool, boolean> = {
  questa: true,
  quartus: false,
  gowin: false,
};
/** True while a multi-target launch sequence is running. */
let launchBusy = false;

const TARGET_ORDER: TargetTool[] = ['questa', 'quartus', 'gowin'];

// ─── logging ────────────────────────────────────────────────────────────────

/** Write a log line to the “MultiHD Launcher” Output channel + launcher panel. */
function log(line: string, _kind: LogKind = 'plain'): void {
  outputChannel.appendLine(line);
  appendLogToLauncherPanel(line);
}

/** The panel handle exposes `disposed` at runtime (LauncherPanelHandleImpl). */
function launcherHandleAlive(): boolean {
  if (!launcherPanel) return false;
  const maybe = launcherPanel as unknown as { disposed?: boolean };
  return maybe.disposed !== true;
}

function appendLogToLauncherPanel(line: string): void {
  if (!launcherHandleAlive()) {
    launcherPanel = undefined;
    return;
  }
  try {
    launcherPanel?.appendLog(line);
  } catch {
    // Panel was disposed — the next open creates a fresh handle.
    launcherPanel = undefined;
  }
}

function refreshLauncherPanel(): void {
  if (!launcherHandleAlive()) {
    launcherPanel = undefined;
    return;
  }
  try {
    launcherPanel?.refresh();
  } catch {
    launcherPanel = undefined;
  }
}

function launcherRuntime(): LauncherRuntime {
  return { context: extensionContext, libraryManager, log };
}

// ─── project info helpers ───────────────────────────────────────────────────

function buildInfoForDir(dir: string): ProjectInfo {
  const info = buildProjectInfo(
    dir,
    projectState.excludedFiles(dir),
    projectState.customOrder(dir)
  );
  void projectState.prune(dir, info.allSvFiles);
  return info;
}

function currentInfo(): ProjectInfo | undefined {
  if (!currentProjectDir || !isValidProjectDir(currentProjectDir)) return undefined;
  return buildInfoForDir(currentProjectDir);
}

function setCurrentProjectDir(dir: string): void {
  currentProjectDir = path.resolve(dir);
  if (isValidProjectDir(currentProjectDir)) {
    void projectState.prune(currentProjectDir, scanSvFiles(currentProjectDir));
  }
  refreshLauncherPanel();
}

function uriFromArgs(args: unknown[]): vscode.Uri | undefined {
  const first = args[0];
  return first instanceof vscode.Uri ? first : undefined;
}

async function pickProjectFolder(startDir?: string): Promise<string | undefined> {
  const picked = await vscode.window.showOpenDialog({
    title: 'Select Project Folder',
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Select folder',
    defaultUri:
      startDir && isValidProjectDir(startDir) ? vscode.Uri.file(startDir) : undefined,
  });
  return picked?.[0]?.fsPath;
}

/** Resolve project info for a launch command (Qt validation messages apply). */
async function resolveInfoForLaunch(uri?: vscode.Uri): Promise<ProjectInfo | undefined> {
  const dir = await resolveProjectDir(uri, { prompt: true });
  if (!dir || !isValidProjectDir(dir)) {
    await vscode.window.showWarningMessage('Please select a valid project folder.');
    return undefined;
  }
  currentProjectDir = dir;
  return buildInfoForDir(dir);
}

/**
 * Resolve project info for the preserved v1.9.1 commands. Uses the v1.9.1
 * `No .sv file open.` / `No .sv files found in directory.` error texts.
 */
async function resolveInfoForFileCommand(
  uri?: vscode.Uri
): Promise<ProjectInfo | undefined> {
  const dir = await resolveProjectDir(uri, { prompt: true });
  if (!dir) {
    void vscode.window.showErrorMessage('No .sv file open.');
    return undefined;
  }
  currentProjectDir = dir;
  const info = buildInfoForDir(dir);
  if (info.allSvFiles.length === 0) {
    void vscode.window.showErrorMessage('No .sv files found in directory.');
    return undefined;
  }
  return info;
}

// ─── launcher panel host (CONTRACT §7.3) ────────────────────────────────────

const launcherHost: LauncherHost = {
  getState(): LauncherState {
    const info = currentInfo();
    const values = getConfigValues();
    const license = getLicenseStatus(values);
    return {
      projectDir: currentProjectDir,
      hasProject: !!info,
      svFileCount: info?.allSvFiles.length ?? 0,
      targets: { ...launchTargets },
      licenseOk: license.ok,
      licensePath: license.path,
      licenseMessage: license.message,
      excludedFiles: info?.excludedFiles ?? [],
      customOrder: info?.customOrder ?? [],
      vsimPath: resolveVsim(values).path,
      busy: launchBusy,
    };
  },

  async dispatch(action: LauncherAction): Promise<void> {
    switch (action.type) {
      case 'browse': {
        const picked = await pickProjectFolder(
          currentProjectDir || getConfigValues().defaultFolder
        );
        if (picked) setCurrentProjectDir(picked);
        refreshLauncherPanel();
        return;
      }
      case 'setFolder': {
        if (action.dir && action.dir.trim()) setCurrentProjectDir(action.dir.trim());
        refreshLauncherPanel();
        return;
      }
      case 'refresh': {
        refreshLauncherPanel();
        return;
      }
      case 'toggleTarget': {
        launchTargets[action.tool] = action.checked;
        return;
      }
      case 'openConfig': {
        await vscode.commands.executeCommand('multihdLauncher.setConfig');
        return;
      }
      case 'openPriority': {
        await openPriorityForCurrentDir();
        return;
      }
      case 'openExclude': {
        await openExcludeForCurrentDir();
        return;
      }
      case 'openLibrary': {
        await vscode.commands.executeCommand('multihdLauncher.libraryManager');
        return;
      }
      case 'openGowinCst': {
        await openGowinCstForCurrentDir();
        return;
      }
      case 'installQuesta': {
        await openInstallQuesta(launcherRuntime());
        return;
      }
      case 'licenseRequest': {
        await openLicenseRequest(launcherRuntime());
        return;
      }
      case 'restoreFile': {
        await restoreExcludedFile(action.file);
        return;
      }
      case 'launch': {
        await launchFromPanel();
        return;
      }
      default: {
        const exhaustive: never = action;
        void exhaustive;
        return;
      }
    }
  },
};

function ensureLauncherPanel(): LauncherPanelHandle {
  if (!launcherPanel) {
    launcherPanel = showLauncherPanel(extensionContext, launcherHost);
  }
  return launcherPanel;
}

function revealLauncherPanel(): void {
  if (!launcherHandleAlive()) launcherPanel = undefined;
  try {
    ensureLauncherPanel().reveal();
  } catch {
    launcherPanel = showLauncherPanel(extensionContext, launcherHost);
    launcherPanel.reveal();
  }
}

// ─── launch orchestration ───────────────────────────────────────────────────

/**
 * Qt `MainWindow::launch()` sequence: validate folder → validate targets →
 * Questa → Quartus → Gowin. A blocked Questa license does not stop Quartus /
 * Gowin (Qt parity, F3).
 */
async function performLaunch(info: ProjectInfo, selected: TargetTool[]): Promise<void> {
  if (!(await validateProjectDir(info.dir))) return;
  if (!(await validateTargets(selected))) return;

  launchBusy = true;
  refreshLauncherPanel();
  try {
    for (const tool of TARGET_ORDER) {
      if (!selected.includes(tool)) continue;
      if (tool === 'questa') {
        await launchQuesta(launcherRuntime(), info);
      } else if (tool === 'quartus') {
        await launchQuartus(launcherRuntime(), info);
      } else {
        await launchGowinWithCst(info);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`✗ Launch failed: ${message}`, 'red');
    void vscode.window.showErrorMessage(`MultiHD Launcher: ${message}`);
  } finally {
    launchBusy = false;
    refreshLauncherPanel();
  }
}

async function launchFromPanel(): Promise<void> {
  const info = currentInfo();
  if (!info) {
    await vscode.window.showWarningMessage('Please select a valid project folder.');
    return;
  }
  const selected = TARGET_ORDER.filter((tool) => launchTargets[tool]);
  await performLaunch(info, selected);
}

/**
 * Gowin CST hand-off (D6): extension.ts opens the webview and resolves a
 * promise; core/launcher receives cst/device/pn and writes + launches.
 */
interface CstPanelHandleLike {
  onDidDispose?: (callback: () => void) => void;
  dispose?: () => void;
}

function requestGowinCst(info: ProjectInfo): Promise<GowinCstPayload | undefined> {
  return new Promise<GowinCstPayload | undefined>((resolve) => {
    const request = prepareGowinCst(info);
    let settled = false;
    let saved = false;
    let poll: NodeJS.Timeout | undefined;

    const stopWatching = (): void => {
      if (poll) {
        clearInterval(poll);
        poll = undefined;
      }
    };
    const finish = (payload?: GowinCstPayload): void => {
      if (settled) return;
      settled = true;
      stopWatching();
      resolve(payload);
    };

    const host: CstHost = {
      getState: () => ({
        dir: request.dir,
        topFile: request.topFile,
        svText: request.svText,
        device: request.device,
        pn: request.pn,
        cst: request.cst,
      }),
      save: async (payload: GowinCstPayload): Promise<void> => {
        saved = true;
        finish(payload);
      },
    };

    // Optional 3rd callback is provided by newer panel versions; older ones
    // ignore it (extra argv is harmless at runtime).
    const show = showCstPanel as unknown as (
      context: vscode.ExtensionContext,
      panelHost: CstHost,
      onCancel?: () => void
    ) => CstPanelHandleLike | undefined;
    const maybeHandle = show(extensionContext, host, () => {
      if (!saved) finish(undefined);
    });
    maybeHandle?.onDidDispose?.(() => {
      if (!saved) finish(undefined);
    });

    // Reliable fallback that works with today's void-returning showCstPanel:
    // watch the shared panel registry; a closed tab means "cancelled" (D6).
    poll = setInterval(() => {
      if (settled) {
        stopWatching();
        return;
      }
      if (!isCyberPanelOpen('multihdLauncher.cstPanel')) {
        if (!saved) finish(undefined);
        else stopWatching();
      }
    }, 250);
  });
}

async function launchGowinWithCst(info: ProjectInfo): Promise<void> {
  const active = activeFilesForTools(info.allSvFiles, info.excludedFiles);
  if (active.length === 0) {
    log('✗ [Gowin] No active .sv files to add.', 'red');
    return;
  }
  log('◆ [Gowin] Opening constraint editor...', 'green');
  const payload = await requestGowinCst(info);
  if (!payload) {
    log('✗ [Gowin] Cancelled — no files written.', 'red');
    return;
  }
  await writeGowinProject(launcherRuntime(), info, payload, true);
}

async function openGowinCstForCurrentDir(): Promise<void> {
  const info = currentInfo();
  if (!info) {
    await vscode.window.showWarningMessage('Please select a valid project folder.');
    return;
  }
  openStandaloneCstPanel(info);
}

/** Gowin CST editor standalone (no IDE launch, contract §4 command table). */
function openStandaloneCstPanel(info: ProjectInfo): void {
  const request = prepareGowinCst(info);
  const host: CstHost = {
    getState: () => ({
      dir: request.dir,
      topFile: request.topFile,
      svText: request.svText,
      device: request.device,
      pn: request.pn,
      cst: request.cst,
    }),
    save: async (payload: GowinCstPayload): Promise<void> => {
      await writeGowinProject(launcherRuntime(), info, payload, false);
      refreshLauncherPanel();
    },
  };
  showCstPanel(extensionContext, host);
}

// ─── config panel host (CONTRACT §7.3) ──────────────────────────────────────

type ConfigBrowseKind = Parameters<ConfigHost['browse']>[0];

async function browseConfigField(
  kind: ConfigBrowseKind,
  current: string
): Promise<string | undefined> {
  const startUri =
    current && current.trim()
      ? kind === 'folder'
        ? vscode.Uri.file(current.trim())
        : vscode.Uri.file(current.trim())
      : vscode.Uri.file(os.homedir());

  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: kind !== 'folder',
    canSelectFolders: kind === 'folder',
    canSelectMany: false,
    title:
      kind === 'vsim'
        ? 'Select vsim binary'
        : kind === 'license'
          ? 'Select Questa license file'
          : kind === 'folder'
            ? 'Default project folder'
            : kind === 'quartus'
              ? 'Select Quartus binary'
              : 'Select Gowin IDE binary',
    openLabel:
      kind === 'vsim'
        ? 'Use this vsim'
        : kind === 'license'
          ? 'Use this license'
          : kind === 'folder'
            ? 'Use this folder'
            : 'Use this binary',
    filters:
      kind === 'license'
        ? { 'License files': ['dat', 'lic'], 'All files': ['*'] }
        : undefined,
    defaultUri: startUri,
  });
  return picked?.[0]?.fsPath;
}

const configHost: ConfigHost = {
  load: () => getConfigValues(),
  save: async (values) => {
    await saveConfigValues(values);
    log('⚙ Configuration saved.', 'purple');
    refreshLauncherPanel();
  },
  isLicenseOk: (values) => isLicenseFileOk(values.licenseFile),
  browse: browseConfigField,
};

function openConfigPanel(): void {
  showConfigPanel(extensionContext, configHost);
}

// ─── exclude panel host (CONTRACT §7.3) ────────────────────────────────────

async function applyExclusions(dir: string, excluded: string[]): Promise<void> {
  const files = scanSvFiles(dir);
  const valid = excluded.filter((file) => files.includes(file));
  await projectState.setExcludedFiles(dir, valid);

  if (valid.length > 0) {
    log(`✕ ${valid.length} file(s) excluded from compilation:`, 'red');
    for (const file of valid) log(`    ${file}`, 'dim');
  } else {
    log('✓ All files included (no exclusions).', 'green');
  }
  refreshLauncherPanel();
}

async function openExcludeForCurrentDir(): Promise<void> {
  const dir = currentProjectDir;
  if (!dir || !isValidProjectDir(dir)) {
    await vscode.window.showWarningMessage('Please select a project folder first.');
    return;
  }
  openExcludePanelForDir(dir);
}

function openExcludePanelForDir(dir: string): void {
  const files = scanSvFiles(dir);
  if (files.length === 0) {
    void vscode.window.showInformationMessage('No .sv files found in the selected folder.');
    return;
  }
  const host: ExcludeHost = {
    getState: () => ({
      dir,
      files,
      excluded: projectState.excludedFiles(dir).filter((file) => files.includes(file)),
    }),
    apply: async (excluded) => {
      await applyExclusions(dir, excluded);
    },
  };
  showExcludePanel(extensionContext, host);
}

async function restoreExcludedFile(file: string): Promise<void> {
  const dir = currentProjectDir;
  if (!dir || !isValidProjectDir(dir)) return;
  const excluded = projectState.excludedFiles(dir).filter((entry) => entry !== file);
  await projectState.setExcludedFiles(dir, excluded);
  log(`↩ Restored: ${file}`, 'green');
  refreshLauncherPanel();
}

// ─── priority (compile order) panel host (CONTRACT §7.3) ────────────────────

async function applyCustomOrder(dir: string, order: string[]): Promise<void> {
  const allowed = scanSvFiles(dir);
  const valid = order.filter((file) => allowed.includes(file));
  await projectState.setCustomOrder(dir, valid);

  if (valid.length === 0) {
    log('✓ Compile order reset to default.', 'green');
  } else {
    log('⚡ Custom compile order set:', 'orange');
    valid.forEach((file, index) => log(`  [${index + 1}] ${file}`, 'orange'));
  }
  refreshLauncherPanel();
}

interface PriorityDialogState {
  files: string[];
  customOrder: string[];
}

function priorityDialogState(dir: string): PriorityDialogState {
  const info = buildInfoForDir(dir);
  let files = activeFilesForTools(info.allSvFiles, info.excludedFiles);
  const customOrder = info.customOrder;
  if (customOrder.length > 0) {
    const filtered = customOrder.filter((file) => files.includes(file));
    for (const file of files) {
      if (!filtered.includes(file)) filtered.push(file);
    }
    files = filtered;
  }
  return { files, customOrder };
}

async function openPriorityForCurrentDir(): Promise<void> {
  const dir = currentProjectDir;
  if (!dir || !isValidProjectDir(dir)) {
    await vscode.window.showWarningMessage('Please select a project folder first.');
    return;
  }
  openPriorityPanelForDir(dir);
}

function openPriorityPanelForDir(dir: string): void {
  const initial = priorityDialogState(dir);
  if (initial.files.length === 0) {
    void vscode.window.showWarningMessage(
      'No .sv files available (all may be excluded).\n' +
        'Restore some files from the EXCLUDED FILES panel first.'
    );
    return;
  }
  const host: PriorityHost = {
    getState: () => {
      const state = priorityDialogState(dir);
      return { dir, files: state.files, customOrder: state.customOrder };
    },
    apply: async (order) => {
      await applyCustomOrder(dir, order);
    },
  };
  showPriorityPanel(extensionContext, host);
}

// ─── library manager panel host (CONTRACT §7.3) ────────────────────────────

function libraryEntries(): Array<{
  name: string;
  sourcePath: string;
  compiled: boolean;
  compiledAt: string;
}> {
  if (!libraryManager) return [];
  return libraryManager.libraries().map((entry) => ({
    name: entry.name,
    sourcePath: entry.sourcePath,
    compiled: entry.compiled,
    compiledAt: typeof entry.compiledAt === 'string' ? entry.compiledAt : '',
  }));
}

const libraryHost: LibraryHost = {
  getState: () => {
    const values = getConfigValues();
    return {
      projectDir: currentProjectDir,
      vsimPath: resolveVsim(values).path,
      libraries: libraryEntries(),
      projectDeps:
        currentProjectDir && isValidProjectDir(currentProjectDir) && libraryManager
          ? libraryManager.projectDeps(currentProjectDir)
          : [],
    };
  },

  addLibrary: async (name, sourcePath) => {
    if (!libraryManager) return { ok: false, error: 'Library manager unavailable.' };
    const result = libraryManager.addLibrary(name, sourcePath);
    if (result.ok) {
      log(`✓ Library "${name.trim()}" registered. Compile it to use it.`, 'green');
    } else if (result.error) {
      log(`✕ ${result.error}`, 'red');
    }
    return result;
  },

  removeLibrary: async (name) => {
    if (!libraryManager) return { ok: false, error: 'Library manager unavailable.' };
    const result = libraryManager.removeLibrary(name);
    if (result.ok) {
      log(`✓ Library "${name}" removed.`, 'green');
    } else if (result.error) {
      log(`✕ ${result.error}`, 'red');
    }
    return result;
  },

  compileLibrary: async (name) => {
    if (!libraryManager) return { ok: false, error: 'Library manager unavailable.' };
    const vsim = resolveVsim(getConfigValues());
    if (!vsim.found) {
      return { ok: false, error: 'vsim path not configured. Open ⚙ CONFIG first.' };
    }
    log(`⚡ Compiling library "${name}" ...`, 'orange');
    const result = await libraryManager.compileLibrary(name, vsim.path);
    if (result.ok) {
      log(`✓ Library "${name}" compiled.`, 'green');
    } else if (result.error) {
      log(`✕ ${result.error}`, 'red');
    }
    return result;
  },

  setProjectDeps: async (deps) => {
    if (!currentProjectDir || !isValidProjectDir(currentProjectDir)) return;
    if (!libraryManager) return;
    libraryManager.setProjectDeps(currentProjectDir, deps);
    log(`📦 Project libraries: ${deps.join(', ')}`, 'cyan');
    refreshLauncherPanel();
  },

  browseFolder: async (current) => {
    const picked = await vscode.window.showOpenDialog({
      title: 'Select Library Source Folder',
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Use this folder',
      defaultUri: current && isValidProjectDir(current) ? vscode.Uri.file(current) : vscode.Uri.file(os.homedir()),
    });
    return picked?.[0]?.fsPath;
  },
};

function openLibraryPanel(): void {
  showLibraryPanel(extensionContext, libraryHost);
}

// ─── command handlers ───────────────────────────────────────────────────────

async function cmdOpenLauncher(uri?: vscode.Uri): Promise<void> {
  const dir = await resolveProjectDir(uri, { prompt: false });
  if (dir) currentProjectDir = dir;
  revealLauncherPanel();
}

async function cmdRunCli(uri?: vscode.Uri): Promise<void> {
  const info = await resolveInfoForFileCommand(uri);
  if (info) await runCliFlow(launcherRuntime(), info);
}

async function cmdRunGui(uri?: vscode.Uri): Promise<void> {
  const info = await resolveInfoForFileCommand(uri);
  if (info) await runGuiFlow(launcherRuntime(), info);
}

async function cmdShowWaveform(uri?: vscode.Uri): Promise<void> {
  const info = await resolveInfoForFileCommand(uri);
  if (info) await showWaveformFlow(launcherRuntime(), info);
}

async function cmdLaunchQuesta(uri?: vscode.Uri): Promise<void> {
  const info = await resolveInfoForLaunch(uri);
  if (info) await performLaunch(info, ['questa']);
}

async function cmdLaunchQuartus(uri?: vscode.Uri): Promise<void> {
  const info = await resolveInfoForLaunch(uri);
  if (info) await performLaunch(info, ['quartus']);
}

async function cmdLaunchGowin(uri?: vscode.Uri): Promise<void> {
  const info = await resolveInfoForLaunch(uri);
  if (info) await performLaunch(info, ['gowin']);
}

async function cmdSetConfig(): Promise<void> {
  openConfigPanel();
}

async function cmdSetPriority(uri?: vscode.Uri): Promise<void> {
  const dir = await resolveProjectDir(uri, { prompt: true });
  if (!dir || !isValidProjectDir(dir)) {
    await vscode.window.showWarningMessage('Please select a project folder first.');
    return;
  }
  currentProjectDir = dir;
  openPriorityPanelForDir(dir);
}

async function cmdExcludeFiles(uri?: vscode.Uri): Promise<void> {
  const dir = await resolveProjectDir(uri, { prompt: true });
  if (!dir || !isValidProjectDir(dir)) {
    await vscode.window.showWarningMessage('Please select a project folder first.');
    return;
  }
  currentProjectDir = dir;
  openExcludePanelForDir(dir);
}

async function cmdLibraryManager(uri?: vscode.Uri): Promise<void> {
  const dir = await resolveProjectDir(uri, { prompt: false });
  if (dir && isValidProjectDir(dir)) currentProjectDir = dir;
  openLibraryPanel();
}

async function cmdGowinCst(uri?: vscode.Uri): Promise<void> {
  const dir = await resolveProjectDir(uri, { prompt: true });
  if (!dir || !isValidProjectDir(dir)) {
    await vscode.window.showWarningMessage('Please select a valid project folder.');
    return;
  }
  currentProjectDir = dir;
  openStandaloneCstPanel(buildInfoForDir(dir));
}

async function cmdInstallHelpers(): Promise<void> {
  const runtime = launcherRuntime();
  await openInstallQuesta(runtime);
  await openLicenseRequest(runtime);
}

/**
 * Preserved v1.9.1 Set License picker (rebranded), writing the v2 settings with
 * the same SALT_LICENSE_SERVER / LM_LICENSE_FILE semantics.
 */
async function cmdSetLicense(): Promise<void> {
  const values = getConfigValues();
  const currentSalt = values.saltLicenseServer || process.env['SALT_LICENSE_SERVER'] || '';
  const currentLm = values.licenseFile || process.env['LM_LICENSE_FILE'] || '';

  type LicItem = vscode.QuickPickItem & { action: string };

  const items: LicItem[] = [
    {
      label: '$(key) SALT_LICENSE_SERVER',
      description: currentSalt || '(not set)',
      detail: 'Questa FSE / Starter Edition — path to .dat file or port@host',
      action: 'salt',
    },
    {
      label: '$(file) LM_LICENSE_FILE',
      description: currentLm || '(not set)',
      detail: 'General FlexLM — path to license file or port@host',
      action: 'lm',
    },
    {
      label: '$(folder-opened) Browse for license file…',
      description: '',
      detail: 'Open a file picker to locate your .dat / .lic file',
      action: 'browse',
    },
    {
      label: '$(refresh) Auto-detect from environment',
      description: '',
      detail: 'Re-read SALT_LICENSE_SERVER / LM_LICENSE_FILE from your shell environment',
      action: 'autodetect',
    },
  ];

  const pick = await vscode.window.showQuickPick(items, {
    title: '🔑 MultiHD Launcher License Configuration',
    placeHolder: 'Select a license setting to configure',
  });
  if (!pick) return;

  if (pick.action === 'browse') {
    const uris = await vscode.window.showOpenDialog({
      title: 'Select Questa license file',
      filters: { 'License files': ['dat', 'lic'], 'All files': ['*'] },
      canSelectMany: false,
      openLabel: 'Use this license',
    });
    if (!uris || uris.length === 0) return;
    const chosen = uris[0].fsPath;
    await updateSetting('saltLicenseServer', chosen);
    void vscode.window.showInformationMessage(`✓ SALT_LICENSE_SERVER set to: ${chosen}`);
    refreshLauncherPanel();
    return;
  }

  if (pick.action === 'autodetect') {
    const detected =
      process.env['SALT_LICENSE_SERVER'] || process.env['LM_LICENSE_FILE'] || '';
    if (!detected) {
      void vscode.window.showWarningMessage(
        'No license environment variables found in current shell. Set SALT_LICENSE_SERVER in ~/.bashrc and restart VS Code.'
      );
      return;
    }
    await updateSetting('saltLicenseServer', process.env['SALT_LICENSE_SERVER'] || '');
    await updateSetting('licenseFile', process.env['LM_LICENSE_FILE'] || '');
    void vscode.window.showInformationMessage(`✓ License auto-detected: ${detected}`);
    refreshLauncherPanel();
    return;
  }

  const isSalt = pick.action === 'salt';
  const label = isSalt ? 'SALT_LICENSE_SERVER' : 'LM_LICENSE_FILE';
  const current = isSalt ? currentSalt : currentLm;
  const value = await vscode.window.showInputBox({
    title: `Set ${label}`,
    prompt:
      'Enter full path to license file (e.g. /home/user/.licenses/questa_license.dat) or port@host',
    value: current,
    placeHolder: '/home/user/.licenses/questa_license.dat',
  });
  if (value === undefined) return;

  const key = isSalt ? 'saltLicenseServer' : 'licenseFile';
  await updateSetting(key, value);
  void vscode.window.showInformationMessage(`✓ ${label} set to: ${value}`);
  refreshLauncherPanel();
}

/** Preserved v1.9.1 Edit conf.svconf (creates the template when missing). */
async function cmdEditConf(uri?: vscode.Uri): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const fileUri = uri ?? editor?.document.uri;
  if (!fileUri) {
    void vscode.window.showErrorMessage('No file open.');
    return;
  }

  const dir = isValidProjectDir(fileUri.fsPath)
    ? fileUri.fsPath
    : path.dirname(fileUri.fsPath);
  const confPath = path.join(dir, 'conf.svconf');

  if (!fs.existsSync(confPath)) {
    const allBases = scanSvFiles(dir);
    const openedBase = path.basename(fileUri.fsPath);
    fs.writeFileSync(confPath, defaultConfTemplate(openedBase, allBases), 'utf8');
    void vscode.window.showInformationMessage('Created conf.svconf');
  }

  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(confPath));
  await vscode.window.showTextDocument(doc);
}

async function cmdHelpDocs(): Promise<void> {
  await showHelpDocs(extensionContext);
}

async function cmdHelpDeps(): Promise<void> {
  await showHelpDeps(extensionContext);
}

// ─── command registration ──────────────────────────────────────────────────

type FileCommand = (uri?: vscode.Uri) => Promise<void> | void;
type SimpleCommand = () => Promise<void> | void;

function guardCommand<T extends unknown[]>(
  handler: (...args: T) => Promise<void> | void
): (...args: T) => Promise<void> {
  return async (...args: T): Promise<void> => {
    try {
      await handler(...args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`✗ ${message}`, 'red');
      void vscode.window.showErrorMessage(`MultiHD Launcher: ${message}`);
    }
  };
}

/** Contract §4 legacy aliases — hidden, registered at runtime only. */
const LEGACY_ALIASES: Array<[legacy: string, target: string]> = [
  ['questaLauncher.run', 'multihdLauncher.run'],
  ['questaLauncher.runGui', 'multihdLauncher.runGui'],
  ['questaLauncher.showWaveform', 'multihdLauncher.showWaveform'],
  ['questaLauncher.setQuestaPath', 'multihdLauncher.setConfig'],
  ['questaLauncher.setConfig', 'multihdLauncher.setConfig'],
  ['questaLauncher.editConf', 'multihdLauncher.editConf'],
  ['questaLauncher.setPriority', 'multihdLauncher.setPriority'],
  ['questaLauncher.setLicense', 'multihdLauncher.setLicense'],
  ['questaLauncher.helpDocs', 'multihdLauncher.helpDocs'],
  ['questaLauncher.helpDeps', 'multihdLauncher.helpDeps'],
];

function registerFileHandler(
  handler: (uri?: vscode.Uri) => Promise<void> | void
): (...args: unknown[]) => Promise<void> {
  return guardCommand((...args: unknown[]) => handler(uriFromArgs(args)));
}

function registerCommands(): void {
  // ── 17 manifest commands (package.json, Lead-owned; CONTRACT §4) ─────────
  extensionContext.subscriptions.push(
    vscode.commands.registerCommand(
      'multihdLauncher.openLauncher',
      registerFileHandler(cmdOpenLauncher)
    ),
    vscode.commands.registerCommand('multihdLauncher.run', registerFileHandler(cmdRunCli)),
    vscode.commands.registerCommand('multihdLauncher.runGui', registerFileHandler(cmdRunGui)),
    vscode.commands.registerCommand(
      'multihdLauncher.showWaveform',
      registerFileHandler(cmdShowWaveform)
    ),
    vscode.commands.registerCommand(
      'multihdLauncher.launchQuesta',
      registerFileHandler(cmdLaunchQuesta)
    ),
    vscode.commands.registerCommand(
      'multihdLauncher.launchQuartus',
      registerFileHandler(cmdLaunchQuartus)
    ),
    vscode.commands.registerCommand(
      'multihdLauncher.launchGowin',
      registerFileHandler(cmdLaunchGowin)
    ),
    vscode.commands.registerCommand('multihdLauncher.setConfig', guardCommand(() => cmdSetConfig())),
    vscode.commands.registerCommand(
      'multihdLauncher.setLicense',
      guardCommand(() => cmdSetLicense())
    ),
    vscode.commands.registerCommand(
      'multihdLauncher.setPriority',
      registerFileHandler(cmdSetPriority)
    ),
    vscode.commands.registerCommand(
      'multihdLauncher.excludeFiles',
      registerFileHandler(cmdExcludeFiles)
    ),
    vscode.commands.registerCommand(
      'multihdLauncher.libraryManager',
      registerFileHandler(cmdLibraryManager)
    ),
    vscode.commands.registerCommand('multihdLauncher.gowinCst', registerFileHandler(cmdGowinCst)),
    vscode.commands.registerCommand(
      'multihdLauncher.installHelpers',
      guardCommand(() => cmdInstallHelpers())
    ),
    vscode.commands.registerCommand('multihdLauncher.editConf', registerFileHandler(cmdEditConf)),
    vscode.commands.registerCommand(
      'multihdLauncher.helpDocs',
      guardCommand(() => cmdHelpDocs())
    ),
    vscode.commands.registerCommand(
      'multihdLauncher.helpDeps',
      guardCommand(() => cmdHelpDeps())
    )
  );

  // ── legacy v1.9.1 command IDs (hidden runtime aliases, CONTRACT §4) ──────
  for (const [legacyId, targetId] of LEGACY_ALIASES) {
    extensionContext.subscriptions.push(
      vscode.commands.registerCommand(legacyId, (...args: unknown[]) => {
        if (legacyId === 'questaLauncher.setQuestaPath') {
          return vscode.commands.executeCommand(targetId);
        }
        return vscode.commands.executeCommand(targetId, ...args);
      })
    );
  }
}

// ─── status bar (rebranded v1.9.1 button) ──────────────────────────────────

function createStatusBar(): void {
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = 'multihdLauncher.openLauncher';
  statusBar.text = '$(rocket) MultiHD';
  statusBar.tooltip = 'MultiHD Launcher — open launcher';
  statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  extensionContext.subscriptions.push(statusBar);

  const update = (): void => {
    const filePath = vscode.window.activeTextEditor?.document.uri.fsPath ?? '';
    statusBar.text = '$(rocket) MultiHD';
    if (filePath.endsWith('.sv') || filePath.endsWith('.svconf')) statusBar.show();
    else statusBar.hide();
  };

  extensionContext.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => update())
  );
  update();
}

// ─────────────────────────────────────────────────────────────────────────────
// Help / Dependency Resolver webviews — preserved v1.9.1 behaviour, rebranded.
// Docs are loaded from context.extensionPath at runtime (Lead steer):
//   help      → HELP-CONTENT.md when shipped, otherwise README.md
//   deps      → DEPENDENCY.md
//   commands  → COMMANDS.md (parsed into the command-reference tab)
// ─────────────────────────────────────────────────────────────────────────────

function mdToHtml(md: string): string {
  return md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // headings
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // code blocks
    .replace(
      /```(\w*)\n([\s\S]*?)```/gm,
      (_: string, _lang: string, code: string) => `<pre><code>${code.trimEnd()}</code></pre>`
    )
    // inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // hr
    .replace(/^---$/gm, '<hr>')
    // table rows
    .replace(/^\|(.+)\|$/gm, (row: string) => {
      const cells = row.split('|').slice(1, -1);
      if (cells.every((cell: string) => /^[-: ]+$/.test(cell))) return '';
      return '<tr>' + cells.map((cell: string) => `<td>${cell.trim()}</td>`).join('') + '</tr>';
    })
    // paragraphs (non-block lines)
    .replace(/^(?!<[hpturcode]|$)(.+)$/gm, '<p>$1</p>')
    // blank lines
    .replace(/\n{2,}/g, '\n');
}

function buildHelpPanel(
  context: vscode.ExtensionContext,
  title: string,
  mdContent: string,
  isDeps: boolean
): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    'multihdHelp',
    title,
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  const body = mdToHtml(mdContent);

  // Parse command blocks for the run buttons (deps panel only)
  const commandBlocks: Array<{
    os: string;
    label: string;
    cmd: string;
    section: string;
    desc: string;
  }> = [];
  if (isDeps) {
    const commandsPath = path.join(context.extensionPath, 'COMMANDS.md');
    const cmdFile = fs.existsSync(commandsPath) ? fs.readFileSync(commandsPath, 'utf8') : '';
    let lastSection = '';
    let lastHeading = '';
    let lastDesc = '';
    const lines = cmdFile.split('\n');
    let inBlock = false;
    let blockLines: string[] = [];
    for (const line of lines) {
      // ## Section heading
      if (/^## /.test(line)) {
        lastSection = line.replace(/^#+\s*/, '').trim();
        lastDesc = '';
        continue;
      }
      // ### Command heading
      if (/^### /.test(line)) {
        lastHeading = line.replace(/^#+\s*/, '').trim();
        inBlock = false;
        blockLines = [];
        lastDesc = '';
        continue;
      }
      // Fenced code block toggle
      if (line.startsWith('```')) {
        if (!inBlock) {
          inBlock = true;
          blockLines = [];
        } else {
          const cmd = blockLines.join('\n').trim();
          if (cmd) {
            commandBlocks.push({
              os: lastHeading,
              label: lastHeading,
              cmd,
              section: lastSection,
              desc: lastDesc,
            });
          }
          inBlock = false;
          blockLines = [];
        }
        continue;
      }
      if (inBlock) {
        blockLines.push(line);
        continue;
      }
      // Description: non-empty non-heading text between ### and ``` becomes the desc
      const stripped = line.replace(/^>\s*/, '').trim();
      if (stripped && !stripped.startsWith('#') && !stripped.startsWith('---')) {
        lastDesc = stripped;
      }
    }
  }

  const blocksJson = JSON.stringify(commandBlocks);

  panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  :root {
    --bg:#0d0d1a; --bg2:#111827; --border:#1e3a5f;
    --cyan:#00e5ff; --blue:#0057a8; --blue2:#00b4d8;
    --text:#cdd6e0; --muted:#4a6680; --green:#50c878;
    --red:#ff4f4f; --yellow:#ffd700;
  }
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:var(--bg);color:var(--text);font-family:'Segoe UI',system-ui,sans-serif;font-size:14px;line-height:1.7;}

  /* Header */
  .header{background:linear-gradient(135deg,#0a0a18,#0a1628);border-bottom:1px solid var(--border);
    padding:20px 28px;display:flex;align-items:center;gap:16px;position:sticky;top:0;z-index:20;}
  .header h1{font-size:18px;color:var(--cyan);letter-spacing:1px;}
  .header p{font-size:12px;color:var(--muted);margin-top:2px;}

  /* Tabs */
  .tabs{display:flex;border-bottom:1px solid var(--border);background:var(--bg2);padding:0 28px;gap:4px;}
  .tab{padding:10px 18px;cursor:pointer;border:none;background:none;color:var(--muted);font-size:13px;
    border-bottom:2px solid transparent;transition:all .2s;}
  .tab:hover{color:var(--text);}
  .tab.active{color:var(--cyan);border-bottom-color:var(--cyan);}

  /* Content */
  .content{padding:28px;max-width:900px;}
  .page{display:none;}
  .page.active{display:block;}

  h1{font-size:22px;color:var(--cyan);margin:24px 0 12px;}
  h2{font-size:17px;color:var(--blue2);margin:20px 0 10px;border-bottom:1px solid var(--border);padding-bottom:6px;}
  h3{font-size:14px;color:var(--yellow);margin:16px 0 8px;}
  p{margin:8px 0;color:var(--text);}
  hr{border:none;border-top:1px solid var(--border);margin:20px 0;}
  code{background:#0a1628;color:var(--cyan);padding:1px 6px;border-radius:4px;font-family:'Courier New',monospace;font-size:12px;}
  pre{background:#080f1e;border:1px solid var(--border);border-radius:8px;padding:16px;overflow-x:auto;margin:12px 0;}
  pre code{background:none;color:#a8d8ea;padding:0;font-size:12px;}
  strong{color:#fff;}
  table{width:100%;border-collapse:collapse;margin:12px 0;}
  tr{border-bottom:1px solid var(--border);}
  td,th{padding:8px 12px;text-align:left;font-size:13px;}
  tr:first-child td{color:var(--cyan);font-weight:bold;background:#0a1628;}

  /* Badges */
  .os-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:bold;margin-right:4px;}
  .os-linux{background:#1a3a1a;color:var(--green);}
  .os-windows{background:#1a1a3a;color:#7aa7ff;}
  .sec-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:bold;margin-right:4px;}
  .sec-build{background:#2a1a00;color:#ffd700;border:1px solid #5a3a00;}
  .sec-install{background:#1a0a2a;color:#c084fc;border:1px solid #4a1a6f;}
  .sec-cli{background:#0a1628;color:var(--cyan);border:1px solid var(--border);}
  .sec-gui{background:#0a1628;color:#c084fc;border:1px solid #4a1a6f;}

  /* Section group */
  .section-group{margin:28px 0;}
  .section-header{display:flex;justify-content:space-between;align-items:center;
    padding:12px 18px;background:linear-gradient(90deg,#0a1628,#060c18);
    border-radius:10px 10px 0 0;border:1px solid var(--border);border-bottom:2px solid var(--cyan);}
  .section-title{font-size:15px;font-weight:bold;color:var(--cyan);}
  .section-count{font-size:11px;color:var(--muted);margin-left:8px;font-weight:normal;}
  .btn-run-all{background:linear-gradient(90deg,#0057a8,#00b4d8);color:#fff;
    border:none;border-radius:6px;padding:7px 18px;cursor:pointer;font-size:12px;font-weight:bold;transition:all .2s;}
  .btn-run-all:hover{opacity:.85;transform:scale(1.02);}

  /* Command block */
  .cmd-block{background:#080f1e;border:1px solid var(--border);border-top:none;overflow:hidden;}
  .cmd-block:last-child{border-radius:0 0 10px 10px;}
  .cmd-header{display:flex;justify-content:space-between;align-items:center;
    padding:10px 16px;background:#0a1020;border-bottom:1px solid #0d1e35;}
  .cmd-label{font-size:12px;color:var(--blue2);font-weight:bold;}
  .cmd-desc{padding:6px 16px 8px;font-size:12px;color:#7fbfff;font-style:italic;border-bottom:1px solid #0d1e35;background:#06090f;}
  .cmd-body{padding:14px 16px;}
  .cmd-body pre{margin:0;border:none;background:none;padding:0;}
  .btn{display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border:none;border-radius:6px;
    cursor:pointer;font-size:11px;font-weight:bold;transition:all .2s;}
  .btn-run{background:linear-gradient(90deg,var(--blue),var(--blue2));color:#fff;}
  .btn-run:hover{opacity:.85;}
  .btn-copy{background:#1e3a5f;color:var(--cyan);}
  .btn-copy:hover{background:#254d7a;}
  .btn-group{display:flex;gap:6px;}

  /* Log bar */
  #depLog{background:#04080f;border:1px solid var(--border);border-radius:8px;
    padding:10px 14px;font-family:monospace;font-size:12px;color:#7fbfff;margin-bottom:20px;}

  /* Approval overlay */
  #approvalOverlay{display:none;position:sticky;top:0;z-index:50;
    background:rgba(0,0,0,.85);backdrop-filter:blur(4px);
    padding:20px;border-radius:12px;margin-bottom:20px;border:2px solid var(--cyan);}
  .apv-progress{color:var(--yellow);font-size:11px;font-weight:bold;margin-bottom:10px;letter-spacing:1px;}
  .apv-label{color:var(--cyan);font-size:14px;font-weight:bold;margin-bottom:6px;}
  .apv-desc{color:#7fbfff;font-size:12px;font-style:italic;margin-bottom:12px;}
  .apv-cmd{background:#04080f;border:1px solid var(--border);border-radius:6px;
    padding:12px;overflow-x:auto;margin-bottom:14px;}
  .apv-cmd code{color:#a8d8ea;font-size:12px;font-family:'Courier New',monospace;white-space:pre;}
  .apv-btns{display:flex;gap:10px;flex-wrap:wrap;}
  .btn-approve{background:linear-gradient(90deg,#1a6a1a,#22c55e);color:#fff;padding:8px 20px;font-size:13px;}
  .btn-skip{background:#1e3a5f;color:var(--cyan);padding:8px 16px;font-size:13px;}
  .btn-cancel{background:#3a1a1a;color:var(--red);padding:8px 16px;font-size:13px;}
  .apv-done{color:var(--green);font-size:14px;font-weight:bold;padding:8px 0;}
</style>
</head>
<body>

<div class="header">
  <svg width="46" height="46" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="hbg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#0d0d1a"/><stop offset="100%" style="stop-color:#0a1628"/>
      </linearGradient>
      <linearGradient id="hbtn" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" style="stop-color:#0057a8"/><stop offset="100%" style="stop-color:#00b4d8"/>
      </linearGradient>
      <filter id="hglow"><feGaussianBlur stdDeviation="1.5" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <rect width="100" height="100" rx="16" fill="url(#hbg)"/>
    <g stroke="#00e5ff" stroke-width="0.3" opacity="0.15">
      <line x1="25" y1="0" x2="25" y2="100"/><line x1="50" y1="0" x2="50" y2="100"/>
      <line x1="75" y1="0" x2="75" y2="100"/><line x1="0" y1="25" x2="100" y2="25"/>
      <line x1="0" y1="50" x2="100" y2="50"/><line x1="0" y1="75" x2="100" y2="75"/>
    </g>
    <g stroke="#00e5ff" stroke-width="2.5" fill="none" opacity="0.9" filter="url(#hglow)">
      <polyline points="8,20 8,8 20,8"/><polyline points="80,8 92,8 92,20"/>
      <polyline points="8,80 8,92 20,92"/><polyline points="80,92 92,92 92,80"/>
    </g>
    <polygon points="50,18 68,28 68,52 50,62 32,52 32,28" fill="none" stroke="#00e5ff" stroke-width="1.5" opacity="0.5"/>
    <polygon points="42,34 42,56 63,45" fill="url(#hbtn)" filter="url(#hglow)"/>
    <text x="50" y="80" text-anchor="middle" font-family="Courier New,monospace" font-size="7" fill="#00e5ff" letter-spacing="2" opacity="0.85">MULTIHD</text>
    <text x="50" y="89" text-anchor="middle" font-family="Courier New,monospace" font-size="5" fill="#446688" letter-spacing="1.5">LAUNCHER</text>
  </svg>
  <div>
    <h1>${title}</h1>
    <p>MultiHD Launcher v2.0.0 — Questa FSE · Quartus Prime · Gowin EDA</p>
  </div>
</div>

<div class="tabs">
  <button class="tab active" onclick="showTab('readme',this)">📖 README</button>
  <button class="tab" onclick="showTab('deps',this)">📦 Dependencies</button>
  <button class="tab" onclick="showTab('commands',this)">⌨ Commands</button>
</div>

<div class="content">

  <!-- README -->
  <div id="readme" class="page active">${body}</div>

  <!-- DEPS -->
  <div id="deps" class="page">
    <h2>📦 Dependency Resolver</h2>
    <p style="margin-bottom:14px">Each section shows its commands grouped by OS.
      Click <strong>▶ Run</strong> to send a single command to the terminal, or
      <strong>▶ Run All</strong> to step through the entire section — each command requires your approval before it executes.</p>

    <!-- Approval overlay (sticky, shown during Run All) -->
    <div id="approvalOverlay"></div>

    <!-- Status bar -->
    <div id="depLog">Ready — click ▶ Run on any block, or ▶ Run All on a section.</div>

    <!-- Command blocks injected here -->
    <div id="cmdBlocks"></div>
  </div>

  <!-- COMMANDS ref (rendered markdown) -->
  <div id="commands" class="page">
    <h2>⌨ Commands Reference</h2>
    <div id="cmdRef"><p style="color:var(--muted)">Loading…</p></div>
  </div>

</div>

<script>
const vscode = acquireVsCodeApi();
const blocks = ${blocksJson};

// ── tab switching ──────────────────────────────────────────────────────────
function showTab(id, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (btn) btn.classList.add('active');
  if (id === 'deps')     buildDepBlocks();
  if (id === 'commands') buildCmdRef();
}

// ── helpers ────────────────────────────────────────────────────────────────
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function osTag(label) {
  if (/windows/i.test(label)) return '<span class="os-badge os-windows">Windows</span>';
  if (/linux/i.test(label))   return '<span class="os-badge os-linux">Linux</span>';
  return '';
}

function secBadge(sec) {
  if (/^Build/i.test(sec))   return '<span class="sec-badge sec-build">🔨 Build</span>';
  if (/^Install/i.test(sec)) return '<span class="sec-badge sec-install">📦 Install</span>';
  if (/^CLI/i.test(sec))     return '<span class="sec-badge sec-cli">⌨ CLI</span>';
  if (/^GUI/i.test(sec))     return '<span class="sec-badge sec-gui">🖥 GUI</span>';
  return '';
}

function sectionIcon(sec) {
  if (/^Build/i.test(sec))   return '🔨';
  if (/^Install/i.test(sec)) return '📦';
  if (/^CLI/i.test(sec))     return '⌨';
  if (/^GUI/i.test(sec))     return '🖥';
  return '📋';
}

// ── build dep blocks (grouped by section) ─────────────────────────────────
function buildDepBlocks() {
  const el = document.getElementById('cmdBlocks');
  if (el.dataset.built) return;
  el.dataset.built = '1';
  if (!blocks.length) { el.innerHTML = '<p style="color:var(--muted)">No command blocks found in COMMANDS.md.</p>'; return; }

  // Group blocks by section, preserving order
  const secOrder = [];
  const secMap = {};
  blocks.forEach((b, i) => {
    if (!secMap[b.section]) { secMap[b.section] = []; secOrder.push(b.section); }
    secMap[b.section].push({ ...b, idx: i });
  });

  let html = '';
  for (const sec of secOrder) {
    const grp = secMap[sec];
    const icon = sectionIcon(sec);
    html += \`
      <div class="section-group">
        <div class="section-header">
          <span class="section-title">\${icon} \${esc(sec)} <span class="section-count">\${grp.length} command\${grp.length>1?'s':''}</span></span>
          <button class="btn btn-run-all" onclick="startRunAll('\${esc(sec)}')">▶ Run All</button>
        </div>
        \${grp.map(b => \`
          <div class="cmd-block">
            <div class="cmd-header">
              <span class="cmd-label">\${osTag(b.label)} \${esc(b.label)}</span>
              <div class="btn-group">
                <button class="btn btn-copy" onclick="copyCmd(\${b.idx})">📋 Copy</button>
                <button class="btn btn-run"  onclick="runCmdSingle(\${b.idx})">▶ Run</button>
              </div>
            </div>
            \${b.desc ? \`<div class="cmd-desc">\${esc(b.desc)}</div>\` : ''}
            <div class="cmd-body"><pre><code>\${esc(b.cmd)}</code></pre></div>
          </div>
        \`).join('')}
      </div>
    \`;
  }
  el.innerHTML = html;
}

// ── single run ─────────────────────────────────────────────────────────────
function runCmdSingle(i) {
  const log = document.getElementById('depLog');
  log.style.color = '#7fbfff';
  log.textContent = '▶ Sending to terminal: ' + blocks[i].label + '…';
  vscode.postMessage({ type: 'runCmd', cmd: blocks[i].cmd, label: blocks[i].label });
}

function copyCmd(i) {
  vscode.postMessage({ type: 'copy', text: blocks[i].cmd });
}

// ── Run All — step-through with approval ───────────────────────────────────
let runQueue = [], runIdx = 0;

function startRunAll(section) {
  runQueue = blocks.filter(b => b.section === section);
  runIdx   = 0;
  showApprovalStep();
}

function showApprovalStep() {
  const ov  = document.getElementById('approvalOverlay');
  const log = document.getElementById('depLog');

  if (runIdx >= runQueue.length) {
    ov.style.display = 'block';
    ov.innerHTML = \`<div class="apv-done">✅ All \${runQueue.length} commands in "\${esc(runQueue[0]?.section||'')}" sent to terminal.</div>
      <button class="btn btn-copy" style="margin-top:8px" onclick="closeApproval()">Close</button>\`;
    log.style.color = 'var(--green)';
    log.textContent = '✓ Run All complete — ' + runQueue.length + ' commands sent.';
    return;
  }

  const b = runQueue[runIdx];
  ov.style.display = 'block';
  ov.innerHTML = \`
    <div class="apv-progress">STEP \${runIdx+1} OF \${runQueue.length} &nbsp;·&nbsp; \${esc(b.section)}</div>
    <div class="apv-label">\${osTag(b.label)} \${esc(b.label)}</div>
    \${b.desc ? \`<div class="apv-desc">\${esc(b.desc)}</div>\` : ''}
    <div class="apv-cmd"><code>\${esc(b.cmd)}</code></div>
    <div class="apv-btns">
      <button class="btn btn-approve btn-run" onclick="approveStep()">✓ Approve &amp; Run</button>
      <button class="btn btn-skip   btn-copy" onclick="skipStep()">⏭ Skip</button>
      <button class="btn btn-cancel"          onclick="cancelRunAll()">✗ Cancel</button>
    </div>
  \`;

  // Scroll the overlay into view
  ov.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function approveStep() {
  const b   = runQueue[runIdx];
  const log = document.getElementById('depLog');
  log.style.color = '#7fbfff';
  log.textContent = \`▶ [\${runIdx+1}/\${runQueue.length}] \${b.label}\`;
  vscode.postMessage({ type: 'runCmd', cmd: b.cmd, label: b.label });
  runIdx++;
  setTimeout(showApprovalStep, 400);
}

function skipStep() { runIdx++; showApprovalStep(); }

function cancelRunAll() {
  const log = document.getElementById('depLog');
  log.style.color = 'var(--red)';
  log.textContent = \`✗ Run All cancelled at step \${runIdx+1} of \${runQueue.length}.\`;
  closeApproval();
}

function closeApproval() {
  const ov = document.getElementById('approvalOverlay');
  ov.style.display = 'none';
  ov.innerHTML = '';
}

// ── commands reference page (rendered markdown) ───────────────────────────
function buildCmdRef() {
  vscode.postMessage({ type: 'getCommands' });
}

// ── messages from extension ───────────────────────────────────────────────
window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'cmdResult') {
    const log = document.getElementById('depLog');
    log.textContent  = msg.text;
    log.style.color  = msg.ok ? 'var(--green)' : 'var(--red)';
  }
  if (msg.type === 'cmdRef') {
    document.getElementById('cmdRef').innerHTML = msg.html;
  }
  if (msg.type === 'copied') {
    const log = document.getElementById('depLog');
    log.textContent = '📋 Copied to clipboard.';
    log.style.color = 'var(--cyan)';
  }
});

// Build dep blocks immediately if deps page is active on load
if (document.getElementById('deps').classList.contains('active')) buildDepBlocks();
</script>
</body>
</html>`;

  return panel;
}

async function showHelpDocs(context: vscode.ExtensionContext): Promise<void> {
  const helpContentPath = path.join(context.extensionPath, 'HELP-CONTENT.md');
  const readmePath = path.join(context.extensionPath, 'README.md');
  const mdPath = fs.existsSync(helpContentPath) ? helpContentPath : readmePath;
  const md = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : '# README not found';
  const panel = buildHelpPanel(context, '❓ MultiHD Launcher Help', md, false);
  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg.type === 'copy') {
      await vscode.env.clipboard.writeText(msg.text);
      void vscode.window.showInformationMessage('Copied to clipboard.');
    }
  });
}

async function showHelpDeps(context: vscode.ExtensionContext): Promise<void> {
  const mdPath = path.join(context.extensionPath, 'DEPENDENCY.md');
  const md = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : '# DEPENDENCY.md not found';
  const panel = buildHelpPanel(context, '📦 Dependency Resolver', md, true);

  const terminal = vscode.window.createTerminal('MultiHD Dependency Installer');

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg.type === 'copy') {
      await vscode.env.clipboard.writeText(msg.text);
      void vscode.window.showInformationMessage('📋 Copied to clipboard.');
      void panel.webview.postMessage({ type: 'copied' });
    }
    if (msg.type === 'runCmd') {
      terminal.show(true);
      const lines: string[] = msg.cmd
        .split('\n')
        .filter((line: string) => line.trim() && !line.trim().startsWith('#'));
      for (const line of lines) terminal.sendText(line);
      void panel.webview.postMessage({
        type: 'cmdResult',
        text: `✓ Sent to terminal: "${msg.label}"`,
        ok: true,
      });
    }
    if (msg.type === 'getCommands') {
      const cmdPath = path.join(context.extensionPath, 'COMMANDS.md');
      const cmdMd = fs.existsSync(cmdPath) ? fs.readFileSync(cmdPath, 'utf8') : '';
      void panel.webview.postMessage({ type: 'cmdRef', html: mdToHtml(cmdMd) });
    }
  });
}

// ─── activation / deactivation ──────────────────────────────────────────────

function createLibraryManager(context: vscode.ExtensionContext): LibraryManager | undefined {
  try {
    return LibraryManager.createDefault();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(
      `⚠ Could not open ~/.questa_libs (${message}) — using extension storage instead.`
    );
    try {
      const fallbackRoot = path.join(context.globalStorageUri.fsPath, 'questa_libs');
      fs.mkdirSync(fallbackRoot, { recursive: true });
      return new LibraryManager(
        path.join(fallbackRoot, 'registry.json'),
        path.join(fallbackRoot, 'work')
      );
    } catch {
      return undefined;
    }
  }
}

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;

  outputChannel = vscode.window.createOutputChannel('MultiHD Launcher');
  context.subscriptions.push(outputChannel);

  projectState = new ProjectStateStore(context.workspaceState);
  libraryManager = createLibraryManager(context);
  currentProjectDir = resolveProjectDirSync() ?? '';

  registerCommands();
  createStatusBar();

  const version =
    (context.extension.packageJSON as { version?: string } | undefined)?.version ?? '2.0.0';
  log(`⬡ MultiHD Launcher v${version} — Questa FSE • Quartus Prime • Gowin EDA`, 'cyan');
  log('  Ready — open 🚀 MultiHD Launcher from the editor title bar.', 'dim');
}

export function deactivate(): void {
  if (launcherPanel) {
    try {
      launcherPanel.dispose();
    } catch {
      // already disposed
    }
    launcherPanel = undefined;
  }
}


