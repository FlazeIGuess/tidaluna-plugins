import type { LunaUnload } from "@luna/core";
import * as tidal from "./tidal";
import { ratedTrackCount, seedRatings, setMirrorPlaylistUuids, setRatedFolderId, toRatingString } from "./store";
import { settings } from "./settings";
import { trace } from "./trace";

/**
 * On load, keep a TIDAL "Rated" folder in sync with the local ratings:
 *   1. find the folder (create it if missing),
 *   2. register the per-rating playlists 0.0-5.0 (create any that are missing),
 *   3. once, seed the local source-of-truth from whatever those playlists already contain.
 * After this, rating a track mirrors it into the matching playlist (see ratingActions.ts).
 *
 * Hardening (learned the hard way): a failed/racy read must NEVER be mistaken for an
 * empty playlist, and `_ratedImported` is only set once the import genuinely succeeds -
 * otherwise the import would permanently disable itself after a startup race.
 */

const FOLDER_NAME = "Rated";

/** The 11 rating buckets (0.5 steps, 0.0-5.0), i.e. the playlist names inside "Rated". */
export const RATING_BUCKETS = ["0.0", "0.5", "1.0", "1.5", "2.0", "2.5", "3.0", "3.5", "4.0", "4.5", "5.0"];

let readyPromise: Promise<void> | null = null;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Round any rating to its 0.5 bucket key ("0.0".."5.0"). */
export function bucketKey(rating: number): string {
	const clamped = Math.max(0, Math.min(5, Math.round(rating * 2) / 2));
	return clamped.toFixed(1);
}

/** Find the Rated folder id, creating it if missing. Returns null if the session isn't ready. */
async function ensureFolder(): Promise<string | null> {
	let folders: tidal.FolderEntry[];
	try {
		({ folders } = await tidal.listFolder("root"));
	} catch {
		return null; // read failed (session not ready?) - don't risk creating a duplicate folder
	}
	const found = folders.find((f) => f.name === FOLDER_NAME);
	if (found) {
		setRatedFolderId(found.id);
		return found.id;
	}
	trace.log("Rated: folder missing, creating it");
	const created = await tidal.createFolder(FOLDER_NAME);
	if (created) setRatedFolderId(created);
	return created;
}

/**
 * Seed local ratings from a rating playlist. Returns false if the read failed or came
 * back suspiciously empty for a playlist that should have tracks (so the caller won't
 * mark the whole import as complete).
 */
async function importPlaylist(playlistUuid: string, rating: number, expectedCount: number): Promise<boolean> {
	let tracks: tidal.PlaylistTrack[];
	try {
		tracks = await tidal.getPlaylistTracks(playlistUuid);
	} catch {
		return false; // read failed
	}
	if (expectedCount > 0 && tracks.length === 0) return false; // race / partial read
	const added = seedRatings(
		tracks.map((t) => t.id),
		rating,
	);
	if (added) trace.log(`Rated: imported ${added} track(s) @ ${toRatingString(rating)}`);
	return true;
}

/**
 * Reconcile the folder + playlists (and, once, import their tracks).
 * Returns true only when everything succeeded, so the caller can retry on failure.
 */
export async function syncRatedFolder(): Promise<boolean> {
	const folderId = await ensureFolder();
	if (!folderId) {
		trace.warn("Rated: folder not ready yet - will retry");
		return false;
	}

	let playlists: tidal.PlaylistEntry[];
	try {
		({ playlists } = await tidal.listFolder(folderId));
	} catch {
		trace.warn("Rated: could not list folder contents - will retry");
		return false;
	}

	const byName = new Map(playlists.map((p) => [p.name, p]));
	// Import when we've never imported OR the local store is empty (fresh install,
	// reinstall, or a wiped/corrupt store) - this is what makes it self-heal.
	const doImport = !settings._ratedImported || ratedTrackCount() === 0;
	let allOk = true;

	for (const key of RATING_BUCKETS) {
		const existing = byName.get(key);
		let uuid = existing?.uuid;
		if (!uuid) {
			uuid = (await tidal.createPlaylistInFolder(folderId, key, "Star Ratings")) ?? undefined;
			if (uuid) trace.log(`Rated: created missing playlist "${key}"`);
			else {
				trace.warn(`Rated: failed to create playlist "${key}"`);
				allOk = false;
				continue;
			}
		}
		setMirrorPlaylistUuids(parseFloat(key), [uuid]);
		if (doImport && existing && existing.numberOfTracks > 0) {
			const ok = await importPlaylist(uuid, parseFloat(key), existing.numberOfTracks);
			if (!ok) allOk = false;
		}
	}

	if (doImport && allOk) {
		settings._ratedImported = true;
		trace.msg.log("Rated: initial import from TIDAL playlists complete");
	} else if (doImport) {
		trace.warn("Rated: import incomplete - will retry on next load");
	}
	return allOk;
}

/** Kick off the sync in the background, retrying a few times if the session isn't ready yet. */
export function initRatedFolder(_unloads: Set<LunaUnload>) {
	if (!settings.syncRatedPlaylists) return;
	readyPromise = (async () => {
		for (let attempt = 0; attempt < 6; attempt++) {
			try {
				if (await syncRatedFolder()) return;
			} catch (e) {
				trace.err.withContext("syncRatedFolder")(e);
			}
			await delay(4000); // let the session settle, then retry
		}
		trace.warn("Rated: gave up syncing after several attempts");
	})();
}

/** Resolves once the load-time sync has finished (so mirror writes hit registered playlists). */
export function whenRatedReady(): Promise<void> {
	return readyPromise ?? Promise.resolve();
}
