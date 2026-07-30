import { ObsideInvite } from "resource:///modules/ObsideInvite.sys.mjs";

// Obside security fix (C6/C23): exact-host match instead of substring. The old
// `cookie.host.includes("obsidebrowser.com")` matched attacker-registered look-alike
// hosts (e.g. "notobsidebrowser.com", "obsidebrowser.com.evil.example"), letting a
// hostile page plant obside_session/obside_user cookies that this privileged chrome
// then harvested into Bearer tokens and account identity. `localhost` trust dropped too.
function isObsideHost(host) {
  const h = String(host || "").replace(/^\./, "").toLowerCase();
  return h === "obsidebrowser.com" || h.endsWith(".obsidebrowser.com");
}

function getSessionToken() {
  try {
    const list = Services.cookies.cookies;
    if (list) {
      for (const cookie of list) {
        if (
          isObsideHost(cookie.host) &&
          cookie.name === "obside_session"
        ) {
          return cookie.value;
        }
      }
    }
  } catch (e) {}
  return null;
}

function getStoredDisplayName() {
  try {
    const list = Services.cookies.cookies;
    if (list) {
      for (const cookie of list) {
        if (
          isObsideHost(cookie.host) &&
          cookie.name === "obside_user"
        ) {
          const user = JSON.parse(decodeURIComponent(cookie.value));
          if (!user) {
            return "";
          }
          for (const field of ["nickname", "name", "fullName", "full_name"]) {
            const value = user[field];
            if (typeof value === "string" && value.trim() && !value.includes("@")) {
              return value.trim();
            }
          }
          return "";
        }
      }
    }
  } catch (e) {}
  return "";
}

export class AboutE2EEParent extends JSWindowActorParent {
  async receiveMessage(message) {
    if (message.name === "AboutE2EE:Close") {
      try {
        const browser = this.browsingContext.top.embedderElement;
        const win = browser.ownerGlobal;
        win.gBrowser.removeTab(win.gBrowser.getTabForBrowser(browser));
      } catch (e) {}
      return { ok: true };
    }
    if (message.name === "AboutE2EE:BuildInvite") {
      const room = message.data && message.data.room;
      if (typeof room !== "string" || !room) {
        return { ok: false };
      }
      try {
        const token = await ObsideInvite.encode(room);
        return { ok: true, url: "https://obsidebrowser.com/join#" + token };
      } catch (e) {
        return { ok: false };
      }
    }
    if (message.name === "AboutE2EE:GetTurn") {
      const token = getSessionToken();
      if (!token) {
        return { ok: false, reason: "not-logged-in" };
      }
      try {
        const resp = await fetch("https://obsidebrowser.com/api/e2ee/turn", {
          method: "GET",
          headers: { Authorization: "Bearer " + token },
          credentials: "omit",
          cache: "no-store",
        });
        if (!resp.ok) {
          return { ok: false, reason: "http", status: resp.status };
        }
        const data = await resp.json();
        if (data && data.urls && data.username && data.credential) {
          return {
            ok: true,
            urls: Array.isArray(data.urls) ? Array.from(data.urls, String) : [String(data.urls)],
            username: String(data.username),
            credential: String(data.credential),
          };
        }
        return { ok: false, reason: "malformed", status: resp.status };
      } catch (e) {
        return { ok: false, reason: "network" };
      }
    }
    if (message.name !== "AboutE2EE:Sign") {
      return undefined;
    }
    const { nonce } = message.data;
    if (typeof nonce !== "string" || !nonce || nonce.length > 512) {
      return { ok: false, reason: "bad-request" };
    }
    const token = getSessionToken();
    if (!token) {
      Cu.reportError("ObsideAttest: no obside_session cookie found (not logged in)");
      return { ok: false, reason: "not-logged-in" };
    }
    let timeoutSignal = null;
    try {
      if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
        timeoutSignal = AbortSignal.timeout(10000);
      }
    } catch (e) {
      timeoutSignal = null;
    }
    const requestInit = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      credentials: "omit",
      cache: "no-store",
      body: JSON.stringify({ nonce }),
    };
    if (timeoutSignal) {
      requestInit.signal = timeoutSignal;
    }
    try {
      const resp = await fetch(
        "https://obsidebrowser.com/api/e2ee/attest",
        requestInit
      );
      if (resp.status === 401) {
        Cu.reportError("ObsideAttest: 401 from /api/e2ee/attest (session rejected)");
        return { ok: false, reason: "not-logged-in" };
      }
      if (!resp.ok) {
        Cu.reportError("ObsideAttest: HTTP " + resp.status + " from /api/e2ee/attest");
        return { ok: false, reason: "http", status: resp.status };
      }
      const data = await resp.json();
      if (
        !data ||
        typeof data.sig !== "string" ||
        typeof data.account !== "string" ||
        typeof data.ts !== "number"
      ) {
        Cu.reportError(
          "ObsideAttest: malformed response (sig=" +
            typeof (data && data.sig) +
            " account=" +
            typeof (data && data.account) +
            " ts=" +
            typeof (data && data.ts) +
            ")"
        );
        return { ok: false, reason: "malformed" };
      }
      const sigBytes = base64ToByteArray(data.sig);
      if (!sigBytes) {
        Cu.reportError("ObsideAttest: signature base64 decode failed");
        return { ok: false, reason: "malformed" };
      }
      return {
        ok: true,
        keyId: String(data.keyId || "r2"),
        sig: sigBytes,
        account: data.account,
        ts: data.ts,
        name: getStoredDisplayName(),
      };
    } catch (e) {
      const aborted = e && (e.name === "TimeoutError" || e.name === "AbortError");
      Cu.reportError(
        "ObsideAttest: request failed (" + (e && (e.name || e.message)) + ")"
      );
      return { ok: false, reason: aborted ? "attest-timeout" : "network" };
    }
  }
}

const BASE64_ALPHA =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Obside optimization: precompute a reverse lookup table once so base64 decoding is O(1)
// per character instead of BASE64_ALPHA.indexOf() (an O(64) scan) plus a per-char
// substring allocation. `clean` is pre-filtered to ASCII base64 chars (all < 128).
const BASE64_LOOKUP = (() => {
  const t = new Int8Array(128).fill(-1);
  for (let i = 0; i < BASE64_ALPHA.length; i++) {
    t[BASE64_ALPHA.charCodeAt(i)] = i;
  }
  return t;
})();

function base64ToByteArray(str) {
  const clean = String(str || "").replace(/[^A-Za-z0-9+/]/g, "");
  const out = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    const v = code < 128 ? BASE64_LOOKUP[code] : -1;
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
  return out.length ? out : null;
}
