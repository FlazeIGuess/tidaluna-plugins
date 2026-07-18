/** Minimal, provider-agnostic description of the TIDAL track we want to match. */
export type TrackMeta = {
	tidalId: string;
	isrc: string | null;
	title: string;
	artists: string[];
	album: string | null;
	durationSec: number;
};

/** A resolved match on a provider, ready to be streamed. */
export type ProviderMatch = {
	providerId: string;
	itemId: string; // provider-specific item id
	title: string;
	streamUrl: string; // directly playable in an <audio> element
	confidence: number; // 0..1
};

export type ConnectResult = { ok: true; userName: string } | { ok: false; error: string };

/** Audio quality of a provider stream (for the indicator). */
export type StreamQuality = {
	codec?: string;
	container?: string;
	bitrateKbps?: number;
	sampleRateHz?: number;
	bitDepth?: number;
	channels?: number;
};

/** One track of a provider's library, as stored in the local AltPlay index. */
export type LibraryTrack = {
	providerId: string;
	itemId: string;
	title: string;
	artists: string[];
	albumArtist: string;
	album: string;
	durationSec: number;
	quality: StreamQuality | null;
	imageUrl: string | null;
};

export type LibraryPage = { items: LibraryTrack[]; total: number };

/**
 * A playback source (Jellyfin today; Plex/Navidrome/... later). The core engine is
 * written against this interface only - nothing is Jellyfin-specific outside its folder.
 */
export interface SourceProvider {
	id: string;
	label: string;

	// --- auth (Step 1) ---
	isAuthenticated(): boolean;
	currentUser(): string | null;
	connect(serverUrl: string, username: string, password: string): Promise<ConnectResult>;
	disconnect(): void;

	// --- matching + streaming (Step 2/3) ---
	match?(track: TrackMeta): Promise<ProviderMatch | null>;
	streamUrl?(match: ProviderMatch): string;
	streamInfo?(match: ProviderMatch): Promise<StreamQuality | null>;

	// --- library index (row markers + AltPlay library page) ---
	listLibrary?(startIndex: number, limit: number): Promise<LibraryPage>;
}
