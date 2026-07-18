import type { LunaUnload } from "@luna/core";
import { MediaItem, safeInterval } from "@luna/lib";
import type { LibraryTrack, ProviderMatch } from "./providers/types";
import { getProvider } from "./providers/registry";
import { findTidalMediaEl, releaseHijack } from "./engine";
import { clearBadge, showQuality } from "./badge";
import { setSession } from "./session";
import { bucketFor, TIER_COLOR } from "./format";
import { probeStream } from "./providers/jellyfin/jellyfin.native"; // diagnostics only
import { proxiedStreamUrl } from "./proxy.native";
import { findTidalTrackId, playTidalTrack } from "./tidalbridge";
import { trace } from "./trace";

/**
 * Plays library-page tracks "like any other song": TIDAL is paused, the provider
 * stream plays in our own <audio>, and the footer player is taken over - title,
 * artist, artwork, time labels, play/pause and the progress bar are overlaid with
 * AltPlay-driven chrome, and next/previous move through the library queue.
 * Everything is restored the moment the takeover stops.
 */

const AUDIO_ID = "altplay-lib-audio";

let audio: HTMLAudioElement | null = null;
let active = false;
let queue: LibraryTrack[] = [];
let pos = -1;

// Overlaid chrome + saved footer state for restore.
let playOverlay: HTMLDivElement | null = null;
let barOverlay: HTMLDivElement | null = null;
let barFill: HTMLDivElement | null = null;
let barKnob: HTMLDivElement | null = null;
let hiddenBarInner: HTMLElement | null = null;
let saved: { title: string; artist: string; imgSrc: string; imgSrcset: string; imgSizes: string } | null = null;

const qs = <T extends HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);

/** 1x1 transparent GIF - shown when a library track has no cover art. */
const BLANK_IMG = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/**
 * Update text WITHOUT replacing React's nodes. textContent/innerHTML destroy the
 * nodes React tracks - its next re-render then crashes with a removeChild
 * NotFoundError ("Seite nicht gefunden"). Text nodes get their nodeValue mutated;
 * element children (e.g. the artist rendered as links) are hidden via style (safe)
 * and our own span is shown instead.
 */
function setText(el: HTMLElement | null, text: string) {
	if (!el) return;
	const n = el.firstChild;
	if (n && n.nodeType === Node.TEXT_NODE) {
		if (n.nodeValue !== text) n.nodeValue = text;
		return;
	}
	if (!n) {
		el.appendChild(document.createTextNode(text));
		return;
	}
	// React renders elements in here: hide them and show our own span.
	for (const child of Array.from(el.children) as HTMLElement[]) {
		if (child.classList.contains("altplay-footer-text")) continue;
		if (child.style.display !== "none") {
			child.style.display = "none";
			child.setAttribute("data-altplay-ft-hidden", "1");
		}
	}
	let mine = el.querySelector<HTMLElement>(":scope > .altplay-footer-text");
	if (!mine) {
		mine = document.createElement("span");
		mine.className = "altplay-footer-text";
		el.appendChild(mine);
	}
	if (mine.textContent !== text) mine.textContent = text;
}

/** Undo setText: drop our spans, unhide React's original elements, restore text nodes. */
function restoreText(el: HTMLElement | null, text: string) {
	const n = el?.firstChild;
	if (el && n && n.nodeType === Node.TEXT_NODE) n.nodeValue = text;
}

/** Stream URLs carry the api_key - never log it. */
const redact = (url: string): string => url.replace(/api_key=[^&]+/, "api_key=***");

const current = (): LibraryTrack | null => (pos >= 0 && pos < queue.length ? queue[pos] : null);
export const isLibraryActive = (): boolean => active;
export const currentLibraryItemId = (): string | null => (active ? (current()?.itemId ?? null) : null);

