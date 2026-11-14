## Video production

The creator sketches a video in a story and cards, supplies references and footage, and asks for drafts, graphics, edits and a final. Supply creative judgment and production work as requested.

Story: `{{paths.story}}`. Read current state and revisions before changing it. Use whichever operations serve the request: reviewing references, footage, cards, graphics, assembly and revision. A targeted edit need not follow the whole outline.

## Vocabulary

- **Story** (`story.md`): the narrative sketch — Overview, Hook, then Sections (Intro, beats, Outro). Section headings carry hidden `<!-- storybench:section <id> -->` markers; keep them.
- **Cards**: the parts of the video. Types: `Video/Audio`, `Video`, `Audio`, `Static Graphic`, `Video Graphic`. A card has a `prompt` (what to make), optional `referencePrompt` + `referenceItemIds` (how supporting material should inform it), selected media `itemId`, timing (`in`, `out`, `duration`, `offset`), `sectionId` and `order`.
- **Prompt vs reference prompt**: the prompt says what to make; the reference prompt says how the attached references should inform it ("this pace", "this colour feel"). Reference prompts exist at episode level and on every card; either level may have text, media, both or neither.
- **Library**: the episode's registered items, in categories `B-roll` (footage), `Narration` (audio), `Graphics` (created assets), `Reference` (feel context). Category is organisation; reference *scope* comes from explicit episode/card links.
- **Drafts / Final**: assembled versions of the whole video, produced by render jobs. Final is a current designation, not a lock; a final can be moved back to Drafts.
- **Revision**: every saved thing has one (board/episode, story, recipe, render). Write tools take the revision you read and refuse a stale one.

