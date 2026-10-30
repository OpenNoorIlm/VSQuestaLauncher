// ─────────────────────────────────────────────────────────────────────────────
// MultiHD Launcher — main launcher panel (Qt `MainWindow` equivalent)
// Owner: writer-ui. CONTRACT.md §7.3 (LauncherHost/LauncherPanelHandle), §8 F1.
//
// Layout mirrors /home/bismillah/QuestaLauncher/mainwindow.cpp:
//   logo → subtitle → license badge → project path row → EXCLUDED FILES chips →
//   action row → COMPILE FOR checkboxes → gradient LAUNCH → INSTALL row → log.
// All strings use the verbatim Qt multi-space padding (TEMPLATES.md §12.4).
// The panel never reads files: folder/browse/launch/install all go through the
// LauncherHost. Enabled target checkboxes are persisted in workspaceState.
// ─────────────────────────────────────────────────────────────────────────────
import * as vscode from 'vscode';
import { LauncherAction, LauncherHost, LauncherPanelHandle, LauncherState } from './api';
import { TargetTool } from '../models';
import {
  CyberPanelHandle,
  PanelContent,
  PanelEnv,
  WebviewMessage,
  bool,
  brandBlock,
  errorMessage,
  esc,
  groupBox,
  jsonForScript,
  openCyberPanel,
  separator,
  stringList,
  text,
} from './base';

const PANEL_KEY = 'multihdLauncher.launcherPanel';
const PANEL_TITLE = 'MultiHD Launcher — Launcher';
const TARGETS_STATE_KEY = 'multihdLauncher.launcherTargets';
const LOG_LIMIT = 400;

const TARGET_TOOLS: TargetTool[] = ['questa', 'quartus', 'gowin'];

/** Log lines are kept outside the handle so a closed→reopened panel replays them. */
const logBuffer: string[] = [];

let activeHandle: LauncherPanelHandleImpl | undefined;

// ── target checkbox persistence helpers ─────────────────────────────────────

function defaultTargets(): Record<TargetTool, boolean> {
  return { questa: true, quartus: false, gowin: false };
}

function readSavedTargets(
  context: vscode.ExtensionContext
): Partial<Record<TargetTool, boolean>> | undefined {
  const raw = context.workspaceState.get<Record<string, unknown>>(TARGETS_STATE_KEY);
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const saved: Partial<Record<TargetTool, boolean>> = {};
  for (const tool of TARGET_TOOLS) {
    if (typeof raw[tool] === 'boolean') {
      saved[tool] = raw[tool] as boolean;
    }
  }
  return Object.keys(saved).length > 0 ? saved : undefined;
}

function readTargets(
  context: vscode.ExtensionContext,
  host: LauncherHost
): Record<TargetTool, boolean> {
  const result = defaultTargets();
  const state = host.getState();
  if (state && state.targets) {
    for (const tool of TARGET_TOOLS) {
      if (typeof state.targets[tool] === 'boolean') {
        result[tool] = state.targets[tool];
      }
    }
  }
  const saved = readSavedTargets(context);
  if (saved) {
    for (const tool of TARGET_TOOLS) {
      const value = saved[tool];
      if (typeof value === 'boolean') {
        result[tool] = value;
      }
    }
  }
  return result;
}

function persistTargets(
  context: vscode.ExtensionContext,
  targets: Record<TargetTool, boolean>
): void {
  void context.workspaceState.update(TARGETS_STATE_KEY, targets);
}

/** Push the restored checkbox state into the host so launch flows agree with the UI. */
function alignHostTargets(context: vscode.ExtensionContext, host: LauncherHost): void {
  const saved = readSavedTargets(context);
  if (!saved) {
    return;
  }
  const current = host.getState().targets;
  for (const tool of TARGET_TOOLS) {
    const wanted = saved[tool];
    if (typeof wanted !== 'boolean') {
      continue;
    }
    if (current && current[tool] === wanted) {
      continue;
    }
    void host.dispatch({ type: 'toggleTarget', tool, checked: wanted }).catch(() => undefined);
  }
}

// ── panel handle ────────────────────────────────────────────────────────────

class LauncherPanelHandleImpl implements LauncherPanelHandle {
  private host: LauncherHost;
  private targets: Record<TargetTool, boolean>;
  private readonly cyber: CyberPanelHandle;

  constructor(
    private readonly context: vscode.ExtensionContext,
    host: LauncherHost
  ) {
    this.host = host;
    this.targets = readTargets(context, host);
    this.cyber = openCyberPanel(context, {
      key: PANEL_KEY,
      title: PANEL_TITLE,
      build: (env: PanelEnv) => this.buildContent(env),
      onMessage: (message: WebviewMessage) => this.onMessage(message),
      onDispose: () => {
        if (activeHandle === this) {
          activeHandle = undefined;
        }
      },
    });
  }

