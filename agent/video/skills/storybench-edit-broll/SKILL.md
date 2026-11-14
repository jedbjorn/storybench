---
name: storybench-edit-broll
description: Find footage, inspect metadata and frames, pick ranges, and trim, crop, re-time or otherwise edit B-roll with FFmpeg or scripts; register the derivative and return it to a card.
---

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