function ensureAudio(): HTMLAudioElement {
	if (audio) return audio;
	const a = new Audio();
	a.id = AUDIO_ID;
	a.preload = "auto";
	// Diagnostic logging: every state change of the library audio element.
	for (const ev of ["loadstart", "loadedmetadata", "canplay", "playing", "waiting", "stalled", "suspend", "pause"] as const) {
		a.addEventListener(ev, () =>
			trace.log(`[lib-audio] ${ev}`, `t=${a.currentTime.toFixed(1)}s`, `ready=${a.readyState}`, `net=${a.networkState}`, `vol=${a.volume.toFixed(2)}`, `muted=${a.muted}`),
		);
	}
	a.addEventListener("ended", () => {
		trace.log("[lib-audio] ended -> next");
		next(true);
	});
	a.addEventListener("error", () => {
		const err = a.error;
		trace.warn(`[lib-audio] ERROR code=${err?.code ?? "?"} (1=aborted 2=network 3=decode 4=src-not-supported)`, err?.message ?? "", `net=${a.networkState}`, `src=${redact(a.currentSrc || a.src)}`);
		if (!active) return;
		next(true);
	});
	audio = a;
	return a;
}

function streamUrlFor(t: LibraryTrack): string {
	const synthetic: ProviderMatch = { providerId: t.providerId, itemId: t.itemId, title: t.title, streamUrl: "", confidence: 1 };
	return getProvider(t.providerId)?.streamUrl?.(synthetic) ?? "";
}

function pauseTidal() {
	// Prefer TIDAL's own pause button so its UI state stays consistent; the synthetic
	// click is not `isTrusted`, so our own interceptors ignore it.
	const btn = qs<HTMLButtonElement>('#footerPlayer button[data-test="pause"]');
	if (btn) {
		trace.log("[lib] pausing TIDAL via pause button");
		btn.click();
	} else {
		trace.log("[lib] no pause button (TIDAL already paused?) - pausing media element directly");
		try {
			findTidalMediaEl()?.pause();
		} catch {
			/* ignore */
		}
	}
}

