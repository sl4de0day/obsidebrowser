/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/* import-globals-from extensionControlled.js */
/* import-globals-from preferences.js */

ChromeUtils.defineLazyGetter(this, "L10n", () => {
  return new Localization([
    "branding/brand.ftl",
    "browser/preferences/preferences.ftl",
  ]);
});

Preferences.addAll([
  // IPv6
  { id: "network.dns.disableIPv6", type: "bool" },
  // Firefox Accounts
  { id: "identity.fxaccounts.enabled", type: "bool" },
  // WebGL
  { id: "librewolf.webgl.prompt", type: "bool" },
  { id: "librewolf.webgl.prompt.hide", type: "bool" },
  // Automatically Update Extensions
  { id: "extensions.update.enabled", type: "bool" },
  { id: "extensions.update.autoUpdateDefault", type: "bool" },
  // Clipboard autocopy/paste
  { id: "clipboard.autocopy", type: "bool" },
  { id: "middlemouse.paste", type: "bool" },
  // XOrigin referrers
  { id: "network.http.referer.XOriginPolicy", type: "int" },
  // Harden
  { id: "privacy.resistFingerprinting.letterboxing", type: "bool" },
  // Google Safe Browsing
  //{ id: "browser.safebrowsing.malware.enabled", type: "bool" }, // Already loaded
  //{ id: "browser.safebrowsing.phishing.enabled", type: "bool" },
  { id: "browser.safebrowsing.blockedURIs.enabled", type: "bool" },
  { id: "browser.safebrowsing.provider.google4.gethashURL", type: "string" },
  { id: "browser.safebrowsing.provider.google4.updateURL", type: "string" },
  { id: "browser.safebrowsing.provider.google.gethashURL", type: "string" },
  { id: "browser.safebrowsing.provider.google.updateURL", type: "string" },
  /**** Prefs that require changing a lockPref ****/
  // Google safe browsing check downloads
  //{ id: "browser.safebrowsing.downloads.enabled", type: "bool" }, //Also already added
  { id: "toolkit.legacyUserProfileCustomizations.stylesheets", type: "bool" },
]);

Preferences.addSetting({
  id: "librewolfExtensionUpdateEnabled",
  pref: "extensions.update.enabled",
});
Preferences.addSetting({
  id: "librewolfExtensionAutoUpdateEnabled",
  pref: "extensions.update.autoUpdateDefault",
});
Preferences.addSetting({
  id: "librewolfExtensionUpdate",
  deps: ["librewolfExtensionUpdateEnabled","librewolfExtensionAutoUpdateEnabled"],
  get: (_, deps) => deps.librewolfExtensionUpdateEnabled.value && deps.librewolfExtensionAutoUpdateEnabled.value,
  set: (value, deps) => {
      deps.librewolfExtensionUpdateEnabled.value = value;
      deps.librewolfExtensionAutoUpdateEnabled.value = value;
  },
});

Preferences.addSetting({
  id: "librewolfSync",
  pref: "identity.fxaccounts.enabled",
  onUserChange() {
    confirmRestartPrompt(
      Services.prefs.getBoolPref("identity.fxaccounts.enabled"),
      1,
      true,
      false
    ).then(buttonIndex => {
      if (buttonIndex == CONFIRM_RESTART_PROMPT_RESTART_NOW) {
          Services.startup.quit(
            Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eRestart
          );
          return
        }
    });
  }
});

Preferences.addSetting({
  id: "librewolfAutocopy",
  pref: "clipboard.autocopy",
});
Preferences.addSetting({
  id: "librewolfPaste",
  pref: "middlemouse.paste",
});
Preferences.addSetting({
  id: "librewolfMiddleClick",
  deps: ["librewolfAutocopy","librewolfPaste"],
  get: (_, deps) => deps.librewolfAutocopy.value && deps.librewolfPaste.value,
  set: (value, deps) => {
      deps.librewolfAutocopy.value = value;
      deps.librewolfPaste.value = value;
  },
});

Preferences.addSetting({
  id: "librewolfUserChrome",
  pref: "toolkit.legacyUserProfileCustomizations.stylesheets",
});

