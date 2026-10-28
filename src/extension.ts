import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';

// ─── conf.svconf parser ────────────────────────────────────────────────────

interface SvConf {
  compileMode: 'all' | 'list' | number; // number = count
  priorityList: string[];                // basenames in order
  tbName: string;                        // @tb (name) — explicit tb file
  tbPriorityList: string[];              // @tb priority list — tb files in order
  topModule: string;
  vsimArgs: string;
  vlogArgs: string;
  workLib: string;
}

function defaultConf(): SvConf {
  return {
    compileMode: 'all',
    priorityList: [],
    tbName: '',
    tbPriorityList: [],
    topModule: '',
    vsimArgs: '',
    vlogArgs: '',
    workLib: 'work'
  };
}

function parseConf(confPath: string): SvConf {
  const conf = defaultConf();
  if (!fs.existsSync(confPath)) return conf;

  const lines = fs.readFileSync(confPath, 'utf8').split('\n');
  let inPriority = false;
  let inTbPriority = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) { inPriority = false; inTbPriority = false; continue; }

    // compile @(all)  /  compile @(1)  /  compile @(list)
    const compileMatch = line.match(/^compile\s+@\((.+?)\)/i);
    if (compileMatch) {
      const val = compileMatch[1].trim().toLowerCase();
      if (val === 'all') conf.compileMode = 'all';
      else if (val === 'list') conf.compileMode = 'list';
      else conf.compileMode = parseInt(val) || 'all';
      inPriority = false; inTbPriority = false;
      continue;
    }

    // @tb (filename.sv)  — explicit tb name
    const tbNameMatch = line.match(/^@tb\s+\(([^)]+)\)/i);
    if (tbNameMatch) { conf.tbName = tbNameMatch[1].trim(); inPriority = false; inTbPriority = false; continue; }

    // @tb priority list
    if (line.match(/^@tb\s+priority\s+list/i)) {
      inTbPriority = true; inPriority = false;
      conf.tbPriorityList = [];
      continue;
    }

    // @priority list encoder:
    if (line.match(/^@priority\s+list/i)) {
      inPriority = true; inTbPriority = false;
      conf.priorityList = [];
      continue;
    }

    // @topmodule: counter16_tb
    const topMatch = line.match(/^@topmodule\s*:\s*(.+)/i);
    if (topMatch) { conf.topModule = topMatch[1].trim(); inPriority = false; inTbPriority = false; continue; }

    // @vsimargs: -voptargs=+acc
    const vsimMatch = line.match(/^@vsimargs\s*:\s*(.+)/i);
    if (vsimMatch) { conf.vsimArgs = vsimMatch[1].trim(); inPriority = false; inTbPriority = false; continue; }

    // @vlogargs: -sv -quiet
    const vlogMatch = line.match(/^@vlogargs\s*:\s*(.+)/i);
    if (vlogMatch) { conf.vlogArgs = vlogMatch[1].trim(); inPriority = false; inTbPriority = false; continue; }

    // @work: work
    const workMatch = line.match(/^@work\s*:\s*(.+)/i);
    if (workMatch) { conf.workLib = workMatch[1].trim(); inPriority = false; inTbPriority = false; continue; }

    // inside @tb priority list block
    if (inTbPriority && (line.startsWith('-') || /^\d+\./.test(line) || line.endsWith('.sv'))) {
      const fname = line.replace(/^[-\d.]\s*/, '').trim();
      if (fname) conf.tbPriorityList.push(fname);
      continue;
    }

    // inside priority block — indented file lines
    if (inPriority && (line.startsWith('-') || /^\d+\./.test(line) || line.endsWith('.sv'))) {
      const fname = line.replace(/^[-\d.]\s*/, '').trim();
      if (fname) conf.priorityList.push(fname);
    }
  }

  return conf;
}

// ─── file ordering ────────────────────────────────────────────────────────

function orderFiles(allFiles: string[], openedFile: string, conf: SvConf): string[] {
  const openedBase = path.basename(openedFile);

  // Separate tb files from non-tb files
  const isTb = (f: string) => path.basename(f).includes('_tb') || path.basename(f).startsWith('tb_');

  // Build tb order: tbPriorityList first, then @tb (name), then any _tb files, opened _tb if applicable
  const tbOrdered: string[] = [];
  const nonTbOrdered: string[] = [];
  const remaining = [...allFiles];

  // 1. Process @tb priority list first
  for (const pname of conf.tbPriorityList) {
    const idx = remaining.findIndex(f => path.basename(f) === pname);
    if (idx !== -1) tbOrdered.push(remaining.splice(idx, 1)[0]);
  }

  // 2. @tb (name) explicit tb — if not already added
  if (conf.tbName) {
    const idx = remaining.findIndex(f => path.basename(f) === conf.tbName);
    if (idx !== -1) tbOrdered.push(remaining.splice(idx, 1)[0]);
  }

  // 3. If opened file is a _tb and not already listed, it goes first among tbs
  if (isTb(openedFile)) {
    const idx = remaining.findIndex(f => f === openedFile);
    if (idx !== -1) tbOrdered.unshift(remaining.splice(idx, 1)[0]);
  }

  // 4. Remaining _tb files
  for (let i = remaining.length - 1; i >= 0; i--) {
    if (isTb(remaining[i])) tbOrdered.push(remaining.splice(i, 1)[0]);
  }

  // 5. Non-tb: process @priority list
  for (const pname of conf.priorityList) {
    const idx = remaining.findIndex(f => path.basename(f) === pname);
    if (idx !== -1) nonTbOrdered.push(remaining.splice(idx, 1)[0]);
  }

  // 6. Opened file (non-tb) goes first among non-tb if not already listed
  if (!isTb(openedFile)) {
    const idx = remaining.findIndex(f => f === openedFile);
    if (idx !== -1) nonTbOrdered.unshift(remaining.splice(idx, 1)[0]);
  }

  // 7. Rest sorted alphabetically
  remaining.sort();

  // Final order: non-tb first (dependencies), then tb files last (they depend on the rest)
  return [...nonTbOrdered, ...remaining, ...tbOrdered];
}

// ─── run.do generator ────────────────────────────────────────────────────

