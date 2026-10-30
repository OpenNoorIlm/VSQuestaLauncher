# MultiHD Launcher — Commands Reference

MultiHD Launcher (formerly *Questa Launcher*) contributes the following commands. All are
available from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`); most also appear on the
`.sv` editor title bar and/or the Explorer context menu.

| Command | ID |
|---|---|
| 🚀 Open MultiHD Launcher | `multihdLauncher.openLauncher` |
| ▶ Run CLI | `multihdLauncher.run` |
| 🖥 Run GUI | `multihdLauncher.runGui` |
| 〰 Show WaveForm | `multihdLauncher.showWaveform` |
| ⬡ Launch Questa | `multihdLauncher.launchQuesta` |
| ◈ Launch Quartus Prime | `multihdLauncher.launchQuartus` |
| ◆ Launch Gowin EDA | `multihdLauncher.launchGowin` |
| ⚙ Configuration | `multihdLauncher.setConfig` |
| 🔑 Set License | `multihdLauncher.setLicense` |
| ⇅ Compile Order | `multihdLauncher.setPriority` |
| ✕ Exclude Files | `multihdLauncher.excludeFiles` |
| 📦 Library Manager | `multihdLauncher.libraryManager` |
| ◆ Gowin CST Editor | `multihdLauncher.gowinCst` |
| ⬇ Install / License Helpers | `multihdLauncher.installHelpers` |
| ⚙ Edit conf.svconf | `multihdLauncher.editConf` |
| ❓ MultiHD Launcher Help | `multihdLauncher.helpDocs` |
| 📦 Dependency Resolver | `multihdLauncher.helpDeps` |

## Archival: legacy `questaLauncher.*` aliases

The v1.x IDs below are kept alive as hidden runtime aliases that map to the command IDs above;
they are not declared in the manifest. Existing keybindings, tasks and settings keep working.

| Legacy alias (v1.x) | Maps to |
|---|---|
| `questaLauncher.run` | `multihdLauncher.run` |
| `questaLauncher.runGui` | `multihdLauncher.runGui` |
| `questaLauncher.showWaveform` | `multihdLauncher.showWaveform` |
| `questaLauncher.setQuestaPath` | `multihdLauncher.setConfig` |
| `questaLauncher.setConfig` | `multihdLauncher.setConfig` |
| `questaLauncher.setLicense` | `multihdLauncher.setLicense` |
| `questaLauncher.setPriority` | `multihdLauncher.setPriority` |
| `questaLauncher.editConf` | `multihdLauncher.editConf` |
| `questaLauncher.helpDocs` | `multihdLauncher.helpDocs` |
| `questaLauncher.helpDeps` | `multihdLauncher.helpDeps` |

---

In the **Dependency Resolver** panel every block below has **📋 Copy** and **▶ Run** buttons.
Each section also has a **▶ Run All** button that steps through every command one-by-one —
each command requires your explicit approval before it runs.

---

## Build

### Build — Linux — 1. Install Node.js LTS
Installs Node.js (LTS channel) via the official NodeSource repository.

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### Build — Linux — 2. Verify Node & npm
Prints installed versions to confirm Node.js and npm are ready.

```bash
node --version
npm --version
```

### Build — Linux — 3. Install TypeScript + vsce globally
Installs the TypeScript compiler and the VS Code Extension packager globally.

```bash
npm install -g typescript @vscode/vsce
```

### Build — Linux — 4. Enter the project folder
Changes into the MultiHD Launcher (VSQuestaLauncher) source directory.

```bash
cd ~/Downloads/VSQuestaLauncher
```

### Build — Linux — 5. Install project dev-dependencies
Installs @types/vscode, @types/node, and TypeScript as local dev-dependencies.

```bash
npm install --save-dev @types/vscode @types/node typescript
```

### Build — Linux — 6. Compile TypeScript → JavaScript
Runs the TypeScript compiler and writes output to the out/ directory.

```bash
npm run compile
```

### Build — Linux — 7. Package extension as .vsix
Bundles the compiled extension into an installable multihd-launcher-2.0.0.vsix file.

```bash
npx @vscode/vsce package --no-dependencies
```

### Build — Linux — 8. Install into VS Code Insiders
Installs the freshly built multihd-launcher-2.0.0.vsix into VS Code Insiders.

```bash
code-insiders --install-extension multihd-launcher-2.0.0.vsix --force
```

### Build — Windows — 1. Install Node.js LTS via winget
Installs Node.js (LTS) from the Windows Package Manager.

```powershell
winget install OpenJS.NodeJS.LTS
```

### Build — Windows — 2. Verify Node & npm
Confirms Node.js and npm are installed and prints their versions.

```powershell
node --version
npm --version
```

### Build — Windows — 3. Install TypeScript + vsce globally
Installs the TypeScript compiler and VS Code Extension packager globally.

```powershell
npm install -g typescript @vscode/vsce
```

### Build — Windows — 4. Enter the project folder
Changes into the MultiHD Launcher (VSQuestaLauncher) source directory.

```powershell
cd "$env:USERPROFILE\Downloads\VSQuestaLauncher"
```

### Build — Windows — 5. Install project dev-dependencies
Installs @types/vscode, @types/node, and TypeScript as local dev-dependencies.

```powershell
npm install --save-dev @types/vscode @types/node typescript
```

### Build — Windows — 6. Compile TypeScript → JavaScript
Runs the TypeScript compiler and writes output to the out/ directory.

```powershell
npm run compile
```

### Build — Windows — 7. Package extension as .vsix
Bundles the compiled extension into an installable multihd-launcher-2.0.0.vsix file.

```powershell
npx vsce package --no-dependencies
```

### Build — Windows — 8. Install into VS Code Insiders
Installs the freshly built multihd-launcher-2.0.0.vsix into VS Code Insiders.

```powershell
code-insiders --install-extension multihd-launcher-2.0.0.vsix --force
```

---

## Install

### Install — Linux — 1. Open Questa FSE download page
Opens the Intel FPGA software portal in your default browser (requires a free Intel account).

```bash
xdg-open "https://www.intel.com/content/www/us/en/software-kit/825277/questa-intel-fpgas-standard-edition-software-version-23-1-1.html"
```

### Install — Linux — 2. Make installer executable
Grants execute permission to the downloaded Questa FSE installer.

```bash
chmod +x ~/Downloads/QuestaSetup-*.run
```

### Install — Linux — 3. Run the Questa installer
Launches the Questa FSE graphical installer — follow the on-screen steps.

```bash
~/Downloads/QuestaSetup-*.run
```

### Install — Linux — 4. Add Questa to PATH and set license
Appends the Questa binary path, license server, and VCO mode to ~/.bashrc permanently.

```bash
echo 'export SALT_LICENSE_SERVER=~/.licenses/questa_license.dat' >> ~/.bashrc
echo 'export QSIM_VCO_MODE=64' >> ~/.bashrc
echo 'export PATH=~/altera/25.1std/questa_fse/linux_x86_64:$PATH' >> ~/.bashrc
source ~/.bashrc
```

### Install — Linux — 5. Protect the license file
Sets file permissions so only your user account can read the Questa license file.

```bash
chmod 600 ~/.licenses/questa_license.dat
```

### Install — Linux — 6. Verify Questa installation
Prints the Questa version string — confirms vsim is on your PATH and licensed.

```bash
vsim -version
```

### Install — Windows — 1. Open Questa FSE download page
Opens the Intel FPGA software portal in your default browser.

```powershell
Start-Process "https://www.intel.com/content/www/us/en/software-kit/825277/questa-intel-fpgas-standard-edition-software-version-23-1-1.html"
```

### Install — Windows — 2. Run the Questa installer
Launches the downloaded Questa FSE Windows installer (update the filename to match your download).

```powershell
Start-Process "$env:USERPROFILE\Downloads\QuestaSetup-25.1std.0.1129-windows.exe"
```

### Install — Windows — 3. Add Questa win64 to PATH permanently
Appends the Questa win64 binary directory to your user-level PATH environment variable.

```powershell
[System.Environment]::SetEnvironmentVariable(
  "PATH",
  [System.Environment]::GetEnvironmentVariable("PATH","User") + ";C:\intelFPGA\25.1std\questa_fse\win64",
  "User"
)
```

### Install — Windows — 4. Set SALT_LICENSE_SERVER
Points Questa at your license file via the SALT_LICENSE_SERVER environment variable.

```powershell
[System.Environment]::SetEnvironmentVariable(
  "SALT_LICENSE_SERVER",
  "C:\intelFPGA\licenses\questa_license.dat",
  "User"
)
```

### Install — Windows — 5. Verify Questa installation
Prints the Questa version string — confirms vsim is on your PATH and licensed.

```powershell
vsim -version
```

---

## CLI

### CLI — Linux — Uninstall extension
Removes the MultiHD Launcher extension from VS Code Insiders (uninstall the legacy bismillah.questa-launcher package too if it is still installed).

```bash
code-insiders --uninstall-extension bismillah.multihd-launcher
```

### CLI — Linux — Reinstall extension
Uninstalls the old version then installs the latest multihd-launcher-2.0.0.vsix in one step.

```bash
code-insiders --uninstall-extension bismillah.multihd-launcher
code-insiders --install-extension ~/Downloads/VSQuestaLauncher/multihd-launcher-2.0.0.vsix --force
```

### CLI — Windows — Uninstall extension
Removes the MultiHD Launcher extension from VS Code Insiders (uninstall the legacy bismillah.questa-launcher package too if it is still installed).

```powershell
code-insiders --uninstall-extension bismillah.multihd-launcher
```

### CLI — Windows — Reinstall extension
Uninstalls the old version then installs the latest multihd-launcher-2.0.0.vsix in one step.

```powershell
code-insiders --uninstall-extension bismillah.multihd-launcher
code-insiders --install-extension "$env:USERPROFILE\Downloads\VSQuestaLauncher\multihd-launcher-2.0.0.vsix" --force
```

---

## GUI

### GUI — Linux — Install VS Code Insiders from .deb
Installs VS Code Insiders from a downloaded .deb package and resolves any dependency issues.

```bash
sudo dpkg -i ~/Downloads/code-insiders_*.deb
sudo apt-get install -f
```

### GUI — Windows — Install VS Code Insiders via winget
Installs VS Code Insiders from the Windows Package Manager.

```powershell
winget install Microsoft.VisualStudioCode.Insiders
```