const fmtTime = (s: number): string => {
	if (!isFinite(s) || s < 0) s = 0;
	const m = Math.floor(s / 60);
	return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

// ---------------------------------------------------------------- footer chrome

function tierColor(): string {
	const q = current()?.quality;
	return q ? TIER_COLOR[bucketFor(q)] : "var(--altplay-lossless, #33d9e6)";
}

function playIconSvg(playing: boolean): string {
	return playing
		? `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M7 4h4v16H7zM13 4h4v16h-4z"/></svg>`
		: `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M7 4l13 8-13 8z"/></svg>`;
}

function ensurePlayOverlay() {
	const btn = qs('#footerPlayer button[data-test="pause"], #footerPlayer button[data-test="play"]');
	const host = btn?.parentElement as HTMLElement | null;
	if (!host) return;
	if (playOverlay && playOverlay.isConnected && playOverlay.parentElement === host) return;
	playOverlay?.remove();
	const d = document.createElement("div");
	d.className = "altplay-lib-play";
	Object.assign(d.style, {
		position: "absolute",
		inset: "0",
		zIndex: "6",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		borderRadius: "50%",
		background: "#0d0d10",
		color: "#fff",
		cursor: "pointer",
	});
	d.innerHTML = playIconSvg(!!audio && !audio.paused);
	d.addEventListener("click", (e) => {
		e.preventDefault();
		e.stopPropagation();
		togglePlay();
	});
	if (getComputedStyle(host).position === "static") host.style.position = "relative";
	host.appendChild(d);
	playOverlay = d;
}

function ensureBarOverlay() {
	const bar = qs("#footerPlayer #progressBar");
	if (!bar) return;
	if (barOverlay && barOverlay.isConnected && barOverlay.parentElement === bar) return;
	barOverlay?.remove();

	// Hide TIDAL's own fill/knob while we own the bar (restored on stop).
	const inner = bar.firstElementChild as HTMLElement | null;
	if (inner) {
		inner.style.visibility = "hidden";
		hiddenBarInner = inner;
	}

	const d = document.createElement("div");
	d.className = "altplay-lib-bar";
	Object.assign(d.style, { position: "absolute", inset: "0", zIndex: "6", cursor: "pointer", display: "flex", alignItems: "center" });
	const track = document.createElement("div");
	Object.assign(track.style, { position: "relative", width: "100%", height: "4px", borderRadius: "2px", background: "rgba(255,255,255,0.22)" });
	const fill = document.createElement("div");
	Object.assign(fill.style, { position: "absolute", left: "0", top: "0", bottom: "0", width: "0%", borderRadius: "2px", background: tierColor() });
	const knob = document.createElement("div");
	Object.assign(knob.style, {
		position: "absolute",
		top: "50%",
		left: "0%",
		width: "10px",
		height: "10px",
		borderRadius: "50%",
		background: "#fff",
		transform: "translate(-50%, -50%)",
	});
	track.append(fill, knob);
	d.appendChild(track);
	d.addEventListener("click", (e) => {
		e.preventDefault();
		e.stopPropagation();
		if (!audio || !isFinite(audio.duration)) return;
		const r = d.getBoundingClientRect();
		const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
		audio.currentTime = ratio * audio.duration;
	});
	if (getComputedStyle(bar as HTMLElement).position === "static") (bar as HTMLElement).style.position = "relative";
	bar.appendChild(d);
	barOverlay = d;
	barFill = fill;
	barKnob = knob;
}

function assertFooter() {
	const t = current();
	if (!t) return;
	ensurePlayOverlay();
	ensureBarOverlay();

	setText(qs('#footerPlayer [data-test="footer-track-title"] span'), t.title);
	setText(qs('#footerPlayer [data-test="footer-artist-name"]'), t.artists.join(", ") || t.albumArtist || "Jellyfin");

	// AltPlay-only song: TIDAL doesn't know it, so the underlying track/artist links
	// would open the WRONG page - disable clicking (style-only, React-safe).
	for (const sel of ['#footerPlayer [data-test="footer-track-title"] a', '#footerPlayer [data-test="footer-artist-name"] a', '#footerPlayer [data-test="footer-artist-name"]']) {
		document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
			if (el.style.pointerEvents !== "none") {
				el.style.pointerEvents = "none";
				el.style.cursor = "default";
				el.setAttribute("data-altplay-nolink", "1");
			}
		});
	}
	const img = qs<HTMLImageElement>('#footerPlayer [data-test="current-media-imagery"] img');
	const wantSrc = t.imageUrl ?? BLANK_IMG; // no cover -> blank, never the previous song's
	if (img && !img.src.startsWith(wantSrc)) {
		img.srcset = "";
		img.sizes = "";
		img.src = wantSrc;
	}

	const cur = audio?.currentTime ?? 0;
	const dur = audio && isFinite(audio.duration) && audio.duration > 0 ? audio.duration : t.durationSec;
	const curEl = qs('#footerPlayer time[data-test="current-time"]');
	if (curEl) curEl.textContent = fmtTime(cur);
	const durEl = qs('#footerPlayer time[data-test="duration"]');
	if (durEl) durEl.textContent = fmtTime(dur);
	if (barFill && barKnob && dur > 0) {
		const pct = Math.min(100, (cur / dur) * 100);
		barFill.style.width = `${pct}%`;
		barFill.style.background = tierColor();
		barKnob.style.left = `${pct}%`;
	}
	if (playOverlay) playOverlay.innerHTML = playIconSvg(!!audio && !audio.paused);

	// Mirror TIDAL's volume so the volume slider keeps working for our stream too.
	if (audio) {
		const tidal = findTidalMediaEl();
		if (tidal) audio.volume = tidal.volume;
	}
}

function removeChrome() {
	playOverlay?.remove();
	playOverlay = null;
	barOverlay?.remove();
	barOverlay = null;
	barFill = null;
	barKnob = null;
	if (hiddenBarInner) {
		hiddenBarInner.style.removeProperty("visibility");
		hiddenBarInner = null;
	}
}

