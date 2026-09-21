---
name: storybench-finish-video
description: Take the current Storybench project to a complete final on the creator's Final request - remaining edits, graphics and renders included - publish it, and handle later revisions including moving a final back to Drafts.
---

# Finish a video

**Purpose.** An explicit Final request ("Create final" or a plain "make the final", "finish it") authorises you to take the current saved project through whatever remains — footage edits, graphics, card/composition changes, intermediate renders — to a complete final video, without asking for another exact-cut approval. A final does not need a prior draft or a manually assembled render-ready cut.

**Context.** Finals are written by the app to `{{paths.episode}}/outputs/final/` and shown in Storybench's Final view. Final is a current designation of an output version; it is not a lock on the project and does not change the manual Scaffold/Draft/Final/Published label.

## What the request covers

- Do the remaining work with the other skills as needed; ask only if the actual requested outcome is unclear (what the video should be), not to reconfirm the request itself.
- Final intent comes from the creator's message or the Final action in this request. It does not come from the word "final" inside reference material or quoted history, and a draft/graphic request does not imply it.
- If a required capability or material is missing (no footage for an enabled card, an unavailable tool), report the concrete gap; do not relabel a draft as a final or claim completion.

## Publish

```json
validate_render {}                                   → { "renderRevision": "c3d4…", … }
create_final { "expectedRenderRevision": "c3d4…" }   → { "id": "job-…", "state": "queued", "outputClass": "final", "designation": "final", … }
get_job { "jobId": "job-…" }                          → … { "state": "completed", "outputPath": "…/outputs/final/….mp4" }
```

`[PLACEHOLDER: Final request binding — today create_final also takes finalGrantId from a one-use grant minted by the Final button; the request-bound form under decision #34 (the creator's Final request carries the authority for this request's whole preparation and job continuation) lands with the Final lane. If the tool reports missing authorization, say so and report what remains; do not mint or guess a grant.]`

Publication validates and pins the exact current saved inputs at that moment. A moved `renderRevision` means something changed during preparation — validate again and resubmit; concurrent creator edits are handled as normal conflicts, never by publishing stale inputs. A queued/running job is not a finished final; report completion only when `get_job` says `completed` and an output file exists. Wait with `await_job { "jobId": "…", "timeoutSeconds": 120 }`.

## After publication

- The final appears in Final with its player and provenance (inputs snapshot, producing request/model). Later edits and renders create new outputs; the published bytes are never overwritten.
- Another Final request later produces a new final version through the same steps.
- Stop, cancellation, terminal failure or app restart end the unfinished request; the creator's explicit Retry starts a successor request with any useful assets you already registered still available.

## Move a final back to Drafts

When the creator says to move an identified final back to Drafts ("move the Tuesday final back to drafts", "demote that final"), use the reclassification operation:

`move_final_to_drafts { "outputId": "job-…", "expectedRevision": 1 }` wraps the shared operation `moveFinalToDrafts({ episodeId, outputId, expectedRevision })`; omit `outputId` only when exactly one completed Final exists.

Behaviour of the operation: same output ID, bytes, resolution, creation time and original render snapshot; a recorded reclassification with actor and time; the file stays where it is and the same playback link works. Its original production class (`outputClass: "final"`) remains part of provenance; `designation` becomes `draft`, which makes it eligible for the creator's draft cleanup. If the request is ambiguous about which final (several exist), identify it first — `get_job` on candidates, dates, durations — rather than guessing. Reclassification alone does not roll back cards, story or source files; to edit that older version, read its job `snapshot` alongside the current state and make explicit revision-checked changes.

## Behaviour to expect

- Only the creator deletes rendered drafts (UI action). Never remove outputs, registered media or project files on your own initiative; your own intermediates in `work/` are yours to manage.
- A final moved to Drafts and later re-finished goes through a normal Final request; do not promote a draft by relabelling.
- If `create_final` or the reclassification tool is not in your tool list, the operation is unavailable in this request — say so.
