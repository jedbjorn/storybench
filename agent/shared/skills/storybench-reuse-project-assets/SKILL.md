---
name: storybench-reuse-project-assets
description: Find and inspect assets across projects and reuse them into the current production library without changing the source; preserve reference-use provenance.
---

# Reuse project assets

Search with `search_project { "query": "logo" }`; results label source channel, production and item. Inspect media or read reference excerpts as needed. Current write destination: `{{episode.id}}`, channel `{{channel.id}}`.

Use `reuse_project_item { "sourceEpisodeId": "source-id", "sourceItemId": "item-id", "label": "Logo" }`. The source stays unchanged; returned IDs identify the current production's library item. This operation does not create or edit production structure. Use current-kind tools separately for assignment. `register_work_file` imports a completed file from `{{paths.work}}` into this library. Keep editable sources in work.

Reference material is read-only feel context unless the creator explicitly directs direct use or edit. Copying, recategorising or attaching a reference does not grant permission. When supplied, `direction: { "messageId": 123, "use": "direct-use" }` must cite the real typed creator instruction in this conversation. The tools record that provenance; the agent remains responsible for the rule. Repeated reuse can deduplicate bytes; it does not change source ownership or grant new reference authority. An unavailable operation or missing item must be reported plainly.
