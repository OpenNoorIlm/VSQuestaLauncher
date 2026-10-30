// ─────────────────────────────────────────────────────────────────────────────
// MultiHD Launcher — frozen UI host contract (see multihd-port/CONTRACT.md §7.3)
// Owner: writer-ui. Do not change exported shapes without Lead approval.
// This file is TYPES ONLY. Each panel module (launcherPanel.ts, configPanel.ts,
// excludePanel.ts, priorityPanel.ts, cstPanel.ts, libraryPanel.ts) implements and
// exports its own `show*` function using these host interfaces; src/extension.ts
// imports from the individual panel modules.
// ─────────────────────────────────────────────────────────────────────────────
import { TargetTool, ConfigValues } from '../models';

// ── Launcher panel ───────────────────────────────────────────────────────────
export interface LauncherState {
  projectDir: string;
  hasProject: boolean;
  svFileCount: number;
  targets: Record<TargetTool, boolean>;
  licenseOk: boolean;
  licensePath: string;
  licenseMessage: string;
  excludedFiles: string[];
  customOrder: string[];
  vsimPath: string;
  busy: boolean;
}

export type LauncherAction =
  | { type: 'browse' }
  | { type: 'setFolder'; dir: string }
  | { type: 'refresh' }
  | { type: 'toggleTarget'; tool: TargetTool; checked: boolean }
  | { type: 'openConfig' }
  | { type: 'openPriority' }
  | { type: 'openExclude' }
  | { type: 'openLibrary' }
  | { type: 'openGowinCst' }
  | { type: 'installQuesta' }
  | { type: 'licenseRequest' }
  | { type: 'restoreFile'; file: string }
  | { type: 'launch' };

export interface LauncherHost {
  getState(): LauncherState;
  dispatch(action: LauncherAction): Promise<void>;
}

export interface LauncherPanelHandle {
  reveal(): void;
  refresh(): void;
  appendLog(line: string): void;
  dispose(): void;
}

// ── Configuration panel ──────────────────────────────────────────────────────
export interface ConfigHost {
  load(): ConfigValues;
  save(values: ConfigValues): Promise<void>;
  isLicenseOk(values: ConfigValues): boolean;
  browse(
    kind: 'vsim' | 'license' | 'folder' | 'quartus' | 'gowin',
    current: string
  ): Promise<string | undefined>;
}

// ── Per-file exclusion panel ─────────────────────────────────────────────────
export interface ExcludeHost {
  getState(): { dir: string; files: string[]; excluded: string[] };
  apply(excluded: string[]): Promise<void>;
}

// ── Compile order panel ──────────────────────────────────────────────────────
export interface PriorityHost {
  getState(): { dir: string; files: string[]; customOrder: string[] };
  apply(order: string[]): Promise<void>;
}

// ── Gowin CST editor panel ───────────────────────────────────────────────────
export interface CstHost {
  getState(): { dir: string; topFile: string; svText: string; device: string; pn: string; cst: string };
  save(payload: { cst: string; device: string; pn: string }): Promise<void>;
}

// ── Library manager panel ────────────────────────────────────────────────────
export interface LibraryHost {
  getState(): {
    projectDir: string;
    vsimPath: string;
    libraries: Array<{ name: string; sourcePath: string; compiled: boolean; compiledAt: string }>;
    projectDeps: string[];
  };
  addLibrary(name: string, sourcePath: string): Promise<{ ok: boolean; error?: string }>;
  removeLibrary(name: string): Promise<{ ok: boolean; error?: string }>;
  compileLibrary(name: string): Promise<{ ok: boolean; error?: string }>;
  setProjectDeps(deps: string[]): Promise<void>;
  browseFolder(current: string): Promise<string | undefined>;
}
