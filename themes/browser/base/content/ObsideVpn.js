"use strict";

var ObsideVpnLazy = {};
ChromeUtils.defineESModuleGetters(ObsideVpnLazy, {
  ObsideVpnService: "resource:///modules/ObsideVpnService.sys.mjs",
});

const OV_ICON_PIN = "<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'><path fill='context-fill' fill-opacity='context-fill-opacity' d='M8 0a5 5 0 0 0-5 5c0 3.5 5 11 5 11s5-7.5 5-11a5 5 0 0 0-5-5zm0 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4z'/></svg>";
const OV_ICON_CHECK = "<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'><path fill='#2ac3a2' d='M6.4 11.7 2.7 8l1.25-1.25 2.45 2.45L12.05 3.6 13.3 4.85z'/></svg>";
const OV_ICON_LOGIN = "<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'><path fill='context-fill' fill-opacity='context-fill-opacity' d='M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 1.5c-3 0-5.5 1.6-5.5 3.5V15h11v-2c0-1.9-2.5-3.5-5.5-3.5z'/></svg>";
const OV_ICON_POWER = "<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'><path fill='context-fill' fill-opacity='context-fill-opacity' d='M7.25 1h1.5v7h-1.5z'/><path fill='context-fill' fill-opacity='context-fill-opacity' d='M11.35 2.9 10.5 4.15a5 5 0 1 1-5 0L4.65 2.9a6.5 6.5 0 1 0 6.7 0z'/></svg>";

// Obside optimization: the icon SVGs are constant, so encode them to data: URIs once
// at load instead of running encodeURIComponent on every panel render / server row.
const OV_URI_PIN = "data:image/svg+xml," + encodeURIComponent(OV_ICON_PIN);
const OV_URI_CHECK = "data:image/svg+xml," + encodeURIComponent(OV_ICON_CHECK);
const OV_URI_LOGIN = "data:image/svg+xml," + encodeURIComponent(OV_ICON_LOGIN);
const OV_URI_POWER = "data:image/svg+xml," + encodeURIComponent(OV_ICON_POWER);

