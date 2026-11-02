 <div align="center">
  <img src="https://raw.githubusercontent.com/sl4de0day/obsidebrowser/refs/heads/master/themes/browser/branding/obside/default128.png" width="128" alt="Obside Browser Logo">

  # Obside Browser

  **A faster, safer and more private browsing experience.**

  [Website](https://obsidebrowser.com/) · [Documentation](https://obsidebrowser.com/docs) · [Changelog](https://obsidebrowser.com/changelog)
</div>

---

## **Project Status**

<details>
  <summary><strong>Development Suspended</strong></summary>

  As of July 2026, Obside Browser development has been suspended until further notice.

  Active development, maintenance, support and updates are currently paused. Existing releases may remain available, but they may not include the latest security fixes.

</details>

---

## **Screenshot**

<p align="center">
  <img src="assets/obsidescreenshot.png" width="100%" alt="Obside Browser Screenshot">
</p>

---

## **Features**

### **Privacy Protection**
- Built-in ad and tracker blocking.
- Fingerprinting protection.
- Privacy-focused browsing experience.

### **Performance**
- Optimized resource management.
- Faster page loading.
- Reduced CPU and memory usage.

### **Security**
- Protection against malicious websites.
- Phishing protection.
- Security-focused browsing features.

### **Open Source**
- Publicly available source code.
- Transparent development.
- Community contributions.

### **Firefox Extensions**
- Support for standard Firefox WebExtensions.
- Access to the Firefox extension ecosystem.

### **Automatic Updates**
- Integrated update functionality.
- Simplified browser update process.

### **Data Import**
- Import bookmarks.
- Import passwords.
- Import browsing history.

---

## **Obside Premium**

Obside Premium was designed to provide additional services and enhanced capabilities.

### **Advanced Download Security**
- RAM-based download protection.
- Real-time malware scanning.

### **Premium E2EE Communication**
- End-to-end encrypted communication.
- Enhanced video and audio quality.
- Priority relay infrastructure.

### **VPN Service**
- Planned high-speed VPN infrastructure.
- Unlimited bandwidth.

### **Unlimited File Transfer**
- End-to-end encrypted file sharing.
- No file size restrictions.

**Note:** These services may not be operational or available. Development and maintenance are currently suspended.

---

## **Build from Source**

Obside Browser is based on Mozilla Firefox. Building it requires the Firefox source code and the Obside-specific modifications.

### **Requirements**

- 64-bit Windows 10 or later, or a supported Linux distribution.
- Git.
- Python 3.
- MozillaBuild (Windows only).
- At least 40 GB of free disk space on Windows or 30 GB on Linux.

### **1. Obtain the Firefox Source Code**

Follow the official Mozilla build instructions to download and configure the Firefox source code.

- [Windows Build Instructions](https://firefox-source-docs.mozilla.org/setup/windows_build.html)
- [Linux Build Instructions](https://firefox-source-docs.mozilla.org/setup/linux_build.html)

### **2. Clone the Obside Repository**

```bash
git clone https://github.com/sl4de0day/obsidebrowser.git
```

The repository contains Obside-specific resources and modifications:

| Directory | Description |
|---|---|
| `assets/` | Project assets and screenshots |
| `l10n/` | Localization resources |
| `patches/` | Firefox modification patches |
| `scripts/` | Build and development scripts |
| `settings/` | Browser configuration resources |
| `themes/` | Branding and theme resources |

Integrate the required Obside files and modifications into the compatible Firefox source tree. Use a Firefox revision compatible with the project's patches and configuration.

### **3. Configure the Build**

Create a `.mozconfig` file in the Firefox source directory:

```bash
ac_add_options --enable-application=browser
ac_add_options --with-branding=themes/browser/branding/obside

mk_add_options MOZ_OBJDIR=@TOPSRCDIR@/obj-obside

ac_add_options --enable-optimize
ac_add_options --disable-debug
ac_add_options --disable-tests
```

For additional configuration options, see the [Mozilla Build Configuration Documentation](https://firefox-source-docs.mozilla.org/setup/configuring_build_options.html).

### **4. Build Obside Browser**

From the Firefox source directory, run:

```bash
./mach build
```

The build process may take a considerable amount of time depending on your hardware.

### **5. Run the Browser**

After a successful build:

```bash
./mach run
```

Build output is typically located in:

```text
obj-obside/dist/bin/
```

---

## **Download**

<details>
  <summary><strong>Obside Browser v150.1.0</strong></summary>

  **Platform:** Windows 64-bit

  [Download Obside Browser v150.1.0](https://github.com/sl4de0day/obsidebrowser/releases/download/v150.1.0/obside-150.1.0.en-US.win64.installer.exe)

  **Note:** This release may not include the latest security updates. Use it at your own discretion.

</details>

---

## **Contributing**

Obside Browser is an open-source project. Its source code is publicly available on GitHub.

Contributions, suggestions and feedback are welcome, although active development is currently suspended.

---

## **Contact**

For general inquiries:

**contact@obsidebrowser.com**

For security vulnerabilities and responsible disclosure:

**security@obsidebrowser.com**

---

## **Social Media**

<p>
  <a href="https://x.com/obsidebrowser">
    <img src="https://cdn.simpleicons.org/x/000000" width="24" alt="X">
  </a>
  &nbsp;&nbsp;
  <a href="https://www.instagram.com/obsidebrowser">
    <img src="https://cdn.simpleicons.org/instagram/E4405F" width="24" alt="Instagram">
  </a>
  &nbsp;&nbsp;
  <a href="https://www.reddit.com/user/ObsideBrowser/">
    <img src="https://cdn.simpleicons.org/reddit/FF4500" width="24" alt="Reddit">
  </a>
</p>

---

## **License**

See the [LICENSE](LICENSE) file for licensing information.

---

<div align="center">
  **Obside Browser**

  *Performance. Privacy. Security.*
</div>
