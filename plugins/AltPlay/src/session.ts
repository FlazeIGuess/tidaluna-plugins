import type { ProviderMatch, StreamQuality } from "./providers/types";

/**
 * Shared, observable snapshot of "what AltPlay is doing right now". The engine writes
 * it; the badge marker and the overlay read + subscribe to it so they stay in sync.
 */

export type Session = {
	trackId: string | null;
	title: string;
	artist: string;
	match: ProviderMatch | null;
	quality: StreamQuality | null;
	hijacked: boolean;
	/** True while playing a library-page track that only exists on the provider (source locked). */
	libraryMode: boolean;
};

let session: Session = { trackId: null, title: "", artist: "", match: null, quality: null, hijacked: false, libraryMode: false };
const listeners = new Set<() => void>();

export const getSession = (): Session => session;

export function setSession(patch: Partial<Session>) {
	session = { ...session, ...patch };
	for (const l of listeners) {
		try {
			l();
		} catch {
			/* ignore listener errors */
		}
	}
}

export function onSession(cb: () => void): () => void {
	listeners.add(cb);
	return () => listeners.delete(cb);
}