  get disposed(): boolean {
    return this.cyber.disposed;
  }

  updateHost(host: LauncherHost): void {
    this.host = host;
    this.targets = readTargets(this.context, host);
  }

  reveal(): void {
    this.cyber.reveal();
    this.refresh();
  }

  refresh(): void {
    const state: LauncherState = this.host.getState();
    this.cyber.post({ type: 'state', state, targets: this.targets });
  }

  appendLog(line: string): void {
    const value = String(line === null || line === undefined ? '' : line).replace(/\r?\n$/, '');
    if (!value) {
      return;
    }
    logBuffer.push(value);
    while (logBuffer.length > LOG_LIMIT) {
      logBuffer.shift();
    }
    this.cyber.post({ type: 'log', line: value });
  }

  dispose(): void {
    this.cyber.dispose();
  }

  // ── webview → host routing ────────────────────────────────────────────────
  private async onMessage(message: WebviewMessage): Promise<void> {
    const host = this.host;
    switch (message.type) {
      case 'ready': {
        this.refresh();
        return;
      }
      case 'refresh': {
        try {
          await host.dispatch({ type: 'refresh' });
        } catch {
          // A host without a refresh action must not break the panel.
        }
        this.refresh();
        return;
      }
      case 'browse': {
        await host.dispatch({ type: 'browse' });
        this.refresh();
        return;
      }
      case 'setFolder': {
        const dir = text(message.dir).trim();
        await host.dispatch({ type: 'setFolder', dir });
        this.refresh();
        return;
      }
      case 'restoreFile': {
        const file = text(message.file);
        if (!file) {
          return;
        }
        await host.dispatch({ type: 'restoreFile', file });
        this.refresh();
        return;
      }
      case 'toggleTarget': {
        const tool = text(message.tool);
        if (tool !== 'questa' && tool !== 'quartus' && tool !== 'gowin') {
          return;
        }
        const checked = bool(message.checked);
        this.targets = { ...this.targets, [tool]: checked };
        persistTargets(this.context, this.targets);
        await host.dispatch({ type: 'toggleTarget', tool, checked });
        this.refresh();
        return;
      }
      case 'openConfig':
      case 'openPriority':
      case 'openExclude':
      case 'openLibrary':
      case 'openGowinCst':
      case 'installQuesta':
      case 'licenseRequest': {
        await host.dispatch({ type: message.type } as LauncherAction);
        this.refresh();
        return;
      }
      case 'launch': {
        await host.dispatch({ type: 'launch' });
        this.refresh();
        return;
      }
      case 'hostError': {
        return;
      }
      default:
        return;
    }
  }

  // ── rendering ─────────────────────────────────────────────────────────────
  private buildContent(env: PanelEnv): PanelContent {
    const state = this.host.getState();
    const excluded = state.excludedFiles ?? [];
    const hasCustomOrder = (state.customOrder ?? []).length > 0;

    const licenseBadge = state.licenseOk
      ? `<div class="badge ok" id="licenseBadge" title="${esc(state.licensePath)}">✓ LICENSE OK</div>`
      : `<div class="badge warn" id="licenseBadge" title="${esc(state.licensePath)}">⚠ LICENSE NOT SET — configure before launching Questa!</div>`;

    const chips =
      excluded.length === 0
        ? '<div class="no-excl">no files excluded</div>'
        : excluded
            .map(
              (file) =>
                `<div class="chip-row"><span class="chip-name" title="${esc(file)}">${esc(
                  file
                )}</span><button type="button" class="btn btn-restore" data-file="${esc(
                  file
                )}">↩ restore</button></div>`
            )
            .join('');

    const excludedTitle =
      excluded.length > 0 ? `EXCLUDED FILES  [${excluded.length}]` : 'EXCLUDED FILES';
    const priorityLabel = hasCustomOrder ? '⇅   ORDER SET  ✓' : '⇅   COMPILE ORDER';
    const excludeLabel = excluded.length
      ? `✕   DISINCLUDE  [${excluded.length} hidden]`
      : '✕   DISINCLUDE';
    const launchLabel = state.licenseOk ? '▶   LAUNCH' : '⚠   LAUNCH  (Questa: no license!)';

    const body = `${brandBlock(env)}
<button type="button" class="icon-btn" id="refreshBtn" title="Refresh launcher state">⟳</button>
${licenseBadge}
${separator()}
<div class="path-row">
  <input id="folderInput" type="text" spellcheck="false" autocomplete="off" placeholder="Select project folder..." value="${esc(
    state.projectDir
  )}">
  <button type="button" class="btn btn-cyan btn-browse" id="browseBtn">Browse</button>
</div>
${groupBox(excludedTitle, `<div class="chips" id="chips">${chips}</div>`, 'danger')}
<div class="actions">
  <button type="button" class="btn btn-orange${
    hasCustomOrder ? ' order-set' : ''
  }" id="priorityBtn">${esc(priorityLabel)}</button>
  <button type="button" class="btn btn-red" id="excludeBtn">${esc(excludeLabel)}</button>
  <button type="button" class="btn btn-lib" id="libraryBtn">📦   LIBRARIES</button>
  <button type="button" class="btn btn-purple btn-config" id="configBtn">⚙   CONFIG</button>
</div>
${groupBox(
  'COMPILE FOR',
  `<div class="compile-for">
    <label class="chk questa"><input type="checkbox" id="chkQuesta"${
      this.targets.questa ? ' checked' : ''
    }>⬡  Questa / Modelsim</label>
    <label class="chk quartus"><input type="checkbox" id="chkQuartus"${
      this.targets.quartus ? ' checked' : ''
    }>◈  Quartus Prime</label>
    <label class="chk gowin"><input type="checkbox" id="chkGowin"${
      this.targets.gowin ? ' checked' : ''
    }>◆  Gowin EDA</label>
  </div>`
)}
<button type="button" class="btn btn-launch${state.licenseOk ? '' : ' warn'}" id="launchBtn"${
      state.busy ? ' disabled' : ''
    }>${esc(launchLabel)}</button>
${groupBox(
  'INSTALL',
  `<div class="install-row">
    <button type="button" class="btn btn-green" id="installBtn">⬇   INSTALL QUESTA</button>
    <button type="button" class="btn btn-purple2" id="licenseBtn">🔑   LICENSE REQUEST</button>
  </div>`
)}
<div class="log" id="log"><div class="placeholder">// output will appear here...</div></div>`;

    return { body, script: this.buildScript(state) };
  }

