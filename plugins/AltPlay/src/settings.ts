import { ReactiveStore } from "@luna/core";

// Flat primitives only - safe to store directly in a ReactiveStore.
export const settings = await ReactiveStore.getPluginStorage("AltPlay.settings", {
	autoPlay: true, // automatically play a matched track from the provider instead of TIDAL
	onlyBetterQuality: false, // only replace when the Jellyfin file beats TIDAL's stream quality
});
