import type { LunaUnload } from "@luna/core";
import { PlayState, Playlist, redux, safeInterval } from "@luna/lib";
import { settings } from "./settings";
import { getTrackWeight } from "./store";
import { trace } from "./trace";
import * as tidal from "./tidal";

function poolIds(): string[] {
	const elements = (PlayState.playQueue?.elements ?? []) as { mediaItemId: redux.ItemId }[];
	return [...new Set(elements.map((e) => String(e.mediaItemId)))];
}

function weightedPick(ids: string[], excludeId: string | null): string | null {
	const candidates = ids.filter((id) => id !== excludeId);
	if (candidates.length === 0) return null;
	const weights = candidates.map(getTrackWeight);
	const total = weights.reduce((a, b) => a + b, 0);
	if (total <= 0) return null;
	let r = Math.random() * total;
	for (let i = 0; i < candidates.length; i++) {
		r -= weights[i];
		if (r <= 0) return candidates[i];
	}
	return candidates[candidates.length - 1];
}

function addToQueueLast(trackId: string) {
	redux.actions["playQueue/ADD_LAST"]({ context: { type: "UNKNOWN", id: trackId }, mediaItemIds: [trackId] });
}

/** Keeps one weighted-random track queued whenever weighted playback is enabled. */
export function initWeightedLoop(unloads: Set<LunaUnload>) {
	safeInterval(
		unloads,
		() => {
			try {
				if (!settings.weightedPlaybackEnabled) return;
				const pq = PlayState.playQueue;
				if (!pq) return;
				const upcoming = (pq.elements ?? []).slice((pq.currentIndex ?? 0) + 1);
				if (upcoming.length > 0) return; // something already queued next

				const current = pq.elements?.[pq.currentIndex]?.mediaItemId;
				const pick = weightedPick(poolIds(), current != null ? String(current) : null);
				if (!pick) return;

				addToQueueLast(pick);
				if (settings.reEnqueueWorkaround) {
					setTimeout(() => {
						const stillMissing = !((PlayState.playQueue?.elements ?? []) as { mediaItemId: redux.ItemId }[]).some(
							(e) => String(e.mediaItemId) === pick,
						);
						if (stillMissing) addToQueueLast(pick);
					}, 1000);
				}
			} catch (e) {
				trace.err.withContext("weightedLoop")(e);
			}
		},
		settings.reEnqueueWorkaround ? 1500 : 700,
	);
}

/** Create a new playlist filled with `count` weighted-random picks from a source playlist. */
export async function createWeightedPlaylist(sourceUuid: string, count: number): Promise<string | null> {
	const src = await Playlist.fromId(sourceUuid);
	if (!src) return null;
	const tItems = await src.tMediaItems();
	const ids = tItems.map((i) => String((i as { item: { id: redux.ItemId } }).item.id)).filter(Boolean);
	if (ids.length === 0) return null;

	// Weighted sampling without replacement.
	const pool = ids.map((id) => ({ id, weight: getTrackWeight(id) })).filter((t) => t.weight > 0);
	const selected: string[] = [];
	for (let i = 0; i < count && pool.length > 0; i++) {
		const total = pool.reduce((a, b) => a + b.weight, 0);
		if (total <= 0) break;
		let r = Math.random() * total;
		let idx = pool.length - 1;
		for (let j = 0; j < pool.length; j++) {
			r -= pool[j].weight;
			if (r <= 0) {
				idx = j;
				break;
			}
		}
		selected.push(pool[idx].id);
		pool.splice(idx, 1);
	}
	if (selected.length === 0) return null;

	const title = `${(await src.title()) ?? "Playlist"} (Weighted ${count})`;
	const newUuid = await tidal.createPlaylistInFolder("root", title, "Weighted by Star Ratings");
	if (!newUuid) return null;
	for (const id of selected) await tidal.addTrackToPlaylist(newUuid, id);
	return newUuid;
}
