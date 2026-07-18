import type { LunaUnload } from "@luna/core";
import { MediaItem, safeInterval } from "@luna/lib";
import { clearMatchCache, findMatch, trackMetaFromTidalItem } from "./match";
import { onLibrary } from "./library";
import { jellyfishSvg } from "./icon";

/**
 * Adds a small jellyfish marker to every track-list row whose song exists on a
 * provider (so you can see at a glance what would play via AltPlay). Matching is
 * done against the local library index, so scanning rows costs no network requests.
 */

const MARK_CLASS = "altplay-row-mark";
const SCAN_ATTR = "data-altplay-scan";
const MATCH_ATTR = "data-altplay-match";
const TEAL = "var(--altplay-lossless, #33d9e6)";

let generation = 0; // bumped when the library index changes -> rows get re-checked

// Small queue so a fast scroll doesn't burst-resolve hundreds of MediaItems at once.
let running = 0;
const pending: Array<() => Promise<void>> = [];
function enqueue(fn: () => Promise<void>) {
	pending.push(fn);
	pump();
}
function pump() {
	while (running < 4 && pending.length) {
		const fn = pending.shift()!;
		running++;
		void fn().finally(() => {
			running--;
			pump();
		});
	}
}

function titleCell(row: HTMLElement): HTMLElement | null {
	return row.querySelector<HTMLElement>('[data-test="table-row-title"]');
}

function addMark(row: HTMLElement) {
	const cell = titleCell(row);
	if (!cell || cell.querySelector(`.${MARK_CLASS}`)) return;
	const span = document.createElement("span");
	span.className = MARK_CLASS;
	span.title = "Available on Jellyfin (AltPlay)";
	span.innerHTML = jellyfishSvg(15);
	Object.assign(span.style, {
		display: "inline-flex",
		alignItems: "center",
		verticalAlign: "middle",
		marginLeft: "4px",
		color: TEAL,
		flexShrink: "0",
	});
	// Sit right beside the quality tags when present, otherwise directly after the title.
	const tags = cell.querySelector<HTMLElement>(".quality-tag-container");
	if (tags) tags.appendChild(span);
	else (cell.querySelector('[data-test="table-cell-title"]')?.parentElement ?? cell).appendChild(span);
}

function removeMark(row: HTMLElement) {
	row.querySelectorAll(`.${MARK_CLASS}`).forEach((el) => el.remove());
}

async function processRow(row: HTMLElement, id: string, gen: number) {
	try {
		const item = await MediaItem.fromId(id);
		if (gen !== generation || !row.isConnected) return;
		const meta = trackMetaFromTidalItem(id, (item as any)?.tidalItem);
		const match = await findMatch(meta);
		if (gen !== generation || !row.isConnected) return;
		if (match) {
			row.setAttribute(MATCH_ATTR, "1");
			addMark(row);
		} else {
			row.removeAttribute(MATCH_ATTR);
			removeMark(row);
		}
	} catch {
		/* row disappeared or lookup failed - the next scan retries */
	}
}

function scan() {
	document.querySelectorAll<HTMLElement>('[data-test="tracklist-row"][data-track-id]').forEach((row) => {
		const id = row.getAttribute("data-track-id");
		if (!id) return;
		const key = `${generation}:${id}`;
		if (row.getAttribute(SCAN_ATTR) === key) {
			// Already checked - just re-add the mark if another plugin re-rendered the cell.
			if (row.getAttribute(MATCH_ATTR) === "1") addMark(row);
			return;
		}
		row.setAttribute(SCAN_ATTR, key);
		enqueue(() => processRow(row, id, generation));
	});
}

export function initRows(unloads: Set<LunaUnload>) {
	safeInterval(unloads, scan, 1000);
	// When the library index (re)syncs, all cached matches may have changed.
	unloads.add(
		onLibrary(() => {
			generation++;
			clearMatchCache();
		}),
	);
	unloads.add(() => {
		document.querySelectorAll(`.${MARK_CLASS}`).forEach((el) => el.remove());
		document.querySelectorAll(`[${SCAN_ATTR}]`).forEach((el) => {
			el.removeAttribute(SCAN_ATTR);
			el.removeAttribute(MATCH_ATTR);
		});
	});
}
