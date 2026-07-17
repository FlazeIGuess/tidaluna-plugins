import { ReactiveStore } from "@luna/core";
import { settings } from "./settings";
import { emitRatingChanged } from "./events";

export type RatingEntry = { rating: number; time: number; uid: string };
export type Ratings = Record<string, RatingEntry[]>;

type Persisted = {
	ratings: Ratings;
	playlistUuids: Record<string, string[]>; // rating string ("5.0") -> TIDAL playlist UUIDs
	weightedContexts: Record<string, boolean>; // context id -> weighted-playback flag
	ratedFolderId: string; // TIDAL "Rated" folder id, resolved/created on load
};

const DEFAULTS: Persisted = { ratings: {}, playlistUuids: {}, weightedContexts: {}, ratedFolderId: "" };

/**
 * Persistence, made bulletproof.
 *
 * `ReactiveStore` writes to IndexedDB by structured-cloning the oby reactive object.
 * Storing nested objects/arrays there means oby wraps them in Proxies, and IndexedDB
 * *cannot structured-clone a Proxy* -> `DataCloneError` -> the write silently fails and
 * NOTHING persists (ratings vanish after every reload / reinstall).
 *
 * So we keep the reactive store holding a single **JSON string** (always cloneable) and
 * work against a plain in-memory object (`data`). No Proxies ever reach IndexedDB.
 * A fresh install starts empty and re-imports from the "Rated" folder playlists.
 */
const store = await ReactiveStore.getPluginStorage("StarRatings.v2", { blob: "" });

/** Plain, in-memory source of truth (never a reactive Proxy). */
export const data: Persisted = (() => {
	try {
		if (store.blob) return { ...DEFAULTS, ...(JSON.parse(store.blob) as Partial<Persisted>) };
	} catch {
		/* corrupt blob - start fresh */
	}
	return structuredClone(DEFAULTS);
})();

/** Serialise the whole state to the single string field. Strings clone fine. */
function persist() {
	store.blob = JSON.stringify(data);
}

const HALF_LIFE_MS = 6 * (365.25 / 12) * 24 * 60 * 60 * 1000; // 6 months
const FIVE_MIN = 5 * 60 * 1000;

const makeUid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Canonical string key for a rating. 0.5-steps -> 1 decimal, quarter-steps -> 2. */
export function toRatingString(rating: number): string {
	if ((rating * 100) % 50 === 0) return rating.toFixed(1);
	return rating.toFixed(2);
}

export function hasRating(trackId: string): boolean {
	return Array.isArray(data.ratings[trackId]) && data.ratings[trackId].length > 0;
}

/** Number of tracks with at least one rating (used to detect an empty/reset store). */
export function ratedTrackCount(): number {
	return Object.keys(data.ratings).length;
}

/** Time-weighted average of the full rating history (half-life 6 months), or null. */
export function getTrackRating(trackId: string): number | null {
	const entries = data.ratings[trackId];
	if (!entries || entries.length === 0) return null;

	let weightedSum = 0;
	let weightSum = 0;
	const now = Date.now();
	for (const { rating, time } of entries) {
		const weight = Math.pow(0.5, (now - time) / HALF_LIFE_MS);
		weightedSum += rating * weight;
		weightSum += weight;
	}
	return weightSum === 0 ? null : weightedSum / weightSum;
}

export function getTrackRatingOrDefault(trackId: string): number {
	return getTrackRating(trackId) ?? settings.defaultRating;
}

/** Playback weight derived from the (defaulted) rating. */
export function getTrackWeight(trackId: string): number {
	const rating = getTrackRatingOrDefault(trackId);
	return settings.weightKind === "Exponential" ? Math.pow(settings.weightBase, rating) : rating;
}

function writeEntries(trackId: string, entries: RatingEntry[]) {
	if (entries.length === 0) delete data.ratings[trackId];
	else data.ratings[trackId] = entries;
	persist();
	emitRatingChanged(trackId); // notify every visible star widget for this track
}

export type RatingChange = { removed: RatingEntry | null; added: RatingEntry | null; toggledOff: boolean };

/**
 * Apply a click/keyboard rating. Mirrors the original 5-minute-window semantics:
 * - averaging on: re-rates within 5 min behave non-averaged; older history is kept.
 * - averaging off: a single entry is kept; same rating toggles off, different replaces.
 */
export function applyRating(trackId: string, newRating: number): RatingChange {
	const now = Date.now();
	const arr = [...(data.ratings[trackId] ?? [])];
	const old = settings.averageRatings ? (arr.find((r) => now - r.time <= FIVE_MIN) ?? null) : (arr[0] ?? null);

	let next = arr;
	if (old) next = next.filter((r) => r.uid !== old.uid);

	const toggledOff = !!old && old.rating === newRating;
	let added: RatingEntry | null = null;
	if (!toggledOff) {
		added = { rating: newRating, time: now, uid: makeUid() };
		next = [...next, added];
	}

	writeEntries(trackId, next);
	return { removed: old, added, toggledOff };
}

/** Remove all ratings for a track. */
export function clearRating(trackId: string) {
	writeEntries(trackId, []);
}

/**
 * Bulk-seed ratings for tracks that have none yet (used by the folder import).
 * Persists once at the end and returns how many were newly added. Never overwrites.
 */
export function seedRatings(trackIds: string[], rating: number): number {
	const now = Date.now();
	let added = 0;
	for (const id of trackIds) {
		if (data.ratings[id]?.length) continue; // keep any existing rating
		data.ratings[id] = [{ rating, time: now, uid: makeUid() }];
		added++;
	}
	if (added > 0) {
		persist();
		for (const id of trackIds) emitRatingChanged(id);
	}
	return added;
}

/** UUIDs of the mirror playlists registered for a given rating. */
export function getMirrorPlaylistUuids(rating: number): string[] {
	return data.playlistUuids[toRatingString(rating)] ?? [];
}

export function setMirrorPlaylistUuids(rating: number, uuids: string[]) {
	data.playlistUuids[toRatingString(rating)] = [...uuids];
	persist();
}

export function getRatedFolderId(): string {
	return data.ratedFolderId;
}

export function setRatedFolderId(id: string) {
	data.ratedFolderId = id;
	persist();
}

export function isWeightedEnabled(contextId: string | null | undefined): boolean {
	if (!contextId) return false;
	return !!data.weightedContexts[contextId];
}

export function setWeightedEnabled(contextId: string, enabled: boolean) {
	data.weightedContexts[contextId] = enabled;
	persist();
}
