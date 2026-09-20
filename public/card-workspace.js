const AUDIO_ROLES = new Set(["voiceover", "music", "sound effect", "other"]);

export function setCardType(card, type) {
  card.type = type;
  if (type === "Audio" && !AUDIO_ROLES.has(card.role)) card.role = "voiceover";
  return card;
}
