import { setTimeout, clearTimeout } from "resource://gre/modules/Timer.sys.mjs";

const ENDPOINT = "https://obsidebrowser.com";
const PREMIUM_PURCHASE_URL = "https://obside.gumroad.com/l/premium";
const ACTIVE_COOKIE_TTL_MS = 300000;
const REQUEST_TIMEOUT_MS = 20000;

const ENTITLEMENT_PREFIX = "obside-entitlement-v1";
const ENTITLEMENT_MAX_AGE_MS = 300000;
const ENTITLEMENT_KEY_ID = "r2";
const ENTITLEMENT_PUBKEY_SPKI =
  "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEpNTm/XdMWi32i7589AkH1Zl1/WJU" +
  "tDgHLbl/bjQ3HfeuylkCzOP/0Itm7haCDkfqjRzmhBJr3Nd3pwQQzJWsrA==";

const B64_ALPHA =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Obside optimization: reuse a single TextEncoder for entitlement signature verification
// rather than allocating a new one on every verify() call.
const ENTITLEMENT_ENCODER = new TextEncoder();

function b64ToBytes(str) {
  const clean = String(str || "").replace(/[^A-Za-z0-9+/]/g, "");
  const out = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = B64_ALPHA.indexOf(clean[i]);
    if (v < 0) {
      return null;
    }
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return out.length ? new Uint8Array(out) : null;
}

let gEntitlementKey = null;
function entitlementKey() {
  if (!gEntitlementKey) {
    const der = b64ToBytes(ENTITLEMENT_PUBKEY_SPKI);
    gEntitlementKey = crypto.subtle.importKey(
      "spki",
      der,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
  }
  return gEntitlementKey;
}

function entitlementPayload(ent, email) {
  return (
    ENTITLEMENT_PREFIX +
    "|" +
    email +
    "|" +
    (ent.isPremium ? "1" : "0") +
    "|" +
    (ent.periodEnd || "") +
    "|" +
    (ent.source || "") +
    "|" +
    String(ent.ts)
  );
}

export const ObsideEntitlement = {
  async verify(ent, expectedEmail) {
    if (!ent || typeof ent !== "object") {
      return null;
    }
    if (String(ent.keyId || "") !== ENTITLEMENT_KEY_ID) {
      return null;
    }
    if (typeof ent.ts !== "number" || !Number.isFinite(ent.ts)) {
      return null;
    }
    if (Math.abs(Date.now() - ent.ts) > ENTITLEMENT_MAX_AGE_MS) {
      return null;
    }
    const email = String(expectedEmail || "").trim().toLowerCase();
    if (!email) {
      return null;
    }
    const sig = b64ToBytes(ent.sig);
    if (!sig || sig.length !== 64) {
      return null;
    }
    let key;
    try {
      key = await entitlementKey();
    } catch (e) {
      gEntitlementKey = null;
      return null;
    }
    let ok = false;
    try {
      ok = await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        key,
        sig,
        ENTITLEMENT_ENCODER.encode(entitlementPayload(ent, email))
      );
    } catch (e) {
      ok = false;
    }
    if (!ok) {
      return null;
    }
    return {
      isPremium: !!ent.isPremium,
      periodEnd: ent.periodEnd || "",
      source: ent.source || "",
    };
  },
};

function cookieList() {
  try {
    return Services.cookies.cookies || Services.cookies.enumerator;
  } catch (e) {
    return null;
  }
}

// Obside optimization: forEachCookie honors a truthy callback return as "stop", so
// single-cookie lookups (readCookie) exit the enumeration on first match instead of
// scanning the remainder of the jar. Callbacks that return nothing scan everything as
// before, so the collector callers (originAttributesFor, removeActiveCookies) are
// unaffected.
function forEachCookie(callback) {
  const list = cookieList();
  if (!list) {
    return;
  }
  try {
    if (list.hasMoreElements) {
      while (list.hasMoreElements()) {
        if (callback(list.getNext().QueryInterface(Ci.nsICookie))) {
          return;
        }
      }
    } else {
      for (const cookie of list) {
        if (callback(cookie)) {
          return;
        }
      }
    }
  } catch (e) {}
}

