/**
 * Central place for every TIDAL DOM selector this plugin relies on.
 *
 * TIDAL ships hashed CSS-module class names (e.g. `_moreContainer_f6162c8`) whose
 * *prefix* is stable across builds while the hash suffix changes. So we match with
 * `[class^="_prefix"]` / `[class*="_prefix"]`. These are the parts most likely to
 * need a quick re-tune after a TIDAL update - everything else keys off them.
 *
 * How to re-tune: open TIDAL with Luna, run @luna/dev logging or the built-in
 * devtools (Ctrl+Shift+I), inspect the element you want to anchor to, and copy the
 * stable class prefix here.
 */
export const SELECTORS = {
	/** The favourite (heart) button in the footer - the most stable, theme-independent anchor. */
	nowPlayingFavorite: '[data-test="footer-favorite-button"]',

	/** Right-hand container in the player footer (queue / device / volume buttons). */
	nowPlayingRight: '[data-test="footer-player"] [class^="_utilityButtons"]',

	/** Left-hand now-playing actions (next to the favourite / context-menu buttons). */
	nowPlayingLeft: '[data-test="track-info"] [class^="_actions"]',

	/** Album / playlist page action bar (the big Play button sits inside this). */
	pageActionBar: '[class^="_moduleActions"], [class^="_actions"]',

	/** The grid row of a tracklist (matched once - it carries data-track-id). */
	trackListRow: '[data-test="tracklist-row"]',

	/** The title cell within a row - stars get their own line appended here. */
	trackRowTitleCell: '[data-test="table-row-title"]',

	/** Attribute carrying the track id on a tracklist row (fallbacks tried in order). */
	trackRowIdAttrs: ["data-track-id", "data-track--content-id", "data-item-id"],
} as const;

/** First element matching any comma-free candidate in a grouped selector string. */
export const queryFirst = (root: ParentNode, groupedSelector: string): Element | null => {
	for (const sel of groupedSelector.split(",").map((s) => s.trim())) {
		if (!sel) continue;
		try {
			const el = root.querySelector(sel);
			if (el) return el;
		} catch {
			/* invalid selector candidate - skip */
		}
	}
	return null;
};
