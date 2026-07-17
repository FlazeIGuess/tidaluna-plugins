import type { LunaUnload } from "@luna/core";
import { ContextMenu } from "@luna/lib";
import { settings } from "./settings";
import { createWeightedPlaylist } from "./weighted";
import { trace } from "./trace";

export function initContextMenus(unloads: Set<LunaUnload>) {
	const createBtn = ContextMenu.addButton(unloads);
	createBtn.text = "Create weighted playlist";

	ContextMenu.onMediaItem(unloads, async ({ mediaCollection, contextMenu }) => {
		const collection = mediaCollection as { uuid?: string | number; tidalPlaylist?: { uuid?: string } };
		const isPlaylist = "tidalPlaylist" in mediaCollection && !!collection.tidalPlaylist;
		const uuid = collection.uuid ?? collection.tidalPlaylist?.uuid;
		if (!isPlaylist || uuid == null) return;

		createBtn.onClick(async () => {
			trace.msg.log("Creating weighted playlist...");
			const res = await createWeightedPlaylist(String(uuid), settings.weightedPlaylistSize);
			if (res) trace.msg.log(`Weighted playlist created (${settings.weightedPlaylistSize} tracks)`);
			else trace.msg.warn("Failed to create weighted playlist (check the mirror/write API)");
		});
		await createBtn.show(contextMenu);
	});
}