// Obside security fix (C6/C23): exact-host match; `localhost` (plain HTTP) is no
// longer trusted as an authoritative Obside auth origin — it let a local/plaintext
// cookie be read and transmitted as a Bearer token to obsidebrowser.com.
function isObsideHost(host) {
  const h = String(host || "").replace(/^\./, "").toLowerCase();
  return (
    h === "obsidebrowser.com" ||
    h.endsWith(".obsidebrowser.com")
  );
}

function readCookie(name) {
  let value = "";
  forEachCookie(cookie => {
    if (isObsideHost(cookie.host) && cookie.name === name) {
      value = cookie.value;
      return true;
    }
    return false;
  });
  return value;
}

function getObsideUser() {
  const raw = readCookie("obside_user");
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(decodeURIComponent(raw));
  } catch (e) {
    return null;
  }
}

function isPremiumActive(user = getObsideUser()) {
  try {
    if (!user) {
      return false;
    }
    if (!Services.prefs.getBoolPref("obside.premium.active", false)) {
      return false;
    }
    const periodEnd = Services.prefs.getStringPref("obside.premium.periodEnd", "");
    if (periodEnd) {
      const end = new Date(periodEnd);
      if (!isNaN(end.getTime()) && end.getTime() <= Date.now()) {
        return false;
      }
    }
    return true;
  } catch (e) {
    return false;
  }
}

function langPrefix() {
  try {
    const locale = (Services.locale.appLocalesAsBCP47 || [])[0] || "";
    return locale.startsWith("tr") ? "tr" : "en";
  } catch (e) {
    return "en";
  }
}

function originAttributesFor(hostNeedle) {
  const attrs = [{}];
  attrs.push({ firstPartyDomain: "obsidebrowser.com" });
  attrs.push({ partitionKey: "(https,obsidebrowser.com)" });
  // Obside security fix (C6): harvest originAttributes only from exact Obside hosts.
  // Obside optimization: dedupe by originAttributes suffix so plantActiveCookie does not
  // issue redundant (idempotent) cookies.add() calls for the same partition. The final
  // cookie set is unchanged since add() with identical args is idempotent.
  const seen = new Set();
  forEachCookie(cookie => {
    if (isObsideHost(cookie.host)) {
      let key = null;
      try {
        key = ChromeUtils.originAttributesToSuffix(cookie.originAttributes);
      } catch (e) {}
      if (key === null || !seen.has(key)) {
        if (key !== null) {
          seen.add(key);
        }
        attrs.push(cookie.originAttributes);
      }
    }
  });
  return attrs;
}

function removeActiveCookies() {
  const targets = [];
  forEachCookie(cookie => {
    if (cookie.name === "obside_active_browser" && isObsideHost(cookie.host)) {
      targets.push(cookie);
    }
  });
  for (const cookie of targets) {
    try {
      Services.cookies.remove(cookie.host, cookie.name, cookie.path, cookie.originAttributes);
    } catch (e) {}
  }
}

function plantActiveCookie(host, attrsList, scheme) {
  const expiry = Date.now() + ACTIVE_COOKIE_TTL_MS;
  for (const attrs of attrsList) {
    for (const target of [host, "." + host]) {
      try {
        Services.cookies.add(
          target,
          "/",
          "obside_active_browser",
          "true",
          scheme === Ci.nsICookie.SCHEME_HTTPS,
          false,
          false,
          expiry,
          attrs,
          Ci.nsICookie.SAMESITE_LAX,
          scheme
        );
      } catch (e) {}
    }
  }
}

