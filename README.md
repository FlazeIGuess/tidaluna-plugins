# Flaze's TidaLuna plugins

A small collection of plugins for [TIDAL](https://tidal.com), built on
[TidaLuna](https://github.com/Inrixia/TidaLuna).

## Plugins

### Star Ratings

An interactive 5-star rating system - rate any track straight from the now-playing bar or
a track list. A TidaLuna port of [spicetify-star-ratings](https://github.com/brimell/spicetify-star-ratings),
adapted and extended for TIDAL.

![Star Ratings in TIDAL](assets/screenshot.png)

- **Rate anywhere** - click the stars in the now-playing bar or on any track-list row.
  Ratings in 0.5 steps (optional quarter-star mode).
- **Album averages** - album headers show the average of their rated tracks, in a subtle
  glass pill under the quality badge.
- **Stars coloured by audio quality** - HiRes tracks keep gold stars, everything else
  turns turquoise.
- **"Rated" folder sync** - on load the plugin finds (or creates) a `Rated` folder of
  playlists `0.0`-`5.0`. Rating a track adds it to the matching playlist and removes it
  from the old one; unrating removes it. Your ratings live in these playlists, so they
  survive reinstalls and sync across devices.
- **Local source of truth** - ratings are stored locally and mirrored to the folder
  playlists; a fresh install re-imports everything from the folder automatically.
- **Keyboard shortcuts** - `Ctrl+Alt+Numpad 0-9` rates the current track.
- **Weighted playback & playlists** - bias playback toward your higher-rated tracks, or
  generate a weighted playlist.
- **Play filters** - auto-skip tracks below a threshold, or only play rated / unrated
  tracks.

### AltPlay - **BETA**

> **AltPlay is in an early beta phase.** It works, but expect rough edges and the
> occasional glitch after TIDAL updates. See [its README](plugins/AltPlay/README.md) for
> the full beta notice and known limitations.

Play tracks from **your own media servers** (Jellyfin today, more planned) instead of
TIDAL whenever a matching file exists in your library. Higher-quality rips, versions TIDAL
removed, or songs that were never on TIDAL - AltPlay finds them in your library and plays
them while TIDAL's UI keeps working.

![The AltPlay library page](assets/altplay/library.png)

- Automatic, quality-aware replacement with TIDAL kept in sync.
- Native mode for songs that exist on both TIDAL and your server (real artist/album pages,
  full-screen, lyrics, credits - only the audio comes from Jellyfin).
- A dedicated, TIDAL-styled library page, track-list markers, search integration and
  Jellyfin Quick Connect sign-in.

Full details: **[plugins/AltPlay/README.md](plugins/AltPlay/README.md)**.

## Installation

1. Install [TidaLuna](https://github.com/Inrixia/TidaLuna).
2. In TIDAL, open **Luna Settings → Plugin Store**.
3. Add this store URL:
   ```
   https://github.com/FlazeIGuess/tidaluna-plugins/releases/download/latest/store.json
   ```
4. Install the plugins you want. **AltPlay is marked [BETA]** in the store.

## Development

Requires [Node.js](https://nodejs.org) and [pnpm](https://pnpm.io).

```sh
pnpm install
pnpm run watch
```

`pnpm run watch` builds with hot reload and serves a DEV store on `http://localhost:3000`,
which appears under **Plugin Store** in Luna Settings while developing.

## Credits

- Star Ratings is inspired by [brimell/spicetify-star-ratings](https://github.com/brimell/spicetify-star-ratings).
- Built on [TidaLuna](https://github.com/Inrixia/TidaLuna) by Inrixia.

## License

MIT - see [LICENSE](LICENSE).
