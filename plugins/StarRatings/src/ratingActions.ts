import { settings } from "./settings";
import { trace } from "./trace";
import {
	applyRating,
	clearRating,
	getMirrorPlaylistUuids,
	getTrackRating,
	hasRating,
	toRatingString,
	type RatingChange,
} from "./store";
import * as tidal from "./tidal";
import { bucketKey, whenRatedReady } from "./ratedFolder";
import { MediaItem } from "@luna/lib";

/**
 * Rate a track: update the local source-of-truth store, then run the enabled
 * side effects (favourite above threshold, mirror into the Rated playlists, ISRC sync).
 * Returns the change so the caller can repaint the UI.
 */
export async function rateTrack(trackId: string, newRating: number): Promise<RatingChange> {
	const change = applyRating(trackId, newRating);

	// --- like above threshold ---
	if (change.added && settings.likeThreshold >= 0 && newRating >= settings.likeThreshold) {
		void tidal.addToFavorites(trackId).catch(() => {});
	}

	// --- mirror into the per-rating TIDAL playlists ("Rated" folder) ---
	if (settings.syncRatedPlaylists) {
		void mirrorRatedChange(trackId, change).catch(trace.err.withContext("mirrorRatedChange"));
	}

	// --- notification ---
	if (change.toggledOff) trace.msg.log(`Removed rating`);
	else trace.msg.log(`Rated ${toRatingString(newRating)}★`);

	// --- sync all tracks sharing this ISRC ---
	if (settings.syncDuplicateSongs) {
		void syncIsrc(trackId, newRating, change.toggledOff).catch(trace.err.withContext("syncIsrc"));
	}

	return change;
}

/** Remove a rating entirely (and pull the track from its rating playlist). */
export async function unrateTrack(trackId: string) {
	const prev = getTrackRating(trackId);
	clearRating(trackId);
	trace.msg.log("Removed rating");
	if (settings.syncRatedPlaylists && prev != null) {
		void removeFromBucket(prev, trackId).catch(trace.err.withContext("unrate mirror"));
	}
}

/** Add the track to the playlist for `rating`'s bucket (waits for the load-time sync). */
async function addToBucket(rating: number, trackId: string) {
	await whenRatedReady();
	const uuid = getMirrorPlaylistUuids(parseFloat(bucketKey(rating)))[0];
	if (!uuid) return;
	await tidal.addTrackToPlaylist(uuid, trackId);
}

/** Remove the track from the playlist for `rating`'s bucket (waits for the load-time sync). */
async function removeFromBucket(rating: number, trackId: string) {
	await whenRatedReady();
	const uuid = getMirrorPlaylistUuids(parseFloat(bucketKey(rating)))[0];
	if (!uuid) return;
	const idx = await tidal.findTrackIndex(uuid, trackId);
	if (idx >= 0) await tidal.removeTrackFromPlaylist(uuid, idx);
}

/**
 * Reflect a rating change in the playlists: drop the track from its previous bucket
 * (on re-rate or toggle-off) and add it to the new one. Correct for the default
 * (non-averaging) model; with averaging on this mirrors per-entry, best-effort.
 */
async function mirrorRatedChange(trackId: string, change: RatingChange) {
	if (change.removed) await removeFromBucket(change.removed.rating, trackId);
	if (change.added) await addToBucket(change.added.rating, trackId);
}

async function syncIsrc(trackId: string, rating: number, toggledOff: boolean) {
	const item = await MediaItem.fromId(trackId);
	const isrc = await item?.isrc();
	if (!isrc) return;
	const ids = await tidal.getTrackIdsWithSameIsrc(isrc);
	for (const id of ids) {
		if (id === trackId) continue;
		if (toggledOff) {
			if (hasRating(id)) {
				const prev = getTrackRating(id);
				clearRating(id);
				if (settings.syncRatedPlaylists && prev != null) void removeFromBucket(prev, id).catch(() => {});
			}
		} else {
			const dupChange = applyRating(id, rating);
			if (settings.syncRatedPlaylists) void mirrorRatedChange(id, dupChange).catch(() => {});
		}
	}
}
