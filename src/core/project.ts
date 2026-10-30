// ─────────────────────────────────────────────────────────────────────────────
// MultiHD Launcher — project discovery, conf.svconf parsing and compile order
// (see multihd-port/CONTRACT.md §6 project.ts, §7.1, §8 F4/F5)
//
// Qt reference: /home/bismillah/QuestaLauncher/mainwindow.cpp
//   activeFiles()      mainwindow.cpp:224-233
//   generateRunDo()    mainwindow.cpp:624-688   (tb/top detection)
//
// Ordering rules (contract §8 F4/D2/D5):
//   - allSvFiles: deterministic sorted basenames of the project folder
//     (`*.sv`, non-recursive, no hidden files) — Qt QDir order is not
//     reproducible, D2 mandates sorted.
//   - default compile order: non-`_tb.sv` (alpha) then `_tb.sv` (alpha).
//   - conf.svconf `@priority list` / `@tb priority list` / `@tb (name)` refine
//     that order; `@tb (name)` is placed last so the Qt "last _tb.sv" rule
//     picks it as the simulation top.
//   - custom compile order (Compile Order webview) wins for the Questa flow.
//   - Quartus / Gowin ignore the custom order and use sorted-minus-exclusions
//     (`activeFilesForTools()`).
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { ProjectInfo, SvConf } from '../models';
import { LibraryManager } from '../tools/library';
import { getConfigValues } from './config';

// ─── conf.svconf parser (v1.9.1 grammar, preserved) ─────────────────────────

export function defaultConf(): SvConf {
  return {
    compileMode: 'all',
    priorityList: [],
    tbName: '',
    tbPriorityList: [],
    topModule: '',
    vsimArgs: '',
    vlogArgs: '',
    workLib: 'work',
  };
}

export function confPathForProject(projectDir: string): string {
  return path.join(projectDir, 'conf.svconf');
}

/**
 * Parse `conf.svconf` (preserved v1.9.1 grammar/behaviour):
 *
 *   compile @(all) | compile @(list) | compile @(3)
 *   @tb (counter_tb.sv)
 *   @tb priority list:    - counter2_tb.sv
 *   @priority list encoder:  - a.sv
 *   @topmodule: counter
 *   @vsimargs: -voptargs=+acc
 *   @vlogargs: -sv -quiet
 *   @work: work
 */
export function parseConf(confPath: string): SvConf {
  const conf = defaultConf();
  if (!fs.existsSync(confPath)) return conf;

  const lines = fs.readFileSync(confPath, 'utf8').split('\n');
  let inPriority = false;
  let inTbPriority = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) {
      inPriority = false;
      inTbPriority = false;
      continue;
    }

    // compile @(all)  /  compile @(1)  /  compile @(list)
    const compileMatch = line.match(/^compile\s+@\((.+?)\)/i);
    if (compileMatch) {
      const val = compileMatch[1].trim().toLowerCase();
      if (val === 'all') conf.compileMode = 'all';
      else if (val === 'list') conf.compileMode = 'list';
      else conf.compileMode = parseInt(val, 10) || 'all';
      inPriority = false;
      inTbPriority = false;
      continue;
    }

    // @tb (filename.sv) — explicit testbench name
    const tbNameMatch = line.match(/^@tb\s+\(([^)]+)\)/i);
    if (tbNameMatch) {
      conf.tbName = tbNameMatch[1].trim();
      inPriority = false;
      inTbPriority = false;
      continue;
    }

    // @tb priority list
    if (line.match(/^@tb\s+priority\s+list/i)) {
      inTbPriority = true;
      inPriority = false;
      conf.tbPriorityList = [];
      continue;
    }

    // @priority list encoder
    if (line.match(/^@priority\s+list/i)) {
      inPriority = true;
      inTbPriority = false;
      conf.priorityList = [];
      continue;
    }

    // @topmodule: counter16_tb
    const topMatch = line.match(/^@topmodule\s*:\s*(.+)/i);
    if (topMatch) {
      conf.topModule = topMatch[1].trim();
      inPriority = false;
      inTbPriority = false;
      continue;
    }

    // @vsimargs: -voptargs=+acc
    const vsimMatch = line.match(/^@vsimargs\s*:\s*(.+)/i);
    if (vsimMatch) {
      conf.vsimArgs = vsimMatch[1].trim();
      inPriority = false;
      inTbPriority = false;
      continue;
    }

    // @vlogargs: -sv -quiet
    const vlogMatch = line.match(/^@vlogargs\s*:\s*(.+)/i);
    if (vlogMatch) {
      conf.vlogArgs = vlogMatch[1].trim();
      inPriority = false;
      inTbPriority = false;
      continue;
    }

    // @work: work
    const workMatch = line.match(/^@work\s*:\s*(.+)/i);
    if (workMatch) {
      conf.workLib = workMatch[1].trim();
      inPriority = false;
      inTbPriority = false;
      continue;
    }

    // inside @tb priority list block
    if (inTbPriority && (line.startsWith('-') || /^\d+\./.test(line) || line.endsWith('.sv'))) {
      const fname = line.replace(/^[-\d.]\s*/, '').trim();
      if (fname) conf.tbPriorityList.push(fname);
      continue;
    }

    // inside @priority list block — file lines
    if (inPriority && (line.startsWith('-') || /^\d+\./.test(line) || line.endsWith('.sv'))) {
      const fname = line.replace(/^[-\d.]\s*/, '').trim();
      if (fname) conf.priorityList.push(fname);
    }
  }

  return conf;
}

