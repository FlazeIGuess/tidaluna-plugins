/**
 * Runs in Luna's NATIVE (Node/Electron) context - so it can call the Jellyfin API
 * without the renderer's CORS restrictions. Every export becomes an async IPC call
 * on the renderer side; args and return values must be plain/serializable.
 */

export type AuthResult =
	| { ok: true; token: string; userId: string; userName: string; serverName: string }
	| { ok: false; status: number; error: string };

export type JfItem = {
	id: string;
	name: string;
	artists: string[];
	albumArtist: string;
	album: string;
	durationSec: number;
};

export type JfAudioInfo = {
	codec: string;
	container: string;
	bitrateKbps?: number;
	sampleRateHz?: number;
	bitDepth?: number;
	channels?: number;
};

function authHeader(deviceId: string): string {
	return `MediaBrowser Client="TidaLuna AltPlay", Device="TIDAL Desktop", DeviceId="${deviceId}", Version="1.0.0"`;
}

/** Authenticate with username + password, returning an access token. */
export async function authenticate(serverUrl: string, username: string, password: string, deviceId: string): Promise<AuthResult> {
	try {
		const base = serverUrl.replace(/\/+$/, "");
		const res = await fetch(`${base}/Users/AuthenticateByName`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Emby-Authorization": authHeader(deviceId),
			},
			body: JSON.stringify({ Username: username, Pw: password }),
		});
		if (!res.ok) {
			const error = (await res.text().catch(() => "")).slice(0, 300);
			return { ok: false, status: res.status, error: error || `HTTP ${res.status}` };
		}
		const d: any = await res.json();
		if (!d?.AccessToken) return { ok: false, status: res.status, error: "No AccessToken in response" };
		return {
			ok: true,
			token: d.AccessToken,
			userId: d.User?.Id ?? "",
			userName: d.User?.Name ?? username,
			serverName: d.ServerId ?? "",
		};
	} catch (e: any) {
		return { ok: false, status: 0, error: String(e?.message ?? e) };
	}
}

export type QuickConnectStart = { ok: true; code: string; secret: string } | { ok: false; error: string };

/** Start a Quick Connect session: returns the code the user enters in their Jellyfin app. */
export async function quickConnectInitiate(serverUrl: string, deviceId: string): Promise<QuickConnectStart> {
	try {
		const base = serverUrl.replace(/\/+$/, "");
		const headers = { "X-Emby-Authorization": authHeader(deviceId) };
		let res = await fetch(`${base}/QuickConnect/Initiate`, { method: "POST", headers });
		if (res.status === 404 || res.status === 405) res = await fetch(`${base}/QuickConnect/Initiate`, { headers }); // older servers use GET
		if (!res.ok) {
			const t = (await res.text().catch(() => "")).slice(0, 200);
			return { ok: false, error: t || `HTTP ${res.status}${res.status === 401 ? " - is Quick Connect enabled on the server?" : ""}` };
		}
		const d: any = await res.json();
		if (!d?.Secret || !d?.Code) return { ok: false, error: "Unexpected response (no code/secret)" };
		return { ok: true, code: String(d.Code), secret: String(d.Secret) };
	} catch (e: any) {
		return { ok: false, error: String(e?.message ?? e) };
	}
}

/** Poll whether the user has approved the Quick Connect code yet. */
export async function quickConnectState(serverUrl: string, deviceId: string, secret: string): Promise<{ authenticated: boolean; error?: string }> {
	try {
		const base = serverUrl.replace(/\/+$/, "");
		const res = await fetch(`${base}/QuickConnect/Connect?secret=${encodeURIComponent(secret)}`, {
			headers: { "X-Emby-Authorization": authHeader(deviceId) },
		});
		if (!res.ok) return { authenticated: false, error: `HTTP ${res.status}` };
		const d: any = await res.json();
		return { authenticated: !!d?.Authenticated };
	} catch (e: any) {
		return { authenticated: false, error: String(e?.message ?? e) };
	}
}

/** Exchange an approved Quick Connect secret for a real access token. */
export async function quickConnectAuthenticate(serverUrl: string, deviceId: string, secret: string): Promise<AuthResult> {
	try {
		const base = serverUrl.replace(/\/+$/, "");
		const res = await fetch(`${base}/Users/AuthenticateWithQuickConnect`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Emby-Authorization": authHeader(deviceId) },
			body: JSON.stringify({ Secret: secret }),
		});
		if (!res.ok) {
			const error = (await res.text().catch(() => "")).slice(0, 300);
			return { ok: false, status: res.status, error: error || `HTTP ${res.status}` };
		}
		const d: any = await res.json();
		if (!d?.AccessToken) return { ok: false, status: res.status, error: "No AccessToken in response" };
		return {
			ok: true,
			token: d.AccessToken,
			userId: d.User?.Id ?? "",
			userName: d.User?.Name ?? "",
			serverName: d.ServerId ?? "",
		};
	} catch (e: any) {
		return { ok: false, status: 0, error: String(e?.message ?? e) };
	}
}

