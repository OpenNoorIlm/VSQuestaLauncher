# MultiHD Launcher

<p align="center">
  <img src="images/icon-128.png" width="96" height="96" alt="MultiHD Launcher logo"/>
</p>

**MultiHD Launcher** (formerly **Questa Launcher**) is a VS Code / VS Code Insiders extension
that turns a folder of SystemVerilog files into a one-click
**Questa FSE · Quartus Prime · Gowin EDA** project flow — no terminal required.

> **⚠ Name change / archival note:** This extension was previously called **QuestaLauncher**
> (`questa-launcher`, "Questa Launcher"). It was renamed to **MultiHD Launcher**
> (`multihd-launcher`) in **v2.0.0** to reflect its expanded support for Quartus Prime and
> Gowin EDA in addition to Questa Intel FPGA FSE. Old command IDs (`questaLauncher.*`) and
> settings remain registered as aliases for existing keybindings. Release archives
> (`questa-launcher-*.vsix` in the repository root) keep their original titles as an
> archival record.

---

## Launcher panel

**🚀 Open MultiHD Launcher** reveals the main launcher panel — the VS Code equivalent of
the Qt app's main window:

| Area | Contents |
|---|---|
| Header | Logo, title, subtitle `QUESTA FSE  •  QUARTUS PRIME  •  GOWIN EDA` |
| License badge | `✓ LICENSE OK` or `⚠ LICENSE NOT SET — configure before launching Questa!` |
| Project folder | Path input (placeholder `Select project folder...`) + `Browse` |
| Excluded files | `EXCLUDED FILES  [<n>]` area with `↩ restore` chips, or `no files excluded` |
| Actions | `⇅   COMPILE ORDER` · `✕   DISINCLUDE` · `📦   LIBRARIES` · `⚙   CONFIG` |
| COMPILE FOR | `⬡  Questa / Modelsim` (checked by default), `◈  Quartus Prime`, `◆  Gowin EDA` |
| Launch | Big gradient `▶   LAUNCH` button — becomes `⚠   LAUNCH  (Questa: no license!)` when the license is missing |
| Install | `⬇   INSTALL QUESTA` · `🔑   LICENSE REQUEST` |
| Log | Live colour-coded launch transcript (placeholder `// output will appear here...`) |

The panel uses the app's dark cyber theme: `#0d0d1a` background, cyan `#00e5ff` accents,
30 px grid lines, corner brackets, cyan glow and a monospace font.

---

## Features

| Feature | Detail |
|---|---|
| 🚀 **Launcher panel** | One control surface for project, targets, exclusions, license and launch |
| ⬡ **Questa FSE** | `run.do` generation (CLI / GUI / waveform variants), license guard, library `-L` flags |
| ◈ **Quartus Prime** | `.qpf`, `.qsf` and `.sdc` timing template generation; opens Quartus with the `.qpf` |
| ◆ **Gowin EDA** | `.gprj`, `.f` generation + interactive `.cst` pin-assignment editor; opens `gw_ide` with the `.gprj` |
| ⇅ **Compile order** | Click-to-order webview: selected files first, the rest after; reverse / reset / done (Questa flow) |
| ✕ **Per-file exclusion** | Disinclude webview with quick-selects; excluded files drop out of every generated file |
| 📦 **Library manager** | Global registry + per-project dependencies + compile; `-L` flags in `run.do` |
| ⚙ **Configuration** | The Qt app's 7 config fields, with Browse buttons and a live license banner |
| 🔑 **License guard** | Blocks Questa launch and warns visually when the license file is missing |
| ⬇ **Install helpers** | Direct links to the Questa FSE download page and the Intel license portal |
| 🧩 **conf.svconf** | Per-project compile mode, top module, testbench, `vsim`/`vlog` args and compile order |
| 🎨 **Dark cyber UI** | All webviews use the reference app's dark cyan palette and monospace typography |
| 📦 **Dependency resolver** | Command library with **📋 Copy**, **▶ Run** and step-by-step **▶ Run All** |

---

## Commands

