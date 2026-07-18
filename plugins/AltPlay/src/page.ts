import type { LunaUnload } from "@luna/core";
import { safeInterval } from "@luna/lib";
import type { LibraryTrack } from "./providers/types";
import { isSyncing, libraryCount, librarySyncedAt, libraryTracks, onLibrary, syncLibrary } from "./library";
import { currentLibraryItemId, playFromLibrary } from "./libplayer";
import { onSession } from "./session";
import { bucketFor, TIER_COLOR } from "./format";
import { jellyfishSvg } from "./icon";
import { setSidebarActive } from "./sidebar";
import { findTidalTrack, openTidalPage } from "./tidalbridge";
import { trace } from "./trace";

/**
 * The AltPlay library page, styled after TIDAL's own "Meine Musik - Titel" view.
 * It is a REAL page: mounted inside TIDAL's <main> content area (so it scrolls with
 * TIDAL's own scrollbar and sits in the normal layout) while the underlying page is
 * hidden. Any navigation (sidebar click, back button) closes it and restores TIDAL.
 */

const TEAL = "var(--altplay-lossless, #33d9e6)";
const MUTED = "rgba(255,255,255,0.55)";
const FAINT = "rgba(255,255,255,0.35)";
const CHUNK = 200;
const GRID = "34px 44px minmax(0,5fr) minmax(0,4fr) minmax(0,4fr) 90px 92px 56px 56px";

type SortKey = "default" | "title" | "artist" | "album" | "bitrate" | "duration";

let root: HTMLDivElement | null = null;
let listEl: HTMLDivElement | null = null;
let statusEl: HTMLSpanElement | null = null;
let scrollHost: HTMLElement | null = null;
let openPath = "";
let searchValue = "";
let sortKey: SortKey = "default";
let sortDir: 1 | -1 = 1;
let renderLimit = CHUNK;
let open = false;
let filtered: LibraryTrack[] = [];

const fmtTime = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const artistOf = (t: LibraryTrack): string => t.artists.join(", ") || t.albumArtist;

function qualityColor(t: LibraryTrack): string {
	return t.quality ? TIER_COLOR[bucketFor(t.quality)] : MUTED;
}

// ---------------------------------------------------------------- mount into <main>

const tidalContent = (): HTMLElement | null => document.querySelector<HTMLElement>("#main .mainContent");

/**
 * Hide TIDAL's page content but KEEP the blurred spinning cover background
 * (.global-background-container) alive so it shines through our page.
 */
function hideTidalContent() {
	const content = tidalContent();
	if (!content) return;
	for (const child of Array.from(content.children) as HTMLElement[]) {
		if (child.classList.contains("global-background-container")) continue;
		if (child.querySelector?.(".global-background-container") && child.children.length === 1) continue;
		if (child.style.display === "none") continue;
		child.style.setProperty("display", "none");
		child.setAttribute("data-altplay-hidden", "1");
	}
	// The emptied container may still claim a full viewport of height (min-height CSS),
	// which would push our page below the fold - squash it while we are open.
	if (!content.hasAttribute("data-altplay-squashed")) {
		content.style.setProperty("min-height", "0");
		content.style.setProperty("height", "auto");
		content.setAttribute("data-altplay-squashed", "1");
	}
}

/** Attach the page inside TIDAL's <main> and hide the underlying page. */
function mount(): boolean {
	const main = document.getElementById("main");
	if (!main) return false;
	const r = ensureRoot();
	if (r.parentElement !== main || !r.isConnected) {
		// FIRST child of <main>: our page always renders at the very top,
		// no matter how much (hidden) TIDAL content follows.
		main.insertBefore(r, main.firstChild);
	}
	hideTidalContent();
	r.style.display = "flex";
	r.style.minHeight = "100%";
	return true;
}

/** Show TIDAL's own page again and hide ours. */
function restoreTidalPage() {
	document.querySelectorAll<HTMLElement>("#main [data-altplay-hidden]").forEach((el) => {
		el.style.removeProperty("display");
		el.removeAttribute("data-altplay-hidden");
	});
	document.querySelectorAll<HTMLElement>("#main [data-altplay-squashed]").forEach((el) => {
		el.style.removeProperty("min-height");
		el.style.removeProperty("height");
		el.removeAttribute("data-altplay-squashed");
	});
	if (root) root.style.display = "none";
}

const onScroll = () => {
	if (!open || !scrollHost) return;
	if (scrollHost.scrollTop + scrollHost.clientHeight > scrollHost.scrollHeight - 600 && renderLimit < filtered.length) {
		renderLimit += CHUNK;
		renderList();
	}
};