var ObsideVpn = {
  _initialized: false,
  _panel: null,
  _header: null,
  _body: null,
  _busy: false,

  init() {
    if (this._initialized) {
      return;
    }
    this._initialized = true;

    this._buildPanel();
    this._updateIcon();

    let bindToggle = () => {
      let btn = document.getElementById("obside-vpn-toggle");
      if (btn && !btn._hasObsideListener) {
        btn._hasObsideListener = true;
        btn.addEventListener("mousedown", (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          ObsideVpn.togglePanel(btn);
        });
      } else if (!btn) {
        setTimeout(bindToggle, 500);
      }
    };
    bindToggle();

    Services.prefs.addObserver("obside.vpn.connected", this);
    Services.prefs.addObserver("obside.vpn.enabled", this);
    Services.prefs.addObserver("obside.vpn.server_list", this);
    Services.prefs.addObserver("obside.vpn.selected_server", this);
    Services.prefs.addObserver("obside.vpn.proxy_applied", this);
  },

  observe(subject, topic, data) {
    if (topic !== "nsPref:changed") {
      return;
    }
    // Obside fix: a single connect/disconnect flips several of the 5 observed prefs in a
    // row; coalesce the resulting notifications into ONE icon/panel update (dispatched
    // after the current task) instead of rebuilding the icon + panel on each pref change.
    if (this._updateScheduled) {
      return;
    }
    this._updateScheduled = true;
    Services.tm.dispatchToMainThread(() => {
      this._updateScheduled = false;
      this._updateIcon();
      if (this._panel && (this._panel.state === "open" || this._panel.state === "showing")) {
        this._renderPanel();
      }
    });
  },

  _hostMatches(host) {
    const h = String(host || "").replace(/^\./, "");
    return h === "obsidebrowser.com" || h.endsWith(".obsidebrowser.com") || h === "localhost";
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

  _servers() {
    try {
      let raw = Services.prefs.getStringPref("obside.vpn.server_list", "[]");
      let arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  },

  _connected() {
    try {
      return Services.prefs.getBoolPref("obside.vpn.connected", false);
    } catch (e) {
      return false;
    }
  },

  _enabled() {
    try {
      return Services.prefs.getBoolPref("obside.vpn.enabled", false);
    } catch (e) {
      return false;
    }
  },

  _proxyApplied() {
    try {
      return Services.prefs.getBoolPref("obside.vpn.proxy_applied", false);
    } catch (e) {
      return false;
    }
  },

  _lastError() {
    try {
      return Services.prefs.getCharPref("obside.vpn.last_error", "");
    } catch (e) {
      return "";
    }
  },

  _killswitch() {
    return this._proxyApplied() && !this._connected();
  },

  _selectedPref() {
    try {
      return Services.prefs.getCharPref("obside.vpn.selected_server", "");
    } catch (e) {
      return "";
    }
  },

  _serverName(id, servers = this._servers()) {
    let sid = String(id);
    let match = servers.find(s => String(s.id) === sid);
    return match ? (match.name || match.location || sid) : sid;
  },

  _iconAttr(inner) {
    return "data:image/svg+xml," + encodeURIComponent(inner);
  },

  _buildPanel() {
    if (this._panel) {
      return;
    }
    let popupset = document.getElementById("mainPopupSet");
    if (!popupset) {
      setTimeout(() => this._buildPanel(), 500);
      return;
    }
    const HTML_NS = "http://www.w3.org/1999/xhtml";

    let panel = document.createXULElement("panel");
    panel.id = "obside-vpn-panel";
    panel.setAttribute("type", "arrow");
    panel.setAttribute("role", "group");
    panel.setAttribute("orient", "vertical");

    let header = document.createXULElement("box");
    header.className = "panel-header";
    let h1 = document.createElementNS(HTML_NS, "h1");
    let span = document.createElementNS(HTML_NS, "span");
    span.textContent = "Obside VPN";
    h1.appendChild(span);
    header.appendChild(h1);
    panel.appendChild(header);

    panel.appendChild(document.createXULElement("toolbarseparator"));

    let body = document.createXULElement("vbox");
    body.className = "panel-subview-body";
    this._body = body;
    panel.appendChild(body);

    popupset.appendChild(panel);
    this._panel = panel;
  },

  _addSubheader(text) {
    const HTML_NS = "http://www.w3.org/1999/xhtml";
    let h2 = document.createElementNS(HTML_NS, "h2");
    h2.className = "subview-subheader";
    h2.textContent = text;
    this._body.appendChild(h2);
  },

  _addSeparator() {
    this._body.appendChild(document.createXULElement("toolbarseparator"));
  },

  _addRow(opts) {
    let btn = document.createXULElement("toolbarbutton");
    btn.className = "subviewbutton subviewbutton-iconic";
    btn.setAttribute("label", opts.label);
    if (opts.image) {
      btn.setAttribute("image", opts.image);
    }
    if (opts.disabled) {
      btn.setAttribute("disabled", "true");
    }
    if (opts.tooltip) {
      btn.setAttribute("tooltiptext", opts.tooltip);
    }
    if (opts.onCommand) {
      btn.addEventListener("command", opts.onCommand);
    }
    this._body.appendChild(btn);
    return btn;
  },

  togglePanel(anchor) {
    if (!this._panel) {
      this._buildPanel();
    }
    if (!this._panel) {
      return;
    }
    if (this._panel.state === "open" || this._panel.state === "showing") {
      this._panel.hidePopup();
      return;
    }
    this._renderPanel();
    try {
      this._panel.openPopup(anchor, "bottomright topright", 0, 4, false, false);
    } catch (e) {
      Cu.reportError("ObsideVpn openPopup: " + e);
    }
    ObsideVpnLazy.ObsideVpnService.fetchServers().catch(e => Cu.reportError("ObsideVpn fetchServers: " + e));
  },

  _renderPanel() {
    if (!this._body) {
      return;
    }
    while (this._body.firstChild) {
      this._body.removeChild(this._body.firstChild);
    }

    let loggedIn = this._isLoggedIn();
    let servers = this._servers();
    let connected = this._connected();
    // Obside optimization: read proxy_applied once and derive killswitch locally rather
    // than calling _killswitch() (which re-reads _connected + _proxyApplied) again.
    let proxyApplied = this._proxyApplied();
    let selectedServer = this._selectedPref();
    let killswitch = proxyApplied && !connected;

    const isTR = ((Services.locale.appLocalesAsBCP47 || [])[0] || "").startsWith("tr");

    if (this._busy && !killswitch) {
      this._addSubheader(isTR ? "Bağlanıyor…" : "Connecting…");
      this._addRow({ label: isTR ? "Lütfen bekleyin" : "Please wait", disabled: true, image: OV_URI_POWER });
      return;
    }

    if (!loggedIn && !killswitch) {
      this._addSubheader(isTR ? "Bağlı değil" : "Not connected");
      this._addRow({
        label: isTR ? "Obside hesabıyla giriş yap" : "Sign in with Obside account",
        image: OV_URI_LOGIN,
        onCommand: () => ObsideVpn._openLogin(),
      });
      return;
    }

    if (killswitch) {
      this._addSubheader(isTR ? "VPN düştü — internet kesildi" : "VPN dropped — internet blocked");
      this._addRow({
        label: this._reasonText(this._lastError()),
        disabled: true,
        image: OV_URI_PIN,
      });
    } else if (connected) {
      this._addSubheader((isTR ? "Korumalı · " : "Protected · ") + this._serverName(selectedServer, servers));
    } else {
      this._addSubheader(isTR ? "Bağlı değil" : "Not connected");
    }

    if (!servers.length) {
      this._addRow({
        label: isTR ? "Kullanılabilir sunucu yok" : "No servers available",
        disabled: true,
        image: OV_URI_PIN,
      });
    } else {
      for (let server of servers) {
        let sid = String(server.id);
        let isActive = connected && sid === selectedServer;
        let loc = [server.location, server.country_code].filter(Boolean).join(", ");
        let label = server.name || sid;
        if (loc) {
          label = label + " — " + loc;
        }
        this._addRow({
          label: label,
          image: isActive ? OV_URI_CHECK : OV_URI_PIN,
          disabled: killswitch,
          tooltip: killswitch ? (isTR ? "Önce bağlantıyı kes" : "Disconnect first") : (isActive ? (isTR ? "Bağlı — kesmek için tıkla" : "Connected — click to disconnect") : (isTR ? "Bağlanmak için tıkla" : "Click to connect")),
          onCommand: killswitch ? null : () => ObsideVpn._onServerCommand(sid),
        });
      }
    }

    if (connected || killswitch) {
      this._addSeparator();
      this._addRow({
        label: isTR ? "Bağlantıyı Kes" : "Disconnect",
        image: OV_URI_POWER,
        tooltip: killswitch ? (isTR ? "Proxy'yi kaldır ve internete dön" : "Remove the proxy and restore internet") : null,
        onCommand: () => ObsideVpn._disconnect(true),
      });
    }
  },

  _openLogin() {
    try {
      if (this._panel) {
        this._panel.hidePopup();
      }
      if (typeof ObsideAdblock !== "undefined" && ObsideAdblock.handleToolbarLogin) {
        ObsideAdblock.handleToolbarLogin();
      }
    } catch (e) {
      Cu.reportError("ObsideVpn openLogin: " + e);
    }
  },

  _onServerCommand(sid) {
    if (this._busy) {
      return;
    }
    if (this._connected() && sid === this._selectedPref()) {
      this._disconnect();
      return;
    }
    this._connectTo(sid);
  },

  async _connectTo(sid) {
    this._busy = true;
    this._renderPanel();
    let reason = null;
    try {
      let result = await ObsideVpnLazy.ObsideVpnService.connect(sid);
      if (!result || !result.ok) {
        reason = result && result.reason;
      }
    } catch (e) {
      Cu.reportError("ObsideVpn connect: " + e);
      reason = "error";
    }
    this._busy = false;
    this._renderPanel();
    this._updateIcon();
    if (reason && this._body && this._body.firstChild) {
      this._body.firstChild.textContent = this._reasonText(reason);
    }
  },

  async _disconnect(force = false) {
    if (this._busy && !force) {
      return;
    }
    this._busy = true;
    let failed = false;
    try {
      let result = await ObsideVpnLazy.ObsideVpnService.disconnect(true);
      if (!result || !result.ok) {
        failed = true;
      }
    } catch (e) {
      Cu.reportError("ObsideVpn disconnect: " + e);
      failed = true;
    }
    this._busy = false;
    this._renderPanel();
    this._updateIcon();
    if (failed && this._body && this._body.firstChild) {
      this._body.firstChild.textContent = this._reasonText("teardown");
    }
  },

  _reasonText(reason) {
    const isTR = ((Services.locale.appLocalesAsBCP47 || [])[0] || "").startsWith("tr");
    switch (reason) {
      case "login":
        return isTR ? "Giriş gerekli" : "Sign in required";
      case "no-access":
        return isTR ? "Bu sunucuya erişimin yok" : "You don't have access to this server";
      case "disabled":
        return isTR ? "Sunucu devre dışı" : "Server disabled";
      case "expired":
        return isTR ? "Erişim süresi doldu" : "Access expired";
      case "quota":
        return isTR ? "Kota doldu" : "Quota exceeded";
      case "window":
        return isTR ? "Şu an kullanılamaz" : "Currently unavailable";
      case "offline":
        return isTR ? "Sunucu çevrimdışı" : "Server offline";
      case "proxy":
        return isTR ? "Proxy başlatılamadı" : "Failed to start proxy";
      case "teardown":
        return isTR ? "Bağlantı kesilemedi, tekrar dene" : "Could not disconnect, try again";
      case "dropped":
        return isTR ? "VPN bağlantısı kesildi" : "The VPN connection dropped";
      default:
        return isTR ? "Bağlantı başarısız" : "Connection failed";
    }
  },

  _updateIcon() {
    const container = document.getElementById("obside-vpn-toggle");
    if (!container) {
      return;
    }
    const isTR = ((Services.locale.appLocalesAsBCP47 || [])[0] || "").startsWith("tr");
    // Obside optimization: read connected/proxy_applied once instead of via _connected()
    // twice (directly and again inside _killswitch()).
    const connected = this._connected();
    const killswitch = this._proxyApplied() && !connected;
    if (connected) {
      container.classList.remove("disabled");
      container.classList.add("connected");
      container.setAttribute("tooltiptext", (isTR ? "VPN Bağlı: " : "VPN Connected: ") + this._serverName(this._selectedPref()));
    } else if (killswitch) {
      container.classList.remove("connected");
      container.classList.remove("disabled");
      container.setAttribute("tooltiptext", isTR ? "VPN düştü — internet kesildi" : "VPN dropped — internet blocked");
    } else if (this._enabled() && this._isLoggedIn()) {
      container.classList.remove("disabled");
      container.classList.remove("connected");
      container.setAttribute("tooltiptext", isTR ? "VPN Kapalı" : "VPN Off");
    } else {
      container.classList.remove("connected");
      container.classList.add("disabled");
      container.setAttribute("tooltiptext", isTR ? "VPN Kapalı" : "VPN Off");
    }
  }
};

window.addEventListener("load", () => {
  setTimeout(() => ObsideVpn.init(), 600);
});
window.addEventListener("unload", () => {
  try {
    Services.prefs.removeObserver("obside.vpn.connected", ObsideVpn);
    Services.prefs.removeObserver("obside.vpn.enabled", ObsideVpn);
    Services.prefs.removeObserver("obside.vpn.server_list", ObsideVpn);
    Services.prefs.removeObserver("obside.vpn.selected_server", ObsideVpn);
    Services.prefs.removeObserver("obside.vpn.proxy_applied", ObsideVpn);
  } catch (e) {}
});
