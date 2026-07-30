# Third-Party Licenses

Obside is a Firefox/LibreWolf derivative licensed as a whole under the
**Mozilla Public License 2.0** (see `LICENSE`). It bundles the third-party
components listed below, each under its own license. This file records the
required attribution (component → license → copyright holder); full license
texts are referenced rather than reproduced (Space Grotesk's full font license
ships as `themes/browser/fonts/OFL.txt`).

## Components

| Component | License (SPDX) | Copyright | Bundled in |
|---|---|---|---|
| React, react-dom, scheduler, react-jsx-runtime | MIT | Meta Platforms, Inc. and affiliates | `themes/browser/base/content/e2eeroom.js`, `.../aboutwelcome/content/obside-welcome.js` |
| emoji-picker-react | MIT | Evyatar Alush | `themes/browser/base/content/e2eeroom.js` |
| buffer | MIT | Feross Aboukhadijeh and contributors | `themes/browser/base/content/e2eeroom.js` |
| events | MIT | Joyent, Inc. and Node contributors | `themes/browser/base/content/e2eeroom.js` |
| simple-peer | MIT | Feross Aboukhadijeh | `themes/browser/components/preferences/simplepeer.min.js` |
| bn.js | MIT | Fedor Indutny (2015) | vendored in `themes/browser/modules/JSTorrent.sys.mjs` |
| Dark Reader (shipped as "Obside Dark Mode") | MIT | Dark Reader Ltd. | `settings/distribution/extensions/` |
| Space Grotesk (5 weights) | OFL-1.1 | The Space Grotesk Project Authors (2020) | `themes/browser/fonts/` — full text: `fonts/OFL.txt` |
| Open Sans (bundled inside Dark Reader) | Apache-2.0 | Google LLC / Steve Matteson | Dark Reader extension (LICENSE.txt included) |
| capa (download-safety binary) | Apache-2.0 | Mandiant / Google LLC | bundled binary at distribution (not in repo source) |
| Auto Tab Discard (shipped as "Obside Smart Resource Management") | MPL-2.0 | Auto Tab Discard authors | `settings/distribution/extensions/` |
| data-leak-blocker | MPL-2.0 | Mozilla Foundation / Obside | `themes/browser/extensions/data-leak-blocker/` |
| ipp-activator | MPL-2.0 | Mozilla Foundation / Obside | `themes/browser/extensions/ipp-activator/` |

## GPL components (separate extensions — aggregation)

The following ship as separate, independently-licensed WebExtensions (mere
aggregation; they do not change the browser's MPL-2.0 license). Each retains its
own GPL license and upstream copyright/notices:

| Component | License (SPDX) | Upstream |
|---|---|---|
| uBlock Origin (shipped as "Obside Ad Blocker") | GPL-3.0-or-later | https://github.com/gorhill/uBlock |
| uBlock Origin asset manifest (`assets/uBOAssets.json`) | GPL-3.0-only | https://github.com/gorhill/uBlock |
| network-manager VPN extension (FoxyProxy-derived) | GPL-2.0-only | https://github.com/foxyproxy |

## Full license texts

- MPL-2.0 → `LICENSE`
- OFL-1.1 (Space Grotesk) → `themes/browser/fonts/OFL.txt`
- MIT → https://opensource.org/license/mit (identical template; copyright holders above)
- Apache-2.0 → https://www.apache.org/licenses/LICENSE-2.0
- GPL-2.0 / GPL-3.0 → each extension bundles its own COPYING/LICENSE
