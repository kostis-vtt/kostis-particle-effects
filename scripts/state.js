// What the user is working with right now: the selected particle, emitter and effect (shared by the studio and
// the map tools), including unsaved edits handed to a tool.

import {Library} from "./library.js";

const DEFAULTS = {particles: "builtin-arcane-orb", emitters: "builtin-magic-dust", effects: "builtin-magic-missile"};

export const State = {
  selected: {particles: null, emitters: null, effects: null},

  /** Edited (possibly unsaved) items handed to a map tool. */
  drafts: {particles: null, emitters: null, effects: null},

  select(tab, id) {
    this.selected[tab] = id;
    this.drafts[tab] = null;
  },

  useDraft(tab, item) {
    this.drafts[tab] = item ? foundry.utils.deepClone(item) : null;
  },

  /** The item a tool should use for a tab. */
  current(tab) {
    return this.drafts[tab] ?? Library.get(tab, this.selected[tab]) ?? Library.get(tab, DEFAULTS[tab]);
  }
};
