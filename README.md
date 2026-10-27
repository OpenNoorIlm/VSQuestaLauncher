# Questa Launcher — VS Code Extension

<p align="center">
  <img src="images/questa_launcher.png" width="96" alt="Questa Launcher Logo"/>
</p>

**Questa Launcher** is a VS Code / VS Code Insiders extension that lets you compile and simulate SystemVerilog designs directly from the editor using **Questa Altera FSE (Starter Edition)** — no terminal required.

---

## Features

| Button | Action |
|---|---|
| ▶ Run CLI | Headless compile + simulate — output streamed to the Output panel, **no waveform window** |
| 🖥 Run GUI | Compiles, runs, opens full Questa GUI with waveforms loaded automatically |
| 〰 Show WaveForm | Opens existing `vsim.wlf` in the Questa waveform viewer without re-running the simulation |
| 🖥 GUI | Opens full Questa GUI with waveforms pre-loaded and `run -all` executed |
| ⇅ Priority | Pick compile order for all `.sv` files in the directory |
| 🔑 License | Set `SALT_LICENSE_SERVER`, `LM_LICENSE_FILE`, or browse for a `.dat` file |
| ⚙ conf.svconf | Open or create the project config file |
| ❓ Help | In-editor help panel with docs and one-click dependency installer |

---

## How It Works

1. Open any `.sv` file
2. Press ▶ — the extension:
   - Scans all `.sv` files in the same directory
   - Orders them: RTL files first, `_tb` / `tb_` files last (highest priority for vsim)
   - Generates a `run.do` script
   - Launches `vsim` with the correct environment variables
   - Streams the transcript to **Output → Questa Launcher**

---

## conf.svconf

Each project directory can have a `conf.svconf` file that controls compile behaviour. Press ⚙ to create one automatically.

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

## Generated run.do Format

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

Questa FSE uses `SALT_LICENSE_SERVER`. The extension auto-detects your license from `~/.licenses/questa_license.dat`. You can override it via the 🔑 button or in VS Code settings:

```json
"questaLauncher.saltLicenseServer": "/home/user/.licenses/questa_license.dat"
```

---

## Requirements

See [DEPENDENCY.md](DEPENDENCY.md) for full dependency list and [COMMANDS.md](COMMANDS.md) for install instructions.

---

## Extension Settings

| Setting | Default | Description |
|---|---|---|
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
├── src/extension.ts       # Main extension logic
├── out/                   # Compiled JS (auto-generated)
├── images/
│   ├── icon.png           # Extension icon (128x128)
│   └── questa_launcher.svg
├── syntaxes/
│   └── svconf.tmLanguage.json
├── language-configuration.json
├── package.json
├── tsconfig.json
├── README.md
├── DEPENDENCY.md
└── COMMANDS.md
```


