// Tiny in-process pub/sub so every visible star widget (now-playing bar + each
// tracklist row) repaints the moment a track's rating changes anywhere.

type Listener = (trackId: string) => void;
const listeners = new Set<Listener>();

export function onRatingChanged(cb: Listener): () => void {
	listeners.add(cb);
	return () => listeners.delete(cb);
}

export function emitRatingChanged(trackId: string) {
	for (const l of listeners) {
		try {
			l(trackId);
		} catch {
			/* ignore listener errors */
		}
	}
}
