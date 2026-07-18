import type { LunaUnload } from "@luna/core";
import { StyleTag } from "@luna/lib";

import { trace, errSignal } from "./trace";
import { registerProvider } from "./providers/registry";
import { jellyfinProvider } from "./providers/jellyfin";
import { initLibrary } from "./library";
import { initEngine } from "./engine";
import { initBadge } from "./badge";
import { initOverlay, toggleOverlay } from "./overlay";
import { initTooltip } from "./tooltip";
import { initRows } from "./rows";
import { initSidebar } from "./sidebar";
import { initLibraryPage } from "./page";
import { initLibPlayer } from "./libplayer";
import { initSearch } from "./search";

// Luna reads these named exports from a plugin entry.
export { trace, errSignal };
export { Settings } from "./SettingsPage";
export const unloads = new Set<LunaUnload>();

// Themeable accent (Jellyfin blue by default).
new StyleTag(
	"AltPlay-vars",
	unloads,
	`:root { --altplay-accent: #00a4dc; --altplay-gold: #ffcf5c; --altplay-lossless: #33d9e6; }`,
);

// Register the available playback sources. Jellyfin today; more later.
registerProvider(jellyfinProvider);

// Local library index (row markers, fast matching, library page).
initLibrary(unloads);

// Engine (match -> hijack), overlay panel, badge + tooltip, track-list markers.
initEngine(unloads);
initOverlay(unloads);
initBadge(unloads, toggleOverlay);
initTooltip(unloads);
initRows(unloads);

// "Meine Musik" entry + the library page with its footer takeover player.
initLibPlayer(unloads);
initLibraryPage(unloads);
initSidebar(unloads);

// AltPlay section in TIDAL's search suggestions dropdown.
initSearch(unloads);

trace.log("AltPlay loaded");
