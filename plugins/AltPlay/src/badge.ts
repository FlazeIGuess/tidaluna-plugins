import type { LunaUnload } from "@luna/core";
import { safeInterval } from "@luna/lib";
import type { StreamQuality } from "./providers/types";
import { getSession, onSession } from "./session";
import { type Bucket, bucketFor, labelFor, TIER_COLOR } from "./format";
import { jellyfishSvg } from "./icon";
import { trace } from "./trace";

/**
 * Turns TIDAL's own audio-quality badge into the AltPlay control:
 *  - while playing from a provider, show the provider stream's quality on the badge
 *    (TIDAL-styled text like "16-bit 44.1kHz" + the matching gradient colour),
 *  - whenever the current track has a match, add a marker and make the badge open the
 *    AltPlay overlay on click.
 *
 * The override is NON-DESTRUCTIVE: we never touch TIDAL's own text/classes (which during
 * our muted playback read "LOW"). We hide TIDAL's text span and show our own, and drive
 * the colour via the gradient layers' inline opacity. Clearing just removes our bits, so
 * TIDAL's real value (e.g. the next hi-res track) reappears immediately.
 *
 * The badge is WIDENED (width: auto) so longer text keeps TIDAL's original font size
 * instead of shrinking, and the jellyfish marker always wears the quality colour.
 */

const MARK_CLASS = "altplay-mark";
const MY_TEXT_CLASS = "altplay-badge-text";
const MARK_SIZE = 21;
const OFF_COLOR = "rgba(255,255,255,0.38)"; // marker grey while the replacement is OFF
const MARK_GAP = 7; // px between jellyfish and text
const PAD = 12; // px breathing room left/right of the badge content
const BORDER = 3; // TIDAL's 1.5px border on each side (box-sizing: border-box)

let active = false;
let curText = "";
let curBucket: Bucket = "high";
let myTextSpan: HTMLSpanElement | null = null;
let overriddenAnchor: HTMLElement | null = null;
let lastDiag = 0; // rate limit for the width-mismatch diagnostic

function findBadge(): { anchor: HTMLElement; badgeText: HTMLElement; textSpan: HTMLElement } | null {
	const anchor = document.querySelector('a[data-test^="quality-badge"]') as HTMLElement | null;
	if (!anchor) return null;
	const badgeText = anchor.querySelector('[class*="_badgeText"]') as HTMLElement | null;
	const textSpan = (badgeText?.querySelector(`span:not(.${MY_TEXT_CLASS})`) as HTMLElement | null) ?? badgeText ?? anchor;
	return { anchor, badgeText: badgeText ?? anchor, textSpan };
}

function gradientDivs(a: HTMLElement): Record<Bucket, HTMLElement | null> {
	return {
		low: a.querySelector('[class*="_gradientLow"]'),
		high: a.querySelector('[class*="_gradientHigh"]'),
		max: a.querySelector('[class*="_gradientMax"]'),
	};
}
function setGradient(a: HTMLElement, bucket: Bucket) {
	const g = gradientDivs(a);
	(Object.keys(g) as Bucket[]).forEach((k) => {
		const el = g[k];
		if (el) el.style.opacity = k === bucket ? "1" : "0";
	});
}
function clearGradient(a: HTMLElement) {
	Object.values(gradientDivs(a)).forEach((el) => el?.style.removeProperty("opacity"));
}

const imp = (el: HTMLElement, prop: string, val: string) => el.style.setProperty(prop, val, "important");

/**
 * Make the badge exactly wide enough for ONE line: marker + text + padding.
 * Used both while we show our own quality text (hijack) and while TIDAL's own
 * text is visible next to our marker (match without replacement) - without this
 * the marker eats into TIDAL's fixed 121px and the text wraps to two lines.
 */
function sizeBadge(anchor: HTMLElement, textEl: HTMLElement | null) {
	imp(anchor, "padding-left", `${PAD}px`);
	imp(anchor, "padding-right", `${PAD}px`);
	imp(anchor, "display", "flex");
	imp(anchor, "align-items", "center");
	imp(anchor, "justify-content", "center");
	imp(anchor, "box-sizing", "border-box");
	const markEl = anchor.querySelector<HTMLElement>(`.${MARK_CLASS}`);
	const contentW = (markEl ? markEl.offsetWidth + MARK_GAP : 0) + (textEl?.offsetWidth ?? 0);
	if (contentW <= 0) return;
	const total = Math.ceil(contentW) + 2 * PAD + BORDER + 2; // +2 rounding slack
	imp(anchor, "width", `${total}px`);
	imp(anchor, "min-width", `${total}px`);
	imp(anchor, "max-width", `${total}px`);
	const wrap = anchor.parentElement;
	if (wrap) {
		imp(wrap, "width", `${total}px`);
		imp(wrap, "min-width", `${total}px`);
		imp(wrap, "max-width", `${total}px`);
		imp(wrap, "flex-shrink", "0");
	}
	// Diagnostic: if something STILL wins against inline !important, show what.
	const actual = anchor.getBoundingClientRect().width;
	if (Math.abs(actual - total) > 2 && Date.now() - lastDiag > 3000) {
		lastDiag = Date.now();
		const cs = getComputedStyle(anchor);
		trace.warn(
			"[badge] width mismatch:",
			`target=${total}`,
			`actual=${Math.round(actual)}`,
			`csWidth=${cs.width}`,
			`pad=${cs.paddingLeft}/${cs.paddingRight}`,
			`maxW=${cs.maxWidth}`,
			`mark=${markEl?.offsetWidth ?? "none"}`,
			`text=${textEl?.offsetWidth ?? "none"}`,
			`cls=${anchor.className}`,
		);
	}
}

