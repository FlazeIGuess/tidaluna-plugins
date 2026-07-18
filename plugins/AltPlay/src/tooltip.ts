import type { LunaUnload } from "@luna/core";
import { getSession } from "./session";
import { getProvider } from "./providers/registry";
import { bucketFor, fullQuality, NEUTRAL, TIER_COLOR } from "./format";
import { jellyfishSvg } from "./icon";
import { isOverlayOpen } from "./overlay";

/**
 * Hover tooltip on the (hijacked) quality badge: where the audio comes from,
 * what matched, and the full stream quality. Click still opens the overlay.
 */

const MUTED = "rgba(255,255,255,0.6)";

let tip: HTMLDivElement | null = null;

function ensureTip(): HTMLDivElement {
	if (tip) return tip;
	const d = document.createElement("div");
	d.id = "altplay-tooltip";
	Object.assign(d.style, {
		position: "fixed",
		zIndex: "99998",
		maxWidth: "320px",
		background: "rgba(22,22,26,0.98)",
		color: "#fff",
		border: "1px solid rgba(255,255,255,0.10)",
		borderRadius: "10px",
		boxShadow: "0 10px 32px rgba(0,0,0,0.5)",
		padding: "10px 12px",
		display: "none",
		fontSize: "12px",
		lineHeight: "1.5",
		pointerEvents: "none",
	});
	document.body.appendChild(d);
	tip = d;
	return d;
}

function render(): boolean {
	const s = getSession();
	if (!s.match) return false;
	const d = ensureTip();
	const providerLabel = getProvider(s.match.providerId)?.label ?? s.match.providerId;
	const user = getProvider(s.match.providerId)?.currentUser?.() ?? null;
	const color = s.quality ? TIER_COLOR[bucketFor(s.quality)] : NEUTRAL;

	const lines: string[] = [];
	lines.push(
		`<div style="display:flex;align-items:center;gap:6px;font-weight:700;margin-bottom:4px">` +
			`<span style="display:inline-flex;color:${color}">${jellyfishSvg(14)}</span>` +
			`<span>AltPlay · ${providerLabel}</span></div>`,
	);
	if (s.hijacked) {
		lines.push(`<div style="color:${color};font-weight:600">Playing from ${providerLabel}${s.libraryMode ? " (library)" : ""}</div>`);
	} else {
		lines.push(`<div style="color:${MUTED}">Match ready · currently playing from TIDAL</div>`);
	}
	lines.push(`<div style="color:${MUTED};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Matched: ${escapeHtml(s.match.title)} · ${Math.round(s.match.confidence * 100)}%</div>`);
	if (s.quality) lines.push(`<div style="color:${color}">${escapeHtml(fullQuality(s.quality))}</div>`);
	if (user) lines.push(`<div style="color:${MUTED}">Signed in as ${escapeHtml(user)}</div>`);
	lines.push(`<div style="color:${MUTED};margin-top:4px">Click for options</div>`);
	d.innerHTML = lines.join("");
	return true;
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function show(anchor: HTMLElement) {
	if (isOverlayOpen()) return hide();
	if (!render()) return hide();
	const d = ensureTip();
	d.style.display = "block";
	const r = anchor.getBoundingClientRect();
	const w = d.offsetWidth;
	const h = d.offsetHeight;
	let left = r.left + r.width / 2 - w / 2;
	left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
	let top = r.top - h - 8;
	if (top < 8) top = r.bottom + 8;
	d.style.left = `${left}px`;
	d.style.top = `${top}px`;
}

function hide() {
	if (tip) tip.style.display = "none";
}

export function initTooltip(unloads: Set<LunaUnload>) {
	const onOver = (e: MouseEvent) => {
		const anchor = (e.target as Element)?.closest?.('a[data-test^="quality-badge"]') as HTMLElement | null;
		if (anchor && getSession().match) show(anchor);
		else hide();
	};
	const onDown = () => hide(); // clicking opens the overlay instead
	document.addEventListener("mouseover", onOver, true);
	document.addEventListener("mousedown", onDown, true);
	unloads.add(() => document.removeEventListener("mouseover", onOver, true));
	unloads.add(() => document.removeEventListener("mousedown", onDown, true));
	unloads.add(() => {
		tip?.remove();
		tip = null;
	});
}
