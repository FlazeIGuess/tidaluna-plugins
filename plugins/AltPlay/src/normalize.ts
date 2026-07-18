import type { TrackMeta } from "./providers/types";

/** Normalise a title/artist for comparison: lowercase, strip diacritics, feat./remaster tails, punctuation. */
export function norm(s: string | null | undefined): string {
	return (s ?? "")
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "") // combining diacritics
		.replace(/\((feat|ft|with)\.?[^)]*\)|\[(feat|ft|with)\.?[^\]]*\]/g, "") // (feat. ...)
		.replace(/\s*-\s*(remaster(ed)?|remix|radio edit|live|mono|stereo|single|album)\b.*$/i, "")
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

export type Candidate = {
	name: string;
	artists: string[];
	albumArtist: string;
	album: string;
	durationSec: number;
};

/**
 * Strict match score (0 = reject, up to 1). Requires an equal/contained title, an
 * overlapping artist, and a close duration - so we don't play the wrong song.
 */
export function scoreCandidate(track: TrackMeta, cand: Candidate): number {
	const t1 = norm(track.title);
	const t2 = norm(cand.name);
	if (!t1 || !t2) return 0;
	const titleMatch = t1 === t2 || t2.includes(t1) || t1.includes(t2);
	if (!titleMatch) return 0;

	const trackArtists = track.artists.map(norm).filter(Boolean);
	const candArtists = [cand.albumArtist, ...(cand.artists ?? [])].map(norm).filter(Boolean);
	const artistMatch =
		trackArtists.length > 0 && candArtists.length > 0 && trackArtists.some((a) => candArtists.some((b) => a === b || a.includes(b) || b.includes(a)));
	if (!artistMatch) return 0;

	const durDiff = track.durationSec && cand.durationSec ? Math.abs(track.durationSec - cand.durationSec) : 99;
	if (durDiff > 7) return 0; // strict tolerance

	let c = 0.6;
	if (t1 === t2) c += 0.2;
	if (durDiff <= 2) c += 0.15;
	const al = norm(track.album);
	if (al && al === norm(cand.album)) c += 0.05;
	return Math.min(1, c);
}
