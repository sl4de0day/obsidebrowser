"use strict";

var ObsideAdblockLazy = {};
ChromeUtils.defineESModuleGetters(ObsideAdblockLazy, {
  AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
  ObsideEntitlement:
    "resource:///modules/aboutwelcome/ObsideWelcomeAccount.sys.mjs",
  // Obside optimization: resolve the ExtensionPopups module once via a lazy getter
  // instead of ChromeUtils.importESModule() inside showPopup() on every click.
  PanelPopup: "resource:///modules/ExtensionPopups.sys.mjs",
  BasePopup: "resource:///modules/ExtensionPopups.sys.mjs",
});

// Obside security fix (C6/C23): match the Obside account host EXACTLY instead of
// with substring `.includes()`. The old check accepted any cookie whose host merely
// CONTAINED "obsidebrowser.com" (e.g. "notobsidebrowser.com",
// "obsidebrowser.com.evil.example") or "localhost", letting a look-alike site plant
// obside_session/obside_user cookies that this privileged chrome then trusted as the
// logged-in account / premium state. localhost trust is dropped.
function obsideIsAccountHost(host) {
  const h = String(host || "").replace(/^\./, "").toLowerCase();
  return h === "obsidebrowser.com" || h.endsWith(".obsidebrowser.com");
}