function clearBadgeSizing(a: HTMLElement) {
	for (const p of ["width", "min-width", "max-width", "padding-left", "padding-right", "display", "align-items", "justify-content", "box-sizing", "flex-shrink", "overflow"])
		a.style.removeProperty(p);
	const wrap = a.parentElement;
	if (wrap) for (const p of ["width", "min-width", "max-width", "flex-shrink", "overflow"]) wrap.style.removeProperty(p);
}

function applyQuality() {
	const b = findBadge();
	if (!b) return;
	overriddenAnchor = b.anchor;
	if (b.textSpan !== myTextSpan) b.textSpan.style.display = "none";
	if (!myTextSpan || !myTextSpan.isConnected) {
		myTextSpan = document.createElement("span");
		myTextSpan.className = MY_TEXT_CLASS;
		myTextSpan.style.position = "relative";
		myTextSpan.style.zIndex = "2";
		myTextSpan.style.whiteSpace = "nowrap";
		myTextSpan.style.flexShrink = "0";
		b.badgeText.insertBefore(myTextSpan, b.badgeText.firstChild);
	}
	if (myTextSpan.textContent !== curText) myTextSpan.textContent = curText;
	myTextSpan.style.fontWeight = "600";
	// Pin the font to TIDAL's own badge size so it never scales down.
	myTextSpan.style.fontSize = getComputedStyle(b.textSpan).fontSize;
	myTextSpan.style.color = TIER_COLOR[curBucket];

	sizeBadge(b.anchor, myTextSpan);
	setGradient(b.anchor, curBucket);
}

export function showQuality(q: StreamQuality) {
	curText = labelFor(q);
	curBucket = bucketFor(q);
	active = true;
	applyQuality();
}

export function reassertBadge() {
	if (active) applyQuality();
}

export function clearBadge() {
	active = false;
	if (myTextSpan) {
		myTextSpan.remove();
		myTextSpan = null;
	}
	const a = overriddenAnchor ?? findBadge()?.anchor ?? null;
	if (a) {
		clearGradient(a);
		clearBadgeSizing(a);
		const badgeText = a.querySelector('[class*="_badgeText"]') as HTMLElement | null;
		const orig = (badgeText?.querySelector("span") as HTMLElement | null) ?? badgeText;
		if (orig) {
			orig.style.removeProperty("display"); // unhide TIDAL's own text
			orig.style.removeProperty("white-space");
		}
	}
	overriddenAnchor = null;
}

// ---------------------------------------------------------------- marker + click

function decorate(hasMatch: boolean) {
	const b = findBadge();
	if (!b) return;
	const a = b.anchor;
	let mark = a.querySelector<HTMLElement>(`.${MARK_CLASS}`);
	if (hasMatch) {
		if (!mark) {
			mark = document.createElement("span");
			mark.className = MARK_CLASS;
			mark.innerHTML = jellyfishSvg(MARK_SIZE);
			mark.style.display = "inline-flex";
			mark.style.alignItems = "center";
			mark.style.marginRight = `${MARK_GAP}px`;
			mark.style.position = "relative";
			mark.style.zIndex = "2";
			mark.style.flexShrink = "0";
			b.badgeText.parentElement?.insertBefore(mark, b.badgeText);
		}
		// Marker colour: while AltPlay is actually playing, ALWAYS the current
		// quality tier (gold / teal / muted) - grey when the replacement is off.
		const s = getSession();
		mark.style.color = s.hijacked && s.quality ? TIER_COLOR[bucketFor(s.quality)] : OFF_COLOR;
		a.style.cursor = "pointer";
		// TIDAL's own text is visible next to our marker (no replacement running):
		// keep it on ONE line and widen the badge to fit marker + text.
		if (!active) {
			imp(b.textSpan, "white-space", "nowrap");
			sizeBadge(a, b.textSpan);
		}
	} else {
		mark?.remove();
		if (!active) {
			clearBadgeSizing(a);
			b.textSpan.style.removeProperty("white-space");
		}
	}
}

export function initBadge(unloads: Set<LunaUnload>, onOpen: (anchor: HTMLElement) => void) {
	const refresh = () => decorate(!!getSession().match);
	unloads.add(onSession(refresh));
	safeInterval(unloads, refresh, 500);
	refresh();

	// During hijacked TIDAL playback React re-renders the badge (quality transitions)
	// and wipes our styling - and showQuality() often measures BEFORE the marker is
	// re-inserted. Re-measure + re-apply continuously while the override is active.
	safeInterval(unloads, reassertBadge, 300);

	const onClick = (e: MouseEvent) => {
		const anchor = (e.target as Element)?.closest?.('a[data-test^="quality-badge"]') as HTMLElement | null;
		if (!anchor || !getSession().match) return;
		e.preventDefault();
		e.stopImmediatePropagation();
		onOpen(anchor);
	};
	document.addEventListener("click", onClick, true);
	unloads.add(() => document.removeEventListener("click", onClick, true));
	unloads.add(() => decorate(false));
}
