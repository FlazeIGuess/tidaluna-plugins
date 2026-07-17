import React from "react";
import {
	LunaSettings,
	LunaSwitchSetting,
	LunaNumberSetting,
	LunaSelectSetting,
	LunaSelectItem,
	LunaButtonSetting,
} from "@luna/ui";
import { settings, type PlayMode, type StarsPosition, type WeightKind } from "./settings";
import { syncRatedFolder } from "./ratedFolder";

export const Settings = () => {
	// --- display ---
	const [halfStar, setHalfStar] = React.useState(settings.halfStarRatings);
	const [quarterStar, setQuarterStar] = React.useState(settings.quarterStarRatings);
	const [showExact, setShowExact] = React.useState(settings.showExactRating);
	const [showPlaylistStars, setShowPlaylistStars] = React.useState(settings.showPlaylistStars);
	const [npPosition, setNpPosition] = React.useState<StarsPosition>(settings.nowPlayingStarsPosition);
	const [colorByQuality, setColorByQuality] = React.useState(settings.colorStarsByQuality);
	const [albumAverage, setAlbumAverage] = React.useState(settings.showAlbumAverage);

	// --- behaviour ---
	const [defaultRating, setDefaultRating] = React.useState(settings.defaultRating);
	const [averageRatings, setAverageRatings] = React.useState(settings.averageRatings);
	const [likeThreshold, setLikeThreshold] = React.useState(settings.likeThreshold);
	const [skipThreshold, setSkipThreshold] = React.useState(settings.skipThreshold);
	const [play, setPlay] = React.useState<PlayMode>(settings.play);
	const [syncDup, setSyncDup] = React.useState(settings.syncDuplicateSongs);
	const [shortcuts, setShortcuts] = React.useState(settings.enableKeyboardShortcuts);

	// --- weighted ---
	const [weightedOn, setWeightedOn] = React.useState(settings.weightedPlaybackEnabled);
	const [weightKind, setWeightKind] = React.useState<WeightKind>(settings.weightKind);
	const [weightBase, setWeightBase] = React.useState(settings.weightBase);
	const [reEnqueue, setReEnqueue] = React.useState(settings.reEnqueueWorkaround);
	const [weightedSize, setWeightedSize] = React.useState(settings.weightedPlaylistSize);

	// --- Rated folder ---
	const [syncRated, setSyncRated] = React.useState(settings.syncRatedPlaylists);
	const [reimporting, setReimporting] = React.useState(false);

	return (
		<LunaSettings>
			{/* Display */}
			<LunaSwitchSetting
				title="Half-star ratings"
				desc="Allow ratings in 0.5 steps."
				checked={halfStar}
				onChange={(_: unknown, c: boolean) => setHalfStar((settings.halfStarRatings = c))}
			/>
			<LunaSwitchSetting
				title="Quarter-star ratings"
				desc="Allow ratings in 0.25 steps (overrides half stars)."
				checked={quarterStar}
				onChange={(_: unknown, c: boolean) => setQuarterStar((settings.quarterStarRatings = c))}
			/>
			<LunaSwitchSetting
				title="Show exact rating"
				desc="Show the numeric rating next to the stars."
				checked={showExact}
				onChange={(_: unknown, c: boolean) => setShowExact((settings.showExactRating = c))}
			/>
			<LunaSwitchSetting
				title="Show stars in track lists"
				desc="Inject stars into playlist/album track rows."
				checked={showPlaylistStars}
				onChange={(_: unknown, c: boolean) => setShowPlaylistStars((settings.showPlaylistStars = c))}
			/>
			<LunaSelectSetting
				title="Now-playing stars position"
				value={npPosition}
				onChange={(e: any) => setNpPosition((settings.nowPlayingStarsPosition = e.target.value))}
			>
				<LunaSelectItem value="right">Right (player controls)</LunaSelectItem>
				<LunaSelectItem value="left">Left (track info)</LunaSelectItem>
			</LunaSelectSetting>
			<LunaSwitchSetting
				title="Colour stars by audio quality"
				desc="HiRes tracks keep gold stars; everything else turns turquoise."
				checked={colorByQuality}
				onChange={(_: unknown, c: boolean) => setColorByQuality((settings.colorStarsByQuality = c))}
			/>
			<LunaSwitchSetting
				title="Show album average rating"
				desc="Show the average of an album's track ratings under its header, coloured by quality."
				checked={albumAverage}
				onChange={(_: unknown, c: boolean) => setAlbumAverage((settings.showAlbumAverage = c))}
			/>

			{/* Behaviour */}
			<LunaNumberSetting
				title="Default rating"
				desc="Assumed rating for unrated tracks (weighting)."
				min={0}
				max={5}
				value={defaultRating}
				onNumber={(v: number) => setDefaultRating((settings.defaultRating = v))}
			/>
			<LunaSwitchSetting
				title="Average ratings over time"
				desc="Keep rating history; canonical rating is a time-weighted average."
				checked={averageRatings}
				onChange={(_: unknown, c: boolean) => setAverageRatings((settings.averageRatings = c))}
			/>
			<LunaNumberSetting
				title="Like threshold"
				desc="Add to TIDAL favourites when rated at least this. -1 = off."
				min={-1}
				max={5}
				value={likeThreshold}
				onNumber={(v: number) => setLikeThreshold((settings.likeThreshold = v))}
			/>
			<LunaNumberSetting
				title="Skip threshold"
				desc="Auto-skip tracks rated at most this on play. -1 = off."
				min={-1}
				max={5}
				value={skipThreshold}
				onNumber={(v: number) => setSkipThreshold((settings.skipThreshold = v))}
			/>
			<LunaSelectSetting title="Play filter" value={play} onChange={(e: any) => setPlay((settings.play = e.target.value))}>
				<LunaSelectItem value="all">All tracks</LunaSelectItem>
				<LunaSelectItem value="onlyrated">Only rated</LunaSelectItem>
				<LunaSelectItem value="onlyunrated">Only unrated</LunaSelectItem>
			</LunaSelectSetting>
			<LunaSwitchSetting
				title="Sync duplicate songs (ISRC)"
				desc="Apply a rating to every track sharing the same ISRC."
				checked={syncDup}
				onChange={(_: unknown, c: boolean) => setSyncDup((settings.syncDuplicateSongs = c))}
			/>
			<LunaSwitchSetting
				title="Keyboard shortcuts"
				desc="Ctrl+Alt+Numpad 0-9 rates the now-playing track."
				checked={shortcuts}
				onChange={(_: unknown, c: boolean) => setShortcuts((settings.enableKeyboardShortcuts = c))}
			/>

			{/* Weighted */}
			<LunaSwitchSetting
				title="Weighted playback"
				desc="Keep one weighted-random track queued (weighted by rating)."
				checked={weightedOn}
				onChange={(_: unknown, c: boolean) => setWeightedOn((settings.weightedPlaybackEnabled = c))}
			/>
			<LunaSelectSetting
				title="Weighting"
				value={weightKind}
				onChange={(e: any) => setWeightKind((settings.weightKind = e.target.value))}
			>
				<LunaSelectItem value="Linear">Linear</LunaSelectItem>
				<LunaSelectItem value="Exponential">Exponential</LunaSelectItem>
			</LunaSelectSetting>
			<LunaNumberSetting
				title="Exponential base"
				desc="Base used when weighting is Exponential."
				min={1}
				max={10}
				value={weightBase}
				onNumber={(v: number) => setWeightBase((settings.weightBase = v))}
			/>
			<LunaNumberSetting
				title="Weighted playlist size"
				desc="Track count for 'Create weighted playlist'."
				min={1}
				max={2000}
				value={weightedSize}
				onNumber={(v: number) => setWeightedSize((settings.weightedPlaylistSize = v))}
			/>
			<LunaSwitchSetting
				title="Re-enqueue workaround"
				desc="Re-add the weighted track after 1s (fixes some remote-play setups)."
				checked={reEnqueue}
				onChange={(_: unknown, c: boolean) => setReEnqueue((settings.reEnqueueWorkaround = c))}
			/>

			{/* Rated folder */}
			<LunaSwitchSetting
				title="Sync ratings to the 'Rated' folder"
				desc="Keep TIDAL playlists 0.0-5.0 (in a 'Rated' folder) in sync: rating a track adds it to the matching playlist and removes it from the old one."
				checked={syncRated}
				onChange={(_: unknown, c: boolean) => setSyncRated((settings.syncRatedPlaylists = c))}
			/>
			<LunaButtonSetting
				title="Re-import from playlists"
				desc="Seed local ratings again from every 0.0-5.0 playlist in the 'Rated' folder. Only fills in tracks that aren't rated locally yet."
				disabled={reimporting}
				onClick={async () => {
					setReimporting(true);
					settings._ratedImported = false; // force the one-time import to run again
					try {
						await syncRatedFolder();
					} finally {
						setReimporting(false);
					}
				}}
			>
				{reimporting ? "Importing…" : "Re-import now"}
			</LunaButtonSetting>
		</LunaSettings>
	);
};
