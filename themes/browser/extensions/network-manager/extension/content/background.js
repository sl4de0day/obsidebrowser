import {pref, App} from './app.js';
import {Sync} from "./sync.js";
import {Migrate} from './migrate.js';
import {Proxy} from './proxy.js';
import './persist.js';

const OBSIDE_VPN_TITLE = 'Obside VPN';

globalThis.obsideVpnApplyProxy = async function(host, port, username, password, protocol) {
  if (protocol !== 'https') {
    return false;
  }
  await App.getPref();
  pref.data = (pref.data || []).filter(i => i.title !== OBSIDE_VPN_TITLE);
  const entry = {
    active: true,
    title: OBSIDE_VPN_TITLE,
    type: 'https',
    hostname: String(host),
    port: String(port),
    username: username || '',
    password: password || '',
    cc: '',
    city: '',
    color: '#6366f1',
    include: [],
    exclude: [],
    tabProxy: [],
  };
  pref.data.unshift(entry);
  pref.mode = String(host) + ':' + String(port);
  await browser.storage.local.set({data: pref.data, mode: pref.mode});
  await Proxy.set(pref, true);
  return true;
};

globalThis.obsideVpnClearProxy = async function() {
  await App.getPref();
  pref.data = (pref.data || []).filter(i => i.title !== OBSIDE_VPN_TITLE);
  pref.mode = 'disable';
  await browser.storage.local.set({data: pref.data, mode: pref.mode});
  await Proxy.set(pref, true);
  return true;
};

// ---------- process preferences --------------------------
class ProcessPref {

  static {
    this.init();
  }

  static async init() {
    // Chrome: Top-level await is disallowed in service workers
    // user preference
    await App.getPref();

    // storage sync -> local update
    await Sync.get(pref);

    // migrate after storage sync check
    await Migrate.init(pref);

    // set proxy, dataChange
    Proxy.set(pref, true);

    // add listener after migrate
    Sync.init(pref);
  }
}
// ---------- /process preferences -------------------------

// ---------- initialisation -------------------------------
// browser.runtime.onInstalled.addListener(e => {
//   // show help
//   ['install', 'update'].includes(e.reason) && browser.tabs.create({url: '/content/help.html'});
// });