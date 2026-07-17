import { getCredentials, TidalApi, redux } from "@luna/lib";

/**
 * Read paths reuse Luna's built-in `TidalApi`. Write paths (create folder/playlist,
 * add/remove items, favourite) are implemented here against TIDAL's private desktop API.
 *
 * Endpoints below were verified from live DevTools captures of the TIDAL desktop client:
 * - folders live under  https://api.tidal.com/v2/my-collection/playlists/folders
 * - playlist items live under  https://desktop.tidal.com/v1/playlists/{uuid}/items
 * They may need a re-tune after a TIDAL update - the local rating store never depends on them.
 */

const V1 = "https://desktop.tidal.com/v1";
const FOLDERS = "https://api.tidal.com/v2/my-collection/playlists/folders";

// Playlist item positions (used by DELETE .../items/{index}) are relative to this
// ordering, so we read items AND delete under the exact same order the client uses.
const ITEM_ORDER = "order=INDEX&orderDirection=ASC";

async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
	const headers = await TidalApi.getAuthHeaders();
	return fetch(url, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
}

function sessionField(name: string, fallback: string): string {
	try {
		return (redux.store.getState() as any).session?.[name] ?? fallback;
	} catch {
		return fallback;
	}
}

const countryCode = () => sessionField("countryCode", "US");
const locale = () => sessionField("locale", "en_US");

/** Shared query args every private-API call expects. */
function qs(): string {
	return `countryCode=${countryCode()}&locale=${locale()}&deviceType=DESKTOP`;
}

export type FolderEntry = { name: string; id: string };
export type PlaylistEntry = { name: string; uuid: string; numberOfTracks: number };

/**
 * List the folders + playlists directly inside `folderId` ("root" for the top level).
 * Cursor-paginated; we page until a short page is returned (with a hard cap).
 */
export async function listFolder(folderId: string): Promise<{ folders: FolderEntry[]; playlists: PlaylistEntry[] }> {
	const folders: FolderEntry[] = [];
	const playlists: PlaylistEntry[] = [];
	const limit = 50;
	let cursor = "";

	for (let page = 0; page < 40; page++) {
		const url =
			`${FOLDERS}?folderId=${encodeURIComponent(folderId)}&includeOnly=&offset=0&limit=${limit}` +
			`&order=DATE&orderDirection=DESC${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}&${qs()}`;
		const res = await authFetch(url);
		// Throw (don't return partial) so callers can't mistake a failed read for an
		// empty folder - which would create duplicate folders/playlists.
		if (!res.ok) throw new Error(`listFolder ${folderId} failed: ${res.status}`);
		const body = await res.json().catch(() => null);
		const items: any[] = body?.items ?? [];
		for (const it of items) {
			if (it.itemType === "FOLDER" && it.data?.id) folders.push({ name: it.name, id: it.data.id });
			else if (it.itemType === "PLAYLIST" && it.data?.uuid)
				playlists.push({ name: it.name, uuid: it.data.uuid, numberOfTracks: it.data.numberOfTracks ?? 0 });
		}
		if (items.length < limit) break; // last page
		cursor = body?.cursor ?? "";
		if (!cursor) break;
	}
	return { folders, playlists };
}

/** Create a folder at the root and return its id, or null on failure. */
export async function createFolder(name: string): Promise<string | null> {
	try {
		const url = `${FOLDERS}/create-folder?folderId=root&name=${encodeURIComponent(name)}&trns=&${qs()}`;
		const res = await authFetch(url, { method: "PUT" });
		if (!res.ok) return null;
		const body = await res.json().catch(() => null);
		return body?.data?.id ?? null;
	} catch {
		return null;
	}
}