function generateRunDo(
  files: string[],
  conf: SvConf,
  cfg: vscode.WorkspaceConfiguration,
  mode: 'cli' | 'gui' = 'gui'
): string {
  const workLib = conf.workLib || 'work';
  const confVlog = conf.vlogArgs ? conf.vlogArgs : '';
  const allVlogArgs = ['-work', workLib, confVlog].filter(Boolean).join(' ');

  const filesToCompile = (() => {
    if (conf.compileMode === 'all') return files;
    if (typeof conf.compileMode === 'number') return files.slice(0, conf.compileMode);
    return files; // 'list' — already ordered
  })();

  const fileList = filesToCompile.map(f => path.basename(f)).join(' ');

  // Determine top module: @topmodule > @tb (name) stem > detected _tb file stem > first file stem
  const tbFile = conf.tbName
    || filesToCompile.map(f => path.basename(f)).find(b => b.includes('_tb') || b.startsWith('tb_'))
    || '';
  const topModule = conf.topModule
    || (tbFile ? tbFile.replace(/\.sv$/i, '') : '')
    || path.basename(filesToCompile[filesToCompile.length - 1]).replace(/\.sv$/i, '');

  const optTarget  = `${workLib}.${topModule}`;
  const optOut     = `${topModule}_opt`;
  const vsimArgs   = conf.vsimArgs || '';

  let doScript = `quietly vlib ${workLib}\n`;
  doScript += `vlog ${allVlogArgs} ${fileList}\n`;
  doScript += `vopt +acc ${optTarget} -o ${optOut}\n`;
  doScript += `vsim ${vsimArgs ? vsimArgs + ' ' : ''}${optOut}\n`;
  if (mode === 'gui') {
    doScript += `add wave -r /*\n`;
  }
  doScript += `run -all\n`;
  if (mode === 'cli') {
    doScript += `quit -f\n`;
  }
  return doScript;
}

// ─── questa binary resolution ─────────────────────────────────────────────

function resolveQuesta(cfg: vscode.WorkspaceConfiguration): string {
  const bin = cfg.get<string>('questaBin');
  if (bin) return path.join(bin, 'vsim');
  // try PATH
  try {
    const which = child_process.execSync('which vsim 2>/dev/null').toString().trim();
    if (which) return which;
  } catch {}
  // known default
  const def = '/home/bismillah/altera/25.1std/questa_fse/linux_x86_64/vsim';
  if (fs.existsSync(def)) return def;
  return 'vsim';
}

function resolveEnv(cfg: vscode.WorkspaceConfiguration): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  env['MTI_VCO_MODE'] = '64';
  env['QSIM_VCO_MODE'] = '64';

  // SALT_LICENSE_SERVER — Questa FSE/Starter edition (highest priority)
  const saltLic = cfg.get<string>('saltLicenseServer')
    || process.env['SALT_LICENSE_SERVER']
    || '/home/bismillah/.licenses/questa_license.dat';
  env['SALT_LICENSE_SERVER'] = saltLic;

  const lic = cfg.get<string>('licenseFile');
  if (lic) env['LM_LICENSE_FILE'] = lic;

  const licServer = cfg.get<string>('licenseServer');
  if (licServer) env['MGLS_LICENSE_FILE'] = licServer;

  const alteraLic = cfg.get<string>('alteraLicenseFile');
  if (alteraLic) env['ALTERAD_LICENSE_FILE'] = alteraLic;

  const bin = cfg.get<string>('questaBin');
  if (bin) {
    env['PATH'] = bin + ':' + (env['PATH'] || '');
  }
  return env;
}

// ─── Priority picker UI ───────────────────────────────────────────────────

async function runPriorityPicker(dirFiles: string[], openedFile: string, confPath: string): Promise<void> {
  const conf = parseConf(confPath);
  const basenames = dirFiles.map(f => path.basename(f));

  // Build QuickPick items with current order shown
  type PItem = vscode.QuickPickItem & { basename: string };

  const makeItems = (order: string[]): PItem[] => {
    return basenames.map(b => {
      const pos = order.indexOf(b);
      return {
        label: pos >= 0 ? `[${String(pos + 1).padStart(2, '0')}] ${b}` : `      ${b}`,
        basename: b,
        picked: pos >= 0
      };
    });
  };

  let currentOrder: string[] = conf.priorityList.length > 0
    ? conf.priorityList
    : [path.basename(openedFile)];

  const qp = vscode.window.createQuickPick<PItem>();
  qp.title = '⇅ Set Compile Priority — click to add/remove, use buttons to reorder';
  qp.canSelectMany = false;
  qp.items = makeItems(currentOrder);

  qp.buttons = [
    { iconPath: new vscode.ThemeIcon('arrow-up'), tooltip: 'Move selected up' },
    { iconPath: new vscode.ThemeIcon('arrow-down'), tooltip: 'Move selected down' },
    { iconPath: new vscode.ThemeIcon('refresh'), tooltip: 'Reset order' },
    { iconPath: new vscode.ThemeIcon('check'), tooltip: 'Save & close' }
  ];

  qp.onDidTriggerButton(btn => {
    const sel = qp.activeItems[0];
    if (!sel) return;

    if (btn.tooltip === 'Move selected up') {
      const i = currentOrder.indexOf(sel.basename);
      if (i > 0) { [currentOrder[i - 1], currentOrder[i]] = [currentOrder[i], currentOrder[i - 1]]; }
      qp.items = makeItems(currentOrder);
    } else if (btn.tooltip === 'Move selected down') {
      const i = currentOrder.indexOf(sel.basename);
      if (i >= 0 && i < currentOrder.length - 1) {
        [currentOrder[i], currentOrder[i + 1]] = [currentOrder[i + 1], currentOrder[i]];
      }
      qp.items = makeItems(currentOrder);
    } else if (btn.tooltip === 'Reset order') {
      currentOrder = [path.basename(openedFile)];
      qp.items = makeItems(currentOrder);
    } else if (btn.tooltip === 'Save & close') {
      saveAndClose();
    }
  });

  qp.onDidAccept(() => {
    const sel = qp.activeItems[0];
    if (!sel) return;
    const b = sel.basename;
    const i = currentOrder.indexOf(b);
    if (i >= 0) currentOrder.splice(i, 1);
    else currentOrder.push(b);
    qp.items = makeItems(currentOrder);
  });

  const saveAndClose = () => {
    conf.priorityList = currentOrder;
    saveConf(confPath, conf);
    vscode.window.showInformationMessage(`✓ Priority saved to conf.svconf (${currentOrder.length} files)`);
    qp.dispose();
  };

  qp.show();
}

// ─── conf.svconf writer ───────────────────────────────────────────────────

