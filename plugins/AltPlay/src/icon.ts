/** The AltPlay jellyfish mark, shared by badge, tooltip, row markers, sidebar and page. */
export function jellyfishSvg(size: number): string {
	return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">
	<path d="M4 12.5a8 8 0 0 1 16 0v.5H4z" fill="currentColor"/>
	<path d="M7 14.5c0 1.6-1 2.3-1 3.7M12 14.5c0 1.7 0 2.5 0 4M17 14.5c0 1.6 1 2.3 1 3.7" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>
</svg>`;
}
