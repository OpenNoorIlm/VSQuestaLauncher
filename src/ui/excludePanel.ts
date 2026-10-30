// ─────────────────────────────────────────────────────────────────────────────
// MultiHD Launcher — Disinclude Files panel (Qt `ExcludeDialog` equivalent)
// Owner: writer-ui. CONTRACT.md §7.3 (ExcludeHost), §8 F5.
//
// Checklist of every `*.sv` in the selected project folder; checked files are
// excluded from compilation and from the compile-order dialog. Quick toolbar:
// `Select all _tb.sv` / `Select all .sv` / `Clear all`. APPLY posts the checked
// basenames (list order) back to the host; Cancel/ESC closes without changes.
// ─────────────────────────────────────────────────────────────────────────────
import * as vscode from 'vscode';
import { ExcludeHost } from './api';
import {
  CyberPanelHandle,
  PanelContent,
  WebviewMessage,
  errorMessage,
  esc,
  jsonForScript,
  openCyberPanel,
  stringList,
  text,
} from './base';

const PANEL_KEY = 'multihdLauncher.excludePanel';
const PANEL_TITLE = 'MultiHD Launcher — Disinclude Files';

let activeHost: ExcludeHost | undefined;

function requireHost(): ExcludeHost {
  if (!activeHost) {
    throw new Error('MultiHD Launcher disinclude host is not available.');
  }
  return activeHost;
}

function buildContent(): PanelContent {
  const host = requireHost();
  const state = host.getState();
  const dir = text(state.dir);
  const files = Array.isArray(state.files) ? state.files.filter((f) => typeof f === 'string') : [];
  const excluded = new Set(
    Array.isArray(state.excluded) ? state.excluded.filter((f) => typeof f === 'string') : []
  );

  const rows = files
    .map((file) => {
      const isExcluded = excluded.has(file);
      return `<label class="file-row${isExcluded ? ' excluded' : ''}" title="${esc(file)}">
  <input type="checkbox" class="file-check" data-file="${esc(file)}"${
        isExcluded ? ' checked' : ''
      }>
  <span class="file-name">${esc(file)}</span>
</label>`;
    })
    .join('\n');

  const emptyMessage = dir
    ? 'No .sv files found in the selected folder.'
    : 'No project folder selected — open a project first.';
  const checklist =
    files.length > 0
      ? `<div class="checklist" id="fileList">${rows}</div>`
      : `<div class="checklist short"><div class="lib-empty">${esc(emptyMessage)}</div></div>`;

  const body = `<div class="title">✕   DISINCLUDE FILES</div>
<div class="hint center">Checked files are excluded from compilation and the compile-order dialog.</div>
<div class="toolbar">
  <button type="button" class="btn btn-mini btn-red" id="selectTbBtn">Select all _tb.sv</button>
  <button type="button" class="btn btn-mini btn-red" id="selectAllBtn">Select all .sv</button>
  <span class="spacer"></span>
  <button type="button" class="btn btn-mini btn-green" id="clearAllBtn">Clear all</button>
</div>
${checklist}
<div class="count-line" id="countLine"></div>
<div class="status" id="excludeStatus"></div>
<div class="btn-row">
  <button type="button" class="btn btn-ghost btn-cancel" id="cancelBtn">Cancel</button>
  <button type="button" class="btn btn-save" id="applyBtn"${
    files.length === 0 ? ' disabled' : ''
  }>✓   APPLY</button>
</div>`;

  const initial = {
    dir,
    files,
    excluded: Array.from(excluded),
  };

  return { body, script: buildScript(initial) };
}

