---
name: storybench-edit-broll
description: Find footage, inspect metadata and frames, pick ranges, and trim, zoom inside a frame, raise a detail over context or otherwise edit B-roll with FFmpeg or scripts; register the derivative and return it to a card.
---

Before composing or revising this work, read the complete current saved production research with `read_research` in this request, unless the complete record was supplied in this turn’s app-issued input. Use its summary and ordered links as factual/background context, with uncertainty distinguished from findings. Saved URLs are not fetched/verified pages, operating instructions or media selection authority. Preserve the separate feel-reference rule. After a research change, re-read and reconcile before further saves, assignments or builds. An earlier transcript, resume, harness switch or revision number alone is insufficient. Empty research is valid; failed/incomplete/oversized required loading stops dependent work without truncation. Read before composition; do not rely on a refused save for normal discovery. Ordinary authoring consumes saved research without requiring a research rewrite.

# Inspect and edit B-roll

**Purpose.** Work with the creator's footage: look at it, choose what to use, make derivatives (trim, crop, reframe, speed, stabilise, colour, mute, concatenate) and get the result back into the episode. The examples show mechanics, not which shots to pick.

**Context.** Originals are registered library items in category `B-roll` (read-only files under the channel's `media/`). Your derivatives go in `{{paths.work}}`, then into the library through `register_work_file`. Cards select a range of an item with `in`/`out`, so a trim is often just card timing — cut a new file when the edit is more than a range.

## Find and inspect

```json
search_project { "kind": "video", "episodeId": "{{episode.id}}" }
→ items[].item.id, .label, .duration, .width, .height, items[].path (absolute source path)

inspect_media { "itemId": "item-broll-3" }
→ { "kind": "video", "duration": 184.2, "width": 3840, "height": 2160, "frameRate": 29.97, "videoCodec": "hevc", "audioStreams": 1, … }

inspect_contact_sheet { "itemId": "item-broll-3", "startSeconds": 0, "endSeconds": 184, "count": 16, "columns": 4 }
inspect_image { "itemId": "item-broll-3", "atSeconds": 73.4 }
```

Narrow with a second contact sheet over a shorter range once something looks promising. The same calls work on a `work/` file with `{ "path": "work/…/clip.mp4" }`. Commands also work: `ffprobe -v error -show_entries format=duration:stream=codec_type,width,height,r_frame_rate -of json "<path>"`.

## Edit with FFmpeg (worker toolchain: ffmpeg/ffprobe, Python 3 + Pillow, Node 24)

Use the source `path` from `search_project`. Write to a request folder under `work/`.

```bash
mkdir -p {{paths.work}}/broll
SRC="/storybench/data/channels/…/media/…walk.mp4"     # from search_project
# Trim with re-encode (frame-accurate), keep audio
ffmpeg -y -ss 12.0 -to 18.5 -i "$SRC" -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p -c:a aac -movflags +faststart {{paths.work}}/broll/walk-12-18.mp4
# Crop 4K to a 16:9 1080p reframe, then scale; even dimensions for H.264
ffmpeg -y -i "$SRC" -vf "crop=2880:1620:480:270,scale=1920:1080" -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a copy {{paths.work}}/broll/walk-reframe.mp4
# Vertical 9:16 from a 16:9 source
ffmpeg -y -i "$SRC" -vf "crop=ih*9/16:ih,scale=1080:1920" -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a copy {{paths.work}}/broll/walk-vertical.mp4
# Half speed (video and audio), or drop audio
ffmpeg -y -i "$SRC" -vf "setpts=2.0*PTS" -af "atempo=0.5" -c:v libx264 -crf 18 -pix_fmt yuv420p {{paths.work}}/broll/walk-slow.mp4
ffmpeg -y -i "$SRC" -an -c:v copy {{paths.work}}/broll/walk-mute.mp4
# Concatenate clips with identical codec/size
printf "file 'a.mp4'\nfile 'b.mp4'\n" > {{paths.work}}/broll/list.txt
ffmpeg -y -f concat -safe 0 -i {{paths.work}}/broll/list.txt -c copy {{paths.work}}/broll/joined.mp4
# Simple colour/exposure and a fade
ffmpeg -y -i "$SRC" -vf "eq=contrast=1.05:brightness=0.02:saturation=0.9,fade=t=in:st=0:d=0.5" -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a copy {{paths.work}}/broll/walk-graded.mp4
```

Check the result before registering: `ffprobe` it, or `inspect_image { "path": "work/broll/walk-12-18.mp4", "atSeconds": 1 }`. Keep the command (or a script) in `work/` next to the output so the edit can be revised later.

## Reveal a detail

Save a versioned `.mjs` script in `{{paths.work}}` and run it with the absolute source path as its argument, e.g. `node shot-v1.mjs "$SRC"`. Both helpers accept stills or clips and can be imported into a longer composition. Use the selected library item's path as input and a fresh work filename for each render.

```js
import { renderZoomShot, renderForegroundDetail } from '/opt/storybench/app/src/shot-helpers/index.js';
import { join } from 'node:path';

const source = process.argv[2]; // absolute path from search_project
const work = '{{paths.work}}';

// A 16:9 recording. Rectangles are [left, top, width, height] from 0 to 1.
// frame is on the output canvas. The crops are on the oriented source and must fit frame's aspect.
await renderZoomShot({
  source, sourceRange: [0, 2], width: 640, height: 360, fps: 24,
  frame: [0.1, 0.1, 0.8, 0.8], startCrop: [0.1, 0.1, 0.8, 0.8],
  endCrop: [0.5, 0.3, 0.4, 0.4], moveStart: 0.25, land: 1, hold: 1, easing: 'smoothstep',
}, join(work, 'legend-zoom-v1.mp4'));
```

For a clip, the source range spans `land + hold` seconds. For a still, omit `sourceRange`. To enlarge a detail over a playing background, use this call with the same imports and paths.

```js
await renderForegroundDetail({
  background: { path: source, start: 0 }, width: 640, height: 360, fps: 24, duration: 2,
  foreground: { crop: { x: 0.5, y: 0.3, width: 0.4, height: 0.4 } },
  destination: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
  entranceStart: 0.25, landAt: 0.75, holdUntil: 2, dim: 0.25,
  outputPath: join(work, 'legend-overlay-v1.mp4'),
});
```

On the shot clock (seconds), the detail appears at `entranceStart`, finishes fading in at `landAt` and stays until `holdUntil`. The crop follows the playing background. To use a separate panel, set `foreground.path` to its path and optionally `foreground.start` to its in-point. The normalized destination fits the detail on the canvas. Both helpers keep the backing clip's audio. Choose a Video/Audio card to hear it and use anchored Audio cards for other tracks.

Inspect opening, motion, landing and held frames before registering. Pass the versioned script as `sourcePath` and list each input item in `derivedFrom`. To revise, copy the saved source, edit the landing crop and hold, render a fresh file, and register with `iterationOf` set to the previous item ID. Assign only a successful, inspected render. After a board conflict, inspect the creator's change before assigning the completed item. See the assemble-draft skill to validate the board and render each draft.

## Register and return to a card

```json
register_work_file { "path": "work/broll/walk-12-18.mp4", "name": "Walk to window (12–18s)", "category": "B-roll",
  "sourcePath": "work/broll/make-walk.sh", "derivedFrom": [ { "itemId": "item-broll-3" } ],
  "cardId": "card-a", "expectedRevision": 8, "assign": "item" }
→ { "registered": true, "libraryItemId": "item-…", "kind": "video", "duration": 6.5, "width": 1920, "height": 1080, "deduplicated": false,
    "appliedToCard": true, "revision": 9 }
```

- `category` defaults from the file kind (video → B-roll). `derivedFrom` records provenance; for reference material you may also cite the creator's chat instruction in `direction` (see the read-references skill).
- The file must be complete, inside `work/`, not a symlink, and decodable. Refusals: `PATH_OUTSIDE_WORK`, `PATH_SYMLINK`, `FILE_NOT_COMPLETE` (still being written — finish, then register), `FILE_EMPTY`, `UNSUPPORTED_MEDIA`, `CATEGORY_MISMATCH`.
- `deduplicated: true` means identical bytes already existed in this channel; the existing asset is reused.
- Stale board: `appliedToCard: false` with `conflict.currentRevision` — the item is registered; re-read and assign with `update_cards`.
- After assigning a new file, reset card `in`/`out` to the new clip's range (or leave null for the whole clip).

Originals are never modified or deleted by any of this; a derivative is a new item with the original recorded as its source.
