import { resolveTarget } from './runtime/project-catalog.js';
import { frameAt } from './runtime/media-inspect.js';

const invalid = (message) => Object.assign(new Error(message), { statusCode: 400 });
export function chatAttachments(store) {
  const events = (id, type) => store.db.prepare('SELECT payload FROM conversation_events WHERE conversation_id=? AND type=? ORDER BY sequence').all(id, type).map((row) => JSON.parse(row.payload));
  return {
    validate(episodeId, ids) {
      if (!Array.isArray(ids) || ids.length > 8 || ids.some((id) => typeof id !== 'string')) throw invalid('Attach up to eight images');
      return [...new Set(ids)].map((id) => {
        const item = store.getLibraryItem(episodeId, id);
        if (!item || item.asset?.kind !== 'image') throw invalid('Each attachment must be an image in this episode’s library');
        return { itemId: item.id, label: item.label, episodeId };
      });
    },
    draft(id) { return events(id, 'draft.attachments').at(-1)?.attachments ?? []; },
    messages(id) { return new Map(events(id, 'message.attachments').map((event) => [event.messageId, event.attachments])); },
    async images(episodeId, attachments) {
      const images = []; let total = 0;
      for (const attachment of attachments) {
        const target = await resolveTarget(store, { dataRoot: store.workspace, episodeId }, { itemId: attachment.itemId });
        let bytes;
        try { bytes = await frameAt(target.handle); } finally { await target.handle.close(); }
        total += bytes.length;
        if (total > 20 * 1024 * 1024) throw invalid('Images are too large to send together; send fewer images');
        images.push({ mimeType: 'image/png', data: bytes.toString('base64') });
      }
      return images;
    },
  };
}
