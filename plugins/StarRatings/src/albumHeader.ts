import type { LunaUnload } from "@luna/core";
import { observe, safeInterval } from "@luna/lib";
import { settings } from "./settings";
import { SELECTORS } from "./selectors";
import { getRowTrackId } from "./tracklist";
import { getTrackRating } from "./store";
import { createStars, setRating, type StarData } from "./stars";
import { onRatingChanged } from "./events";

/**
 * On an album page, show the average of the album's track ratings just under the
 * "<year> <quality>" meta line, coloured by the album's audio quality
 * (Max / HiRes -> gold, everything else -> turquoise).
 */

const LINE_ID = "album-rating-average";

/** Average of the rated tracks currently rendered in the tracklist (unrated ignored). */
function computeAverage(): number | null {
	let sum = 0;
	let n = 0;
	document.querySelectorAll(SELECTORS.trackListRow).forEach((row) => {
		const id = getRowTrackId(row);
		if (!id) return;
		const r = getTrackRating(id);
		if (r != null) {
			sum += r;
			n++;
		}
	});
	return n > 0 ? sum / n : null;
}

/** The "<year> <quality>" meta line lives in the album header's meta container. */
function findMetaContainer(): Element | null {
	const releaseDate = document.querySelector('[data-test="meta-release-date"]');
	const metaLine = releaseDate?.closest('[class^="_metaLine_"]');
	return metaLine?.parentElement ?? null;
}

/** Whether the album header advertises Max / HiRes quality. */
function isMaxQuality(metaContainer: Element): boolean {
	return !!metaContainer.querySelector('[data-test="quality-badge-max"], [class*="wave-badge-color-max"]');
}

export function initAlbumHeader(unloads: Set<LunaUnload>) {
	let starData: StarData | null = null;

	const remove = () => {
		document.getElementById(LINE_ID)?.remove();
		starData = null;
	};

	const render = () => {
		if (!settings.showAlbumAverage || !location.pathname.includes("/album/")) return remove();

		const metaContainer = findMetaContainer();
		if (!metaContainer) return remove();

		const avg = computeAverage();
		if (avg == null) return remove();

		const color = isMaxQuality(metaContainer) ? "var(--star-hires)" : "var(--star-standard)";

		let line = document.getElementById(LINE_ID) as HTMLElement | null;
		if (!line || !line.isConnected || line.parentElement !== metaContainer || !starData) {
			line?.remove();
			line = document.createElement("div");
			line.id = LINE_ID;
			line.style.display = "flex";
			line.style.width = "fit-content";
			line.style.alignItems = "center";
			line.style.gap = "8px";
			line.style.marginTop = "8px";
			// Restrained glass: a whisper of translucency + blur, no glossy highlight or heavy shadow.
			line.style.padding = "5px 10px";
			line.style.borderRadius = "var(--market-button-border-radius)"; // match TIDAL's native buttons
			line.style.background = "rgba(255, 255, 255, 0.04)";
			line.style.backdropFilter = "blur(6px) saturate(115%)";
			(line.style as unknown as Record<string, string>).webkitBackdropFilter = "blur(6px) saturate(115%)";
			line.style.border = "1px solid rgba(255, 255, 255, 0.07)";

			starData = createStars("album-avg", 20);
			starData[0].style.margin = "0";
			starData[0].style.pointerEvents = "none"; // decorative, read-only

			const num = document.createElement("span");
			num.className = "album-rating-num";
			num.style.fontSize = "16px";
			// Match the album header's own typography (font family + weight).
			const titleEl = document.querySelector('[data-test="title"]');
			if (titleEl) {
				const cs = getComputedStyle(titleEl);
				num.style.fontFamily = cs.fontFamily;
				num.style.fontWeight = cs.fontWeight;
			}

			line.appendChild(starData[0]);
			line.appendChild(num);
			metaContainer.appendChild(line);
		}

		starData[0].style.setProperty("--star-on", color);
		setRating(starData[1], avg, starData[2]);
		const num = line.querySelector(".album-rating-num") as HTMLElement;
		num.textContent = avg.toFixed(1);
		num.style.color = color;
	};

	render();
	observe(unloads, '[data-test="meta-release-date"]', render); // re-run when an album header appears
	safeInterval(unloads, render, 1500); // catches navigation, row loading, rating changes
	unloads.add(onRatingChanged(() => render())); // live-update when a track rating changes
	unloads.add(remove);
}