// ---------------------------------------------------------------- widgets

function pillButton(label: string, primary: boolean, iconSvg: string, onClick: () => void): HTMLButtonElement {
	const b = document.createElement("button");
	b.type = "button";
	Object.assign(b.style, {
		display: "inline-flex",
		alignItems: "center",
		gap: "8px",
		border: "none",
		borderRadius: "999px",
		padding: "10px 22px",
		fontSize: "14px",
		fontWeight: "600",
		cursor: "pointer",
		background: primary ? "#fff" : "rgba(255,255,255,0.1)",
		color: primary ? "#101010" : "#fff",
	});
	b.innerHTML = `<span style="display:inline-flex">${iconSvg}</span><span>${label}</span>`;
	b.addEventListener("click", onClick);
	return b;
}

const playSvg = (size: number, color: string) =>
	`<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${color}"><path d="M6 1.188v21.624c0 .95 1.062 1.544 1.83.95l15.639-10.811a1.17 1.17 0 0 0 0-1.96L7.829.237C7.063-.356 6 .238 6 1.188"/></svg>`;
const shuffleSvg = (size: number, color: string) =>
	`<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="${color}"><path fill-rule="evenodd" d="M13.369.52a.715.715 0 1 0-1.043.978l1.011 1.079H11.13a3.7 3.7 0 0 0-3.115 1.725l-.002.002-3.775 6.118c-.453.666-1.16 1.06-1.908 1.06H1.01a.715.715 0 0 0 0 1.43h1.32c1.273 0 2.41-.675 3.101-1.703l.015-.024 3.783-6.129a2.27 2.27 0 0 1 1.9-1.05h2.125l-.927.99a.715.715 0 0 0 1.043.977l2.098-2.237a.715.715 0 0 0 0-.978zm-1.01 8.969a.715.715 0 0 1 1.01.032l2.098 2.238a.715.715 0 0 1 0 .978l-2.098 2.237a.715.715 0 0 1-1.043-.978l1.016-1.084H11.13a3.7 3.7 0 0 1-3.115-1.725.715.715 0 1 1 1.214-.754 2.27 2.27 0 0 0 1.9 1.05h2.12l-.922-.984a.715.715 0 0 1 .032-1.01M5.43 4.28a.715.715 0 1 1-1.186.798C3.79 4.405 3.08 4.007 2.329 4.007H1.01a.715.715 0 0 1 0-1.43h1.32c1.273 0 2.41.675 3.101 1.703"/></svg>`;