function saveConf(confPath: string, conf: SvConf): void {
  const modeStr = conf.compileMode === 'all' ? 'all'
    : conf.compileMode === 'list' ? 'list'
    : String(conf.compileMode);

  let out = `# conf.svconf — Questa Launcher configuration\n`;
  out += `# Generated by VSQuestaLauncher\n\n`;
  out += `compile @(${modeStr})\n\n`;

  if (conf.tbName) out += `@tb (${conf.tbName})\n\n`;

  if (conf.tbPriorityList.length > 0) {
    out += `@tb priority list:\n`;
    for (const f of conf.tbPriorityList) out += `  - ${f}\n`;
    out += `\n`;
  }

  out += `@priority list encoder:\n`;
  for (const f of conf.priorityList) out += `  - ${f}\n`;
  out += `\n`;

  if (conf.topModule) out += `@topmodule: ${conf.topModule}\n`;
  if (conf.vsimArgs)  out += `@vsimargs: ${conf.vsimArgs}\n`;
  if (conf.vlogArgs)  out += `@vlogargs: ${conf.vlogArgs}\n`;
  if (conf.workLib && conf.workLib !== 'work') out += `@work: ${conf.workLib}\n`;

  fs.writeFileSync(confPath, out, 'utf8');
}

// ─── default conf.svconf template ────────────────────────────────────────

function defaultConfTemplate(openedBase: string, allBases: string[]): string {
  const tbFiles = allBases.filter(b => b.includes('_tb') || b.startsWith('tb_'));
  const nonTbFiles = allBases.filter(b => !b.includes('_tb') && !b.startsWith('tb_'));
  const detectedTb = tbFiles.length === 1 ? tbFiles[0]
    : tbFiles.find(b => b === openedBase) || tbFiles[0] || '';

  let out = `# conf.svconf — Questa Launcher configuration\n`;
  out += `#\n`;
  out += `# compile @(all)         — compile all .sv files in dir\n`;
  out += `# compile @(list)        — compile only files in priority list\n`;
  out += `# compile @(3)           — compile top 3 from priority list\n\n`;
  out += `compile @(all)\n\n`;

  if (detectedTb) {
    out += `# Explicit testbench file (compiled last, highest priority for vsim)\n`;
    out += `@tb (${detectedTb})\n\n`;
  }

  if (tbFiles.length > 0) {
    out += `# Testbench compile order (compiled after all RTL)\n`;
    out += `@tb priority list:\n`;
    for (const b of tbFiles) out += `  - ${b}\n`;
    out += `\n`;
  }

  out += `# RTL compile order (compiled first)\n`;
  out += `@priority list encoder:\n`;
  const openedNonTb = nonTbFiles.find(b => b === openedBase);
  if (openedNonTb) out += `  - ${openedNonTb}    # opened file\n`;
  for (const b of nonTbFiles.filter(b => b !== openedBase)) out += `  - ${b}\n`;
  out += `\n`;

  const topMod = detectedTb ? detectedTb.replace('.sv', '') : openedBase.replace('.sv', '');
  out += `@topmodule: ${topMod}\n`;
  out += `# @vsimargs: -voptargs=+acc\n`;
  out += `# @vlogargs: -sv\n`;
  out += `# @work: work\n`;
  return out;
}

// ─── main run command ─────────────────────────────────────────────────────

async function runCli(uri?: vscode.Uri): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const fileUri = uri || editor?.document.uri;
  if (!fileUri) {
    vscode.window.showErrorMessage('No .sv file open.');
    return;
  }

  const openedFile = fileUri.fsPath;
  const dir = path.dirname(openedFile);
  const confPath = path.join(dir, 'conf.svconf');
  const cfg = vscode.workspace.getConfiguration('questaLauncher');

  // Collect all .sv files in directory
  const allFiles = fs.readdirSync(dir)
    .filter(f => f.endsWith('.sv'))
    .map(f => path.join(dir, f));

  if (allFiles.length === 0) {
    vscode.window.showErrorMessage('No .sv files found in directory.');
    return;
  }

  const conf = parseConf(confPath);
  const ordered = orderFiles(allFiles, openedFile, conf);
  const runDoPath = path.join(dir, 'run.do');
  // CLI mode: no 'add wave', ends with 'quit -f'
  const doContent = generateRunDo(ordered, conf, cfg, 'cli');

  fs.writeFileSync(runDoPath, doContent, 'utf8');

  const questa = resolveQuesta(cfg);
  const env = resolveEnv(cfg);
  const questaDir = path.dirname(questa);
  if (questaDir && questaDir !== '.') {
    env['PATH'] = questaDir + ':' + (env['PATH'] || '');
  }

  // Show output channel
  const channel = vscode.window.createOutputChannel('Questa Launcher');
  channel.show(true);
  channel.appendLine(`▶ Questa Launcher  [CLI — headless, no waveform]`);
  channel.appendLine(`  Dir:    ${dir}`);
  channel.appendLine(`  Files:  ${ordered.map(f => path.basename(f)).join(', ')}`);
  channel.appendLine(`  run.do: ${runDoPath}`);
  channel.appendLine(`  vsim:   ${questa}`);
  channel.appendLine('─'.repeat(60));

  // -c = console/batch mode (no GUI, no waveform window)
  const proc = child_process.spawn(
    questa,
    ['-c', '-do', `cd ${dir}; do run.do`],
    { cwd: dir, env, detached: false }
  );

  proc.stdout.on('data', (d: Buffer) => channel.append(d.toString()));
  proc.stderr.on('data', (d: Buffer) => channel.append(d.toString()));

  proc.on('close', (code) => {
    channel.appendLine('─'.repeat(60));
    if (code === 0) {
      channel.appendLine('✓ Simulation complete.');
      vscode.window.showInformationMessage('✓ Questa CLI simulation complete.');
    } else {
      channel.appendLine(`✗ Questa exited with code ${code}`);
      vscode.window.showErrorMessage(`✗ Questa failed (exit ${code}). See Output → Questa Launcher.`);
    }
  });

  proc.on('error', (err) => {
    channel.appendLine(`✗ Failed to launch Questa: ${err.message}`);
    vscode.window.showErrorMessage(`Cannot launch Questa: ${err.message}`);
  });
}

// ─── Help panel ───────────────────────────────────────────────────────────

function mdToHtml(md: string): string {
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // headings
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/gm, (_: string, _lang: string, code: string) =>
      `<pre><code>${code.trimEnd()}</code></pre>`)
    // inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // hr
    .replace(/^---$/gm, '<hr>')
    // table rows
    .replace(/^\|(.+)\|$/gm, (row: string) => {
      const cells = row.split('|').slice(1, -1);
      if (cells.every((c: string) => /^[-: ]+$/.test(c))) return '';
      return '<tr>' + cells.map((c: string) => `<td>${c.trim()}</td>`).join('') + '</tr>';
    })
    // paragraphs (non-block lines)
    .replace(/^(?!<[hpturcode]|$)(.+)$/gm, '<p>$1</p>')
    // blank lines
    .replace(/\n{2,}/g, '\n');
}