function plantActiveBrowserCookies() {
  removeActiveCookies();
  plantActiveCookie("obsidebrowser.com", originAttributesFor("obsidebrowser.com"), Ci.nsICookie.SCHEME_HTTPS);
  // Obside security fix (C23): removed the non-secure obside_active_browser cookie
  // plant on localhost over plaintext HTTP.
}

function sandboxFetch(code, globals) {
  return new Promise(resolve => {
    let settled = false;
    const finishOnce = value => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => finishOnce(null), REQUEST_TIMEOUT_MS);
    try {
      const principal = Services.scriptSecurityManager.getSystemPrincipal();
      const sandbox = Cu.Sandbox(principal, { wantGlobalProperties: ["fetch"] });
      sandbox.onResult = value => {
        clearTimeout(timer);
        finishOnce(value);
      };
      for (const key of Object.keys(globals || {})) {
        sandbox[key] = globals[key];
      }
      Cu.evalInSandbox(code, sandbox);
    } catch (e) {
      clearTimeout(timer);
      Cu.reportError("ObsideWelcomeAccount sandbox: " + e);
      finishOnce(null);
    }
  });
}

function generateAccessToken() {
  return sandboxFetch(
    `
      fetch("${ENDPOINT}/api/auth/generate-access-token", { method: "POST" })
        .then(res => res.json())
        .then(data => onResult(data && data.token ? String(data.token) : ""))
        .catch(() => onResult(""));
    `,
    {}
  );
}

const BLANK_TAB_URIS = new Set([
  "about:blank",
  "about:newtab",
  "about:home",
  "about:privatebrowsing",
]);

