// ─────────────────────────────────────────────────────────────────────────────
// MultiHD Launcher — Gowin Constraints (.cst) panel (Qt `GowinCstDialog`)
// Owner: writer-ui. CONTRACT.md §7.3 (CstHost), §8 F8.
//
// Device combo uses the exact Qt table (6 known devices + `Custom device …`),
// ports are auto-detected in the webview from the host-provided top-file source
// (Qt regex: comments stripped, direction grouping Inputs/Outputs/Bidirectional),
// and the template is regenerated whenever the device changes — mirroring
// /home/bismillah/QuestaLauncher/gowincstdialog.cpp. SAVE sends
// `{cst, device, pn}` to the host (which writes .cst/.f/.gprj).
// ─────────────────────────────────────────────────────────────────────────────
import * as vscode from 'vscode';
import { CstHost } from './api';
import {
  CyberPanelHandle,
  PanelContent,
  WebviewMessage,
  errorMessage,
  esc,
  groupBox,
  jsonForScript,
  openCyberPanel,
  separator,
  text,
} from './base';

const PANEL_KEY = 'multihdLauncher.cstPanel';
const PANEL_TITLE = 'MultiHD Launcher — Gowin Constraints (.cst)';

const CUSTOM_LABEL = 'Custom device …';
const DEFAULT_DEVICE = 'GW1NR-LV9QN88PC6/I5';

/** Exact Qt device table (gowincstdialog.cpp:79-92). */
interface GowinDeviceDef {
  label: string;
  name: string;
  pn: string;
}

const GOWIN_DEVICES: GowinDeviceDef[] = [
  { label: 'GW1NR-9  (Tang Nano 9K)', name: 'GW1NR-LV9QN88PC6/I5', pn: 'GW1NR-LV9QN88PC6/I5' },
  { label: 'GW1N-1   (Tang Nano 1K)', name: 'GW1N-LV1QN48C6/I5', pn: 'GW1N-LV1QN48C6/I5' },
  { label: 'GW1NSR-4 (Tang Nano 4K)', name: 'GW1NSR-LV4CQN48PC7/I6', pn: 'GW1NSR-LV4CQN48PC7/I6' },
  { label: 'GW2AR-18 (Tang Nano 20K)', name: 'GW2AR-LV18QN88C8/I7', pn: 'GW2AR-LV18QN88C8/I7' },
  { label: 'GW1N-4   (Tang Primer 4K)', name: 'GW1N-LV4LQ144C6/I5', pn: 'GW1N-LV4LQ144C6/I5' },
  { label: 'GW5A-25  (Tang Primer 25K)', name: 'GW5A-LV25MG121NES', pn: 'GW5A-LV25MG121NES' },
];

const CUSTOM_INDEX = GOWIN_DEVICES.length;

// Regex sources are kept in TS and injected as JSON strings so the webview
// rebuilds them with `new RegExp(...)` — no fragile double escaping in HTML.
const BLOCK_COMMENT_PATTERN = '/\\*[\\s\\S]*?\\*/';
const LINE_COMMENT_PATTERN = '//[^\\n]*';
const PORT_PATTERN = String.raw`\b(input|output|inout)\s+(?:wire|logic|reg|signed|unsigned)?\s*(\[\s*[\w\s+\-*:/]+\s*:\s*[\w\s+\-*:/]+\s*\])?\s*(\w+)\s*(?:[,;)])`;
const PORT_KEYWORDS = [
  'module',
  'endmodule',
  'begin',
  'end',
  'if',
  'else',
  'always',
  'assign',
  'wire',
  'logic',
  'reg',
  'parameter',
  'localparam',
  'integer',
  'real',
];

const EDITOR_PLACEHOLDER = [
  "// Click 'Auto-detect ports' to generate a constraint template",
  '// from the top-module .sv file, then fill in the LOC numbers.',
  '//',
  '// Example:',
  '//   IO_LOC "clk"    52 ;',
  '//   IO_PORT "clk"   PULL_MODE=UP DRIVE=8 IOSTD=LVCMOS33 ;',
].join('\n');