function buildHelpPanel(
  context: vscode.ExtensionContext,
  title: string,
  mdContent: string,
  isDeps: boolean
): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    'questaHelp',
    title,
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  const body = mdToHtml(mdContent);

  // Parse command blocks for the run buttons (deps panel only)
  const commandBlocks: { os: string; label: string; cmd: string; section: string; desc: string }[] = [];
  if (isDeps) {
    const cmdFile = fs.readFileSync(
      path.join(context.extensionPath, 'COMMANDS.md'), 'utf8'
    );
    let lastSection = '';
    let lastHeading = '';
    let lastDesc = '';
    const lines = cmdFile.split('\n');
    let inBlock = false;
    let blockLines: string[] = [];
    for (const line of lines) {
      // ## Section heading
      if (/^## /.test(line)) {
        lastSection = line.replace(/^#+\s*/, '').trim();
        lastDesc = '';
        continue;
      }
      // ### Command heading
      if (/^### /.test(line)) {
        lastHeading = line.replace(/^#+\s*/, '').trim();
        inBlock = false; blockLines = []; lastDesc = '';
        continue;
      }
      // Fenced code block toggle
      if (line.startsWith('```')) {
        if (!inBlock) { inBlock = true; blockLines = []; }
        else {
          const cmd = blockLines.join('\n').trim();
          if (cmd) commandBlocks.push({
            os: lastHeading, label: lastHeading, cmd,
            section: lastSection, desc: lastDesc
          });
          inBlock = false; blockLines = [];
        }
        continue;
      }
      if (inBlock) { blockLines.push(line); continue; }
      // Description: non-empty non-heading text between ### and ``` becomes the desc
      const stripped = line.replace(/^>\s*/, '').trim();
      if (stripped && !stripped.startsWith('#') && !stripped.startsWith('---')) {
        lastDesc = stripped;
      }
    }
  }

  const blocksJson = JSON.stringify(commandBlocks);

  panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  :root {
    --bg:#0d0d1a; --bg2:#111827; --border:#1e3a5f;
    --cyan:#00e5ff; --blue:#0057a8; --blue2:#00b4d8;
    --text:#cdd6e0; --muted:#4a6680; --green:#50c878;
    --red:#ff4f4f; --yellow:#ffd700;
  }
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:var(--bg);color:var(--text);font-family:'Segoe UI',system-ui,sans-serif;font-size:14px;line-height:1.7;}

  /* Header */
  .header{background:linear-gradient(135deg,#0a0a18,#0a1628);border-bottom:1px solid var(--border);
    padding:20px 28px;display:flex;align-items:center;gap:16px;position:sticky;top:0;z-index:20;}
  .header h1{font-size:18px;color:var(--cyan);letter-spacing:1px;}
  .header p{font-size:12px;color:var(--muted);margin-top:2px;}

  /* Tabs */
  .tabs{display:flex;border-bottom:1px solid var(--border);background:var(--bg2);padding:0 28px;gap:4px;}
  .tab{padding:10px 18px;cursor:pointer;border:none;background:none;color:var(--muted);font-size:13px;
    border-bottom:2px solid transparent;transition:all .2s;}
  .tab:hover{color:var(--text);}
  .tab.active{color:var(--cyan);border-bottom-color:var(--cyan);}

  /* Content */
  .content{padding:28px;max-width:900px;}
  .page{display:none;}
  .page.active{display:block;}

  h1{font-size:22px;color:var(--cyan);margin:24px 0 12px;}
  h2{font-size:17px;color:var(--blue2);margin:20px 0 10px;border-bottom:1px solid var(--border);padding-bottom:6px;}
  h3{font-size:14px;color:var(--yellow);margin:16px 0 8px;}
  p{margin:8px 0;color:var(--text);}
  hr{border:none;border-top:1px solid var(--border);margin:20px 0;}
  code{background:#0a1628;color:var(--cyan);padding:1px 6px;border-radius:4px;font-family:'Courier New',monospace;font-size:12px;}
  pre{background:#080f1e;border:1px solid var(--border);border-radius:8px;padding:16px;overflow-x:auto;margin:12px 0;}
  pre code{background:none;color:#a8d8ea;padding:0;font-size:12px;}
  strong{color:#fff;}
  table{width:100%;border-collapse:collapse;margin:12px 0;}
  tr{border-bottom:1px solid var(--border);}
  td,th{padding:8px 12px;text-align:left;font-size:13px;}
  tr:first-child td{color:var(--cyan);font-weight:bold;background:#0a1628;}

  /* Badges */
  .os-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:bold;margin-right:4px;}
  .os-linux{background:#1a3a1a;color:var(--green);}
  .os-windows{background:#1a1a3a;color:#7aa7ff;}
  .sec-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:bold;margin-right:4px;}
  .sec-build{background:#2a1a00;color:#ffd700;border:1px solid #5a3a00;}
  .sec-install{background:#1a0a2a;color:#c084fc;border:1px solid #4a1a6f;}
  .sec-cli{background:#0a1628;color:var(--cyan);border:1px solid var(--border);}
  .sec-gui{background:#0a1628;color:#c084fc;border:1px solid #4a1a6f;}

  /* Section group */
  .section-group{margin:28px 0;}
  .section-header{display:flex;justify-content:space-between;align-items:center;
    padding:12px 18px;background:linear-gradient(90deg,#0a1628,#060c18);
    border-radius:10px 10px 0 0;border:1px solid var(--border);border-bottom:2px solid var(--cyan);}
  .section-title{font-size:15px;font-weight:bold;color:var(--cyan);}
  .section-count{font-size:11px;color:var(--muted);margin-left:8px;font-weight:normal;}
  .btn-run-all{background:linear-gradient(90deg,#0057a8,#00b4d8);color:#fff;
    border:none;border-radius:6px;padding:7px 18px;cursor:pointer;font-size:12px;font-weight:bold;transition:all .2s;}
  .btn-run-all:hover{opacity:.85;transform:scale(1.02);}

  /* Command block */
  .cmd-block{background:#080f1e;border:1px solid var(--border);border-top:none;overflow:hidden;}
  .cmd-block:last-child{border-radius:0 0 10px 10px;}
  .cmd-header{display:flex;justify-content:space-between;align-items:center;
    padding:10px 16px;background:#0a1020;border-bottom:1px solid #0d1e35;}
  .cmd-label{font-size:12px;color:var(--blue2);font-weight:bold;}
  .cmd-desc{padding:6px 16px 8px;font-size:12px;color:#7fbfff;font-style:italic;border-bottom:1px solid #0d1e35;background:#06090f;}
  .cmd-body{padding:14px 16px;}
  .cmd-body pre{margin:0;border:none;background:none;padding:0;}
  .btn{display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border:none;border-radius:6px;
    cursor:pointer;font-size:11px;font-weight:bold;transition:all .2s;}
  .btn-run{background:linear-gradient(90deg,var(--blue),var(--blue2));color:#fff;}
  .btn-run:hover{opacity:.85;}
  .btn-copy{background:#1e3a5f;color:var(--cyan);}
  .btn-copy:hover{background:#254d7a;}
  .btn-group{display:flex;gap:6px;}

  /* Log bar */
  #depLog{background:#04080f;border:1px solid var(--border);border-radius:8px;
    padding:10px 14px;font-family:monospace;font-size:12px;color:#7fbfff;margin-bottom:20px;}

  /* Approval overlay */
  #approvalOverlay{display:none;position:sticky;top:0;z-index:50;
    background:rgba(0,0,0,.85);backdrop-filter:blur(4px);
    padding:20px;border-radius:12px;margin-bottom:20px;border:2px solid var(--cyan);}
  .apv-progress{color:var(--yellow);font-size:11px;font-weight:bold;margin-bottom:10px;letter-spacing:1px;}
  .apv-label{color:var(--cyan);font-size:14px;font-weight:bold;margin-bottom:6px;}
  .apv-desc{color:#7fbfff;font-size:12px;font-style:italic;margin-bottom:12px;}
  .apv-cmd{background:#04080f;border:1px solid var(--border);border-radius:6px;
    padding:12px;overflow-x:auto;margin-bottom:14px;}
  .apv-cmd code{color:#a8d8ea;font-size:12px;font-family:'Courier New',monospace;white-space:pre;}
  .apv-btns{display:flex;gap:10px;flex-wrap:wrap;}
  .btn-approve{background:linear-gradient(90deg,#1a6a1a,#22c55e);color:#fff;padding:8px 20px;font-size:13px;}
  .btn-skip{background:#1e3a5f;color:var(--cyan);padding:8px 16px;font-size:13px;}
  .btn-cancel{background:#3a1a1a;color:var(--red);padding:8px 16px;font-size:13px;}
  .apv-done{color:var(--green);font-size:14px;font-weight:bold;padding:8px 0;}
</style>
</head>
<body>

<div class="header">
  <svg width="46" height="46" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="hbg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#0d0d1a"/><stop offset="100%" style="stop-color:#0a1628"/>
      </linearGradient>
      <linearGradient id="hbtn" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" style="stop-color:#0057a8"/><stop offset="100%" style="stop-color:#00b4d8"/>
      </linearGradient>
      <filter id="hglow"><feGaussianBlur stdDeviation="1.5" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <rect width="100" height="100" rx="16" fill="url(#hbg)"/>
    <g stroke="#00e5ff" stroke-width="0.3" opacity="0.15">
      <line x1="25" y1="0" x2="25" y2="100"/><line x1="50" y1="0" x2="50" y2="100"/>
      <line x1="75" y1="0" x2="75" y2="100"/><line x1="0" y1="25" x2="100" y2="25"/>
      <line x1="0" y1="50" x2="100" y2="50"/><line x1="0" y1="75" x2="100" y2="75"/>
    </g>
    <g stroke="#00e5ff" stroke-width="2.5" fill="none" opacity="0.9" filter="url(#hglow)">
      <polyline points="8,20 8,8 20,8"/><polyline points="80,8 92,8 92,20"/>
      <polyline points="8,80 8,92 20,92"/><polyline points="80,92 92,92 92,80"/>
    </g>
    <polygon points="50,18 68,28 68,52 50,62 32,52 32,28" fill="none" stroke="#00e5ff" stroke-width="1.5" opacity="0.5"/>
    <polygon points="42,34 42,56 63,45" fill="url(#hbtn)" filter="url(#hglow)"/>
    <text x="50" y="80" text-anchor="middle" font-family="Courier New,monospace" font-size="7" fill="#00e5ff" letter-spacing="2" opacity="0.85">QUESTA</text>
    <text x="50" y="89" text-anchor="middle" font-family="Courier New,monospace" font-size="5" fill="#446688" letter-spacing="1.5">LAUNCHER</text>
  </svg>
  <div>
    <h1>${title}</h1>
    <p>VSQuestaLauncher v1.8 — SystemVerilog simulation for VS Code</p>
  </div>
</div>

<div class="tabs">
  <button class="tab active" onclick="showTab('readme',this)">📖 README</button>
  <button class="tab" onclick="showTab('deps',this)">📦 Dependencies</button>
  <button class="tab" onclick="showTab('commands',this)">⌨ Commands</button>
</div>

<div class="content">

  <!-- README -->
  <div id="readme" class="page active">${body}</div>

  <!-- DEPS -->
  <div id="deps" class="page">
    <h2>📦 Dependency Resolver</h2>
    <p style="margin-bottom:14px">Each section shows its commands grouped by OS.
      Click <strong>▶ Run</strong> to send a single command to the terminal, or
      <strong>▶ Run All</strong> to step through the entire section — each command requires your approval before it executes.</p>

    <!-- Approval overlay (sticky, shown during Run All) -->
    <div id="approvalOverlay"></div>

    <!-- Status bar -->
    <div id="depLog">Ready — click ▶ Run on any block, or ▶ Run All on a section.</div>

    <!-- Command blocks injected here -->
    <div id="cmdBlocks"></div>
  </div>

  <!-- COMMANDS ref (rendered markdown) -->
  <div id="commands" class="page">
    <h2>⌨ Commands Reference</h2>
    <div id="cmdRef"><p style="color:var(--muted)">Loading…</p></div>
  </div>

</div>

<script>
const vscode = acquireVsCodeApi();
const blocks = ${blocksJson};

// ── tab switching ──────────────────────────────────────────────────────────
function showTab(id, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (btn) btn.classList.add('active');
  if (id === 'deps')     buildDepBlocks();
  if (id === 'commands') buildCmdRef();
}

// ── helpers ────────────────────────────────────────────────────────────────
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function osTag(label) {
  if (/windows/i.test(label)) return '<span class="os-badge os-windows">Windows</span>';
  if (/linux/i.test(label))   return '<span class="os-badge os-linux">Linux</span>';
  return '';
}

function secBadge(sec) {
  if (/^Build/i.test(sec))   return '<span class="sec-badge sec-build">🔨 Build</span>';
  if (/^Install/i.test(sec)) return '<span class="sec-badge sec-install">📦 Install</span>';
  if (/^CLI/i.test(sec))     return '<span class="sec-badge sec-cli">⌨ CLI</span>';
  if (/^GUI/i.test(sec))     return '<span class="sec-badge sec-gui">🖥 GUI</span>';
  return '';
}

function sectionIcon(sec) {
  if (/^Build/i.test(sec))   return '🔨';
  if (/^Install/i.test(sec)) return '📦';
  if (/^CLI/i.test(sec))     return '⌨';
  if (/^GUI/i.test(sec))     return '🖥';
  return '📋';
}

// ── build dep blocks (grouped by section) ─────────────────────────────────
function buildDepBlocks() {
  const el = document.getElementById('cmdBlocks');
  if (el.dataset.built) return;
  el.dataset.built = '1';
  if (!blocks.length) { el.innerHTML = '<p style="color:var(--muted)">No command blocks found in COMMANDS.md.</p>'; return; }

  // Group blocks by section, preserving order
  const secOrder = [];
  const secMap = {};
  blocks.forEach((b, i) => {
    if (!secMap[b.section]) { secMap[b.section] = []; secOrder.push(b.section); }
    secMap[b.section].push({ ...b, idx: i });
  });

  let html = '';
  for (const sec of secOrder) {
    const grp = secMap[sec];
    const icon = sectionIcon(sec);
    html += \`
      <div class="section-group">
        <div class="section-header">
          <span class="section-title">\${icon} \${esc(sec)} <span class="section-count">\${grp.length} command\${grp.length>1?'s':''}</span></span>
          <button class="btn btn-run-all" onclick="startRunAll('\${esc(sec)}')">▶ Run All</button>
        </div>
        \${grp.map(b => \`
          <div class="cmd-block">
            <div class="cmd-header">
              <span class="cmd-label">\${osTag(b.label)} \${esc(b.label)}</span>
              <div class="btn-group">
                <button class="btn btn-copy" onclick="copyCmd(\${b.idx})">📋 Copy</button>
                <button class="btn btn-run"  onclick="runCmdSingle(\${b.idx})">▶ Run</button>
              </div>
            </div>
            \${b.desc ? \`<div class="cmd-desc">\${esc(b.desc)}</div>\` : ''}
            <div class="cmd-body"><pre><code>\${esc(b.cmd)}</code></pre></div>
          </div>
        \`).join('')}
      </div>
    \`;
  }
  el.innerHTML = html;
}

// ── single run ─────────────────────────────────────────────────────────────
function runCmdSingle(i) {
  const log = document.getElementById('depLog');
  log.style.color = '#7fbfff';
  log.textContent = '▶ Sending to terminal: ' + blocks[i].label + '…';
  vscode.postMessage({ type: 'runCmd', cmd: blocks[i].cmd, label: blocks[i].label });
}

function copyCmd(i) {
  vscode.postMessage({ type: 'copy', text: blocks[i].cmd });
}

// ── Run All — step-through with approval ───────────────────────────────────
let runQueue = [], runIdx = 0;

function startRunAll(section) {
  runQueue = blocks.filter(b => b.section === section);
  runIdx   = 0;
  showApprovalStep();
}

function showApprovalStep() {
  const ov  = document.getElementById('approvalOverlay');
  const log = document.getElementById('depLog');

  if (runIdx >= runQueue.length) {
    ov.style.display = 'block';
    ov.innerHTML = \`<div class="apv-done">✅ All \${runQueue.length} commands in "\${esc(runQueue[0]?.section||'')}" sent to terminal.</div>
      <button class="btn btn-copy" style="margin-top:8px" onclick="closeApproval()">Close</button>\`;
    log.style.color = 'var(--green)';
    log.textContent = '✓ Run All complete — ' + runQueue.length + ' commands sent.';
    return;
  }

  const b = runQueue[runIdx];
  ov.style.display = 'block';
  ov.innerHTML = \`
    <div class="apv-progress">STEP \${runIdx+1} OF \${runQueue.length} &nbsp;·&nbsp; \${esc(b.section)}</div>
    <div class="apv-label">\${osTag(b.label)} \${esc(b.label)}</div>
    \${b.desc ? \`<div class="apv-desc">\${esc(b.desc)}</div>\` : ''}
    <div class="apv-cmd"><code>\${esc(b.cmd)}</code></div>
    <div class="apv-btns">
      <button class="btn btn-approve btn-run" onclick="approveStep()">✓ Approve &amp; Run</button>
      <button class="btn btn-skip   btn-copy" onclick="skipStep()">⏭ Skip</button>
      <button class="btn btn-cancel"          onclick="cancelRunAll()">✗ Cancel</button>
    </div>
  \`;

  // Scroll the overlay into view
  ov.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function approveStep() {
  const b   = runQueue[runIdx];
  const log = document.getElementById('depLog');
  log.style.color = '#7fbfff';
  log.textContent = \`▶ [\${runIdx+1}/\${runQueue.length}] \${b.label}\`;
  vscode.postMessage({ type: 'runCmd', cmd: b.cmd, label: b.label });
  runIdx++;
  setTimeout(showApprovalStep, 400);
}

function skipStep() { runIdx++; showApprovalStep(); }

function cancelRunAll() {
  const log = document.getElementById('depLog');
  log.style.color = 'var(--red)';
  log.textContent = \`✗ Run All cancelled at step \${runIdx+1} of \${runQueue.length}.\`;
  closeApproval();
}

function closeApproval() {
  const ov = document.getElementById('approvalOverlay');
  ov.style.display = 'none';
  ov.innerHTML = '';
}

// ── commands reference page (rendered markdown) ───────────────────────────
function buildCmdRef() {
  vscode.postMessage({ type: 'getCommands' });
}

// ── messages from extension ───────────────────────────────────────────────
window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'cmdResult') {
    const log = document.getElementById('depLog');
    log.textContent  = msg.text;
    log.style.color  = msg.ok ? 'var(--green)' : 'var(--red)';
  }
  if (msg.type === 'cmdRef') {
    document.getElementById('cmdRef').innerHTML = msg.html;
  }
  if (msg.type === 'copied') {
    const log = document.getElementById('depLog');
    log.textContent = '📋 Copied to clipboard.';
    log.style.color = 'var(--cyan)';
  }
});

// Build dep blocks immediately if deps page is active on load
if (document.getElementById('deps').classList.contains('active')) buildDepBlocks();
</script>
</body>
</html>`;

  return panel;
}

async function showHelpDocs(context: vscode.ExtensionContext): Promise<void> {
  const mdPath = path.join(context.extensionPath, 'README.md');
  const md = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : '# README not found';
  const panel = buildHelpPanel(context, '❓ VSQuestaLauncher Help', md, false);
  panel.webview.onDidReceiveMessage(async msg => {
    if (msg.type === 'copy') {
      await vscode.env.clipboard.writeText(msg.text);
      vscode.window.showInformationMessage('Copied to clipboard.');
    }
  });
}

async function showHelpDeps(context: vscode.ExtensionContext): Promise<void> {
  const mdPath = path.join(context.extensionPath, 'DEPENDENCY.md');
  const md = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : '# DEPENDENCY.md not found';
  const panel = buildHelpPanel(context, '📦 Dependency Resolver', md, true);

  const terminal = vscode.window.createTerminal('Questa Dep Installer');

  panel.webview.onDidReceiveMessage(async msg => {
    if (msg.type === 'copy') {
      await vscode.env.clipboard.writeText(msg.text);
      vscode.window.showInformationMessage('📋 Copied to clipboard.');
      panel.webview.postMessage({ type: 'copied' });
    }
    if (msg.type === 'runCmd') {
      terminal.show(true);
      const lines = msg.cmd.split('\n').filter((l: string) => l.trim() && !l.trim().startsWith('#'));
      for (const line of lines) {
        terminal.sendText(line);
      }
      panel.webview.postMessage({ type: 'cmdResult', text: `✓ Sent to terminal: "${msg.label}"`, ok: true });
    }
    if (msg.type === 'getCommands') {
      const cmdPath = path.join(context.extensionPath, 'COMMANDS.md');
      const cmdMd = fs.existsSync(cmdPath) ? fs.readFileSync(cmdPath, 'utf8') : '';
      panel.webview.postMessage({ type: 'cmdRef', html: mdToHtml(cmdMd) });
    }
  });
}



async function runQuestaGui(uri?: vscode.Uri): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const fileUri = uri || editor?.document.uri;
  if (!fileUri) { vscode.window.showErrorMessage('No .sv file open.'); return; }

  const openedFile = fileUri.fsPath;
  const dir = path.dirname(openedFile);
  const confPath = path.join(dir, 'conf.svconf');
  const cfg = vscode.workspace.getConfiguration('questaLauncher');

  const allFiles = fs.readdirSync(dir)
    .filter((f: string) => f.endsWith('.sv'))
    .map((f: string) => path.join(dir, f));

  if (allFiles.length === 0) { vscode.window.showErrorMessage('No .sv files found in directory.'); return; }

  const conf = parseConf(confPath);
  const ordered = orderFiles(allFiles, openedFile, conf);
  const runDoPath = path.join(dir, 'run.do');

  // GUI mode: vlib + vlog + vopt + vsim + add wave -r /* + run -all (no quit — keeps GUI open)
  const guiDo = generateRunDo(ordered, conf, cfg, 'gui');
  fs.writeFileSync(runDoPath, guiDo, 'utf8');

  const questa = resolveQuesta(cfg);
  const env = resolveEnv(cfg);
  const questaDir = path.dirname(questa);
  if (questaDir && questaDir !== '.') env['PATH'] = questaDir + ':' + (env['PATH'] || '');

  // Derive top module name for log
  const conf2 = parseConf(confPath);
  const tbFile2 = conf2.tbName
    || ordered.map((f: string) => path.basename(f)).find((b: string) => b.includes('_tb') || b.startsWith('tb_'))
    || '';
  const topModule2 = conf2.topModule
    || (tbFile2 ? tbFile2.replace(/\.sv$/i, '') : '')
    || path.basename(ordered[ordered.length - 1]).replace(/\.sv$/i, '');

  const channel = vscode.window.createOutputChannel('Questa Launcher');
  channel.show(true);
  channel.appendLine(`🖥 Questa Launcher  [GUI — with waveforms]`);
  channel.appendLine(`  Dir:   ${dir}`);
  channel.appendLine(`  Files: ${ordered.map((f: string) => path.basename(f)).join(', ')}`);
  channel.appendLine(`  Top:   ${topModule2}`);
  channel.appendLine(`  run.do: ${runDoPath}`);
  channel.appendLine('─'.repeat(60));

  // Launch WITHOUT -c so the GUI opens; detached so it outlives VS Code
  const proc = child_process.spawn(
    questa,
    ['-do', `cd ${dir}; do run.do`],
    { cwd: dir, env, detached: true, stdio: 'ignore' }
  );
  proc.unref();

  vscode.window.showInformationMessage(`🖥 Questa GUI launched for ${topModule2} — waveforms loading automatically.`);
  channel.appendLine(`✓ Questa GUI launched (PID detached). Close the Questa window when done.`);
}



// ─── show waveform (open existing vsim.wlf in GUI) ───────────────────────

async function showWaveform(uri?: vscode.Uri): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const fileUri = uri || editor?.document.uri;
  if (!fileUri) { vscode.window.showErrorMessage('No .sv file open.'); return; }

  const dir = path.dirname(fileUri.fsPath);
  const wlfPath = path.join(dir, 'vsim.wlf');
  const cfg = vscode.workspace.getConfiguration('questaLauncher');

  // If no WLF yet, prompt user to run a simulation first
  if (!fs.existsSync(wlfPath)) {
    const choice = await vscode.window.showWarningMessage(
      'No vsim.wlf found in this directory. Run a simulation first to generate the waveform file.',
      'Run CLI (headless)',
      'Run GUI (with waveforms)'
    );
    if (choice === 'Run CLI (headless)') await runCli(uri);
    else if (choice === 'Run GUI (with waveforms)') await runQuestaGui(uri);
    return;
  }

  const questa = resolveQuesta(cfg);
  const env = resolveEnv(cfg);
  const questaDir = path.dirname(questa);
  if (questaDir && questaDir !== '.') env['PATH'] = questaDir + ':' + (env['PATH'] || '');

  // Write a small wave.do using the official Questa waveform command from run.do
  const waveDo = path.join(dir, 'wave.do');
  fs.writeFileSync(waveDo,
    `# wave.do — generated by VSQuestaLauncher (Show WaveForm)\n` +
    `add wave -r /*\n` +
    `wave zoom full\n`,
    'utf8'
  );

  const channel = vscode.window.createOutputChannel('Questa Launcher');
  channel.show(true);
  channel.appendLine(`〰 Questa Launcher  [Show WaveForm only]`);
  channel.appendLine(`  WLF:    ${wlfPath}`);
  channel.appendLine(`  wave.do: ${waveDo}`);
  channel.appendLine(`  vsim:   ${questa}`);
  channel.appendLine('─'.repeat(60));

  // Launch Questa GUI to view the existing WLF — detached so it outlives VS Code
  // vsim -view <wlf> loads the simulation log without re-running; -do adds the wave signals
  const proc = child_process.spawn(
    questa,
    ['-view', wlfPath, '-do', waveDo],
    { cwd: dir, env, detached: true, stdio: 'ignore' }
  );
  proc.unref();

  vscode.window.showInformationMessage(`〰 WaveForm viewer opened — loading vsim.wlf`);
  channel.appendLine(`✓ Questa WaveForm viewer launched (PID detached).`);
}



async function setLicense(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('questaLauncher');
  const currentSalt = cfg.get<string>('saltLicenseServer') || process.env['SALT_LICENSE_SERVER'] || '';
  const currentLm   = cfg.get<string>('licenseFile') || process.env['LM_LICENSE_FILE'] || '';

  type LicItem = vscode.QuickPickItem & { action: string };

  const items: LicItem[] = [
    {
      label:       '$(key) SALT_LICENSE_SERVER',
      description: currentSalt || '(not set)',
      detail:      'Questa FSE / Starter Edition — path to .dat file or port@host',
      action:      'salt'
    },
    {
      label:       '$(file) LM_LICENSE_FILE',
      description: currentLm || '(not set)',
      detail:      'General FlexLM — path to license file or port@host',
      action:      'lm'
    },
    {
      label:       '$(folder-opened) Browse for license file…',
      description: '',
      detail:      'Open a file picker to locate your .dat / .lic file',
      action:      'browse'
    },
    {
      label:       '$(refresh) Auto-detect from environment',
      description: '',
      detail:      'Re-read SALT_LICENSE_SERVER / LM_LICENSE_FILE from your shell environment',
      action:      'autodetect'
    }
  ];

  const pick = await vscode.window.showQuickPick(items, {
    title: '🔑 Questa License Configuration',
    placeHolder: 'Select a license setting to configure'
  });
  if (!pick) return;

  if (pick.action === 'browse') {
    const uris = await vscode.window.showOpenDialog({
      title: 'Select Questa license file',
      filters: { 'License files': ['dat', 'lic'], 'All files': ['*'] },
      canSelectMany: false,
      openLabel: 'Use this license'
    });
    if (!uris || uris.length === 0) return;
    const chosen = uris[0].fsPath;
    await cfg.update('saltLicenseServer', chosen, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`✓ SALT_LICENSE_SERVER set to: ${chosen}`);
    return;
  }

  if (pick.action === 'autodetect') {
    const detected = process.env['SALT_LICENSE_SERVER'] || process.env['LM_LICENSE_FILE'] || '';
    if (!detected) {
      vscode.window.showWarningMessage('No license environment variables found in current shell. Set SALT_LICENSE_SERVER in ~/.bashrc and restart VS Code.');
      return;
    }
    await cfg.update('saltLicenseServer', process.env['SALT_LICENSE_SERVER'] || '', vscode.ConfigurationTarget.Global);
    await cfg.update('licenseFile',       process.env['LM_LICENSE_FILE']     || '', vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`✓ License auto-detected: ${detected}`);
    return;
  }

  // Manual text entry for salt or lm
  const isSalt = pick.action === 'salt';
  const label   = isSalt ? 'SALT_LICENSE_SERVER' : 'LM_LICENSE_FILE';
  const current = isSalt ? currentSalt : currentLm;
  const value   = await vscode.window.showInputBox({
    title:       `Set ${label}`,
    prompt:      'Enter full path to license file (e.g. /home/user/.licenses/questa_license.dat) or port@host',
    value:       current,
    placeHolder: '/home/bismillah/.licenses/questa_license.dat'
  });
  if (value === undefined) return;

  const key = isSalt ? 'saltLicenseServer' : 'licenseFile';
  await cfg.update(key, value, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`✓ ${label} set to: ${value}`);
}



async function editConf(uri?: vscode.Uri): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const fileUri = uri || editor?.document.uri;
  if (!fileUri) { vscode.window.showErrorMessage('No file open.'); return; }

  const dir = path.dirname(fileUri.fsPath);
  const confPath = path.join(dir, 'conf.svconf');

  if (!fs.existsSync(confPath)) {
    const allBases = fs.readdirSync(dir).filter(f => f.endsWith('.sv'));
    const openedBase = path.basename(fileUri.fsPath);
    fs.writeFileSync(confPath, defaultConfTemplate(openedBase, allBases), 'utf8');
    vscode.window.showInformationMessage('Created conf.svconf');
  }

  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(confPath));
  await vscode.window.showTextDocument(doc);
}

// ─── set priority ─────────────────────────────────────────────────────────

async function setPriority(uri?: vscode.Uri): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const fileUri = uri || editor?.document.uri;
  if (!fileUri) { vscode.window.showErrorMessage('No .sv file open.'); return; }

  const dir = path.dirname(fileUri.fsPath);
  const confPath = path.join(dir, 'conf.svconf');
  const allFiles = fs.readdirSync(dir)
    .filter(f => f.endsWith('.sv'))
    .map(f => path.join(dir, f));

  await runPriorityPicker(allFiles, fileUri.fsPath, confPath);
}

// ─── activation ───────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('questaLauncher.run',           runCli),
    vscode.commands.registerCommand('questaLauncher.runGui',        runQuestaGui),
    vscode.commands.registerCommand('questaLauncher.showWaveform',  showWaveform),
    vscode.commands.registerCommand('questaLauncher.editConf',      editConf),
    vscode.commands.registerCommand('questaLauncher.setPriority',   setPriority),
    vscode.commands.registerCommand('questaLauncher.setLicense',    setLicense),
    vscode.commands.registerCommand('questaLauncher.helpDocs', () => showHelpDocs(context)),
    vscode.commands.registerCommand('questaLauncher.helpDeps', () => showHelpDeps(context))
  );

  // Status bar button
  const sb = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  sb.command = 'questaLauncher.run';
  sb.text = '$(play) Questa';
  sb.tooltip = 'Run in Questa Simulator';
  sb.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  context.subscriptions.push(sb);

  const updateSb = () => {
    const ext = vscode.window.activeTextEditor?.document.uri.fsPath;
    sb.text = ext?.endsWith('.sv') ? '$(play) Questa' : '$(play) Questa';
    if (ext?.endsWith('.sv') || ext?.endsWith('.svconf')) sb.show();
    else sb.hide();
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateSb)
  );
  updateSb();
}

export function deactivate(): void {}