export const ObsideWelcomeAccount = {
  makeSoleTab(browser) {
    try {
      const win = browser?.ownerGlobal;
      const gb = win?.gBrowser;
      if (!gb || typeof gb.getTabForBrowser !== "function") {
        return false;
      }
      const welcomeTab = gb.getTabForBrowser(browser);
      if (!welcomeTab) {
        return false;
      }
      for (const tab of Array.from(gb.tabs)) {
        if (tab === welcomeTab || tab.pinned) {
          continue;
        }
        let uri = "";
        try {
          uri = tab.linkedBrowser?.currentURI?.spec || "";
        } catch (e) {}
        if (BLANK_TAB_URIS.has(uri)) {
          try {
            gb.removeTab(tab);
          } catch (e) {}
        }
      }
      try {
        gb.selectedTab = welcomeTab;
      } catch (e) {}
      return true;
    } catch (e) {
      Cu.reportError("ObsideWelcomeAccount makeSoleTab: " + e);
      return false;
    }
  },

  getAccount() {
    const user = getObsideUser();
    if (!user) {
      return { loggedIn: false, isPremium: false, email: "", fullName: "" };
    }
    return {
      loggedIn: true,
      // Obside optimization: reuse the user object already read above instead of letting
      // isPremiumActive() run a second cookie scan + JSON.parse for the same cookie.
      isPremium: isPremiumActive(user),
      email: String(user.email || ""),
      fullName: String(user.fullName || user.full_name || user.name || ""),
    };
  },

  async openAccountPage(target, browser) {
    const page = target === "signup" ? "signup" : "login";
    const win = browser?.ownerGlobal;
    if (!win) {
      return false;
    }
    try {
      plantActiveBrowserCookies();
    } catch (e) {
      Cu.reportError("ObsideWelcomeAccount cookies: " + e);
    }
    const token = await generateAccessToken();
    const base = `${ENDPOINT}/${langPrefix()}/${page}`;
    // SECURITY NOTE C19 (server coordination required to fully fix): the access_token
    // is placed in the URL QUERY STRING, so it persists to browsing history / the
    // awesomebar / server access logs. Firefox core's default Referrer-Policy keeps it
    // from leaking cross-origin, so this is a local-disk / first-party-log exposure
    // (low). The clean fix needs a server change: accept the token via a POST body or
    // the existing first-party cookie handoff instead of the query string. Left as-is
    // to avoid breaking the login handshake until the server side is updated.
    const url = token
      ? `${base}?access_token=${encodeURIComponent(token)}&source=obside-browser`
      : `${base}?source=obside-browser`;
    try {
      win.openLinkIn(url, "tab", {
        triggeringPrincipal: Services.scriptSecurityManager.createNullPrincipal({}),
      });
      return true;
    } catch (e) {
      Cu.reportError("ObsideWelcomeAccount openAccountPage: " + e);
      return false;
    }
  },

  async buyPremium(browser) {
    const win = browser?.ownerGlobal;
    if (!win) {
      return false;
    }
    try {
      win.openLinkIn(PREMIUM_PURCHASE_URL, "tab", {
        triggeringPrincipal: Services.scriptSecurityManager.createNullPrincipal({}),
      });
      return true;
    } catch (e) {
      Cu.reportError("ObsideWelcomeAccount buyPremium: " + e);
      return false;
    }
  },

  async activateLicense(key) {
    const licenseKey = String(key || "").trim();
    if (!licenseKey) {
      return { ok: false, reason: "empty", plan: "" };
    }
    const session = readCookie("obside_session");
    const postOnce = () =>
      sandboxFetch(
        `
        (async () => {
          try {
            const headers = { "Content-Type": "application/json" };
            if (sessionToken) { headers["Authorization"] = "Bearer " + sessionToken; }
            const res = await fetch("${ENDPOINT}/api/license/activate", {
              method: "POST",
              headers: headers,
              credentials: "include",
              cache: "no-store",
              body: JSON.stringify({ license_key: licenseKey })
            });
            let text = "";
            try { text = await res.text(); } catch (e) {}
            onResult(JSON.stringify({ status: res.status, body: text }));
          } catch (e) {
            onResult(JSON.stringify({ status: 0, body: "" }));
          }
        })();
      `,
        { licenseKey, sessionToken: session || "" }
      );

    const parseResult = raw => {
      if (!raw) {
        return { status: -1, data: {} };
      }
      try {
        const parsed = JSON.parse(raw);
        let data = {};
        try {
          data = JSON.parse(parsed.body || "{}");
        } catch (e) {
          data = {};
        }
        return { status: parsed.status, data };
      } catch (e) {
        return { status: -1, data: {} };
      }
    };

    let { status, data } = parseResult(await postOnce());

    if (status === 404) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      ({ status, data } = parseResult(await postOnce()));
    }

    if (status === -1) {
      return { ok: false, reason: "error", plan: "" };
    }

    if (status === 200 && (data.activated === true || data.is_active === true)) {
      const plan = data.plan ? String(data.plan) : "";
      const user = getObsideUser();
      const verified = await ObsideEntitlement.verify(
        data.entitlement,
        user && user.email
      );
      if (!verified) {
        return { ok: false, reason: "error", plan: "" };
      }
      try {
        Services.prefs.setBoolPref("obside.premium.active", verified.isPremium);
        if (plan) {
          Services.prefs.setStringPref("obside.premium.plan", plan);
        }
        Services.prefs.setStringPref("obside.premium.periodEnd", verified.periodEnd);
        Services.prefs.setStringPref("obside.premium.source", verified.source);
        Services.prefs.setStringPref(
          "obside.premium.lastVerified",
          new Date().toISOString()
        );
      } catch (e) {}
      return { ok: true, reason: "", plan };
    }

    if (status === 200) {
      return { ok: false, reason: "invalid", plan: "" };
    }
    if (status === 401) {
      return { ok: false, reason: "login", plan: "" };
    }
    if (status === 409) {
      return { ok: false, reason: "used", plan: "" };
    }
    if (status === 400 || status === 404 || status === 422) {
      return { ok: false, reason: "invalid", plan: "" };
    }
    return { ok: false, reason: "error", plan: "" };
  },
};
