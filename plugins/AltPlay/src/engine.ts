import type { LunaUnload } from "@luna/core";
import { MediaItem, PlayState, safeInterval } from "@luna/lib";
import { findMatch, trackMetaFromTidalItem } from "./match";
import type { ProviderMatch, StreamQuality } from "./providers/types";
import { getProvider } from "./providers/registry";
import { clearBadge, reassertBadge, showQuality } from "./badge";
import { bucketFor } from "./format";
import { proxiedStreamUrl } from "./proxy.native";
import { getSession, setSession } from "./session";
import { settings } from "./settings";
import { getTrackOverride, setTrackOverride } from "./store";
import { trace } from "./trace";

/**
 * The playback engine. On each track change it finds a provider match and, if enabled
 * (globally + per-song), "hijacks" playback: TIDAL's own media element is muted (TIDAL
 * keeps the queue, progress, scrobble and transitions) while the provider stream plays
 * in a plugin-owned <audio> kept in sync with TIDAL's clock. State is published via
 * session.ts for the badge marker and overlay.
 */

const JF_AUDIO_ID = "altplay-audio";
const LIB_AUDIO_ID = "altplay-lib-audio"; // the library page's own player element
const DRIFT_TOLERANCE = 0.75;
const BUFFER_HOLDBACK = 0.6; // max seconds TIDAL's clock may run ahead while the stream buffers

let currentTrackId: string | null = null;
let currentTidalTier: 0 | 1 | 2 = 0; // lossy < lossless < hi-res, for the quality gate

let tidalEl: HTMLMediaElement | null = null;
let jfAudio: HTMLAudioElement | null = null;
let hijackedTrackId: string | null = null;

// --- enable logic (global default + per-track override) ---
export const isGlobalEnabled = (): boolean => settings.autoPlay;
export const isSongEnabled = (trackId: string): boolean => getTrackOverride(trackId) ?? settings.autoPlay;

// --- quality tiers (for the "only replace when better" option) ---

/** TIDAL side: what actually streams right now (falls back to the track's best). */
function computeTidalTier(tidalItem: any): 0 | 1 | 2 {
	const actual: string | undefined = (PlayState as any)?.playbackContext?.actualAudioQuality ?? undefined;
	const q: string = actual ?? tidalItem?.audioQuality ?? "";
	const tags: string[] = tidalItem?.mediaMetadata?.tags ?? [];
	if (q === "HI_RES_LOSSLESS" || q === "HI_RES" || (!actual && tags.includes("HIRES_LOSSLESS"))) return 2;
	if (q === "LOSSLESS" || (!actual && tags.includes("LOSSLESS"))) return 1;
	return 0;
}

/** Jellyfin side: reuse the badge's bucket logic (lossy / lossless / hi-res). */
function jfTier(q: StreamQuality | null): 0 | 1 | 2 {
	if (!q) return 0;
	const b = bucketFor(q);
	return b === "max" ? 2 : b === "high" ? 1 : 0;
}

export function findTidalMediaEl(): HTMLMediaElement | null {
	const els = Array.from(document.querySelectorAll<HTMLMediaElement>("audio,video")).filter(
		(e) => e.id !== JF_AUDIO_ID && e.id !== LIB_AUDIO_ID && (e.currentSrc || e.src),
	);
	return els.find((e) => !e.paused) ?? els[0] ?? null;
}

function providerAudio(): HTMLAudioElement {
	if (jfAudio) return jfAudio;
	const a = new Audio();
	a.id = JF_AUDIO_ID;
	a.preload = "auto";
	a.addEventListener("error", () => {
		trace.warn("Provider stream error - falling back to TIDAL audio", a.error?.message ?? "");
		stopHijack();
	});
	jfAudio = a;
	return a;
}

const HIJACK_RETRY_MS = 400;
const HIJACK_MAX_RETRIES = 25; // ~10s

/** Effective per-song state incl. the quality gate - what the overlay toggle shows. */
export const isSongEffective = (trackId: string): boolean => hijackWanted(trackId);

/** Should this track be hijacked right now (match + enabled + quality gate)? */
function hijackWanted(id: string): boolean {
	const { match, quality } = getSession();
	if (!match || !isSongEnabled(id)) return false;
	if (settings.onlyBetterQuality && getTrackOverride(id) !== true && jfTier(quality) <= currentTidalTier) return false;
	return true;
}

async function startHijack(id: string, match: ProviderMatch, attempt = 0) {
	if (hijackedTrackId === id) return;
	const el = findTidalMediaEl();
	if (!el) {
		// TIDAL recreates its media element between tracks (especially after our
		// content/FETCH_AND_PLAY in native library mode) - retry until it shows up.
		if (attempt === 0) trace.log("Hijack: no TIDAL media element yet - retrying");
		if (attempt >= HIJACK_MAX_RETRIES) {
			trace.warn("Hijack: gave up waiting for TIDAL media element");
			return;
		}
		setTimeout(() => {
			if (currentTrackId !== id || hijackedTrackId === id || !hijackWanted(id)) return;
			void startHijack(id, match, attempt + 1);
		}, HIJACK_RETRY_MS);
		return;
	}
	// Stream through the native localhost proxy - the renderer's own requests to
	// the media server can stall indefinitely (see proxy.native.ts).
	let url = match.streamUrl;
	try {
		url = await proxiedStreamUrl(match.streamUrl);
	} catch (e) {
		trace.warn("Proxy setup failed, falling back to direct URL:", String(e));
	}
	if (currentTrackId !== id || hijackedTrackId === id) return; // track changed while awaiting

	tidalEl = el;
	el.muted = true;
	const a = providerAudio();
	a.src = url;
	a.volume = el.volume;
	try {
		a.currentTime = isFinite(el.currentTime) ? el.currentTime : 0;
	} catch {
		/* not seekable yet */
	}
	// AbortError just means a newer load interrupted this play() - not a real failure.
	if (!el.paused) a.play().catch((e) => e?.name !== "AbortError" && trace.warn("provider play() failed", String(e)));
	hijackedTrackId = id;
	trace.msg.log(`Playing from ${match.providerId}`);
	// Update badge/session here too, so hijacks that engaged via retry surface correctly.
	const { quality } = getSession();
	if (quality) showQuality(quality);
	setSession({ hijacked: true });
}

