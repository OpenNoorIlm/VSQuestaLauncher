# Questa Launcher — Commands Reference

All commands needed to install dependencies and build the extension from source.

---

## CLI Installation (No GUI — Terminal Only)

### Linux

```bash
# 1. Install Node.js (via NodeSource — LTS)
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Verify
node --version
npm --version

# 3. Install TypeScript globally
npm install -g typescript

# 4. Install vsce (VS Code Extension packager)
npm install -g @vscode/vsce

# 5. Install SVG→PNG converter (for icon rebuild, optional)
sudo apt-get install -y librsvg2-bin

# 6. Clone / enter the extension folder
cd ~/Downloads/VSQuestaLauncher

# 7. Install project dependencies
npm install --save-dev @types/vscode @types/node typescript

# 8. Compile TypeScript → JavaScript
npm run compile

# 9. Package into .vsix
vsce package --no-dependencies

# 10. Install into VS Code Insiders
code-insiders --install-extension questa-launcher-*.vsix

# 10b. Install into VS Code (stable)
code --install-extension questa-launcher-*.vsix
```

### Windows

```powershell
# 1. Install Node.js — download from https://nodejs.org and run installer
# OR via winget:
winget install OpenJS.NodeJS.LTS

# 2. Verify (in a new terminal)
node --version
npm --version

# 3. Install TypeScript globally
npm install -g typescript

# 4. Install vsce
npm install -g @vscode/vsce

# 5. Enter the extension folder
cd "$env:USERPROFILE\Downloads\VSQuestaLauncher"

# 6. Install project dependencies
npm install --save-dev @types/vscode @types/node typescript

# 7. Compile
npm run compile

# 8. Package
vsce package --no-dependencies

# 9. Install into VS Code Insiders
code-insiders --install-extension questa-launcher-1.7.0.vsix

# 9b. Install into VS Code stable
code --install-extension questa-launcher-1.7.0.vsix
```

---

## GUI Installation (With Desktop / Package Manager UI)

### Linux

```bash
# Node.js — via GUI package manager
# Open your distro's Software Center / Synaptic and search: nodejs
# OR use the terminal with GUI confirmation:
sudo apt-get install -y nodejs npm

# librsvg2-bin (optional, for SVG icon conversion)
sudo apt-get install -y librsvg2-bin

# Install VS Code Insiders
# Download .deb from: https://code.visualstudio.com/insiders/
sudo dpkg -i code-insiders_*.deb
sudo apt-get install -f   # fix any dependency issues

# Install the .vsix via VS Code GUI:
# Extensions panel (Ctrl+Shift+X) → ··· menu (top right) → Install from VSIX → pick the file
```

### Windows

```powershell
# Node.js — GUI installer
# 1. Go to https://nodejs.org
# 2. Download "LTS" Windows Installer (.msi)
# 3. Run the installer — accept defaults

# VS Code Insiders — GUI installer
# 1. Go to https://code.visualstudio.com/insiders/
# 2. Download Windows installer
# 3. Run VSCodeInsidersSetup.exe

# Install .vsix via VS Code GUI:
# Extensions panel (Ctrl+Shift+X) → ··· → Install from VSIX → pick questa-launcher-*.vsix

# Questa FSE on Windows:
# 1. Download from https://www.intel.com/content/www/us/en/software/programmable/quartus-prime/questa-edition.html
# 2. Run the installer
# 3. Set license in VS Code settings:
#    "questaLauncher.saltLicenseServer": "C:\\intelFPGA\\licenses\\questa_license.dat"
```

---

## Questa FSE Install (Linux)

```bash
# 1. Download Questa FSE from Intel/Altera FPGA portal
#    https://www.intel.com/content/www/us/en/software/programmable/quartus-prime/questa-edition.html

# 2. Make installer executable and run
chmod +x QuestaSetup-25.1std.0.1129-linux.run
./QuestaSetup-25.1std.0.1129-linux.run

# 3. Set up license environment (add to ~/.bashrc)
echo 'export SALT_LICENSE_SERVER=/home/$USER/.licenses/questa_license.dat' >> ~/.bashrc
echo 'export QSIM_VCO_MODE=64' >> ~/.bashrc
echo 'export PATH=/home/$USER/altera/25.1std/questa_fse/linux_x86_64:$PATH' >> ~/.bashrc
source ~/.bashrc

# 4. Protect your license file
chmod 600 ~/.licenses/questa_license.dat

# 5. Verify
vsim -version
```

---

## Rebuild Extension from Source

```bash
# Linux / Windows (PowerShell)
cd ~/Downloads/VSQuestaLauncher   # Linux
cd "$env:USERPROFILE\Downloads\VSQuestaLauncher"  # Windows

npm install
npm run compile
vsce package --no-dependencies
```

---

## Uninstall

```bash
# Linux
code-insiders --uninstall-extension bismillah.questa-launcher

# Windows (PowerShell)
code-insiders --uninstall-extension bismillah.questa-launcher
```
