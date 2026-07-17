import { settings } from "./settings";

const STAR_ON = "var(--star-on, #ffc531)";
const STAR_OFF = "var(--star-off, rgba(255,255,255,0.28))";

const STAR_PATH_D =
	"M20.388,10.918L32,12.118l-8.735,7.749L25.914,31.4l-9.893-6.088L6.127,31.4l2.695-11.533L0,12.118l11.547-1.2L16.026,0.6L20.388,10.918z";

const XMLNS = "http://www.w3.org/2000/svg";

/** [starsSpan, starElements[5] = [svg, offPath, onPath, fillRect], optionalLabel] */
export type StarData = [HTMLSpanElement, SVGElement[][], HTMLSpanElement | undefined];

function createStar(starsId: string, n: number, size: number) {
	const star = document.createElementNS(XMLNS, "svg");
	const id = `${starsId}-${n}`;
	star.id = id;
	star.style.minHeight = `${size}px`;
	star.style.minWidth = `${size}px`;
	star.style.cursor = "pointer";
	star.setAttributeNS(null, "width", `${size}px`);
	star.setAttributeNS(null, "height", `${size}px`);
	star.setAttributeNS(null, "viewBox", "0 0 32 32");

	// A single clip rect reveals the "on" star left-to-right by fraction (set in setRating).
	const defs = document.createElementNS(XMLNS, "defs");
	const clipId = `${id}-fill`;
	const clip = document.createElementNS(XMLNS, "clipPath");
	clip.id = clipId;
	const rect = document.createElementNS(XMLNS, "rect");
	rect.setAttributeNS(null, "x", "0");
	rect.setAttributeNS(null, "y", "0");
	rect.setAttributeNS(null, "width", "0"); // fraction * 32
	rect.setAttributeNS(null, "height", "32");
	clip.append(rect);
	defs.append(clip);
	star.append(defs);

	// One continuous star underneath (off colour) - no internal seams / cross artefacts.
	const offPath = document.createElementNS(XMLNS, "path");
	offPath.setAttributeNS(null, "fill", STAR_OFF);
	offPath.setAttributeNS(null, "d", STAR_PATH_D);
	star.append(offPath);

	// The same star on top (on colour), revealed by the clip rect.
	const onPath = document.createElementNS(XMLNS, "path");
	onPath.setAttributeNS(null, "fill", STAR_ON);
	onPath.setAttributeNS(null, "d", STAR_PATH_D);
	onPath.setAttributeNS(null, "clip-path", `url(#${clipId})`);
	star.append(onPath);

	// [svg, offPath, onPath, fillRect]
	return [star, offPath, onPath, rect] as const;
}

export function createStars(idSuffix: string, size: number): StarData {
	const stars = document.createElement("span");
	const id = `stars-${idSuffix}`;
	stars.className = "stars";
	stars.id = id;
	stars.style.whiteSpace = "nowrap";
	stars.style.alignItems = "center";
	stars.style.display = "flex";

	const starElements: SVGElement[][] = [];
	for (let i = 0; i < 5; i++) {
		const [star, offPath, onPath, rect] = createStar(id, i + 1, size);
		stars.append(star);
		starElements.push([star, offPath, onPath, rect]);
	}

	let label: HTMLSpanElement | undefined;
	if (settings.showExactRating) {
		label = document.createElement("span");
		label.className = "stars-rating-label";
		label.style.marginLeft = "6px";
		label.style.fontSize = "0.9em";
		label.style.opacity = "0.9";
		stars.append(label);
	}
	return [stars, starElements, label];
}

/** Paint `rating` (0-5) by revealing each star's fill fraction, honouring granularity. */
export function setRating(starElements: SVGElement[][], rating: number, label?: HTMLElement | null) {
	if (settings.showExactRating && label && rating) label.textContent = rating.toFixed(2);

	for (let i = 0; i < 5; i++) {
		let frac = Math.max(0, Math.min(1, rating - i)); // fill fraction of star i
		if (settings.quarterStarRatings) frac = Math.round(frac * 4) / 4;
		else if (settings.halfStarRatings) frac = Math.round(frac * 2) / 2;
		else frac = Math.round(frac);
		(starElements[i][3] as SVGRectElement).setAttributeNS(null, "width", `${frac * 32}`);
	}
}

/**
 * Wire hover-preview + click-to-rate onto a stars widget.
 * All click/press/drag events are captured at the container so nothing behind
 * the stars (row play, seek bar, volume, etc.) ever reacts to them.
 */
export function wireStarInteractions(
	starData: StarData,
	opts: {
		getTrackId: () => string | null;
		currentRating: (trackId: string) => number | null;
		rate: (trackId: string, rating: number) => unknown;
		afterRate?: () => void;
	},
): void {
	const [span, starElements, label] = starData;
	const svgs = starElements.map((el) => el[0] as SVGSVGElement);

	const repaint = () => setRating(starElements, opts.currentRating(opts.getTrackId() ?? "") ?? 0, label);
	span.addEventListener("mouseout", repaint);
	for (let i = 0; i < 5; i++) {
		svgs[i].addEventListener("mousemove", (e) => setRating(starElements, getMouseoverRating(e, svgs[i], i), label));
	}

	// Single capture-phase click handler: fully owns the click, nothing leaks through.
	span.addEventListener(
		"click",
		async (e) => {
			e.stopPropagation();
			e.preventDefault();
			const svg = (e.target as Element)?.closest?.("svg") as SVGSVGElement | null;
			const i = svg ? svgs.indexOf(svg) : -1;
			const id = opts.getTrackId();
			if (i < 0 || !id) return;
			await opts.rate(id, getMouseoverRating(e, svgs[i], i));
			opts.afterRate?.();
		},
		true,
	);

	// Swallow every press/drag event at the container (capture) so the UI behind is inert.
	const swallow = (e: Event) => e.stopPropagation();
	for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "dblclick", "contextmenu", "dragstart", "auxclick"]) {
		span.addEventListener(type, swallow, true);
	}
}

/** Compute the rating implied by the mouse position over star index `i`. */
export function getMouseoverRating(ev: MouseEvent, star: Element, i: number): number {
	const rect = star.getBoundingClientRect();
	const offsetX = ev.clientX - rect.left;
	const offsetY = ev.clientY - rect.top;
	const isRight = offsetX > rect.width / 2;
	const isTop = offsetY < rect.height / 2;

	if (settings.quarterStarRatings) {
		if (i === 0 && offsetX < 3) return 0;
		if (!isRight && !isTop) return i + 0.25; // BL
		if (!isRight && isTop) return i + 0.5; // TL
		if (isRight && isTop) return i + 0.75; // TR
		return i + 1.0; // BR
	}
	const half = isRight || !settings.halfStarRatings;
	const zeroStars = i === 0 && offsetX < 3;
	let rating = i + 1;
	if (!half) rating -= 0.5;
	if (zeroStars) rating -= settings.halfStarRatings ? 0.5 : 1.0;
	return rating;
}
