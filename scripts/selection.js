// The tokens the user selected on the map. Foundry releases them when the Kostis's Flying Paths controls are
// activated; the hub remembers the last selection so tools that act on "the selected tokens" still find them.

import {HUB_ID} from "./const.js";

/** @returns {Token[]} */
export function selectedTokens() {
  if ( !canvas?.ready ) return [];
  const hub = game.modules.get(HUB_ID)?.api?.selection;
  return hub ? hub.tokens() : [...(canvas.tokens?.controlled ?? [])];
}
