# Questa Launcher — VS Code Extension

<p align="center">
  <img src="images/questa_launcher.png" width="96" alt="Questa Launcher Logo"/>
</p>

**Questa Launcher** is a VS Code / VS Code Insiders extension that lets you compile and simulate
SystemVerilog designs directly from the editor using **Questa Altera FSE (Starter Edition)** — no terminal required.

---

## Simulation Buttons

Three buttons appear on every `.sv` file's title bar:

| Button | Icon | What it does |
|--------|------|-------------|
| **▶ Run CLI** | `$(play)` | Headless `vsim -c` — compiles, runs, streams output to the Output panel, quits. **No waveform window.** Fastest path to pass/fail. |
| **🖥 Run GUI** | `$(device-desktop)` | Full Questa GUI — compiles, loads `add wave -r /*` + `run -all`. Window stays open for interactive waveform inspection. |
| **〰 Show WaveForm** | `$(symbol-event)` | Opens the existing `vsim.wlf` **without re-running** the simulation. If no `.wlf` exists yet, prompts you to run CLI or GUI first. |

### run.do differences per mode

| Mode | `add wave -r /*` | `quit -f` |
|------|-----------------|-----------|
| CLI  | ✗ omitted | ✅ appended |
| GUI  | ✅ included | ✗ omitted (keeps window open) |
| Show WaveForm | writes a separate `wave.do` | — |

---

## Help & Dependency Resolver Buttons

Two additional buttons appear beside the simulation buttons:

| Button | Icon | What it opens |
|--------|------|--------------|
| **❓ VSQuestaLauncher** | `$(question)` | In-editor help panel — README, full dependency list, and the Commands reference |
| **📦 Dependency Resolver** | `$(package)` | Interactive installer — grouped command blocks with **📋 Copy**, **▶ Run**, and **▶ Run All** (with per-step approval) |

### Dependency Resolver — Sections

The Dependency Resolver panel has **4 sections**, each with a **▶ Run All** button that steps through
commands one-by-one — every command requires your explicit **✓ Approve & Run** before it executes:

| Section | Steps | What it installs / does |
|---------|-------|------------------------|
| **🔨 Build** | 8 × Linux + 8 × Windows | Node.js → TypeScript → vsce → project deps → compile → package `.vsix` → install |
| **📦 Install** | 6 × Linux + 5 × Windows | Questa FSE download page → installer → PATH + license env vars → verify |
| **⌨ CLI** | 2 × Linux + 2 × Windows | Uninstall / reinstall the extension from the command line |
| **🖥 GUI** | 1 × Linux + 1 × Windows | Install VS Code Insiders itself (`.deb` or `winget`) |

---

## How It Works

1. Open any `.sv` file
2. Press **▶ Run CLI** or **🖥 Run GUI** — the extension:
   - Scans all `.sv` files in the same directory
   - Orders them: RTL files first, `_tb` / `tb_` files last
   - Generates a `run.do` script (CLI or GUI variant)
   - Launches `vsim` with the correct environment variables
   - Streams the transcript to **Output → Questa Launcher**

---

## conf.svconf

Each project directory can have a `conf.svconf` to control compile behaviour. Press **⚙** to create one.

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

---

## Generated run.do (GUI mode)

```tcl
quietly vlib work
vlog -work work byte_register.sv counter16.sv counter16_tb.sv
vopt +acc work.counter16_tb -o counter16_tb_opt
vsim counter16_tb_opt
add wave -r /*
run -all
```

---

## License Configuration

Questa FSE uses `SALT_LICENSE_SERVER`. The extension auto-detects `~/.licenses/questa_license.dat`.
Override via the **🔑** button or in settings:

```json
"questaLauncher.saltLicenseServer": "/home/user/.licenses/questa_license.dat"
```

---

## Requirements

See [DEPENDENCY.md](DEPENDENCY.md) for the full dependency list and
[COMMANDS.md](COMMANDS.md) for all install / build commands.

---

## Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `questaLauncher.questaBin` | `""` | Path to Questa `linux_x86_64` bin dir |
| `questaLauncher.saltLicenseServer` | `""` | `SALT_LICENSE_SERVER` license path |
| `questaLauncher.licenseFile` | `""` | `LM_LICENSE_FILE` path or port@host |
| `questaLauncher.licenseServer` | `""` | `MGLS_LICENSE_FILE` server |
| `questaLauncher.alteraLicenseFile` | `""` | `ALTERAD_LICENSE_FILE` path |
| `questaLauncher.autoOpenGui` | `false` | Auto-open GUI after compile |

---

## Folder Structure

```
VSQuestaLauncher/
├── src/extension.ts          # Main extension logic
├── out/                      # Compiled JS (auto-generated)
├── images/
│   └── questa_launcher.png   # Extension icon
├── syntaxes/
│   └── svconf.tmLanguage.json
├── language-configuration.json
├── package.json
├── tsconfig.json
├── README.md
├── DEPENDENCY.md
└── COMMANDS.md
```
