// ─────────────────────────────────────────────────────────────────────────────
// MultiHD Launcher — shared extension types (see multihd-port/CONTRACT.md §7.1)
// Seeded by Lead from the frozen contract; writer-core may extend (not break).
// ─────────────────────────────────────────────────────────────────────────────

export type TargetTool = 'questa' | 'quartus' | 'gowin';

export interface SvConf {
  compileMode: 'all' | 'list' | number;
  priorityList: string[];
  tbName: string;
  tbPriorityList: string[];
  topModule: string;
  vsimArgs: string;
  vlogArgs: string;
  workLib: string;
}

export interface ProjectInfo {
  dir: string;
  projectName: string;
  allSvFiles: string[];
  excludedFiles: string[];
  customOrder: string[];
  activeFiles: string[];
  topFile: string;
  topModule: string;
  tbModule: string;
  conf: SvConf;
  deps: string[];
}

export interface ConfigValues {
  vsimPath: string;
  questaBin: string;
  licenseFile: string;
  saltLicenseServer: string;
  licenseServer: string;
  alteraLicenseFile: string;
  mtiVcoMode: string;
  defaultFolder: string;
  quartusPath: string;
  gowinPath: string;
  extraVlogArgs: string;
  autoOpenGui: boolean;
}

export type LogKind = 'plain' | 'cyan' | 'green' | 'red' | 'orange' | 'dim' | 'purple';

export interface LaunchContext {
  projectDir: string;
  targets: TargetTool[];
  log(line: string, kind?: LogKind): void;
  /** notify launcher panel of new excluded/order/license state if open */
  refresh?(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// writer-core additions (additive only — frozen shapes above must not change)
// ─────────────────────────────────────────────────────────────────────────────

/** Questa invocation modes understood by the core launcher. */
export type QuestaMode = 'cli' | 'gui' | 'waveform';

/** Result of resolving an external binary (vsim / quartus / gw_ide). */
export interface ResolvedBinary {
  /** Resolved (or best-guess) executable path. */
  path: string;
  /** True when the path is a real executable we can spawn. */
  found: boolean;
  /** Where the value came from. */
  source: 'setting' | 'path' | 'default';
}

/** License guard state shared by the launcher panel and launch flows. */
export interface LicenseStatus {
  ok: boolean;
  path: string;
  message: string;
}
