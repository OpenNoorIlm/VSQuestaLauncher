// ─────────────────────────────────────────────────────────────────────────────
// MultiHD Launcher — effective configuration
// (see multihd-port/CONTRACT.md §5 settings, §8 F2/F3)
//
// Reads `multihdLauncher.*` with a fallback to the v1.9.1 `questaLauncher.*`
// namespace, auto-detects the legacy Questa license file, and resolves the
// vsim / quartus / gw_ide binaries (setting → PATH → known default).
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { ConfigValues, LicenseStatus, ResolvedBinary } from '../models';
import { which } from './process';

/** New (v2.0.0) settings namespace. */
export const CONFIG_SECTION = 'multihdLauncher';
/** v1.9.1 settings namespace, read as a fallback. */
export const LEGACY_CONFIG_SECTION = 'questaLauncher';

/** Defaults mirror package.json (contract §5). */
export const CONFIG_DEFAULTS: ConfigValues = {
  vsimPath: '',
  questaBin: '',
  licenseFile: '',
  saltLicenseServer: '',
  licenseServer: '',
  alteraLicenseFile: '',
  mtiVcoMode: '64',
  defaultFolder: '',
  quartusPath: '',
  gowinPath: '',
  extraVlogArgs: '-reportprogress 300',
  autoOpenGui: false,
};

/** v1.9.1 known Quadra/Questa install used as a last-resort vsim fallback. */
export const KNOWN_VSIM_PATH =
  '/home/bismillah/altera/25.1std/questa_fse/linux_x86_64/vsim';

const CONFIG_KEYS: Array<keyof ConfigValues> = [
  'vsimPath',
  'questaBin',
  'licenseFile',
  'saltLicenseServer',
  'licenseServer',
  'alteraLicenseFile',
  'mtiVcoMode',
  'defaultFolder',
  'quartusPath',
  'gowinPath',
  'extraVlogArgs',
  'autoOpenGui',
];

// ─── settings reads ─────────────────────────────────────────────────────────

function hasExplicitValue<T>(
  inspection: { globalValue?: T; workspaceValue?: T; workspaceFolderValue?: T } | undefined
): boolean {
  if (!inspection) return false;
  return (
    inspection.globalValue !== undefined ||
    inspection.workspaceValue !== undefined ||
    inspection.workspaceFolderValue !== undefined
  );
}

/**
 * Read one effective setting:
 *   1. `multihdLauncher.<key>` when explicitly configured,
 *   2. legacy `questaLauncher.<key>` when explicitly configured (v1.9.1 users),
 *   3. the manifest default.
 */
export function readSetting<K extends keyof ConfigValues>(key: K): ConfigValues[K] {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const inspection = config.inspect<ConfigValues[K]>(key);
  if (hasExplicitValue(inspection)) {
    const value = config.get<ConfigValues[K]>(key);
    if (value !== undefined) return value;
  }

  const legacy = vscode.workspace.getConfiguration(LEGACY_CONFIG_SECTION);
  const legacyInspection = legacy.inspect<ConfigValues[K]>(key);
  if (hasExplicitValue(legacyInspection)) {
    const value = legacy.get<ConfigValues[K]>(key);
    if (value !== undefined) return value;
  }

  const current = config.get<ConfigValues[K]>(key);
  return current !== undefined ? current : CONFIG_DEFAULTS[key];
}