Preferences.addSetting({
  id: "librewolfIPv6",
  pref: "network.dns.disableIPv6",
  get: (value) => value.value = !value,
  set: (value) => value.value = !value,
});

Preferences.addSetting({
  id: "librewolfCrossOrigin",
  pref: "network.http.referer.XOriginPolicy",
  get: (value) => {
    if (value == 2) {
      return true;
    } else {
      return false;
    }
  },
  set: (value) => value ? 2 : 0,
});

Preferences.addSetting({
  id: "librewolfRFP",
  pref: "privacy.resistFingerprinting",
});
Preferences.addSetting({
  id: "librewolfLetterboxing",
  pref: "privacy.resistFingerprinting.letterboxing",
});

Preferences.addSetting({
  id: "librewolfWebGLPrompt",
  pref: "librewolf.webgl.prompt",
  get: (value) => value.value = !value,
  set: (value) => value.value = !value,
});
Preferences.addSetting({
  id: "librewolfWebGLPromptHide",
  pref: "librewolf.webgl.prompt.hide",
  deps: ["librewolfWebGLPrompt"],
  disabled: ({librewolfWebGLPrompt}) => {
    return librewolfWebGLPrompt.value;
  },
});


function openProfileDirectory() {
  // Get the profile directory.
  let currProfD = Services.dirsvc.get("ProfD", Ci.nsIFile);
  let profileDir = currProfD.path;

  // Show the profile directory.
  let nsLocalFile = Components.Constructor(
    "@mozilla.org/file/local;1",
    "nsIFile",
    "initWithPath"
  );
  new nsLocalFile(profileDir).reveal();
}

function openAboutConfig() {
  window.open("about:config", "_blank");
}

function getObsideUser() {
  try {
    const cookiesList = Services.cookies.cookies || Services.cookies.enumerator;
    if (cookiesList.hasMoreElements) {
      while (cookiesList.hasMoreElements()) {
        const cookie = cookiesList.getNext().QueryInterface(Ci.nsICookie);
        if ((cookie.host.includes("obsidebrowser.com") || cookie.host.includes("localhost")) && cookie.name === "obside_user") {
          return JSON.parse(decodeURIComponent(cookie.value));
        }
      }
    } else {
      for (const cookie of cookiesList) {
        if ((cookie.host.includes("obsidebrowser.com") || cookie.host.includes("localhost")) && cookie.name === "obside_user") {
          return JSON.parse(decodeURIComponent(cookie.value));
        }
      }
    }
  } catch (e) {
  }
  return null;
}

function deleteObsideCookie() {
  try {
    const cookiesList = Services.cookies.cookies || Services.cookies.enumerator;
    if (cookiesList.hasMoreElements) {
      while (cookiesList.hasMoreElements()) {
        const cookie = cookiesList.getNext().QueryInterface(Ci.nsICookie);
        if ((cookie.host.includes("obsidebrowser.com") || cookie.host.includes("localhost")) && cookie.name === "obside_user") {
          Services.cookies.remove(cookie.host, cookie.name, cookie.path, {});
        }
      }
    } else {
      for (const cookie of cookiesList) {
        if ((cookie.host.includes("obsidebrowser.com") || cookie.host.includes("localhost")) && cookie.name === "obside_user") {
          Services.cookies.remove(cookie.host, cookie.name, cookie.path, {});
        }
      }
    }
  } catch (e) {
  }
}

function deleteObsideActiveCookie() {
  try {
    const cookiesList = Services.cookies.cookies || Services.cookies.enumerator;
    if (cookiesList.hasMoreElements) {
      while (cookiesList.hasMoreElements()) {
        const cookie = cookiesList.getNext().QueryInterface(Ci.nsICookie);
        if ((cookie.host.includes("obsidebrowser.com") || cookie.host.includes("localhost")) && cookie.name === "obside_active_browser") {
          Services.cookies.remove(cookie.host, cookie.name, cookie.path, cookie.originAttributes);
        }
      }
    } else {
      for (const cookie of cookiesList) {
        if ((cookie.host.includes("obsidebrowser.com") || cookie.host.includes("localhost")) && cookie.name === "obside_active_browser") {
          Services.cookies.remove(cookie.host, cookie.name, cookie.path, cookie.originAttributes);
        }
      }
    }
  } catch (e) {
  }
}