function saveFooter() {
	if (saved) return;
	const titleSpan = qs('#footerPlayer [data-test="footer-track-title"] span');
	const artistEl = qs('#footerPlayer [data-test="footer-artist-name"]');
	const img = qs<HTMLImageElement>('#footerPlayer [data-test="current-media-imagery"] img');
	saved = {
		title: titleSpan?.textContent ?? "",
		artist: artistEl?.textContent ?? "",
		imgSrc: img?.src ?? "",
		imgSrcset: img?.srcset ?? "",
		imgSizes: img?.sizes ?? "",
	};
}

function restoreFooter() {
	if (!saved) return;
	restoreText(qs('#footerPlayer [data-test="footer-track-title"] span'), saved.title);
	restoreText(qs('#footerPlayer [data-test="footer-artist-name"]'), saved.artist);
	document.querySelectorAll("#footerPlayer .altplay-footer-text").forEach((el) => el.remove());
	document.querySelectorAll<HTMLElement>("#footerPlayer [data-altplay-ft-hidden]").forEach((el) => {
		el.style.removeProperty("display");
		el.removeAttribute("data-altplay-ft-hidden");
	});
	document.querySelectorAll<HTMLElement>("#footerPlayer [data-altplay-nolink]").forEach((el) => {
		el.style.removeProperty("pointer-events");
		el.style.removeProperty("cursor");
		el.removeAttribute("data-altplay-nolink");
	});
	const img = qs<HTMLImageElement>('#footerPlayer [data-test="current-media-imagery"] img');
	if (img) {
		img.src = saved.imgSrc;
		img.srcset = saved.imgSrcset;
		img.sizes = saved.imgSizes;
	}
	saved = null;
}

// ---------------------------------------------------------------- now-playing (fullscreen)

// While a library track plays, the fullscreen "Now Playing" view still shows the
// PAUSED TIDAL track: its artwork, artist info, similar tracks, credits and lyrics.
// TIDAL doesn't know our song, so we swap the artwork for the Jellyfin cover and
// hide everything track-metadata related. All of it is restored on stop.

let npArtSaved: { src: string; srcset: string; sizes: string } | null = null;
const npBgSaved = new Map<string, string>(); // theme background images we replaced

/** High-res variant of the library track's cover (index URLs are 160x160 thumbs). */
function bigCover(t: LibraryTrack): string | null {
	if (!t.imageUrl) return null;
	return t.imageUrl.replace(/fillWidth=\d+/, "fillWidth=1280").replace(/fillHeight=\d+/, "fillHeight=1280");
}

const NP_HIDE_SELECTORS = [
	'#nowPlaying [data-test="toggle-similar-tracks"]',
	'#nowPlaying [data-test="toggle-credits"]',
	'#nowPlaying [data-test="toggle-lyrics"]',
	'#nowPlaying [data-test="artist-info"]', // shows the paused TIDAL track's artist
];

function assertNowPlaying() {
	const t = current();
	if (!t) return;

	// 1. Big artwork -> Jellyfin cover (blank when the track has none).
	const cover = bigCover(t) ?? BLANK_IMG;
	const art = qs<HTMLImageElement>('img[data-test="now-playing-artwork"]');
	if (art) {
		if (!npArtSaved) npArtSaved = { src: art.src, srcset: art.srcset, sizes: art.sizes };
		if (!art.src.startsWith(cover)) {
			art.srcset = "";
			art.sizes = "";
			art.src = cover;
		}
	}
	// Theme background images (blurred spinning cover) follow along if present.
	for (const sel of [".now-playing-background-image", ".global-spinning-image"]) {
		const bg = qs<HTMLImageElement>(sel);
		if (bg && !bg.src.startsWith(cover)) {
			if (!npBgSaved.has(sel)) npBgSaved.set(sel, bg.src);
			bg.src = cover;
		}
	}

	// 2. TIDAL doesn't know this track: close any open panel and hide the buttons.
	for (const sel of NP_HIDE_SELECTORS) {
		const el = qs<HTMLElement>(sel);
		if (!el) continue;
		// Synthetic click (not isTrusted) closes TIDAL's panel; our interceptors ignore it.
		if (el.getAttribute("aria-pressed") === "true") el.click();
		if (el.style.display !== "none") {
			el.style.display = "none";
			el.setAttribute("data-altplay-np-hidden", "1");
		}
	}
}

