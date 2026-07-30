"use strict";

var ObsideHyperFetchLazy = {};
ChromeUtils.defineESModuleGetters(ObsideHyperFetchLazy, {
  Downloads: "resource://gre/modules/Downloads.sys.mjs",
});

var ObsideHyperFetch = {
  _enabled: true,
  _initialized: false,
  _toggling: false,

  async init() {
    if (this._initialized) {
      return;
    }
    this._initialized = true;

    try {
      this._enabled = Services.prefs.getBoolPref("obside.hyperfetch.enabled", true);
    } catch (e) {
      this._enabled = true;
      Services.prefs.setBoolPref("obside.hyperfetch.enabled", true);
    }

    Services.prefs.addObserver("obside.hyperfetch.", this);
  },

  observe(subject, topic, data) {
    // Obside fix: prefix ("obside.hyperfetch.") observers receive the FULL pref name, so
    // `data === "enabled"` never matched — this transition branch was dead code.
    if (topic === "nsPref:changed" && data === "obside.hyperfetch.enabled") {
      let prefVal = Services.prefs.getBoolPref("obside.hyperfetch.enabled", true);
      if (prefVal !== this._enabled) {
        this.transitionDownloads(prefVal);
      }
    }
  },

  async transitionDownloads(enabled) {
    if (this._toggling) return;
    this._toggling = true;

    try {
      this._enabled = enabled;
      const list = await ObsideHyperFetchLazy.Downloads.getList(ObsideHyperFetchLazy.Downloads.ALL);
      const downloads = await list.getAll();
      
      for (let download of downloads) {
        if (!download.stopped) {
          await download.cancel();
          if (this._enabled) {
            download.switchToSaver("hyperfetch");
          } else {
            download.switchToSaver("copy");
          }
          download.start().catch(console.error);
        }
      }
    } catch (e) {
      Cu.reportError("[HyperFetch] Error during preference change transition: " + e);
    } finally {
      this._toggling = false;
    }
  }
};

window.addEventListener("load", () => {
  setTimeout(() => ObsideHyperFetch.init(), 500);
}, { once: true });
window.addEventListener("unload", () => {
  // Obside fix: remove the global pref observer registered in init() on teardown.
  try {
    Services.prefs.removeObserver("obside.hyperfetch.", ObsideHyperFetch);
  } catch (e) {}
});