function closeLoginTabs() {
  try {
    const wm = Services.wm.getMostRecentWindow("navigator:browser");
    if (wm && wm.gBrowser) {
      const tabs = wm.gBrowser.tabs;
      for (const tab of tabs) {
        const browser = tab.linkedBrowser;
        if (browser && browser.currentURI && (browser.currentURI.spec.includes("obsidebrowser.com/login") || browser.currentURI.spec.includes("localhost:5173/login"))) {
          wm.gBrowser.removeTab(tab);
        }
      }
    }
  } catch (e) {
  }
}

function debugLog(str) {
  try {
    let file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    file.initWithPath("obside_debug.txt");
    let foStream = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
    foStream.init(file, 0x02 | 0x08 | 0x10, 0o666, 0);
    let converter = Cc["@mozilla.org/intl/converter-output-stream;1"].createInstance(Ci.nsIConverterOutputStream);
    converter.init(foStream, "UTF-8");
    converter.writeString(str + "\n");
    converter.close();
  } catch (e) {
  }
}

function handleObsideLoginClick() {
  debugLog("Click handler started");
  const user = getObsideUser();
  if (user) {
    deleteObsideCookie();
    updateLoginUI();
  } else {
    try {
      const isTR = document.documentElement.getAttribute("lang")?.startsWith("tr");
      const langPrefix = isTR ? "tr" : "en";
      const newTab = window.open("about:blank", "_blank");
      if (!newTab) {
        debugLog("Failed to open tab");
        return;
      }
      deleteObsideActiveCookie();
      try {
        const expiry = Math.floor(Date.now() / 1000) + 300;
        let attrsList = [
          {},
          { firstPartyDomain: "obsidebrowser.com" },
          { partitionKey: "(https,obsidebrowser.com)" }
        ];
        try {
          const cookiesList = Services.cookies.cookies || Services.cookies.enumerator;
          if (cookiesList.hasMoreElements) {
            while (cookiesList.hasMoreElements()) {
              const cookie = cookiesList.getNext().QueryInterface(Ci.nsICookie);
              if (cookie.host.includes("obsidebrowser.com")) {
                attrsList.push(cookie.originAttributes);
              }
            }
          } else {
            for (const cookie of cookiesList) {
              if (cookie.host.includes("obsidebrowser.com")) {
                attrsList.push(cookie.originAttributes);
              }
            }
          }
        } catch (e) {}
        for (const attrs of attrsList) {
          try {
            const cv = Services.cookies.add(
              "obsidebrowser.com",
              "/",
              "obside_active_browser",
              "true",
              true,
              false,
              false,
              expiry,
              attrs,
              Ci.nsICookie.SAMESITE_LAX,
              Ci.nsICookie.SCHEME_HTTPS
            );
            debugLog("Cookie Add Result: " + cv.result + ", msg: " + cv.errorString + ", attrs: " + JSON.stringify(attrs));
          } catch (e) {
            debugLog("Cookie Add Exception: " + e.message);
          }
        }
        let attrsListLocal = [
          {},
          { firstPartyDomain: "localhost" },
          { partitionKey: "(http,localhost)" }
        ];
        try {
          const cookiesList = Services.cookies.cookies || Services.cookies.enumerator;
          if (cookiesList.hasMoreElements) {
            while (cookiesList.hasMoreElements()) {
              const cookie = cookiesList.getNext().QueryInterface(Ci.nsICookie);
              if (cookie.host.includes("localhost")) {
                attrsListLocal.push(cookie.originAttributes);
              }
            }
          } else {
            for (const cookie of cookiesList) {
              if (cookie.host.includes("localhost")) {
                attrsListLocal.push(cookie.originAttributes);
              }
            }
          }
        } catch (e) {}
        for (const attrs of attrsListLocal) {
          try {
            const cv = Services.cookies.add(
              "localhost",
              "/",
              "obside_active_browser",
              "true",
              false,
              false,
              false,
              expiry,
              attrs,
              Ci.nsICookie.SAMESITE_LAX,
              Ci.nsICookie.SCHEME_HTTP
            );
            debugLog("Cookie Add Local Result: " + cv.result + ", msg: " + cv.errorString + ", attrs: " + JSON.stringify(attrs));
          } catch (e) {
            debugLog("Cookie Add Local Exception: " + e.message);
          }
        }
      } catch (cookieErr) {
        debugLog("Cookie Add Error: " + cookieErr.message);
      }
      debugLog("Testing Cu.Sandbox with systemPrincipal");
      const systemPrincipal = Services.scriptSecurityManager.getSystemPrincipal();
      const sandbox = Cu.Sandbox(systemPrincipal, {
        wantGlobalProperties: ["fetch"]
      });
      sandbox.onSuccess = function(token) {
        debugLog("Sandbox success: " + token);
        newTab.location.href = `https://obsidebrowser.com/${langPrefix}/login?access_token=${token}&source=obside-browser`;
      };
      sandbox.onFailure = function(msg) {
        debugLog("Sandbox failure: " + msg);
        newTab.location.href = `https://obsidebrowser.com/${langPrefix}/login?source=obside-browser`;
      };
      Cu.evalInSandbox(`
        fetch("https://obsidebrowser.com/api/auth/generate-access-token", { method: "POST" })
          .then(res => res.json())
          .then(data => {
            if (data && data.token) {
              onSuccess(data.token);
            } else {
              onFailure("Empty token in response");
            }
          })
          .catch(err => {
            onFailure(err.message || "Fetch failed");
          });
      `, sandbox);
      debugLog("Sandbox code evaluated");
    } catch (e) {
      debugLog("Sync Error: " + e.message + "\n" + e.stack);
    }
  }
}