/** Create a private playlist inside `folderId` and return its UUID, or null on failure. */
export async function createPlaylistInFolder(folderId: string, name: string, description = ""): Promise<string | null> {
	try {
		const url =
			`${FOLDERS}/create-playlist?folderId=${encodeURIComponent(folderId)}` +
			`&name=${encodeURIComponent(name)}&description=${encodeURIComponent(description)}&${qs()}`;
		const res = await authFetch(url, { method: "PUT" });
		if (!res.ok) return null;
		const body = await res.json().catch(() => null);
		return body?.data?.uuid ?? body?.uuid ?? null;
	} catch {
		return null;
	}
}

export type PlaylistTrack = { id: string; isrc: string | null };

/** Every track in a playlist (paginated), in playlist order. */
export async function getPlaylistTracks(playlistUuid: string): Promise<PlaylistTrack[]> {
	const out: PlaylistTrack[] = [];
	const limit = 50;
	for (let offset = 0; offset < 20000; offset += limit) {
		const res = await authFetch(`${V1}/playlists/${playlistUuid}/items?offset=${offset}&limit=${limit}&${ITEM_ORDER}&${qs()}`);
		// Throw on a failed read so the import can't mistake it for an empty playlist.
		if (!res.ok) throw new Error(`playlist items ${playlistUuid} failed: ${res.status}`);
		const body = await res.json().catch(() => null);
		const items: any[] = body?.items ?? [];
		for (const it of items) {
			const t = it?.item;
			if (t?.id != null) out.push({ id: String(t.id), isrc: t.isrc ?? null });
		}
		const total = body?.totalNumberOfItems ?? 0;
		if (items.length < limit || offset + limit >= total) break;
	}
	return out;
}

/** 0-based position of `trackId` in the playlist, or -1 if absent (for DELETE .../items/{index}). */
export async function findTrackIndex(playlistUuid: string, trackId: string): Promise<number> {
	const tracks = await getPlaylistTracks(playlistUuid);
	return tracks.findIndex((t) => t.id === String(trackId));
}

/** Current ETag of a playlist (required by add/remove as If-None-Match). */
async function playlistEtag(playlistUuid: string): Promise<string> {
	const res = await authFetch(`${V1}/playlists/${playlistUuid}?${qs()}`);
	return res.headers.get("etag") ?? "";
}

/** Add a track to a playlist. Fetches the ETag first (TIDAL rejects writes without it). */
export async function addTrackToPlaylist(playlistUuid: string, trackId: string): Promise<boolean> {
	try {
		const etag = await playlistEtag(playlistUuid);
		const res = await authFetch(`${V1}/playlists/${playlistUuid}/items?${qs()}`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded", "If-None-Match": etag },
			body: `trackIds=${encodeURIComponent(trackId)}&onArtifactNotFound=SKIP&onDupes=SKIP`,
		});
		return res.ok;
	} catch {
		return false;
	}
}

/** Remove a track (by 0-based playlist position) from a playlist. */
export async function removeTrackFromPlaylist(playlistUuid: string, index: number): Promise<boolean> {
	try {
		const etag = await playlistEtag(playlistUuid);
		const res = await authFetch(`${V1}/playlists/${playlistUuid}/items/${index}?${ITEM_ORDER}&${qs()}`, {
			method: "DELETE",
			headers: { "If-None-Match": etag },
		});
		return res.ok;
	} catch {
		return false;
	}
}

/** Add a track to the user's TIDAL favourites (used by the like-threshold). */
export async function addToFavorites(trackId: string): Promise<boolean> {
	try {
		const { userId } = await getCredentials();
		const res = await authFetch(`${V1}/users/${userId}/favorites/tracks?${qs()}`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: `trackIds=${encodeURIComponent(trackId)}&onArtifactNotFound=SKIP`,
		});
		return res.ok;
	} catch {
		return false;
	}
}

/** Track ids sharing an ISRC with the given track (for "sync duplicate songs"). */
export async function getTrackIdsWithSameIsrc(isrc: string): Promise<string[]> {
	const ids: string[] = [];
	try {
		for await (const track of TidalApi.isrc(isrc)) {
			if (track?.id) ids.push(String(track.id));
		}
	} catch {
		/* ignore */
	}
	return ids;
}

export { TidalApi };