function restoreNowPlaying() {
	const art = qs<HTMLImageElement>('img[data-test="now-playing-artwork"]');
	if (art && npArtSaved) {
		art.src = npArtSaved.src;
		art.srcset = npArtSaved.srcset;
		art.sizes = npArtSaved.sizes;
	}
	npArtSaved = null;
	for (const [sel, src] of npBgSaved) {
		const bg = qs<HTMLImageElement>(sel);
		if (bg) bg.src = src;
	}
	npBgSaved.clear();
	document.querySelectorAll<HTMLElement>("[data-altplay-np-hidden]").forEach((el) => {
		el.style.removeProperty("display");
		el.removeAttribute("data-altplay-np-hidden");
	});
}

// ---------------------------------------------------------------- playback

let loadSeq = 0; // guards against rapid track changes racing the async proxy setup

async function loadCurrent() {
	const t = current();
	const a = ensureAudio();
	if (!t) return;
	const direct = streamUrlFor(t);
	if (!direct) {
		trace.warn("[lib] no stream URL for", t.title, "- is the Jellyfin login still valid?");
		return;
	}
	const seq = ++loadSeq;

	// Publish the session immediately so badge/overlay/page react on click.
	setSession({
		trackId: `lib:${t.itemId}`,
		title: t.title,
		artist: t.artists.join(", ") || t.albumArtist,
		match: { providerId: t.providerId, itemId: t.itemId, title: t.title, streamUrl: direct, confidence: 1 },
		quality: t.quality,
		hijacked: true,
		libraryMode: true,
	});
	if (t.quality) showQuality(t.quality);
	assertFooter();

	// Stream through the native localhost proxy - the renderer's own requests to
	// the media server can stall indefinitely (see proxy.native.ts).
	let url = direct;
	try {
		url = await proxiedStreamUrl(direct);
	} catch (e) {
		trace.warn("[lib] proxy setup failed, falling back to direct URL:", String(e));
	}
	if (seq !== loadSeq || !active) return; // a newer track superseded us

	trace.log("[lib] load", `"${t.title}"`, `item=${t.itemId}`, url.startsWith("http://127.") ? `via local proxy (${url})` : "DIRECT", redact(direct));
	a.pause();
	a.src = url;
	a.load();
	// AbortError just means the user skipped on before this play() settled - ignore it.
	a.play()
		.then(() => trace.log("[lib] play() resolved", `paused=${a.paused}`, `ready=${a.readyState}`, `vol=${a.volume.toFixed(2)}`, `muted=${a.muted}`))
		.catch((e) => e?.name !== "AbortError" && trace.warn("[lib] play() FAILED", e?.name ?? "", String(e)));

	// If nothing has moved after 4s, dump a full diagnostic snapshot + network probes.
	const itemId = t.itemId;
	const snapshot = (label: string) => {
		if (!active || current()?.itemId !== itemId || !audio) return false;
		if (audio.currentTime >= 0.5) return false;
		trace.warn(
			`[lib] STALL ${label}:`,
			`t=${audio.currentTime.toFixed(2)}s`,
			`paused=${audio.paused}`,
			`ready=${audio.readyState} (0=nothing 1=meta 2=cur 3=future 4=enough)`,
			`net=${audio.networkState} (0=empty 1=idle 2=loading 3=no-source)`,
			`err=${audio.error?.code ?? "none"}`,
			`vol=${audio.volume.toFixed(2)}`,
			`muted=${audio.muted}`,
		);
		return true;
	};
	setTimeout(() => {
		if (!snapshot("after 4s")) return;
		// Probe 1: renderer fetch against the URL the <audio> element uses (the proxy).
		const t0 = Date.now();
		fetch(url, { headers: { Range: "bytes=0-255" } })
			.then(async (r) => {
				const buf = await r.arrayBuffer().catch(() => null);
				trace.warn(
					"[lib] renderer probe (proxy):",
					`status=${r.status}`,
					`type=${r.headers.get("content-type") ?? "?"}`,
					`bytes=${buf?.byteLength ?? -1}`,
					`took=${Date.now() - t0}ms`,
				);
			})
			.catch((e) => trace.warn("[lib] renderer probe (proxy) FAILED:", String(e)));
		// Probe 2: native fetch straight to the media server.
		void probeStream(direct).then((p) => trace.warn("[lib] native probe (direct):", `ok=${p.ok}`, `status=${p.status}`, `type=${p.type}`, p.note));
	}, 4000);
	// Second snapshot much later: distinguishes "dead" from "just very slow".
	setTimeout(() => snapshot("after 15s (still nothing - request looks dead, not slow)"), 15_000);
}

