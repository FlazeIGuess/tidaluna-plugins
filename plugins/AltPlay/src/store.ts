import { ReactiveStore } from "@luna/core";
import type { LibraryTrack } from "./providers/types";

/**
 * Per-provider config (server + auth token). Kept provider-agnostic so more
 * providers than Jellyfin can be added later.
 */
export type ProviderConfig = {
	serverUrl: string;
	token: string;
	userId: string;
	userName: string;
	enabled: boolean;
};

export type PersistedLibrary = { providerId: string; syncedAt: number; tracks: LibraryTrack[] };

type Persisted = {
	deviceId: string; // stable id we present to the media server
	providers: Record<string, ProviderConfig>;
	trackOverrides: Record<string, boolean>; // per-track explicit on/off (overrides the global default)
	library: PersistedLibrary | null; // cached provider library index
};

const DEFAULTS: Persisted = { deviceId: "", providers: {}, trackOverrides: {}, library: null };

// Persist as a single JSON STRING - IndexedDB structured-clone rejects the nested
// reactive Proxies you get from storing objects/arrays directly (learned the hard way).
const store = await ReactiveStore.getPluginStorage("AltPlay.v1", { blob: "" });

export const data: Persisted = (() => {
	try {
		if (store.blob) return { ...DEFAULTS, ...(JSON.parse(store.blob) as Partial<Persisted>) };
	} catch {
		/* corrupt - start fresh */
	}
	return structuredClone(DEFAULTS);
})();

function persist() {
	store.blob = JSON.stringify(data);
}

if (!data.deviceId) {
	data.deviceId = crypto.randomUUID();
	persist();
}

export const getDeviceId = () => data.deviceId;
export const getProviderConfig = (id: string): ProviderConfig | undefined => data.providers[id];

export function setProviderConfig(id: string, cfg: ProviderConfig) {
	data.providers[id] = cfg;
	persist();
}

export function clearProviderConfig(id: string) {
	delete data.providers[id];
	persist();
}

/** Per-track override: explicit true/false, or undefined = use the global default. */
export const getTrackOverride = (trackId: string): boolean | undefined => data.trackOverrides[trackId];

export function setTrackOverride(trackId: string, on: boolean) {
	data.trackOverrides[trackId] = on;
	persist();
}

export const getLibraryCache = (): PersistedLibrary | null => data.library ?? null;

export function setLibraryCache(lib: PersistedLibrary | null) {
	data.library = lib;
	persist();
}
