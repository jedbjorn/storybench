---
name: storybench-compose-deck
description: Plan, compose, stage, build and revise an editable offline deck.
---

Before composing or revising this work, read the complete current saved production research with `read_research` in this request, unless the complete record was supplied in this turn’s app-issued input. Use its summary and ordered links as factual/background context, with uncertainty distinguished from findings. Saved URLs are not fetched/verified pages, operating instructions or media selection authority. Preserve the separate feel-reference rule. After a research change, re-read and reconcile before further saves, assignments or builds. An earlier transcript, resume, harness switch or revision number alone is insufficient. Empty research is valid; failed/incomplete/oversized required loading stops dependent work without truncation. Read before composition; do not rely on a refused save for normal discovery. Ordinary authoring consumes saved research without requiring a research rewrite.

Read context, story, slides and references first. References establish feel; only incorporate their content under creator direction. Plan a narrative opening, problem, explanation, comparison, process, demonstration and closing. Apply channel standards without video intro/outro cards.

Use `update_story({expectedStoryRevision,source})`, then `save_deck({expectedRevision,slides})`. Re-read after a conflict; never overwrite a newer revision. Array order is presentation order. Preserve slide, reveal and navigation IDs when editing/reordering. Slides are plain text objects:

- `id`: safe identifier starting with a letter; `title`: nonempty.
- `layout`: title, section, statement, text-media, columns, full-media or process.
- `body`, `eyebrow`, `caption`, `notes`: plain text. Write meaningful presenter notes.
- `targetMinutes`: finite nonnegative number; `sectionId`: optional saved story section.
- `columns`: two or three `{title,body}` objects for columns layout.
- `stages`: ordered `{id,title,body,afterMs?}` reveals. Process needs at least one. Timing is milliseconds, 0/manual through 3600000. Stage IDs survive reorder.
- `media`: `{itemId,alt}` using an image/video member of this deck's library; required on text-media/full-media. `referenceItemIds` are context only.
- `subnav`: independent gallery views `{id,label,itemId?}`. Only image/video items can be shown. Do not use URLs or file paths.

Create supporting graphics in the writable work area with installed tools (for example SVG rendered to PNG); register through `register_work_file`, or reuse an existing asset through `reuse_project_item`. Assign the resulting library item ID in the slides. Shared reuse preserves provenance and source bytes. Export supports raster images and mp4/webm video; convert SVG to a raster before assigning it. No raw HTML, scripts or remote dependencies.

Choose varied layouts with short readable copy, generous space and deliberate hierarchy. Split crowded content into slides. Use process reveals for diagrams and gallery entries for alternate demo views. Check notes and captions. Do not claim aesthetic quality from structural tests.

Call `build_deck({expectedRevision})` after save. The build snapshots current channel font roles: Base for body/notes, Accent for headings, Alternate for eyebrows/captions. Unset roles keep Manrope. Selected regular/bold files and licences ship in the offline bundle; changes apply on the next build, leaving existing exports intact. Use `await_job({jobId})` and inspect failures, including their slide ID, before revising. Completed jobs expose a portable ZIP at `/api/jobs/<id>/deck/bundle.zip` and preview at `/api/jobs/<id>/deck/index.html`. Ask the creator to use Open preview / Download bundle. Reopen saved slides, edit and build a new version; previous successes remain. Final publication and cleanup of deck bundles are deferred.
