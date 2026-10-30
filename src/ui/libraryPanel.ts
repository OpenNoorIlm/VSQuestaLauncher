// ─────────────────────────────────────────────────────────────────────────────
// MultiHD Launcher — Library Manager panel (Qt `LibraryDialog` equivalent)
// Owner: writer-ui. CONTRACT.md §7.3 (LibraryHost), §8 F9.
//
// Two columns:
//   REGISTERED LIBRARIES — global registry (~/.questa_libs): name, source path,
//     ✓ compiled / ✗ not compiled + compiledAt; add (name + source browse),
//     remove (two-step confirm) and compile (with status feedback).
//   PROJECT DEPENDENCIES — checkboxes for projectDeps, persisted through
//     host.setProjectDeps; uncompiled dependencies are flagged.
// All filesystem/registry work happens in the host (tools/library.ts).
// ─────────────────────────────────────────────────────────────────────────────
import * as vscode from 'vscode';
import { LibraryHost } from './api';
import {
  CyberPanelHandle,
  PanelContent,
  WebviewMessage,
  errorMessage,
  groupBox,
  jsonForScript,
  openCyberPanel,
  separator,
  stringList,
  text,
} from './base';

const PANEL_KEY = 'multihdLauncher.libraryPanel';
const PANEL_TITLE = 'MultiHD Launcher — Library Manager';

interface LibInfo {
  name: string;
  sourcePath: string;
  compiled: boolean;
  compiledAt: string;
}

interface LibraryViewState {
  projectDir: string;
  vsimPath: string;
  libraries: LibInfo[];
  projectDeps: string[];
}

let activeHost: LibraryHost | undefined;

function requireHost(): LibraryHost {
  if (!activeHost) {
    throw new Error('MultiHD Launcher library host is not available.');
  }
  return activeHost;
}

function sanitiseLibraries(raw: unknown): LibInfo[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const result: LibInfo[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.name !== 'string') {
      continue;
    }
    result.push({
      name: record.name,
      sourcePath: typeof record.sourcePath === 'string' ? record.sourcePath : '',
      compiled: record.compiled === true,
      compiledAt: typeof record.compiledAt === 'string' ? record.compiledAt : '',
    });
  }
  return result;
}

function readState(host: LibraryHost): LibraryViewState {
  const raw = host.getState();
  return {
    projectDir: text(raw.projectDir),
    vsimPath: text(raw.vsimPath),
    libraries: sanitiseLibraries(raw.libraries),
    projectDeps: Array.isArray(raw.projectDeps)
      ? raw.projectDeps.filter((name) => typeof name === 'string')
      : [],
  };
}

function buildContent(): PanelContent {
  const state = readState(requireHost());

  const body = `<div class="title title-lg">📦   LIBRARY MANAGER</div>
${separator()}
<div class="lib-grid">
  ${groupBox(
    'REGISTERED LIBRARIES',
    `<div class="section-hint">Libraries compiled here are available to any project.</div>
<div class="lib-list" id="libList"></div>
<div class="add-form">
  <input id="newName" type="text" spellcheck="false" autocomplete="off" placeholder="library name (single word, no spaces)">
  <div class="row">
    <input id="newSource" type="text" spellcheck="false" autocomplete="off" placeholder="source folder — must contain at least one .sv">
    <button type="button" class="btn btn-cyan btn-browse" id="browseSourceBtn">Browse</button>
  </div>
  <button type="button" class="btn btn-green" id="addBtn">＋  ADD LIBRARY</button>
</div>
<div class="lib-actions">
  <button type="button" class="btn btn-orange" id="compileBtn">⚡  COMPILE</button>
  <button type="button" class="btn btn-red" id="removeBtn">✕  REMOVE</button>
</div>`
  )}
  ${groupBox(
    'PROJECT DEPENDENCIES',
    `<div id="projectBody"></div>`,
    'project'
  )}
</div>
<div class="status" id="libStatus"> </div>
<button type="button" class="btn btn-save" id="doneBtn">✓   DONE</button>`;

  return { body, script: buildScript(state) };
}

