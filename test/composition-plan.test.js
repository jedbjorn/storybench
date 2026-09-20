import test from "node:test";
import assert from "node:assert/strict";
import { buildRenderPlan, CompositionError } from "../src/composition-plan.js";

const sections = [{ id: "intro" }, { id: "body" }, { id: "outro" }];
const item = (id, kind, duration, metadata = {}) => ({
  id: `item-${id}`,
  assetId: `asset-${id}`,
  asset: { id: `asset-${id}`, kind, duration, metadata },
});
const libraryItems = [
  item("intro", "image", null),
  item("body", "video", 3, { hasAudio: true }),
  item("outro", "image", null),
  item("music", "audio", 8, { hasAudio: true }),
];

function cards() {
  return [
    { id: "outro-card", title: "Outro", type: "Static Graphic", sectionId: "outro", order: 0, itemId: "item-outro", duration: 1 },
    { id: "music-card", title: "Theme", type: "Audio", sectionId: "body", order: 0, itemId: "item-music", role: "music", anchorVisualCardId: "body-card", offset: 1, in: 1, out: 3, gain: 0.5, fadeIn: 0.25, fadeOut: 0.5 },
    { id: "body-card", title: "Interview", type: "Video/Audio", sectionId: "body", order: 0, itemId: "item-body", in: 0.5, out: 2.5, gain: 0.8 },
    { id: "intro-card", title: "Intro", type: "Static Graphic", sectionId: "intro", order: 0, itemId: "item-intro", duration: 2 },
  ];
}

test("section order creates the visual spine and anchored audio may span cards", () => {
  const plan = buildRenderPlan({ sections, cards: cards(), libraryItems });
  assert.equal(plan.durationFrames, 150);
  assert.deepEqual(plan.visualSpine.map((entry) => [entry.cardId, entry.startFrame, entry.durationFrames]), [
    ["intro-card", 0, 60],
    ["body-card", 60, 60],
    ["outro-card", 120, 30],
  ]);
  assert.deepEqual(plan.audioPlacements[0], {
    cardId: "music-card", sectionId: "body", itemId: "item-music", assetId: "asset-music",
    role: "music", anchorVisualCardId: "body-card", startFrame: 90, endFrame: 150,
    sourceInFrame: 30, sourceOutFrame: 90, gain: 0.5, fadeInFrames: 8, fadeOutFrames: 15,
  });
});

test("reordering sections recomputes anchored placement from the visual spine", () => {
  const initialCards = cards();
  initialCards.find((card) => card.id === "music-card").out = 2;
  const before = buildRenderPlan({ sections, cards: initialCards, libraryItems });
  const after = buildRenderPlan({ sections: [sections[1], sections[0], sections[2]], cards: initialCards, libraryItems });
  assert.equal(before.audioPlacements[0].startFrame, 90);
  assert.equal(after.audioPlacements[0].startFrame, 30);
  assert.equal(after.audioPlacements[0].endFrame, 60);
});

test("disabled or excluded visuals cannot satisfy enabled audio anchors", () => {
  const values = cards();
  values.find((card) => card.id === "body-card").excluded = true;
  assert.throws(() => buildRenderPlan({ sections, cards: values, libraryItems }), (error) => {
    assert.ok(error instanceof CompositionError);
    assert.ok(error.issues.some((entry) => entry.code === "missing-audio-anchor" && entry.cardTitle === "Theme"));
    return true;
  });
});

test("validation names every enabled card that would otherwise be silently omitted", () => {
  const values = cards();
  values.push(
    { id: "unassigned", title: "Loose visual", type: "Video", sectionId: null, itemId: "missing", in: 0, out: 1 },
    { id: "missing-audio", title: "Missing voice", type: "Audio", sectionId: "body", itemId: "missing", role: "voiceover", anchorVisualCardId: "body-card", in: 0, out: 1 },
  );
  assert.throws(() => buildRenderPlan({ sections, cards: values, libraryItems }), (error) => {
    assert.ok(error instanceof CompositionError);
    assert.ok(error.issues.some((entry) => entry.code === "unassigned-card" && entry.cardTitle === "Loose visual"));
    assert.ok(error.issues.some((entry) => entry.code === "missing-visual" && entry.cardTitle === "Loose visual"));
    assert.ok(error.issues.some((entry) => entry.code === "missing-audio" && entry.cardTitle === "Missing voice"));
    return true;
  });
});

test("unknown types, duplicate ids, negative offsets and audio beyond cut are rejected", () => {
  const values = cards();
  values.push({ ...values[0], type: "Mystery" });
  const audio = values.find((card) => card.id === "music-card");
  audio.offset = -1;
  assert.throws(() => buildRenderPlan({ sections, cards: values, libraryItems }), (error) => {
    const codes = new Set(error.issues.map((entry) => entry.code));
    assert.ok(codes.has("duplicate-card-id"));
    assert.ok(codes.has("unknown-card-type"));
    assert.ok(codes.has("invalid-audio-offset"));
    return true;
  });

  const tooLong = cards();
  tooLong.find((card) => card.id === "music-card").out = 8;
  assert.throws(() => buildRenderPlan({ sections, cards: tooLong, libraryItems }), (error) => {
    assert.ok(error.issues.some((entry) => entry.code === "audio-beyond-cut"));
    return true;
  });
});

test("an audio-only episode is rejected without inventing a background", () => {
  const audio = cards().find((card) => card.type === "Audio");
  assert.throws(() => buildRenderPlan({ sections, cards: [audio], libraryItems }), (error) => {
    assert.ok(error.issues.some((entry) => entry.code === "missing-visual-spine"));
    return true;
  });
});

test("sub-frame stills and non-finite fades are rejected", () => {
  const short = cards();
  short.find((card) => card.id === "intro-card").duration = 0.001;
  assert.throws(() => buildRenderPlan({ sections, cards: short, libraryItems }), (error) => error.issues.some((entry) => entry.code === "duration-below-frame"));
  for (const value of [NaN, Infinity]) {
    const values = cards();
    values.find((card) => card.id === "music-card").fadeIn = value;
    assert.throws(() => buildRenderPlan({ sections, cards: values, libraryItems }), (error) => error.issues.some((entry) => entry.code === "invalid-audio-fade"));
  }
});
