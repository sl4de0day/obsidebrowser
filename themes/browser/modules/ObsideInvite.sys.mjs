// ============================================================================
// SECURITY NOTE C5 — this AES-256-GCM key provides NO confidentiality
// ----------------------------------------------------------------------------
// The key below ships byte-identical in every build, so anyone can both DECRYPT
// any invite token (recovering the room code) and MINT a token for an
// attacker-chosen room. The invite "encryption" is therefore only obfuscation.
// It is not upgradeable client-side: a per-room key would have to travel in the
// invite link itself (== plaintext) or be issued by the server.
//
// The room code also lives only in the URL FRAGMENT (#...), which is never sent
// to the server, so this wrapping adds nothing over plaintext either way.
//
// The ACTIONABLE risk this used to enable — a forged token silently driving a
// system-principal room join — is now closed in ObsideJoinInterceptor.sys.mjs
// (explicit user confirmation + null principal; see fix C13). The durable fix
// for confidentiality is SERVER-issued, per-invite, expiring, signature-verified
// tokens. Track: audit finding C5.
// ============================================================================
const INVITE_KEY_JWK = {
  kty: "oct",
  k: "uNkNyjly4g8vheFrFJAVZl6RxS5tw58QagYaX-l7vok",
  alg: "A256GCM",
  ext: false,
};

const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

// Obside optimization: build the base64url decode table and the UTF-8 codecs once at
// module load instead of rebuilding them on every fromB64url / encode / decode call.
const B64URL_MAP = (() => {
  const m = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHA.length; i++) {
    m[ALPHA.charCodeAt(i)] = i;
  }
  return m;
})();
const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder();

function b64url(bytes) {
  let out = "";
  const n = bytes.length;
  for (let i = 0; i < n; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < n ? bytes[i + 1] : 0;
    const b2 = i + 2 < n ? bytes[i + 2] : 0;
    out += ALPHA[b0 >> 2];
    out += ALPHA[((b0 & 0x03) << 4) | (b1 >> 4)];
    if (i + 1 < n) out += ALPHA[((b1 & 0x0f) << 2) | (b2 >> 6)];
    if (i + 2 < n) out += ALPHA[b2 & 0x3f];
  }
  return out;
}

function fromB64url(str) {
  const clean = [];
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    const v = code < 128 ? B64URL_MAP[code] : -1;
    if (v >= 0) clean.push(v);
  }
  const out = [];
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = clean[i];
    const c1 = i + 1 < clean.length ? clean[i + 1] : 0;
    const c2 = i + 2 < clean.length ? clean[i + 2] : 0;
    const c3 = i + 3 < clean.length ? clean[i + 3] : 0;
    out.push((c0 << 2) | (c1 >> 4));
    if (i + 2 < clean.length) out.push(((c1 & 0x0f) << 4) | (c2 >> 2));
    if (i + 3 < clean.length) out.push(((c2 & 0x03) << 6) | c3);
  }
  return new Uint8Array(out);
}

let gKey = null;
function key() {
  if (!gKey) {
    gKey = crypto.subtle.importKey("jwk", INVITE_KEY_JWK, { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt",
    ]);
  }
  return gKey;
}

export const ObsideInvite = {
  async encode(roomCode) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ctBuf = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await key(),
      UTF8_ENCODER.encode(roomCode)
    );
    const ct = new Uint8Array(ctBuf);
    const out = new Uint8Array(1 + 12 + ct.length);
    out[0] = 1;
    out.set(iv, 1);
    out.set(ct, 13);
    return b64url(out);
  },

  async decode(token) {
    const buf = fromB64url(token);
    if (buf.length < 14 || buf[0] !== 1) {
      throw new Error("bad-token");
    }
    const iv = buf.subarray(1, 13);
    const ct = buf.subarray(13);
    const ptBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await key(), ct);
    return UTF8_DECODER.decode(ptBuf);
  },
};
