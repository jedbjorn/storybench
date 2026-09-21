---
name: storybench-reuse-project-assets
description: Browse or search other Storybench episodes and channels, identify an asset's origin, and register it in the current episode with provenance when the creator asks; reference items need the creator's explicit direction.
---

# Find and reuse project assets

**Purpose.** When the creator says "grab the intro from episode 3" or "use the channel logo from the other show", find it, confirm what it is, and bring it into this episode through the shared reuse operation — without touching the source project.

**Context.** All project directories are readable: {{paths.projects}}. Seeing them is ordinary context; it does not make anything selected footage here. Writes land only in this episode (`{{episode.id}}`, channel `{{channel.id}}`).

## Find

```json
search_project { "query": "intro" }
search_project { "channelId": "chan-…", "kind": "video" }
search_project { "query": "logo", "category": "Graphics", "limit": 50 }
→ { "episodes": [ { "channel": { "id": "…", "name": "Workshop" }, "episode": { "id": "ep-3", "title": "Episode 3" }, "current": false } ],
    "items": [ { "channel": {…}, "episode": { "id": "ep-3", … }, "current": false,
                "item": { "id": "item-intro-1", "label": "Intro card", "category": "Graphics", "kind": "video", "duration": 4, "reference": false },
                "path": "/storybench/data/channels/…/media/…mp4" } ], "truncated": false }
```

Confirm before reusing: `inspect_image { "itemId": "item-intro-1", "episodeId": "ep-3", "atSeconds": 1 }`, `inspect_media { "itemId": "…", "episodeId": "…" }`, `read_reference_excerpt { "itemId": "…", "episodeId": "…" }`. Results carry `origin` so you can tell the creator exactly what you found. You may also browse the directories directly (`ls`, `rg`), but item IDs come from `search_project`.

`list_branding` shows the channel's own reusable intro/outro templates; `apply_branding { "templateId": "…" }` adds editable copies of those cards to this episode. `promote_card { "cardId": "…", "name": "…", "role": "intro" | "outro" }` saves a card (with its media/references) as a reusable channel template (`role` may be omitted for a non-intro/outro template).

## Reuse

```json
reuse_project_item { "sourceEpisodeId": "ep-3", "sourceItemId": "item-intro-1", "category": "Graphics", "label": "Intro card (from Episode 3)",
  "cardId": "card-intro", "expectedRevision": 8, "assign": "item" }
→ { "reused": true, "libraryItemId": "item-…", "category": "Graphics", "copiedBytes": true, "deduplicated": false, "alreadyPresent": false,
    "from": { "channel": {…}, "episode": {…}, "item": {…} }, "reference": false, "appliedToCard": true, "revision": 9 }
```

- The source item, its file and its membership in the source episode are unchanged. Within the same channel, identical bytes are deduplicated (`deduplicated: true`); across channels the bytes are copied into this channel's media. `alreadyPresent: true` means this episode already had it.
- `sourceChannelId` optionally asserts the source is in a given channel.
- Card assignment is revision-checked: on a stale board the item is registered and `appliedToCard: false` with `conflict` is returned — re-read and attach with `update_cards`.
- Unavailable: `UNAVAILABLE` means project reuse is not served in this request; `ITEM_NOT_FOUND` means the ID/episode pair does not exist (search again).

Ordinary footage, graphics and narration need only the creator's request to borrow them. The request can be as plain as "use the ep-3 intro here".

## Reference items are different

If `search_project` shows `reference: true` (category Reference, or linked as an episode/card reference in its own episode), the reference rule follows it: the creator must explicitly direct that reference's use or edit, and the call needs `direction`:

```json
reuse_project_item { "sourceEpisodeId": "ep-3", "sourceItemId": "item-ref-7", "direction": { "messageId": 123, "use": "direct-use", "note": "creator asked to use the ep-3 mood clip as the opener" } }
```

Without it the tool refuses (`DIRECTION_REQUIRED`). Copying it or giving it a non-Reference category does not grant permission; the direction is recorded with the reused item. To derive from a reference in another episode, reuse it here first (with direction), then `register_work_file` with `derivedFrom` and the same `direction` (`REUSE_FIRST` otherwise).

## Behaviour to expect

- Nothing here changes the current request's target episode or the source project's ownership.
- Legacy episodes (under a `/episodes` or `/media` project root) are readable the same way; their items appear with their episode origin.
- Reuse does not change the manual episode state label or create cards; attach or build cards as a separate step if wanted.