const EXTRA_CSS = `
.device-row{display:flex;align-items:center;gap:10px;}
.device-row .field-label{flex:0 0 auto;}
.cst-actions .btn-cancel{flex:0 0 auto;width:90px;}
.cst-actions .btn-save-cst{flex:0 0 auto;width:140px;}
`;

let activeHost: CstHost | undefined;

function requireHost(): CstHost {
  if (!activeHost) {
    throw new Error('MultiHD Launcher Gowin CST host is not available.');
  }
  return activeHost;
}

interface ResolvedDevice {
  index: number;
  name: string;
  pn: string;
}

function resolveDevice(device: string, pn: string): ResolvedDevice {
  const wanted = device.trim();
  const wantedPn = pn.trim();
  if (!wanted) {
    return { index: 0, name: GOWIN_DEVICES[0].name, pn: GOWIN_DEVICES[0].pn };
  }
  for (let i = 0; i < GOWIN_DEVICES.length; i += 1) {
    if (GOWIN_DEVICES[i].name === wanted) {
      return { index: i, name: GOWIN_DEVICES[i].name, pn: GOWIN_DEVICES[i].pn };
    }
  }
  return { index: CUSTOM_INDEX, name: wanted, pn: wantedPn || wanted };
}

function topFileBaseName(topFile: string): string {
  const parts = topFile.split(/[\\/]+/);
  return parts.length > 0 ? parts[parts.length - 1] : topFile;
}

function initialHint(cst: string, topFile: string): string {
  if (cst.trim().length > 0) {
    if (topFile) {
      return `Existing .cst loaded — click ⟳ Auto-detect ports to regenerate from ${topFileBaseName(
        topFile
      )}.`;
    }
    return 'No top-module file set — type constraints manually.';
  }
  if (topFile) {
    return '';
  }
  return 'No top-module file set — type constraints manually.';
}

function buildContent(): PanelContent {
  const host = requireHost();
  const state = host.getState();
  const cst = text(state.cst);
  const topFile = text(state.topFile);
  const svText = text(state.svText);
  const device = resolveDevice(text(state.device), text(state.pn));

  const options = GOWIN_DEVICES.map(
    (entry, index) =>
      `<option value="${index}"${index === device.index ? ' selected' : ''}>${esc(entry.label)}</option>`
  ).join('\n');
  const customOption = `<option value="${CUSTOM_INDEX}"${
    device.index === CUSTOM_INDEX ? ' selected' : ''
  }>${esc(CUSTOM_LABEL)}</option>`;

  const customHidden = device.index === CUSTOM_INDEX ? '' : ' hidden';

  const body = `<div class="title-gowin">◆   GOWIN CONSTRAINT FILE (.cst)</div>
${separator()}
${groupBox(
  'TARGET DEVICE',
  `<div class="device-row">
  <label class="field-label" for="deviceSelect">Device:</label>
  <select id="deviceSelect" class="device-combo">${options}
${customOption}</select>
</div>
<div class="custom-row${customHidden}" id="customRow">
  <label class="field-label" for="customName">device name</label>
  <input id="customName" type="text" spellcheck="false" autocomplete="off" placeholder="${esc(
    DEFAULT_DEVICE
  )}" value="${esc(device.name)}">
  <label class="field-label" for="customPn">device pn</label>
  <input id="customPn" type="text" spellcheck="false" autocomplete="off" placeholder="${esc(
    DEFAULT_DEVICE
  )}" value="${esc(device.pn)}">
</div>`,
  'gowin'
)}
${groupBox(
  "CONSTRAINT EDITOR  —  edit LOC numbers to match your board's pin map",
  `<textarea id="cstEditor" class="cst-editor" spellcheck="false" wrap="off" placeholder="${esc(
    EDITOR_PLACEHOLDER
  )}">${esc(cst)}</textarea>
