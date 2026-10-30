// ─────────────────────────────────────────────────────────────────────────────
// MultiHD Launcher — shared webview foundation (dark cyber theme)
// Owner: writer-ui. See multihd-port/CONTRACT.md §2 (palette), §7.3 (host APIs),
// §8 F11 (theme acceptance). This module owns:
//   • palette tokens + the shared stylesheet (30px grid, cyan brackets, glow)
//   • HTML helpers (escaping, JSON embedding, logo / subtitle / title / group)
//   • the CSP-safe panel factory + registry (one live panel per key)
//   • webview ⇄ extension plumbing (Escape closes the panel, message routing)
//
// Panels NEVER import fs/child_process and never read files themselves — every
// side effect is delegated to a host interface declared in ./api.ts.
// ─────────────────────────────────────────────────────────────────────────────
import * as vscode from 'vscode';

// ── Palette (literal values from the Qt QSS — mainwindow.cpp / *dialog.cpp) ──
export const PALETTE = {
  bg: '#0d0d1a',
  panel: '#131326',
  logBg: '#080812',
  border: '#1a1a3a',
  border2: '#1a2a3a',
  border3: '#223344',
  cyan: '#00e5ff',
  cyanFocus: '#00ffcc',
  green: '#00ff88',
  green2: '#88ff88',
  orange: '#ffaa00',
  red: '#ff4444',
  redText: '#cc6666',
  redBorder: '#cc4444',
  redDeep: '#552222',
  purple: '#aaaaff',
  purple2: '#bb88ff',
  libBlue: '#88ddff',
  libBorder: '#44aacc',
  muted: '#446688',
  muted2: '#8899bb',
  dim: '#334455',
  dimmer: '#223344',
  text: '#e0e0e0',
  mono: "'Courier New', Courier, monospace",
} as const;

/** Brand line displayed under the logo in the launcher panel. */
export const SUBTITLE_TEXT = 'QUESTA FSE  •  QUARTUS PRIME  •  GOWIN EDA';

const LOGO_RELATIVE_PATH = ['images', 'multihd_launcher.svg'] as const;

// ── Small value / escaping helpers ───────────────────────────────────────────

/** HTML-escape any value for safe interpolation into a webview document. */
export function esc(value: unknown): string {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Narrow unknown webview payload values to strings. */
export function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Narrow unknown webview payload values to booleans. */
export function bool(value: unknown): boolean {
  return value === true;
}

/** Narrow unknown webview payload values to an array of strings. */
export function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}