export function playFromLibrary(list: readonly LibraryTrack[], index: number) {
	if (!list.length || index < 0 || index >= list.length) return;
	void startAt([...list], index);
}

// ------------------------------------------------------------ native TIDAL mode
// If the library track also exists on TIDAL, TIDAL plays it natively (real artist/
// album links, fullscreen, lyrics, credits) and the hijack engine swaps only the
// audio to Jellyfin. The library queue stays alive across both modes.

let natQueue: LibraryTrack[] = [];
let natPos = -1;
let natExpectedId: string | null = null; // TIDAL id of the track we started
let natStarted = false;
let natLastTime = 0;
let natLastDur = 0;

function clearNative() {
	natExpectedId = null;
	natStarted = false;
	natLastTime = 0;
	natLastDur = 0;
}

async function startAt(list: LibraryTrack[], index: number) {
	const t = list[index];
	const tidalId = await findTidalTrackId(t);
	if (tidalId != null) {
		stopLibraryPlayback(); // end any takeover; TIDAL owns the UI from here
		natQueue = list;
		natPos = index;
		natExpectedId = tidalId;
		natStarted = false;
		trace.msg.log(`Playing "${t.title}" via TIDAL (audio from Jellyfin)`);
		try {
			await playTidalTrack(tidalId);
		} catch (e) {
			trace.warn("[lib] native TIDAL play failed, falling back to takeover:", String(e));
			clearNative();
			takeover(list, index);
		}
		return;
	}
	takeover(list, index);
}

/** The song is NOT on TIDAL: pause TIDAL and take over the footer player. */
function takeover(list: LibraryTrack[], index: number) {
	clearNative();
	releaseHijack(); // unmute + stop any active TIDAL hijack first
	pauseTidal();
	queue = list;
	pos = index;
	if (!active) {
		active = true;
		saveFooter();
	}
	void loadCurrent();
	trace.msg.log(`Playing "${list[index].title}" from library`);
}

/** A TIDAL track change while a native library session runs: ours starting,
 *  auto-advance at the end (-> continue the queue), or a real user action (-> stop). */
function handleNativeTransition(id: string) {
	if (!natExpectedId) return;
	if (id === natExpectedId) {
		natStarted = true;
		return;
	}
	if (!natStarted) return; // stale transition while our track is still loading
	const nearEnd = natLastDur > 0 && natLastTime >= natLastDur - 5;
	const q = natQueue;
	const p = natPos;
	clearNative();
	if (nearEnd && p + 1 < q.length) {
		trace.log("[lib] native track finished -> next library track");
		void startAt(q, p + 1);
	} else {
		trace.log("[lib] TIDAL track changed by user -> library session ended");
	}
}

