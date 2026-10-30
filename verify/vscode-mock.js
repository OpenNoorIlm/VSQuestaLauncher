/**
 * verify/vscode-mock.js — minimal in-process mock of the VS Code extension host API.
 *
 * Used by verify/activation-test.js to load `out/extension.js` outside VS Code and
 * drive `activate()` + a few commands. This lives in verify/ (checker-owned) and is
 * never packaged (see .vscodeignore `verify/**`).
 *
 * Design goals:
 *  - every API the extension touches exists (no TypeError from missing members)
 *  - user-interaction APIs resolve immediately (cancel semantics) so async handlers settle
 *  - commands/registration/messages are recorded for assertions
 *  - installs via Module._load hook for the literal 'vscode' request
 */

'use strict';

const path = require('path');
const Module = require('module');

// ────────────────────────────── primitive classes ─────────────────────────
class Uri {
  constructor(scheme, fsPath) {
    this.scheme = scheme;
    this.fsPath = fsPath;
    this.path = fsPath;
    this.authority = '';
    this.query = '';
    this.fragment = '';
  }
  static file(p) { return new Uri('file', path.resolve(p)); }
  static parse(p) { return new Uri('file', p); }
  static joinPath(base, ...parts) {
    const fsPath = path.join(base && base.fsPath ? base.fsPath : String(base), ...parts);
    return new Uri('file', fsPath);
  }
  with(change) {
    const next = new Uri(change.scheme || this.scheme, change.fsPath !== undefined ? change.fsPath : this.fsPath);
    Object.assign(next, this, change);
    return next;
  }
  toString() { return this.scheme + '://' + (this.authority || '') + this.fsPath; }
  toJSON() { return { scheme: this.scheme, fsPath: this.fsPath, path: this.path }; }
}

class Disposable {
  constructor(fn) { this._fn = typeof fn === 'function' ? fn : null; }
  dispose() { if (this._fn) { const f = this._fn; this._fn = null; f(); } }
  static from(...items) {
    return new Disposable(() => { for (const i of items) { try { if (i && i.dispose) i.dispose(); } catch (e) { /* noop */ } } });
  }
}

class EventEmitter {
  constructor() {
    this._listeners = new Set();
    this.event = (listener, thisArg, disposables) => {
      const l = thisArg ? listener.bind(thisArg) : listener;
      this._listeners.add(l);
      const d = new Disposable(() => this._listeners.delete(l));
      if (Array.isArray(disposables)) disposables.push(d);
      return d;
    };
  }
  fire(data) { for (const l of Array.from(this._listeners)) { try { l(data); } catch (e) { /* noop */ } } }
  dispose() { this._listeners.clear(); }
}

class ThemeColor { constructor(id) { this.id = id; } }
class ThemeIcon { constructor(id, color) { this.id = id; this.color = color; } }
class CancellationTokenSource {
  constructor() { this._emitter = new EventEmitter(); this.token = { isCancellationRequested: false, onCancellationRequested: this._emitter.event }; }
  cancel() { this.token.isCancellationRequested = true; this._emitter.fire(); }
  dispose() { this._emitter.dispose(); }
}
class MarkdownString { constructor(value) { this.value = value || ''; } appendText(t) { this.value += t; return this; } appendMarkdown(t) { this.value += t; return this; } }

// ────────────────────────────── output-sink helpers ────────────────────────
function makeOutputChannel(name, sink) {
  return {
    name,
    append: (s) => sink.output.push(String(s)),
    appendLine: (s) => sink.output.push(String(s)),
    clear: () => { sink.output.length = 0; },
    show: () => { sink.channelsShown.push(name); },
    hide: () => {},
    replace: (s) => { sink.output.length = 0; sink.output.push(String(s)); },
    dispose: () => {}
  };
}

function makeStatusBarItem(sink) {
  return {
    text: '', tooltip: '', command: undefined, color: undefined, backgroundColor: undefined,
    name: undefined, accessibilityInformation: undefined, id: 'mock-status-' + sink.statusItems.length,
    show() { sink.statusItemShows++; }, hide() { sink.statusItemHides++; }, dispose() {}
  };
}