<div class="hint" id="cstHint">${esc(initialHint(cst, topFile))}</div>`,
  'gowin'
)}
<div class="cst-actions">
  <button type="button" class="btn btn-gowin btn-detect" id="detectBtn">⟳  Auto-detect ports from .sv</button>
  <span class="spacer"></span>
  <button type="button" class="btn btn-ghost btn-cancel" id="cancelBtn">Cancel</button>
  <button type="button" class="btn btn-save-gowin btn-save-cst" id="saveBtn">✓  SAVE  .cst</button>
</div>`;

  return {
    body,
    css: EXTRA_CSS,
    script: buildScript({
      cst,
      svText,
      topFile,
      deviceIndex: device.index,
      deviceName: device.name,
      devicePn: device.pn,
      defaultDevice: DEFAULT_DEVICE,
      devices: GOWIN_DEVICES,
      customIndex: CUSTOM_INDEX,
      hint: initialHint(cst, topFile),
    }),
  };
}

interface ScriptState {
  cst: string;
  svText: string;
  topFile: string;
  deviceIndex: number;
  deviceName: string;
  devicePn: string;
  defaultDevice: string;
  devices: GowinDeviceDef[];
  customIndex: number;
  hint: string;
}

function buildScript(initial: ScriptState): string {
  return `(function () {
  'use strict';
  var state = ${jsonForScript(initial)};
  var blockCommentRe = new RegExp(${jsonForScript(BLOCK_COMMENT_PATTERN)}, 'g');
  var lineCommentRe = new RegExp(${jsonForScript(LINE_COMMENT_PATTERN)}, 'g');
  var portRe = new RegExp(${jsonForScript(PORT_PATTERN)}, 'gi');
  var keywords = ${jsonForScript(PORT_KEYWORDS)};

  var editor = document.getElementById('cstEditor');
  var hint = document.getElementById('cstHint');
  var select = document.getElementById('deviceSelect');
  var customRow = document.getElementById('customRow');
  var nameInput = document.getElementById('customName');
  var pnInput = document.getElementById('customPn');
  var detectBtn = document.getElementById('detectBtn');
  var saveBtn = document.getElementById('saveBtn');
  var cancelBtn = document.getElementById('cancelBtn');

  function post(message) { vscode.postMessage(message); }

  function baseName(path) {
    if (!path) { return ''; }
    var parts = String(path).split(/[\\\\/]+/);
    return parts[parts.length - 1] || String(path);
  }

  function setHint(messageText, isError) {
    if (!hint) { return; }
    hint.textContent = messageText || '';
    hint.style.color = isError ? '#ff4444' : '';
  }

  function selectedDevice() {
    var index = select ? parseInt(select.value, 10) : 0;
    if (isNaN(index)) { index = 0; }
    if (index === state.customIndex) {
      var name = nameInput ? nameInput.value.trim() : '';
      var pn = pnInput ? pnInput.value.trim() : '';
      return { name: name, pn: pn || name };
    }
    var device = state.devices[index] || state.devices[0];
    return { name: device.name, pn: device.pn };
  }

  function syncCustomRow() {
    if (!select || !customRow) { return; }
    var isCustom = String(select.value) === String(state.customIndex);
    customRow.classList.toggle('hidden', !isCustom);
  }

  function parsePorts(source) {
    var value = String(source || '');
    value = value.replace(blockCommentRe, ' ');
    value = value.replace(lineCommentRe, ' ');
    var ports = [];
    var seen = {};
    var match;
    portRe.lastIndex = 0;
    while ((match = portRe.exec(value)) !== null) {
      var direction = String(match[1] || '').toLowerCase();
      var width = String(match[2] || '').trim();
      var name = String(match[3] || '');
      if (!name) { continue; }
      if (keywords.indexOf(name.toLowerCase()) >= 0) { continue; }
      if (seen[name]) { continue; }
      seen[name] = true;
      ports.push({ name: name, direction: direction, width: width });
    }
    return ports;
  }

  function buildTemplate(ports, device) {
    var lines = [];
    lines.push('// Gowin Physical Constraint File (.cst)');
    lines.push('// Generated by MultiHD Launcher');
    if (device) { lines.push('// Device: ' + device); }
    lines.push('//');
    lines.push('// Replace the placeholder pin numbers (XX) with actual LOC values');
    lines.push("// from your board's schematic / pin map.");
    lines.push('// Reference: Gowin EDA User Guide — Physical Constraints');
    lines.push('');

    if (!ports.length) {
      lines.push('// No ports auto-detected — add constraints manually:');
      lines.push('//');
      lines.push('// IO_LOC  "port_name" XX ;');
      lines.push('// IO_PORT "port_name" PULL_MODE=UP DRIVE=8 IOSTD=LVCMOS33 ;');
      return lines.join('\\n');
    }

    function emitGroup(direction, comment) {
      var members = ports.filter(function (port) { return port.direction === direction; });
      if (!members.length) { return; }
      lines.push('// ── ' + comment + ' ──');
      members.forEach(function (port) {
        var width = port.width ? ' ' + port.width : '';
        lines.push('IO_LOC  "' + port.name + '"' + width + '  XX ;');
        lines.push('IO_PORT "' + port.name + '"  PULL_MODE=NONE  DRIVE=8  IOSTD=LVCMOS33 ;');
      });
      lines.push('');
    }

    emitGroup('input', 'Inputs');
    emitGroup('output', 'Outputs');
    emitGroup('inout', 'Bidirectional');
    return lines.join('\\n');
  }

  function detectPorts() {
    if (!editor) { return; }
    if (!state.topFile) {
      setHint('No top-module file set — type constraints manually.', false);
      return;
    }
    var file = baseName(state.topFile);
    var ports = parsePorts(state.svText);
    if (ports.length === 0) {
      setHint('⚠  No ports detected in ' + file +
        '  — the file may use an unsupported port style. Edit manually.', false);
    } else {
      setHint('✓  ' + ports.length + ' port(s) detected from ' + file +
        '  —  fill in the LOC numbers.', false);
    }
    var device = selectedDevice();
    editor.value = buildTemplate(ports, device.name);
  }

  if (select) {
    select.addEventListener('change', function () {
      syncCustomRow();
      detectPorts();
    });
  }

  [nameInput, pnInput].forEach(function (input) {
    if (!input) { return; }
    input.addEventListener('change', function () { detectPorts(); });
  });

  if (detectBtn) {
    detectBtn.addEventListener('click', function () { detectPorts(); });
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', function () { post({ type: '__close' }); });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', function () {
      if (saveBtn.disabled) { return; }
      var device = selectedDevice();
      var name = device.name || state.defaultDevice;
      var pn = device.pn || name;
      var payload = {
        cst: editor ? editor.value : '',
        device: name,
        pn: pn
      };
      saveBtn.disabled = true;
      saveBtn.textContent = '⏳  SAVING…';
      post({ type: 'save', payload: payload });
      window.setTimeout(function () {
        saveBtn.disabled = false;
        saveBtn.textContent = '✓  SAVE  .cst';
      }, 6000);
    });
  }

  window.__onHostMessage = function (message) {
    if (!message || !message.type) { return; }
    if (message.type === 'hostError') {
      setHint('✗  ' + (message.text || 'Unknown error'), true);
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '✓  SAVE  .cst'; }
    }
  };

  if (select) { select.value = String(state.deviceIndex); }
  if (nameInput) { nameInput.value = state.deviceName; }
  if (pnInput) { pnInput.value = state.devicePn; }
  syncCustomRow();

  if (editor && state.cst && state.cst.trim().length > 0) {
    editor.value = state.cst;
    if (hint) { hint.textContent = state.hint; }
  } else {
    detectPorts();
  }
})();`;
}

// ── public factory ──────────────────────────────────────────────────────────

/** Open (or re-render) the Gowin constraint (.cst) editor panel. */
export function showCstPanel(context: vscode.ExtensionContext, host: CstHost): void {
  activeHost = host;
  openCyberPanel(context, {
    key: PANEL_KEY,
    title: PANEL_TITLE,
    reloadOnShow: true,
    build: () => buildContent(),
    onMessage: async (message: WebviewMessage, handle: CyberPanelHandle) => {
      const current = requireHost();
      switch (message.type) {
        case 'save': {
          const raw =
            message.payload && typeof message.payload === 'object'
              ? (message.payload as Record<string, unknown>)
              : ({} as Record<string, unknown>);
          const device = text(raw.device).trim();
          const pn = text(raw.pn).trim();
          const payload = {
            cst: text(raw.cst),
            device: device || DEFAULT_DEVICE,
            pn: pn || device || DEFAULT_DEVICE,
          };
          try {
            await current.save(payload);
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