/** Normalise any thrown value into a human readable message. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/** Serialise a value for safe embedding inside a <script> block. */
export function jsonForScript(value: unknown): string {
  const json = JSON.stringify(value === undefined ? null : value) ?? 'null';
  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Random CSP nonce for the panel scripts. */
export function randomNonce(): string {
  const alphabet = 'abcdef0123456789';
  let out = '';
  for (let i = 0; i < 32; i += 1) {
    out += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return out;
}

// ── Webview ⇄ extension message plumbing ─────────────────────────────────────

/** Raw message shape posted by a panel webview. */
export interface WebviewMessage {
  type: string;
  [key: string]: unknown;
}

/** Everything a panel needs to build a CSP-safe document. */
export interface PanelEnv {
  nonce: string;
  cspSource: string;
  /** webview-safe URI for images/multihd_launcher.svg */
  logoUri: string;
}

/** A panel's renderable payload. */
export interface PanelContent {
  body: string;
  script?: string;
  css?: string;
}

export interface CyberPanelSpec {
  /** Stable key — a single live panel exists per key. */
  key: string;
  /** Webview tab title. */
  title: string;
  /** Optional preferred column; defaults to Beside when an editor is open. */
  column?: vscode.ViewColumn;
  /** Rebuild the document when an already-open panel is revealed. */
  reloadOnShow?: boolean;
  build(env: PanelEnv): PanelContent;
  onMessage?(message: WebviewMessage, handle: CyberPanelHandle): void | Promise<void>;
  onDispose?(): void;
}

export interface CyberPanelHandle {
  readonly panel: vscode.WebviewPanel;
  readonly key: string;
  readonly title: string;
  readonly disposed: boolean;
  reveal(): void;
  /** Re-render the whole document (fresh nonce + HTML built from current state). */
  reload(): void;
  /** Post a message to the webview; silently ignored once disposed. */
  post(message: unknown): void;
  dispose(): void;
}

// ── Shared dark-cyber stylesheet ─────────────────────────────────────────────
// Palette, 30px grid overlay, 40px cyan corner brackets, glow, monospace type.
// Every panel reuses these tokens/classes; panels may append a small `css`
// fragment for anything genuinely panel-specific.
export const BASE_CSS = `
:root{
  --bg:#0d0d1a; --panel:#131326; --log-bg:#080812;
  --border:#1a1a3a; --border-2:#1a2a3a; --border-3:#223344;
  --cyan:#00e5ff; --cyan-focus:#00ffcc;
  --green:#00ff88; --green-2:#88ff88;
  --orange:#ffaa00;
  --red:#ff4444; --red-text:#cc6666; --red-border:#cc4444; --red-deep:#552222;
  --purple:#aaaaff; --purple-2:#bb88ff;
  --lib-blue:#88ddff; --lib-border:#44aacc;
  --muted:#446688; --muted-2:#8899bb; --dim:#334455; --dimmer:#223344;
  --text:#e0e0e0;
  --mono:'Courier New', Courier, monospace;
}
*{box-sizing:border-box;margin:0;padding:0;}
html,body{min-height:100%;}
body{
  background-color:var(--bg);
  color:var(--text);
  font-family:var(--mono);
  font-size:12px;
  line-height:1.45;
  padding:16px 14px 24px;
  background-image:
    repeating-linear-gradient(0deg, rgba(0,229,255,.047) 0 1px, transparent 1px 30px),
    repeating-linear-gradient(90deg, rgba(0,229,255,.047) 0 1px, transparent 1px 30px);
  background-attachment:fixed;
  -webkit-font-smoothing:antialiased;
}
::selection{background:rgba(0,229,255,.25);color:#fff;}
::-webkit-scrollbar{width:6px;height:6px;}
::-webkit-scrollbar-track{background:var(--bg);}
::-webkit-scrollbar-thumb{background:var(--border-3);border-radius:3px;}
::-webkit-scrollbar-thumb:hover{background:var(--muted);}

/* ── window frame + cyan corner brackets (Qt paintEvent parity) ── */
.frame{
  position:relative;
  width:100%;
  max-width:640px;
  margin:0 auto;
  padding:12px;
}
.frame .corner{
  position:absolute;
  width:40px;height:40px;
  border:0 solid rgba(0,229,255,.47);
  pointer-events:none;
  filter:drop-shadow(0 0 6px rgba(0,229,255,.45));
}
.frame .corner.tl{top:0;left:0;border-top-width:2px;border-left-width:2px;}
.frame .corner.tr{top:0;right:0;border-top-width:2px;border-right-width:2px;}
.frame .corner.bl{bottom:0;left:0;border-bottom-width:2px;border-left-width:2px;}
.frame .corner.br{bottom:0;right:0;border-bottom-width:2px;border-right-width:2px;}

/* ── card ── */
.card{
  position:relative;
  display:flex;
  flex-direction:column;
  gap:10px;
  padding:16px 18px 18px;
  border:1px solid rgba(0,229,255,.13);
  border-radius:10px;
  background:linear-gradient(180deg, rgba(19,19,38,.92), rgba(13,13,26,.94));
  box-shadow:0 0 60px rgba(0,180,255,.10), inset 0 0 60px rgba(0,229,255,.02);
}
.card>*{min-width:0;}

/* ── branding ── */
.brand{display:flex;flex-direction:column;align-items:center;gap:5px;padding:2px 0 0;}
.brand img.logo{
  width:64px;height:64px;display:block;
  filter:drop-shadow(0 0 12px rgba(0,180,255,.6));
}
.subtitle{
  color:var(--muted);
  font-size:10px;
  letter-spacing:2px;
  text-align:center;
  white-space:pre-wrap;
}
.icon-btn{
  position:absolute;top:10px;right:12px;
  width:24px;height:24px;line-height:1;
  background:transparent;border:1px solid var(--border-3);border-radius:5px;
  color:var(--muted-2);font-family:var(--mono);font-size:12px;cursor:pointer;
  transition:color .15s,border-color .15s,background .15s;
}
.icon-btn:hover{color:var(--cyan);border-color:var(--cyan);background:rgba(0,229,255,.07);}

/* ── titles / separators / hints ── */
.title{
  color:var(--cyan);font-size:13px;font-weight:bold;letter-spacing:1px;
  text-align:center;white-space:pre-wrap;
}
.title-lg{font-size:14px;letter-spacing:2px;}
.title-gowin{color:var(--green-2);font-size:13px;font-weight:bold;letter-spacing:2px;text-align:center;white-space:pre-wrap;}
.heading{color:var(--cyan);font-size:15px;font-weight:bold;letter-spacing:3px;text-align:center;white-space:pre-wrap;}
.sep{height:1px;background:var(--border);border:0;}
.hint{color:var(--dim);font-size:10px;line-height:1.5;}
.hint.center{text-align:center;}
.section-hint{color:var(--dim);font-size:10px;line-height:1.5;}
.env-note{color:var(--dim);font-size:10px;line-height:1.5;}

/* ── license badge (Qt QLabel#licOk / #licBad) ── */
.badge{
  display:block;text-align:center;
  font-size:10px;font-weight:bold;
  padding:3px 8px;border-radius:4px;border:1px solid;
  white-space:pre-wrap;
}
.badge.ok{color:var(--green);border-color:var(--green);background:#001a0a;}
.badge.warn{color:var(--red);border-color:var(--red);background:#1a0000;}

/* ── inputs ── */
input[type=text],input[type=password],textarea,select{
  width:100%;
  background:var(--panel);
  color:var(--cyan);
  border:1px solid var(--cyan);
  border-radius:6px;
  padding:6px 10px;
  font-family:var(--mono);
  font-size:12px;
  outline:none;
  transition:border-color .15s,box-shadow .15s;
}
input[type=text]::placeholder,textarea::placeholder{color:#2a4a66;}
input[type=text]:focus,textarea:focus,select:focus{border-color:var(--cyan-focus);box-shadow:0 0 0 1px rgba(0,255,204,.18);}
input.invalid{border-color:var(--red);color:#ff6666;}
textarea{resize:vertical;line-height:1.5;color:var(--cyan);}
select{
  appearance:none;-webkit-appearance:none;
  background-image:linear-gradient(45deg,transparent 50%,#00e5ff 50%),linear-gradient(135deg,#00e5ff 50%,transparent 50%);
  background-position:calc(100% - 15px) 50%,calc(100% - 10px) 50%;
  background-size:5px 5px,5px 5px;
  background-repeat:no-repeat;
  padding-right:28px;
  cursor:pointer;
}
select option{background:#131326;color:#00e5ff;font-family:var(--mono);}

/* ── buttons ── */
.btn{
  display:inline-flex;align-items:center;justify-content:center;
  gap:4px;
  font-family:var(--mono);
  font-size:12px;
  padding:6px 14px;
  background-color:transparent;
  border-radius:6px;
  border:1px solid;
  cursor:pointer;
  white-space:pre;
  transition:background .15s,border-color .15s,color .15s,box-shadow .15s;
}
.btn:disabled{opacity:.42;cursor:not-allowed;}
.btn-cyan{color:var(--cyan);border-color:var(--cyan);}
.btn-cyan:hover{background:rgba(0,229,255,.13);}
.btn-orange{color:var(--orange);border-color:var(--orange);}
.btn-orange:hover{background:rgba(255,170,0,.13);}
.btn-red{color:var(--red-text);border-color:var(--red-border);}
.btn-red:hover{background:rgba(204,68,68,.10);}
.btn-purple{color:var(--purple);border-color:var(--purple);}
.btn-purple:hover{background:rgba(170,170,255,.09);}
.btn-purple2{color:var(--purple-2);border-color:var(--purple-2);}
.btn-purple2:hover{background:rgba(187,136,255,.13);}
.btn-lib{color:var(--lib-blue);border-color:var(--lib-border);}
.btn-lib:hover{background:rgba(68,170,204,.09);}
.btn-green{color:var(--green);border-color:var(--green);}
.btn-green:hover{background:rgba(0,255,136,.13);}
.btn-gowin{color:var(--green-2);border-color:#44aa44;}
.btn-gowin:hover{background:rgba(68,170,68,.13);}
.btn-ghost{color:#556688;border-color:var(--border-3);}
.btn-ghost:hover{color:var(--muted-2);border-color:var(--muted);}
.btn-browse{flex:0 0 auto;min-width:80px;font-size:12px;padding:6px 14px;}
.btn-mini{font-size:10px;padding:3px 8px;border-radius:5px;}
.btn-restore{
  flex:0 0 auto;
  background:#1a0000;color:#ff6666;
  border:1px solid var(--red-deep);border-radius:4px;
  font-size:10px;padding:2px 7px;line-height:1.2;
}
.btn-restore:hover{background:#330000;border-color:var(--red-border);color:#ffaaaa;}
.btn-save{
  background:linear-gradient(90deg,#0057a8,#00b4d8);
  color:#fff;border:none;border-radius:7px;
  font-size:13px;font-weight:bold;letter-spacing:1px;
  padding:9px 0;
}
.btn-save:hover{background:linear-gradient(90deg,#0070cc,#00d4f0);}
.btn-save:active{background:#003d7a;}
.btn-save-gowin{
  background:linear-gradient(90deg,#1a5a1a,#228822);
  color:#fff;border:none;border-radius:7px;
  font-size:13px;font-weight:bold;letter-spacing:1px;
  padding:9px 0;
}
.btn-save-gowin:hover{background:linear-gradient(90deg,#226622,#33aa33);}
.btn-launch{
  width:100%;
  height:46px;
  background:linear-gradient(90deg,#0057a8,#00b4d8);
  color:#fff;
  border:none;border-radius:8px;
  font-size:15px;font-weight:bold;letter-spacing:1px;
  padding:0;
  box-shadow:0 0 20px rgba(0,180,255,.6);
}
.btn-launch:hover:not(:disabled){background:linear-gradient(90deg,#0070cc,#00d4f0);}
.btn-launch:active:not(:disabled){background:#003d7a;box-shadow:none;}
.btn-launch.warn{
  background:linear-gradient(90deg,#7a0000,#cc2200);
  font-size:14px;
  box-shadow:0 0 20px rgba(255,60,0,.45);
}
.btn-launch.warn:hover:not(:disabled){background:linear-gradient(90deg,#990000,#ee3300);}
.btn-launch:disabled{box-shadow:none;}
.order-set{color:var(--green) !important;border-color:var(--green) !important;}

/* ── layout helpers ── */
.row{display:flex;align-items:center;gap:8px;min-width:0;}
.row.wrap{flex-wrap:wrap;}
.col{display:flex;flex-direction:column;gap:8px;}
.grow{flex:1 1 auto;min-width:0;}
.spacer{flex:1 1 auto;}
.path-row{display:flex;align-items:stretch;gap:8px;}
.path-row input{flex:1 1 auto;min-width:0;}
.actions{display:flex;gap:6px;flex-wrap:wrap;}
.actions .btn{flex:1 1 0;min-width:98px;height:34px;padding:0 8px;font-size:11px;}
.actions .btn-config{flex:0 0 110px;}
.btn-row{display:flex;gap:10px;margin-top:2px;}
.btn-row .btn-cancel{flex:1 1 0;height:38px;}
.btn-row .btn-save{flex:2 1 0;height:38px;}

/* ── group box (Qt QGroupBox) ── */
.group{
  position:relative;
  border:1px solid var(--border);
  border-radius:6px;
  padding:12px 10px 9px;
  margin-top:8px;
  min-width:0;
}
.group.danger{border-color:#331111;}
.group.gowin{border-color:#1a2a1a;}
.group.project{border-color:#1a3a1a;}
.group-title{
  position:absolute;top:-7px;left:8px;
  padding:0 4px;
  background:var(--bg);
  color:var(--muted);
  font-size:10px;
  letter-spacing:1px;
  white-space:pre;
}
.group.gowin .group-title{color:#446644;}

/* ── excluded-file chips (Qt chip panel) ── */
.chips{
  display:flex;flex-direction:column;gap:2px;
  max-height:72px;overflow-y:auto;
  padding:1px 0;
}
.chip-row{display:flex;align-items:center;gap:6px;min-height:20px;}
.chip-name{
  flex:1 1 auto;min-width:0;
  color:#ff6666;font-size:10px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.no-excl{color:var(--dimmer);font-size:10px;padding:2px 4px;}

/* ── compile-for checkboxes (Qt QCheckBox rules) ── */
.compile-for{display:flex;align-items:center;gap:24px;flex-wrap:wrap;padding:2px 4px 0;}
.chk{display:inline-flex;align-items:center;gap:7px;font-size:11px;cursor:pointer;user-select:none;white-space:nowrap;}
.chk input{
  appearance:none;-webkit-appearance:none;
  flex:0 0 auto;
  width:14px;height:14px;
  border-radius:3px;
  border:1px solid currentColor;
  background:var(--bg);
  cursor:pointer;
  position:relative;
}
.chk input:checked{background:#0057a8;}
.chk.questa{color:var(--cyan);}
.chk.quartus{color:var(--orange);}
.chk.quartus input:checked{background:#7a4400;}
.chk.gowin{color:var(--green-2);}
.chk.gowin input{border-color:#44aa44;}
.chk.gowin input:checked{background:#1a4a1a;border-color:var(--green-2);}

/* ── install row ── */
.install-row{display:flex;gap:10px;flex-wrap:wrap;}
.install-row .btn{flex:1 1 0;height:34px;min-width:150px;}

/* ── log (Qt QTextEdit) ── */
.log{
  background:var(--log-bg);
  border:1px solid var(--border);
  border-radius:6px;
  padding:6px 8px;
  min-height:88px;
  max-height:190px;
  overflow-y:auto;
  font-family:var(--mono);
  font-size:11px;
  color:var(--cyan);
  white-space:pre-wrap;
  word-break:break-word;
}
.log .placeholder{color:var(--dimmer);}
.log .log-line{white-space:pre-wrap;word-break:break-word;}
.l-cyan{color:var(--cyan);}
.l-green{color:var(--green);}
.l-red{color:var(--red);}
.l-orange{color:var(--orange);}
.l-purple{color:var(--purple-2);}
.l-muted{color:var(--muted);}
.l-dim{color:var(--dim);}
.l-red-text{color:var(--red-text);}

/* ── config panel ── */
.form-grid{
  display:grid;
  grid-template-columns:132px minmax(0,1fr) auto;
  gap:6px 8px;
  align-items:center;
}
.form-grid.env{grid-template-columns:132px minmax(0,1fr);}
.field-label{
  color:var(--muted-2);
  font-size:11px;
  text-align:right;
  white-space:pre;
}
.banner{
  border:1px solid;
  border-radius:6px;
  padding:7px 10px;
  font-size:11px;
  font-weight:bold;
  text-align:center;
  line-height:1.5;
  white-space:pre-wrap;
}
.banner.warn{color:var(--red);border-color:var(--red);background:#1a0000;}
.banner.ok{color:var(--green);border-color:var(--green);background:#001a0a;}

/* ── generic file checklist (exclude / project deps) ── */
.checklist{
  background:var(--log-bg);
  border:1px solid var(--border);
  border-radius:6px;
  padding:5px;
  max-height:340px;
  overflow-y:auto;
  display:flex;flex-direction:column;gap:1px;
}
.checklist.short{max-height:200px;}
.file-row{
  display:flex;align-items:center;gap:9px;
  padding:5px 7px;
  border-radius:3px;
  cursor:pointer;
  font-size:12px;
  user-select:none;
}
.file-row:hover{background:var(--border);}
.file-row input[type=checkbox]{
  appearance:none;-webkit-appearance:none;
  flex:0 0 auto;
  width:13px;height:13px;
  border:1px solid var(--cyan);border-radius:3px;
  background:var(--bg);cursor:pointer;
}
.file-row input[type=checkbox]:checked{background:#0057a8;border-color:var(--cyan);}
.file-row .file-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.file-row.excluded .file-name{color:var(--red-border);}
.file-row .dep-badge{flex:0 0 auto;font-size:10px;color:var(--orange);}
.toolbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.count-line{color:var(--muted);font-size:10px;}

/* ── priority / compile-order panel ── */
.prio-list{
  background:var(--log-bg);
  border:1px solid var(--border);
  border-radius:6px;
  padding:4px;
  max-height:420px;
  overflow-y:auto;
  display:flex;flex-direction:column;gap:1px;
}
.prio-row{
  display:flex;align-items:center;gap:10px;
  padding:7px 10px;
  border-bottom:1px solid var(--border);
  border-radius:4px;
  cursor:pointer;
  font-size:12px;
  user-select:none;
  transition:background .12s;
}
.prio-row:hover{background:rgba(0,229,255,.09);}
.prio-row.selected{color:var(--green);}
.prio-row.unselected{color:var(--muted);}
.prio-row.dragging{opacity:.35;}
.prio-row.drop-before{box-shadow:inset 0 2px 0 0 var(--cyan);}
.prio-row.drop-after{box-shadow:inset 0 -2px 0 0 var(--cyan);}
.prio-index{flex:0 0 auto;color:inherit;white-space:pre;}
.prio-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.prio-tools{flex:0 0 auto;display:flex;gap:2px;opacity:0;transition:opacity .12s;}
.prio-row:hover .prio-tools{opacity:1;}
.prio-move{
  width:20px;height:18px;line-height:1;
  background:transparent;border:1px solid var(--border-3);border-radius:3px;
  color:var(--muted-2);font-size:9px;cursor:pointer;padding:0;
}
.prio-move:hover{color:var(--cyan);border-color:var(--cyan);}

/* ── Gowin CST editor ── */
.cst-editor{
  background:var(--log-bg);
  color:var(--green-2);
  border:1px solid #224422;
  border-radius:6px;
  min-height:300px;
  padding:8px;
  font-family:var(--mono);
  font-size:11px;
  line-height:1.5;
}
.cst-editor:focus{border-color:#44aa44;box-shadow:0 0 0 1px rgba(68,170,68,.2);}
.device-combo,.device-combo option{color:var(--green-2);font-family:var(--mono);white-space:pre;}
.device-combo{border-color:#44aa44;width:100%;}
.custom-row{display:grid;grid-template-columns:150px minmax(0,1fr);gap:6px 8px;align-items:center;margin-top:8px;}
.custom-row.hidden{display:none;}
.cst-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.cst-actions .btn{height:34px;}
.cst-actions .btn-detect{flex:0 1 auto;}

/* ── library manager ── */
.lib-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;align-items:start;}
@media (max-width:760px){.lib-grid{grid-template-columns:minmax(0,1fr);} }
.lib-list{
  background:var(--log-bg);
  border:1px solid var(--border);
  border-radius:6px;
  padding:4px;
  min-height:150px;
  max-height:230px;
  overflow-y:auto;
  display:flex;flex-direction:column;gap:2px;
}
.lib-row{
  display:flex;flex-direction:column;gap:2px;
  padding:5px 7px;border-radius:3px;cursor:pointer;
  border:1px solid transparent;
}
.lib-row:hover{background:var(--border);}
.lib-row.selected{background:var(--border-2);border-color:var(--lib-border);}
.lib-row-top{display:flex;align-items:baseline;gap:7px;min-width:0;}
.lib-badge{flex:0 0 auto;white-space:pre;}
.lib-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.lib-status{flex:0 0 auto;font-size:10px;}
.lib-row.compiled .lib-badge,.lib-row.compiled .lib-name{color:var(--green);}
.lib-row.compiled .lib-status{color:var(--green);}
.lib-row.pending .lib-badge,.lib-row.pending .lib-name{color:#888888;}
.lib-row.pending .lib-status{color:var(--orange);}
.lib-meta{color:var(--muted);font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.lib-empty{color:var(--dim);font-size:10px;padding:4px 6px;}
.add-form{display:flex;flex-direction:column;gap:6px;margin-top:8px;}
.lib-actions{display:flex;gap:8px;margin-top:8px;}
.lib-actions .btn{flex:1 1 0;height:30px;font-size:11px;padding:0 8px;}
.status{color:var(--green);font-size:11px;padding:2px 6px;min-height:18px;white-space:pre-wrap;}
.status.error{color:var(--red);}
.status.busy{color:var(--orange);}
.dep-list{
  background:var(--log-bg);
  border:1px solid var(--border);
  border-radius:6px;
  padding:5px;
  max-height:200px;
  overflow-y:auto;
  display:flex;flex-direction:column;gap:1px;
  margin-top:4px;
}

/* ── misc ── */
.hidden{display:none !important;}
.mt-2{margin-top:8px;}
`;

// ── Reusable HTML building blocks ────────────────────────────────────────────

/** Logo image bound to the extension's bundled SVG. */
export function logoImg(env: PanelEnv, alt = 'MultiHD Launcher'): string {
  return `<img class="logo" src="${esc(env.logoUri)}" alt="${esc(alt)}">`;
}

/** Logo + brand subtitle, used by the launcher panel. */
export function brandBlock(env: PanelEnv): string {
  return `<div class="brand">${logoImg(env)}<div class="subtitle">${esc(SUBTITLE_TEXT)}</div></div>`;
}

/** Horizontal rule matching the Qt `QFrame::HLine` separators. */
export function separator(): string {
  return '<hr class="sep">';
}

/** Centered panel title; text is escaped but multi-space padding survives. */
export function panelTitle(label: string, className = 'title'): string {
  return `<div class="${esc(className)}">${esc(label)}</div>`;
}

/** Qt-style group box with a floating title. */
export function groupBox(title: string, inner: string, className = ''): string {
  const extra = className ? ` ${className}` : '';
  return (
    `<div class="group${extra}">` +
    `<span class="group-title">${esc(title)}</span>` +
    inner +
    '</div>'
  );
}

// ── Document shell (CSP with nonce; Escape closes the panel) ─────────────────

/**
 * Render the full webview document. All panel scripts run as nonce'd classic
 * scripts (no inline event handlers anywhere). The shell also:
 *   • exposes `const vscode = acquireVsCodeApi();`
 *   • posts `{type:'__close'}` when the user presses Escape
 *   • forwards host messages to `window.__onHostMessage(message)` (panel script)
 */
export function renderDocument(title: string, env: PanelEnv, content: PanelContent): string {
  const extraCss = content.css ? `\n${content.css}` : '';
  const script = content.script ?? '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${env.cspSource} data:; style-src ${env.cspSource} 'unsafe-inline'; font-src ${env.cspSource}; script-src 'nonce-${env.nonce}';">
<title>${esc(title)}</title>
<style>
${BASE_CSS}
${extraCss}
</style>
</head>
<body>
<div class="frame">
  <span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>
  <div class="card">
${content.body}
  </div>
</div>
<script nonce="${env.nonce}">
const vscode = acquireVsCodeApi();
window.__onHostMessage = null;
document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape') {
    vscode.postMessage({ type: '__close' });
  }
});
window.addEventListener('message', function (event) {
  var message = (event && event.data) || {};
  if (typeof window.__onHostMessage === 'function') {
    window.__onHostMessage(message);
  }
});
${script}
</script>
</body>
</html>`;
}

// ── Panel factory / single-instance registry ─────────────────────────────────

const panelRegistry = new Map<string, CyberPanelHandle>();

function normaliseMessage(raw: unknown): WebviewMessage {
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    return { ...record, type: typeof record.type === 'string' ? record.type : '' };
  }
  return { type: '' };
}

class CyberPanelHandleImpl implements CyberPanelHandle {
  private disposedFlag = false;
  private cleanedUp = false;
  private readonly messageSub: vscode.Disposable;
  private readonly disposeSub: vscode.Disposable;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly spec: CyberPanelSpec,
    private readonly panelRef: vscode.WebviewPanel
  ) {
    this.messageSub = panelRef.webview.onDidReceiveMessage((raw: unknown) => {
      void this.routeMessage(raw);
    });
    this.disposeSub = panelRef.onDidDispose(() => {
      this.cleanup();
    });
    this.render();
  }

  get panel(): vscode.WebviewPanel {
    return this.panelRef;
  }

  get key(): string {
    return this.spec.key;
  }

  get title(): string {
    return this.spec.title;
  }

  get disposed(): boolean {
    return this.disposedFlag;
  }

  reveal(): void {
    if (this.disposedFlag) {
      return;
    }
    try {
      this.panelRef.reveal(this.panelRef.viewColumn ?? vscode.ViewColumn.Active, false);
    } catch {
      // The panel may have been moved/closed between checks — ignore.
    }
  }

  reload(): void {
    if (!this.disposedFlag) {
      this.render();
    }
  }

  post(message: unknown): void {
    if (this.disposedFlag) {
      return;
    }
    void this.panelRef.webview.postMessage(message);
  }

  dispose(): void {
    if (this.disposedFlag) {
      return;
    }
    this.disposedFlag = true;
    this.cleanup();
    this.panelRef.dispose();
  }

  private async routeMessage(raw: unknown): Promise<void> {
    const message = normaliseMessage(raw);
    if (message.type === '__close') {
      this.dispose();
      return;
    }
    if (!this.spec.onMessage) {
      return;
    }
    try {
      await this.spec.onMessage(message, this);
    } catch (error) {
      this.post({ type: 'hostError', text: errorMessage(error) });
    }
  }

  private render(): void {
    const nonce = randomNonce();
    const logoUri = this.panelRef.webview
      .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, ...LOGO_RELATIVE_PATH))
      .toString();
    const env: PanelEnv = {
      nonce,
      cspSource: this.panelRef.webview.cspSource,
      logoUri,
    };
    const content = this.spec.build(env);
    this.panelRef.webview.html = renderDocument(this.spec.title, env, content);
  }

  private cleanup(): void {
    this.disposedFlag = true;
    if (this.cleanedUp) {
      return;
    }
    this.cleanedUp = true;
    if (panelRegistry.get(this.spec.key) === this) {
      panelRegistry.delete(this.spec.key);
    }
    this.messageSub.dispose();
    this.disposeSub.dispose();
    try {
      this.spec.onDispose?.();
    } catch {
      // Disposal hooks must never mask a panel teardown.
    }
  }
}

/**
 * Open (or reveal) the single panel registered under `spec.key`.
 * A new CSP nonce and a fresh document are generated on every creation/reload.
 */
export function openCyberPanel(
  context: vscode.ExtensionContext,
  spec: CyberPanelSpec
): CyberPanelHandle {
  const existing = panelRegistry.get(spec.key);
  if (existing && !existing.disposed) {
    if (spec.reloadOnShow) {
      existing.reload();
    }
    existing.reveal();
    return existing;
  }
  const column =
    spec.column ??
    (vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active);
  const panel = vscode.window.createWebviewPanel(spec.key, spec.title, column, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'images')],
  });
  const handle = new CyberPanelHandleImpl(context, spec, panel);
  panelRegistry.set(spec.key, handle);
  return handle;
}

/** Look up a live panel by key (undefined once disposed). */
export function getCyberPanel(key: string): CyberPanelHandle | undefined {
  const handle = panelRegistry.get(key);
  return handle && !handle.disposed ? handle : undefined;
}

/** Dispose a panel by key if it is open. */
export function disposeCyberPanel(key: string): void {
  const handle = panelRegistry.get(key);
  if (handle) {
    handle.dispose();
  }
}

/** True when a panel for `key` is currently open. */
export function isCyberPanelOpen(key: string): boolean {
  return getCyberPanel(key) !== undefined;
}

