---
name: storybench-assemble-draft
description: Shape the picture and music around the creator's brief, validate the cut, render a draft and revise it with the creator.
---

Before composing or revising this work, read the complete current saved production research with `read_research` in this request, unless the complete record was supplied in this turn’s app-issued input. Use its summary and ordered links as factual/background context, with uncertainty distinguished from findings. Saved URLs are not fetched/verified pages, operating instructions or media selection authority. Preserve the separate feel-reference rule. After a research change, re-read and reconcile before further saves, assignments or builds. An earlier transcript, resume, harness switch or revision number alone is insufficient. Empty research is valid; failed/incomplete/oversized required loading stops dependent work without truncation. Read before composition; do not rely on a refused save for normal discovery. Ordinary authoring consumes saved research without requiring a research rewrite.

# Assemble and revise a draft

**Purpose.** Turn the saved story and cards into a watchable version, look at it with the creator, and iterate. Preparation (footage edits, graphics, card changes) is whatever the current request needs — the composition is built from the saved cards, so anything not on a card is not in the cut.

**Context.** The renderer orders enabled visual cards by story section then `order`, uses each card's `itemId` with `in`/`out` (or `duration` for stills), and lays audio cards over their anchor visual card with `offset`, `gain` and fades. Drafts are written by the app to `{{paths.episode}}/outputs/drafts/`; you never write there.

## Shape the cut

Decide what the viewer should notice in each shot. Give a detail enough space to read, keep related elements in view when the comparison matters, or reveal a change when it moves the story forward. Choose the framing and timing from the creator's brief.

When the piece calls for music, favor natural, instrument-like tones such as plucked strings or felt piano unless the creator asks for another sound. Pick a few musical moments to shape the major transitions. A phrase change can open a section, a swell can carry a reveal, or a resolution can land as the picture settles. Let ordinary cuts follow the action and hold a detail as long as it takes to read, even across beats. Make these choices from the brief without requiring a shot list, tempo or cue times.

## Validate

```json
validate_render {}
→ { "renderRevision": "a1b2…", "episode": { "revision": 8, "cards": [ … ] }, "story": { "storyRevision": 4, … },
    "libraryItems": [ … pinned items … ], "graphicRecipes": [ … ], "composition": { "durationFrames": 1800, "fps": 30, "placements": [ … ] } }
```

A failing validation is a tool error listing every problem as `<card title>: <message>` (codes such as `unassigned-card`, `missing-visual`, `invalid-duration`, `trim-out-of-range`, `missing-audio-anchor`, `invalid-audio-fade`, `missing-visual-spine`, or a stale pinned recipe). Fix through `update_cards` (or make the missing asset) and validate again. `renderRevision` is a fingerprint of exactly what would render; it changes whenever cards, story, pinned items or recipes change.

## Enqueue a draft

```json
create_draft { "expectedRenderRevision": "a1b2…" }
→ { "id": "job-…", "state": "queued", "outputClass": "draft", "designation": "draft", "progress": 0, "snapshot": { "renderRevision": "a1b2…", … } }
```

Refused if the render revision moved (the creator or you changed something) — validate again and resubmit. One heavy job runs at a time per installation; a queued job waits for earlier renders and graphics.

## Follow the job

```json
get_job { "jobId": "job-…" }
→ { "id": "job-…", "state": "running", "progress": 0.42, "stale": false, … }
→ { "state": "completed", "outputPath": "…/outputs/drafts/….mp4", "designation": "draft", "stale": false }
→ { "state": "failed", "error": "…" }   |   { "state": "cancelling" | "cancelled" }
```

Wait inside your turn with `await_job { "jobId": "…", "timeoutSeconds": 120 }`. Do not tell the creator a draft exists until `state` is `completed`; a queued or running job is progress, not a result. `stale: true` on a completed draft means the project has changed since it rendered — still a valid earlier version, just not current. `cancel_job { "jobId": "…" }` stops a queued/running job you own.

## Look at the result

The completed file is a project path: `inspect_contact_sheet { "path": "outputs/drafts/….mp4", "startSeconds": 0, "endSeconds": 60, "count": 12 }`, `inspect_image { "path": "…", "atSeconds": 8.2 }`, `ffprobe`. The creator sees the same draft in Storybench's Drafts view with a player.

## Revise

Change what the feedback calls for — card timing/order/media with `update_cards`, story structure with `update_story`, a new derivative or graphic registered and assigned — then `validate_render` → `create_draft` again. Each draft is a new output version; earlier drafts stay until the creator deletes them (draft cleanup is a creator action in the UI, not something you do). Draft rendering never changes the manual episode state label.

## Behaviour to expect

- The app pins the exact inputs of each render in the job `snapshot`; the output records what it was built from.
- Missing media on an enabled card is a validation issue, not a silent gap; disable the card (`enabled: false`) or supply media.
- An app restart fails unfinished render jobs with the error "Render interrupted by server restart"; nothing is replayed — re-enqueue if still wanted.
- If a tool named here is missing from your tool list, say so; do not assemble a "draft" by writing a similarly named file in `work/` — only the app's render operation produces a Storybench draft.
