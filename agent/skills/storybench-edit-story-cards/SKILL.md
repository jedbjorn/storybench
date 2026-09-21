---
name: storybench-edit-story-cards
description: Read and update the Storybench story and cards with revision checks - prompts, order, timing, sections, selected media, references - and recover from revision conflicts.
---

# Edit story and cards

**Purpose.** Change the sketch: rewrite or restructure `story.md`, add/remove/reorder cards, adjust prompts and timing, select media, attach results. All writes go through revision-checked tools; `story.md` on disk and card JSON are never edited directly.

**Context.** `get_context` gives `story.storyRevision`, `story.source`, `story.sections`, `episode.revision` and `episode.cards`. Read right before you write.

## Story

`story.md` shape: `# Overview`, `# Hook`, `# Sections` with `## Intro`, one `##` per beat, `## Outro`. Each `##` section heading is preceded by a hidden marker `<!-- storybench:section <uuid> -->`. Keep markers with their headings when you move or rename sections; a heading without a marker gets a new ID (a new section), and a removed marker retires that section (cards pointing at it lose their `sectionId` link).

```json
update_story { "expectedStoryRevision": 3, "source": "# Overview\n…\n# Sections\n<!-- storybench:section 6f1c… -->\n## Intro\n…" }
→ { "storyRevision": 4, "sections": [ … ], "publicationStatus": "…" }
```

Conflict: the tool refuses with a stale-revision error naming the current revision → `get_context` again, re-apply your change to the new source, submit with the new `expectedStoryRevision`. Limit: 1 MiB of source.

## Cards

`update_cards` replaces the whole card list. Send every card you want to keep, with its existing `id`; a card omitted is removed; a card without `id` is created.

```json
update_cards { "expectedRevision": 7, "cards": [
  { "id": "card-a", "title": "Cold open", "type": "Video", "prompt": "hand-held walk to the window, no dialogue", "sectionId": "6f1c…", "order": 0,
    "itemId": "item-broll-3", "in": 12.0, "out": 18.5, "referencePrompt": "this pace", "referenceItemIds": ["item-ref-1"], "enabled": true },
  { "id": "card-b", "title": "Title", "type": "Static Graphic", "prompt": "episode title over dark frame", "sectionId": "6f1c…", "order": 1,
    "itemId": "item-graphic-9", "duration": 3 },
  { "title": "Music", "type": "Audio", "role": "music", "prompt": "low pad under the intro", "anchorVisualCardId": "card-a", "offset": 0, "gain": 0.6, "fadeIn": 0.5, "fadeOut": 1.0 }
] }
→ { "id": "{{episode.id}}", "revision": 8, "cards": [ … ] }
```

Field notes (as the store validates them):

- `type`: `Video/Audio`, `Video`, `Audio`, `Static Graphic`, `Video Graphic`. Visual cards order the timeline; `Audio` cards anchor to a visual card (`anchorVisualCardId`) with `offset`, `gain` (0–8), `fadeIn`/`fadeOut` seconds, and a `role` (`voiceover`, `music`, `sound effect`, `other`).
- Timing: video/audio media use `in`/`out` seconds within the source (out must be within the asset's duration); `Static Graphic` uses `duration` seconds.
- `itemId` must be a library item in this episode; `sectionId` must be a live story section; `referenceItemIds` must exist in the episode library.
- `enabled: false` or `excluded: true` keeps the card but leaves it out of the cut.

Conflict: stale `expectedRevision` → refused with the current revision; read again, merge, resubmit. A missing item or section is refused with its ID named — register or reuse the item first, or fix the section.

## Attaching results to a card

Two routes:

1. `register_work_file` / `reuse_project_item` with `cardId`, `expectedRevision` and `assign: "item"` (set as media) or `"reference"` (add to references). On a stale board the item is still registered and the result reports `appliedToCard: false` with a `conflict` — then attach with `update_cards` after re-reading.
2. `update_cards` setting `itemId` directly, when you already have the item ID.

Graphic recipes rendered with `render_graphic` register their result under Graphics; if the recipe carries a `cardId`, the job assigns it to that card when the board revision still matches, otherwise the asset stays in the library and the job reports the conflict.

## Behaviour to expect

- Writes are refused while another turn owns the episode, or after your turn ended (`The turn is no longer active`).
- Every save records history with actor `agent`; the creator can restore an older revision, which bumps the revision again.
- Renaming, reordering or retyping cards never deletes library items or files.
