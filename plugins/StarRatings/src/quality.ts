import { MediaItem, PlayState } from "@luna/lib";
import { settings } from "./settings";

/**
 * Colour the (filled) stars by the track's audio quality: HiRes tracks keep the
 * gold star, everything else turns turquoise. Works by setting the `--star-on`
 * custom property on a stars widget's span - it cascades into the SVG paths, which
 * already fill with `var(--star-on, …)`, so no repaint of the stars is needed.
 */

const hiResCache = new Map<string, boolean>();

/** Catalog-level HiRes check from a track's static metadata (tags / audioQuality). */
function tidalItemIsHiRes(item: any): boolean {
	const t = item?.tidalItem;
	const tags: unknown = t?.mediaMetadata?.tags;
	if (Array.isArray(tags) && tags.includes("HIRES_LOSSLESS")) return true;
	const aq = t?.audioQuality;
	if (aq === "HI_RES_LOSSLESS") return true;
	// Fall back to Luna's computed best quality.
	try {
		if (item?.bestQuality?.name === "HiRes") return true;
	} catch {
		/* ignore */
	}
	return false;
}

/**
 * HiRes state of the *currently playing* stream, from the live playback context
 * (this is what the player's "24-bit 96kHz" badge reflects). Returns null when the
 * stream quality isn't known yet, so callers can fall back to catalog metadata.
 */
function nowPlayingIsHiRes(): boolean | null {
	try {
		const pc = PlayState.playbackContext as { actualAudioQuality?: string; bitDepth?: number | null; sampleRate?: number | null } | undefined;
		if (!pc) return null;
		if ((pc.bitDepth ?? 0) > 16 || (pc.sampleRate ?? 0) > 48000) return true;
		if (pc.actualAudioQuality === "HI_RES_LOSSLESS") return true;
		if (pc.actualAudioQuality) return false; // quality known and it isn't HiRes
		return null; // not resolved yet
	} catch {
		return null;
	}
}

/** Catalog HiRes for a track id (cached; resolves via Luna's MediaItem). */
async function catalogIsHiRes(trackId: string): Promise<boolean> {
	const cached = hiResCache.get(trackId);
	if (cached !== undefined) return cached;
	let hi = false;
	try {
		const item = await MediaItem.fromId(trackId);
		hi = tidalItemIsHiRes(item);
	} catch {
		/* leave as false */
	}
	hiResCache.set(trackId, hi);
	return hi;
}

/** Whether a track is HiRes. `usePlayback` prefers the live stream (now-playing bar). */
export async function isHiRes(trackId: string, usePlayback = false): Promise<boolean> {
	if (usePlayback) {
		const live = nowPlayingIsHiRes();
		if (live !== null) return live;
	}
	return catalogIsHiRes(trackId);
}

/** Set (or clear) a stars widget's "on" colour based on the track's quality. */
export function applyQualityColor(span: HTMLElement, trackId: string | null, usePlayback = false) {
	if (!settings.colorStarsByQuality || !trackId) {
		span.style.removeProperty("--star-on"); // fall back to the themed gold
		return;
	}
	void isHiRes(trackId, usePlayback).then((hi) => {
		span.style.setProperty("--star-on", hi ? "var(--star-hires)" : "var(--star-standard)");
	});
}
