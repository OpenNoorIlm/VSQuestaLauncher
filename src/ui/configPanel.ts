// ─────────────────────────────────────────────────────────────────────────────
// MultiHD Launcher — Configuration panel (Qt `ConfigDialog` equivalent)
// Owner: writer-ui. CONTRACT.md §7.3 (ConfigHost), §8 F2.
//
// 7 editable fields exactly like /home/bismillah/QuestaLauncher/configdialog.cpp:
//   PATHS               — vsim binary, license file, default folder,
//                         Quartus binary, Gowin IDE binary
//   ENVIRONMENT VARIABLES — SALT_LICENSE_SERVER, MTI_VCO_MODE
// Every field has a Browse button; the license banner updates live with the Qt
// warning/ok text; invalid fields are highlighted red; SAVE persists via host.
// ─────────────────────────────────────────────────────────────────────────────
import * as vscode from 'vscode';
import { ConfigHost } from './api';
import { ConfigValues } from '../models';
import {
  CyberPanelHandle,
  PanelContent,
  PanelEnv,
  WebviewMessage,
  errorMessage,
  esc,
  groupBox,
  jsonForScript,
  openCyberPanel,
  separator,
  text,
} from './base';

const PANEL_KEY = 'multihdLauncher.configPanel';
const PANEL_TITLE = 'MultiHD Launcher — Configuration';

type BrowseKind = 'vsim' | 'license' | 'folder' | 'quartus' | 'gowin';

interface PathField {
  id: string;
  key: keyof ConfigValues;
  label: string;
  value: string;
  placeholder: string;
  browse: BrowseKind;
  invalid: boolean;
}

interface EnvField {
  id: string;
  key: keyof ConfigValues;
  label: string;
  value: string;
  placeholder: string;
}

let activeHost: ConfigHost | undefined;

function requireHost(): ConfigHost {
  if (!activeHost) {
    throw new Error('MultiHD Launcher configuration host is not available.');
  }
  return activeHost;
}

function isLicenseOk(host: ConfigHost, values: ConfigValues): boolean {
  try {
    return host.isLicenseOk(values);
  } catch {
    return false;
  }
}

function parseBrowseKind(value: string): BrowseKind {
  switch (value) {
    case 'vsim':
    case 'license':
    case 'folder':
    case 'quartus':
    case 'gowin':
      return value;
    default:
      return 'folder';
  }
}

function licenceBanner(licenseOk: boolean, licensePath: string): string {
  if (licenseOk) {
    return '<div class="banner ok" id="licenseBanner">✓  License file found — Questa should start correctly.</div>';
  }
  if (licensePath) {
    return `<div class="banner warn" id="licenseBanner">⚠  LICENSE FILE NOT FOUND  at:  ${esc(
      licensePath
    )}<br>Questa will refuse to start.  Check the path.</div>`;
  }
  return '<div class="banner warn" id="licenseBanner">⚠  LICENSE FILE NOT SET  —  Questa will not start without a valid license.<br>Browse for your  questa_license.dat  file below.</div>';
}

function pathFieldHtml(field: PathField): string {
  const invalidClass = field.invalid ? ' invalid' : '';
  return `<label class="field-label" for="${field.id}">${esc(field.label)}</label>
<input id="${field.id}" data-key="${esc(String(field.key))}" type="text" spellcheck="false" autocomplete="off" placeholder="${esc(
    field.placeholder
  )}" value="${esc(field.value)}" class="cyber-input${invalidClass}">
<button type="button" class="btn btn-cyan btn-browse" data-browse-kind="${field.browse}" data-target="${
    field.id
  }">Browse</button>`;
}

function envFieldHtml(field: EnvField): string {
  return `<label class="field-label" for="${field.id}">${esc(field.label)}</label>
<input id="${field.id}" data-key="${esc(String(field.key))}" type="text" spellcheck="false" autocomplete="off" placeholder="${esc(
    field.placeholder
  )}" value="${esc(field.value)}" class="cyber-input">`;
}