function buildScript(initial: { dir: string; files: string[]; excluded: string[] }): string {
  return `(function () {
  'use strict';
  var initialState = ${jsonForScript(initial)};
  var initialExcluded = {};
  initialState.excluded.forEach(function (file) { initialExcluded[file] = true; });

  function $(id) { return document.getElementById(id); }
  function post(message) { vscode.postMessage(message); }

  function boxes() {
    return Array.prototype.slice.call(document.querySelectorAll('.file-check'));
  }

  function syncRow(box) {
    var row = box.closest('.file-row');
    if (row) { row.classList.toggle('excluded', box.checked); }
  }

  function updateCount() {
    var all = boxes();
    var checked = all.filter(function (box) { return box.checked; });
    var label = $('countLine');
    if (label) {
      label.textContent = checked.length + ' excluded  ·  ' +
        (all.length - checked.length) + ' included  ·  ' + all.length + ' file(s)';
    }
  }

  function setExcludedState(predicate) {
    boxes().forEach(function (box) {
      if (!predicate || predicate(box)) {
        box.checked = true;
        syncRow(box);
      }
    });
    updateCount();
  }

  function setStatus(messageText, isError) {
    var status = $('excludeStatus');
    if (!status) { return; }
    status.textContent = messageText || '';
    status.className = isError ? 'status error' : 'status';
  }

  boxes().forEach(function (box) {
    box.addEventListener('change', function () { syncRow(box); updateCount(); });
  });

  var selectTbBtn = $('selectTbBtn');
  if (selectTbBtn) {
    selectTbBtn.addEventListener('click', function () {
      setExcludedState(function (box) {
        var file = box.getAttribute('data-file') || '';
        return file.slice(-6) === '_tb.sv';
      });
    });
  }

  var selectAllBtn = $('selectAllBtn');
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', function () { setExcludedState(null); });
  }

  var clearAllBtn = $('clearAllBtn');
  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', function () {
      boxes().forEach(function (box) { box.checked = false; syncRow(box); });
      updateCount();
    });
  }

  var cancelBtn = $('cancelBtn');
  if (cancelBtn) { cancelBtn.addEventListener('click', function () { post({ type: '__close' }); }); }

  var applyBtn = $('applyBtn');
  if (applyBtn) {
    applyBtn.addEventListener('click', function () {
      if (applyBtn.disabled) { return; }
      var excluded = boxes()
        .filter(function (box) { return box.checked; })
        .map(function (box) { return box.getAttribute('data-file') || ''; })
        .filter(function (file) { return file !== ''; });
      applyBtn.disabled = true;
      applyBtn.textContent = '⏳   APPLYING…';
      setStatus('', false);
      post({ type: 'apply', excluded: excluded });
      window.setTimeout(function () {
        applyBtn.disabled = false;
        applyBtn.textContent = '✓   APPLY';
      }, 6000);
    });
  }

  window.__onHostMessage = function (message) {
    if (!message || !message.type) { return; }
    if (message.type === 'hostError') {
      setStatus('✗  ' + (message.text || 'Unknown error'), true);
    }
  };

  // Reflect the host-provided exclusions once the DOM is ready.
  boxes().forEach(function (box) {
    var file = box.getAttribute('data-file') || '';
    if (initialExcluded[file]) { box.checked = true; }
    syncRow(box);
  });
  updateCount();
})();`;
}

// ── public factory ──────────────────────────────────────────────────────────

/** Open (or re-render) the per-file exclusion panel. */
export function showExcludePanel(context: vscode.ExtensionContext, host: ExcludeHost): void {
  activeHost = host;
  openCyberPanel(context, {
    key: PANEL_KEY,
    title: PANEL_TITLE,
    reloadOnShow: true,
    build: () => buildContent(),
    onMessage: async (message: WebviewMessage, handle: CyberPanelHandle) => {
      const current = requireHost();
      switch (message.type) {
        case 'apply': {
          const excluded = stringList(message.excluded);
          try {
            await current.apply(excluded);
            handle.dispose();
          } catch (error) {
            handle.post({ type: 'hostError', text: errorMessage(error) });
          }
          return;
        }
        case 'cancel':
        case 'close': {
          handle.dispose();
          return;
        }
        default:
          return;
      }
    },
  });
}
