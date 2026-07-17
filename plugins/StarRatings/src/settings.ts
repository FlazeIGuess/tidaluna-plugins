import { ReactiveStore } from "@luna/core";

export type PlayMode = "all" | "onlyrated" | "onlyunrated";
export type WeightKind = "Linear" | "Exponential";
export type StarsPosition = "left" | "right";

/**
 * User-facing settings. Persisted reactively in IndexedDB by Luna.
 * `-1` on the threshold fields means "disabled" (ratings are always 0.5-5).
 */
export const settings = await ReactiveStore.getPluginStorage("StarRatings", {
	// --- display ---
	halfStarRatings: true,
	quarterStarRatings: false,
	showExactRating: false,
	showPlaylistStars: true,
	nowPlayingStarsPosition: "left" as StarsPosition, // "left" = next to the favourite button
	colorStarsByQuality: true, // HiRes tracks -> gold stars, everything else -> turquoise
	showAlbumAverage: true, // show the average rating on album headers, coloured by quality

	// --- rating behaviour ---
	defaultRating: 3,
	averageRatings: false,
	likeThreshold: -1, // >= this rating -> add to TIDAL favourites. -1 = off
	skipThreshold: -1, // <= this rating -> auto-skip on songchange. -1 = off
	play: "all" as PlayMode, // "onlyrated" / "onlyunrated" auto-skip filters
	syncDuplicateSongs: false, // mirror rating to all tracks sharing an ISRC
	enableKeyboardShortcuts: true, // Ctrl+Alt+Numpad0-9 rate now-playing

	// --- weighted playback / playlists ---
	weightKind: "Linear" as WeightKind,
	weightBase: 2, // used when weightKind === "Exponential"
	reEnqueueWorkaround: false, // re-add weighted track after 1s (remote-play fix)
	weightedPlaylistSize: 50, // track count for "Create weighted playlist"
	weightedPlaybackEnabled: false, // weighted playback for the current context

	// --- "Rated" folder: keep TIDAL playlists 0.0-5.0 in sync with local ratings ---
	syncRatedPlaylists: true, // find/create the Rated folder + its per-rating playlists, mirror on rate

	// internal: one-time flags
	_posMigrated: false,
	_ratedImported: false, // seed local ratings from the TIDAL playlists once
});

// Early builds defaulted the now-playing position to "right" and persisted it.
// Force existing installs to the intended "left" once; users can still switch back.
if (!settings._posMigrated) {
	settings.nowPlayingStarsPosition = "left";
	settings._posMigrated = true;
}

export type Settings = typeof settings;

/** Convenience: resolves the effective per-star granularity. */
export const ratingStep = () => (settings.quarterStarRatings ? 0.25 : settings.halfStarRatings ? 0.5 : 1);