function makeWebviewPanel(sink, viewType, title) {
  const panel = {
    viewType,
    title,
    visible: true,
    active: true,
    viewColumn: 1,
    webview: {
      html: '',
      options: {},
      cspSource: 'vscode-resource://mock',
      asWebviewUri: (uri) => uri,
      postMessage: (msg) => { sink.postMessages.push({ title, msg }); return Promise.resolve(true); },
      onDidReceiveMessage: () => new Disposable(),
      onDidChangeVisibility: () => new Disposable(),
      onDidDispose: () => new Disposable()
    },
    onDidDispose: () => new Disposable(),
    onDidChangeViewState: () => new Disposable(),
    reveal: () => { sink.revealed.push(title); },
    dispose: () => { sink.disposedPanels.push(title); }
  };
  sink.panels.push(panel);
  return panel;
}

function makeMemento(sink, label) {
  const map = new Map();
  return {
    get(key, defaultValue) { return map.has(key) ? map.get(key) : defaultValue; },
    update(key, value) { if (value === undefined) map.delete(key); else map.set(key, value); return Promise.resolve(); },
    keys() { return Array.from(map.keys()); },
    setKeysForSync() {}
  };
}

function makeTerminal(sink) {
  return {
    name: 'mock-terminal',
    processId: Promise.resolve(1234),
    creationOptions: {},
    exitStatus: undefined,
    state: { isInterrupted: false },
    show() {}, hide() {}, dispose() {},
    sendText(text) { sink.terminalSent.push(String(text)); },
    shellIntegration: undefined
  };
}

