const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  ObsideTorrent: "resource:///modules/ObsideTorrent.sys.mjs",
});

export class MagnetProtocolHandler {
  scheme = "magnet";
  defaultPort = -1;
  // URI_NORELATIVE: Doesn't have relative URIs
  // URI_NOAUTH: Doesn't have an authority (host/port)
  // URI_LOADABLE_BY_ANYONE: Can be loaded from any webpage
  // URI_DOES_NOT_RETURN_DATA: Doesn't return data to the browser
  protocolFlags = 
    Ci.nsIProtocolHandler.URI_NORELATIVE |
    Ci.nsIProtocolHandler.URI_NOAUTH |
    Ci.nsIProtocolHandler.URI_LOADABLE_BY_ANYONE |
    Ci.nsIProtocolHandler.URI_DOES_NOT_RETURN_DATA;

  allowPort(port, scheme) {
    return false;
  }

  newChannel(uri, loadInfo) {
    // Obside security fix (C8): a magnet: link is registered URI_LOADABLE_BY_ANYONE,
    // so ANY web page could previously auto-drive the privileged parent-process torrent
    // engine with zero user interaction (swarm join / disk write / seeding / SSRF /
    // real-IP leak). Require an explicit user confirmation before touching the engine,
    // establishing a real trust boundary between remote content and the torrent engine.
    Promise.resolve().then(() => {
      let approved = false;
      try {
        const win = Services.wm.getMostRecentWindow("navigator:browser");
        const isTR = ((Services.locale.appLocalesAsBCP47 || [])[0] || "").startsWith("tr");
        const title = isTR ? "Obside — Torrent Bağlantısı" : "Obside — Torrent Link";
        const body = isTR
          ? "Bir sayfa bir torrent/magnet indirmesi başlatmak istiyor:\n\n" +
            uri.spec.slice(0, 300) +
            "\n\nDevam edilsin mi? Torrent trafiği VPN/proxy dışına çıkabilir."
          : "A page wants to start a torrent/magnet download:\n\n" +
            uri.spec.slice(0, 300) +
            "\n\nProceed? Torrent traffic may go outside the VPN/proxy.";
        approved = Services.prompt.confirm(win, title, body);
      } catch (e) {
        approved = false;
      }
      if (approved) {
        lazy.ObsideTorrent.addTorrent(uri.spec);
      }
    }).catch(console.error);

    // We must return an nsIChannel. Since we don't want the browser to actually navigate
    // to a page or download a file via the normal HTTP process, we return a channel that
    // yields no data.
    const channel = Cc["@mozilla.org/network/input-stream-channel;1"].createInstance(Ci.nsIInputStreamChannel);
    const emptyStream = Cc["@mozilla.org/io/string-input-stream;1"].createInstance(Ci.nsIStringInputStream);
    emptyStream.data = "";
    channel.setURI(uri);
    channel.contentStream = emptyStream;
    channel.QueryInterface(Ci.nsIChannel);
    channel.contentType = "text/plain";
    channel.loadInfo = loadInfo;
    return channel;
  }

  QueryInterface = ChromeUtils.generateQI(["nsIProtocolHandler"]);
}