export function togglePlay() {
	if (!audio) return;
	if (audio.paused) audio.play().catch(() => {});
	else audio.pause();
	assertFooter();
}

function next(auto = false) {
	if (!active) return;
	if (pos + 1 < queue.length) {
		trace.log("[lib] next ->", `"${queue[pos + 1].title}"`, auto ? "(auto)" : "(user)");
		void startAt(queue, pos + 1); // re-checks TIDAL per track
	} else if (auto) {
		trace.log("[lib] end of queue -> stopping");
		stopLibraryPlayback();
	}
}

function prev() {
	if (!active || !audio) return;
	if (audio.currentTime > 3 || pos === 0) {
		audio.currentTime = 0;
		return;
	}
	void startAt(queue, pos - 1);
}

export function stopLibraryPlayback() {
	if (!active) return;
	active = false;
	if (audio) {
		try {
			audio.pause();
			audio.removeAttribute("src");
			audio.load();
		} catch {
			/* ignore */
		}
	}
	removeChrome();
	restoreFooter();
	restoreNowPlaying();
	clearBadge();
	setSession({ trackId: null, title: "", artist: "", match: null, quality: null, hijacked: false, libraryMode: false });
	queue = [];
	pos = -1;
}

// ---------------------------------------------------------------- wiring

export function initLibPlayer(unloads: Set<LunaUnload>) {
	// Keep our chrome asserted while active (TIDAL re-renders get re-overridden).
	safeInterval(
		unloads,
		() => {
			if (active) {
				assertFooter();
				assertNowPlaying();
			} else if (natExpectedId && natStarted) {
				// Track progress of the native TIDAL playback so we can tell
				// "finished -> auto-advance" apart from "user picked another song".
				const el = findTidalMediaEl();
				if (el && isFinite(el.duration) && el.duration > 0) {
					natLastTime = el.currentTime;
					natLastDur = el.duration;
				}
			}
		},
		400,
	);

	// TIDAL track change: ends a takeover, or advances a native library session.
	MediaItem.onMediaTransition(unloads, (item) => {
		if (active) {
			stopLibraryPlayback();
			return;
		}
		handleNativeTransition(String(item.id));
	});

	// Transport buttons + spacebar drive OUR audio while active.
	const onClick = (e: MouseEvent) => {
		if (!e.isTrusted) return;
		const el = e.target as Element;
		// Native session: "next" continues the library queue instead of TIDAL's own queue.
		if (!active && natExpectedId) {
			if (el.closest?.('#footerPlayer button[data-test="next"]') && natPos + 1 < natQueue.length) {
				e.preventDefault();
				e.stopImmediatePropagation();
				const q = natQueue;
				const p = natPos;
				clearNative();
				void startAt(q, p + 1);
			}
			return;
		}
		if (!active) return;
		if (el.closest?.('#footerPlayer button[data-test="next"]')) {
			e.preventDefault();
			e.stopImmediatePropagation();
			next();
		} else if (el.closest?.('#footerPlayer button[data-test="previous"]')) {
			e.preventDefault();
			e.stopImmediatePropagation();
			prev();
		} else if (el.closest?.('#footerPlayer button[data-test="play"], #footerPlayer button[data-test="pause"]')) {
			e.preventDefault();
			e.stopImmediatePropagation();
			togglePlay();
		}
	};
	document.addEventListener("click", onClick, true);
	unloads.add(() => document.removeEventListener("click", onClick, true));

	const onKey = (e: KeyboardEvent) => {
		if (!active || !e.isTrusted || e.code !== "Space") return;
		const t = e.target as HTMLElement | null;
		if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
		e.preventDefault();
		e.stopImmediatePropagation();
		togglePlay();
	};
	document.addEventListener("keydown", onKey, true);
	unloads.add(() => document.removeEventListener("keydown", onKey, true));

	unloads.add(stopLibraryPlayback);
	unloads.add(clearNative);
}
