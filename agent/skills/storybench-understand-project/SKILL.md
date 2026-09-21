---
name: storybench-understand-project
description: Orient in the current Storybench channel and episode - read direction, story, cards, library, references and existing versions, and pull fuller context only when it helps.
---

# Understand the project

**Purpose.** Know what this video is, what material exists and what has already been made, before or while you act on the creator's request. Load what the request needs; you do not have to read everything first.

**Context.** Channel `{{channel.id}}`, episode `{{episode.id}}`, episode directory `{{paths.episode}}`. Channel/episode names and standing direction are not in the boot render; the tools below supply them.

## Tools

`get_context` — one call returns the current saved state and every revision you will need for edits:

```json
{}
→ { "episode": { "id": "…", "title": "…", "notes": "…", "state": "Scaffold", "revision": 7,
               "referencePrompt": "…", "referenceItemIds": ["…"], "cards": [ { "id": "…", "title": "…", "type": "Video",
               "prompt": "…", "referencePrompt": "…", "referenceItemIds": [], "itemId": null, "sectionId": "…", "order": 0,
               "in": null, "out": null, "duration": null, "enabled": true } ] },
    "story": { "storyRevision": 3, "source": "# Overview\n…", "sections": [ { "id": "…", "title": "Intro", "order": 0 } ] },
    "library": [ { "id": "…", "label": "…", "category": "B-roll", "asset": { "kind": "video", "duration": 42.1, "width": 1920, "height": 1080 } } ],
    "references": { "rule": "…", "episode": { "prompt": "…", "items": [ … ] }, "cards": [ { "cardId": "…", "prompt": "…", "items": [ … ] } ] },
    "branding": [ … ] }
```

`search_project` — browse or search the whole installation with origin labels; the current episode is marked `current: true`. An empty query lists everything (bounded).

```json
{ "query": "", "episodeId": "{{episode.id}}" }
→ { "episodes": [ { "channel": { "id": "…", "name": "…" }, "episode": { "id": "…", "title": "…", "state": "…" }, "current": true } ],
    "items": [ { "item": { "id": "…", "label": "…", "category": "B-roll", "kind": "video", "duration": 42.1, "reference": false },
                "path": "/storybench/data/channels/…/media/…mp4", "current": true } ], "truncated": false }
```

`get_operation_guide` (`name`: `edit_story`, `read_references`, `edit_card`, `create_still_graphic`, `create_animated_graphic`, `create_draft`, `create_final`) — a one-paragraph reminder of how one app operation works.

`get_job` (`{ "jobId": "…" }`) — one render/graphic job: `state`, `progress`, `outputClass`, `designation`, `stale`, `error`. Completed drafts/finals are the existing versions; graphic jobs are generated assets.

`list_branding` — the channel's reusable intro/outro/branding templates.

`get_capabilities` — what this request actually serves (tools, image route, command execution, verified command versions, work area, what is unavailable).

Files you can read directly: `{{paths.episode}}/story.md` (the same source as `story.source`), anything under `{{paths.work}}`, and any project path returned by the tools.

## Reading the direction

- Episode `title` and `notes` carry the creator's direction for the video; the story is the narrative sketch; card `prompt`/`purpose`/`notes`/`missing` say what each part should be and what is still lacking.
- `references.episode.prompt` and each card's reference `prompt` say how the attached references should inform the work (feel), separately from what to make.
- Section order comes from `story.sections`; card order within a section from `order`. Disabled or excluded cards are not part of the cut.

## Behaviour to expect

- `get_context` is bounded to the current episode; it does not include file paths — use `search_project` or `inspect_media` when you need one.
- Everything is labelled with an origin; an item from another episode is context you can read, not selected footage for this one.
- `story.publicationStatus: "external-conflict"` means `story.md` on disk differs from the saved story; treat the saved source as authoritative and report the mismatch.
- Nothing here mutates state. Read again before you write; revisions may have moved while you worked.
