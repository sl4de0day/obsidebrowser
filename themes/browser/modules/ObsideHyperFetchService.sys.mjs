/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

import { Subprocess } from "resource://gre/modules/Subprocess.sys.mjs";

const lazy = {};

// Obside security fix (C1): the aria2c JSON-RPC daemon previously used a HARDCODED,
// source-visible secret ("ObsideHyperFetchSecretToken") on a fixed localhost port. That
// made the always-on RPC endpoint drivable by anyone who knew the constant (e.g. via a
// web page hitting localhost:6800), i.e. remote arbitrary-file-write. Generate a fresh
// random secret AND a random port per browser session, kept only in memory, so the
// endpoint is not addressable or authenticable by anything that didn't spawn it.
function obsideRandHex(nBytes) {
  const a = new Uint8Array(nBytes);
  crypto.getRandomValues(a);
  return Array.from(a, b => b.toString(16).padStart(2, "0")).join("");
}
const RPC_SECRET = obsideRandHex(24);
const RPC_PORT = 20000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 40000);

ChromeUtils.defineLazyGetter(lazy, "aria2cPath", function () {
  // Let's establish multiple search paths for aria2c to be extremely robust!
  const paths = [
    "/usr/bin/aria2c",
    "/usr/local/bin/aria2c",
  ];

  // Also check the browser binary's folder
  try {
    const exeDir = Services.dirsvc.get("XREExeF", Ci.nsIFile).parent;
    // Obside fix (C1/C18): check the platform-correct name. The old code appended only
    // "aria2c" (no ".exe"), so on Windows the BUNDLED binary was never found and the code
    // fell through to executing whatever "aria2c" resolved to on %PATH% (search-order
    // hijack). Prefer the bundled aria2c.exe / aria2c by absolute path.
    for (const name of ["aria2c.exe", "aria2c"]) {
      const bundledPath = exeDir.clone();
      bundledPath.append(name);
      if (bundledPath.exists()) {
        return bundledPath.path;
      }
    }
  } catch (e) {
    console.error("[HyperFetch] Error looking for bundled aria2c:", e);
  }

  // Fallback search in standard paths
  for (const path of paths) {
    try {
      const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      file.initWithPath(path);
      if (file.exists()) {
        return path;
      }
    } catch (e) {}
  }

  // Default fallback to environment path
  return "aria2c";
});

function obsideDefaultDownloadDir() {
  try {
    return Services.dirsvc.get("DfltDwnld", Ci.nsIFile).path;
  } catch (e) {
    try {
      return Services.dirsvc.get("Home", Ci.nsIFile).path;
    } catch (e2) {
      return "";
    }
  }
}

let aria2Process = null;

