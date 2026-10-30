// ─────────────────────────────────────────────────────────────────────────────
// MultiHD Launcher — Compile Order panel (Qt `PriorityDialog` equivalent)
// Owner: writer-ui. CONTRACT.md §7.3 (PriorityHost), §8 F4.
//
// Qt semantics (prioritydialog.cpp): rows show every active `.sv`; clicking a
// row appends it to the priority list (`[01] file`, green) and clicking again
// removes it (`[ ] file`, slate). REVERSE / RESET / DONE. `orderedFiles()` =
// prioritized files in click order, then all remaining files in list order.
// Drag & drop (HTML5) and ▲/▼ buttons reorder the full list (the Qt dialog's
// InternalMove drag did not update priorities — here ordering is meaningful).
// ─────────────────────────────────────────────────────────────────────────────
import * as vscode from 'vscode';
import { PriorityHost } from './api';
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

const PANEL_KEY = 'multihdLauncher.priorityPanel';
const PANEL_TITLE = 'MultiHD Launcher — Compile Order';

let activeHost: PriorityHost | undefined;

function requireHost(): PriorityHost {
  if (!activeHost) {
    throw new Error('MultiHD Launcher compile-order host is not available.');
  }
  return activeHost;
}

/** Qt mainwindow.cpp: existing custom order wins, then the remaining files. */
function initialFiles(host: PriorityHost): { dir: string; files: string[] } {
  const state = host.getState();
  const dir = text(state.dir);
  const files = Array.isArray(state.files) ? state.files.filter((f) => typeof f === 'string') : [];
  const customOrder = Array.isArray(state.customOrder)
    ? state.customOrder.filter((f) => typeof f === 'string')
    : [];
  if (customOrder.length === 0) {
    return { dir, files };
  }
  const ordered: string[] = [];
  const known = new Set(files);
  for (const file of customOrder) {
    if (known.has(file) && ordered.indexOf(file) < 0) {
      ordered.push(file);
    }
  }
  for (const file of files) {
    if (ordered.indexOf(file) < 0) {
      ordered.push(file);
    }
  }
  return { dir, files: ordered };
}

const EXTRA_CSS = `
.prio-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:2px;}
.prio-actions .btn{height:34px;}
.prio-actions .btn-done{flex:0 0 auto;margin-left:auto;padding:0 24px;font-size:13px;}
`;

function buildContent(): PanelContent {
  const host = requireHost();
  const state = initialFiles(host);
  const hasFiles = state.files.length > 0;

  const body = hasFiles
    ? `<div class="heading">⬡  COMPILE ORDER</div>
<div class="hint center">CLICK FILE TO SET PRIORITY  •  CLICK AGAIN TO REMOVE</div>
<div class="prio-list" id="prioList"></div>
<div class="count-line" id="prioCount"></div>
<div class="prio-actions">
  <button type="button" class="btn btn-orange" id="reverseBtn">⇅  REVERSE</button>
  <button type="button" class="btn btn-red" id="resetBtn">✕  RESET</button>
  <button type="button" class="btn btn-save btn-done" id="doneBtn">✓  DONE</button>
</div>`
    : `<div class="heading">⬡  COMPILE ORDER</div>
<div class="hint center">No .sv files available (all may be excluded).<br>Restore some files from the EXCLUDED FILES panel first.</div>
<div class="prio-actions">
  <button type="button" class="btn btn-ghost" id="cancelBtn">Close</button>
</div>`;

  return { body, css: EXTRA_CSS, script: buildScript(state.files) };
}