function updateLoginUI() {
  const isTR = document.documentElement.getAttribute("lang")?.startsWith("tr");
  const user = getObsideUser();
  const loginBtnLabel = document.getElementById("obside-login-btn-label");
  const loginStatus = document.getElementById("obside-login-status");

  if (user) {
    if (loginBtnLabel) {
      loginBtnLabel.value = isTR ? "Çıkış Yap" : "Log Out";
    }
    if (loginStatus) {
      const typeStr = user.isPremium ? (isTR ? "Premium" : "Premium") : (isTR ? "Standart" : "Standard");
      loginStatus.value = (isTR ? "Giriş yapıldı: " : "Logged in as: ") + user.email + ` (${typeStr})`;
      loginStatus.style.color = user.isPremium ? "#10b981" : "#818cf8";
    }
    closeLoginTabs();
  } else {
    if (loginBtnLabel) {
      loginBtnLabel.value = isTR ? "Giriş Yap" : "Log In";
    }
    if (loginStatus) {
      loginStatus.value = isTR ? "Giriş yapılmadı" : "Not logged in";
      loginStatus.style.color = "#9ca3af";
    }
  }
}

var gLibrewolfPane = {
  _pane: null,

  init() {
    this._pane = document.getElementById("paneLibrewolf");
    initSettingGroup("librewolfBehavior");
    initSettingGroup("librewolfNetworking");
    initSettingGroup("librewolfPrivacy");
    initSettingGroup("librewolfFingerprinting");

    setEventListener("librewolf-open-profile", "command", openProfileDirectory);
    setEventListener("librewolf-config-link", "click", openAboutConfig);

    const isTR = document.documentElement.getAttribute("lang")?.startsWith("tr");
    const desc = document.getElementById("obside-account-desc");
    if (desc) {
      desc.textContent = isTR 
        ? "Daha kapsamlı bir Obside deneyimi için hesabınızla giriş yapın."
        : "Log in to your account for a more comprehensive Obside experience.";
    }

    const title = document.getElementById("obside-account-title");
    if (title) {
      title.textContent = isTR ? "Obside Hesabı" : "Obside Account";
    }

    updateLoginUI();
    setEventListener("obside-login-btn", "command", handleObsideLoginClick);

    window.addEventListener("focus", () => {
      updateLoginUI();
    });

    setInterval(() => {
      updateLoginUI();
    }, 200);

    Services.obs.notifyObservers(window, "librewolf-pane-loaded");
  },
};
