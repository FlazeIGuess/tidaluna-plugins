import type { LunaUnload } from "@luna/core";
import { MediaItem, PlayState, observe, safeInterval } from "@luna/lib";
import { settings } from "./settings";
import { SELECTORS, queryFirst } from "./selectors";
import { createStars, getMouseoverRating, setRating, wireStarInteractions, type StarData } from "./stars";
import { getTrackRating, hasRating } from "./store";
import { rateTrack } from "./ratingActions";
import { onRatingChanged } from "./events";
import { applyQualityColor } from "./quality";
import { trace } from "./trace";

let nowPlayingStars: StarData | null = null;
let currentTrackId: string | null = null;

/** Ctrl+Alt+Numpad<n> -> rating (matches the original layout). */
const SHORTCUT_MAP: Record<string, number> = {
	Numpad0: 5.0,
	Numpad1: 0.5,
	Numpad2: 1.0,
	Numpad3: 1.5,
	Numpad4: 2.0,
	Numpad5: 2.5,
	Numpad6: 3.0,
	Numpad7: 3.5,
	Numpad8: 4.0,
	Numpad9: 4.5,
};

export function repaintNowPlaying() {
	if (!nowPlayingStars) return;
	const [span, starElements, label] = nowPlayingStars;
	const isTrack = !!currentTrackId;
	span.style.display = isTrack ? "flex" : "none";
	if (isTrack) {
		setRating(starElements, getTrackRating(currentTrackId!) ?? 0, label);
		applyQualityColor(span, currentTrackId, true); // prefer the live stream (matches the player badge)
	}
}

function shouldSkip(trackId: string): boolean {
	const rated = hasRating(trackId);
	if (settings.play === "onlyunrated" && rated) return true;
	if (settings.play === "onlyrated" && !rated) return true;
	if (settings.skipThreshold >= 0) {
		const r = getTrackRating(trackId);
		if (r !== null && r <= settings.skipThreshold) return true;
	}
	return false;
}

export function initNowPlaying(unloads: Set<LunaUnload>) {
	// Resolve an insertion point anchored on stable data-test attributes so it
	// survives themes/other plugins that only restyle (not restructure) the footer.
	const findAnchor = (): { parent: Element; before: Node | null } | null => {
		if (settings.nowPlayingStarsPosition === "right") {
			const util = queryFirst(document, SELECTORS.nowPlayingRight);
			return util ? { parent: util, before: util.firstChild } : null;
		}
		// "left": append after the favourite (heart) + context-menu (…) buttons.
		// Wait for that anchor to exist - no cross-side fallback, or the stars land on the wrong side.
		const fav = document.querySelector(SELECTORS.nowPlayingFavorite);
		if (fav?.parentElement) return { parent: fav.parentElement, before: null };
		const actions = queryFirst(document, SELECTORS.nowPlayingLeft);
		if (actions) return { parent: actions, before: null };
		return null;
	};

	// Inject once; re-inject if a theme/plugin re-renders the footer and wipes our node.
	const tryInject = () => {
		const existing = document.getElementById("stars-now-playing");
		if (existing && existing.isConnected) return;
		const anchor = findAnchor();
		if (!anchor) return;
		const starData = createStars("now-playing", 16);
		starData[0].style.margin = "0 8px";
		starData[0].style.flexShrink = "0";
		anchor.parent.insertBefore(starData[0], anchor.before);
		nowPlayingStars = starData;
		wireStarInteractions(starData, {
			getTrackId: () => currentTrackId,
			currentRating: (id) => getTrackRating(id),
			rate: (id, r) => rateTrack(id, r),
			afterRate: repaintNowPlaying,
		});
		repaintNowPlaying();
	};
	tryInject(); // the footer already exists at load time
	observe(unloads, SELECTORS.nowPlayingFavorite, tryInject); // re-inject after footer re-renders
	observe(unloads, "[data-test='footer-player']", tryInject);
	safeInterval(
		unloads,
		() => {
			tryInject(); // safety net against silent wipes
			// Re-settle the quality colour: the live stream quality often resolves a
			// moment after a track change, so converge to it here.
			if (nowPlayingStars && currentTrackId) applyQualityColor(nowPlayingStars[0], currentTrackId, true);
		},
		1500,
	);

	// Seed the current track and repaint.
	MediaItem.fromPlaybackContext()
		.then((item) => {
			if (item) currentTrackId = String(item.id);
			repaintNowPlaying();
		})
		.catch(trace.err.withContext("fromPlaybackContext"));

	// React to track changes: apply play-mode / skip filters, then repaint.
	MediaItem.onMediaTransition(unloads, async (item) => {
		currentTrackId = String(item.id);
		if (shouldSkip(currentTrackId)) {
			PlayState.next();
			return;
		}
		repaintNowPlaying();
	});

	// Keyboard shortcuts.
	const onKeyDown = (e: KeyboardEvent) => {
		if (!settings.enableKeyboardShortcuts) return;
		if (!e.ctrlKey || !e.altKey) return;
		const rating = SHORTCUT_MAP[e.code];
		if (rating === undefined || !currentTrackId) return;
		e.preventDefault();
		void rateTrack(currentTrackId, rating).then(repaintNowPlaying);
	};
	document.addEventListener("keydown", onKeyDown);
	unloads.add(() => document.removeEventListener("keydown", onKeyDown));

	// Repaint when this track is rated anywhere (tracklist row, keyboard, etc.).
	unloads.add(
		onRatingChanged((id) => {
			if (id === currentTrackId) repaintNowPlaying();
		}),
	);

	// TIDAL's player bar opens the fullscreen now-playing view via a click handler that
	// runs before ours. Intercept at the document root in the CAPTURE phase (which fires
	// first of all), fully block the event for clicks on our stars, and do the rating here.
	const inNowPlayingStars = (target: EventTarget | null) => target instanceof Element && !!target.closest("#stars-now-playing");

	const onCaptureClick = (e: MouseEvent) => {
		if (!inNowPlayingStars(e.target)) return;
		e.stopImmediatePropagation();
		e.preventDefault();
		const svg = (e.target as Element).closest("svg") as SVGSVGElement | null;
		if (!svg || !nowPlayingStars || !currentTrackId) return;
		const svgs = nowPlayingStars[1].map((el) => el[0]);
		const i = svgs.indexOf(svg);
		if (i < 0) return;
		void rateTrack(currentTrackId, getMouseoverRating(e, svg, i)).then(repaintNowPlaying);
	};
	document.addEventListener("click", onCaptureClick, true);
	unloads.add(() => document.removeEventListener("click", onCaptureClick, true));

	const onCapturePress = (e: Event) => {
		if (!inNowPlayingStars(e.target)) return;
		e.stopImmediatePropagation();
		if (typeof (e as MouseEvent).preventDefault === "function") e.preventDefault();
	};
	for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "dblclick", "auxclick", "contextmenu", "dragstart"]) {
		document.addEventListener(type, onCapturePress, true);
		unloads.add(() => document.removeEventListener(type, onCapturePress, true));
	}

	unloads.add(() => {
		nowPlayingStars?.[0].remove();
		nowPlayingStars = null;
	});
}

export const getCurrentTrackId = () => currentTrackId;
