import type { LunaUnload } from "@luna/core";
import { getSession, onSession } from "./session";
import { isGlobalEnabled, isSongEffective, isSongEnabled, setGlobalEnabled, setSongEnabled } from "./engine";
import { getProvider } from "./providers/registry";
import { fullQuality } from "./format";
import { jellyfishSvg } from "./icon";

/**
 * The AltPlay overlay: a floating panel opened by clicking the (hijacked) quality badge.
 * Shows the match + quality, plus a global on/off and a per-song on/off (for wrong matches).
 * Plain DOM so it can float over TIDAL without touching its React tree.
 */

const ACCENT = "var(--altplay-accent, #00a4dc)";
const MUTED = "rgba(255,255,255,0.55)";

let panel: HTMLDivElement | null = null;
let open = false;
let anchorEl: HTMLElement | null = null;

function ensurePanel(): HTMLDivElement {
	if (panel) return panel;
	const p = document.createElement("div");
	p.id = "altplay-overlay";
	Object.assign(p.style, {
		position: "fixed",
		zIndex: "99999",
		width: "300px",
		maxWidth: "90vw",
		background: "rgba(22,22,26,0.98)",
		color: "#fff",
		border: "1px solid rgba(255,255,255,0.10)",
		borderRadius: "12px",
		boxShadow: "0 14px 44px rgba(0,0,0,0.55)",
		padding: "14px 16px",
		display: "none",
		fontSize: "13px",
		lineHeight: "1.45",
	});
	document.body.appendChild(p);
	panel = p;
	return p;
}

function toggle(checked: boolean, onChange: (v: boolean) => void): HTMLButtonElement {
	const b = document.createElement("button");
	b.type = "button";
	Object.assign(b.style, {
		width: "38px",
		height: "22px",
		borderRadius: "999px",
		border: "none",
		padding: "0",
		cursor: "pointer",
		position: "relative",
		flexShrink: "0",
		transition: "background .15s",
		background: checked ? ACCENT : "rgba(255,255,255,0.22)",
	});
	const knob = document.createElement("div");
	Object.assign(knob.style, {
		position: "absolute",
		top: "3px",
		left: checked ? "19px" : "3px",
		width: "16px",
		height: "16px",
		borderRadius: "50%",
		background: "#fff",
		transition: "left .15s",
	});
	b.appendChild(knob);
	b.addEventListener("click", (e) => {
		e.stopPropagation();
		onChange(!checked);
	});
	return b;
}

