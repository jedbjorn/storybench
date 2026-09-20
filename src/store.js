import { DatabaseSync } from "node:sqlite";
import {
  copyFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { storySectionHeadings } from "./story-markdown.js";

const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const parse = (value, fallback = null) =>
  value == null ? fallback : JSON.parse(value);
const STORY_LIMIT = 1024 * 1024;
const STORY_MARKER = /^ {0,3}<!--\s*storybench:section\s+([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\s*-->\s*$/i;
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");

export class StoreError extends Error {
  constructor(message, statusCode = 400, details = {}) {
    super(message);
    this.statusCode = statusCode;
    Object.assign(this, details);
  }
}

function storyRow(row) {
  if (!row) return null;
  return {
    episodeId: row.episode_id,
    source: row.source,
    storyRevision: row.revision,
    publicationPending: Boolean(row.publication_pending),
    publicationStatus: row.publication_pending ? "pending" : "published",
    sections: parse(row.sections, []),
    committedHash: row.committed_hash,
    publishedHash: row.published_hash,
    updatedAt: row.updated_at,
  };
}

function normalizeStory(source, existingSections = []) {
  if (typeof source !== "string") throw new StoreError("source must be a string");
  if (Buffer.byteLength(source, "utf8") > STORY_LIMIT)
    throw new StoreError("Story source exceeds the 1 MiB UTF-8 limit", 413);
  const known = new Map(existingSections.map((section) => [section.id, section]));
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(newline);
  const sections = [];
  const seen = new Set();
  const missing = [];
  for (const heading of storySectionHeadings(source)) {
    const headingIndex = heading.line;
    const marker = headingIndex > 0 ? STORY_MARKER.exec(lines[headingIndex - 1]) : null;
    let sectionId = marker?.[1]?.toLowerCase();
    if (sectionId && seen.has(sectionId))
      throw new StoreError(`Duplicate story section id: ${sectionId}`);
    if (!sectionId) {
      sectionId = crypto.randomUUID();
      missing.push({ line: headingIndex, marker: `<!-- storybench:section ${sectionId} -->` });
    }
    seen.add(sectionId);
    sections.push({ id: sectionId, title: heading.title, order: sections.length });
  }
  for (const insertion of missing.reverse()) lines.splice(insertion.line, 0, insertion.marker);
  const acceptedSource = lines.join(newline);
  if (Buffer.byteLength(acceptedSource, "utf8") > STORY_LIMIT)
    throw new StoreError("Accepted story source exceeds the 1 MiB UTF-8 limit after section IDs are added", 413);
  return {
    source: acceptedSource,
    sections,
    retiredSectionIds: [...known.keys()].filter((sectionId) => !seen.has(sectionId)),
  };
}

function placement(value, field) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || typeof value.assetId !== "string")
    throw new StoreError(`${field} placement requires an asset`);
  for (const key of ["in", "out", "offset", "gain"])
    if (!Number.isFinite(value[key]))
      throw new StoreError(`${field}.${key} must be a finite number`);
  if (
    value.in < 0 ||
    value.out <= value.in ||
    value.offset < 0 ||
    value.gain < 0 ||
    value.gain > 8
  )
    throw new StoreError(
      `${field} placement has an invalid range, offset, or gain`,
    );
  if (field === "visual" && value.offset !== 0)
    throw new StoreError("visual.offset must be zero");
  return {
    assetId: value.assetId,
    in: value.in,
    out: value.out,
    offset: value.offset,
    gain: value.gain,
  };
}

export function validateCards(cards) {
  if (!Array.isArray(cards)) throw new StoreError("cards must be an array");
  const seen = new Set();
  return cards.map((card) => {
    if (!card || typeof card !== "object")
      throw new StoreError("each card must be an object");
    const cardId =
      typeof card.id === "string" && card.id ? card.id : id("card");
    if (seen.has(cardId)) throw new StoreError("card ids must be unique");
    seen.add(cardId);
    const duration =
      card.duration == null || card.duration === ""
        ? null
        : Number(card.duration);
    if (duration != null && (!Number.isFinite(duration) || duration <= 0))
      throw new StoreError("card duration must be positive");
    const type = String(card.type || (card.visual && card.narration ? "Video/Audio" : card.visual ? "Video" : card.narration ? "Audio" : "Video"));
    if (!["Video/Audio", "Video", "Audio", "Static Graphic", "Video Graphic"].includes(type))
      throw new StoreError("card type is invalid");
    const referenceItemIds = card.referenceItemIds == null ? [] : card.referenceItemIds;
    if (!Array.isArray(referenceItemIds) || referenceItemIds.some((value) => typeof value !== "string"))
      throw new StoreError("card referenceItemIds must be an array of strings");
    const referenceUrls = card.referenceUrls == null ? [] : card.referenceUrls;
    if (!Array.isArray(referenceUrls) || referenceUrls.some((value) => typeof value !== "string"))
      throw new StoreError("card referenceUrls must be an array of strings");
    return {
      id: cardId,
      title: String(card.title ?? ""),
      type,
      prompt: String(card.prompt ?? ""),
      purpose: String(card.purpose ?? ""),
      notes: String(card.notes ?? ""),
      missing: String(card.missing ?? ""),
      visual: placement(card.visual, "visual"),
      narration: placement(card.narration, "narration"),
      duration,
      sectionId:
        card.sectionId == null || card.sectionId === ""
          ? null
          : String(card.sectionId),
      order: Number.isFinite(card.order) ? Number(card.order) : 0,
      itemId: card.itemId == null || card.itemId === "" ? null : String(card.itemId),
      referenceItemIds: [...new Set(referenceItemIds)],
      referenceUrls: [...new Set(referenceUrls)],
      enabled: card.enabled !== false,
      excluded: Boolean(card.excluded),
      role: card.role == null ? null : String(card.role),
      anchorVisualCardId: card.anchorVisualCardId == null || card.anchorVisualCardId === "" ? null : String(card.anchorVisualCardId),
      in: card.in == null || card.in === "" ? null : Number(card.in),
      out: card.out == null || card.out === "" ? null : Number(card.out),
      offset: card.offset == null || card.offset === "" ? 0 : Number(card.offset),
      gain: card.gain == null || card.gain === "" ? 1 : Number(card.gain),
      fadeIn: card.fadeIn == null || card.fadeIn === "" ? 0 : Number(card.fadeIn),
      fadeOut: card.fadeOut == null || card.fadeOut === "" ? 0 : Number(card.fadeOut),
      intendedSectionTitle: card.intendedSectionTitle == null ? null : String(card.intendedSectionTitle),
      brandingTemplateId: card.brandingTemplateId == null ? null : String(card.brandingTemplateId),
    };
  });
}

function episodeRow(row) {
  return (
    row && {
      id: row.id,
      title: row.title,
      notes: row.notes,
      state: row.state || "Scaffold",
      revision: row.revision,
      cards: parse(row.cards, []),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  );
}
function assetRow(row) {
  return (
    row && {
      id: row.id,
      name: row.name,
      hash: row.hash,
      kind: row.kind,
      path: row.path,
      duration: row.duration,
      width: row.width,
      height: row.height,
      metadata: parse(row.metadata, {}),
      thumbnailPath: row.thumbnail_path,
      createdAt: row.created_at,
    }
  );
}
function libraryItemRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    episodeId: row.episode_id,
    assetId: row.asset_id,
    category: row.category,
    label: row.label,
    tags: parse(row.tags, []),
    notes: row.notes,
    sectionId: row.section_id,
    sourceKind: row.source_kind,
    sourceUrl: row.source_url,
    extractedText: row.extracted_text,
    extractionStatus: row.extraction_status,
    provenance: parse(row.provenance, {}),
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    asset: row.asset_id ? assetRow({ ...row, id: row.asset_id, created_at: row.asset_created_at }) : null,
  };
}
function jobRow(row) {
  return (
    row && {
      id: row.id,
      episodeId: row.episode_id,
      kind: row.kind,
      state: row.state,
      progress: row.progress,
      revision: row.revision,
      outputPath: row.output_path,
      error: row.error,
      outputClass: row.output_class || "active",
      snapshot: parse(row.snapshot),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  );
}

export class Store {
  constructor(workspace, { afterMigrationCommit, beforeStoryPublish, afterStoryRename } = {}) {
    this.workspace = path.resolve(workspace);
    this.afterMigrationCommit = afterMigrationCommit;
    this.beforeStoryPublish = beforeStoryPublish;
    this.afterStoryRename = afterStoryRename;
    for (const dir of ["", "media", "cache", "exports", "imports", "branding/assets"])
      mkdirSync(path.join(this.workspace, dir), { recursive: true });
    const databasePath = path.join(this.workspace, "storybench.sqlite");
    const existingDatabase = existsSync(databasePath);
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
    this.migrate(existingDatabase);
    for (const episode of this.db.prepare("SELECT id FROM episodes").all())
      this.ensureEpisodeDirectories(episode.id);
    this.recoverPendingStories();
    this.db
      .prepare(
        "UPDATE jobs SET state='failed', error='Render interrupted by server restart', updated_at=? WHERE state IN ('queued','running')",
      )
      .run(now());
  }
  migrate(existingDatabase) {
    const version = Number(this.db.prepare("PRAGMA user_version").get().user_version);
    if (version >= 4) return;
    const hadLegacySchema = this.db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='episodes'")
      .get();
    if (existingDatabase && hadLegacySchema) {
      const backupPath = path.join(this.workspace, "storybench.pre-v2.sqlite");
      if (!existsSync(backupPath)) {
        const escaped = backupPath.replaceAll("'", "''");
        this.db.exec(`VACUUM INTO '${escaped}'`);
      }
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS episodes (id TEXT PRIMARY KEY,title TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL,cards TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'Scaffold');
        CREATE TABLE IF NOT EXISTS episode_history (episode_id TEXT NOT NULL,revision INTEGER NOT NULL,title TEXT NOT NULL,notes TEXT NOT NULL,cards TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL,parent_revision INTEGER,PRIMARY KEY(episode_id,revision));
        CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY,name TEXT NOT NULL,hash TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,path TEXT NOT NULL,duration REAL,width INTEGER,height INTEGER,metadata TEXT NOT NULL,thumbnail_path TEXT,created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY,episode_id TEXT NOT NULL,kind TEXT NOT NULL,state TEXT NOT NULL,progress REAL NOT NULL DEFAULT 0,revision INTEGER NOT NULL,output_path TEXT,error TEXT,snapshot TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,output_class TEXT NOT NULL DEFAULT 'active');
        CREATE TABLE IF NOT EXISTS stories (episode_id TEXT PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE,source TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 1,sections TEXT NOT NULL DEFAULT '[]',publication_pending INTEGER NOT NULL DEFAULT 1,committed_hash TEXT NOT NULL,published_hash TEXT,updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS story_sections (id TEXT PRIMARY KEY,episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,title TEXT NOT NULL,sort_order INTEGER NOT NULL,retired_at TEXT);
        CREATE TABLE IF NOT EXISTS story_history (episode_id TEXT NOT NULL,revision INTEGER NOT NULL,source TEXT NOT NULL,sections TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(episode_id,revision));
        CREATE TABLE IF NOT EXISTS episode_library (episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,asset_id TEXT NOT NULL REFERENCES assets(id),category TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(episode_id,asset_id));
        CREATE TABLE IF NOT EXISTS migration_log (version INTEGER PRIMARY KEY,completed_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS library_items (
          id TEXT PRIMARY KEY,
          episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
          asset_id TEXT NOT NULL REFERENCES assets(id),
          category TEXT NOT NULL,
          label TEXT NOT NULL,
          tags TEXT NOT NULL DEFAULT '[]',
          notes TEXT NOT NULL DEFAULT '',
          section_id TEXT,
          source_kind TEXT NOT NULL DEFAULT 'file',
          source_url TEXT,
          extracted_text TEXT NOT NULL DEFAULT '',
          extraction_status TEXT NOT NULL DEFAULT 'not-applicable',
          provenance TEXT NOT NULL DEFAULT '{}',
          revision INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS branding_templates (
          id TEXT PRIMARY KEY,name TEXT NOT NULL,role TEXT,
          source_episode_id TEXT NOT NULL,source_card_id TEXT NOT NULL,
          card_snapshot TEXT NOT NULL,dependency_items TEXT NOT NULL,
          created_at TEXT NOT NULL,updated_at TEXT NOT NULL
        );
      `);
      const columns = (table) =>
        new Set(this.db.prepare(`PRAGMA table_info('${table}')`).all().map((column) => column.name));
      if (!columns("episodes").has("state"))
        this.db.exec("ALTER TABLE episodes ADD COLUMN state TEXT NOT NULL DEFAULT 'Scaffold'");
      if (!columns("episode_history").has("parent_revision")) {
        this.db.exec("ALTER TABLE episode_history ADD COLUMN parent_revision INTEGER");
        this.db.exec("UPDATE episode_history SET parent_revision=revision-1 WHERE revision>1");
      }
      if (!columns("jobs").has("output_class")) {
        this.db.exec("ALTER TABLE jobs ADD COLUMN output_class TEXT NOT NULL DEFAULT 'active'");
        this.db.exec("UPDATE jobs SET output_class='legacy_draft'");
      }
      if (this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='chats'").get() && !columns("chats").has("name"))
        this.db.exec("ALTER TABLE chats ADD COLUMN name TEXT NOT NULL DEFAULT 'Conversation 1'");
      const stamp = now();
      if (!this.db.prepare("SELECT 1 FROM episodes LIMIT 1").get() && this.db.prepare("SELECT 1 FROM assets LIMIT 1").get()) {
        const importedId = id("episode");
        this.db.prepare("INSERT INTO episodes(id,title,notes,revision,cards,created_at,updated_at,state) VALUES(?,?,?,?,?,?,?,?)")
          .run(importedId, "Imported library", "", 1, "[]", stamp, stamp, "Scaffold");
        this.db.prepare("INSERT INTO episode_history(episode_id,revision,title,notes,cards,actor,created_at,parent_revision) VALUES(?,?,?,?,?,?,?,?)")
          .run(importedId, 1, "Imported library", "", "[]", "migration", stamp, null);
      }
      const emptyHash = hash("");
      this.db.prepare(`INSERT OR IGNORE INTO stories(episode_id,source,revision,sections,publication_pending,committed_hash,published_hash,updated_at)
        SELECT id,'',1,'[]',1,?,NULL,? FROM episodes`).run(emptyHash, stamp);
      this.db.prepare(`INSERT OR IGNORE INTO story_history(episode_id,revision,source,sections,actor,created_at)
        SELECT id,1,'','[]','migration',? FROM episodes`).run(stamp);
      const category = (kind) => kind === "video" ? "B-roll" : kind === "audio" ? "Narration" : kind === "image" ? "Graphics" : "Reference";
      const episodes = this.db.prepare("SELECT id FROM episodes").all();
      const assets = this.db.prepare("SELECT id,kind FROM assets").all();
      const membership = this.db.prepare("INSERT OR IGNORE INTO episode_library(episode_id,asset_id,category,created_at) VALUES(?,?,?,?)");
      for (const episode of episodes)
        for (const asset of assets) membership.run(episode.id, asset.id, category(asset.kind), stamp);
      this.db.prepare(`INSERT OR IGNORE INTO library_items(
        id,episode_id,asset_id,category,label,source_kind,created_at,updated_at
      ) SELECT 'library_' || lower(hex(randomblob(16))),l.episode_id,l.asset_id,l.category,a.name,'file',l.created_at,l.created_at
        FROM episode_library l JOIN assets a ON a.id=l.asset_id`).run();
      for (const row of this.db.prepare("SELECT id,cards FROM episodes").all()) {
        const legacy = parse(row.cards, []);
        if (!legacy.some((card) => !card.type)) continue;
        this.db.prepare("UPDATE episodes SET cards=? WHERE id=?").run(JSON.stringify(this.normalizeLegacyCards(row.id, legacy)), row.id);
      }
      this.db.prepare("INSERT OR REPLACE INTO migration_log(version,completed_at) VALUES(4,?)").run(stamp);
      this.db.exec("PRAGMA user_version=4; COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    try {
      this.afterMigrationCommit?.();
    } catch (error) {
      this.db.close();
      throw error;
    }
    for (const episode of this.db.prepare("SELECT id FROM episodes").all())
      this.ensureEpisodeDirectories(episode.id);
  }
  episodeDirectory(episodeId) {
    const episodesRoot = path.join(this.workspace, "episodes");
    const directory = path.resolve(episodesRoot, String(episodeId));
    if (directory === episodesRoot || !directory.startsWith(episodesRoot + path.sep))
      throw new StoreError("Invalid registered episode path", 403);
    return directory;
  }
  ensureEpisodeDirectories(episodeId) {
    const episodeDirectory = this.episodeDirectory(episodeId);
    mkdirSync(path.join(this.workspace, "episodes"), { recursive: true });
    mkdirSync(episodeDirectory, { recursive: true });
    const actual = realpathSync(episodeDirectory);
    const root = realpathSync(path.join(this.workspace, "episodes"));
    if (actual === root || !actual.startsWith(root + path.sep))
      throw new StoreError("Registered episode path escapes the workspace", 403);
    for (const dir of ["reference", "b-roll", "narration", "graphics", "drafts", "final", "cache", "conflicts"]) {
      const destination = path.join(episodeDirectory, dir);
      mkdirSync(destination, { recursive: true });
      const resolved = realpathSync(destination);
      if (!resolved.startsWith(root + path.sep))
        throw new StoreError("Registered episode path escapes the workspace", 403);
    }
  }
  close() {
    this.db.close();
  }
  listEpisodes() {
    return this.db
      .prepare("SELECT * FROM episodes ORDER BY updated_at DESC")
      .all()
      .map(episodeRow);
  }
  getEpisode(episodeId) {
    return episodeRow(
      this.db.prepare("SELECT * FROM episodes WHERE id=?").get(episodeId),
    );
  }
  createEpisode({ title = "Untitled episode", notes = "" } = {}) {
    const episode = {
      id: id("episode"),
      title: String(title).trim() || "Untitled episode",
      notes: String(notes),
      state: "Scaffold",
      revision: 1,
      cards: [],
      createdAt: now(),
      updatedAt: now(),
    };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare("INSERT INTO episodes(id,title,notes,revision,cards,created_at,updated_at,state) VALUES(?,?,?,?,?,?,?,?)")
        .run(
          episode.id,
          episode.title,
          episode.notes,
          1,
          "[]",
          episode.createdAt,
          episode.updatedAt,
          episode.state,
        );
      this.db
        .prepare(
          "INSERT INTO episode_history(episode_id,revision,title,notes,cards,actor,created_at,parent_revision) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          episode.id,
          1,
          episode.title,
          episode.notes,
          "[]",
          "human",
          episode.createdAt,
          null,
        );
      this.db
        .prepare("INSERT INTO stories(episode_id,source,revision,sections,publication_pending,committed_hash,published_hash,updated_at) VALUES(?,?,?,?,?,?,?,?)")
        .run(episode.id, "", 1, "[]", 1, hash(""), null, episode.createdAt);
      this.db
        .prepare("INSERT INTO story_history(episode_id,revision,source,sections,actor,created_at) VALUES(?,?,?,?,?,?)")
        .run(episode.id, 1, "", "[]", "human", episode.createdAt);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    this.ensureEpisodeDirectories(episode.id);
    this.publishStory(episode.id);
    const standards = this.listBrandingTemplates().filter((value) => value.role);
    if (standards.length)
      this.saveStory(episode.id, 1, "# Overview\n\n# Hook\n\n# Sections\n\n## Intro\n\n## Outro\n", "branding-standard");
    for (const template of standards)
      this.applyBrandingTemplate(episode.id, template.id, { automatic: true });
    return this.getEpisode(episode.id);
  }
  updateEpisode(
    episodeId,
    expectedRevision,
    changes,
    actor = "human",
    parentRevision = expectedRevision,
  ) {
    const current = this.getEpisode(episodeId);
    if (!current) throw new StoreError("Episode not found", 404);
    if (
      !Number.isInteger(expectedRevision) ||
      expectedRevision !== current.revision
    )
      throw new StoreError(`Stale revision: expected ${current.revision}`, 409);
    const cards =
      changes.cards == null ? current.cards : validateCards(changes.cards);
    const state = changes.state == null ? current.state : String(changes.state);
    if (!["Scaffold", "Draft", "Final", "Published"].includes(state))
      throw new StoreError("state must be Scaffold, Draft, Final, or Published");
    for (const card of cards)
      for (const [field, value] of [
        ["visual", card.visual],
        ["narration", card.narration],
      ])
        if (value) {
          const asset = this.getAsset(value.assetId);
          if (!asset) throw new StoreError(`${field} asset not found`);
          if (field === "visual" && !["video", "image"].includes(asset.kind))
            throw new StoreError("Visual source must be video or image");
          if (field === "narration" && !["video", "audio"].includes(asset.kind))
            throw new StoreError("Narration source must contain audio");
          if (field === "narration" && !asset.metadata?.hasAudio)
            throw new StoreError("Narration source has no audio stream");
          if (asset.duration != null && value.out > asset.duration + 0.001)
            throw new StoreError(`${field} range exceeds source duration`);
        }
    for (const card of cards)
      if (card.sectionId && !this.db.prepare("SELECT 1 FROM story_sections WHERE id=? AND episode_id=? AND retired_at IS NULL").get(card.sectionId, episodeId))
        throw new StoreError(`Story section not found for this episode: ${card.sectionId}`);
    const libraryById = new Map(this.listEpisodeLibrary(episodeId).map((item) => [item.id, item]));
    const cardIds = new Set(cards.map((card) => card.id));
    for (const card of cards) {
      for (const itemId of [card.itemId, ...card.referenceItemIds].filter(Boolean))
        if (!libraryById.has(itemId)) throw new StoreError(`Library item not found for this episode: ${itemId}`);
      if (card.type === "Audio" && card.anchorVisualCardId && !cardIds.has(card.anchorVisualCardId))
        throw new StoreError(`Audio anchor card not found: ${card.anchorVisualCardId}`);
      const selected = card.itemId ? libraryById.get(card.itemId) : null;
      if (selected) {
        const kind = selected.asset.kind;
        if (card.type === "Static Graphic" && kind !== "image") throw new StoreError("Static Graphic requires an image library item");
        if (["Video", "Video/Audio", "Video Graphic"].includes(card.type) && kind !== "video") throw new StoreError(`${card.type} requires a video library item`);
        if (card.type === "Audio" && !(kind === "audio" || (kind === "video" && selected.asset.metadata?.hasAudio))) throw new StoreError("Audio requires an audio-bearing library item");
      }
      if (card.role && !["voiceover", "music", "sound effect", "other"].includes(card.role))
        throw new StoreError("audio role is invalid");
      for (const key of ["in", "out", "offset", "gain", "fadeIn", "fadeOut"])
        if (card[key] != null && !Number.isFinite(card[key])) throw new StoreError(`${key} must be finite`);
    }
    const next = {
      ...current,
      title: changes.title == null ? current.title : String(changes.title),
      notes: changes.notes == null ? current.notes : String(changes.notes),
      cards,
      state,
      revision: current.revision + 1,
      updatedAt: now(),
    };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db
        .prepare(
          "UPDATE episodes SET title=?,notes=?,state=?,revision=?,cards=?,updated_at=? WHERE id=? AND revision=?",
        )
        .run(
          next.title,
          next.notes,
          next.state,
          next.revision,
          JSON.stringify(next.cards),
          next.updatedAt,
          episodeId,
          expectedRevision,
        );
      if (!result.changes) throw new StoreError("Stale revision", 409);
      this.db
        .prepare(
          "INSERT INTO episode_history(episode_id,revision,title,notes,cards,actor,created_at,parent_revision) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          episodeId,
          next.revision,
          next.title,
          next.notes,
          JSON.stringify(next.cards),
          actor,
          next.updatedAt,
          parentRevision,
        );
      this.db.exec("COMMIT");
      return next;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  undoEpisode(episodeId, expectedRevision) {
    const current = this.getEpisode(episodeId);
    if (!current) throw new StoreError("Episode not found", 404);
    if (current.revision !== expectedRevision)
      throw new StoreError(`Stale revision: expected ${current.revision}`, 409);
    const currentHistory = this.db
      .prepare(
        "SELECT * FROM episode_history WHERE episode_id=? AND revision=?",
      )
      .get(episodeId, current.revision);
    const prior =
      currentHistory?.parent_revision == null
        ? null
        : this.db
            .prepare(
              "SELECT * FROM episode_history WHERE episode_id=? AND revision=?",
            )
            .get(episodeId, currentHistory.parent_revision);
    if (!prior) throw new StoreError("Nothing to undo", 409);
    return this.updateEpisode(
      episodeId,
      expectedRevision,
      { title: prior.title, notes: prior.notes, cards: this.normalizeLegacyCards(episodeId, parse(prior.cards, [])) },
      "undo",
      prior.parent_revision,
    );
  }
  listEpisodeHistory(episodeId) {
    return this.db
      .prepare(
        "SELECT revision,actor,created_at AS createdAt,title FROM episode_history WHERE episode_id=? ORDER BY revision DESC",
      )
      .all(episodeId);
  }
  listEpisodeLibrary(episodeId) {
    if (!this.getEpisode(episodeId)) throw new StoreError("Episode not found", 404);
    return this.db.prepare(`SELECT l.*,a.id AS id_asset,a.name,a.hash,a.kind,a.path,a.duration,a.width,a.height,
      a.metadata,a.thumbnail_path,a.created_at AS asset_created_at
      FROM library_items l JOIN assets a ON a.id=l.asset_id
      WHERE l.episode_id=? ORDER BY l.created_at,l.id`).all(episodeId).map((row) =>
        libraryItemRow({ ...row, id: row.id, created_at: row.created_at })
      );
  }
  normalizeLegacyCards(episodeId, cards) {
    const findMembership = this.db.prepare("SELECT id FROM library_items WHERE episode_id=? AND asset_id=? ORDER BY created_at,id LIMIT 1");
    const converted = [];
    for (let order = 0; order < cards.length; order++) {
      const card = cards[order];
      if (card.type) { converted.push(card); continue; }
      const common = { ...card, prompt: card.purpose || "", referenceItemIds: [], referenceUrls: [], enabled: true, excluded: false, order };
      if (!card.visual && !card.narration) { converted.push({ ...common, type: "Video", itemId: null }); continue; }
      if (card.visual) {
        const asset = this.getAsset(card.visual.assetId);
        converted.push({ ...common, type: asset?.kind === "image" ? "Static Graphic" : asset?.metadata?.hasAudio ? "Video/Audio" : "Video",
          itemId: findMembership.get(episodeId, card.visual.assetId)?.id || null,
          in: card.visual.in, out: card.visual.out, gain: card.visual.gain, offset: 0,
          duration: card.duration ?? (asset?.kind === "image" ? card.visual.out - card.visual.in : null) });
      }
      if (card.narration) converted.push({ ...common, id: card.visual ? `${card.id}__audio` : card.id,
        title: card.visual ? `${card.title || "Card"} audio` : card.title, type: "Audio",
        itemId: findMembership.get(episodeId, card.narration.assetId)?.id || null,
        role: "voiceover", anchorVisualCardId: card.visual ? card.id : null,
        in: card.narration.in, out: card.narration.out, offset: card.narration.offset, gain: card.narration.gain,
        duration: null, visual: null, narration: card.narration, order: order + 0.5 });
    }
    return converted;
  }
  getLibraryItem(episodeId, itemId) {
    if (!this.getEpisode(episodeId)) throw new StoreError("Episode not found", 404);
    const row = this.db.prepare(`SELECT l.*,a.name,a.hash,a.kind,a.path,a.duration,a.width,a.height,
      a.metadata,a.thumbnail_path,a.created_at AS asset_created_at
      FROM library_items l JOIN assets a ON a.id=l.asset_id WHERE l.episode_id=? AND l.id=?`).get(episodeId, itemId);
    return libraryItemRow(row);
  }
  attachLibraryItem(episodeId, assetId, details = {}) {
    if (!this.getEpisode(episodeId)) throw new StoreError("Episode not found", 404);
    const asset = this.getAsset(assetId);
    if (!asset) throw new StoreError("Asset not found", 404);
    const category = String(details.category || "Reference");
    if (!["Reference", "B-roll", "Narration", "Graphics"].includes(category))
      throw new StoreError("Unknown library category");
    const sectionId = details.sectionId == null || details.sectionId === "" ? null : String(details.sectionId);
    if (sectionId && !this.db.prepare("SELECT 1 FROM story_sections WHERE id=? AND episode_id=? AND retired_at IS NULL").get(sectionId, episodeId))
      throw new StoreError("Story section not found for this episode");
    const stamp = now();
    const itemId = id("library");
    this.db.prepare(`INSERT INTO library_items(
      id,episode_id,asset_id,category,label,tags,notes,section_id,source_kind,source_url,
      extracted_text,extraction_status,provenance,revision,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      itemId, episodeId, assetId, category, String(details.label || asset.name),
      JSON.stringify(details.tags || []), String(details.notes || ""), sectionId,
      String(details.sourceKind || "file"), details.sourceUrl || null,
      String(details.extractedText || ""), String(details.extractionStatus || "not-applicable"),
      JSON.stringify(details.provenance || {}), 1, stamp, stamp,
    );
    return this.getLibraryItem(episodeId, itemId);
  }
  updateLibraryItem(episodeId, itemId, expectedRevision, changes = {}) {
    const current = this.getLibraryItem(episodeId, itemId);
    if (!current) throw new StoreError("Library item not found", 404);
    if (!Number.isInteger(expectedRevision) || expectedRevision !== current.revision)
      throw new StoreError(`Stale library revision: expected ${current.revision}`, 409, { current });
    const category = changes.category == null ? current.category : String(changes.category);
    if (!["Reference", "B-roll", "Narration", "Graphics"].includes(category))
      throw new StoreError("Unknown library category");
    const sectionId = changes.sectionId === undefined ? current.sectionId : changes.sectionId == null || changes.sectionId === "" ? null : String(changes.sectionId);
    if (sectionId && !this.db.prepare("SELECT 1 FROM story_sections WHERE id=? AND episode_id=? AND retired_at IS NULL").get(sectionId, episodeId))
      throw new StoreError("Story section not found for this episode");
    const tags = changes.tags == null ? current.tags : changes.tags;
    if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string"))
      throw new StoreError("tags must be an array of strings");
    const stamp = now();
    const result = this.db.prepare(`UPDATE library_items SET category=?,label=?,tags=?,notes=?,section_id=?,revision=revision+1,updated_at=?
      WHERE id=? AND episode_id=? AND revision=?`).run(
      category, changes.label == null ? current.label : String(changes.label).trim() || current.asset.name,
      JSON.stringify(tags.map((tag) => tag.trim()).filter(Boolean)), changes.notes == null ? current.notes : String(changes.notes),
      sectionId, stamp, itemId, episodeId, expectedRevision,
    );
    if (!result.changes) throw new StoreError("Stale library revision", 409);
    return this.getLibraryItem(episodeId, itemId);
  }
  listBrandingTemplates() {
    return this.db.prepare("SELECT * FROM branding_templates ORDER BY created_at,id").all().map((row) => ({
      id: row.id, name: row.name, role: row.role, sourceEpisodeId: row.source_episode_id,
      sourceCardId: row.source_card_id, card: parse(row.card_snapshot, {}), dependencies: parse(row.dependency_items, []),
      createdAt: row.created_at, updatedAt: row.updated_at,
    }));
  }
  getBrandingTemplate(templateId) {
    return this.listBrandingTemplates().find((template) => template.id === templateId) || null;
  }
  promoteCard(episodeId, cardId, { name, role = null } = {}) {
    const episode = this.getEpisode(episodeId);
    if (!episode) throw new StoreError("Episode not found", 404);
    const card = episode.cards.find((value) => value.id === cardId);
    if (!card) throw new StoreError("Card not found", 404);
    if (role != null && !["intro", "outro"].includes(role)) throw new StoreError("Branding role must be intro or outro");
    const dependencies = [];
    for (const itemId of [...new Set([card.itemId, ...(card.referenceItemIds || [])].filter(Boolean))]) {
      const item = this.getLibraryItem(episodeId, itemId);
      if (!item) throw new StoreError(`Library item not found for this episode: ${itemId}`);
      const source = path.resolve(this.workspace, item.asset.path);
      const workspaceReal = realpathSync(this.workspace), sourceReal = realpathSync(source);
      if (!sourceReal.startsWith(workspaceReal + path.sep)) throw new StoreError("Branding dependency escapes the workspace", 403);
      const destination = path.join(this.workspace, "branding", "assets", `${item.asset.hash}-${path.basename(item.asset.path)}`);
      if (!existsSync(destination)) copyFileSync(source, destination);
      const registered = path.relative(this.workspace, destination);
      if (item.asset.path !== registered) this.db.prepare("UPDATE assets SET path=? WHERE id=?").run(registered, item.assetId);
      dependencies.push({ sourceItemId: item.id, assetId: item.assetId, category: item.category, label: item.label });
    }
    const snapshot = { ...structuredClone(card), id: null,
      anchorVisualCardId: card.type === "Audio" ? null : card.anchorVisualCardId,
      intendedSectionTitle: role === "intro" ? "Intro" : role === "outro" ? "Outro" : card.intendedSectionTitle };
    const stamp = now(), templateId = id("branding");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (role) this.db.prepare("UPDATE branding_templates SET role=NULL,updated_at=? WHERE role=?").run(stamp, role);
      this.db.prepare("INSERT INTO branding_templates VALUES(?,?,?,?,?,?,?,?,?)")
        .run(templateId, String(name || card.title || "Reusable card"), role, episodeId, cardId, JSON.stringify(snapshot), JSON.stringify(dependencies), stamp, stamp);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.getBrandingTemplate(templateId);
  }
  setBrandingRole(templateId, role) {
    if (role != null && !["intro", "outro"].includes(role)) throw new StoreError("Branding role must be intro or outro");
    if (!this.getBrandingTemplate(templateId)) throw new StoreError("Branding template not found", 404);
    const stamp = now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (role) this.db.prepare("UPDATE branding_templates SET role=NULL,updated_at=? WHERE role=?").run(stamp, role);
      this.db.prepare("UPDATE branding_templates SET role=?,updated_at=? WHERE id=?").run(role, stamp, templateId);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.getBrandingTemplate(templateId);
  }
  applyBrandingTemplate(episodeId, templateId, { automatic = false } = {}) {
    const template = this.getBrandingTemplate(templateId);
    if (!template) throw new StoreError("Branding template not found", 404);
    let episode = this.getEpisode(episodeId);
    if (!episode) throw new StoreError("Episode not found", 404);
    if (automatic && episode.cards.some((card) => card.brandingTemplateId === templateId)) return episode;
    const createdItemIds = [], itemMap = new Map();
    try {
      for (const dependency of template.dependencies) {
        const item = this.attachLibraryItem(episodeId, dependency.assetId, { category: dependency.category, label: dependency.label, sourceKind: "branding", provenance: { brandingTemplateId: templateId, sourceItemId: dependency.sourceItemId } });
        createdItemIds.push(item.id); itemMap.set(dependency.sourceItemId, item.id);
      }
      const source = template.card;
      const intendedSectionTitle = template.role === "intro" ? "Intro" : template.role === "outro" ? "Outro" : source.intendedSectionTitle;
      const sectionId = intendedSectionTitle ? this.getStory(episodeId).sections.find((section) => section.title.trim().toLowerCase() === intendedSectionTitle.trim().toLowerCase())?.id || null : null;
      const card = { ...structuredClone(source), id: id("card"), brandingTemplateId: templateId,
        itemId: source.itemId ? itemMap.get(source.itemId) || null : null,
        referenceItemIds: (source.referenceItemIds || []).map((value) => itemMap.get(value)).filter(Boolean),
        anchorVisualCardId: null, sectionId, intendedSectionTitle };
      episode = this.updateEpisode(episodeId, episode.revision, { cards: [...episode.cards, card] }, automatic ? "branding-standard" : "branding");
      return episode;
    } catch (error) {
      for (const itemId of createdItemIds) this.db.prepare("DELETE FROM library_items WHERE id=? AND episode_id=?").run(itemId, episodeId);
      throw error;
    }
  }
  getStory(episodeId) {
    if (!this.getEpisode(episodeId)) throw new StoreError("Episode not found", 404);
    const story = storyRow(this.db.prepare("SELECT * FROM stories WHERE episode_id=?").get(episodeId));
    if (!story) throw new StoreError("Story not found", 404);
    const file = path.join(this.episodeDirectory(episodeId), "story.md");
    if (existsSync(file) && lstatSync(file).isSymbolicLink())
      throw new StoreError("Registered story file cannot be a symbolic link", 403);
    if (existsSync(file) && story.publishedHash) {
      const fileHash = hash(readFileSync(file));
      if (fileHash !== story.publishedHash && !(story.publicationPending && fileHash === story.committedHash))
        return { ...story, publicationStatus: "external-conflict", externalConflict: true };
    }
    return story;
  }
  saveStory(episodeId, expectedStoryRevision, source, actor = "human") {
    const current = this.getStory(episodeId);
    if (!Number.isInteger(expectedStoryRevision) || expectedStoryRevision !== current.storyRevision)
      throw new StoreError(`Stale story revision: expected ${current.storyRevision}`, 409, { current });
    const normalized = normalizeStory(source, current.sections);
    for (const section of normalized.sections) {
      const owner = this.db.prepare("SELECT episode_id FROM story_sections WHERE id=?").get(section.id);
      if (owner && owner.episode_id !== episodeId)
        throw new StoreError(`Story section id belongs to another episode: ${section.id}`);
    }
    const stamp = now();
    const nextRevision = current.storyRevision + 1;
    let unassignedCardIds = [];
    let unassignedLibraryItemIds = [];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const episode = this.getEpisode(episodeId);
      const cards = episode.cards.map((card) => {
        if (card.sectionId && normalized.retiredSectionIds.includes(card.sectionId)) {
          unassignedCardIds.push(card.id);
          return { ...card, sectionId: null };
        }
        return card;
      });
      let assignedStandardCards = false;
      for (const card of cards) {
        if (!card.sectionId && card.intendedSectionTitle) {
          const section = normalized.sections.find((value) => value.title.trim().toLowerCase() === card.intendedSectionTitle.trim().toLowerCase());
          if (section) { card.sectionId = section.id; assignedStandardCards = true; }
        }
      }
      this.db.prepare("UPDATE story_sections SET retired_at=? WHERE episode_id=? AND retired_at IS NULL").run(stamp, episodeId);
      if (normalized.retiredSectionIds.length) {
        const placeholders = normalized.retiredSectionIds.map(() => "?").join(",");
        unassignedLibraryItemIds = this.db.prepare(`SELECT id FROM library_items WHERE episode_id=? AND section_id IN (${placeholders})`).all(episodeId, ...normalized.retiredSectionIds).map((row) => row.id);
        this.db.prepare(`UPDATE library_items SET section_id=NULL,revision=revision+1,updated_at=? WHERE episode_id=? AND section_id IN (${placeholders})`).run(stamp, episodeId, ...normalized.retiredSectionIds);
      }
      const upsert = this.db.prepare(`INSERT INTO story_sections(id,episode_id,title,sort_order,retired_at) VALUES(?,?,?,?,NULL)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title,sort_order=excluded.sort_order,retired_at=NULL`);
      for (const section of normalized.sections)
        upsert.run(section.id, episodeId, section.title, section.order);
      this.db.prepare(`UPDATE stories SET source=?,revision=?,sections=?,publication_pending=1,committed_hash=?,updated_at=?
        WHERE episode_id=? AND revision=?`).run(normalized.source, nextRevision, JSON.stringify(normalized.sections), hash(normalized.source), stamp, episodeId, expectedStoryRevision);
      this.db.prepare("INSERT INTO story_history(episode_id,revision,source,sections,actor,created_at) VALUES(?,?,?,?,?,?)")
        .run(episodeId, nextRevision, normalized.source, JSON.stringify(normalized.sections), actor, stamp);
      if (unassignedCardIds.length || assignedStandardCards) {
        const boardRevision = episode.revision + 1;
        this.db.prepare("UPDATE episodes SET cards=?,revision=?,updated_at=? WHERE id=? AND revision=?")
          .run(JSON.stringify(cards), boardRevision, stamp, episodeId, episode.revision);
        this.db.prepare("INSERT INTO episode_history(episode_id,revision,title,notes,cards,actor,created_at,parent_revision) VALUES(?,?,?,?,?,?,?,?)")
          .run(episodeId, boardRevision, episode.title, episode.notes, JSON.stringify(cards), "story", stamp, episode.revision);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    try {
      const published = this.publishStory(episodeId);
      return { ...published, mappingChanges: { retiredSectionIds: normalized.retiredSectionIds, unassignedCardIds, unassignedLibraryItemIds } };
    } catch (error) {
      if (error.statusCode === 409) throw error;
      const committed = this.getStory(episodeId);
      throw new StoreError("Story was committed but file publication is pending", 503, { committed, cause: error });
    }
  }
  publishStory(episodeId) {
    const story = storyRow(this.db.prepare("SELECT * FROM stories WHERE episode_id=?").get(episodeId));
    if (!story) throw new StoreError("Story not found", 404);
    if (!story.publicationPending) return story;
    this.ensureEpisodeDirectories(episodeId);
    const folder = this.episodeDirectory(episodeId);
    const file = path.join(folder, "story.md");
    let fileHash = null;
    if (existsSync(file)) {
      if (lstatSync(file).isSymbolicLink())
        throw new StoreError("Registered story file cannot be a symbolic link", 403);
      fileHash = hash(readFileSync(file));
    }
    if (fileHash === story.committedHash) {
      this.db.prepare("UPDATE stories SET publication_pending=0,published_hash=? WHERE episode_id=? AND revision=?")
        .run(story.committedHash, episodeId, story.storyRevision);
      return this.getStory(episodeId);
    }
    if (fileHash && story.publishedHash && fileHash !== story.publishedHash) {
      const conflict = path.join(folder, "conflicts", `story-${Date.now()}.md`);
      copyFileSync(file, conflict);
      throw new StoreError("The registered story file changed outside Storybench; it was preserved as a conflict artifact", 409, { conflictPath: path.relative(this.workspace, conflict) });
    }
    const temporary = path.join(folder, `.story-${crypto.randomUUID()}.tmp`);
    try {
      this.beforeStoryPublish?.({ episodeId, story, file, temporary });
      const descriptor = openSync(temporary, "wx");
      try {
        writeFileSync(descriptor, story.source, { encoding: "utf8" });
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      renameSync(temporary, file);
      this.afterStoryRename?.({ episodeId, story, file });
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
    this.db.prepare("UPDATE stories SET publication_pending=0,published_hash=? WHERE episode_id=? AND revision=?")
      .run(story.committedHash, episodeId, story.storyRevision);
    return this.getStory(episodeId);
  }
  retryStoryPublication(episodeId, expectedStoryRevision) {
    const current = this.getStory(episodeId);
    if (!Number.isInteger(expectedStoryRevision) || expectedStoryRevision !== current.storyRevision)
      throw new StoreError(`Stale story revision: expected ${current.storyRevision}`, 409, { current });
    return current.publicationPending ? this.publishStory(episodeId) : current;
  }
  recoverPendingStories() {
    if (!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='stories'").get()) return [];
    const outcomes = [];
    for (const row of this.db.prepare("SELECT episode_id FROM stories WHERE publication_pending=1").all()) {
      try {
        outcomes.push({ episodeId: row.episode_id, recovered: true, story: this.publishStory(row.episode_id) });
      } catch (error) {
        outcomes.push({ episodeId: row.episode_id, recovered: false, error });
      }
    }
    return outcomes;
  }
  listAssets() {
    return this.db
      .prepare("SELECT * FROM assets ORDER BY created_at DESC")
      .all()
      .map(assetRow);
  }
  getAsset(assetId) {
    return assetRow(
      this.db.prepare("SELECT * FROM assets WHERE id=?").get(assetId),
    );
  }
  getAssetByHash(hash) {
    return assetRow(
      this.db.prepare("SELECT * FROM assets WHERE hash=?").get(hash),
    );
  }
  saveAsset(asset) {
    const existing = this.getAssetByHash(asset.hash);
    if (existing) return existing;
    const value = {
      ...asset,
      id: asset.id || id("asset"),
      createdAt: asset.createdAt || now(),
    };
    this.db
      .prepare("INSERT INTO assets VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(
        value.id,
        value.name,
        value.hash,
        value.kind,
        value.path,
        value.duration ?? null,
        value.width ?? null,
        value.height ?? null,
        JSON.stringify(value.metadata || {}),
        value.thumbnailPath ?? null,
        value.createdAt,
      );
    return this.getAsset(value.id);
  }
  listJobs(episodeId) {
    return (
      episodeId
        ? this.db
            .prepare(
              "SELECT * FROM jobs WHERE episode_id=? ORDER BY created_at DESC",
            )
            .all(episodeId)
        : this.db.prepare("SELECT * FROM jobs ORDER BY created_at DESC").all()
    ).map(jobRow);
  }
  getJob(jobId) {
    return jobRow(this.db.prepare("SELECT * FROM jobs WHERE id=?").get(jobId));
  }
  saveJob(job) {
    const old = job.id && this.getJob(job.id);
    const value = {
      ...old,
      ...job,
      id: job.id || id("job"),
      createdAt: old?.createdAt || job.createdAt || now(),
      updatedAt: now(),
    };
    this.db
      .prepare(
        `INSERT INTO jobs(id,episode_id,kind,state,progress,revision,output_path,error,snapshot,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,progress=excluded.progress,output_path=excluded.output_path,error=excluded.error,snapshot=excluded.snapshot,updated_at=excluded.updated_at`,
      )
      .run(
        value.id,
        value.episodeId,
        value.kind,
        value.state,
        value.progress ?? 0,
        value.revision,
        value.outputPath ?? null,
        value.error ?? null,
        JSON.stringify(value.snapshot ?? null),
        value.createdAt,
        value.updatedAt,
      );
    return this.getJob(value.id);
  }
}

export default Store;