function ensureRoot(): HTMLDivElement {
	if (root) return root;
	const r = document.createElement("div");
	r.id = "altplay-page";
	Object.assign(r.style, {
		display: "none",
		flexDirection: "column",
		background: "transparent", // let TIDAL's blurred cover background shine through
		color: "#fff",
		fontSize: "14px",
		width: "100%",
		position: "relative",
		zIndex: "1",
	});

	// ---- top bar (status + sync + close)
	const topBar = document.createElement("div");
	Object.assign(topBar.style, { display: "flex", alignItems: "center", gap: "12px", padding: "22px 28px 0" });
	statusEl = document.createElement("span");
	Object.assign(statusEl.style, { color: MUTED, fontSize: "12px" });
	const spacer = document.createElement("div");
	spacer.style.flex = "1";
	const refresh = document.createElement("button");
	refresh.type = "button";
	refresh.textContent = "↻ Sync";
	refresh.title = "Re-sync the library index";
	Object.assign(refresh.style, {
		background: "rgba(255,255,255,0.08)",
		color: "#fff",
		border: "1px solid rgba(255,255,255,0.12)",
		borderRadius: "8px",
		padding: "6px 12px",
		cursor: "pointer",
		fontSize: "12px",
	});
	refresh.addEventListener("click", () => void syncLibrary(true));
	const close = document.createElement("button");
	close.type = "button";
	close.textContent = "✕";
	Object.assign(close.style, { background: "none", border: "none", color: MUTED, cursor: "pointer", fontSize: "16px", padding: "4px 8px" });
	close.addEventListener("click", closeLibraryPage);
	topBar.append(statusEl, spacer, refresh, close);

	// ---- big page title, like TIDAL's "Titel" heading
	const titleRow = document.createElement("div");
	Object.assign(titleRow.style, { display: "flex", alignItems: "center", gap: "12px", padding: "6px 28px 14px" });
	titleRow.innerHTML = `<span style="display:inline-flex;color:#fff">${jellyfishSvg(30)}</span><span style="font-size:32px;font-weight:800">AltPlay</span><span title="AltPlay is in beta - expect rough edges" style="align-self:center;padding:2px 8px;border-radius:999px;border:1px solid rgba(255,207,92,0.5);color:var(--altplay-gold,#ffcf5c);font-size:11px;font-weight:700;letter-spacing:0.08em">BETA</span>`;

	// ---- Play / Shuffle buttons
	const buttons = document.createElement("div");
	Object.assign(buttons.style, { display: "flex", alignItems: "center", gap: "8px", padding: "0 28px 18px" });
	buttons.append(
		pillButton("Abspielen", true, playSvg(14, "#101010"), () => filtered.length && playFromLibrary(filtered, 0)),
		pillButton("Shuffle", false, shuffleSvg(14, "#fff"), () => {
			if (!filtered.length) return;
			const shuffled = [...filtered];
			for (let i = shuffled.length - 1; i > 0; i--) {
				const j = Math.floor(Math.random() * (i + 1));
				[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
			}
			playFromLibrary(shuffled, 0);
		}),
	);

	// ---- filter field, like TIDAL's "Titel filtern"
	const searchWrap = document.createElement("div");
	Object.assign(searchWrap.style, { padding: "0 28px 12px" });
	const search = document.createElement("input");
	search.type = "search";
	search.placeholder = "Titel filtern";
	Object.assign(search.style, {
		width: "100%",
		background: "rgba(255,255,255,0.07)",
		color: "#fff",
		border: "1px solid rgba(255,255,255,0.12)",
		borderRadius: "999px",
		padding: "10px 18px",
		outline: "none",
		fontSize: "13px",
	});
	search.addEventListener("input", () => {
		searchValue = search.value;
		renderLimit = CHUNK;
		renderList();
	});
	searchWrap.appendChild(search);

	// ---- table (sticky header + rows; scrolling is handled by TIDAL's <main>)
	const list = document.createElement("div");
	Object.assign(list.style, { padding: "0 16px 48px" });
	listEl = list;

	r.append(topBar, titleRow, buttons, searchWrap, list);
	root = r;
	return r;
}

// ---------------------------------------------------------------- data

function updateStatus() {
	if (!statusEl) return;
	if (isSyncing()) statusEl.textContent = "Jellyfin · syncing…";
	else if (!libraryCount()) statusEl.textContent = "Jellyfin · no tracks indexed - connect in Settings";
	else {
		const mins = Math.round((Date.now() - librarySyncedAt()) / 60_000);
		statusEl.textContent = `Jellyfin · ${libraryCount()} Titel · synced ${mins <= 1 ? "just now" : `${mins} min ago`}`;
	}
}

function applyFilter() {
	const q = searchValue.trim().toLowerCase();
	const all = libraryTracks();
	filtered = !q
		? [...all]
		: all.filter(
				(t) =>
					t.title.toLowerCase().includes(q) ||
					t.album.toLowerCase().includes(q) ||
					t.albumArtist.toLowerCase().includes(q) ||
					t.artists.some((a) => a.toLowerCase().includes(q)),
			);
	if (sortKey !== "default") {
		const cmp = (a: LibraryTrack, b: LibraryTrack): number => {
			switch (sortKey) {
				case "title":
					return a.title.localeCompare(b.title);
				case "artist":
					return artistOf(a).localeCompare(artistOf(b));
				case "album":
					return a.album.localeCompare(b.album);
				case "bitrate":
					return (a.quality?.bitrateKbps ?? 0) - (b.quality?.bitrateKbps ?? 0);
				case "duration":
					return a.durationSec - b.durationSec;
				default:
					return 0;
			}
		};
		filtered.sort((a, b) => cmp(a, b) * sortDir);
	}
}

function setSort(key: SortKey) {
	if (sortKey === key) {
		if (sortDir === 1) sortDir = -1;
		else {
			sortKey = "default"; // third click resets to library order
			sortDir = 1;
		}
	} else {
		sortKey = key;
		sortDir = 1;
	}
	renderList();
}

// ---------------------------------------------------------------- table

function headerRow(): HTMLDivElement {
	const h = document.createElement("div");
	Object.assign(h.style, {
		display: "grid",
		gridTemplateColumns: GRID,
		gap: "12px",
		alignItems: "center",
		padding: "10px 12px",
		position: "sticky",
		top: "0",
		zIndex: "2",
		// Transparent like the rows; the blur only kicks in for content scrolling
		// underneath, keeping the labels readable without a dark band.
		background: "transparent",
		backdropFilter: "blur(18px)",
		WebkitBackdropFilter: "blur(18px)",
		borderBottom: "1px solid rgba(255,255,255,0.08)",
	} as Partial<CSSStyleDeclaration>);
	const cell = (label: string, key: SortKey | null, align: "left" | "right" = "left") => {
		const s = document.createElement("span");
		const active = key !== null && sortKey === key;
		s.textContent = label + (active ? (sortDir === 1 ? " ↑" : " ↓") : "");
		Object.assign(s.style, {
			color: active ? "#fff" : FAINT,
			fontSize: "11px",
			fontWeight: "600",
			letterSpacing: "0.08em",
			textTransform: "uppercase",
			textAlign: align,
			cursor: key ? "pointer" : "default",
			whiteSpace: "nowrap",
			overflow: "hidden",
			textOverflow: "ellipsis",
		});
		if (key) s.addEventListener("click", () => setSort(key));
		return s;
	};
	h.append(
		cell("#", null, "right"),
		cell("", null),
		cell("Titel", "title"),
		cell("Künstler", "artist"),
		cell("Album", "album"),
		cell("Bitrate", "bitrate", "right"),
		cell("Sample Rate", null, "right"),
		cell("Depth", null, "right"),
		cell("Lg.", "duration", "right"),
	);
	return h;
}

function row(t: LibraryTrack, i: number): HTMLDivElement {
	const isPlaying = currentLibraryItemId() === t.itemId;
	const color = qualityColor(t);
	const q = t.quality;

	const d = document.createElement("div");
	Object.assign(d.style, {
		display: "grid",
		gridTemplateColumns: GRID,
		gap: "12px",
		alignItems: "center",
		padding: "3px 12px",
		borderRadius: "8px",
		cursor: "pointer",
		minHeight: "48px",
	});
	d.addEventListener("click", () => playFromLibrary(filtered, i));

	const idx = document.createElement("span");
	idx.textContent = isPlaying ? "♪" : String(i + 1);
	Object.assign(idx.style, { color: isPlaying ? TEAL : MUTED, fontSize: "12px", textAlign: "right" });
	d.addEventListener("mouseenter", () => {
		d.style.background = "rgba(255,255,255,0.06)";
		if (!isPlaying) {
			idx.textContent = "▶";
			idx.style.color = "#fff";
		}
	});
	d.addEventListener("mouseleave", () => {
		d.style.background = "transparent";
		if (!isPlaying) {
			idx.textContent = String(i + 1);
			idx.style.color = MUTED;
		}
	});

	const cover = document.createElement("div");
	Object.assign(cover.style, { width: "42px", height: "42px", borderRadius: "4px", overflow: "hidden", background: "rgba(255,255,255,0.06)" });
	if (t.imageUrl) {
		const img = document.createElement("img");
		img.loading = "lazy";
		img.decoding = "async";
		img.src = t.imageUrl;
		Object.assign(img.style, { width: "100%", height: "100%", objectFit: "cover" });
		cover.appendChild(img);
	}

	const titleWrap = document.createElement("div");
	Object.assign(titleWrap.style, { minWidth: "0" });
	const titleLine = document.createElement("div");
	titleLine.textContent = t.title;
	titleLine.title = t.title;
	Object.assign(titleLine.style, {
		fontWeight: "500",
		color: isPlaying ? TEAL : "#fff",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	});
	const artistLine = document.createElement("div");
	artistLine.textContent = artistOf(t);
	Object.assign(artistLine.style, { color: MUTED, fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
	titleWrap.append(titleLine, artistLine);

	// Artist/album open the real TIDAL pages - but only when the song exists there.
	const linkify = (el: HTMLElement, kind: "artist" | "album") => {
		el.style.cursor = "pointer";
		el.addEventListener("mouseenter", () => (el.style.textDecoration = "underline"));
		el.addEventListener("mouseleave", () => (el.style.textDecoration = "none"));
		el.addEventListener("click", (e) => {
			e.stopPropagation(); // don't start playback
			void findTidalTrack(t).then((hit) => {
				const id = kind === "artist" ? hit?.artistId : hit?.albumId;
				if (id) openTidalPage(`/${kind}/${id}`);
				else trace.msg.log(`"${kind === "artist" ? artistOf(t) : t.album}" is not on TIDAL`);
			});
		});
	};

	const artist = document.createElement("div");
	artist.textContent = artistOf(t);
	artist.title = artistOf(t);
	Object.assign(artist.style, { color: MUTED, fontSize: "13px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
	linkify(artist, "artist");

	const album = document.createElement("div");
	album.textContent = t.album;
	album.title = t.album;
	Object.assign(album.style, { color: MUTED, fontSize: "13px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
	linkify(album, "album");

	const num = (text: string) => {
		const s = document.createElement("span");
		s.textContent = text;
		Object.assign(s.style, { color, fontSize: "12px", fontWeight: "500", textAlign: "right", whiteSpace: "nowrap" });
		return s;
	};
	const bitrate = num(q?.bitrateKbps ? `${q.bitrateKbps.toLocaleString("de-DE")}kbps` : "");
	const sample = num(q?.sampleRateHz ? `${(q.sampleRateHz / 1000) % 1 === 0 ? q.sampleRateHz / 1000 : (q.sampleRateHz / 1000).toFixed(1)}kHz` : "");
	const depth = num(q?.bitDepth ? `${q.bitDepth}bit` : "");

	const dur = document.createElement("span");
	dur.textContent = t.durationSec ? fmtTime(t.durationSec) : "";
	Object.assign(dur.style, { color: MUTED, fontSize: "12px", textAlign: "right" });

	d.append(idx, cover, titleWrap, artist, album, bitrate, sample, depth, dur);
	return d;
}

function renderList() {
	if (!listEl) return;
	applyFilter();
	updateStatus();
	listEl.replaceChildren();
	const frag = document.createDocumentFragment();
	frag.appendChild(headerRow());
	const n = Math.min(renderLimit, filtered.length);
	for (let i = 0; i < n; i++) frag.appendChild(row(filtered[i], i));
	if (!filtered.length) {
		const empty = document.createElement("div");
		empty.textContent = libraryCount() ? "Keine Treffer." : "Library ist leer - Jellyfin in den Settings verbinden, dann Sync.";
		Object.assign(empty.style, { color: MUTED, padding: "24px 12px" });
		frag.appendChild(empty);
	}
	listEl.appendChild(frag);
}

// ---------------------------------------------------------------- open/close

export function openLibraryPage() {
	ensureRoot();
	if (!mount()) {
		trace.warn("[page] open failed - #main not found");
		return;
	}
	trace.log("[page] opened @", location.pathname);
	open = true;
	openPath = location.pathname;
	scrollHost?.removeEventListener("scroll", onScroll);
	scrollHost = document.getElementById("main");
	scrollHost?.addEventListener("scroll", onScroll);
	if (scrollHost) scrollHost.scrollTop = 0;
	setSidebarActive(true);
	renderList();
	const rect = root?.getBoundingClientRect();
	trace.log("[page] mounted size:", `${Math.round(rect?.width ?? 0)}x${Math.round(rect?.height ?? 0)}`, `top=${Math.round(rect?.top ?? 0)}`);
}

export function closeLibraryPage() {
	if (open) trace.log("[page] closed");
	open = false;
	scrollHost?.removeEventListener("scroll", onScroll);
	scrollHost = null;
	setSidebarActive(false);
	restoreTidalPage();
}

export function toggleLibraryPage() {
	if (open) closeLibraryPage();
	else openLibraryPage();
}

export function initLibraryPage(unloads: Set<LunaUnload>) {
	unloads.add(
		onLibrary(() => {
			if (open) renderList();
			else updateStatus();
		}),
	);
	unloads.add(
		onSession(() => {
			if (open) renderList(); // refresh the playing-row highlight
		}),
	);

	// Watchdog: close on SPA navigation (back button, links) and keep the underlying
	// page hidden if React re-renders it while we are open.
	safeInterval(
		unloads,
		() => {
			if (!open) return;
			if (location.pathname !== openPath || !root?.isConnected) {
				trace.log("[page] auto-close:", location.pathname !== openPath ? `navigation ${openPath} -> ${location.pathname}` : "root removed by React");
				closeLibraryPage();
				return;
			}
			// React re-rendered the underlying page - hide it again (background stays).
			hideTidalContent();
		},
		400,
	);

	// Clicking sidebar/tab-bar links closes the page instantly (nav feels native).
	const onNav = (e: MouseEvent) => {
		if (!open) return;
		const el = e.target as Element;
		if (el.closest?.("#altplay-page") || el.closest?.("#altplay-sidebar-link")) return;
		if (el.closest?.('a[data-test^="sidebar-"], a[class*="_link_ce56174"], [data-test="tab-bar"] a, a[data-test^="sidebar-collection"]')) closeLibraryPage();
	};
	document.addEventListener("click", onNav, true);
	unloads.add(() => document.removeEventListener("click", onNav, true));

	const onKey = (e: KeyboardEvent) => {
		if (e.key === "Escape" && open) closeLibraryPage();
	};
	document.addEventListener("keydown", onKey);
	unloads.add(() => document.removeEventListener("keydown", onKey));

	unloads.add(() => {
		restoreTidalPage();
		root?.remove();
		root = null;
		listEl = null;
		statusEl = null;
		scrollHost = null;
		open = false;
	});
}