function buildContent(): PanelContent {
  const host = requireHost();
  const values = host.load();
  const licenseOk = isLicenseOk(host, values);
  const licensePath = (values.licenseFile || '').trim();
  const vsimMissing = (values.vsimPath || '').trim() === '';

  const pathFields: PathField[] = [
    {
      id: 'cfg-vsim',
      key: 'vsimPath',
      label: 'vsim binary',
      value: values.vsimPath || '',
      placeholder: '/path/to/questa_fse/linux_x86_64/vsim',
      browse: 'vsim',
      invalid: vsimMissing,
    },
    {
      id: 'cfg-license',
      key: 'licenseFile',
      label: 'license file',
      value: values.licenseFile || '',
      placeholder: '/path/to/questa_license.dat   ← REQUIRED',
      browse: 'license',
      invalid: !licenseOk,
    },
    {
      id: 'cfg-folder',
      key: 'defaultFolder',
      label: 'default folder',
      value: values.defaultFolder || '',
      placeholder: '/home/user/projects/',
      browse: 'folder',
      invalid: false,
    },
    {
      id: 'cfg-quartus',
      key: 'quartusPath',
      label: 'Quartus binary',
      value: values.quartusPath || '',
      placeholder: '/path/to/quartus  (optional — for Compile For → Quartus)',
      browse: 'quartus',
      invalid: false,
    },
    {
      id: 'cfg-gowin',
      key: 'gowinPath',
      label: 'Gowin IDE binary',
      value: values.gowinPath || '',
      placeholder: '/path/to/gw_ide  (optional — for Compile For → Gowin EDA)',
      browse: 'gowin',
      invalid: false,
    },
  ];

  const envFields: EnvField[] = [
    {
      id: 'cfg-salt',
      key: 'saltLicenseServer',
      label: 'SALT_LICENSE_SERVER',
      value: values.saltLicenseServer || '',
      placeholder: 'same as license file path, or server@host',
    },
    {
      id: 'cfg-mti',
      key: 'mtiVcoMode',
      label: 'MTI_VCO_MODE',
      value: values.mtiVcoMode || '',
      placeholder: '64',
    },
  ];

  const body = `<div class="title title-lg">⚙   CONFIGURATION</div>
${separator()}
${licenceBanner(licenseOk, licensePath)}
${groupBox('PATHS', `<div class="form-grid">${pathFields.map(pathFieldHtml).join('\n')}</div>`)}
${groupBox(
  'ENVIRONMENT VARIABLES',
  `<div class="form-grid env">${envFields.map(envFieldHtml).join('\n')}</div>`
)}
<div class="env-note">These are injected into Questa's process environment at launch.<br>LM_LICENSE_FILE is set automatically from the license file path above.</div>
<div class="status" id="configStatus"></div>
<div class="btn-row">
  <button type="button" class="btn btn-ghost btn-cancel" id="cancelBtn">Cancel</button>
  <button type="button" class="btn btn-save" id="saveBtn">✓   SAVE</button>
</div>`;

  return { body, script: buildScript(values) };
}