function textRow(label: string, control: HTMLElement): HTMLDivElement {
	const row = document.createElement("div");
	Object.assign(row.style, { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", margin: "10px 0 0" });
	const l = document.createElement("span");
	l.textContent = label;
	row.append(l, control);
	return row;
}

function line(text: string, color = "#fff", weight = "400", margin = "0"): HTMLDivElement {
	const d = document.createElement("div");
	d.textContent = text;
	d.style.color = color;
	d.style.fontWeight = weight;
	d.style.margin = margin;
	d.style.overflow = "hidden";
	d.style.textOverflow = "ellipsis";
	d.style.whiteSpace = "nowrap";
	return d;
}

function render() {
	const p = ensurePanel();
	const s = getSession();
	const providerLabel = s.match ? (getProvider(s.match.providerId)?.label ?? s.match.providerId) : "";
	p.replaceChildren();

	// header
	const header = document.createElement("div");
	Object.assign(header.style, { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" });
	const h = document.createElement("div");
	Object.assign(h.style, { display: "flex", alignItems: "center", gap: "7px", fontWeight: "700" });
	h.innerHTML = `<span style="color:${ACCENT};display:inline-flex">${jellyfishSvg(16)}</span><span>AltPlay${providerLabel ? ` · ${providerLabel}` : ""}</span>`;
	const close = document.createElement("button");
	close.type = "button";
	close.textContent = "✕";
	Object.assign(close.style, { background: "none", border: "none", color: MUTED, cursor: "pointer", fontSize: "13px", padding: "2px" });
	close.addEventListener("click", (e) => {
		e.stopPropagation();
		closeOverlay();
	});
	header.append(h, close);
	p.appendChild(header);

	// current track
	p.appendChild(line(s.title || "Nothing playing", "#fff", "600"));
	if (s.artist) p.appendChild(line(s.artist, MUTED));

	// status (effective = incl. the "only better quality" gate)
	const effective = s.trackId ? isSongEffective(s.trackId) : isGlobalEnabled();
	let statusText: string;
	let statusColor = MUTED;
	if (s.hijacked) {
		statusText = `Playing from ${providerLabel}`;
		statusColor = ACCENT;
	} else if (s.match && !effective && s.trackId && isSongEnabled(s.trackId)) statusText = "Off: TIDAL streams equal/better quality";
	else if (s.match && !effective) statusText = "Off for this song";
	else if (s.match) statusText = "Match ready";
	else statusText = "No match on your servers";
	const status = line(`● ${statusText}`, statusColor, "600", "10px 0 0");
	status.style.whiteSpace = "normal";
	p.appendChild(status);

	// match + quality
	if (s.match) {
		p.appendChild(line(`Matched: ${s.match.title} · ${Math.round(s.match.confidence * 100)}%`, MUTED, "400", "8px 0 0")).style.whiteSpace = "normal";
		if (s.quality) p.appendChild(line(fullQuality(s.quality), MUTED, "400", "3px 0 0")).style.whiteSpace = "normal";
	}

	// divider
	const hr = document.createElement("div");
	Object.assign(hr.style, { height: "1px", background: "rgba(255,255,255,0.10)", margin: "12px 0 2px" });
	p.appendChild(hr);

	// global toggle
	p.appendChild(textRow("Auto-play from " + (providerLabel || "servers"), toggle(isGlobalEnabled(), (v) => setGlobalEnabled(v))));

	// per-song toggle (only meaningful with a match); locked for library-only playback
	if (s.libraryMode) {
		const lock = line("Source locked: this song plays via AltPlay only", MUTED, "400", "10px 0 0");
		lock.style.whiteSpace = "normal";
		p.appendChild(lock);
	} else if (s.trackId && s.match) {
		const id = s.trackId;
		// Shows the EFFECTIVE state: with "only better quality" active and TIDAL
		// winning, this reads OFF - switching it on overrides the gate for this song.
		p.appendChild(textRow("Use for this song", toggle(isSongEffective(id), (v) => setSongEnabled(id, v))));
	}
}

export const isOverlayOpen = (): boolean => open;

function position() {
	if (!panel || !anchorEl) return;
	panel.style.display = "block";
	const r = anchorEl.getBoundingClientRect();
	const pw = panel.offsetWidth;
	const ph = panel.offsetHeight;
	let left = r.left + r.width / 2 - pw / 2;
	left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
	let top = r.top - ph - 10;
	if (top < 8) top = r.bottom + 10;
	panel.style.left = `${left}px`;
	panel.style.top = `${top}px`;
}

export function openOverlay(anchor: HTMLElement) {
	anchorEl = anchor;
	open = true;
	render();
	position();
}

export function closeOverlay() {
	open = false;
	if (panel) panel.style.display = "none";
}

export function toggleOverlay(anchor: HTMLElement) {
	if (open) closeOverlay();
	else openOverlay(anchor);
}

export function initOverlay(unloads: Set<LunaUnload>) {
	ensurePanel();

	unloads.add(
		onSession(() => {
			if (open) {
				render();
				position();
			}
		}),
	);

	const onDocDown = (e: MouseEvent) => {
		if (!open) return;
		const t = e.target as Element;
		if (panel && panel.contains(t)) return;
		if (t.closest?.('a[data-test^="quality-badge"]')) return; // badge toggles itself
		closeOverlay();
	};
	document.addEventListener("mousedown", onDocDown, true);

	const onKey = (e: KeyboardEvent) => {
		if (e.key === "Escape" && open) closeOverlay();
	};
	document.addEventListener("keydown", onKey);

	unloads.add(() => document.removeEventListener("mousedown", onDocDown, true));
	unloads.add(() => document.removeEventListener("keydown", onKey));
	unloads.add(() => {
		panel?.remove();
		panel = null;
		open = false;
	});
}
