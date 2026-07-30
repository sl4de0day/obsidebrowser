"use strict";

import { setTimeout, clearTimeout, setInterval, clearInterval } from "resource://gre/modules/Timer.sys.mjs";

const ENDPOINT_PREF = "obside.vpn.endpoint";
const ENABLED_PREF = "obside.vpn.enabled";
const CONNECTED_PREF = "obside.vpn.connected";
const SELECTED_PREF = "obside.vpn.selected_server";
const SERVERLIST_PREF = "obside.vpn.server_list";
const LASTERROR_PREF = "obside.vpn.last_error";
const PROXYAPPLIED_PREF = "obside.vpn.proxy_applied";
const NETWORK_MANAGER_ID = "network-manager@obsidebrowser.com";
const POLL_INTERVAL_MS = 30000;
const PUSH_TIMEOUT_MS = 10000;

let pollTimer = null;
let proxyErrorListener = null;
let proxyErrorExtension = null;

export const ObsideVpnService = {
  init() {
    if (pollTimer) {
      return;
    }
    this._backfillProxyApplied();
    this._installProxyErrorListener();
    this.fetchServers().catch(e => Cu.reportError("ObsideVpnService init fetchServers: " + e));
    this.pollStatus().catch(e => Cu.reportError("ObsideVpnService init pollStatus: " + e));
    pollTimer = setInterval(() => {
      ObsideVpnService.fetchServers().catch(e => Cu.reportError("ObsideVpnService fetchServers: " + e));
      ObsideVpnService.pollStatus().catch(e => Cu.reportError("ObsideVpnService pollStatus: " + e));
    }, POLL_INTERVAL_MS);
  },

  _backfillProxyApplied() {
    try {
      if (Services.prefs.prefHasUserValue(PROXYAPPLIED_PREF)) {
        return;
      }
      if (Services.prefs.getBoolPref(CONNECTED_PREF, false)) {
        Services.prefs.setBoolPref(PROXYAPPLIED_PREF, true);
      }
    } catch (e) {
      Cu.reportError("ObsideVpnService backfill proxy_applied: " + e);
    }
  },

  shutdown() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    this._removeProxyErrorListener();
  },

  _installProxyErrorListener() {
    if (proxyErrorListener) {
      return;
    }
    proxyErrorListener = (name, error) => ObsideVpnService._onProxyError(error);
    let attempts = 0;
    const attach = () => {
      if (!proxyErrorListener) {
        return;
      }
      let extension = null;
      try {
        extension = WebExtensionPolicy.getByID(NETWORK_MANAGER_ID)?.extension || null;
      } catch (e) {}
      if (extension && typeof extension.on === "function") {
        proxyErrorExtension = extension;
        extension.on("proxy-error", proxyErrorListener);
        return;
      }
      if (attempts++ < 20) {
        setTimeout(attach, 500);
      } else {
        Cu.reportError("ObsideVpnService: network-manager unavailable, proxy errors will not be reported");
      }
    };
    attach();
  },

  _removeProxyErrorListener() {
    if (proxyErrorExtension && proxyErrorListener) {
      try {
        proxyErrorExtension.off("proxy-error", proxyErrorListener);
      } catch (e) {}
    }
    proxyErrorExtension = null;
    proxyErrorListener = null;
  },

  _onProxyError(error) {
    const message = String((error && error.message) || error || "unknown");
    Cu.reportError("ObsideVpnService proxy error: " + message);
    try {
      Services.prefs.setCharPref(LASTERROR_PREF, message);
    } catch (e) {}
    if (Services.prefs.getBoolPref(CONNECTED_PREF, false)) {
      this.disconnect().catch(e => Cu.reportError("ObsideVpnService disconnect: " + e));
    }
  },

  _endpoint() {
    try {
      let value = Services.prefs.getStringPref(ENDPOINT_PREF, "https://obsidebrowser.com");
      return value.replace(/\/+$/, "");
    } catch (e) {
      return "https://obsidebrowser.com";
    }
  },

  _hostMatches(host) {
    // Obside security fix (C6/C23): exact-host match; localhost no longer trusted as an
    // Obside session origin (it let a plaintext-HTTP cookie be read as a Bearer token).
    const h = String(host || "").replace(/^\./, "").toLowerCase();
    return h === "obsidebrowser.com" || h.endsWith(".obsidebrowser.com");
  },

  _sessionCookie() {
    try {
      const cookiesList = Services.cookies.cookies || Services.cookies.enumerator;
      if (cookiesList.hasMoreElements) {
        while (cookiesList.hasMoreElements()) {
          const cookie = cookiesList.getNext().QueryInterface(Ci.nsICookie);
          if (this._hostMatches(cookie.host) && cookie.name === "obside_session") {
            return cookie.value;
          }
        }
      } else {
        for (const cookie of cookiesList) {
          if (this._hostMatches(cookie.host) && cookie.name === "obside_session") {
            return cookie.value;
          }
        }
      }
    } catch (e) {}
    return "";
  },

  _isLoggedIn() {
    try {
      const cookiesList = Services.cookies.cookies || Services.cookies.enumerator;
      if (cookiesList.hasMoreElements) {
        while (cookiesList.hasMoreElements()) {
          const cookie = cookiesList.getNext().QueryInterface(Ci.nsICookie);
          if (this._hostMatches(cookie.host) && cookie.name === "obside_user") {
            return true;
          }
        }
      } else {
        for (const cookie of cookiesList) {
          if (this._hostMatches(cookie.host) && cookie.name === "obside_user") {
            return true;
          }
        }
      }
    } catch (e) {}
    return false;
  },

  _readSession() {
    // Obside optimization: one cookie-jar pass returning BOTH the login flag and the
    // session token, replacing _isLoggedIn() + _sessionCookie() each scanning the whole
    // store separately. First-match semantics for the session are preserved via
    // foundSession, and the host match is identical (_hostMatches), so callers see the
    // same values.
    let loggedIn = false;
    let session = "";
    let foundSession = false;
    try {
      const cookiesList = Services.cookies.cookies || Services.cookies.enumerator;
      const scan = (cookie) => {
        if (!this._hostMatches(cookie.host)) {
          return;
        }
        if (cookie.name === "obside_user") {
          loggedIn = true;
        } else if (cookie.name === "obside_session" && !foundSession) {
          session = cookie.value;
          foundSession = true;
        }
      };
      if (cookiesList.hasMoreElements) {
        while (cookiesList.hasMoreElements()) {
          scan(cookiesList.getNext().QueryInterface(Ci.nsICookie));
        }
      } else {
        for (const cookie of cookiesList) {
          scan(cookie);
        }
      }
    } catch (e) {}
    return { loggedIn, session };
  },

  _request(session = this._sessionCookie()) {
    const headers = { "Content-Type": "application/json" };
    if (session) {
      headers["Authorization"] = "Bearer " + session;
    }
    return { session, headers };
  },

  async fetchServers() {
    const { loggedIn, session } = this._readSession();
    if (!loggedIn) {
      Services.prefs.setStringPref(SERVERLIST_PREF, "[]");
      Services.prefs.setBoolPref(ENABLED_PREF, false);
      return [];
    }
    const { headers } = this._request(session);
    try {
      const res = await fetch(this._endpoint() + "/api/vpn/servers", {
        method: "GET",
        headers,
        credentials: "omit",
      });
      if (!res.ok) {
        Services.prefs.setBoolPref(ENABLED_PREF, false);
        return [];
      }
      const data = await res.json();
      const servers = Array.isArray(data.servers) ? data.servers : [];
      Services.prefs.setStringPref(SERVERLIST_PREF, JSON.stringify(servers));
      Services.prefs.setBoolPref(ENABLED_PREF, servers.length > 0);
      return servers;
    } catch (e) {
      Cu.reportError("ObsideVpnService fetchServers: " + e);
      return [];
    }
  },

  async connect(serverId) {
    const { loggedIn, session } = this._readSession();
    if (!loggedIn) {
      return { ok: false, reason: "login" };
    }
    const { headers } = this._request(session);
    try {
      const res = await fetch(this._endpoint() + "/api/vpn/connect", {
        method: "POST",
        headers,
        credentials: "omit",
        body: JSON.stringify({ server_id: serverId }),
      });
      let data = {};
      try {
        data = await res.json();
      } catch (e) {}
      if (!res.ok || !data.ok) {
        return { ok: false, reason: data.reason || "error" };
      }
      const protocol = String(data.protocol || "https");
      if (protocol !== "https") {
        return { ok: false, reason: "proxy" };
      }
      Services.prefs.setBoolPref(PROXYAPPLIED_PREF, true);
      const applied = await this._pushProxy("obsideVpnApplyProxy", [
        String(data.host),
        String(data.port),
        data.username || "",
        data.password || "",
        protocol,
      ]);
      if (!applied) {
        return { ok: false, reason: "proxy" };
      }
      Services.prefs.setCharPref(LASTERROR_PREF, "");
      Services.prefs.setBoolPref(CONNECTED_PREF, true);
      Services.prefs.setCharPref(SELECTED_PREF, String(serverId));
      return { ok: true, server: data };
    } catch (e) {
      Cu.reportError("ObsideVpnService connect: " + e);
      return { ok: false, reason: "error" };
    }
  },

  async disconnect(userInitiated = false) {
    // Obside security note (C15/C138): this asymmetry is INTENTIONAL and fail-closed.
    // On an AUTOMATIC disconnect (proxy error / server dropped / logout) we clear the
    // "connected" flag but deliberately DO NOT tear the proxy filter down to direct —
    // tearing it down would route traffic out on the real interface (a real-IP leak)
    // exactly when the tunnel has failed. Keeping the filter applied fails closed
    // (requests error instead of leaking). Only a USER-initiated disconnect, where the
    // user has explicitly asked to stop using the VPN, tears the filter down to direct.
    // The UI surfaces the failure via LASTERROR_PREF so "off" is not mistaken for safe.
    if (userInitiated !== true) {
      Services.prefs.setBoolPref(CONNECTED_PREF, false);
      Services.prefs.setCharPref(SELECTED_PREF, "");
      return { ok: true };
    }
    const cleared = await this._pushProxy("obsideVpnClearProxy", []);
    if (!cleared) {
      Services.prefs.setBoolPref(CONNECTED_PREF, false);
      return { ok: false, reason: "teardown" };
    }
    Services.prefs.setBoolPref(PROXYAPPLIED_PREF, false);
    Services.prefs.setCharPref(LASTERROR_PREF, "");
    Services.prefs.setBoolPref(CONNECTED_PREF, false);
    Services.prefs.setCharPref(SELECTED_PREF, "");
    return { ok: true };
  },

  async pollStatus() {
    const { loggedIn, session } = this._readSession();
    if (!loggedIn) {
      Services.prefs.setBoolPref(ENABLED_PREF, false);
      if (Services.prefs.getBoolPref(CONNECTED_PREF, false)) {
        Services.prefs.setCharPref(LASTERROR_PREF, "login");
        this.disconnect().catch(e => Cu.reportError("ObsideVpnService disconnect: " + e));
      }
      return;
    }
    const { headers } = this._request(session);
    try {
      const res = await fetch(this._endpoint() + "/api/vpn/status", {
        method: "GET",
        headers,
        credentials: "omit",
      });
      if (res.status === 401) {
        Services.prefs.setBoolPref(ENABLED_PREF, false);
        if (Services.prefs.getBoolPref(CONNECTED_PREF, false)) {
          Services.prefs.setCharPref(LASTERROR_PREF, "login");
          this.disconnect().catch(e => Cu.reportError("ObsideVpnService disconnect: " + e));
        }
        return;
      }
      let data = {};
      try {
        data = await res.json();
      } catch (e) {}
      if (!data.ok) {
        return;
      }
      const allowed = Array.isArray(data.allowed_server_ids) ? data.allowed_server_ids.map(String) : [];
      if (Services.prefs.getBoolPref(CONNECTED_PREF, false)) {
        const selected = Services.prefs.getCharPref(SELECTED_PREF, "");
        if (selected && !allowed.includes(selected)) {
          const reason = data.reasons?.[selected];
          Services.prefs.setCharPref(LASTERROR_PREF, reason ? String(reason) : "dropped");
          this.disconnect().catch(e => Cu.reportError("ObsideVpnService disconnect: " + e));
        }
      }
    } catch (e) {
      Cu.reportError("ObsideVpnService pollStatus: " + e);
    }
  },

  _backgroundWindow() {
    try {
      let policy = WebExtensionPolicy.getByID(NETWORK_MANAGER_ID);
      return policy?.extension?.backgroundContext?.contentWindow || null;
    } catch (e) {
      return null;
    }
  },

  _pushProxy(fnName, args) {
    return new Promise((resolve) => {
      let attempts = 0;
      const run = () => {
        const win = ObsideVpnService._backgroundWindow();
        let fn = null;
        if (win) {
          if (typeof win[fnName] === "function") {
            fn = win[fnName];
          } else {
            try {
              let waived = Cu.waiveXrays(win);
              if (typeof waived[fnName] === "function") {
                fn = waived[fnName];
              }
            } catch (e) {}
          }
        }
        if (fn) {
          const timer = setTimeout(() => {
            Cu.reportError("ObsideVpnService _pushProxy " + fnName + ": timed out");
            resolve(false);
          }, PUSH_TIMEOUT_MS);
          const settle = (value) => {
            clearTimeout(timer);
            resolve(value);
          };
          try {
            Promise.resolve(fn.apply(win, args)).then(
              result => settle(result !== false),
              e => {
                Cu.reportError("ObsideVpnService _pushProxy " + fnName + ": " + e);
                settle(false);
              }
            );
          } catch (e) {
            Cu.reportError("ObsideVpnService _pushProxy " + fnName + ": " + e);
            settle(false);
          }
          return;
        }
        if (attempts++ < 20) {
          setTimeout(run, 500);
        } else {
          Cu.reportError("ObsideVpnService _pushProxy: network-manager background context unavailable");
          resolve(false);
        }
      };
      run();
    });
  },
};
