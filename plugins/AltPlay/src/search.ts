import type { LunaUnload } from "@luna/core";
import { safeInterval } from "@luna/lib";
import type { LibraryTrack } from "./providers/types";
import { libraryTracks } from "./library";
import { playFromLibrary } from "./libplayer";
import { norm } from "./normalize";
import { jellyfishSvg } from "./icon";

/**
 * Adds an "AltPlay" section to TIDAL's search suggestions dropdown that live-searches
 * the local Jellyfin library index. Clicking a result plays it like a library-page row
 * (TIDAL-native when the song exists there, footer takeover otherwise).
 */

const SECTION_ID = "altplay-search-section";
const MAX_RESULTS = 6;
const BLANK_IMG = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

let lastQuery = "";
let haystacks = new WeakMap<LibraryTrack, string>();

function haystack(t: LibraryTrack): string {
	let h = haystacks.get(t);
	if (h === undefined) {
		h = `${norm(t.title)} ${t.artists.map(norm).join(" ")} ${norm(t.albumArtist)} ${norm(t.album)}`;
		haystacks.set(t, h);
	}
	return h;
}

function searchLibrary(query: string): LibraryTrack[] {
	const tokens = norm(query).split(" ").filter(Boolean);
	if (!tokens.length) return [];
	const out: LibraryTrack[] = [];
	for (const t of libraryTracks()) {
		const h = haystack(t);
		if (tokens.every((tok) => h.includes(tok))) {
			out.push(t);
			if (out.length >= MAX_RESULTS) break;
		}
	}
	return out;
}

function currentQuery(): string {
	const input =
		document.querySelector<HTMLInputElement>('input[data-test="search-popover-search-field"]') ??
		document.querySelector<HTMLInputElement>('input[data-type="search-field__input"]');
	return input?.value?.trim() ?? "";
}

function row(t: LibraryTrack, i: number, results: LibraryTrack[]): HTMLDivElement {
	const d = document.createElement("div");
	Object.assign(d.style, {
		display: "flex",
		alignItems: "center",
		gap: "12px",
		padding: "6px 16px",
		cursor: "pointer",
	} as Partial<CSSStyleDeclaration>);
	d.addEventListener("mouseenter", () => (d.style.background = "rgba(255,255,255,0.08)"));
	d.addEventListener("mouseleave", () => (d.style.background = "transparent"));
	// Let the click bubble so TIDAL closes the popup itself.
	d.addEventListener("click", () => playFromLibrary(results, i));

	const img = document.createElement("img");
	Object.assign(img.style, { width: "40px", height: "40px", borderRadius: "4px", objectFit: "cover", background: "rgba(255,255,255,0.06)", flexShrink: "0" });
	img.src = t.imageUrl ?? BLANK_IMG;
	img.loading = "lazy";

	const text = document.createElement("div");
	text.style.minWidth = "0";
	const title = document.createElement("div");
	Object.assign(title.style, { color: "#fff", fontSize: "14px", fontWeight: "600", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" });
	title.textContent = t.title;
	const sub = document.createElement("div");
	Object.assign(sub.style, { color: "rgba(255,255,255,0.55)", fontSize: "12px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" });
	sub.textContent = `AltPlay · ${t.artists.join(", ") || t.albumArtist || "Jellyfin"}`;
	text.append(title, sub);

	d.append(img, text);
	return d;
}

function renderSection(container: HTMLElement, results: LibraryTrack[]) {
	let section = document.getElementById(SECTION_ID);
	if (!results.length) {
		section?.remove();
		return;
	}
	if (!section) {
		section = document.createElement("div");
		section.id = SECTION_ID;
	}
	section.innerHTML = "";
	Object.assign(section.style, {
		borderBottom: "1px solid rgba(255,255,255,0.1)",
		padding: "8px 0",
	} as Partial<CSSStyleDeclaration>);

	const header = document.createElement("div");
	Object.assign(header.style, {
		display: "flex",
		alignItems: "center",
		gap: "8px",
		padding: "4px 16px 8px",
		color: "rgba(255,255,255,0.55)",
		fontSize: "11px",
		fontWeight: "600",
		letterSpacing: "0.08em",
		textTransform: "uppercase",
	} as Partial<CSSStyleDeclaration>);
	header.innerHTML = `<span style="display:inline-flex">${jellyfishSvg(14)}</span><span>AltPlay</span>`;
	section.appendChild(header);

	results.forEach((t, i) => section!.appendChild(row(t, i, results)));

	// Always keep it as the FIRST child of the (React-owned) suggestions container,
	// so the results are immediately visible without scrolling.
	if (section.parentElement !== container || container.firstElementChild !== section) container.insertBefore(section, container.firstChild);
}

export function initSearch(unloads: Set<LunaUnload>) {
	safeInterval(
		unloads,
		() => {
			const container = document.querySelector<HTMLElement>('[data-test="query-suggestions"]');
			if (!container) {
				lastQuery = "";
				return; // popup closed; our section vanished with it
			}
			const q = currentQuery();
			const section = document.getElementById(SECTION_ID);
			if (q === lastQuery && section && section.parentElement === container && container.firstElementChild === section) return;
			lastQuery = q;
			renderSection(container, searchLibrary(q));
		},
		250,
	);
	unloads.add(() => document.getElementById(SECTION_ID)?.remove());
}
