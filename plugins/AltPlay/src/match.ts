import { activeProviders, getProvider } from "./providers/registry";
import type { ProviderMatch, TrackMeta } from "./providers/types";
import { findInLibrary, hasLibrary } from "./library";

/** Build our provider-agnostic TrackMeta from a TIDAL media item's raw data. */
export function trackMetaFromTidalItem(id: string | number, t: any): TrackMeta {
	const artists: string[] = Array.isArray(t?.artists) ? t.artists.map((a: any) => a?.name).filter(Boolean) : t?.artist?.name ? [t.artist.name] : [];
	return {
		tidalId: String(id),
		isrc: t?.isrc ?? null,
		title: t?.title ?? "",
		artists,
		album: t?.album?.title ?? null,
		durationSec: typeof t?.duration === "number" ? t.duration : 0,
	};
}

// Match results are cached per track so we don't re-search on every repaint/transition.
const cache = new Map<string, ProviderMatch | null>();

/** First provider (in priority order) that has a confident match, or null. */
export async function findMatch(track: TrackMeta): Promise<ProviderMatch | null> {
	if (!track.title) return null;
	if (cache.has(track.tidalId)) return cache.get(track.tidalId)!;

	let result: ProviderMatch | null = null;

	// Local library index first: instant, no server round-trip. Once the index is
	// synced it is authoritative - no hit there means the song is not on the server.
	const hit = findInLibrary(track);
	if (hit) {
		const p = getProvider(hit.item.providerId);
		const synthetic: ProviderMatch = {
			providerId: hit.item.providerId,
			itemId: hit.item.itemId,
			title: hit.item.title,
			streamUrl: "",
			confidence: hit.confidence,
		};
		const url = p?.streamUrl?.(synthetic) ?? "";
		if (url) result = { ...synthetic, streamUrl: url };
	} else if (!hasLibrary()) {
		// Index not synced yet - fall back to per-song server search.
		for (const p of activeProviders()) {
			if (!p.match) continue;
			try {
				const m = await p.match(track);
				if (m) {
					result = m;
					break;
				}
			} catch {
				/* ignore a provider that errors */
			}
		}
	}

	cache.set(track.tidalId, result);
	return result;
}

export function clearMatchCache() {
	cache.clear();
}
