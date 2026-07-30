import { createXpcomEngine } from "resource:///modules/JSTorrent.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  Downloads: "resource://gre/modules/Downloads.sys.mjs",
  PathUtils: "resource://gre/modules/PathUtils.sys.mjs",
  Services: "resource://gre/modules/Services.sys.mjs",
  IOUtils: "resource://gre/modules/IOUtils.sys.mjs",
});

// Obside optimization: define formatBytes and its unit table once at module scope
// instead of re-creating the closure + ['B','KB',...] array on every addTorrent call.
const BYTE_K = 1024;
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const i = Math.floor(Math.log(bytes) / Math.log(BYTE_K));
  return parseFloat((bytes / Math.pow(BYTE_K, i)).toFixed(2)) + ' ' + BYTE_UNITS[i];
}

export var ObsideTorrent = {
  engine: null,
  initialized: false,

  async init() {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    try {
      dump("!!!! ObsideTorrent: Initializing...\n");
      const downloadPath = await lazy.Downloads.getPreferredDownloadsDirectory();
      
      this.engine = createXpcomEngine({
        downloadPath: downloadPath,
        port: 6881
      });

      dump("!!!! ObsideTorrent: Engine initialized successfully.\n");
    } catch (e) {
      dump("!!!! ObsideTorrent: Failed to initialize engine: " + e + "\n");
    }
  },

  async addTorrent(pathOrMagnet, uiShell) {
    if (!this.engine) {
      return;
    }
    
    try {
      // Obside security fix (C37): removed a debug leftover that silently flipped the
      // chrome pref browser.dom.window.dump.enabled = true on every (remotely reachable)
      // magnet invocation — a hardening regression enabling window.dump() for all content.
      let input = pathOrMagnet;
      
      // If it's a file path ending with .torrent, read it from disk
      if (typeof pathOrMagnet === "string" && pathOrMagnet.endsWith(".torrent")) {
        dump("!!!! ObsideTorrent: Reading torrent file from disk: " + pathOrMagnet + "\n");
        input = await lazy.IOUtils.read(pathOrMagnet);
        dump("!!!! ObsideTorrent: Successfully read " + input.length + " bytes from disk.\n");
      } else {
        dump("!!!! ObsideTorrent: Adding magnet link: " + pathOrMagnet + "\n");
      }
      
      dump("!!!! ObsideTorrent: Calling engine.addTorrent()...\n");
      const { torrent } = await this.engine.addTorrent(input);
      dump("!!!! ObsideTorrent: engine.addTorrent() returned successfully. InfoHash: " + (torrent.infoHash || "Unknown") + "\n");
      dump("!!!! ObsideTorrent: Initial torrent state - Length: " + torrent.length + ", Downloaded: " + torrent.downloaded + "\n");
      
      if (uiShell) {
        let dl = uiShell.download;

        let pollCount = 0;
        // Obside optimization: torrent.length is effectively constant once metadata is
        // known, so cache its formatted string and re-format only when the raw value
        // changes. Output is bit-for-bit identical.
        let lastLen = -1;
        let lastSizeStr = '';
        let interval = setInterval(() => {
           // Obside fix: previously this poller cleared ONLY on torrent.done, so a
           // cancelled / removed / permanently-stalled torrent leaked the 1s interval
           // forever. Stop if the download was stopped externally or its info was cleared.
           if (dl.stopped && !torrent.done) {
               clearInterval(interval);
               return;
           }
           if (torrent.done) {
               dump("!!!! ObsideTorrent: Torrent is DONE!\n");
               clearInterval(interval);
               dl.stopped = true;
               dl.torrentInfo = null;
               uiShell.onChanged();
           } else {
               if (!dl.torrentInfo) { clearInterval(interval); return; }
               pollCount++;
               if (pollCount % 3 === 0) {
                 dump(`!!!! ObsideTorrent [${torrent.infoHash}]: ↓ ${formatBytes(torrent.downloadSpeed)}/s ↑ ${formatBytes(torrent.uploadSpeed)}/s | Seeds: ${torrent.numPeers} | Bytes: ${torrent.downloaded} / ${torrent.length}\n`);
               }
               dl.currentBytes = Number(torrent.downloaded || 0);
               dl.totalBytes = Number(torrent.length || 100000);
               dl.torrentInfo.downloadSpeed = formatBytes(torrent.downloadSpeed);
               dl.torrentInfo.uploadSpeed = formatBytes(torrent.uploadSpeed);
               dl.torrentInfo.seeds = torrent.numPeers || 0;
               dl.torrentInfo.peers = torrent.numPeers || 0;
               if (torrent.length !== lastLen) {
                 lastLen = torrent.length;
                 lastSizeStr = formatBytes(torrent.length);
               }
               dl.torrentInfo.size = lastSizeStr;
               dl.torrentInfo.tick = pollCount;
               uiShell.onChanged();
           }
        }, 1000);
        // Obside fix: expose the interval so an external cancel/remove path can clear it.
        dl._obsideTorrentInterval = interval;
      }

      return torrent;
    } catch (e) {
      dump("!!!! ObsideTorrent: addTorrent error: " + (e.message || e) + "\n");
      if (uiShell) {
        uiShell.download.torrentInfo = { downloadSpeed: "ERROR: " + (e.message || e), uploadSpeed: "0 B/s", seeds: 0, peers: 0 };
        uiShell.download.stopped = true;
        uiShell.onChanged();
      }
    }
  }
};