function stopHijack() {
	if (tidalEl) {
		try {
			tidalEl.muted = false;
		} catch {
			/* gone */
		}
		tidalEl = null;
	}
	if (jfAudio) {
		try {
			jfAudio.pause();
			jfAudio.removeAttribute("src");
			jfAudio.load();
		} catch {
			/* ignore */
		}
	}
	clearBadge();
	hijackedTrackId = null;
	setSession({ hijacked: false });
}

/** Keep the provider audio locked to TIDAL's clock/state. */
function sync() {
	if (!hijackedTrackId || !tidalEl || !jfAudio) return;
	if (!tidalEl.muted) tidalEl.muted = true;
	jfAudio.volume = tidalEl.volume;
	if (tidalEl.paused && !jfAudio.paused) jfAudio.pause();
	else if (!tidalEl.paused && jfAudio.paused) jfAudio.play().catch(() => {});

	if (isFinite(tidalEl.currentTime)) {
		// Provider stream is buffering: hold TIDAL's clock back so the displayed time
		// doesn't run ahead of the audio (seeking the stream forward afterwards would
		// skip whatever was still loading).
		const buffering = !jfAudio.paused && jfAudio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
		if (buffering) {
			if (isFinite(jfAudio.currentTime) && tidalEl.currentTime - jfAudio.currentTime > BUFFER_HOLDBACK) {
				try {
					tidalEl.currentTime = Math.max(0, jfAudio.currentTime);
				} catch {
					/* ignore */
				}
			}
		} else {
			const drift = Math.abs(jfAudio.currentTime - tidalEl.currentTime);
			if (drift > DRIFT_TOLERANCE) {
				try {
					jfAudio.currentTime = tidalEl.currentTime;
				} catch {
					/* ignore */
				}
			}
		}
	}
	reassertBadge();
}

/** Apply the current match + enable state: start/stop the hijack and update the badge. */
function reevaluate() {
	const id = currentTrackId;
	if (!id) return;
	const { match, quality } = getSession();
	const enabled = hijackWanted(id);

	// Explain when the quality gate (not the user) blocked the replacement.
	if (match && !enabled && isSongEnabled(id) && settings.onlyBetterQuality)
		trace.log(`[quality-gate] keeping TIDAL audio (TIDAL tier ${currentTidalTier} >= Jellyfin tier ${jfTier(quality)})`);

	if (match && enabled) {
		void startHijack(id, match).then(() => {
			if (currentTrackId !== id) return;
			const { quality } = getSession();
			if (hijackedTrackId === id && quality) showQuality(quality);
			setSession({ hijacked: hijackedTrackId === id });
		});
	} else if (hijackedTrackId === id) {
		stopHijack();
		setSession({ hijacked: false });
	} else {
		setSession({ hijacked: hijackedTrackId === id });
	}
}

async function onTransition(item: { id: string | number; tidalItem?: any }) {
	const id = String(item.id);
	currentTrackId = id;
	currentTidalTier = computeTidalTier(item.tidalItem);
	const track = trackMetaFromTidalItem(item.id, item.tidalItem);
	if (hijackedTrackId && hijackedTrackId !== id) stopHijack();
	setSession({ trackId: id, title: track.title, artist: track.artists.join(", "), match: null, quality: null, hijacked: false, libraryMode: false });

	const match = await findMatch(track).catch(() => null);
	if (currentTrackId !== id) return;
	setSession({ match });

	if (match) {
		const quality = (await getProvider(match.providerId)?.streamInfo?.(match).catch(() => null)) ?? null;
		if (currentTrackId !== id) return;
		setSession({ quality });
	}
	reevaluate();
}

/** Fully release the hijack (used by the library player before it takes over audio). */
export function releaseHijack() {
	stopHijack();
}

// --- actions used by the overlay switches ---
export function setGlobalEnabled(on: boolean) {
	settings.autoPlay = on;
	reevaluate();
}

export function setSongEnabled(trackId: string, on: boolean) {
	setTrackOverride(trackId, on);
	if (trackId === currentTrackId) reevaluate();
}

export function initEngine(unloads: Set<LunaUnload>) {
	MediaItem.onMediaTransition(unloads, (item) => void onTransition(item as any));
	MediaItem.fromPlaybackContext()
		.then((item) => item && onTransition(item as any))
		.catch(() => {});
	safeInterval(unloads, sync, 300);
	unloads.add(stopHijack);
}
