// ─────────────────────────────────────────────────────────────────────────────
// MultiHD Launcher — per-project state persistence
// (see multihd-port/CONTRACT.md §6 state.ts, §8 F4/F5)
//
// Stores the per-file exclusion list and the custom compile order for each
// project directory in `workspaceState`:
//   multihdLauncher.excluded : { "<absolute project dir>": ["a.sv", ...] }
//   multihdLauncher.order    : { "<absolute project dir>": ["b.sv", "a.sv"] }
//
// Clearing semantics:
//   - setting an empty list removes the directory entry entirely (no stale
//     empty arrays in workspaceState);
//   - `prune()` drops basenames that no longer exist in the project folder
//     (deleted/renamed files) and keeps the remaining order;
//   - `clearProject()` removes both entries for one directory.
// ─────────────────────────────────────────────────────────────────────────────

import * as path from 'path';
import * as vscode from 'vscode';

export const EXCLUDED_STATE_KEY = 'multihdLauncher.excluded';
export const ORDER_STATE_KEY = 'multihdLauncher.order';

type DirectoryStateMap = Record<string, string[]>;

/** Stable workspaceState key for a project directory. */
export function normalizeProjectKey(projectDir: string): string {
  const resolved = path.resolve(projectDir);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function readMap(memento: vscode.Memento, key: string): DirectoryStateMap {
  const raw = memento.get<DirectoryStateMap>(key);
  if (!raw || typeof raw !== 'object') return {};
  const copy: DirectoryStateMap = {};
  for (const [dir, files] of Object.entries(raw)) {
    if (Array.isArray(files)) {
      copy[dir] = files.filter((file): file is string => typeof file === 'string');
    }
  }
  return copy;
}

async function writeEntry(
  memento: vscode.Memento,
  key: string,
  projectDir: string,
  files: string[]
): Promise<void> {
  const map = readMap(memento, key);
  const stateKey = normalizeProjectKey(projectDir);
  if (files.length === 0) {
    if (!(stateKey in map)) return;
    delete map[stateKey];
  } else {
    map[stateKey] = files;
  }
  await memento.update(key, map);
}

export class ProjectStateStore {
  constructor(private readonly memento: vscode.Memento) {}

  /** Excluded basenames for a project (empty when never configured). */
  excludedFiles(projectDir: string): string[] {
    const map = readMap(this.memento, EXCLUDED_STATE_KEY);
    return [...(map[normalizeProjectKey(projectDir)] ?? [])];
  }

  /** Custom compile-order basenames for a project (empty = default order). */
  customOrder(projectDir: string): string[] {
    const map = readMap(this.memento, ORDER_STATE_KEY);
    return [...(map[normalizeProjectKey(projectDir)] ?? [])];
  }

  /** Persist the exclusion list; `[]` clears the entry. */
  async setExcludedFiles(projectDir: string, files: string[]): Promise<void> {
    await writeEntry(this.memento, EXCLUDED_STATE_KEY, projectDir, files);
  }

  /** Persist the compile order; `[]` clears the entry. */
  async setCustomOrder(projectDir: string, files: string[]): Promise<void> {
    await writeEntry(this.memento, ORDER_STATE_KEY, projectDir, files);
  }

  async clearExcludedFiles(projectDir: string): Promise<void> {
    await writeEntry(this.memento, EXCLUDED_STATE_KEY, projectDir, []);
  }

  async clearCustomOrder(projectDir: string): Promise<void> {
    await writeEntry(this.memento, ORDER_STATE_KEY, projectDir, []);
  }

  /** Remove both persisted lists for a project directory. */
  async clearProject(projectDir: string): Promise<void> {
    await this.clearExcludedFiles(projectDir);
    await this.clearCustomOrder(projectDir);
  }

  /**
   * Drop basenames that no longer exist in the project folder. Called after a
   * project scan so deleted files never linger in generated TCL.
   */
  async prune(projectDir: string, existingFiles: string[]): Promise<void> {
    const existing = new Set(existingFiles);
    const excluded = this.excludedFiles(projectDir);
    const prunedExcluded = excluded.filter((file) => existing.has(file));
    if (prunedExcluded.length !== excluded.length) {
      await this.setExcludedFiles(projectDir, prunedExcluded);
    }

    const order = this.customOrder(projectDir);
    const prunedOrder = order.filter((file) => existing.has(file));
    if (prunedOrder.length !== order.length) {
      await this.setCustomOrder(projectDir, prunedOrder);
    }
  }
}