function buildScript(values: ConfigValues): string {
  return `(function () {
  'use strict';
  var original = ${jsonForScript(values)};
  var fieldMap = {
    vsimPath: 'cfg-vsim',
    licenseFile: 'cfg-license',
    defaultFolder: 'cfg-folder',
    quartusPath: 'cfg-quartus',
    gowinPath: 'cfg-gowin',
    saltLicenseServer: 'cfg-salt',
    mtiVcoMode: 'cfg-mti'
  };

  function $(id) { return document.getElementById(id); }
  function post(message) { vscode.postMessage(message); }

  function readValues() {
    var values = {};
    Object.keys(original).forEach(function (key) { values[key] = original[key]; });
    Object.keys(fieldMap).forEach(function (key) {
      var input = $(fieldMap[key]);
      if (input) { values[key] = input.value; }
    });
    return values;
  }

  function setBanner(licenseOk, licenseFile) {
    var banner = $('licenseBanner');
    if (!banner) { return; }
    var path = String(licenseFile || '').trim();
    while (banner.firstChild) { banner.removeChild(banner.firstChild); }
    if (licenseOk) {
      banner.className = 'banner ok';
      banner.textContent = '✓  License file found — Questa should start correctly.';
      return;
    }
    banner.className = 'banner warn';
    var first = document.createElement('div');
    var second = document.createElement('div');
    if (path === '') {
      first.textContent = '⚠  LICENSE FILE NOT SET  —  Questa will not start without a valid license.';
      second.textContent = 'Browse for your  questa_license.dat  file below.';
    } else {
      first.textContent = '⚠  LICENSE FILE NOT FOUND  at:  ' + path;
      second.textContent = 'Questa will refuse to start.  Check the path.';
    }
    banner.appendChild(first);
    banner.appendChild(second);
  }

  function setStatus(messageText, isError) {
    var status = $('configStatus');
    if (!status) { return; }
    status.textContent = messageText || '';
    status.className = isError ? 'status error' : 'status';
  }

  function renderValidation(values, licenseOk) {
    var license = $('cfg-license');
    if (license) { license.classList.toggle('invalid', !licenseOk); }
    var vsim = $('cfg-vsim');
    if (vsim) { vsim.classList.toggle('invalid', String(values.vsimPath || '').trim() === ''); }
  }

  function validateNow() {
    post({ type: 'validate', values: readValues() });
  }

  Object.keys(fieldMap).forEach(function (key) {
    var input = $(fieldMap[key]);
    if (!input) { return; }
    if (key === 'licenseFile' || key === 'vsimPath') {
      input.addEventListener('input', validateNow);
    }
  });

  document.querySelectorAll('[data-browse-kind]').forEach(function (button) {
    button.addEventListener('click', function () {
      var target = button.getAttribute('data-target') || '';
      var input = target ? $(target) : null;
      post({
        type: 'browse',
        kind: button.getAttribute('data-browse-kind') || 'folder',
        target: target,
        current: input ? input.value : ''
      });
    });
  });

  var cancelBtn = $('cancelBtn');
  if (cancelBtn) { cancelBtn.addEventListener('click', function () { post({ type: '__close' }); }); }

  var saveBtn = $('saveBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', function () {
      saveBtn.disabled = true;
      saveBtn.textContent = '⏳   SAVING…';
      post({ type: 'save', values: readValues() });
      window.setTimeout(function () {
        saveBtn.disabled = false;
        saveBtn.textContent = '✓   SAVE';
      }, 4000);
    });
  }

  window.__onHostMessage = function (message) {
    if (!message || !message.type) { return; }
    if (message.type === 'validation') {
      var values = readValues();
      setBanner(message.licenseOk === true, message.licenseFile);
      renderValidation(values, message.licenseOk === true);
    } else if (message.type === 'browseResult') {
      var input = $(message.target || '');
      if (input && typeof message.value === 'string') {
        input.value = message.value;
        validateNow();
      }
    } else if (message.type === 'hostError') {
      setStatus('✗  ' + (message.text || 'Unknown error'), true);
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '✓   SAVE'; }
    } else if (message.type === 'saved') {
      setStatus('✓  Configuration saved.', false);
    }
  };
})();`;
}

// ── public factory ──────────────────────────────────────────────────────────

/** Open (or re-render) the MultiHD Launcher configuration panel. */
export function showConfigPanel(context: vscode.ExtensionContext, host: ConfigHost): void {
  activeHost = host;
  openCyberPanel(context, {
    key: PANEL_KEY,
    title: PANEL_TITLE,
    reloadOnShow: true,
    build: () => buildContent(),
    onMessage: async (message: WebviewMessage, handle: CyberPanelHandle) => {
      const current = requireHost();
      switch (message.type) {
        case 'validate': {
          const values = mergeValues(current, message.values);
          const licenseOk = isLicenseOk(current, values);
          handle.post({
            type: 'validation',
            licenseOk,
            licenseFile: values.licenseFile,
          });
          return;
        }
        case 'browse': {
          const kind = parseBrowseKind(text(message.kind));
          const target = text(message.target);
          const currentValue = text(message.current);
          const picked = await current.browse(kind, currentValue);
          if (typeof picked === 'string' && picked.length > 0) {
            handle.post({ type: 'browseResult', target, value: picked });
          }
          return;
        }
        case 'save': {
          const values = mergeValues(current, message.values);
          try {
            await current.save(values);
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

/** Merge the 7 edited fields over the host's current values. */
function mergeValues(host: ConfigHost, raw: unknown): ConfigValues {
  const base = host.load();
  const incoming =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : ({} as Record<string, unknown>);
  return {
    ...base,
    vsimPath: text(incoming.vsimPath).trim(),
    licenseFile: text(incoming.licenseFile).trim(),
    defaultFolder: text(incoming.defaultFolder).trim(),
    quartusPath: text(incoming.quartusPath).trim(),
    gowinPath: text(incoming.gowinPath).trim(),
    saltLicenseServer: text(incoming.saltLicenseServer).trim(),
    mtiVcoMode: text(incoming.mtiVcoMode).trim(),
  };
}
