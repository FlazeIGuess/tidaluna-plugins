import { redux, TidalApi } from "@luna/lib";
import type { LibraryTrack } from "./providers/types";
import { scoreCandidate } from "./normalize";
import { trace } from "./trace";

/**
 * Reverse lookup: does a Jellyfin library track also exist in TIDAL's catalog?
 * If yes, we let TIDAL play it natively - artist/album links, fullscreen, lyrics
 * and credits all work - while the hijack engine swaps only the AUDIO to Jellyfin.
 */

const MIN_CONFIDENCE = 0.65; // strict: wrong info is worse than the plain takeover

/** TIDAL identity of a library track (null = not on TIDAL). */
export type TidalHit = { trackId: string; artistId: string | null; albumId: string | null };
const cache = new Map<string, TidalHit | null>(); // keyed by library itemId

type SearchTrack = {
	id: number;
	title?: string;
	duration?: number;
	artists?: { id?: number; name: string }[];
	album?: { id?: number; title: string }[] | { id?: number; title: string };
};

export async function findTidalTrack(t: LibraryTrack): Promise<TidalHit | null> {
	if (cache.has(t.itemId)) return cache.get(t.itemId)!;
	let result: TidalHit | null = null;
	try {
		const q = encodeURIComponent(`${t.title} ${t.artists[0] ?? t.albumArtist ?? ""}`.trim());
		const resp = await TidalApi.fetch<{ items?: SearchTrack[] }>(
			`https://desktop.tidal.com/v1/search/tracks?query=${q}&limit=10&${TidalApi.queryArgs()}`,
		);
		const meta = {
			tidalId: "",
			isrc: null,
			title: t.title,
			artists: t.artists.length ? t.artists : [t.albumArtist].filter(Boolean),
			album: t.album || null,
			durationSec: t.durationSec,
		};
		let best: SearchTrack | null = null;
		let bestScore = 0;
		for (const it of resp?.items ?? []) {
			const album = Array.isArray(it.album) ? it.album[0] : it.album;
			const s = scoreCandidate(meta, {
				name: it.title ?? "",
				artists: (it.artists ?? []).map((a) => a.name),
				albumArtist: it.artists?.[0]?.name ?? "",
				album: album?.title ?? "",
				durationSec: it.duration ?? 0,
			});
			if (s > bestScore) {
				bestScore = s;
				best = it;
			}
		}
		if (best && bestScore >= MIN_CONFIDENCE) {
			const album = Array.isArray(best.album) ? best.album[0] : best.album;
			result = {
				trackId: String(best.id),
				artistId: best.artists?.[0]?.id != null ? String(best.artists[0].id) : null,
				albumId: album?.id != null ? String(album.id) : null,
			};
		}
		trace.log("[bridge] TIDAL lookup", `"${t.title}"`, result ? `-> track ${result.trackId} (score ${bestScore.toFixed(2)})` : "-> not on TIDAL");
	} catch (e) {
		trace.warn("[bridge] TIDAL lookup failed:", String(e));
	}
	cache.set(t.itemId, result);
	return result;
}

export async function findTidalTrackId(t: LibraryTrack): Promise<string | null> {
	return (await findTidalTrack(t))?.trackId ?? null;
}

/** Navigate TIDAL's SPA router (e.g. "/artist/123", "/album/456"). */
export function openTidalPage(pathname: string) {
	void redux.actions["router/PUSH"]({ pathname, search: "", replace: false });
}

/** Play a TIDAL track natively; the hijack engine then swaps the audio to Jellyfin. */
export async function playTidalTrack(trackId: string) {
	await redux.actions["content/FETCH_AND_PLAY_MEDIA_ITEM"]({
		itemId: trackId,
		itemType: "track",
		sourceContext: { type: "UNKNOWN" },
	});
}
