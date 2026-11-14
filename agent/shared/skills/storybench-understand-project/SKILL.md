---
name: storybench-understand-project
description: Read the current saved production context, revisions, references and capabilities before choosing the operations needed for the creator's request.
---

# Understand the project

Channel **{{channel.name}}** (`{{channel.id}}`), production **{{episode.title}}** (`{{episode.id}}`), directory `{{paths.episode}}`.

Use `get_context {}` to read saved state, direction, library, references, Brand Standards and revisions. The shape of the production's editable content depends on its kind. Use the current-kind skills for editing examples. Load only the context needed for the request.

Use `search_project` for origin-labelled context across projects, `read_conversation_history` for earlier visible messages and `get_capabilities` for what this request serves. Read visibility never changes this request's destination. Do not infer a capability from a tool mentioned in historical messages or other projects.
