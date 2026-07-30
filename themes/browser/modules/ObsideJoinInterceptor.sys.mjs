import { ObsideInvite } from "resource:///modules/ObsideInvite.sys.mjs";

// Obside optimization: hoist the leading-dot regex so it is not re-created on every
// isObsideHost() call (invoked once per cookie while scanning the jar).
const OJI_LEADING_DOT = /^\./;

// Obside security fix (C6/C23): exact-host match, not substring; localhost dropped.
function isObsideHost(host) {
  const h = String(host || "").replace(OJI_LEADING_DOT, "").toLowerCase();
  return h === "obsidebrowser.com" || h.endsWith(".obsidebrowser.com");
}

function getObsideAccount() {
  try {
    const list = Services.cookies.cookies;
    if (list) {
      for (const cookie of list) {
        if (
          isObsideHost(cookie.host) &&
          cookie.name === "obside_user"
        ) {
          const u = JSON.parse(decodeURIComponent(cookie.value));
          if (u && u.email) {
            return { email: u.email, name: u.name || u.fullName || u.email };
          }
        }
      }
    }
  } catch (e) {}
  return null;
}

export const ObsideJoinInterceptor = {
  _observing: false,

  init() {
    if (this._observing) {
      return;
    }
    this._observing = true;
    Services.obs.addObserver(this, "http-on-modify-request");
  },

  shutdown() {
    if (!this._observing) {
      return;
    }
    this._observing = false;
    try {
      Services.obs.removeObserver(this, "http-on-modify-request");
    } catch (e) {}
  },

  QueryInterface: ChromeUtils.generateQI(["nsIObserver"]),

  observe(subject, topic) {
    if (topic !== "http-on-modify-request") {
      return;
    }
    let ch;
    try {
      ch = subject.QueryInterface(Ci.nsIHttpChannel);
    } catch (e) {
      return;
    }
    let uri;
    try {
      uri = ch.URI;
    } catch (e) {
      return;
    }
    if (!uri || uri.host !== "obsidebrowser.com" || uri.filePath !== "/join") {
      return;
    }
    let li;
    try {
      li = ch.loadInfo;
    } catch (e) {
      return;
    }
    if (!li || li.externalContentPolicyType !== Ci.nsIContentPolicy.TYPE_DOCUMENT) {
      return;
    }
    const bc = li.browsingContext || li.targetBrowsingContext;
    if (!bc || bc.parent) {
      return;
    }

    // Obside security fix (C13/C5): only read the invite token from the URL
    // FRAGMENT (#...). The old `?token=` query-string fallback caused the invite
    // token to be sent to the server in the request URL / access logs. The
    // fragment is never transmitted, so keep the token client-only.
    let token = "";
    try {
      token = uri.ref || "";
    } catch (e) {}
    if (!token) {
      return;
    }

    try {
      ch.cancel(Cr.NS_BINDING_ABORTED);
    } catch (e) {}

    (async () => {
      let room = null;
      try {
        room = await ObsideInvite.decode(token);
      } catch (e) {
        room = null;
      }
      if (!room) {
        return;
      }
      const loggedIn = !!getObsideAccount();
      const enc = encodeURIComponent(room);
      const target = loggedIn
        ? "about:e2ee?room=" + enc + "#room=" + enc
        : "about:preferences#e2ee";
      Services.tm.dispatchToMainThread(() => {
        try {
          const browser = bc.top.embedderElement;
          if (!browser || typeof browser.fixupAndLoadURIString !== "function") {
            return;
          }
          // Obside security fix (C13): a magnet/invite link is REMOTE, forgeable
          // input (the invite AES key ships in every build — C5 — so any web page
          // can mint a token for an attacker-chosen room). Auto-navigating a
          // logged-in user into that room with no consent is a zero-click forced
          // join. Require an explicit user confirmation, and navigate with a null
          // principal instead of the system principal (about:e2ee is
          // URI_SAFE_FOR_UNTRUSTED_CONTENT, so it loads fine without it).
          const win = browser.ownerGlobal;
          if (loggedIn) {
            const isTR = (() => {
              try {
                return ((Services.locale.appLocalesAsBCP47 || [])[0] || "").startsWith("tr");
              } catch (e) {
                return false;
              }
            })();
            const title = isTR ? "Obside — Odaya Katıl" : "Obside — Join Room";
            const body = isTR
              ? "Bir web sayfası sizi şu şifreli odaya katmak istiyor:\n\n" + room +
                "\n\nBu bağlantıya güveniyor musunuz? Yalnızca tanıdığınız birinden geldiyse katılın."
              : "A web page is asking to join you to this encrypted room:\n\n" + room +
                "\n\nDo you trust this link? Only join if it came from someone you know.";
            let approved = false;
            try {
              approved = Services.prompt.confirm(win, title, body);
            } catch (e) {
              approved = false;
            }
            if (!approved) {
              return;
            }
          }
          browser.fixupAndLoadURIString(target, {
            triggeringPrincipal: Services.scriptSecurityManager.createNullPrincipal({}),
          });
        } catch (e) {}
      });
    })();
  },
};
