import type { StreamQuality } from "./providers/types";

/** Quality tier mapping + label formatting, shared by badge, tooltip, overlay and page. */

export type Bucket = "max" | "high" | "low";

const LOSSLESS = ["flac", "wav", "pcm", "alac", "aiff", "ape", "wavpack"];

// Colour per audio-quality tier (gold = hi-res, teal = lossless, muted = lossy).
export const TIER_COLOR: Record<Bucket, string> = {
	max: "var(--altplay-gold, #ffcf5c)",
	high: "var(--altplay-lossless, #33d9e6)",
	low: "rgba(255,255,255,0.72)",
};
export const NEUTRAL = "rgba(255,255,255,0.72)";

export function isLossless(q: StreamQuality): boolean {
	const codec = (q.codec || q.container || "").toLowerCase();
	return LOSSLESS.some((x) => codec.includes(x));
}

export function bucketFor(q: StreamQuality): Bucket {
	if (isLossless(q)) return (q.sampleRateHz ?? 0) > 48000 || (q.bitDepth ?? 0) > 16 ? "max" : "high";
	if ((q.bitrateKbps ?? 0) >= 256) return "high";
	return "low";
}

/** TIDAL-styled badge label like "24-bit 192.0kHz" or "320 kbps". */
export function labelFor(q: StreamQuality): string {
	if (isLossless(q) && q.sampleRateHz) {
		const khz = `${(q.sampleRateHz / 1000).toFixed(1)}kHz`;
		return q.bitDepth ? `${q.bitDepth}-bit ${khz}` : khz;
	}
	if (q.bitrateKbps) return `${Math.round(q.bitrateKbps)} kbps`;
	return (q.container || q.codec || "").toUpperCase();
}

/** Full one-line quality description for tooltips/overlay. */
export function fullQuality(q: StreamQuality): string {
	const cont = (q.container || q.codec || "").toUpperCase();
	const khz = q.sampleRateHz ? `${(q.sampleRateHz / 1000).toFixed(1)}kHz` : "";
	const depth = q.bitDepth ? `${q.bitDepth}-bit` : "";
	const ch = q.channels === 1 ? "mono" : q.channels === 2 ? "stereo" : q.channels ? `${q.channels}ch` : "";
	const br = q.bitrateKbps ? `${Math.round(q.bitrateKbps)} kbps` : "";
	return [depth, khz, cont, ch, br].filter(Boolean).join(" · ");
}

/** Compact label for list rows, e.g. "24/96" or "320k". */
export function shortQuality(q: StreamQuality): string {
	if (q.bitDepth && q.sampleRateHz) {
		const khz = q.sampleRateHz / 1000;
		return `${q.bitDepth}/${khz % 1 === 0 ? khz : khz.toFixed(1)}`;
	}
	if (q.bitrateKbps) return `${Math.round(q.bitrateKbps)}k`;
	return (q.container || q.codec || "").toUpperCase();
}