/** Serialise `conf.svconf` (preserved v1.9.1 writer, rebranded header). */
export function saveConf(confPath: string, conf: SvConf): void {
  const modeStr =
    conf.compileMode === 'all' ? 'all' : conf.compileMode === 'list' ? 'list' : String(conf.compileMode);

  let out = `# conf.svconf — MultiHD Launcher configuration\n`;
  out += `# Generated by MultiHD Launcher\n\n`;
  out += `compile @(${modeStr})\n\n`;

  if (conf.tbName) out += `@tb (${conf.tbName})\n\n`;

  if (conf.tbPriorityList.length > 0) {
    out += `@tb priority list:\n`;
    for (const f of conf.tbPriorityList) out += `  - ${f}\n`;
    out += `\n`;
  }

  out += `@priority list encoder:\n`;
  for (const f of conf.priorityList) out += `  - ${f}\n`;
  out += `\n`;

  if (conf.topModule) out += `@topmodule: ${conf.topModule}\n`;
  if (conf.vsimArgs) out += `@vsimargs: ${conf.vsimArgs}\n`;
  if (conf.vlogArgs) out += `@vlogargs: ${conf.vlogArgs}\n`;
  if (conf.workLib && conf.workLib !== 'work') out += `@work: ${conf.workLib}\n`;

  fs.writeFileSync(confPath, out, 'utf8');
}

/** New-project conf.svconf template (preserved v1.9.1 behaviour, rebranded). */
export function defaultConfTemplate(openedBase: string, allBases: string[]): string {
  const tbFiles = allBases.filter((b) => isTbFile(b));
  const nonTbFiles = allBases.filter((b) => !isTbFile(b));
  const detectedTb =
    tbFiles.length === 1 ? tbFiles[0] : tbFiles.find((b) => b === openedBase) || tbFiles[0] || '';

  let out = `# conf.svconf — MultiHD Launcher configuration\n`;
  out += `#\n`;
  out += `# compile @(all)         — compile all .sv files in dir\n`;
  out += `# compile @(list)        — compile only files in priority list\n`;
  out += `# compile @(3)           — compile top 3 from priority list\n\n`;
  out += `compile @(all)\n\n`;

  if (detectedTb) {
    out += `# Explicit testbench file (compiled last, highest priority for vsim)\n`;
    out += `@tb (${detectedTb})\n\n`;
  }

  if (tbFiles.length > 0) {
    out += `# Testbench compile order (compiled after all RTL)\n`;
    out += `@tb priority list:\n`;
    for (const b of tbFiles) out += `  - ${b}\n`;
    out += `\n`;
  }

  out += `# RTL compile order (compiled first)\n`;
  out += `@priority list encoder:\n`;
  const openedNonTb = nonTbFiles.find((b) => b === openedBase);
  if (openedNonTb) out += `  - ${openedNonTb}    # opened file\n`;
  for (const b of nonTbFiles.filter((b) => b !== openedBase)) out += `  - ${b}\n`;
  out += `\n`;

  const topMod = detectedTb ? qtModuleName(detectedTb) : qtModuleName(openedBase);
  out += `@topmodule: ${topMod}\n`;
  out += `# @vsimargs: -voptargs=+acc\n`;
  out += `# @vlogargs: -sv\n`;
  out += `# @work: work\n`;
  return out;
}

