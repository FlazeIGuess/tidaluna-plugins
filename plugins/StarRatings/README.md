# Star Ratings (TidaLuna)

Rate your music out of 5 interactive stars inside TIDAL. A TidaLuna port of
[brimell/spicetify-star-ratings](https://github.com/brimell/spicetify-star-ratings).

## Features

- Interactive star ratings on the **now-playing bar** and in **track lists**
- **Album average** rating shown on album headers
- **Stars coloured by audio quality** - HiRes gold, everything else turquoise
- **"Rated" folder sync** - auto-managed `0.0`-`5.0` playlists, kept in sync as you rate
- Whole / **half** / **quarter** star granularity + optional exact numeric label
- **Time-weighted average** ratings (6-month half-life) with the original 5-minute re-rate window
- **Keyboard shortcuts**: `Ctrl+Alt+Numpad 0-9` rate the current track
- **Weighted playback**: keeps one rating-weighted random track queued (linear / exponential)
- **Create weighted playlist** from a playlist's right-click menu
- **Play filters**: only rated / only unrated, plus a skip-below-threshold
- **Like above threshold** → adds to TIDAL favourites
- **Sync duplicate songs** by ISRC

## Storage model (hybrid)

Ratings live locally in Luna's `ReactiveStore` (IndexedDB, persisted as a JSON string) -
the **source of truth**, robust and instant. They are also mirrored into a **`Rated`
folder** of per-rating playlists (`0.0`-`5.0`): rating a track adds it to the matching
playlist and removes it from the old one. On a fresh install the local store is re-seeded
from those playlists automatically, so ratings survive reinstalls and sync across devices.

## Tuning after a TIDAL update

TIDAL uses hashed CSS class names. Every DOM anchor this plugin needs is centralised in
[`src/selectors.ts`](src/selectors.ts). If stars stop appearing after a TIDAL update,
open devtools (`Ctrl+Shift+I`), inspect the target element, and update the matching
stable class prefix there. The TIDAL playlist **write** endpoints used by the mirror /
weighted-playlist features live in [`src/tidal.ts`](src/tidal.ts) and may likewise need a
re-tune; the local rating store never depends on them.

## Development

```sh
pnpm run watch   # from the repo root
```

Then install from the DEV store under **Luna Settings → Plugin Store**.
