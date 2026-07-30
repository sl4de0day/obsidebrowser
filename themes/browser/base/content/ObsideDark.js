"use strict";

var ObsideDarkLazy = {};
ChromeUtils.defineESModuleGetters(ObsideDarkLazy, {
  AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
});

var ObsideDark = {
  EXTENSION_ID: "{9f091c53-b09e-4e4b-91cc-71866db3f898}",

  _enabled: true,
  _initialized: false,
  _toggling: false,
  _addonReady: false,

  async init() {
    if (this._initialized) {
      return;
    }
    this._initialized = true;

    this._updateIcon();

    let bindToggle = () => {
      let toggleBtn = document.getElementById("obside-dark-toggle");
      if (toggleBtn && !toggleBtn._hasObsideListener) {
        toggleBtn._hasObsideListener = true;
        toggleBtn.addEventListener("mousedown", (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          ObsideDark.toggle();
        });
      } else if (!toggleBtn) {
        setTimeout(bindToggle, 500);
      }
    };
    bindToggle();

    this._initAddonManager();
  },

  async _initAddonManager() {
    try {
      // Obside optimization: reuse the addon the wait already resolved instead of
      // issuing a second getAddonByID; only re-fetch if the wait timed out (addon null).
      let addon = await this._waitForAddonManager();
      this._addonReady = true;

      if (!addon) {
        addon = await ObsideDarkLazy.AddonManager.getAddonByID(this.EXTENSION_ID);
      }
      if (addon && !addon.isActive) {
        await addon.enable({ allowSystemAddons: true });
      }

      await this.checkState();

      // Obside fix: keep the listener reference so unload can remove it. This per-window
      // AddonManager listener was never torn down (zombie-window retention).
      this._addonListener = {
        onEnabled: (addon) => {
          if (addon.id === ObsideDark.EXTENSION_ID) {
            ObsideDark.checkState();
          }
        },
        onDisabled: (addon) => {
          if (addon.id === ObsideDark.EXTENSION_ID) {
            // Keep the extension active and enabled at all times
            addon.enable({ allowSystemAddons: true });
          }
        },
        onInstalled: (addon) => {
          if (addon.id === ObsideDark.EXTENSION_ID) {
            ObsideDark.checkState();
          }
        },
        onUninstalled: (addon) => {
          if (addon.id === ObsideDark.EXTENSION_ID) {
            ObsideDark.checkState();
          }
        },
      };
      ObsideDarkLazy.AddonManager.addAddonListener(this._addonListener);
    } catch (e) {
      Cu.reportError("ObsideDark _initAddonManager: " + e);
    }
  },

  async _waitForAddonManager() {
    for (let i = 0; i < 30; i++) {
      try {
        let addon = await ObsideDarkLazy.AddonManager.getAddonByID(this.EXTENSION_ID);
        if (addon !== null) return addon;
      } catch (e) {}
      await new Promise(r => setTimeout(r, 500));
    }
    return null;
  },

  async toggle() {
    if (this._toggling) return;
    this._toggling = true;

    try {
      let addon = await ObsideDarkLazy.AddonManager.getAddonByID(this.EXTENSION_ID);
      if (!addon) {
        console.error("ObsideDark toggle: Addon not found");
        this._toggling = false;
        return;
      }

      if (!addon.isActive) {
        await addon.enable({ allowSystemAddons: true });
      }

      let policy = WebExtensionPolicy.getByID(this.EXTENSION_ID);
      let bgWindow = policy?.extension?.backgroundContext?.contentWindow;

      // Force instant optimizations before toggling
      if (bgWindow && bgWindow.UserStorage && bgWindow.UserStorage.settings && bgWindow.Extension && typeof bgWindow.Extension.changeSettings === "function") {
        let settings = bgWindow.UserStorage.settings;
        if (settings.detectDarkTheme !== false || (settings.theme && settings.theme.immediateModify !== true)) {
          bgWindow.Extension.changeSettings({
            detectDarkTheme: false,
            theme: {
              ...settings.theme,
              immediateModify: true
            }
          });
        }
      }

      let shortcuts = policy?.extension?.shortcuts;
      if (shortcuts && typeof shortcuts.onCommand === "function") {
        shortcuts.onCommand("toggle");
        this._enabled = !this._enabled;
      } else {
        if (bgWindow && bgWindow.Extension && typeof bgWindow.Extension.changeSettings === "function") {
          this._enabled = !this._enabled;
          bgWindow.Extension.changeSettings({ enabled: this._enabled });
        } else {
          console.error("ObsideDark toggle: shortcuts.onCommand and background context are not available");
        }
      }
      this._updateIcon();
    } catch (e) {
      console.error("ObsideDark toggle error: ", e);
      Cu.reportError("ObsideDark toggle: " + e);
    } finally {
      this._toggling = false;
    }
  },

  async checkState() {
    try {
      let policy = WebExtensionPolicy.getByID(this.EXTENSION_ID);
      let bgWindow = policy?.extension?.backgroundContext?.contentWindow;
      if (bgWindow && bgWindow.UserStorage && bgWindow.UserStorage.settings) {
        this._enabled = bgWindow.UserStorage.settings.enabled;

        // Force instant optimizations
        let settings = bgWindow.UserStorage.settings;
        if (bgWindow.Extension && typeof bgWindow.Extension.changeSettings === "function") {
          if (settings.detectDarkTheme !== false || (settings.theme && settings.theme.immediateModify !== true)) {
            bgWindow.Extension.changeSettings({
              detectDarkTheme: false,
              theme: {
                ...settings.theme,
                immediateModify: true
              }
            });
          }
        }
      } else {
        let profDir = Services.dirsvc.get("ProfD", Ci.nsIFile).path;
        let storagePath = PathUtils.join(profDir, "browser-extension-data", this.EXTENSION_ID, "storage.js");
        if (await IOUtils.exists(storagePath)) {
          let raw = await IOUtils.readUTF8(storagePath);
          let data = JSON.parse(raw);
          if (data && data.enabled !== undefined) {
            this._enabled = data.enabled;
          } else if (data && data.settings && data.settings.enabled !== undefined) {
            this._enabled = data.settings.enabled;
          } else {
            this._enabled = true;
          }
        } else {
          this._enabled = true;
        }
      }
    } catch (e) {
      this._enabled = true;
      Cu.reportError("ObsideDark checkState: " + e);
    }
    this._updateIcon();
  },

  _updateIcon() {
    const icon = document.getElementById("obside-dark-icon");
    if (!icon) return;

    const container = document.getElementById("obside-dark-toggle");

    if (this._enabled) {
      container?.classList.remove("disabled");
      container?.setAttribute("tooltiptext", "Koyu Tema: Açık");
    } else {
      container?.classList.add("disabled");
      container?.setAttribute("tooltiptext", "Koyu Tema: Kapalı");
    }
  }
};

window.addEventListener("load", () => {
  setTimeout(() => ObsideDark.init(), 500);
}, { once: true });
window.addEventListener("unload", () => {
  // Obside fix: remove the per-window AddonManager listener on teardown.
  try {
    if (ObsideDark._addonListener) {
      ObsideDarkLazy.AddonManager.removeAddonListener(ObsideDark._addonListener);
    }
  } catch (e) {}
});
