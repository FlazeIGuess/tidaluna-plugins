import type { LunaUnload } from "@luna/core";
import { observe, safeInterval } from "@luna/lib";
import type { ProviderMatch } from "./providers/types";

/**
 * The now-playing-bar indicator (icon only). Dim = no match, accent = available,
 * glowing = playing from a provider. The stream quality is shown by hijacking TIDAL's
 * own quality badge (see badge.ts), not here.
 */

const EL_ID = "altplay-indicator";
const DIM = "rgba(255,255,255,0.32)";
const ACCENT = "var(--altplay-accent, #00a4dc)";

let el: HTMLButtonElement | null = null;
let state: { match: ProviderMatch | null; hijacked: boolean } = { match: null, hijacked: false };

function iconSvg(): string {
	return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
		<path d="M4 12.5a8 8 0 0 1 16 0v.5H4z" fill="currentColor"/>
		<path d="M7 14.5c0 1.8-1 2.6-1 4.2M12 14.5c0 1.9 0 2.8 0 4.4M17 14.5c0 1.8 1 2.6 1 4.2" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>
	</svg>`;
}

function make(): HTMLButtonElement {
	const b = document.createElement("button");
	b.id = EL_ID;
	b.type = "button";
	b.style.background = "transparent";
	b.style.border = "none";
	b.style.padding = "6px";
	b.style.margin = "0 2px";
	b.style.display = "inline-flex";
	b.style.alignItems = "center";
	b.style.color = DIM;
	b.style.cursor = "default";
	b.style.flexShrink = "0";
	b.innerHTML = iconSvg();
	return b;
}

function paint() {
	if (!el) return;
	const { match, hijacked } = state;
	if (match) {
		el.style.color = ACCENT;
		el.style.opacity = "1";
		el.style.filter = hijacked ? "drop-shadow(0 0 4px var(--altplay-accent, #00a4dc))" : "none";
		el.title = hijacked
			? `AltPlay: playing from ${match.providerId}`
			: `AltPlay: available on ${match.providerId} (${Math.round(match.confidence * 100)}%)`;
	} else {
		el.style.color = DIM;
		el.style.opacity = "0.55";
		el.style.filter = "none";
		el.title = "AltPlay: no match on your servers";
	}
}

function tryInject() {
	const existing = document.getElementById(EL_ID);
	if (existing && existing.isConnected) return;
	const host =
		document.querySelector('[data-test="footer-player"] [class^="_utilityButtons"]') ??
		document.querySelector('[data-test="track-info"] [class^="_actions"]');
	if (!host) return;
	el = make();
	host.insertBefore(el, host.firstChild);
	paint();
}

export function initIndicatorUI(unloads: Set<LunaUnload>) {
	tryInject();
	observe(unloads, '[data-test="footer-player"]', tryInject);
	safeInterval(unloads, tryInject, 1500);
	unloads.add(() => {
		el?.remove();
		el = null;
	});
}

export function setIndicator(match: ProviderMatch | null, hijacked: boolean) {
	state = { match, hijacked };
	paint();
}
