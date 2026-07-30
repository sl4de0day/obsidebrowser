export class AboutE2EEChild extends JSWindowActorChild {
  async handleEvent(event) {
    if (event.type === "AboutE2EE:Close") {
      try {
        this.sendAsyncMessage("AboutE2EE:Close", {});
      } catch (e) {}
      return;
    }
    if (event.type === "AboutE2EE:BuildInvite") {
      const detail = event.detail || {};
      const id = detail.id;
      const win = this.contentWindow;
      let out;
      try {
        const res = await this.sendQuery("AboutE2EE:BuildInvite", { room: detail.room });
        out =
          res && res.ok && typeof res.url === "string"
            ? { id, ok: true, url: res.url }
            : { id, ok: false, reason: (res && res.reason) || "invite-failed" };
      } catch (e) {
        out = { id, ok: false, reason: "invite-error" };
      }
      this.#dispatchToContent(win, out);
      return;
    }
    if (event.type === "AboutE2EE:GetTurn") {
      const detail = event.detail || {};
      const id = detail.id;
      const win = this.contentWindow;
      let out;
      try {
        const res = await this.sendQuery("AboutE2EE:GetTurn", {});
        out =
          res && res.ok
            ? {
                id,
                ok: true,
                urls: res.urls,
                username: res.username,
                credential: res.credential,
              }
            : {
                id,
                ok: false,
                reason: (res && res.reason) || "turn-failed",
                status: (res && res.status) || 0,
              };
      } catch (e) {
        out = { id, ok: false, reason: "turn-error", status: 0 };
      }
      this.#dispatchToContent(win, out);
      return;
    }
    if (event.type !== "AboutE2EE:Sign") {
      return;
    }
    const detail = event.detail || {};
    const id = detail.id;
    const win = this.contentWindow;
    let out;
    try {
      const res = await this.sendQuery("AboutE2EE:Sign", {
        nonce: detail.nonce,
        ts: detail.ts,
      });
      out =
        res && res.ok
          ? {
              id,
              ok: true,
              keyId: res.keyId,
              sig: res.sig,
              account: res.account,
              ts: res.ts,
              name: res.name,
            }
          : { id, ok: false, reason: (res && res.reason) || "sign-failed" };
    } catch (e) {
      out = { id, ok: false, reason: "sign-error" };
    }
    this.#dispatchToContent(win, out);
  }

  // Obside optimization/hardening: route every chrome→content reply through one helper
  // that tolerates a torn-down content window (the page navigated away during the await),
  // so a dead-object dispatch becomes a swallowed no-op instead of an unhandled rejection.
  #dispatchToContent(win, out) {
    if (!win) {
      return;
    }
    try {
      win.dispatchEvent(
        new win.CustomEvent("AboutE2EEChromeToContent", {
          detail: Cu.cloneInto(out, win),
        })
      );
    } catch (e) {}
  }
}
