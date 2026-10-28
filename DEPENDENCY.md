# Questa Launcher — Dependencies

Everything required to **build**, **install**, and **run** the Questa Launcher extension.
Use the **📦 Dependencies** tab to install these interactively — each section has a **▶ Run All** button
that walks you through every command one-by-one with per-step approval.

---

## Questa FSE (Runtime — required to simulate)

| Dependency | Version | Purpose |
|---|---|---|
| **Questa Altera FSE** | 2025.1 / 2025.2 | The simulator itself (`vsim`, `vlog`, `vopt`) |
| **Questa License** | — | `.dat` file from Intel/Altera — set via `SALT_LICENSE_SERVER` |

### How to install Questa FSE
Go to the **📦 Dependencies** tab → **📦 Install** section → click **▶ Run All** (or run each step individually).
Steps covered: download page → make installer executable → run installer → set PATH + license → verify.

---

## VS Code / VS Code Insiders (Runtime — required to use the extension)

| Dependency | Version | Purpose |
|---|---|---|
| **VS Code** or **VS Code Insiders** | ≥ 1.80.0 | Editor host |

### How to install VS Code Insiders
Go to the **📦 Dependencies** tab → **🖥 GUI** section → click **▶ Run** for your OS.

---

## Build Dependencies (only needed to recompile the `.vsix`)

| Dependency | Version | Purpose |
|---|---|---|
| **Node.js** | ≥ 18.x | Runtime for build tools |
| **npm** | ≥ 9.x | Package manager |
| **TypeScript** | ≥ 5.0 | Compiles `src/extension.ts` → `out/extension.js` |
| **@types/vscode** | ≥ 1.80.0 | VS Code API type definitions |
| **@types/node** | ≥ 20.x | Node.js type definitions |
| **@vscode/vsce** | ≥ 2.x | Packages the extension into a `.vsix` |

### How to build
Go to the **📦 Dependencies** tab → **🔨 Build** section → click **▶ Run All**.
Steps covered: install Node.js → TypeScript + vsce → project deps → compile → package → install.

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
| `SALT_LICENSE_SERVER` | Questa FSE license file path |
| `LM_LICENSE_FILE` | General FlexLM license |
| `MGLS_LICENSE_FILE` | Questa/Siemens license server |
| `ALTERAD_LICENSE_FILE` | Altera/Intel FPGA license |
| `MTI_VCO_MODE` | Set to `64` (64-bit mode) |
| `QSIM_VCO_MODE` | Set to `64` (replaces MTI_VCO_MODE) |
| `PATH` | Extended with Questa bin directory |

---

## Optional (Linux only)

| Dependency | Purpose |
|---|---|
| **librsvg2-bin** (`rsvg-convert`) | Converts `questa_launcher.svg` → `icon.png` |
| **imagemagick** (`convert`) | Alternative SVG/PNG conversion |