/** Auto-detected legacy license path (~/.licenses/questa_license.dat). */
export function autoDetectedLicensePath(): string | undefined {
  try {
    const candidate = path.join(os.homedir(), '.licenses', 'questa_license.dat');
    return fs.existsSync(candidate) ? candidate : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Effective configuration values. The license file falls back to the
 * auto-detected v1.9.1 location when the setting is empty (contract §5).
 */
export function getConfigValues(): ConfigValues {
  const values: ConfigValues = {
    vsimPath: readSetting('vsimPath'),
    questaBin: readSetting('questaBin'),
    licenseFile: readSetting('licenseFile'),
    saltLicenseServer: readSetting('saltLicenseServer'),
    licenseServer: readSetting('licenseServer'),
    alteraLicenseFile: readSetting('alteraLicenseFile'),
    mtiVcoMode: readSetting('mtiVcoMode'),
    defaultFolder: readSetting('defaultFolder'),
    quartusPath: readSetting('quartusPath'),
    gowinPath: readSetting('gowinPath'),
    extraVlogArgs: readSetting('extraVlogArgs'),
    autoOpenGui: readSetting('autoOpenGui'),
  };

  values.vsimPath = values.vsimPath.trim();
  values.questaBin = values.questaBin.trim();
  values.licenseFile = values.licenseFile.trim();
  values.saltLicenseServer = values.saltLicenseServer.trim();
  values.licenseServer = values.licenseServer.trim();
  values.alteraLicenseFile = values.alteraLicenseFile.trim();
  values.mtiVcoMode = values.mtiVcoMode.trim();
  values.defaultFolder = values.defaultFolder.trim();
  values.quartusPath = values.quartusPath.trim();
  values.gowinPath = values.gowinPath.trim();
  values.extraVlogArgs = values.extraVlogArgs.trim();

  if (!values.licenseFile) {
    const auto = autoDetectedLicensePath();
    if (auto) values.licenseFile = auto;
  }
  return values;
}

// ─── settings writes ────────────────────────────────────────────────────────

function normalized<K extends keyof ConfigValues>(value: ConfigValues[K]): ConfigValues[K] {
  if (typeof value === 'string') return value.trim() as ConfigValues[K];
  return value;
}

/** Persist every field to user settings (Config webview Save). */
export async function saveConfigValues(values: ConfigValues): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  for (const key of CONFIG_KEYS) {
    await config.update(key, normalized(values[key]), vscode.ConfigurationTarget.Global);
  }
}

/** Persist a single field to user settings. */
export async function updateSetting<K extends keyof ConfigValues>(
  key: K,
  value: ConfigValues[K]
): Promise<void> {
  await vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .update(key, normalized(value), vscode.ConfigurationTarget.Global);
}

// ─── license status / guard ─────────────────────────────────────────────────

/** Qt `ConfigDialog::licenseOk()`: non-empty path that exists on disk. */
export function isLicenseFileOk(licenseFile: string): boolean {
  const trimmed = licenseFile.trim();
  if (!trimmed) return false;
  try {
    return fs.statSync(trimmed).isFile();
  } catch {
    return false;
  }
}

/**
 * License badge state (Qt `MainWindow::updateLicenseStatus`).
 * The badge text is identical for "not configured" and "not found", exactly
 * like the Qt app.
 */
export function getLicenseStatus(values: ConfigValues = getConfigValues()): LicenseStatus {
  const licensePath = values.licenseFile.trim();
  if (!isLicenseFileOk(licensePath)) {
    return {
      ok: false,
      path: licensePath,
      message: '⚠ LICENSE NOT SET — configure before launching Questa!',
    };
  }
  return { ok: true, path: licensePath, message: '✓ LICENSE OK' };
}

// ─── binary resolution ──────────────────────────────────────────────────────

/**
 * vsim resolution (contract §5):
 *   `multihdLauncher.vsimPath` → legacy `questaBin`/vsim → PATH (`which`) →
 *   known default install path.
 */
export function resolveVsim(values: ConfigValues = getConfigValues()): ResolvedBinary {
  const explicit = values.vsimPath.trim();
  if (explicit) {
    return { path: explicit, found: isExecutableCandidate(explicit), source: 'setting' };
  }

  const legacyBin = values.questaBin.trim();
  if (legacyBin) {
    const candidate = path.join(legacyBin, 'vsim');
    return { path: candidate, found: isExecutableCandidate(candidate), source: 'setting' };
  }

  const onPath = which('vsim');
  if (onPath) return { path: onPath, found: true, source: 'path' };

  if (isExecutableCandidate(KNOWN_VSIM_PATH)) {
    return { path: KNOWN_VSIM_PATH, found: true, source: 'default' };
  }
  return { path: 'vsim', found: false, source: 'default' };
}

/** Qt parity: setting path if it exists → `which quartus` → not found. */
export function resolveQuartus(values: ConfigValues = getConfigValues()): ResolvedBinary {
  const explicit = values.quartusPath.trim();
  if (explicit && isExecutableCandidate(explicit)) {
    return { path: explicit, found: true, source: 'setting' };
  }
  const onPath = which('quartus');
  if (onPath) return { path: onPath, found: true, source: 'path' };
  return { path: explicit || 'quartus', found: false, source: explicit ? 'setting' : 'default' };
}

/** Qt parity: setting path if it exists → `which gw_ide` → not found. */
export function resolveGowin(values: ConfigValues = getConfigValues()): ResolvedBinary {
  const explicit = values.gowinPath.trim();
  if (explicit && isExecutableCandidate(explicit)) {
    return { path: explicit, found: true, source: 'setting' };
  }
  const onPath = which('gw_ide');
  if (onPath) return { path: onPath, found: true, source: 'path' };
  return { path: explicit || 'gw_ide', found: false, source: explicit ? 'setting' : 'default' };
}

/** Existing file (executable bit is not strictly required for EDA wrappers). */
function isExecutableCandidate(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}