// ─── project directory resolution ───────────────────────────────────────────

export function isValidProjectDir(dir: string | undefined): boolean {
  if (!dir || !dir.trim()) return false;
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

export function candidateDirFromUri(uri?: vscode.Uri): string | undefined {
  if (!uri || !uri.fsPath) return undefined;
  try {
    return fs.statSync(uri.fsPath).isDirectory() ? uri.fsPath : path.dirname(uri.fsPath);
  } catch {
    return path.dirname(uri.fsPath);
  }
}

export function activeEditorProjectDir(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;
  const document = editor.document;
  const filePath = document.uri.fsPath;
  const language = document.languageId;
  if (
    /\.sv$/i.test(filePath) ||
    /conf\.svconf$/i.test(filePath) ||
    language === 'systemverilog' ||
    language === 'svconf'
  ) {
    return path.dirname(filePath);
  }
  return undefined;
}

export function defaultFolderSetting(): string {
  const folder = getConfigValues().defaultFolder;
  return folder && isValidProjectDir(folder) ? folder : '';
}

export function workspaceProjectDir(): string | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  return folder && isValidProjectDir(folder) ? folder : undefined;
}

/**
 * Resolve the project directory without prompting:
 * dir of the active .sv/.svconf → workspace folder → defaultFolder setting.
 */
export function resolveProjectDirSync(uri?: vscode.Uri): string | undefined {
  for (const candidate of [
    candidateDirFromUri(uri),
    activeEditorProjectDir(),
    workspaceProjectDir(),
    defaultFolderSetting(),
  ]) {
    if (candidate && isValidProjectDir(candidate)) return candidate;
  }
  return undefined;
}

export interface ResolveProjectDirOptions {
  /** Show a folder picker when nothing resolves (default: true). */
  prompt?: boolean;
}

/**
 * Resolve the project directory:
 * dir of the active .sv/.svconf → workspace folder → defaultFolder setting →
 * folder picker (unless disabled).
 */
export async function resolveProjectDir(
  uri?: vscode.Uri,
  options: ResolveProjectDirOptions = {}
): Promise<string | undefined> {
  const resolved = resolveProjectDirSync(uri);
  if (resolved) return resolved;
  if (options.prompt === false) return undefined;

  const startDir = getConfigValues().defaultFolder;
  const picked = await vscode.window.showOpenDialog({
    title: 'Select Project Folder',
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Select folder',
    defaultUri: startDir ? vscode.Uri.file(startDir) : undefined,
  });
  const folder = picked?.[0]?.fsPath;
  return folder && isValidProjectDir(folder) ? folder : undefined;
}

// ─── .sv scanning / naming ──────────────────────────────────────────────────