/** Search the user's audio library by term; returns lightweight candidates for matching. */
export async function searchAudio(serverUrl: string, token: string, userId: string, deviceId: string, term: string, limit: number): Promise<JfItem[]> {
	try {
		const base = serverUrl.replace(/\/+$/, "");
		const params = new URLSearchParams({
			userId,
			searchTerm: term,
			IncludeItemTypes: "Audio",
			MediaTypes: "Audio",
			Recursive: "true",
			Limit: String(limit),
			Fields: "RunTimeTicks,Artists,AlbumArtist,Album",
			EnableTotalRecordCount: "false",
		});
		const res = await fetch(`${base}/Items?${params.toString()}`, {
			headers: { "X-Emby-Authorization": authHeader(deviceId), "X-Emby-Token": token },
		});
		if (!res.ok) return [];
		const d: any = await res.json();
		return (d?.Items ?? []).map(
			(it: any): JfItem => ({
				id: String(it.Id),
				name: it.Name ?? "",
				artists: Array.isArray(it.Artists) ? it.Artists : [],
				albumArtist: it.AlbumArtist ?? "",
				album: it.Album ?? "",
				durationSec: it.RunTimeTicks ? Math.round(it.RunTimeTicks / 1e7) : 0,
			}),
		);
	} catch {
		return [];
	}
}

export type JfLibItem = JfItem & {
	container?: string;
	codec?: string;
	bitrateKbps?: number;
	sampleRateHz?: number;
	bitDepth?: number;
	channels?: number;
	hasImage: boolean;
};

export type JfLibPage = { items: JfLibItem[]; total: number };

/** One page of the user's full audio library (for the local AltPlay index). */
export async function listAudioPage(
	serverUrl: string,
	token: string,
	userId: string,
	deviceId: string,
	startIndex: number,
	limit: number,
): Promise<JfLibPage> {
	try {
		const base = serverUrl.replace(/\/+$/, "");
		const params = new URLSearchParams({
			userId,
			IncludeItemTypes: "Audio",
			MediaTypes: "Audio",
			Recursive: "true",
			SortBy: "SortName",
			SortOrder: "Ascending",
			StartIndex: String(startIndex),
			Limit: String(limit),
			Fields: "RunTimeTicks,Artists,AlbumArtist,Album,MediaSources",
			EnableTotalRecordCount: "true",
		});
		const res = await fetch(`${base}/Items?${params.toString()}`, {
			headers: { "X-Emby-Authorization": authHeader(deviceId), "X-Emby-Token": token },
		});
		if (!res.ok) return { items: [], total: 0 };
		const d: any = await res.json();
		const items: JfLibItem[] = (d?.Items ?? []).map((it: any): JfLibItem => {
			const src = it?.MediaSources?.[0];
			const audio = (src?.MediaStreams ?? []).find((s: any) => s.Type === "Audio");
			const bps = audio?.BitRate ?? src?.Bitrate;
			return {
				id: String(it.Id),
				name: it.Name ?? "",
				artists: Array.isArray(it.Artists) ? it.Artists : [],
				albumArtist: it.AlbumArtist ?? "",
				album: it.Album ?? "",
				durationSec: it.RunTimeTicks ? Math.round(it.RunTimeTicks / 1e7) : 0,
				container: src?.Container ?? undefined,
				codec: audio?.Codec ?? undefined,
				bitrateKbps: bps ? Math.round(bps / 1000) : undefined,
				sampleRateHz: audio?.SampleRate ?? undefined,
				bitDepth: audio?.BitDepth ?? undefined,
				channels: audio?.Channels ?? undefined,
				hasImage: !!it?.ImageTags?.Primary,
			};
		});
		return { items, total: typeof d?.TotalRecordCount === "number" ? d.TotalRecordCount : items.length };
	} catch {
		return { items: [], total: 0 };
	}
}

/** Diagnostic: fetch the first bytes of a stream URL from the NATIVE side (no CSP/CORS). */
export async function probeStream(url: string): Promise<{ ok: boolean; status: number; type: string; note: string }> {
	try {
		const started = Date.now();
		const res = await fetch(url, { headers: { Range: "bytes=0-255" } });
		const buf = await res.arrayBuffer().catch(() => null);
		return {
			ok: res.ok,
			status: res.status,
			type: res.headers.get("content-type") ?? "",
			note: `bytes=${buf?.byteLength ?? -1} took=${Date.now() - started}ms redirected=${res.url !== url}`,
		};
	} catch (e: any) {
		return { ok: false, status: 0, type: "", note: String(e?.message ?? e) };
	}
}

/** Audio format/bitrate/samplerate of an item (from its primary media source). */
export async function getItemAudioInfo(serverUrl: string, token: string, userId: string, deviceId: string, itemId: string): Promise<JfAudioInfo | null> {
	try {
		const base = serverUrl.replace(/\/+$/, "");
		const res = await fetch(`${base}/Users/${userId}/Items/${itemId}`, {
			headers: { "X-Emby-Authorization": authHeader(deviceId), "X-Emby-Token": token },
		});
		if (!res.ok) return null;
		const d: any = await res.json();
		const src = d?.MediaSources?.[0];
		const audio = (src?.MediaStreams ?? []).find((s: any) => s.Type === "Audio");
		if (!src && !audio) return null;
		const bps = audio?.BitRate ?? src?.Bitrate;
		return {
			codec: audio?.Codec ?? src?.Container ?? "",
			container: src?.Container ?? "",
			bitrateKbps: bps ? Math.round(bps / 1000) : undefined,
			sampleRateHz: audio?.SampleRate ?? undefined,
			bitDepth: audio?.BitDepth ?? undefined,
			channels: audio?.Channels ?? undefined,
		};
	} catch {
		return null;
	}
}
