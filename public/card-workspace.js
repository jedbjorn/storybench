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
