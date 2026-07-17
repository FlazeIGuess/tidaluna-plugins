import type { LunaUnload } from "@luna/core";
import { observe, safeInterval } from "@luna/lib";
import { settings } from "./settings";
import { SELECTORS } from "./selectors";
import { createStars, setRating, wireStarInteractions, type StarData } from "./stars";
import { getTrackRating, hasRating } from "./store";
import { rateTrack } from "./ratingActions";
import { onRatingChanged } from "./events";
import { applyQualityColor } from "./quality";
import { getCurrentTrackId, repaintNowPlaying } from "./nowPlaying";

let counter = 0;

export function getRowTrackId(row: Element): string | null {
	for (const attr of SELECTORS.trackRowIdAttrs) {
		const v = row.getAttribute(attr) ?? row.querySelector(`[${attr}]`)?.getAttribute(attr);
		if (v) return v;
	}
	const link = row.querySelector('a[href*="/track/"]');
	const m = link?.getAttribute("href")?.match(/\/track\/(\d+)/);
	return m?.[1] ?? null;
}

function wireRow(row: Element, trackId: string, unloads: Set<LunaUnload>) {
	// Render the stars as their own aligned column, pinned to the right edge of the
	// title cell - i.e. visually between the "Titel" and "Künstler" columns. Reserve
	// space on the right so long titles truncate before the stars instead of overlapping.
	const titleCell = (row.querySelector(SELECTORS.trackRowTitleCell) ?? row) as HTMLElement;
	titleCell.style.position = "relative";
	titleCell.style.paddingRight = "112px";

	const starData: StarData = createStars(`row-${trackId}-${counter++}`, 14);
	const [span, starElements, label] = starData;
	span.style.position = "absolute";
	span.style.right = "32px";
	span.style.top = "50%";
	span.style.transform = "translateY(-50%)";
	titleCell.appendChild(span);

	const paint = () => setRating(starElements, getTrackRating(trackId) ?? 0, label);
	paint();
	applyQualityColor(span, trackId); // gold for HiRes, turquoise otherwise

	const applyVisibility = (hovering: boolean) => {
		span.style.visibility = hasRating(trackId) || hovering ? "visible" : "hidden";
	};
	applyVisibility(false);

	// Hover-preview + click-to-rate; captures all clicks so the row never plays the track.
	wireStarInteractions(starData, {
		getTrackId: () => trackId,
		currentRating: (id) => getTrackRating(id),
		rate: (id, r) => rateTrack(id, r),
		afterRate: () => {
			paint();
			applyVisibility(true);
			if (getCurrentTrackId() === trackId) repaintNowPlaying();
		},
	});

	const onRowOver = () => applyVisibility(true);
	const onRowOut = () => applyVisibility(false);
	row.addEventListener("mouseover", onRowOver);
	row.addEventListener("mouseout", onRowOut);

	// Live-update this row when the track is rated anywhere (now-playing bar, another
	// row for the same track, keyboard shortcut, ISRC sync).
	const offRating = onRatingChanged((id) => {
		if (id !== trackId) return;
		paint();
		applyVisibility(false);
	});

	unloads.add(() => {
		offRating();
		span.remove();
		row.removeEventListener("mouseover", onRowOver);
		row.removeEventListener("mouseout", onRowOut);
	});
}

export function initTracklist(unloads: Set<LunaUnload>) {
	const inject = (row: Element) => {
		if (!settings.showPlaylistStars) return;
		if (row.hasAttribute("data-sr-injected")) return;
		const trackId = getRowTrackId(row);
		if (!trackId) return;
		row.setAttribute("data-sr-injected", "1");
		wireRow(row, trackId, unloads);
	};
	const scan = () => document.querySelectorAll(SELECTORS.trackListRow).forEach(inject);

	scan(); // rows already rendered on the current page
	observe(unloads, SELECTORS.trackListRow, inject); // rows added as you scroll/navigate
	safeInterval(unloads, scan, 2000); // safety net
}