function buildScript(state: LibraryViewState): string {
  return `(function () {
  'use strict';
  var state = ${jsonForScript(state)};
  var selected = '';

  function $(id) { return document.getElementById(id); }
  function post(message) { vscode.postMessage(message); }

  function clear(node) {
    if (!node) { return; }
    while (node.firstChild) { node.removeChild(node.firstChild); }
  }

  function setStatus(messageText, kind) {
    var status = $('libStatus');
    if (!status) { return; }
    status.textContent = messageText || ' ';
    if (kind === 'error') { status.className = 'status error'; }
    else if (kind === 'busy') { status.className = 'status busy'; }
    else { status.className = 'status'; }
  }

  function compiledAtText(lib) {
    if (!lib.compiledAt) { return ''; }
    return String(lib.compiledAt).replace('T', ' ').slice(0, 16);
  }

  function defaultNameFromPath(path) {
    var parts = String(path || '').split(/[\\\\/]+/).filter(function (part) { return part !== ''; });
    var base = parts.length ? parts[parts.length - 1] : '';
    return base.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function renderLibraries() {
    var list = $('libList');
    if (!list) { return; }
    clear(list);
    if (!state.libraries || state.libraries.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'lib-empty';
      empty.textContent = 'No libraries registered yet. Click ＋ ADD LIBRARY.';
      list.appendChild(empty);
      return;
    }
    state.libraries.forEach(function (lib) {
      var row = document.createElement('div');
      row.className = 'lib-row ' + (lib.compiled ? 'compiled' : 'pending') +
        (lib.name === selected ? ' selected' : '');
      row.setAttribute('data-name', lib.name);

      var top = document.createElement('div');
      top.className = 'lib-row-top';

      var badge = document.createElement('span');
      badge.className = 'lib-badge';
      badge.textContent = lib.compiled ? '✓' : '✗';

      var name = document.createElement('span');
      name.className = 'lib-name';
      name.textContent = lib.name;
      name.title = lib.name;

      var status = document.createElement('span');
      status.className = 'lib-status';
      status.textContent = lib.compiled ? 'compiled' : 'not compiled';

      top.appendChild(badge);
      top.appendChild(name);
      top.appendChild(status);

      var source = document.createElement('div');
      source.className = 'lib-meta';
      source.textContent = lib.sourcePath || '(no source path)';
      source.title = lib.sourcePath || '';

      var when = document.createElement('div');
      when.className = 'lib-meta';
      when.textContent = lib.compiled
        ? 'compiled ' + (compiledAtText(lib) || '(unknown time)')
        : 'not compiled yet';

      row.appendChild(top);
      row.appendChild(source);
      row.appendChild(when);

      row.addEventListener('click', function () {
        selected = lib.name;
        renderLibraries();
      });

      list.appendChild(row);
    });
  }

  function renderProject() {
    var body = $('projectBody');
    if (!body) { return; }
    clear(body);

    if (!state.projectDir) {
      var note = document.createElement('div');
      note.className = 'section-hint';
      note.textContent = 'No project folder selected — open a project first.';
      body.appendChild(note);
      return;
    }

    var hint = document.createElement('div');
    hint.className = 'section-hint';
    hint.textContent = 'Tick a library to add it to this project.';
    var hint2 = document.createElement('div');
    hint2.className = 'section-hint';
    hint2.textContent = 'Checked libraries are compiled before your project and linked with -L flags.';
    body.appendChild(hint);
    body.appendChild(hint2);

    var list = document.createElement('div');
    list.className = 'dep-list';

    if (!state.libraries || state.libraries.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'lib-empty';
      empty.textContent = 'No global libraries yet — add some above.';
      list.appendChild(empty);
    } else {
      state.libraries.forEach(function (lib) {
        var row = document.createElement('label');
        row.className = 'file-row';

        var box = document.createElement('input');
        box.type = 'checkbox';
        box.value = lib.name;
        box.checked = (state.projectDeps || []).indexOf(lib.name) >= 0;

        var name = document.createElement('span');
        name.className = 'file-name';
        name.textContent = lib.name;
        name.title = lib.name;

        row.appendChild(box);
        row.appendChild(name);

        if (!lib.compiled) {
          var warning = document.createElement('span');
          warning.className = 'dep-badge';
          warning.textContent = '⚠ not compiled';
          row.appendChild(warning);
        }

        box.addEventListener('change', function () {
          var deps = [];
          Array.prototype.slice.call(document.querySelectorAll('#projectBody input[type=checkbox]'))
            .forEach(function (other) {
              if (other.checked) { deps.push(other.value); }
            });
          post({ type: 'setDeps', deps: deps, name: lib.name, checked: box.checked });
        });

        list.appendChild(row);
      });
    }
    body.appendChild(list);

    var saved = document.createElement('div');
    saved.className = 'section-hint mt-2';
    saved.textContent = 'Saved to: ' + state.projectDir + '/questa_libs.json';
    body.appendChild(saved);
  }

  function refreshFromHost() {
    post({ type: 'refreshState' });
  }

  // ── add / remove / compile / browse ──
  var browseSourceBtn = $('browseSourceBtn');
  if (browseSourceBtn) {
    browseSourceBtn.addEventListener('click', function () {
      var input = $('newSource');
      post({ type: 'browseSource', current: input ? input.value : '' });
    });
  }

  var addBtn = $('addBtn');
  if (addBtn) {
    addBtn.addEventListener('click', function () {
      var nameInput = $('newName');
      var sourceInput = $('newSource');
      var name = nameInput ? nameInput.value.trim() : '';
      var sourcePath = sourceInput ? sourceInput.value.trim() : '';
      if (sourcePath === '') {
        setStatus('✕  Select a library source folder first.', 'error');
        return;
      }
      if (name === '') { name = defaultNameFromPath(sourcePath); }
      if (name === '') {
        setStatus('✕  Enter a library name (single word, no spaces).', 'error');
        return;
      }
      setStatus('⚡  Registering "' + name + '" …', 'busy');
      post({ type: 'add', name: name, sourcePath: sourcePath });
    });
  }

  var removeBtn = $('removeBtn');
  if (removeBtn) {
    removeBtn.addEventListener('click', function () {
      if (!selected) { setStatus('✕  Select a library to remove.', 'error'); return; }
      if (removeBtn.getAttribute('data-confirm') === '1') {
        removeBtn.removeAttribute('data-confirm');
        removeBtn.textContent = '✕  REMOVE';
        setStatus('⚡  Removing "' + selected + '" …', 'busy');
        post({ type: 'remove', name: selected });
        return;
      }
      removeBtn.setAttribute('data-confirm', '1');
      removeBtn.textContent = '⚠  CONFIRM REMOVE';
      setStatus('Remove library "' + selected + '"? Its compiled work database is deleted. Click again to confirm.', 'error');
      window.setTimeout(function () {
        removeBtn.removeAttribute('data-confirm');
        removeBtn.textContent = '✕  REMOVE';
      }, 4000);
    });
  }

  var compileBtn = $('compileBtn');
  if (compileBtn) {
    compileBtn.addEventListener('click', function () {
      if (!selected) { setStatus('✕  Select a library to compile.', 'error'); return; }
      compileBtn.disabled = true;
      setStatus('⚡  Compiling "' + selected + '" …', 'busy');
      post({ type: 'compile', name: selected });
    });
  }

  var doneBtn = $('doneBtn');
  if (doneBtn) {
    doneBtn.addEventListener('click', function () { post({ type: '__close' }); });
  }

  window.__onHostMessage = function (message) {
    if (!message || !message.type) { return; }
    if (message.type === 'state') {
      state = message.state || state;
      if (selected) {
        var exists = (state.libraries || []).some(function (lib) { return lib.name === selected; });
        if (!exists) { selected = ''; }
      }
      renderLibraries();
      renderProject();
      var compile = $('compileBtn');
      if (compile) { compile.disabled = false; }
    } else if (message.type === 'status') {
      setStatus(message.text || '', message.error === true ? 'error' : (message.busy === true ? 'busy' : 'ok'));
    } else if (message.type === 'browseResult') {
      var input = $('newSource');
      if (input && typeof message.value === 'string') {
        input.value = message.value;
        var nameInput = $('newName');
        if (nameInput && nameInput.value.trim() === '') {
          nameInput.value = defaultNameFromPath(message.value);
        }
      }
    } else if (message.type === 'hostError') {
      setStatus('✗  ' + (message.text || 'Unknown error'), 'error');
      var compileBtnAgain = $('compileBtn');
      if (compileBtnAgain) { compileBtnAgain.disabled = false; }
    }
  };

  renderLibraries();
  renderProject();
})();`;
}