var ObsideAdblock = {
  EXTENSION_ID: "{d10d0a8e-282e-4cf4-b816-778841a1eb2a}",

  _enabled: false,
  _initialized: false,
  _toggling: false,
  _addonReady: false,

  async init() {
    if (this._initialized) {
      return;
    }
    this._initialized = true;

    this.checkState();

    let toggleAttempts = 0;
    let bindToggle = () => {
      let toggleBtn = document.getElementById("obside-adblock-toggle");
      if (toggleBtn && !toggleBtn._hasObsideListener) {
        toggleBtn._hasObsideListener = true;
        
        toggleBtn.addEventListener("mousedown", (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          ObsideAdblock.showPopup(toggleBtn);
        });

        toggleBtn.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          e.stopPropagation();
          
          let isTrustPanelEnabled = false;
          try {
            isTrustPanelEnabled = Services.prefs.getBoolPref("browser.urlbar.trustPanel.featureGate", false);
          } catch (ex) {}

          if (isTrustPanelEnabled && typeof gTrustPanelHandler !== "undefined") {
            gTrustPanelHandler.showPopup({
              event: e,
              reason: "obsideAdblockButton"
            });
          } else if (typeof gProtectionsHandler !== "undefined") {
            gProtectionsHandler.showProtectionsPopup({
              event: e,
              openingReason: "obsideAdblockButton"
            });
          }
        });
      } else if (!toggleBtn) {
        // Obside fix: bounded retry (~20s) instead of polling getElementById forever.
        if (++toggleAttempts < 40) setTimeout(bindToggle, 500);
      }
    };
    bindToggle();

    Services.prefs.addObserver("privacy.trackingprotection.enabled", this);
    // Obside fix: watch cookie changes instead of scanning the whole cookie DB every
    // second (see the 1s poll removal below). Best-effort: a notification-API mismatch
    // must not break init, and the slow fallback poll still covers login detection.
    try {
      Services.obs.addObserver(this, "cookie-changed");
      Services.obs.addObserver(this, "private-cookie-changed");
    } catch (e) {}

    this._initAddonManager();

    let loginAttempts = 0;
    let bindLoginBtn = () => {
      let loginBtn = document.getElementById("obside-toolbar-login-button");
      if (loginBtn && !loginBtn._hasObsideListener) {
        loginBtn._hasObsideListener = true;
        loginBtn.addEventListener("mousedown", (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          ObsideAdblock.handleToolbarLogin();
        });
      } else if (!loginBtn) {
        // Obside fix: bounded retry (~20s) instead of polling getElementById forever.
        if (++loginAttempts < 40) setTimeout(bindLoginBtn, 500);
      }
    };
    bindLoginBtn();

    this.checkObsideLoginState();
    // Obside optimization: keep named handler/timer references so the unload handler
    // can tear them down (previously only the pref observer was removed on unload).
    this._onFocusLogin = () => this.checkObsideLoginState();
    this._onFocusPremium = () => this._maybeSyncPremium(120000);
    window.addEventListener("focus", this._onFocusLogin);
    window.addEventListener("focus", this._onFocusPremium);
    // Obside fix: the login state is now driven by the cookie-changed observer (above) +
    // the focus listener. This interval is only a slow FALLBACK, reduced from 1000ms
    // (a full cookie-DB scan every second, per window) to 5000ms.
    this._loginPollId = setInterval(() => {
      this.checkObsideLoginState();
    }, 5000);
    this._premiumInitId = setTimeout(() => {
      this._maybeSyncPremium(1500000);
    }, 8000);
    this._premiumPollId = setInterval(() => {
      this._maybeSyncPremium(1500000);
    }, 600000);
  },

  showPopup(anchorNode) {
    try {
      const { PanelPopup, BasePopup } = ObsideAdblockLazy;
      let policy = WebExtensionPolicy.getByID(this.EXTENSION_ID);
      if (!policy || !policy.extension) {
        return;
      }
      let extension = policy.extension;
      let existingPopup = BasePopup.for(extension, window);
      if (existingPopup) {
        existingPopup.close();
        return;
      }
      let requested = "";
      try {
        requested = Services.prefs.getCharPref("intl.locale.requested");
      } catch (e) {}
      let rawLocale = requested ? requested.split(",")[0] : Services.locale.appLocaleAsBCP47;
      let locale = rawLocale.replace("-", "_");
      let popupURL = policy.getURL("popup-fenix.html?locale=" + locale);
      let popup = new PanelPopup(extension, window.document, popupURL, false);
      // Obside: make the extension popup show the SAME chrome panel::part(content)
      // glassmorphism as the native VPN panel. The <browser>'s canvas is opaque
      // unless it carries the XUL "transparent" attribute (PresShell), so CSS
      // transparency on the page/element alone is NOT enough — set the attribute.
      if (popup.browser) {
        popup.browser.setAttribute("transparent", "true");
      }
      popup.panel.style.setProperty("--arrowpanel-background", "transparent", "important");
      popup.setBackground = function(background) {
        this.panel.style.setProperty("--arrowpanel-background", "transparent", "important");
      };
      popup.viewNode.openPopup(anchorNode, "bottomright topleft", 0, 0, false, false);
    } catch (e) {
      Cu.reportError("ObsideAdblock showPopup error: " + e);
    }
  },

  observe(aSubject, aTopic, aData) {
    if (aTopic === "nsPref:changed" && aData === "privacy.trackingprotection.enabled") {
      this.checkState();
      return;
    }
    if (aTopic === "cookie-changed" || aTopic === "private-cookie-changed") {
      // Obside fix: event-driven login-state refresh. Cookie changes fire often, so
      // coalesce bursts into a single checkObsideLoginState within ~300ms instead of
      // running a full cookie-DB scan on every notification.
      if (!this._loginCheckScheduled) {
        this._loginCheckScheduled = true;
        setTimeout(() => {
          this._loginCheckScheduled = false;
          this.checkObsideLoginState();
        }, 300);
      }
    }
  },

  async _initAddonManager() {
    try {
      await this._waitForAddonManager();
      this._addonReady = true;

      ObsideAdblockLazy.AddonManager.addAddonListener({
        onEnabled: (addon) => {
          if (addon.id === ObsideAdblock.EXTENSION_ID) {
            this.checkState();
          }
        },
        onDisabled: (addon) => {
          if (addon.id === ObsideAdblock.EXTENSION_ID) {
            this.checkState();
          }
        },
      });
    } catch (e) {
      Cu.reportError("ObsideAdblock _initAddonManager: " + e);
    }
  },

  async _waitForAddonManager() {
    for (let i = 0; i < 30; i++) {
      try {
        let addon = await ObsideAdblockLazy.AddonManager.getAddonByID(this.EXTENSION_ID);
        if (addon !== null) return;
      } catch (e) {}
      await new Promise(r => setTimeout(r, 500));
    }
  },

  async toggle() {
    if (this._toggling) return;
    this._toggling = true;

    try {
      let nextState = !this._enabled;

      Services.prefs.setBoolPref("privacy.trackingprotection.enabled", nextState);
      Services.prefs.setBoolPref("privacy.trackingprotection.pbmode.enabled", nextState);
      Services.prefs.setBoolPref("privacy.trackingprotection.socialtracking.enabled", nextState);
      Services.prefs.setBoolPref("privacy.trackingprotection.cryptomining.enabled", nextState);
      Services.prefs.setBoolPref("privacy.trackingprotection.fingerprinting.enabled", nextState);

      this._enabled = nextState;
      this._updateIcon();
    } catch (e) {
      console.error("ObsideAdblock toggle error: ", e);
      Cu.reportError("ObsideAdblock toggle: " + e);
    } finally {
      this._toggling = false;
    }
  },

  _updateIcon() {
    const icon = document.getElementById("obside-adblock-icon");
    if (!icon) return;

    const container = document.getElementById("obside-adblock-toggle");
    const isTR = ((Services.locale.appLocalesAsBCP47 || [])[0] || "").startsWith("tr");

    if (this._enabled) {
      icon.setAttribute("src", "chrome://browser/skin/shield-check.svg");
      container?.classList.remove("disabled");
      container?.setAttribute("tooltiptext", isTR ? "Obside Adblock & Koruması: Açık (Sağ tık: Detaylar)" : "Obside Adblock & Protection: On (Right-click: Details)");
    } else {
      icon.setAttribute("src", "chrome://browser/skin/shield-x.svg");
      container?.classList.add("disabled");
      container?.setAttribute("tooltiptext", isTR ? "Obside Adblock & Koruması: Kapalı (Sağ tık: Detaylar)" : "Obside Adblock & Protection: Off (Right-click: Details)");
    }
  },

  checkState() {
    try {
      // Read the global Firefox tracking protection preference
      let tpEnabled = Services.prefs.getBoolPref("privacy.trackingprotection.enabled", true);
      this._enabled = tpEnabled;
      this._updateIcon();
    } catch (e) {
      Cu.reportError("ObsideAdblock checkState: " + e);
    }
  },

  handleToolbarLogin() {
    try {
      this.closeObsideLoginTabs();
      let isTR = false;
      try {
        let requested = Services.prefs.getCharPref("intl.locale.requested", "");
        isTR = requested.startsWith("tr");
      } catch (e) {}
      const langPrefix = isTR ? "tr" : "en";
      let newTab = gBrowser.addTrustedTab("about:blank");
      gBrowser.selectedTab = newTab;
      let newBrowser = newTab.linkedBrowser;
      try {
        const cookiesList = Services.cookies.cookies || Services.cookies.enumerator;
        if (cookiesList.hasMoreElements) {
          while (cookiesList.hasMoreElements()) {
            const cookie = cookiesList.getNext().QueryInterface(Ci.nsICookie);
            if (obsideIsAccountHost(cookie.host) && cookie.name === "obside_active_browser") {
              Services.cookies.remove(cookie.host, cookie.name, cookie.path, cookie.originAttributes);
            }
          }
        } else {
          for (const cookie of cookiesList) {
            if (obsideIsAccountHost(cookie.host) && cookie.name === "obside_active_browser") {
              Services.cookies.remove(cookie.host, cookie.name, cookie.path, cookie.originAttributes);
            }
          }
        }
      } catch (e) {}
      try {
        const expiry = Date.now() + 300000;
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
              if (obsideIsAccountHost(cookie.host)) {
                attrsList.push(cookie.originAttributes);
              }
            }
          } else {
            for (const cookie of cookiesList) {
              if (obsideIsAccountHost(cookie.host)) {
                attrsList.push(cookie.originAttributes);
              }
            }
          }
        } catch (e) {}
        for (const attrs of attrsList) {
          try {
            Services.cookies.add(
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
            Services.cookies.add(
              ".obsidebrowser.com",
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
          } catch (e) {}
        }
        // Obside security fix (C23): removed the obside_active_browser marker plant on
        // localhost over plaintext HTTP (non-secure cookie). Only the HTTPS
        // obsidebrowser.com marker above is kept.
      } catch (cookieErr) {}
      const systemPrincipal = Services.scriptSecurityManager.getSystemPrincipal();
      const sandbox = Cu.Sandbox(systemPrincipal, {
        wantGlobalProperties: ["fetch"]
      });
      // SECURITY NOTE C19 (needs server coordination): the access_token is placed in the
      // login URL QUERY STRING, so it persists to history/session store. Firefox's
      // default Referrer-Policy keeps it from leaking cross-origin (local/first-party
      // exposure only, low). Clean fix requires the server to accept the token via POST
      // body or first-party cookie handoff instead of the query string.
      sandbox.onSuccess = function(token) {
        newBrowser.loadURI(Services.io.newURI(`https://obsidebrowser.com/${langPrefix}/login?access_token=${token}&source=obside-browser`), {
          triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
        });
      };
      sandbox.onFailure = function(msg) {
        newBrowser.loadURI(Services.io.newURI(`https://obsidebrowser.com/${langPrefix}/login?source=obside-browser`), {
          triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
        });
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
    } catch (e) {
      Cu.reportError("handleToolbarLogin error: " + e);
    }
  },

  closeObsideLoginTabs() {
    try {
      if (typeof gBrowser !== "undefined" && gBrowser.tabs) {
        for (const tab of gBrowser.tabs) {
          const browser = tab.linkedBrowser;
          // Obside security fix (C45): match the tab's URI host EXACTLY (and require the
          // /login path) instead of a substring test on the full spec, which could
          // force-close an arbitrary tab whose URL merely contained "obsidebrowser.com".
          let u = null;
          try { u = browser && browser.currentURI; } catch (e) {}
          if (u && u.scheme === "https" && obsideIsAccountHost(u.host) && u.filePath === "/login") {
            gBrowser.removeTab(tab);
          }
        }
      }
    } catch (e) {}
  },

  checkObsideLoginState() {
    let loggedIn = false;
    try {
      const cookiesList = Services.cookies.cookies || Services.cookies.enumerator;
      if (cookiesList.hasMoreElements) {
        while (cookiesList.hasMoreElements()) {
          const cookie = cookiesList.getNext().QueryInterface(Ci.nsICookie);
          if (obsideIsAccountHost(cookie.host) && cookie.name === "obside_user") {
            loggedIn = true;
            break;
          }
        }
      } else {
        for (const cookie of cookiesList) {
          if (obsideIsAccountHost(cookie.host) && cookie.name === "obside_user") {
            loggedIn = true;
            break;
          }
        }
      }
    } catch (e) {}
    let btn = document.getElementById("obside-toolbar-login-button");
    if (btn) {
      btn.hidden = loggedIn;
    }
  },

  _getObsideUser() {
    try {
      const cookiesList = Services.cookies.cookies || Services.cookies.enumerator;
      if (cookiesList.hasMoreElements) {
        while (cookiesList.hasMoreElements()) {
          const cookie = cookiesList.getNext().QueryInterface(Ci.nsICookie);
          if (obsideIsAccountHost(cookie.host) && cookie.name === "obside_user") {
            return JSON.parse(decodeURIComponent(cookie.value));
          }
        }
      } else {
        for (const cookie of cookiesList) {
          if (obsideIsAccountHost(cookie.host) && cookie.name === "obside_user") {
            return JSON.parse(decodeURIComponent(cookie.value));
          }
        }
      }
    } catch (e) {}
    return null;
  },

  _maybeSyncPremium(minAgeMs) {
    try {
      const last = Services.prefs.getStringPref("obside.premium.lastVerified", "");
      if (last) {
        const t = Date.parse(last);
        if (!isNaN(t) && (Date.now() - t) < minAgeMs) {
          return;
        }
      }
    } catch (e) {}
    this._syncPremiumStatus();
  },

  _syncPremiumStatus() {
    const user = this._getObsideUser();
    if (!user) {
      return;
    }
    const self = this;
    try {
      const systemPrincipal = Services.scriptSecurityManager.getSystemPrincipal();
      const sandbox = Cu.Sandbox(systemPrincipal, { wantGlobalProperties: ["fetch"] });
      sandbox.onSuccess = async function(dataStr) {
        try {
          const data = JSON.parse(dataStr);
          if (!data || !data.success || !data.user) {
            return;
          }
          const accountEmail = data.user.email || user.email;
          const verified = await ObsideAdblockLazy.ObsideEntitlement.verify(
            data.entitlement,
            accountEmail
          );
          if (!verified) {
            Cu.reportError("ObsideAdblock: unsigned or invalid entitlement, premium not applied");
            return;
          }
          const updatedUser = {
            email: accountEmail,
            isPremium: verified.isPremium,
            name: data.user.name || data.user.fullName || user.name || user.fullName || "",
            nickname: data.user.nickname || user.nickname || "",
            premiumLicenseKey: data.user.premiumLicenseKey || user.premiumLicenseKey || "",
            premiumSource: verified.source
          };
          try {
            Services.prefs.setBoolPref("obside.premium.active", verified.isPremium);
            Services.prefs.setStringPref("obside.premium.source", verified.source);
            Services.prefs.setStringPref("obside.premium.periodEnd", verified.periodEnd);
            Services.prefs.setStringPref("obside.premium.lastVerified", new Date().toISOString());
          } catch (e) {}
          self._writeObsideUserCookie(updatedUser);
        } catch (e) {}
      };
      sandbox.userEmail = user.email;
      Cu.evalInSandbox(`
        fetch("https://obsidebrowser.com/api/auth/status?email=" + encodeURIComponent(userEmail) + "&t=" + Date.now(), { credentials: "include", cache: "no-store" })
          .then(res => {
            if (!res.ok) { return; }
            return res.json().then(data => { onSuccess(JSON.stringify(data)); });
          })
          .catch(err => {
            fetch("https://obsidebrowser.com/api/user/status?email=" + encodeURIComponent(userEmail) + "&t=" + Date.now(), { credentials: "include", cache: "no-store" })
              .then(res => { if (!res.ok) { return; } return res.json().then(data => { onSuccess(JSON.stringify(data)); }); })
              .catch(() => {});
          });
      `, sandbox);
    } catch (e) {}
  },

  _writeObsideUserCookie(updatedUser) {
    try {
      const attrsList = [{}];
      const cookiesList = Services.cookies.cookies || Services.cookies.enumerator;
      if (cookiesList.hasMoreElements) {
        while (cookiesList.hasMoreElements()) {
          const cookie = cookiesList.getNext().QueryInterface(Ci.nsICookie);
          if (obsideIsAccountHost(cookie.host) && cookie.name === "obside_user") {
            attrsList.push(cookie.originAttributes);
          }
        }
      } else {
        for (const cookie of cookiesList) {
          if (obsideIsAccountHost(cookie.host) && cookie.name === "obside_user") {
            attrsList.push(cookie.originAttributes);
          }
        }
      }
      const cookieValStr = encodeURIComponent(JSON.stringify(updatedUser));
      const expiry = Date.now() + 365 * 24 * 60 * 60 * 1000;
      for (const attrs of attrsList) {
        try {
          Services.cookies.add("obsidebrowser.com", "/", "obside_user", cookieValStr, true, false, false, expiry, attrs, Ci.nsICookie.SAMESITE_LAX, Ci.nsICookie.SCHEME_HTTPS);
          Services.cookies.add(".obsidebrowser.com", "/", "obside_user", cookieValStr, true, false, false, expiry, attrs, Ci.nsICookie.SAMESITE_LAX, Ci.nsICookie.SCHEME_HTTPS);
        } catch (e) {}
      }
    } catch (e) {}
  }
};

window.addEventListener("load", () => {
  setTimeout(() => ObsideAdblock.init(), 500);
}, { once: true });
window.addEventListener("unload", () => {
  try {
    Services.prefs.removeObserver("privacy.trackingprotection.enabled", ObsideAdblock);
  } catch (e) {}
  // Obside optimization: clear the login/premium poll timers and focus listeners so
  // they stop firing (and stop retaining closures) once the window is torn down.
  try {
    clearInterval(ObsideAdblock._loginPollId);
    clearInterval(ObsideAdblock._premiumPollId);
    clearTimeout(ObsideAdblock._premiumInitId);
    window.removeEventListener("focus", ObsideAdblock._onFocusLogin);
    window.removeEventListener("focus", ObsideAdblock._onFocusPremium);
  } catch (e) {}
  try {
    Services.obs.removeObserver(ObsideAdblock, "cookie-changed");
    Services.obs.removeObserver(ObsideAdblock, "private-cookie-changed");
  } catch (e) {}
});
