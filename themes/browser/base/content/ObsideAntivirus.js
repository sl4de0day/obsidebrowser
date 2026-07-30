"use strict";

var ObsideAntivirus = {
  PREF_NAME: "obside.antivirus.enabled",
  _enabled: true,
  _downloadList: null,
  _view: null,

  init() {
    this.checkState();
    if (this._enabled) {
      this.setupDownloadListener();
    }
  },

  checkState() {
    try {
      this._enabled = Services.prefs.getBoolPref(this.PREF_NAME, true);
    } catch (e) {
      this._enabled = true;
    }
  },

  async setupDownloadListener() {
    try {
      const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
      this._downloadList = await Downloads.getList(Downloads.ALL);
      this._view = {
        onDownloadChanged: (download) => {
          if (download.succeeded && !download.obsideScanStarted) {
            // Obside security fix (C30): never scan private-browsing downloads. Scanning
            // sends the file hash to a third party and persists the file name + full path
            // to the on-disk scan_history pref — both are private-browsing data leaks.
            try {
              if (download.source && download.source.isPrivate) {
                return;
              }
            } catch (e) {}

            let autoScan = false;
            try {
              autoScan = Services.prefs.getBoolPref("obside.security.auto_scan", false);
            } catch (e) {}
            if (!autoScan) return;

            download.obsideScanStarted = true;
            // Obside optimization: this is fire-and-forget; swallow rejections so a scan
            // failure cannot surface as an unhandled promise rejection.
            this.runAutoScan(download.target.path).catch(() => {});
          }
        }
      };
      this._downloadList.addView(this._view);

      window.addEventListener("unload", () => {
        if (this._downloadList && this._view) {
          try {
            this._downloadList.removeView(this._view);
          } catch (e) {}
        }
      });
    } catch (e) {}
  },

  async computeHash(path, algorithmStr) {
    const { NetUtil } = ChromeUtils.importESModule("resource://gre/modules/NetUtil.sys.mjs");
    const { FileUtils } = ChromeUtils.importESModule("resource://gre/modules/FileUtils.sys.mjs");
    return new Promise((res) => {
      let ch = Cc["@mozilla.org/security/hash;1"].createInstance(Ci.nsICryptoHash);
      ch.init(ch[algorithmStr]);
      let listener = {
        onStartRequest() {},
        onDataAvailable(request, stream, offset, count) {
          ch.updateFromStream(stream, count);
        },
        onStopRequest(request, status) {
          if (!Components.isSuccessCode(status)) {
            res(null);
            return;
          }
          let hash = ch.finish(false);
          let toHexString = charCode => ("0" + charCode.toString(16)).slice(-2);
          // Obside optimization: use the mapped character directly instead of re-indexing
          // the hash string by loop index (c === hash[i], so c.charCodeAt(0) is identical).
          res(Array.from(hash, c => toHexString(c.charCodeAt(0))).join(""));
        }
      };
      let file = new FileUtils.File(path);
      let channel = NetUtil.newChannel({ uri: NetUtil.newURI(file), loadUsingSystemPrincipal: true });
      channel.asyncOpen(listener);
    });
  },

  async runAutoScan(filePath) {
    const { Subprocess } = ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs");
    const { setTimeout, clearTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
    // Obside optimization: FileUtils was imported here but never used in runAutoScan
    // (computeHash and applyThreatAction import their own). Removed the dead import.

    let fileName = filePath.split(/[\\/]/).pop();

    let sha256 = await this.computeHash(filePath, "SHA256");

    let result = { risk: "Safe", details: "No threats found" };

    // Obside security fix (C17/C31): the Team Cymru MHR lookup was removed. It emitted
    // the file's MD5 as a cleartext DNS query (`<md5>.hash.cymru.com`) via the platform
    // resolver, which BYPASSES the VPN/proxy and exposes a per-file identifier + the real
    // IP to on-path observers and the ISP; and it drove a "Dangerous" verdict (and thus a
    // possible silent file delete) from an UNAUTHENTICATED, spoofable DNS answer. The MHR
    // service is also discontinued. Reputation now relies on CIRCL (HTTPS whitelist) plus
    // the local capa heuristic only.
    if (sha256) {
      try {
        let circlReq = await fetch(`https://hashlookup.circl.lu/lookup/sha256/${sha256}`, {
          headers: { 'accept': 'application/json' },
          method: 'GET'
        });
        if (circlReq.status === 200) {
          result = { risk: "Safe", details: "CIRCL Whitelist" };
        }
      } catch (e) {}
    }

    if (result.risk === "Safe" && result.details !== "CIRCL Whitelist") {
      let env = Cc["@mozilla.org/process/environment;1"].getService(Ci.nsIEnvironment);
      let activeCapaProc = null;
      let scanState = {
        isTrustedSignature: false,
        capaScore: 0,
        malwareSignatureMatch: null
      };

      let obsidePref = (n) => { try { return Services.prefs.getStringPref(n, ""); } catch (e) { return ""; } };
      let obsideFindExe = (names) => { for (let n of names) { try { return Subprocess.pathSearch(n); } catch (e) {} } return ""; };
      // Obside security fix (C38): resolve the bundled capa executable by ABSOLUTE path
      // from the app dir (GreD) instead of a bare-name %PATH% search. The old
      // Subprocess.pathSearch(["capa"]) executed whatever "capa" resolved to on PATH on
      // every scanned download — a search-order / binary-planting hijack. PATH search is
      // only a last-resort fallback now.
      let obsideGreExe = (names) => {
        for (let n of names) {
          try {
            let f = Services.dirsvc.get("GreD", Ci.nsIFile);
            n.split("/").forEach(part => f.append(part));
            if (f.exists()) { return f.path; }
          } catch (e) {}
        }
        return "";
      };
      let obsideCapa = obsidePref("obside.security.capa_path") || obsideGreExe(["capa.exe", "capa"]) || obsideFindExe(["capa"]);
      let obsideCapaRules = obsidePref("obside.security.capa_rules");
      let obsideCapaSigs = obsidePref("obside.security.capa_sigs");
      // capa is a standalone (PyInstaller) executable — run it DIRECTLY, not via python.
      let obsideCapaArgs = [];
      if (obsideCapaRules) { obsideCapaArgs.push("-r", obsideCapaRules); }
      if (obsideCapaSigs) { obsideCapaArgs.push("-s", obsideCapaSigs); }
      obsideCapaArgs.push("-j", "-q");

      await new Promise((resolve) => {
        let resolvedCount = 0;
        let hasResolved = false;

        let onResult = async () => {
          resolvedCount++;
          if (hasResolved) return;
          if (resolvedCount === 1 || scanState.malwareSignatureMatch) {
            hasResolved = true;
            if (activeCapaProc) { try { await activeCapaProc.kill(0); } catch (e) {} }
            if (scanState.isTrustedSignature) {
              result = { risk: "Safe", details: "Digitally Signed and Verified (Safe)" };
              resolve();
              return;
            }
            if (scanState.malwareSignatureMatch) {
              result = { risk: "Dangerous", details: scanState.malwareSignatureMatch };
              resolve();
              return;
            }
            let totalScore = scanState.capaScore;
            let finalRisk = "Safe";
            let finalDetails = "No threats found (Score: " + totalScore + ")";
            if (totalScore >= 60) {
              finalRisk = "Dangerous";
              finalDetails = "Heuristic Threat Detected (Score: " + totalScore + ")";
            } else if (totalScore >= 25) {
              finalRisk = "Suspicious";
              finalDetails = "Suspicious Heuristics Detected (Score: " + totalScore + ")";
            }
            result = { risk: finalRisk, details: finalDetails };
            resolve();
          }
        };

        (async () => {
          try {
            let timeoutId;
            let timeoutPromise = new Promise((_, rj) => {
              timeoutId = setTimeout(() => rj(new Error("Capa timeout")), 40000);
            });
            if (!obsideCapa) {
              // No capa executable available -> nothing more to scan with; treat as clean.
              onResult();
              return;
            }
            let capaProc = await Subprocess.call({
              command: obsideCapa,
              arguments: [...obsideCapaArgs, filePath],
              environment: {
                PATH: env.get("PATH"),
                HOME: env.get("HOME"),
                USER: env.get("USER"),
              },
              stderr: "pipe",
            });
            activeCapaProc = capaProc;
            let capaOutputStr = "";
            let capaStdoutPromise = (async function() {
              let stdout = await capaProc.stdout.readString();
              while (stdout) {
                capaOutputStr += stdout;
                stdout = await capaProc.stdout.readString();
              }
            })();
            try {
              await Promise.race([capaStdoutPromise, timeoutPromise]);
            } catch (raceErr) {
              clearTimeout(timeoutId);
              try { await capaProc.kill(0); } catch (kErr) {}
            }
            clearTimeout(timeoutId);
            let capaResult = await capaProc.wait();
            if (capaResult.exitCode === 0 && capaOutputStr.trim()) {
              let capaJson = JSON.parse(capaOutputStr);
              let score = 0;
              if (capaJson.rules) {
                for (let rule in capaJson.rules) {
                  let r = capaJson.rules[rule];
                  if (r.meta) {
                    if (r.meta.namespace) {
                      let ns = r.meta.namespace.toLowerCase();
                      if (ns.startsWith("malware/")) score += 25;
                      else if (ns.startsWith("anti-analysis/")) score += 15;
                      else if (ns.startsWith("collection/") || ns.startsWith("credential-access/")) score += 10;
                      else if (ns.startsWith("defense-evasion/")) score += 15;
                      else if (ns.startsWith("persistence/") || ns.startsWith("privilege-escalation/")) score += 8;
                      else score += 2;
                    }
                  }
                }
              }
              scanState.capaScore = score;
            }
          } catch (e) {}
          onResult();
        })();
      });
    }

    this.addScanHistory(fileName, filePath, result.risk, result.details);

    if (result.risk === "Dangerous" || result.risk === "Suspicious") {
      this.applyThreatAction(fileName, filePath, result.risk, result.details);
    }
  },

  addScanHistory(fileName, filePath, risk, details) {
    let history = [];
    try {
      history = JSON.parse(Services.prefs.getStringPref("obside.security.scan_history", "[]"));
    } catch (e) {}
    history.unshift({
      fileName,
      filePath,
      date: new Date().toLocaleString(),
      risk,
      details
    });
    if (history.length > 50) {
      history = history.slice(0, 50);
    }
    Services.prefs.setStringPref("obside.security.scan_history", JSON.stringify(history));
  },

  applyThreatAction(fileName, filePath, risk, details) {
    let action = 0;
    try {
      action = Services.prefs.getIntPref("obside.security.threat_action", 0);
    } catch (e) {}

    const { FileUtils } = ChromeUtils.importESModule("resource://gre/modules/FileUtils.sys.mjs");
    let file = new FileUtils.File(filePath);

    if (action === 1) {
      try {
        if (file.exists()) {
          let newName = file.leafName + ".quarantine";
          file.renameTo(file.parent, newName);
        }
      } catch (e) {}
    } else if (action === 2) {
      try {
        if (file.exists()) {
          file.remove(false);
        }
      } catch (e) {}
    }
  }
};

window.addEventListener("load", () => {
  setTimeout(() => ObsideAntivirus.init(), 500);
});
