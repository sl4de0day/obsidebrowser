"use strict";

var ObsideResourceLazy = {};
ChromeUtils.defineESModuleGetters(ObsideResourceLazy, {
  AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
});

var ObsideResource = {
  EXTENSION_ID: "{c2c003ee-bd69-42a2-b0e9-6f34222cb046}",

  _enabled: false,
  _initialized: false,
  _toggling: false,
  _addonReady: false,

  async init() {
    if (this._initialized) {
      return;
    }
    this._initialized = true;

    let navbar = document.getElementById("nav-bar-customization-target");
    let reloadBtn = document.getElementById("stop-reload-button");
    let forwardBtn = document.getElementById("forward-button");
    if (navbar && reloadBtn && forwardBtn) {
      navbar.insertBefore(reloadBtn, forwardBtn);
    }

    try {
      this._enabled = Services.prefs.getBoolPref("obside.resource.enabled", true);
    } catch (e) {
      this._enabled = true;
      Services.prefs.setBoolPref("obside.resource.enabled", true);
    }

    Services.prefs.addObserver("obside.resource.", this);

    this._initAddonManager();
  },

  observe(subject, topic, data) {
    // Obside fix: this observer is registered for the "obside.resource." PREFIX, so `data`
    // is the FULL changed pref name ("obside.resource.enabled"), never the bare "enabled".
    // The old `data === "enabled"` never matched, leaving this pref-driven toggle dead.
    if (topic === "nsPref:changed" && data === "obside.resource.enabled") {
      let prefVal = Services.prefs.getBoolPref("obside.resource.enabled", true);
      if (prefVal !== this._enabled) {
        this.toggleAddonState(prefVal);
      }
    }
  },

  async _initAddonManager() {
    try {
      await this._waitForAddonManager();
      this._addonReady = true;
      await this.checkState();

      // Obside fix: keep the listener reference so unload can remove it (per-window
      // AddonManager listeners were never torn down).
      this._addonListener = {
        onEnabled: (addon) => {
          if (addon.id === ObsideResource.EXTENSION_ID) {
            ObsideResource._enabled = true;
            if (Services.prefs.getBoolPref("obside.resource.enabled", true) !== true) {
              Services.prefs.setBoolPref("obside.resource.enabled", true);
            }
          }
        },
        onDisabled: (addon) => {
          if (addon.id === ObsideResource.EXTENSION_ID) {
            ObsideResource._enabled = false;
            if (Services.prefs.getBoolPref("obside.resource.enabled", true) !== false) {
              Services.prefs.setBoolPref("obside.resource.enabled", false);
            }
          }
        },
        onInstalled: (addon) => {
          if (addon.id === ObsideResource.EXTENSION_ID) {
            ObsideResource.checkState();
          }
        },
        onUninstalled: (addon) => {
          if (addon.id === ObsideResource.EXTENSION_ID) {
            ObsideResource._enabled = false;
            if (Services.prefs.getBoolPref("obside.resource.enabled", true) !== false) {
              Services.prefs.setBoolPref("obside.resource.enabled", false);
            }
          }
        },
      };
      ObsideResourceLazy.AddonManager.addAddonListener(this._addonListener);
    } catch (e) {
      Cu.reportError("ObsideResource _initAddonManager: " + e);
    }
  },

  async _waitForAddonManager() {
    for (let i = 0; i < 30; i++) {
      try {
        let addon = await ObsideResourceLazy.AddonManager.getAddonByID(this.EXTENSION_ID);
        if (addon !== null) return;
      } catch (e) {}
      await new Promise(r => setTimeout(r, 500));
    }
  },

  async toggleAddonState(enabled) {
    if (this._toggling) return;
    this._toggling = true;

    try {
      let addon = await ObsideResourceLazy.AddonManager.getAddonByID(this.EXTENSION_ID);
      if (!addon) {
        this._toggling = false;
        return;
      }

      if (enabled && !addon.isActive) {
        await addon.enable({ allowSystemAddons: true });
        this._enabled = true;
      } else if (!enabled && addon.isActive) {
        await addon.disable({ allowSystemAddons: true });
        this._enabled = false;
      }
    } catch (e) {
      Cu.reportError("ObsideResource toggleAddonState: " + e);
    } finally {
      this._toggling = false;
    }
  },

  async checkState() {
    try {
      const addon = await ObsideResourceLazy.AddonManager.getAddonByID(this.EXTENSION_ID);
      if (addon) {
        this._enabled = addon.isActive;
      } else {
        this._enabled = false;
      }
      if (Services.prefs.getBoolPref("obside.resource.enabled", true) !== this._enabled) {
        Services.prefs.setBoolPref("obside.resource.enabled", this._enabled);
      }
    } catch (e) {
      Cu.reportError("ObsideResource checkState: " + e);
    }
  }
};

window.addEventListener("load", () => {
  setTimeout(() => ObsideResource.init(), 500);
}, { once: true });
window.addEventListener("unload", () => {
  // Obside fix: tear down the global pref observer + AddonManager listener from init() so
  // a closed window's ObsideResource is not retained and stops reacting to changes.
  try {
    Services.prefs.removeObserver("obside.resource.", ObsideResource);
  } catch (e) {}
  try {
    if (ObsideResource._addonListener) {
      ObsideResourceLazy.AddonManager.removeAddonListener(ObsideResource._addonListener);
    }
  } catch (e) {}
});
