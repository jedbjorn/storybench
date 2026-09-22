const AUDIO_ROLES = new Set(["voiceover", "music", "sound effect", "other"]);

export function setCardType(card, type) {
  card.type = type;
  if (type === "Audio" && !AUDIO_ROLES.has(card.role)) card.role = "voiceover";
  return card;
}

export function categoryForCardMedia(card, file) {
  if (file.type.startsWith("audio/") || card.type === "Audio") return "Narration";
  if (file.type.startsWith("image/") || ["Static Graphic", "Video Graphic"].includes(card.type)) return "Graphics";
  return "B-roll";
}

export function attachMediaToCard(cards, cardId, itemId) {
  const card = cards.find((value) => value.id === cardId);
  if (!card) return null;
  card.itemId = itemId;
  return card;
}

// A duplicate is a new card with the same direction and references (same episode, so
// library item IDs stay valid and need no remapping).
export function duplicateCard(cards, cardId, newId) {
  const index = cards.findIndex((value) => value.id === cardId);
  if (index < 0) return null;
  const source = cards[index];
  const copy = { ...structuredClone(source), id: newId, title: `${source.title || "Card"} copy`, order: (source.order || 0) + 0.5,
    referencePrompt: source.referencePrompt ?? "", referenceItemIds: [...(source.referenceItemIds || [])] };
  cards.splice(index + 1, 0, copy);
  return copy;
}
