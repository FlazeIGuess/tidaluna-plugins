import type { LunaUnload } from "@luna/core";
import { safeInterval } from "@luna/lib";
import type { LibraryTrack, TrackMeta } from "./providers/types";
import { activeProviders } from "./providers/registry";
import { getLibraryCache, setLibraryCache } from "./store";
import { norm } from "./normalize";
import { trace } from "./trace";

/**
 * Local index of the provider's full music library. Synced once (then periodically),
 * persisted, and used for: instant row markers in track lists, fast hijack matching
 * without per-song server searches, and the AltPlay library page.
 */

type Indexed = LibraryTrack & { _t: string; _as: string[]; _al: string };

const PAGE_SIZE = 300;
const RESYNC_AFTER = 30 * 60_000; // background refresh when older than 30 min

let tracks: Indexed[] = [];
let syncedAt = 0;
let syncing = false;

const listeners = new Set<() => void>();
const emit = () => {
	for (const l of listeners) {
		try {
			l();
		} catch {
			/* ignore listener errors */
		}
	}
};

/** Subscribe to index changes (sync started/finished). Returns an unsubscribe fn. */
export function onLibrary(cb: () => void): () => void {
	listeners.add(cb);
	return () => listeners.delete(cb);
}

export const libraryTracks = (): readonly LibraryTrack[] => tracks;
export const libraryCount = (): number => tracks.length;
export const librarySyncedAt = (): number => syncedAt;
export const isSyncing = (): boolean => syncing;
export const hasLibrary = (): boolean => tracks.length > 0;

function buildIndex(list: LibraryTrack[]) {
	tracks = list.map((t) => ({
		...t,
		_t: norm(t.title),
		_as: [t.albumArtist, ...t.artists].map(norm).filter(Boolean),
		_al: norm(t.album),
	}));
}

/** Fetch the full library from the first provider that supports it. */
export async function syncLibrary(force = false): Promise<void> {
	if (syncing) return;
	const provider = activeProviders().find((p) => p.listLibrary);
	if (!provider) return;
	if (!force && tracks.length && Date.now() - syncedAt < RESYNC_AFTER) return;

	syncing = true;
	emit();
	try {
		const all: LibraryTrack[] = [];
		let start = 0;
		let total = Infinity;
		while (start < total && start < 100_000) {
			const page = await provider.listLibrary!(start, PAGE_SIZE);
			if (!page.items.length) break;
			all.push(...page.items);
			total = page.total || all.length;
			start += page.items.length;
		}
		buildIndex(all);
		syncedAt = Date.now();
		setLibraryCache({ providerId: provider.id, syncedAt, tracks: all });
		trace.log(`Library index synced: ${all.length} tracks from ${provider.label}`);
	} catch (e) {
		trace.warn("Library sync failed:", String(e));
	} finally {
		syncing = false;
		emit();
	}
}

/**
 * Match a TIDAL track against the local index. Same strict rules as normalize.ts's
 * scoreCandidate, but against precomputed normalised fields so a full scan stays cheap.
 */
export function findInLibrary(track: TrackMeta): { item: LibraryTrack; confidence: number } | null {
	if (!tracks.length) return null;
	const t1 = norm(track.title);
	if (!t1) return null;
	const tArtists = track.artists.map(norm).filter(Boolean);
	const tAlbum = norm(track.album);

	let best: Indexed | null = null;
	let bestScore = 0;
	for (const c of tracks) {
		const t2 = c._t;
		if (!t2) continue;
		if (!(t1 === t2 || t2.includes(t1) || t1.includes(t2))) continue;
		if (!(tArtists.length && c._as.length && tArtists.some((a) => c._as.some((b) => a === b || a.includes(b) || b.includes(a))))) continue;
		const durDiff = track.durationSec && c.durationSec ? Math.abs(track.durationSec - c.durationSec) : 99;
		if (durDiff > 7) continue; // strict tolerance
		let s = 0.6;
		if (t1 === t2) s += 0.2;
		if (durDiff <= 2) s += 0.15;
		if (tAlbum && tAlbum === c._al) s += 0.05;
		if (s > bestScore) {
			bestScore = s;
			best = c;
		}
	}
	return best && bestScore >= 0.6 ? { item: best, confidence: Math.min(1, bestScore) } : null;
}

export function initLibrary(unloads: Set<LunaUnload>) {
	const cached = getLibraryCache();
	if (cached?.tracks?.length) {
		buildIndex(cached.tracks);
		syncedAt = cached.syncedAt ?? 0;
		emit();
	}
	void syncLibrary();
	safeInterval(unloads, () => void syncLibrary(), 10 * 60_000);
}