/** Qt `*.sv` files, non-recursive, hidden files excluded, deterministic order. */
export function scanSvFiles(projectDir: string): string[] {
  try {
    return fs
      .readdirSync(projectDir)
      .filter((name) => !name.startsWith('.') && name.endsWith('.sv'))
      .filter((name) => {
        try {
          return fs.statSync(path.join(projectDir, name)).isFile();
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    return [];
  }
}

/** Qt testbench naming rule: `*_tb.sv`. */
export function isTbFile(fileName: string): boolean {
  return fileName.endsWith('_tb.sv');
}

/** Qt `QString::remove(".sv")` — removes *every* `.sv` substring. */
export function qtModuleName(fileName: string): string {
  return fileName.split('.sv').join('');
}

// ─── ordering / top-module detection ────────────────────────────────────────

function orderGroup(files: string[], priority: string[], lastName = ''): string[] {
  const result: string[] = [];
  for (const wanted of priority) {
    if (files.includes(wanted) && !result.includes(wanted)) result.push(wanted);
  }
  for (const file of files) {
    if (file !== lastName && !result.includes(file)) result.push(file);
  }
  if (lastName && files.includes(lastName)) result.push(lastName);
  return result;
}

/**
 * Compile order for the Questa flow:
 * custom order wins when set; otherwise non-tb first, then tb, refined by the
 * conf.svconf priority lists and the explicit `@tb (name)`.
 */
export function computeActiveFiles(
  allSvFiles: string[],
  excludedFiles: string[],
  customOrder: string[],
  conf: SvConf
): string[] {
  const active = allSvFiles.filter((file) => !excludedFiles.includes(file));

  if (customOrder.length > 0) {
    const ordered = customOrder.filter((file) => active.includes(file));
    for (const file of active) {
      if (!ordered.includes(file)) ordered.push(file);
    }
    return ordered;
  }

  const nonTb = active.filter((file) => !isTbFile(file));
  const tb = active.filter((file) => isTbFile(file));
  return [...orderGroup(nonTb, conf.priorityList), ...orderGroup(tb, conf.tbPriorityList, conf.tbName)];
}

/**
 * Quartus / Gowin active file list (D5): sorted `.sv` minus exclusions,
 * custom compile order intentionally ignored (Qt parity).
 */
export function activeFilesForTools(allSvFiles: string[], excludedFiles: string[]): string[] {
  return allSvFiles.filter((file) => !excludedFiles.includes(file));
}

/** Qt top-file rule: last active non-`_tb.sv`, else last active file. */
export function computeTopFile(activeFiles: string[]): string {
  let top = '';
  for (const file of activeFiles) {
    if (!isTbFile(file)) top = file;
  }
  if (!top && activeFiles.length > 0) top = activeFiles[activeFiles.length - 1];
  return top;
}

/** Qt testbench-module rule: last active `_tb.sv` stem, else the top module. */
export function computeTbModule(activeFiles: string[], topModule: string): string {
  let tb = '';
  for (const file of activeFiles) {
    if (isTbFile(file)) tb = file;
  }
  return tb ? qtModuleName(tb) : topModule;
}

// ─── ProjectInfo ────────────────────────────────────────────────────────────

/**
 * Build the resolved project description.
 * `excludedFiles` / `customOrder` are the persisted per-project state
 * (basenames); unknown names are pruned here.
 */
export function buildProjectInfo(
  projectDir: string,
  excludedFiles: string[] = [],
  customOrder: string[] = []
): ProjectInfo {
  const allSvFiles = scanSvFiles(projectDir);
  const validExcluded = excludedFiles.filter((file) => allSvFiles.includes(file));
  const validOrder = customOrder.filter((file) => allSvFiles.includes(file));
  const conf = parseConf(confPathForProject(projectDir));
  const activeFiles = computeActiveFiles(allSvFiles, validExcluded, validOrder, conf);
  const topFile = computeTopFile(activeFiles);
  const defaultTopModule = topFile ? qtModuleName(topFile) : '';
  const topModule = conf.topModule || defaultTopModule;
  const tbModule = computeTbModule(activeFiles, topModule);

  let deps: string[] = [];
  try {
    deps = LibraryManager.readProjectDeps(projectDir);
  } catch {
    deps = [];
  }

  return {
    dir: path.resolve(projectDir),
    projectName: path.basename(path.resolve(projectDir)),
    allSvFiles,
    excludedFiles: validExcluded,
    customOrder: validOrder,
    activeFiles,
    topFile,
    topModule,
    tbModule,
    conf,
    deps,
  };
}
