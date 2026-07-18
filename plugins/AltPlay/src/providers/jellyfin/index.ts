import type { ConnectResult, LibraryPage, LibraryTrack, ProviderMatch, SourceProvider, StreamQuality, TrackMeta } from "../types";
import { clearProviderConfig, getDeviceId, getProviderConfig, type ProviderConfig, setProviderConfig } from "../../store";
import {
	authenticate,
	getItemAudioInfo,
	listAudioPage,
	quickConnectAuthenticate,
	quickConnectInitiate,
	quickConnectState,
	searchAudio,
} from "./jellyfin.native";
import { scoreCandidate } from "../../normalize";
import { trace } from "../../trace";

const ID = "jellyfin";
const MIN_CONFIDENCE = 0.6; // strict: reject anything weaker

const cleanUrl = (serverUrl: string) => serverUrl.trim().replace(/\/+$/, "");

// ---------------------------------------------------------------- Quick Connect

/** Start Quick Connect: returns the code to enter in the Jellyfin app. */
export async function startQuickConnect(serverUrl: string): Promise<{ ok: true; code: string; secret: string } | { ok: false; error: string }> {
	const url = cleanUrl(serverUrl);
	if (!url) return { ok: false, error: "Server URL is required" };
	return quickConnectInitiate(url, getDeviceId());
}

/** Has the user approved the code yet? */
export async function pollQuickConnect(serverUrl: string, secret: string): Promise<{ authenticated: boolean; error?: string }> {
	return quickConnectState(cleanUrl(serverUrl), getDeviceId(), secret);
}

/** Exchange the approved secret for a token and store the login (like connect()). */
export async function finishQuickConnect(serverUrl: string, secret: string): Promise<ConnectResult> {
	const url = cleanUrl(serverUrl);
	const r = await quickConnectAuthenticate(url, getDeviceId(), secret);
	if (!r.ok) {
		trace.warn("Jellyfin Quick Connect auth failed:", r.error);
		return { ok: false, error: r.error };
	}
	setProviderConfig(ID, { serverUrl: url, token: r.token, userId: r.userId, userName: r.userName, enabled: true });
	trace.log(`Jellyfin connected via Quick Connect as ${r.userName}`);
	return { ok: true, userName: r.userName };
}

/** Directly-playable stream URL for an <audio> element (original file, no transcode). */
function streamUrl(cfg: ProviderConfig, itemId: string): string {
	return `${cfg.serverUrl}/Audio/${itemId}/stream?static=true&api_key=${encodeURIComponent(cfg.token)}`;
}

export const jellyfinProvider: SourceProvider = {
	id: ID,
	label: "Jellyfin",

	isAuthenticated: () => !!getProviderConfig(ID)?.token,
	currentUser: () => getProviderConfig(ID)?.userName ?? null,

	async connect(serverUrl, username, password): Promise<ConnectResult> {
		const url = serverUrl.trim();
		if (!url) return { ok: false, error: "Server URL is required" };
		const r = await authenticate(url, username, password, getDeviceId());
		if (!r.ok) {
			trace.warn("Jellyfin auth failed:", r.error);
			return { ok: false, error: r.error };
		}
		setProviderConfig(ID, {
			serverUrl: url.replace(/\/+$/, ""),
			token: r.token,
			userId: r.userId,
			userName: r.userName,
			enabled: true,
		});
		trace.log(`Jellyfin connected as ${r.userName}`);
		return { ok: true, userName: r.userName };
	},

	disconnect() {
		clearProviderConfig(ID);
		trace.log("Jellyfin disconnected");
	},

	async match(track: TrackMeta): Promise<ProviderMatch | null> {
		const cfg = getProviderConfig(ID);
		if (!cfg?.token || !track.title) return null;
		const items = await searchAudio(cfg.serverUrl, cfg.token, cfg.userId, getDeviceId(), track.title, 25);

		let best: { id: string; name: string } | null = null;
		let bestScore = 0;
		for (const it of items) {
			const s = scoreCandidate(track, it);
			if (s > bestScore) {
				bestScore = s;
				best = it;
			}
		}
		if (!best || bestScore < MIN_CONFIDENCE) return null;
		return { providerId: ID, itemId: best.id, title: best.name, streamUrl: streamUrl(cfg, best.id), confidence: bestScore };
	},

	streamUrl(match: ProviderMatch): string {
		const cfg = getProviderConfig(ID);
		return cfg ? streamUrl(cfg, match.itemId) : match.streamUrl;
	},

	async streamInfo(match: ProviderMatch): Promise<StreamQuality | null> {
		const cfg = getProviderConfig(ID);
		if (!cfg?.token) return null;
		return await getItemAudioInfo(cfg.serverUrl, cfg.token, cfg.userId, getDeviceId(), match.itemId);
	},

	async listLibrary(startIndex: number, limit: number): Promise<LibraryPage> {
		const cfg = getProviderConfig(ID);
		if (!cfg?.token) return { items: [], total: 0 };
		const page = await listAudioPage(cfg.serverUrl, cfg.token, cfg.userId, getDeviceId(), startIndex, limit);
		const items: LibraryTrack[] = page.items.map((it) => ({
			providerId: ID,
			itemId: it.id,
			title: it.name,
			artists: it.artists,
			albumArtist: it.albumArtist,
			album: it.album,
			durationSec: it.durationSec,
			quality:
				it.codec || it.container || it.bitrateKbps
					? {
							codec: it.codec,
							container: it.container,
							bitrateKbps: it.bitrateKbps,
							sampleRateHz: it.sampleRateHz,
							bitDepth: it.bitDepth,
							channels: it.channels,
						}
					: null,
			imageUrl: it.hasImage
				? `${cfg.serverUrl}/Items/${it.id}/Images/Primary?fillWidth=160&fillHeight=160&api_key=${encodeURIComponent(cfg.token)}`
				: null,
		}));
		return { items, total: page.total };
	},
};
