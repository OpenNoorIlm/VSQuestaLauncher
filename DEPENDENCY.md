# MultiHD Launcher — Dependencies

Everything required to **build**, **install**, and **run** the MultiHD Launcher
(formerly *Questa Launcher*) VS Code extension. Use the **📦 Dependency Resolver** panel to
install these interactively — each section has a **▶ Run All** button that walks you through
every command one-by-one with per-step approval.

---

## Questa FSE (Runtime — required to simulate)

| Dependency | Version | Purpose |
|---|---|---|
| **Questa Altera FSE** | 2025.1 / 2025.2 | The simulator itself (`vsim`, `vlog`, `vopt`) |
| **Questa License** | — | `.dat` file from Intel/Altera — set via `SALT_LICENSE_SERVER` |

Configure the `vsim` binary in **⚙ Configuration** (`multihdLauncher.vsimPath`), or leave it
empty to auto-detect from `multihdLauncher.questaBin`, `PATH` or the known install location.

### How to install Questa FSE
Go to the **📦 Dependency Resolver** panel → **📦 Install** section → click **▶ Run All**
(or run each step individually). Steps covered: download page → make installer executable →
run installer → set PATH + license → verify.

- Download: [Intel Questa FSE software kit](https://www.intel.com/content/www/us/en/software-kit/825277/questa-intel-fpgas-standard-edition-software-version-23-1-1.html)
- Free license: [Intel PSG license portal](https://licensing.intel.com/psg/s/sales-signup-evaluationlicenses)

---

## Quartus Prime (Runtime — required for Quartus synthesis)

| Dependency | Version | Purpose |
|---|---|---|
| **Quartus Prime** | 23.1+ (Lite/Standard/Pro) | Opens the generated `.qpf` project |
| **Quartus binary** | — | `quartus` on `PATH` or configured in **⚙ Configuration → Quartus binary** |

The extension generates `<project>.qpf`, `<project>.qsf` and `<project>.sdc` (timing
template, written only when missing) and creates `output_files/`. If a Quartus binary is
configured (`multihdLauncher.quartusPath`) or found on `PATH`, the generated project is
opened automatically — otherwise the files are written and a warning is logged.

Install Quartus Prime from the [Intel FPGA downloads](https://www.intel.com/content/www/us/en/software/programmable/quartus-prime/download.html)
page. The free Lite edition needs no license.

---

## Gowin EDA (Runtime — required for Gowin synthesis)

| Dependency | Version | Purpose |
|---|---|---|
| **Gowin EDA** | 1.9.x+ | Opens the generated `.gprj` project |
| **Gowin binary** | — | `gw_ide` on `PATH` or configured in **⚙ Configuration → Gowin IDE binary** |

The extension generates `<project>.gprj`, `<project>.f` and an interactive `<project>.cst`
pin-assignment file, and creates `impl/pnr/`. If a Gowin binary is configured
(`multihdLauncher.gowinPath`) or found on `PATH`, the generated project is opened
automatically — otherwise the files are written and a warning is logged.

Install Gowin EDA from the [Gowin EDA downloads](https://www.gowinsemi.com/en/support/download_eda/) page.

---

## VS Code / VS Code Insiders (Runtime — required to use the extension)

| Dependency | Version | Purpose |
|---|---|---|
| **VS Code** or **VS Code Insiders** | ≥ 1.80.0 | Editor host |

### How to install VS Code Insiders
Go to the **📦 Dependency Resolver** panel → **🖥 GUI** section → click **▶ Run** for your OS.

---

## Build Dependencies (only needed to recompile the `.vsix`)

| Dependency | Version | Purpose |
|---|---|---|
| **Node.js** | ≥ 18.x | Runtime for build tools |
| **npm** | ≥ 9.x | Package manager |
| **TypeScript** | ≥ 5.0 | Compiles `src/**/*.ts` → `out/**/*.js` |
| **@types/vscode** | ≥ 1.80.0 | VS Code API type definitions |
| **@types/node** | ≥ 20.x | Node.js type definitions |
| **@vscode/vsce** | ≥ 2.x | Packages the extension into `multihd-launcher-2.0.0.vsix` |

### How to build
Go to the **📦 Dependency Resolver** panel → **🔨 Build** section → click **▶ Run All**.
Steps covered: install Node.js → TypeScript + vsce → project dev-deps → compile → package
`multihd-launcher-2.0.0.vsix` → install. Full commands: [COMMANDS.md](COMMANDS.md).

---

## Questa FSE System Requirements

| Item | Requirement |
|---|---|
| **OS** | Linux x86_64 (primary), Windows 10/11 (64-bit) |
| **Architecture** | 64-bit only |
| **RAM** | ≥ 4 GB recommended |
| **Disk** | ≥ 2 GB for Questa FSE install |
| **glibc** | ≥ 2.17 (Linux) |
| **libXft** | Required for Questa GUI on Linux |
| **libXext** | Required for Questa GUI on Linux |

---

## Environment Variables (set automatically by the extension)

| Variable | Purpose |
|---|---|
| `SALT_LICENSE_SERVER` | Questa FSE license file path (or `port@host`); falls back to the license file |
| `LM_LICENSE_FILE` | General FlexLM license — set from the configured license file |
| `MGLS_LICENSE_FILE` | Questa/Siemens license server |
| `ALTERAD_LICENSE_FILE` | Altera/Intel FPGA license |
| `MTI_VCO_MODE` | 64-bit simulator mode (default `64`) |
| `QSIM_VCO_MODE` | Set to `64` (newer Questa releases) |
| `DISPLAY` | Inherited (or `:0`) so the Questa GUI can open on Linux |
| `PATH` | Extended with the configured Questa / Quartus / Gowin bin directories |

---

## License guard

Questa launches are blocked when `multihdLauncher.licenseFile` is empty or the file does not
exist at that path. The launcher panel shows `⚠ LICENSE NOT SET — configure before launching
Questa!` and the launch logs
`✗ [Questa] BLOCKED: License file not configured or not found!`, offering to open
**⚙ Configuration**. Quartus Prime and Gowin EDA launches are unaffected by the license guard.

---

## Optional (Linux only)

| Dependency | Purpose |
|---|---|
| **librsvg2-bin** (`rsvg-convert`) | Converts `images/multihd_launcher.svg` → `images/icon.png` (256×256) |
| **imagemagick** (`convert`, `magick`) | Alternative SVG/PNG conversion |

---

## No internet connection required

MultiHD Launcher does **not** make any network requests at runtime. The **⬇ INSTALL QUESTA**
and **🔑 LICENSE REQUEST** buttons simply open URLs in your default browser.