export const ObsideHyperFetchService = {
  init() {
    if (aria2Process) {
      console.warn("[HyperFetch] aria2c is already running.");
      return;
    }

    const command = lazy.aria2cPath;
    const args = [
      "--enable-rpc=true",
      "--rpc-listen-all=false",
      "--rpc-listen-port=" + RPC_PORT,
      "--rpc-secret=" + RPC_SECRET,
      "--quiet=true",
      "--console-log-level=error",
      "--max-concurrent-downloads=3",
      "--split=16",
      "--max-connection-per-server=16",
      "--min-split-size=1M",
      "--continue=true",
      "--disk-cache=64M",
      "--file-allocation=falloc",
      "--dir=" + obsideDefaultDownloadDir(),
    ];

    // Obside fix (C1): do NOT log the args — they contain the RPC secret.
    console.log(`[HyperFetch] Spawning aria2c daemon on 127.0.0.1:${RPC_PORT}`);

    Subprocess.call({
      command,
      arguments: args,
      environmentAppend: true,
      stderr: "ignore",
      stdout: "ignore",
    }).then(proc => {
      aria2Process = proc;
      console.log(`[HyperFetch] aria2c spawned successfully in background with PID: ${proc.pid}`);
      
      proc.wait().then(result => {
        console.log(`[HyperFetch] aria2c process terminated with exit code: ${result.exitCode}`);
        aria2Process = null;
      });
    }).catch(err => {
      console.error("[HyperFetch] Failed to spawn aria2c background daemon. Make sure aria2c is installed.", err);
    });
  },

  async shutdown() {
    if (!aria2Process) {
      return;
    }
    console.log("[HyperFetch] Terminating aria2c background process...");
    try {
      await aria2Process.kill();
    } catch (e) {
      console.error("[HyperFetch] Error killing aria2c:", e);
    }
    aria2Process = null;
  },

  async addDownload(url, targetPath, onProgress, onComplete, onError) {
    const rpcUrl = "http://127.0.0.1:" + RPC_PORT + "/jsonrpc";
    const lastSep = Math.max(targetPath.lastIndexOf("/"), targetPath.lastIndexOf("\\"));
    const dir = lastSep !== -1 ? targetPath.substring(0, lastSep) : obsideDefaultDownloadDir();
    const out = lastSep !== -1 ? targetPath.substring(lastSep + 1) : targetPath;

    const body = {
      jsonrpc: "2.0",
      id: "obside-download-" + Math.random(),
      method: "aria2.addUri",
      params: [
        "token:" + RPC_SECRET,
        [url],
        {
          dir: dir,
          out: out,
          continue: "true"
        }
      ]
    };

    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await response.json();
      if (data.error) {
        throw new Error(data.error.message);
      }
      const gid = data.result;

      // Obside optimization: the monitor request payload is constant for the lifetime of
      // this download, so build the headers + serialized body once instead of
      // re-allocating and re-stringifying them on every 500ms poll tick.
      const monitorHeaders = { "Content-Type": "application/json" };
      const monitorBody = JSON.stringify({
        jsonrpc: "2.0",
        id: "obside-monitor",
        method: "aria2.tellStatus",
        params: ["token:" + RPC_SECRET, gid]
      });

      // Obside fix: skip a tick if the previous poll's RPC is still in flight, so a slow
      // aria2c response doesn't let overlapping status requests pile up every 500ms.
      let polling = false;
      let intervalId = setInterval(async () => {
        if (polling) {
          return;
        }
        polling = true;
        try {
          const monitorRes = await fetch(rpcUrl, {
            method: "POST",
            headers: monitorHeaders,
            body: monitorBody
          });
          const monitorData = await monitorRes.json();
          if (monitorData.error) {
            clearInterval(intervalId);
            onError(monitorData.error.message);
            return;
          }
          const statusObj = monitorData.result;
          const status = statusObj.status;
          const completedBytes = parseInt(statusObj.completedLength, 10) || 0;
          const totalBytes = parseInt(statusObj.totalLength, 10) || 0;
          const speed = parseInt(statusObj.downloadSpeed, 10) || 0;

          if (status === "active") {
            onProgress(completedBytes, totalBytes, speed);
          } else if (status === "complete") {
            clearInterval(intervalId);
            onComplete();
          } else if (status === "error") {
            clearInterval(intervalId);
            onError("Aria2 download failed: " + (statusObj.errorMessage || "Unknown error"));
          } else if (status === "removed") {
            clearInterval(intervalId);
            onError("Download removed.");
          }
        } catch (e) {
          clearInterval(intervalId);
          onError(e.message);
        } finally {
          polling = false;
        }
      }, 500);

      return { gid, intervalId };
    } catch (err) {
      onError(err.message);
      throw err;
    }
  },

  async cancelDownload(downloadRef) {
    if (!downloadRef) return;
    if (downloadRef.intervalId) {
      clearInterval(downloadRef.intervalId);
    }
    const rpcUrl = "http://127.0.0.1:" + RPC_PORT + "/jsonrpc";
    try {
      await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "obside-cancel",
          method: "aria2.forceRemove",
          params: ["token:" + RPC_SECRET, downloadRef.gid]
        })
      });
    } catch (e) {
      console.error("[HyperFetch] Error removing download from aria2c:", e);
    }
  }
};
