# Questa Launcher — Dependencies

This document lists everything required to build, install, and run the Questa Launcher VS Code extension.

---

## Runtime Dependencies (to run simulations)

| Dependency | Version | Purpose |
|---|---|---|
| **Questa Altera FSE** | 2025.1 / 2025.2 | The simulator itself (`vsim`, `vlog`, `vopt`) |
| **Questa License** | — | `.dat` file from Intel/Altera — set via `SALT_LICENSE_SERVER` |
| **Node.js** | ≥ 18.x | VS Code extension host runtime |
| **VS Code** or **VS Code Insiders** | ≥ 1.80.0 | Editor |

---

## Build / Package Dependencies (to rebuild the `.vsix`)

| Dependency | Version | Purpose |
|---|---|---|
| **Node.js** | ≥ 18.x | JavaScript runtime for build tools |
| **npm** | ≥ 9.x | Package manager |
| **TypeScript** | ≥ 5.0 | Compiles `src/extension.ts` → `out/extension.js` |
| **@types/vscode** | ≥ 1.80.0 | VS Code API type definitions |
| **@types/node** | ≥ 20.x | Node.js type definitions |
| **@vscode/vsce** | ≥ 2.x | VS Code Extension packager (produces `.vsix`) |

---

## Optional (Linux only — for icon conversion)

| Dependency | Purpose |
|---|---|
| **librsvg2-bin** (`rsvg-convert`) | Converts `questa_launcher.svg` → `icon.png` |
| **imagemagick** (`convert`) | Alternative SVG/PNG conversion |

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

## Environment Variables Set by the Extension

| Variable | Purpose |
|---|---|
| `SALT_LICENSE_SERVER` | Questa FSE license file path |
| `LM_LICENSE_FILE` | General FlexLM license |
| `MGLS_LICENSE_FILE` | Questa/Siemens license server |
| `ALTERAD_LICENSE_FILE` | Altera/Intel FPGA license |
| `MTI_VCO_MODE` | Set to `64` (64-bit mode) |
| `QSIM_VCO_MODE` | Set to `64` (replaces MTI_VCO_MODE) |
| `PATH` | Extended with Questa bin directory |
