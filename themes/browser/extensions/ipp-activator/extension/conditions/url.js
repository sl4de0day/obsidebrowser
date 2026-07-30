/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global ConditionBase */

/**
 * URL condition
 */
class ConditionUrl extends ConditionBase {
  // Obside optimization: cache the compiled RegExp so it is not recompiled from the
  // immutable pattern on every check(). Only a successful compile is cached, so the
  // invalid-pattern warning path is unchanged. The regex is non-global (no lastIndex
  // state), so reuse is behavior-preserving.
  #pattern;

  constructor(factory, desc) {
    super(factory, desc);
  }

  check() {
    try {
      if (this.#pattern === undefined) {
        this.#pattern = new RegExp(String(this.desc?.pattern ?? ""));
      }
      const url = String(this.factory?.context?.url ?? "");
      return this.#pattern.test(url);
    } catch (e) {
      console.warn("Unable to parse the regexp", this.desc?.pattern, e);
      return false;
    }
  }
}

globalThis.ConditionUrl = ConditionUrl;