// ── host message handlers ───────────────────────────────────────────────────

function postFreshState(host: LibraryHost, handle: CyberPanelHandle): void {
  try {
    handle.post({ type: 'state', state: readState(host) });
  } catch (error) {
    handle.post({ type: 'hostError', text: errorMessage(error) });
  }
}

function statusFromResult(
  result: { ok: boolean; error?: string } | undefined,
  successText: string
): { text: string; error: boolean } {
  if (result && result.ok === true) {
    return { text: successText, error: false };
  }
  const reason = result && result.error ? result.error : 'Operation failed.';
  return { text: `✕  ${reason}`, error: true };
}

// ── public factory ──────────────────────────────────────────────────────────

/** Open (or re-render) the global library + project dependency manager. */
export function showLibraryPanel(context: vscode.ExtensionContext, host: LibraryHost): void {
  activeHost = host;
  openCyberPanel(context, {
    key: PANEL_KEY,
    title: PANEL_TITLE,
    reloadOnShow: true,
    build: () => buildContent(),
    onMessage: async (message: WebviewMessage, handle: CyberPanelHandle) => {
      const current = requireHost();
      switch (message.type) {
        case 'add': {
          const name = text(message.name).trim();
          const sourcePath = text(message.sourcePath).trim();
          let result: { ok: boolean; error?: string } | undefined;
          try {
            result = await current.addLibrary(name, sourcePath);
          } catch (error) {
            handle.post({ type: 'status', text: `✕  ${errorMessage(error)}`, error: true });
            return;
          }
          const outcome = statusFromResult(
            result,
            `✓  Library "${name}" registered. Compile it to use it.`
          );
          handle.post({ type: 'status', text: outcome.text, error: outcome.error });
          postFreshState(current, handle);
          return;
        }
        case 'remove': {
          const name = text(message.name).trim();
          let result: { ok: boolean; error?: string } | undefined;
          try {
            result = await current.removeLibrary(name);
          } catch (error) {
            handle.post({ type: 'status', text: `✕  ${errorMessage(error)}`, error: true });
            return;
          }
          const outcome = statusFromResult(result, `✓  Library "${name}" removed.`);
          handle.post({ type: 'status', text: outcome.text, error: outcome.error });
          postFreshState(current, handle);
          return;
        }
        case 'compile': {
          const name = text(message.name).trim();
          handle.post({ type: 'status', text: `⚡  Compiling "${name}" …`, busy: true });
          let result: { ok: boolean; error?: string } | undefined;
          try {
            result = await current.compileLibrary(name);
          } catch (error) {
            handle.post({ type: 'status', text: `✕  ${errorMessage(error)}`, error: true });
            return;
          }
          const outcome = statusFromResult(result, `✓  "${name}" compiled successfully.`);
          handle.post({ type: 'status', text: outcome.text, error: outcome.error });
          postFreshState(current, handle);
          return;
        }
        case 'setDeps': {
          const deps = stringList(message.deps);
          const name = text(message.name);
          const checked = message.checked === true;
          let fresh: LibraryViewState;
          try {
            await current.setProjectDeps(deps);
            fresh = readState(current);
          } catch (error) {
            handle.post({ type: 'status', text: `✕  ${errorMessage(error)}`, error: true });
            return;
          }
          const lib = fresh.libraries.find((entry) => entry.name === name);
          let statusText: string;
          if (checked && lib && !lib.compiled) {
            statusText = `⚠  "${name}" added but not compiled — compile it before launching.`;
          } else if (checked) {
            statusText = `✓  "${name}" added to project deps.`;
          } else {
            statusText = `✓  "${name}" removed from project deps.`;
          }
          handle.post({ type: 'state', state: fresh });
          handle.post({ type: 'status', text: statusText, error: false });
          return;
        }
        case 'browseSource': {
          const currentPath = text(message.current);
          let picked: string | undefined;
          try {
            picked = await current.browseFolder(currentPath);
          } catch (error) {
            handle.post({ type: 'status', text: `✕  ${errorMessage(error)}`, error: true });
            return;
          }
          if (typeof picked === 'string' && picked.length > 0) {
            handle.post({ type: 'browseResult', value: picked });
          }
          return;
        }
        case 'refreshState': {
          postFreshState(current, handle);
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

