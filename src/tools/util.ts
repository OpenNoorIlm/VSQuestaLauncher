// ─────────────────────────────────────────────────────────────────────────────
// MultiHD Launcher — shared helpers for the pure generator modules.
//
// IMPORTANT: `src/tools/**` must never import `vscode`. The verifier loads the
// compiled `out/tools/*.js` in a plain Node process for golden-file tests, so
// the only allowed dependencies are Node builtins (fs, path, os, child_process).
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';

/**
 * Current local time formatted exactly like `QDateTime::currentDateTime()
 * .toString(Qt::ISODate)` ⇒ `YYYY-MM-DDTHH:MM:SS`.
 *
 * Parity notes:
 *  - local time, NOT UTC (never use Date#toISOString — it emits `Z`/ms);
 *  - no milliseconds, no timezone suffix (Qt ISODate on a local QDateTime).
 */
export function isoNow(): string {
  const d = new Date();
  const pad = (n: number): string => (n < 10 ? '0' + n : String(n));
  return (
    String(d.getFullYear()) +
    '-' + pad(d.getMonth() + 1) +
    '-' + pad(d.getDate()) +
    'T' + pad(d.getHours()) +
    ':' + pad(d.getMinutes()) +
    ':' + pad(d.getSeconds())
  );
}

/** Create `dir` (and parents) if it does not exist yet. */
export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/** True when the path exists (file or directory). */
export function pathExists(p: string): boolean {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

/** True when the path exists and is a directory. */
export function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Write UTF-8 text with LF newlines (Qt `QIODevice::Text` on Linux). */
export function writeTextFile(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, 'utf8');
}

/** Read a UTF-8 text file, or `undefined` when it does not exist / is unreadable. */
export function readTextFile(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * Non-recursive file listing with a suffix filter, mirroring Qt
 * `QDir(dir).entryList({"*.sv"}, QDir::Files)`:
 *  - files only (directories are skipped),
 *  - hidden entries (leading dot) skipped — Qt does not pass `QDir::Hidden`,
 *  - `suffix` matching is case-sensitive on Linux,
 *  - filesystem enumeration order (no sort), exactly like `QDir::NoSort`.
 */
export function listFilesWithSuffix(dir: string, suffix: string): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of entries) {
    if (!name.endsWith(suffix)) continue;
    if (name.startsWith('.')) continue;
    try {
      if (fs.statSync(path.join(dir, name)).isFile()) out.push(name);
    } catch {
      // dangling symlink / race — QDir would skip it as well
    }
  }
  return out;
}

// ── Qt-compatible indented JSON ──────────────────────────────────────────────
// Qt writes JSON with `QJsonDocument::toJson(QJsonDocument::Indented)`, which is
// *almost* `JSON.stringify(value, null, 4)` but differs for empty containers and
// always ends with a trailing newline after the document is written:
//   {}          -> "{\n}\n"                       (not "{}\n")
//   {"a": []}   -> "{\n    \"a\": [\n    ]\n}\n"  (not "[]")
// Object keys are emitted in lexicographic order (QJsonObject is a sorted map).
// The generator modules only ever serialise plain JSON values (objects, arrays,
// strings, numbers, booleans), so this small writer is sufficient.

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Serialise a JSON value exactly like Qt's `QJsonDocument::Indented`, plus final newline. */
export function qtJsonIndented(value: JsonValue): string {
  return qtIndentedInner(value, 0) + '\n';
}

function qtIndentedInner(value: JsonValue, depth: number): string {
  const indent = '    '.repeat(depth);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[\n' + indent + ']';
    const items = value.map(
      (item) => '    '.repeat(depth + 1) + qtIndentedInner(item, depth + 1),
    );
    return '[\n' + items.join(',\n') + '\n' + indent + ']';
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    if (keys.length === 0) return '{\n' + indent + '}';
    const items = keys.map(
      (key) =>
        '    '.repeat(depth + 1) +
        JSON.stringify(key) +
        ': ' +
        qtIndentedInner((value as Record<string, JsonValue>)[key], depth + 1),
    );
    return '{\n' + items.join(',\n') + '\n' + indent + '}';
  }
  return JSON.stringify(value);
}

/**
 * `QString::chopped(n)` for the common `n <= length` case: removes exactly `n`
 * trailing characters (Qt's Quartus generator uses `f.chopped(3)` to drop `.sv`).
 */
export function chopped(fileName: string, n: number): string {
  if (n <= 0) return fileName;
  if (fileName.length <= n) return '';
  return fileName.slice(0, fileName.length - n);
}

/**
 * `QFileInfo(path).baseName()` — Qt splits at the FIRST dot
 * (`foo.bar.sv` -> `foo`; note: NOT `completeBaseName()` which would be
 * `foo.bar`). A leading dot yields an empty base name, matching Qt
 * (`".sv"` -> `""`).
 */
export function baseNameWithoutSuffix(filePath: string): string {
  const base = path.basename(filePath);
  const dot = base.indexOf('.');
  return dot === -1 ? base : base.slice(0, dot);
}
