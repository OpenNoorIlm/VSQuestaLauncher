// ─────────────────────────────────────────────────────────────────────────────
// MultiHD Launcher — process / binary-resolution helpers
// (see multihd-port/CONTRACT.md §6 core/process.ts, §8 F6)
//
// Rules:
//  - Never build a shell command string from a path or user input.
//  - Always spawn with an argv array (child_process.spawn binary + args[]).
//  - `which()` is implemented in pure Node (no `which`/`where` subprocess) so it
//    works identically on Linux/macOS/Windows and never touches a shell.
// ─────────────────────────────────────────────────────────────────────────────

import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { ConfigValues } from '../models';

// ─── which ──────────────────────────────────────────────────────────────────

/**
 * Resolve a command name through PATH (the semantic equivalent of
 * `which cmd` / `where cmd`, without spawning a shell).
 */
export function which(command: string): string | undefined {
  if (!command) return undefined;
  // Absolute / relative paths are used as-is.
  if (command.includes('/') || command.includes('\\')) {
    return isExecutableFile(command) ? path.resolve(command) : undefined;
  }

  const isWindows = process.platform === 'win32';
  const extensions = isWindows
    ? (process.env['PATHEXT'] || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];

  const rawPath = process.env.PATH ?? process.env['Path'] ?? '';
  for (const dir of rawPath.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of extensions) {
      const candidate = path.join(dir, isWindows ? `${command}${ext}` : command);
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return undefined;
}

function isExecutableFile(candidate: string): boolean {
  try {
    const stat = fs.statSync(candidate);
    if (!stat.isFile()) return false;
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// ─── environment ────────────────────────────────────────────────────────────

/** Copy of the current process environment with DISPLAY defaulted on Linux. */
export function baseEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // Preserved v1.9.1 behaviour: Questa GUI on Linux needs DISPLAY; default :0.
  if (process.platform === 'linux' && !env['DISPLAY']) env['DISPLAY'] = ':0';
  return env;
}

/** Prepend a directory to PATH using the platform path separator. */
export function prependPath(env: NodeJS.ProcessEnv, dir: string | undefined): NodeJS.ProcessEnv {
  if (!dir) return env;
  const current = env.PATH ?? env['Path'] ?? '';
  const next = current ? `${dir}${path.delimiter}${current}` : dir;
  env.PATH = next;
  if (process.platform === 'win32') env['Path'] = next;
  return env;
}

/**
 * Questa launch environment — contract §8 F6 "env union":
 *   Qt vars:      PATH prepend, LM_LICENSE_FILE, SALT_LICENSE_SERVER, MTI_VCO_MODE
 *   v1.9.1 vars:  MGLS_LICENSE_FILE, ALTERAD_LICENSE_FILE, QSIM_VCO_MODE=64, DISPLAY
 */
export function buildQuestaEnvironment(
  values: ConfigValues,
  vsimPath: string
): NodeJS.ProcessEnv {
  const env = baseEnvironment();

  const vsimDir = vsimPath ? path.dirname(vsimPath) : '';
  if (vsimDir && vsimDir !== '.') prependPath(env, vsimDir);

  const licenseFile = values.licenseFile.trim();
  if (licenseFile) {
    env['LM_LICENSE_FILE'] = licenseFile;
  } else {
    // Qt sets LM_LICENSE_FILE unconditionally (even empty).
    env['LM_LICENSE_FILE'] = '';
  }

  const salt = values.saltLicenseServer.trim() || licenseFile;
  if (salt) env['SALT_LICENSE_SERVER'] = salt;

  const mti = values.mtiVcoMode.trim() || '64';
  env['MTI_VCO_MODE'] = mti;
  env['QSIM_VCO_MODE'] = '64';

  if (values.licenseServer.trim()) env['MGLS_LICENSE_FILE'] = values.licenseServer.trim();
  if (values.alteraLicenseFile.trim()) env['ALTERAD_LICENSE_FILE'] = values.alteraLicenseFile.trim();

  return env;
}

// ─── spawning ───────────────────────────────────────────────────────────────

export interface SpawnDetachedOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Defaults to 'ignore' for a fully detached GUI process. */
  stdio?: child_process.StdioOptions;
}

/**
 * Spawn a detached, unref'd GUI process (EDAs open their own windows).
 * The caller may attach stdout/stderr/error listeners when stdio is piped.
 */
export function spawnDetached(
  binary: string,
  args: string[],
  options: SpawnDetachedOptions = {}
): child_process.ChildProcess {
  const child = child_process.spawn(binary, args, {
    cwd: options.cwd,
    env: options.env ?? baseEnvironment(),
    detached: true,
    stdio: options.stdio ?? 'ignore',
    windowsHide: true,
  });
  child.unref();
  return child;
}

export interface SpawnPipedHandlers {
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
}

export interface SpawnOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Spawn a non-detached process and stream stdout/stderr to callbacks
 * (used by the preserved Run CLI flow). Stdio is always piped.
 */
export function spawnStreaming(
  binary: string,
  args: string[],
  options: SpawnOptions,
  handlers: SpawnPipedHandlers = {}
): child_process.ChildProcess {
  const child = child_process.spawn(binary, args, {
    cwd: options.cwd,
    env: options.env ?? baseEnvironment(),
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout?.on('data', (chunk: Buffer) => handlers.onStdout?.(chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => handlers.onStderr?.(chunk.toString()));
  return child;
}