All commands are available from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`);
the most common ones also appear on the `.sv` editor title bar and in the Explorer
context menu.

| Command | ID | Title |
|---|---|---|
| Launcher panel | `multihdLauncher.openLauncher` | 🚀 Open MultiHD Launcher |
| Run CLI | `multihdLauncher.run` | ▶ Run CLI |
| Run GUI | `multihdLauncher.runGui` | 🖥 Run GUI |
| Show WaveForm | `multihdLauncher.showWaveform` | 〰 Show WaveForm |
| Launch Questa | `multihdLauncher.launchQuesta` | ⬡ Launch Questa |
| Launch Quartus | `multihdLauncher.launchQuartus` | ◈ Launch Quartus Prime |
| Launch Gowin | `multihdLauncher.launchGowin` | ◆ Launch Gowin EDA |
| Configuration | `multihdLauncher.setConfig` | ⚙ Configuration |
| Set License | `multihdLauncher.setLicense` | 🔑 Set License |
| Compile Order | `multihdLauncher.setPriority` | ⇅ Compile Order |
| Exclude Files | `multihdLauncher.excludeFiles` | ✕ Exclude Files |
| Library Manager | `multihdLauncher.libraryManager` | 📦 Library Manager |
| Gowin CST Editor | `multihdLauncher.gowinCst` | ◆ Gowin CST Editor |
| Install / License Helpers | `multihdLauncher.installHelpers` | ⬇ Install / License Helpers |
| Edit conf.svconf | `multihdLauncher.editConf` | ⚙ Edit conf.svconf |
| Help | `multihdLauncher.helpDocs` | ❓ MultiHD Launcher Help |
| Dependency Resolver | `multihdLauncher.helpDeps` | 📦 Dependency Resolver |

Legacy IDs (`questaLauncher.run`, `.runGui`, `.showWaveform`, `.setQuestaPath`,
`.editConf`, `.setPriority`, `.setLicense`, `.helpDocs`, `.helpDeps`) are registered as
hidden aliases that map to the same handlers.

---

## Questa FSE — launch modes

| Command | What it does |
|---|---|
| **▶ Run CLI** | Headless `vsim -c` — compiles, runs, streams output to the **Output → MultiHD Launcher** panel, quits. **No waveform window.** Fastest path to pass/fail. |
| **🖥 Run GUI** | Full Questa GUI — compiles, loads `add wave -r /*` + `run -all`. Window stays open for interactive waveform inspection. |
| **〰 Show WaveForm** | Opens the existing `vsim.wlf` **without re-running** the simulation. If no `.wlf` exists yet, prompts you to run CLI or GUI first. |
| **⬡ Launch Questa** | Qt-parity launch: license guard → generate `run.do` → spawn `vsim -gui -do run.do` with the project folder as the working directory (space-safe, equivalent to the Qt app's `cd <dir>; do <dir>/run.do`) |

### Generated `run.do`

```tcl
# Questa run script — generated by MultiHD Launcher
# 2026-10-30T16:00:00

quietly vlib work
vlog -work work byte_register.sv counter16.sv counter16_tb.sv
vopt +acc work.counter16_tb -o counter16_tb_opt
vsim counter16_tb_opt
add wave -r /*
run -all
```

When project libraries are linked, `run.do` also compiles each dependency into its shared
work database and passes `-L` flags to `vlog`, `vopt` and `vsim`. A dependency that has not
been compiled yet produces the warning
`⚠ Library "<name>" not compiled — open 📦 LIBRARIES.`.

### CLI vs GUI

| Mode | `add wave -r /*` | `quit -f` |
|------|-----------------|-----------|
| CLI | ✗ omitted | ✅ appended |
| GUI | ✅ included | ✗ omitted (keeps window open) |

---

## Quartus Prime — generated files

| File | Purpose |
|---|---|
| `<project>.qpf` | Quartus Prime project file (`QUARTUS_VERSION`, `DATE`, `PROJECT_REVISION`) |
| `<project>.qsf` | Quartus settings: family, device, top-level entity, SystemVerilog file list, SDC reference |
| `<project>.sdc` | Timing-constraints template — **only written if missing**, so hand edits are preserved |
| `output_files/` | Output directory pre-created |

If a Quartus binary is configured (`multihdLauncher.quartusPath`) or `quartus` is on
`PATH`, the generated `.qpf` is opened in Quartus Prime; otherwise the files are written
and a warning is logged.

---

## Gowin EDA — generated files

Selecting **◆ Gowin EDA** opens the constraint editor first:

| File | Purpose |
|---|---|
| `<project>.gprj` | Gowin IDE project XML (device, file list, top module) |
| `<project>.cst` | Physical constraint file — pin `IO_LOC` assignments |
| `<project>.f` | File list for `vlog` / `iverilog -f` simulation flows |
| `impl/pnr/` | Output directory pre-created for Gowin place-and-route |

The **◆ Gowin CST Editor** webview auto-detects ports from the top-module `.sv` file,
groups them into Inputs / Outputs / Bidirectional and generates a filled constraint template.
Replace the placeholder `XX` pin numbers with the actual LOC values from your board's
schematic. A built-in device dropdown covers the common GW1N/GW1NR/GW1NSR boards plus a
custom device entry. Cancelling the editor writes no Gowin files.

If a Gowin binary is configured (`multihdLauncher.gowinPath`) or `gw_ide` is on `PATH`, the
generated `.gprj` is opened in Gowin EDA; otherwise the files are written and a warning is
logged.

---

## Compile order & per-file exclusion

- **`⇅   COMPILE ORDER`** opens a webview where clicking a file toggles its priority:
  `[01]  file` (selected, green) and `[ ]  file` (dim) — hint
  `CLICK FILE TO SET PRIORITY  •  CLICK AGAIN TO REMOVE`. The `⇅  REVERSE`, `✕  RESET` and
  `✓  DONE` buttons set the order; the button then reads `⇅   ORDER SET  ✓`. The resulting
  order is *selected files first, then the rest*, and — exactly like the Qt app — it applies to
  the **Questa flow only**. Quartus Prime and Gowin EDA file lists use the sorted `.sv` files
  minus exclusions and ignore the custom order.
- **`✕   DISINCLUDE`** (with exclusions: `✕   DISINCLUDE  [<n> hidden]`) opens the
  `✕   DISINCLUDE FILES` checklist with the hint
  `Checked files are excluded from compilation and the compile-order dialog.` and quick-select
  buttons `Select all _tb.sv`, `Select all .sv`, `Clear all`; `✓   APPLY` saves. Excluded files
  are dimmed red, appear as chips in the launcher's EXCLUDED FILES area with `↩ restore`, and
  are removed from the Questa, Quartus and Gowin file lists as well as from the compile-order
  dialog input.

---

## Library manager

The **📦 Library Manager** webview manages shared, pre-compiled libraries:

| Item | Location |
|---|---|
| Library registry | `~/.questa_libs/registry.json` |
| Compiled work libraries | `~/.questa_libs/work/<library>` |
| Per-project dependency list | `<project>/questa_libs.json` |

A library is added with `＋  ADD LIBRARY` (name + a source folder containing at least one `.sv`
file) and compiled with `⚡  COMPILE`; compiling runs `vlib` and `vlog` in its shared work
database and records `compiled` / `compiledAt`. Projects then tick their dependencies
(`✓   DONE` saves); the generated `run.do` compiles them and links them with `-L` flags.
`✕  REMOVE` deletes a library and its work database.

---

## Configuration

**⚙ Configuration** exposes the seven fields of the Qt config dialog:

| Field | Qt name | Example |
|---|---|---|
| vsim binary | `vsimPath` | `~/altera/25.1std/questa_fse/linux_x86_64/vsim` |
| License file | `licenseFile` | `~/.licenses/questa_license.dat` |
| Default folder | `defaultFolder` | `~/projects/` |
| Quartus binary | `quartusPath` | `/usr/bin/quartus` |
| Gowin IDE binary | `gowinPath` | `/opt/gowin/IDE/bin/gw_ide` |
| `SALT_LICENSE_SERVER` | `saltLicenseServer` | license path or `port@host` |
| `MTI_VCO_MODE` | `mtiVcoMode` | `64` |

Every field has a `Browse` button. The dialog (`MultiHD Launcher — Configuration`, heading
`⚙   CONFIGURATION`) shows a live banner with three states:

| State | Banner text |
|---|---|
| license not set | `⚠  LICENSE FILE NOT SET  —  Questa will not start without a valid license.` |
| license path missing | `⚠  LICENSE FILE NOT FOUND  at:  <path>` |
| license found | `✓  License file found — Questa should start correctly.` |

Invalid fields are highlighted red; `✓   SAVE` persists the values as settings.

---

## Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `multihdLauncher.vsimPath` | `""` | Full path to the `vsim` binary (empty → auto-detect) |
| `multihdLauncher.questaBin` | `""` | Questa `linux_x86_64` / `win64` bin directory (legacy-compatible) |
| `multihdLauncher.licenseFile` | `""` | `LM_LICENSE_FILE` — license file path; also used by the license guard |
| `multihdLauncher.saltLicenseServer` | `""` | `SALT_LICENSE_SERVER` — falls back to the license file |
| `multihdLauncher.licenseServer` | `""` | `MGLS_LICENSE_FILE` — license server |
| `multihdLauncher.alteraLicenseFile` | `""` | `ALTERAD_LICENSE_FILE` — Altera/Intel license |
| `multihdLauncher.mtiVcoMode` | `"64"` | `MTI_VCO_MODE` / `QSIM_VCO_MODE` |
| `multihdLauncher.defaultFolder` | `""` | Default project folder |
| `multihdLauncher.quartusPath` | `""` | Quartus Prime executable |
| `multihdLauncher.gowinPath` | `""` | Gowin IDE executable (`gw_ide`) |
| `multihdLauncher.extraVlogArgs` | `"-reportprogress 300"` | Extra arguments passed to `vlog` |
| `multihdLauncher.autoOpenGui` | `false` | Open the Questa GUI after compile |

Legacy `questaLauncher.*` settings are read as fallbacks, so existing configurations keep
working after the rename.

---

## License guard & install helpers

Questa FSE requires a valid license. When `licenseFile` is empty or the file does not exist,
the extension **blocks** the Questa launch, logs
`✗ [Questa] BLOCKED: License file not configured or not found!` and offers to open
**⚙ Configuration**. Quartus and Gowin launches are unaffected.

The **⬇ Install / License Helpers** command opens the same pages as the Qt app:

| Button | URL |
|---|---|
| ⬇ INSTALL QUESTA | `https://www.intel.com/content/www/us/en/software-kit/825277/questa-intel-fpgas-standard-edition-software-version-23-1-1.html` |
| 🔑 LICENSE REQUEST | `https://licensing.intel.com/psg/s/sales-signup-evaluationlicenses` |

---

## conf.svconf

Each project directory can have a `conf.svconf` to control compile behaviour.
**⚙ Edit conf.svconf** creates one from a template.

```
# Compile mode: all | list | N
compile @(all)

# Explicit testbench
@tb (counter16_tb.sv)

# Testbench order (compiled last)
@tb priority list:
  - counter16_tb.sv

# RTL compile order (compiled first)
@priority list encoder:
  - byte_register.sv
  - counter16.sv

# Simulation top module
@topmodule: counter16_tb

# Optional overrides
# @vsimargs: -voptargs=+acc
# @vlogargs: -sv
# @work: work
```

The extension also ships an `svconf` language mode and TextMate grammar for syntax
highlighting of `*.svconf` files.

---

## Help & Dependency Resolver

Two webview panels are provided:

| Command | What it opens |
|---|---|
| **❓ MultiHD Launcher Help** | In-editor help panel — README, dependency list and commands reference |
| **📦 Dependency Resolver** | Interactive installer — grouped command blocks with **📋 Copy**, **▶ Run** and **▶ Run All** (per-step approval) |

### Dependency Resolver — sections

| Section | Steps | What it installs / does |
|---------|-------|------------------------|
| **🔨 Build** | 8 × Linux + 8 × Windows | Node.js → TypeScript → vsce → project deps → compile → package `.vsix` → install |
| **📦 Install** | 6 × Linux + 5 × Windows | Questa FSE download page → installer → PATH + license env vars → verify |
| **⌨ CLI** | 2 × Linux + 2 × Windows | Uninstall / reinstall the extension from the command line |
| **🖥 GUI** | 1 × Linux + 1 × Windows | Install VS Code Insiders itself (`.deb` or `winget`) |

Every `▶ Run All` step requires explicit **✓ Approve & Run** before the command is sent to
the terminal. See [COMMANDS.md](COMMANDS.md) for every command and
[DEPENDENCY.md](DEPENDENCY.md) for the full dependency list.

---

## Installation

### From a `.vsix` (recommended)

```bash
code --install-extension multihd-launcher-2.0.0.vsix --force
# or, for VS Code Insiders:
code-insiders --install-extension multihd-launcher-2.0.0.vsix --force
```

### Upgrading from the old package name

The extension package was renamed from `questa-launcher` to `multihd-launcher`, so VS Code
treats it as a new extension. Uninstall the old one to avoid duplicate title-bar buttons:

```bash
# legacy v1.x package id — uninstall old installs before switching to multihd-launcher
code --uninstall-extension bismillah.questa-launcher
code --install-extension multihd-launcher-2.0.0.vsix
```

### Build from source

Requirements: Node.js ≥ 18, npm ≥ 9.

```bash
git clone https://github.com/OpenNoorIlm/VSQuestaLauncher.git
cd VSQuestaLauncher
npm install
npm run compile
npx @vscode/vsce package --no-dependencies
```

The package is written to the project root as **`multihd-launcher-2.0.0.vsix`**.
The **🔨 Build** section of the Dependency Resolver performs the same steps interactively.

---

## Project layout

```
VSQuestaLauncher/                    ← repository root (name kept for URL continuity)
├── src/
│   ├── extension.ts                 # activate(), command registration, legacy aliases, help/deps wiring
│   ├── models.ts                    # shared types (SvConf, ProjectInfo, TargetTool, ConfigValues…)
│   ├── core/
│   │   ├── config.ts                # effective settings + legacy fallback + license status
│   │   ├── project.ts               # project resolution, .sv scan, exclusion, ordering, conf.svconf
│   │   ├── state.ts                 # per-project excluded files / custom order (workspaceState)
│   │   ├── launcher.ts              # Qt-parity launch flows (Questa / Quartus / Gowin), env, spawn
│   │   └── process.ts               # spawn helpers, POSIX/Windows binary lookup
│   ├── tools/
│   │   ├── util.ts                  # ISO timestamp helper
│   │   ├── questa.ts                # run.do generation
│   │   ├── quartus.ts               # .qpf / .qsf / .sdc generation
│   │   ├── gowin.ts                 # .gprj / .cst / .f generation + port parser + device table
│   │   └── library.ts               # global registry + project deps + compile
│   └── ui/
│       ├── base.ts                  # webview helpers + dark cyber CSS
│       ├── api.ts                   # frozen host/panel interfaces
│       ├── launcherPanel.ts         # main launcher panel
│       ├── configPanel.ts           # 7-field configuration
│       ├── excludePanel.ts          # disinclude files
│       ├── priorityPanel.ts         # compile order
│       ├── cstPanel.ts              # Gowin .cst pin editor
│       └── libraryPanel.ts          # library manager
├── out/                             # Compiled JS (auto-generated)
├── images/
│   ├── multihd_launcher.svg         # Logo (SVG source, identical to the Qt app)
│   ├── icon.png                     # Extension icon 256×256 (rendered from the SVG)
│   └── icon-128.png                 # 128×128 fallback icon
├── syntaxes/svconf.tmLanguage.json  # conf.svconf syntax highlighting
├── language-configuration.json
├── package.json
├── tsconfig.json
├── README.md
├── DEPENDENCY.md
├── COMMANDS.md
└── verify/                          # Independent verification harness (dev only)
```

---

## Changelog

### v2.0.0 — MultiHD Launcher
- **Renamed** from *Questa Launcher* (`questa-launcher`) to *MultiHD Launcher* (`multihd-launcher`)
- **New branding:** logo, extension icon, output panel and docs matched to the Qt MultiHD Launcher app
- **🚀 Launcher panel:** dark cyber main window with project folder, exclusions, COMPILE FOR
  targets, license badge, LAUNCH button, install helpers and live log
- **⬡ Questa:** Qt-parity `run.do` (timestamp header, library dependencies and `-L` flags),
  license guard, `vsim -gui -do run.do` launch (project folder as working directory)
- **◈ Quartus Prime:** `.qpf` / `.qsf` / `.sdc` generation, `output_files/`, launch with the `.qpf`
- **◆ Gowin EDA:** `.gprj` / `.f` generation, interactive `.cst` pin-assignment editor with
  port auto-detection and device table, launch with the `.gprj`
- **📦 Library manager:** shared registry, per-project dependencies, compile and `-L` linking
- **⇅ Compile order** and **✕ per-file exclusion** webviews at Qt parity
- **⚙ Configuration:** the 7 Qt config fields with Browse buttons and live license banner
- **⬇ Install / License helpers** with the Qt download and licensing URLs
- **📦 Dependency resolver** rebranded, artifact `multihd-launcher-2.0.0.vsix`
- Legacy `questaLauncher.*` command IDs and settings kept as hidden aliases

### v1.x — Questa Launcher
- Questa FSE CLI / GUI / waveform launching, `run.do` generation, `conf.svconf` support,
  compile priority, in-editor help panel and dependency resolver.

---

## License

[MIT](LICENSE) © OpenNoorIlm