function buildScript(files: string[]): string {
  return `(function () {
  'use strict';
  var allFiles = ${jsonForScript(files)};
  var ordered = [];
  var dragFile = null;

  function $(id) { return document.getElementById(id); }
  function post(message) { vscode.postMessage(message); }

  function badgeText(index) {
    if (index < 0) { return '[ ]'; }
    return '[' + String(index + 1).padStart(2, '0') + ']';
  }

  function toggle(file) {
    var index = ordered.indexOf(file);
    if (index >= 0) { ordered.splice(index, 1); }
    else { ordered.push(file); }
    render();
  }

  function moveFile(file, delta) {
    var index = allFiles.indexOf(file);
    if (index < 0) { return; }
    var next = index + delta;
    if (next < 0 || next >= allFiles.length) { return; }
    allFiles.splice(index, 1);
    allFiles.splice(next, 0, file);
    render();
  }

  function makeMoveButton(label, title, file, delta) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'prio-move';
    button.textContent = label;
    button.title = title;
    button.addEventListener('click', function (event) {
      event.stopPropagation();
      moveFile(file, delta);
    });
    return button;
  }

  function render() {
    var list = $('prioList');
    if (!list) { return; }
    while (list.firstChild) { list.removeChild(list.firstChild); }
    allFiles.forEach(function (file) {
      var index = ordered.indexOf(file);
      var row = document.createElement('div');
      row.className = 'prio-row ' + (index >= 0 ? 'selected' : 'unselected');
      row.setAttribute('draggable', 'true');
      row.setAttribute('data-file', file);

      var badge = document.createElement('span');
      badge.className = 'prio-index';
      badge.textContent = badgeText(index);

      var name = document.createElement('span');
      name.className = 'prio-name';
      name.textContent = file;
      name.title = file;

      var tools = document.createElement('span');
      tools.className = 'prio-tools';
      tools.appendChild(makeMoveButton('▲', 'Move up', file, -1));
      tools.appendChild(makeMoveButton('▼', 'Move down', file, 1));

      row.appendChild(badge);
      row.appendChild(name);
      row.appendChild(tools);

      row.addEventListener('click', function (event) {
        var target = event.target;
        if (target && target.closest && target.closest('.prio-move')) { return; }
        toggle(file);
      });

      row.addEventListener('dragstart', function (event) {
        dragFile = file;
        row.classList.add('dragging');
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          try { event.dataTransfer.setData('text/plain', file); } catch (error) { /* ignore */ }
        }
      });

      row.addEventListener('dragend', function () {
        dragFile = null;
        render();
      });

      row.addEventListener('dragover', function (event) {
        if (!dragFile || dragFile === file) { return; }
        event.preventDefault();
        if (event.dataTransfer) { event.dataTransfer.dropEffect = 'move'; }
      });

      row.addEventListener('drop', function (event) {
        if (!dragFile) { return; }
        event.preventDefault();
        var from = allFiles.indexOf(dragFile);
        var to = allFiles.indexOf(file);
        if (from >= 0 && to >= 0 && from !== to) {
          allFiles.splice(from, 1);
          allFiles.splice(to, 0, dragFile);
        }
        dragFile = null;
        render();
      });

      list.appendChild(row);
    });

    var count = $('prioCount');
    if (count) {
      count.textContent = ordered.length + ' prioritized  ·  ' + allFiles.length +
        ' file(s)  ·  drag rows or use ▲/▼ to reorder';
    }
  }

  var reverseBtn = $('reverseBtn');
  if (reverseBtn) {
    reverseBtn.addEventListener('click', function () {
      ordered.reverse();
      allFiles.reverse();
      render();
    });
  }

  var resetBtn = $('resetBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      ordered = [];
      render();
    });
  }

  var doneBtn = $('doneBtn');
  if (doneBtn) {
    doneBtn.addEventListener('click', function () {
      if (doneBtn.disabled) { return; }
      var result = ordered.slice();
      allFiles.forEach(function (file) {
        if (result.indexOf(file) < 0) { result.push(file); }
      });
      doneBtn.disabled = true;
      doneBtn.textContent = '⏳  SAVING…';
      post({ type: 'apply', order: result });
      window.setTimeout(function () {
        doneBtn.disabled = false;
        doneBtn.textContent = '✓  DONE';
      }, 6000);
    });
  }

  var cancelBtn = $('cancelBtn');
  if (cancelBtn) { cancelBtn.addEventListener('click', function () { post({ type: '__close' }); }); }

  window.__onHostMessage = function (message) {
    if (!message || !message.type) { return; }
    if (message.type === 'hostError') {
      var count = $('prioCount');
      if (count) {
        count.textContent = '✗  ' + (message.text || 'Unknown error');
        count.style.color = '#ff4444';
      }
      if (doneBtn) { doneBtn.disabled = false; doneBtn.textContent = '✓  DONE'; }
    }
  };

  render();
})();`;
}

// ── public factory ──────────────────────────────────────────────────────────

/** Open (or re-render) the compile-order (priority) panel. */
export function showPriorityPanel(context: vscode.ExtensionContext, host: PriorityHost): void {
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
          const order = stringList(message.order);
          try {
            await current.apply(order);
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