  private buildScript(state: LauncherState): string {
    return `(function () {
  'use strict';
  var initialState = ${jsonForScript(state)};
  var initialTargets = ${jsonForScript(this.targets)};
  var initialLog = ${jsonForScript(logBuffer.slice())};

  function $(id) { return document.getElementById(id); }
  function post(message) { vscode.postMessage(message); }

  function classify(line) {
    var value = String(line);
    if (/^\\s*✓/.test(value) || /^\\s*↩/.test(value)) { return 'l-green'; }
    if (/^\\s*✗/.test(value)) { return 'l-red'; }
    if (/^\\s*⚠/.test(value)) { return 'l-orange'; }
    if (/^\\s*[▶⬡⟳⚡]/.test(value)) { return 'l-cyan'; }
    if (/^\\s*[◈◆⬇🔑]/.test(value)) { return 'l-purple'; }
    if (/^\\s{2,}\\S/.test(value)) { return 'l-muted'; }
    return 'l-cyan';
  }

  function appendLog(line, kind) {
    var log = $('log');
    if (!log) { return; }
    var placeholder = log.querySelector('.placeholder');
    if (placeholder && placeholder.parentNode) { placeholder.parentNode.removeChild(placeholder); }
    var row = document.createElement('div');
    row.className = 'log-line ' + (kind || classify(line));
    row.textContent = String(line);
    log.appendChild(row);
    while (log.childNodes.length > 500) { log.removeChild(log.firstChild); }
    log.scrollTop = log.scrollHeight;
  }

  function renderChips(files) {
    var wrap = $('chips');
    if (!wrap) { return; }
    while (wrap.firstChild) { wrap.removeChild(wrap.firstChild); }
    if (!files || files.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'no-excl';
      empty.textContent = 'no files excluded';
      wrap.appendChild(empty);
      return;
    }
    files.forEach(function (file) {
      var row = document.createElement('div');
      row.className = 'chip-row';
      var name = document.createElement('span');
      name.className = 'chip-name';
      name.textContent = file;
      name.title = file;
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-restore';
      button.textContent = '↩ restore';
      button.addEventListener('click', function () { post({ type: 'restoreFile', file: file }); });
      row.appendChild(name);
      row.appendChild(button);
      wrap.appendChild(row);
    });
  }

  function renderState(state) {
    state = state || {};
    var folder = $('folderInput');
    if (folder && document.activeElement !== folder) { folder.value = state.projectDir || ''; }

    var badge = $('licenseBadge');
    if (badge) {
      badge.title = state.licensePath || '';
      if (state.licenseOk) {
        badge.className = 'badge ok';
        badge.textContent = '✓ LICENSE OK';
      } else {
        badge.className = 'badge warn';
        badge.textContent = '⚠ LICENSE NOT SET — configure before launching Questa!';
      }
    }

    var excluded = state.excludedFiles || [];
    renderChips(excluded);
    var title = $('excludedTitle');
    if (title) {
      title.textContent = excluded.length > 0
        ? 'EXCLUDED FILES  [' + excluded.length + ']'
        : 'EXCLUDED FILES';
    }

    var priority = $('priorityBtn');
    if (priority) {
      var hasOrder = (state.customOrder || []).length > 0;
      priority.textContent = hasOrder ? '⇅   ORDER SET  ✓' : '⇅   COMPILE ORDER';
      if (hasOrder) { priority.classList.add('order-set'); }
      else { priority.classList.remove('order-set'); }
    }

    var exclude = $('excludeBtn');
    if (exclude) {
      exclude.textContent = excluded.length > 0
        ? '✕   DISINCLUDE  [' + excluded.length + ' hidden]'
        : '✕   DISINCLUDE';
    }

    var launch = $('launchBtn');
    if (launch) {
      launch.classList.toggle('warn', !state.licenseOk);
      launch.disabled = state.busy === true;
      if (state.busy === true) { launch.textContent = '⏳   WORKING…'; }
      else if (state.licenseOk) { launch.textContent = '▶   LAUNCH'; }
      else { launch.textContent = '⚠   LAUNCH  (Questa: no license!)'; }
    }
  }

  function renderTargets(targets) {
    targets = targets || {};
    var ids = { questa: 'chkQuesta', quartus: 'chkQuartus', gowin: 'chkGowin' };
    Object.keys(ids).forEach(function (tool) {
      var box = $(ids[tool]);
      if (box) { box.checked = targets[tool] === true; }
    });
  }

  var browseBtn = $('browseBtn');
  if (browseBtn) { browseBtn.addEventListener('click', function () { post({ type: 'browse' }); }); }

  var folderInput = $('folderInput');
  if (folderInput) {
    folderInput.addEventListener('change', function () {
      post({ type: 'setFolder', dir: folderInput.value.trim() });
    });
    folderInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); folderInput.blur(); }
    });
  }

  var refreshBtn = $('refreshBtn');
  if (refreshBtn) { refreshBtn.addEventListener('click', function () { post({ type: 'refresh' }); }); }

  var actionMap = {
    priorityBtn: 'openPriority',
    excludeBtn: 'openExclude',
    libraryBtn: 'openLibrary',
    configBtn: 'openConfig',
    installBtn: 'installQuesta',
    licenseBtn: 'licenseRequest'
  };
  Object.keys(actionMap).forEach(function (id) {
    var button = $(id);
    if (button) { button.addEventListener('click', function () { post({ type: actionMap[id] }); }); }
  });

  var checkboxMap = { chkQuesta: 'questa', chkQuartus: 'quartus', chkGowin: 'gowin' };
  Object.keys(checkboxMap).forEach(function (id) {
    var box = $(id);
    if (!box) { return; }
    box.addEventListener('change', function () {
      post({ type: 'toggleTarget', tool: checkboxMap[id], checked: box.checked });
    });
  });

  var launchBtn = $('launchBtn');
  if (launchBtn) {
    launchBtn.addEventListener('click', function () {
      if (launchBtn.disabled) { return; }
      launchBtn.disabled = true;
      launchBtn.textContent = '⏳   WORKING…';
      post({ type: 'launch' });
      window.setTimeout(function () { post({ type: 'refresh' }); }, 6000);
    });
  }

  window.__onHostMessage = function (message) {
    if (!message || !message.type) { return; }
    if (message.type === 'state') {
      renderState(message.state || {});
      renderTargets(message.targets || {});
    } else if (message.type === 'log') {
      appendLog(message.line, message.kind);
    } else if (message.type === 'hostError') {
      appendLog('✗ ' + message.text, 'l-red');
    }
  };

  renderState(initialState);
  renderTargets(initialTargets);
  initialLog.forEach(function (line) { appendLog(line); });
})();`;
  }
}

// ── public factory ──────────────────────────────────────────────────────────

/**
 * Show (or reveal) the MultiHD Launcher main panel.
 * Returns a stable handle so launch flows can stream log lines into it.
 */
export function showLauncherPanel(
  context: vscode.ExtensionContext,
  host: LauncherHost
): LauncherPanelHandle {
  if (activeHandle && !activeHandle.disposed) {
    activeHandle.updateHost(host);
    activeHandle.reveal();
    return activeHandle;
  }
  alignHostTargets(context, host);
  const handle = new LauncherPanelHandleImpl(context, host);
  activeHandle = handle;
  return handle;
}

/** True when the launcher panel is currently open. */
export function isLauncherPanelOpen(): boolean {
  return activeHandle !== undefined && !activeHandle.disposed;
}

/** Dispose the launcher panel (used by tests / extension shutdown). */
export function disposeLauncherPanel(): void {
  if (activeHandle) {
    activeHandle.dispose();
  }
}
