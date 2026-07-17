import type { LunaUnload } from "@luna/core";
import { StyleTag } from "@luna/lib";

import { trace, errSignal } from "./trace";
import { initNowPlaying } from "./nowPlaying";
import { initTracklist } from "./tracklist";
import { initWeightedLoop } from "./weighted";
import { initContextMenus } from "./contextMenus";
import { initAlbumHeader } from "./albumHeader";
import { initRatedFolder } from "./ratedFolder";

// Luna reads these three named exports from a plugin entry.
export { trace, errSignal };
export { Settings } from "./SettingsPage";
export const unloads = new Set<LunaUnload>();

// Themeable star colours (override these from a theme if desired).
// --star-hires / --star-standard drive the "color stars by audio quality" feature.
new StyleTag(
	"StarRatings-vars",
	unloads,
	`:root { --star-on: #ffc531; --star-off: rgba(255,255,255,0.28); --star-hires: #ffd432; --star-standard: #33d9e6; }`,
);

initNowPlaying(unloads);
initTracklist(unloads);
initWeightedLoop(unloads);
initContextMenus(unloads);
initAlbumHeader(unloads); // average rating under the album header meta line
initRatedFolder(unloads); // find/create the Rated folder + 0.0-5.0 playlists, seed local ratings

trace.log("StarRatings loaded");