// ────────────────────────────── mock factory ──────────────────────────────
function createMock() {
  const sink = {
    commands: new Map(),
    executed: [],
    messages: [],
    quickPicks: [],
    inputBoxes: [],
    openDialogs: [],
    panels: [],
    postMessages: [],
    revealed: [],
    disposedPanels: [],
    terminalSent: [],
    output: [],
    channelsShown: [],
    statusItems: [],
    statusItemShows: 0,
    statusItemHides: 0,
    openExternal: [],
    clipboard: [],
    configUpdates: [],
    warnings: []
  };

  const config = {
    get(key, def) { return def; },
    inspect(key) { return { key, defaultValue: undefined, globalValue: undefined, workspaceValue: undefined, workspaceFolderValue: undefined }; },
    has(section) { return false; },
    update(key, value, target) { sink.configUpdates.push({ key, value, target }); return Promise.resolve(); }
  };

  const windowApi = {
    activeTextEditor: undefined,
    visibleTextEditors: [],
    activeTerminal: undefined,
    terminals: [],
    showErrorMessage(message, ...items) { sink.messages.push({ kind: 'error', message, items }); return Promise.resolve(undefined); },
    showWarningMessage(message, ...items) { sink.messages.push({ kind: 'warning', message, items }); return Promise.resolve(undefined); },
    showInformationMessage(message, ...items) { sink.messages.push({ kind: 'info', message, items }); return Promise.resolve(undefined); },
    showQuickPick(items, options) { sink.quickPicks.push({ items, options }); return Promise.resolve(undefined); },
    showOpenDialog(options) { sink.openDialogs.push(options); return Promise.resolve(undefined); },
    showSaveDialog(options) { sink.openDialogs.push(options); return Promise.resolve(undefined); },
    showInputBox(options) { sink.inputBoxes.push(options); return Promise.resolve(undefined); },
    createOutputChannel(name) { return makeOutputChannel(name, sink); },
    createStatusBarItem(alignment, priority) { const it = makeStatusBarItem(sink); it.alignment = alignment; it.priority = priority; sink.statusItems.push(it); return it; },
    createWebviewPanel(viewType, title) { return makeWebviewPanel(sink, viewType, title); },
    createTerminal(nameOrOptions) { return makeTerminal(sink); },
    showTextDocument() { return Promise.resolve({}); },
    createTextEditorDecorationType() { return { dispose() {} }; },
    withProgress(options, task) { return Promise.resolve(task({ report() {} }, new CancellationTokenSource().token)); },
    registerWebviewViewProvider() { return new Disposable(); },
    registerUriHandler() { return new Disposable(); },
    onDidChangeActiveTextEditor() { return new Disposable(); },
    onDidChangeTextEditorSelection() { return new Disposable(); },
    onDidChangeVisibleTextEditors() { return new Disposable(); },
    onDidChangeWindowState() { return new Disposable(); },
    onDidCloseTerminal() { return new Disposable(); },
    setStatusBarMessage() { return new Disposable(); }
  };

  const workspaceApi = {
    workspaceFolders: [{ uri: Uri.file('/tmp/multihd-mock-workspace'), name: 'mock-workspace', index: 0 }],
    textDocuments: [],
    rootPath: '/tmp/multihd-mock-workspace',
    name: 'mock-workspace',
    getConfiguration(section) { return { get: (k, d) => config.get(section ? section + '.' + k : k, d), inspect: (k) => config.inspect(k), has: (k) => config.has(k), update: (k, v, t) => config.update(k, v, t) }; },
    onDidChangeConfiguration() { return new Disposable(); },
    onDidSaveTextDocument() { return new Disposable(); },
    onDidOpenTextDocument() { return new Disposable(); },
    onDidCloseTextDocument() { return new Disposable(); },
    onDidChangeWorkspaceFolders() { return new Disposable(); },
    onDidCreateFiles() { return new Disposable(); },
    onDidChangeTextDocument() { return new Disposable(); },
    getWorkspaceFolder() { return undefined; },
    asRelativePath(p) { return String(p); },
    findFiles() { return Promise.resolve([]); },
    openTextDocument() { return Promise.resolve({ getText: () => '', uri: Uri.file('/tmp/multihd-mock-workspace/file') }); },
    applyEdit() { return Promise.resolve(true); },
    fs: {
      readFile: () => Promise.resolve(Buffer.from('')),
      writeFile: () => Promise.resolve(),
      stat: () => Promise.resolve({ type: 1, ctime: 0, mtime: 0, size: 0 }),
      createDirectory: () => Promise.resolve(),
      readDirectory: () => Promise.resolve([])
    },
    workspaceState: makeMemento(sink, 'workspace'),
    globalState: makeMemento(sink, 'global'),
    registerTextDocumentContentProvider() { return new Disposable(); }
  };

  const commandsApi = {
    registerCommand(id, handler) {
      if (typeof id !== 'string' || typeof handler !== 'function') throw new TypeError('registerCommand(id, handler) bad args');
      sink.commands.set(id, handler);
      return new Disposable(() => sink.commands.delete(id));
    },
    executeCommand(id, ...args) {
      sink.executed.push({ id, args });
      const handler = sink.commands.get(id);
      if (!handler) return Promise.resolve(undefined);
      try { return Promise.resolve(handler(...args)); } catch (e) { return Promise.reject(e); }
    },
    getCommands() { return Promise.resolve(Array.from(sink.commands.keys())); },
    registerTextEditorCommand(id, handler) { return this.registerCommand(id, handler); }
  };

  const env = {
    openExternal(uri) { sink.openExternal.push(uri && (uri.toString ? uri.toString() : String(uri))); return Promise.resolve(true); },
    clipboard: { writeText: (t) => { sink.clipboard.push(String(t)); return Promise.resolve(); }, readText: () => Promise.resolve('') },
    machineId: 'mock-machine',
    sessionId: 'mock-session',
    appName: 'Visual Studio Code',
    appRoot: '/mock/vscode',
    language: 'en',
    uriScheme: 'vscode',
    remoteName: undefined,
    shell: '/bin/bash',
    isNewAppInstall: false,
    isTelemetryEnabled: false,
    onDidChangeTelemetryEnabled: () => new Disposable()
  };

  const vscode = {
    version: '1.80.0',
    Uri,
    Disposable,
    EventEmitter,
    ThemeColor,
    ThemeIcon,
    MarkdownString,
    CancellationTokenSource,
    Event: class { constructor(fn) { this.fn = fn; } },
    ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2, Three: 3 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
    ExtensionMode: { Production: 1, Development: 2, Test: 3 },
    FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
    LogLevel: { Off: 0, Trace: 1, Debug: 2, Info: 3, Warning: 4, Error: 5 },
    window: windowApi,
    workspace: workspaceApi,
    commands: commandsApi,
    env,
    languages: {
      createDiagnosticCollection() { return { set() {}, delete() {}, clear() {}, dispose() {} }; },
      registerCompletionItemProvider() { return new Disposable(); },
      registerCodeActionsProvider() { return new Disposable(); }
    },
    extensions: { getExtension: () => undefined, all: [] },
    tasks: { registerTaskProvider() { return new Disposable(); }, executeTask() { return Promise.resolve({}); } },
    debug: { registerDebugConfigurationProvider() { return new Disposable(); } },
    l10n: { t: (s) => s }
  };

  return { vscode, sink, config };
}

/**
 * Install the mock so that `require('vscode')` inside the extension resolves to it.
 * Returns { vscode, sink, restore }.
 */
function installMock() {
  const mock = createMock();
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'vscode') return mock.vscode;
    return origLoad.apply(this, arguments);
  };
  return Object.assign(mock, { restore() { Module._load = origLoad; } });
}

module.exports = { createMock, installMock, Uri };
