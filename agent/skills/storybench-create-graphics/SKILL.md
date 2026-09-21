---
name: storybench-create-graphics
description: Create and revise still and animated graphics for Storybench cards - with the app's recipe renderer or your own Pillow/SVG/FFmpeg scripts - keep editable sources in work/, register results under Graphics and assign them to cards.
---

# Create and edit graphics

**Purpose.** Make titles, lower thirds, overlays, end cards and short motion pieces from a card's prompt and references, and revise existing graphics from their editable sources. Two routes exist; pick whichever suits the piece. No fixed form or technique is required.

**Context.** Graphic cards: `Static Graphic` (needs `duration`) and `Video Graphic`. The card's `prompt` says what to make; `referencePrompt` + references say how they should inform it (feel only — the reference rule applies to their pixels and text). Match the cut's frame size (typically 1920×1080; check existing footage with `inspect_media`). Results live in category `Graphics`.

## Route A — the app's recipe renderer (text, shapes, registered images; still PNG or motion MP4)

```json
create_graphic_recipe { "name": "Episode title", "cardId": "card-b", "recipe": {
  "kind": "still", "width": 1920, "height": 1080, "background": "#101014",
  "layers": [
    { "kind": "rectangle", "x": 120, "y": 760, "width": 640, "height": 6, "fill": "#f2c14e" },
    { "kind": "text", "x": 120, "y": 720, "text": "Morning Light", "fontSize": 96, "fontWeight": 700, "fill": "#ffffff", "textAnchor": "start" },
    { "kind": "image", "itemId": "item-logo-2", "x": 1600, "y": 80, "width": 200, "opacity": 0.9 }
  ] } }
→ { "id": "recipe-…", "revision": 1, "kind": "still", … }

render_graphic { "recipeId": "recipe-…", "expectedRecipeRevision": 1 }
→ { "id": "job-…", "state": "queued", "outputClass": "graphic", … }
```

Motion: `"kind": "motion", "duration": 4, "fps": 30` (max 30 s, even width/height) and per-layer `keyframes` on `x`, `y`, `scale`, `rotation`, `opacity`:

```json
{ "kind": "text", "x": 120, "y": 720, "text": "Morning Light", "fontSize": 96, "fill": "#fff",
  "keyframes": { "opacity": [ { "time": 0, "value": 0 }, { "time": 0.6, "value": 1 } ],
                 "y": [ { "time": 0, "value": 760 }, { "time": 0.6, "value": 720, "easing": "linear" } ] } }
```

Keyframes interpolate linearly between entries (`easing`: `linear` or `hold`); times must increase and stay within `duration`. Layer kinds: `text` (`fontSize`, numeric `fontWeight` 100–900, `textAnchor` start/middle/end; one bundled font family), `rectangle`, `ellipse`, `line`, `path`, `image` (a registered image item — a reference image needs the creator's direction). Common fields `x`, `y`, `scale`, `rotation`, `opacity`, `z`. Colours are named or hex. Validation errors name the field (`layers[1].fontSize`). Revise with `get_graphic_recipe` → `update_graphic_recipe { recipeId, expectedRevision, recipe }` (kind cannot change) → `render_graphic` again; each render is a new Graphics item with recipe/revision provenance. If the recipe has a `cardId`, a completed job assigns the result when the board revision still matches; otherwise the asset stays in the library and the job reports the conflict.

## Route B — your own scripts (Pillow, SVG + resvg, FFmpeg)

Keep the script/SVG in `{{paths.work}}` as the editable source; write the output next to it. Fonts: `/usr/share/fonts/truetype/dejavu/`, `/usr/share/fonts/truetype/noto/`, `/usr/share/fonts/truetype/liberation/`.

```python
# {{paths.work}}/title/title.py  ->  python3 title.py
from PIL import Image, ImageDraw, ImageFont
W, H = 1920, 1080
img = Image.new("RGBA", (W, H), (16, 16, 20, 255))
d = ImageDraw.Draw(img)
font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 96)
d.text((120, 640), "Morning Light", font=font, fill=(255, 255, 255, 255))
d.rectangle([120, 770, 760, 776], fill=(242, 193, 78, 255))
img.save("title.png")
```

```bash
# SVG to PNG
resvg {{paths.work}}/title/title.svg {{paths.work}}/title/title.png
# Still to a 4 s clip with fade, ready for the cut
ffmpeg -y -loop 1 -t 4 -i {{paths.work}}/title/title.png -vf "fade=t=in:d=0.5,fade=t=out:st=3.5:d=0.5,format=yuv420p" -r 30 -c:v libx264 -crf 18 {{paths.work}}/title/title.mp4
# Frame sequence (Pillow loop writing f0001.png…) to MP4
ffmpeg -y -framerate 30 -i {{paths.work}}/lower/frames/f%04d.png -c:v libx264 -pix_fmt yuv420p -crf 18 {{paths.work}}/lower/lower-third.mp4
# Text drawn by FFmpeg over a solid colour
ffmpeg -y -f lavfi -i "color=c=0x101014:s=1920x1080:d=3" -vf "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='Chapter 2':fontsize=84:fontcolor=white:x=(w-tw)/2:y=(h-th)/2" -c:v libx264 -pix_fmt yuv420p {{paths.work}}/chapter/chapter-2.mp4
```

Look at what you made: `inspect_image { "path": "work/title/title.png" }` or a frame of the MP4 with `atSeconds`.

## Register and assign

```json
register_work_file { "path": "work/title/title.png", "name": "Episode title", "category": "Graphics", "sourcePath": "work/title/title.py",
  "derivedFrom": [ { "itemId": "item-logo-2" } ], "cardId": "card-b", "expectedRevision": 8, "assign": "item" }
→ { "registered": true, "libraryItemId": "item-…", "kind": "image", "width": 1920, "height": 1080, "editableSource": "work/title/title.py", "appliedToCard": true, "revision": 9 }
```

Images and videos may be registered as Graphics. Refusals: incomplete/empty/undecodable file, path outside `work/`, symlink. Stale board → `appliedToCard: false` + `conflict`; the item is kept; re-read and attach with `update_cards`. A library-only request needs no `cardId`. To revise later, find the item's `editableSource` in its provenance (`register_work_file` records it), edit, re-run, register the new version; the old graphic stays available.
