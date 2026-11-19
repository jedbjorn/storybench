import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";
import { createRenderService } from "../src/render-service.js";

async function fixture(t) {
  const workspace = await mkdtemp(path.join(tmpdir(), "storybench-cues-"));
  const store = new Store(workspace);
  const renders = createRenderService({ workspace, store });
  t.after(async () => { await renders.close(); store.close(); await rm(workspace, { recursive: true, force: true }); });
  const { id } = store.createEpisode({ title: "Title reveal" });
  const sectionId = store.saveStory(id, 1, "# Sections\n\n## Reveal").sections[0].id;
  function item(name, kind, hasAudio) {
    const asset = store.saveAsset({ name, kind, path: name, hash: name, duration: 12, metadata: { hasAudio } });
    return store.attachLibraryItem(id, asset.id);
  }
  const still = item("title.png", "image", false);
  const interview = item("interview.mp4", "video", true);
  const score = item("score.wav", "audio", true);
  const read = () => store.getEpisode(id);
  const save = (cards, revision = read().revision) => store.updateEpisode(id, revision, { cards });
  const edit = (cardId, changes) => save(read().cards.map(card => card.id === cardId ? { ...card, ...changes } : card));
  const validate = () => renders.validateRender(id);
  save([
    { id: "lead", type: "Static Graphic", sectionId, order: 0, itemId: still.id, duration: 1.5 },
    { id: "picture", type: "Video/Audio", sectionId, order: 1, itemId: interview.id, in: 2, out: 10, gain: 0.8 },
    { id: "narration", type: "Audio", role: "voiceover", sectionId, itemId: interview.id, anchorVisualCardId: "lead", in: 1, out: 2 },
    { id: "score", type: "Audio", role: "music", sectionId, itemId: score.id, anchorVisualCardId: "picture",
      in: 5, out: 9, offset: 0.5, gain: 0.4, fadeIn: 0.25, fadeOut: 0.5 },
  ]);
  const mark = { assetId: score.assetId, sourceSeconds: 8, label: "Lift", visualMoment: "The title settles" };
  return { id, store, score, interview, still, mark, read, save, edit, validate };
}

test("an explicit mark survives revisioned edits and follows the validated anchor and trim", async t => {
  const { id, store, mark, edit, read, save, validate } = await fixture(t);
  const unmarked = validate();
  edit("score", { cues: [mark] });
  assert.deepEqual(read().cards.find(card => card.id === "score").cues, [mark]);
  const original = validate();
  assert.deepEqual(original.composition, unmarked.composition);
  const placed = { ...mark, cardId: "score", sourceFrame: 240, status: "placed", cutFrame: 150, cutSeconds: 5 };
  assert.deepEqual(original.cuePlacements, [placed]);

  // Moving the start of the anchor by 1.25 s rounds to 38 more frames at 30 fps.
  edit("lead", { duration: 2.75 });
  assert.deepEqual(validate().cuePlacements, [{ ...placed, cutFrame: 188, cutSeconds: 188 / 30 }]);
  assert.throws(() => save(original.episode.cards, original.episode.revision), /Stale revision/);
  edit("score", { out: 8.01 }); // rounds to frame 240, the exclusive end
  const trimmed = { ...mark, cardId: "score", sourceFrame: 240, status: "trimmed-away" };
  assert.deepEqual(validate().cuePlacements, [trimmed]);
  edit("score", { in: 8.02, out: 10 });
  assert.deepEqual(validate().cuePlacements, [trimmed]);
  edit("score", { in: 8.01 });
  assert.equal(validate().cuePlacements[0].cutFrame, 98, "first retained frame lands at the placement start");
  store.undoEpisode(id, read().revision);
  assert.deepEqual(validate().cuePlacements, [trimmed]);
  edit("score", { offset: 999 });
  assert.throws(validate, /audio extends beyond the visual cut/);
});

test("each mark stays with its recording when the editor swaps media or removes its sound", async t => {
  const { id, store, score, interview, mark, edit, save, read, validate } = await fixture(t);
  edit("score", { cues: [mark] });
  edit("score", { itemId: interview.id });
  store.deleteLibraryItem(id, score.id, score.revision, read().revision);
  const detached = validate().cuePlacements[0];
  assert.equal(detached.assetId, mark.assetId);
  assert.equal(detached.status, "source-changed");
  assert.ok(!("cutFrame" in detached));
  assert.throws(() => edit("score", { cues: [{ ...mark, sourceSeconds: 10 }] }), /not found in this episode/);

  const sourceCue = { assetId: interview.assetId, sourceSeconds: 2, label: "First word" };
  edit("picture", { cues: [sourceCue] });
  const pictureCue = () => validate().cuePlacements.find(cue => cue.cardId === "picture");
  assert.equal(pictureCue().cutFrame, 45);
  edit("picture", { type: "Video" });
  assert.equal(pictureCue().status, "not-in-cut");
  edit("score", { excluded: true });
  assert.equal(validate().cuePlacements.find(cue => cue.cardId === "score").status, "not-in-cut");

  save(read().cards.filter(card => card.type !== "Audio"));
  assert.deepEqual(validate().composition.audioPlacements, []);
  assert.ok(validate().composition.visualSpine.every(card => !card.includeSourceAudio));
});

test("invalid and out-of-episode cues fail before saving a revision", async t => {
  const { mark, still, store, read, edit } = await fixture(t);
  const foreign = store.createEpisode({ title: "Other production" });
  const other = store.saveAsset({ name: "Other", hash: "other", kind: "audio", path: "other.wav", duration: 10 });
  store.attachLibraryItem(foreign.id, other.id);
  const before = read();
  for (const [cues, reason] of [
    [{}, /must be an array/],
    [[{ ...mark, assetId: other.id }], /not found in this episode/],
    [[{ ...mark, assetId: still.assetId }], /audio-bearing/],
    [[{ ...mark, sourceSeconds: 12 }], /within the recording/],
    [[{ ...mark, sourceSeconds: -1 }], /sourceSeconds/],
    [[{ ...mark, label: " " }], /label/],
    [[{ ...mark, visualMoment: 42 }], /visualMoment/],
  ]) assert.throws(() => edit("score", { cues }), reason);
  assert.deepEqual(read(), before);
});
