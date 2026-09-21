import { fontForFamily } from './fonts.js';
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
import { STARTER_STORY, storySectionHeadings } from "./story-markdown.js";

const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const parse = (value, fallback = null) =>
  value == null ? fallback : JSON.parse(value);
const STORY_LIMIT = 1024 * 1024;
const STORY_MARKER = /^ {0,3}<!--\s*storybench:section\s+([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\s*-->\s*$/i;
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
export const SCHEMA_VERSION = 10;
export const DEFAULT_CHANNEL_NAME = "Main";
// IDs become directory names, so they must be single safe path segments.
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/;
const LEGACY_EPISODE_SUBDIRS = ["reference", "b-roll", "narration", "graphics", "drafts", "final", "cache", "conflicts", "work"];
const CHANNEL_EPISODE_SUBDIRS = ["work", "outputs", "outputs/drafts", "outputs/final", "outputs/graphics", "conflicts"];
const channelNameKey = (name) => name.normalize("NFKC").toLowerCase();
export const HARNESSES = Object.freeze(["codex", "claude"]);
export const SEGMENT_REASONS = Object.freeze(["initial", "migrated", "harness-switch", "harness-return", "resume-unavailable"]);
export const RUN_KINDS = Object.freeze(["chat", "card_build", "still_graphic", "animated_graphic", "draft", "final", "other"]);
export const RUN_ORIGINS = Object.freeze(["typed", "button"]);
export const MESSAGE_ORIGINS = Object.freeze(["typed", "button", "agent", "system"]);
export const FINAL_END_REASONS = Object.freeze(["stopped", "cancelled", "failed", "restart", "unfulfilled"]);
// How Final intent ends when its request reaches a terminal state without publishing.
const FINAL_END_ON_TERMINAL = { failed: "failed", completed: "unfulfilled" };
const INTERRUPTION_REASONS = ["stopped", "cancelled"];
const RUN_TERMINAL = ["completed", "failed", "interrupted"];
const RUN_TRANSITIONS = { starting: ["running", ...RUN_TERMINAL], running: RUN_TERMINAL, completed: [], failed: [], interrupted: [] };
const hasControlCharacters = (value) => [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
// Optional short text (model, effort): null when empty; bounded and single-line otherwise.
function shortText(value, field) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 200 || hasControlCharacters(value)) throw new StoreError(`${field} must be a short single-line text value`);
  return value;
}
export const REFERENCE_DIRECTION_USES = Object.freeze(["direct-use", "edit"]);
export const REFERENCE_RULE = "Reference material is read-only feel context. Do not edit it or directly use it in the production unless the creator explicitly asks for that use or edit.";

function referenceIds(value, field) {
  const ids = value == null ? [] : value;
  if (!Array.isArray(ids) || ids.some((entry) => typeof entry !== "string" || !entry))
    throw new StoreError(`${field} must be an array of library item IDs`);
  return [...new Set(ids)];
}

export function normalizeChannelName(value) {
  const name = String(value ?? "").normalize("NFC").trim().replace(/\s+/g, " ");
  if (!name) throw new StoreError("Channel name is required");
  if (name.length > 80) throw new StoreError("Channel name must be at most 80 characters");
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new StoreError("Channel name must not contain control characters");
  return name;
}

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
      referencePrompt: String(card.referencePrompt ?? ""),
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
      channelId: row.channel_id,
      title: row.title,
      notes: row.notes,
      state: row.state || "Scaffold",
      revision: row.revision,
      referencePrompt: row.reference_prompt ?? "",
      referenceItemIds: parse(row.reference_item_ids, []),
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
      channelId: row.channel_id,
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
      channelId: row.channel_id ?? null,
      requestId: row.request_id ?? null,
      kind: row.kind,
      state: row.state,
      progress: row.progress,
      revision: row.revision,
      outputPath: row.output_path,
      error: row.error,
      outputClass: row.output_class || "active",
      designation: row.designation ?? null,
      recordRevision: row.record_revision ?? 1,
      deletionState: row.deletion_state ?? "present",
      deletedAt: row.deleted_at ?? null,
      deletedBytes: row.deleted_bytes ?? null,
      deletionNote: row.deletion_note ?? null,
      sidecarPaths: parse(row.sidecar_paths, []),
      snapshot: parse(row.snapshot),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  );
}
function graphicRecipeRow(row) {
  return row && {
    id: row.id,
    episodeId: row.episode_id,
    cardId: row.card_id,
    name: row.name,
    kind: row.kind,
    revision: row.current_revision,
    recipe: parse(row.recipe),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class Store {
  constructor(workspace, {
    afterMigrationCommit, beforeStoryPublish, afterStoryRename, beforeGraphicMembership,
    legacyWorkspace = true, firstChannelName = DEFAULT_CHANNEL_NAME, origin = null, startup = true,
  } = {}) {
    this.workspace = path.resolve(workspace);
    this.dataRoot = this.workspace;
    this.afterMigrationCommit = afterMigrationCommit;
    this.beforeStoryPublish = beforeStoryPublish;
    this.afterStoryRename = afterStoryRename;
    this.beforeGraphicMembership = beforeGraphicMembership;
    // A legacy single-workspace open keeps the prototype's root folders; an initialized data root only gets shared ones.
    const rootDirs = legacyWorkspace ? ["", "media", "cache", "exports", "imports", "branding/assets", "channels"] : ["", "cache", "imports", "channels"];
    mkdirSync(this.workspace, { recursive: true });
    const databasePath = path.join(this.workspace, "storybench.sqlite");
    const existingDatabase = existsSync(databasePath);
    this.db = new DatabaseSync(databasePath);
    try {
      this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
      this.migrate(existingDatabase, { firstChannelName, origin: origin || (legacyWorkspace ? "workspace" : "init") });
      // A root explicitly initialized or adopted as a shared data root is never reopened as a prototype
      // workspace: that would silently add a channel and prototype folders.
      const rootOrigin = this.dataRootIdentity()?.origin;
      if (legacyWorkspace && ["init", "adopt"].includes(rootOrigin))
        throw new StoreError(`This is an initialized Storybench data root (origin ${rootOrigin}); open it with --data-root instead of --workspace`, 409);
      for (const dir of rootDirs) mkdirSync(path.join(this.workspace, dir), { recursive: true });
      this.db.exec("PRAGMA foreign_keys=ON");
      if (Number(this.db.prepare("PRAGMA foreign_keys").get().foreign_keys) !== 1)
        throw new StoreError("SQLite foreign-key enforcement could not be enabled", 500);
      if (legacyWorkspace && !this.listChannels().length) this.createChannel(firstChannelName);
      for (const channel of this.db.prepare("SELECT id FROM channels").all())
        this.ensureChannelDirectories(channel.id);
      for (const episode of this.db.prepare("SELECT id FROM episodes").all())
        this.ensureEpisodeDirectories(episode.id);
    } catch (error) {
      if (this.db.isOpen) this.db.close();
      throw error;
    }
    if (!startup) return;
    this.recoverPendingStories();
    this.reconcileOutputDeletions();
    this.reconcileProductionRuns();
    this.db
      .prepare(
        "UPDATE jobs SET state='failed', error='Render interrupted by server restart', updated_at=? WHERE state IN ('queued','running','cancelling')",
      )
      .run(now());
  }
  tableExists(name) {
    return Boolean(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
  }
  columns(table) {
    return new Set(this.db.prepare(`PRAGMA table_info('${table}')`).all().map((column) => column.name));
  }
  backupDatabase(destination) {
    const escaped = destination.replaceAll("'", "''");
    this.db.exec(`VACUUM INTO '${escaped}'`);
    const copy = new DatabaseSync(destination, { readOnly: true });
    try {
      const check = copy.prepare("PRAGMA quick_check").get();
      if (Object.values(check)[0] !== "ok") throw new StoreError("Pre-migration backup failed its integrity check", 500);
    } finally { copy.close(); }
    return destination;
  }
  migrate(existingDatabase, { firstChannelName = DEFAULT_CHANNEL_NAME, origin = "init" } = {}) {
    const version = Number(this.db.prepare("PRAGMA user_version").get().user_version);
    if (version > SCHEMA_VERSION)
      throw new StoreError(`Database schema ${version} is newer than this Storybench release supports (${SCHEMA_VERSION})`, 409);
    if (version >= SCHEMA_VERSION) return;
    const hadLegacySchema = this.tableExists("episodes");
    if (version < 5) this.migrateV5(existingDatabase && hadLegacySchema);
    if (version < 6) {
      if (existingDatabase && hadLegacySchema) {
        const backupPath = path.join(this.workspace, "storybench.pre-v6.sqlite");
        if (!existsSync(backupPath)) this.backupDatabase(backupPath);
      }
      this.migrateV6({ firstChannelName, origin: existingDatabase && hadLegacySchema ? (origin === "adopt" ? "adopt" : "migration") : origin });
    } else if (existingDatabase) {
      // Opened at a channel-era schema: keep a consistent copy of exactly that state before the next step.
      const backupPath = path.join(this.workspace, `storybench.pre-v${version + 1}.sqlite`);
      if (!existsSync(backupPath)) this.backupDatabase(backupPath);
    }
    if (version < 7) this.migrateV7();
    if (version < 8) this.migrateV8();
    if (version < 9) this.migrateV9();
    if (version < 10) this.migrateV10();
    try {
      this.afterMigrationCommit?.();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  migrateV5(backupLegacy) {
    if (backupLegacy) {
      const backupPath = path.join(this.workspace, "storybench.pre-v2.sqlite");
      if (!existsSync(backupPath)) {
        const escaped = backupPath.replaceAll("'", "''");
        this.db.exec(`VACUUM INTO '${escaped}'`);
      }
    }
    // Channel-era schemas (for example an artificially lowered user_version) must not get the prototype's
    // installation-wide asset backfill, which would cross channel ownership.
    const channelSchema = this.tableExists("channels");
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
        CREATE TABLE IF NOT EXISTS graphic_recipes (
          id TEXT PRIMARY KEY,episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
          card_id TEXT,name TEXT NOT NULL,kind TEXT NOT NULL,current_revision INTEGER NOT NULL,
          created_at TEXT NOT NULL,updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS graphic_recipe_revisions (
          recipe_id TEXT NOT NULL REFERENCES graphic_recipes(id) ON DELETE CASCADE,
          revision INTEGER NOT NULL,recipe TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL,
          PRIMARY KEY(recipe_id,revision)
        );
        CREATE TABLE IF NOT EXISTS final_authorizations (
          id TEXT PRIMARY KEY,episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
          render_revision TEXT NOT NULL,conversation_id TEXT,request_id TEXT,
          expires_at TEXT NOT NULL,consumed_at TEXT,created_at TEXT NOT NULL
        );
      `);
      const columns = (table) => this.columns(table);
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
      if (this.tableExists("chats") && !columns("chats").has("name"))
        this.db.exec("ALTER TABLE chats ADD COLUMN name TEXT NOT NULL DEFAULT 'Conversation 1'");
      const stamp = now();
      if (!channelSchema) {
        if (!this.db.prepare("SELECT 1 FROM episodes LIMIT 1").get() && this.db.prepare("SELECT 1 FROM assets LIMIT 1").get()) {
          const importedId = id("episode");
          this.db.prepare("INSERT INTO episodes(id,title,notes,revision,cards,created_at,updated_at,state) VALUES(?,?,?,?,?,?,?,?)")
            .run(importedId, "Imported library", "", 1, "[]", stamp, stamp, "Scaffold");
          this.db.prepare("INSERT INTO episode_history(episode_id,revision,title,notes,cards,actor,created_at,parent_revision) VALUES(?,?,?,?,?,?,?,?)")
            .run(importedId, 1, "Imported library", "", "[]", "migration", stamp, null);
        }
      }
      const emptyHash = hash("");
      this.db.prepare(`INSERT OR IGNORE INTO stories(episode_id,source,revision,sections,publication_pending,committed_hash,published_hash,updated_at)
        SELECT id,'',1,'[]',1,?,NULL,? FROM episodes`).run(emptyHash, stamp);
      this.db.prepare(`INSERT OR IGNORE INTO story_history(episode_id,revision,source,sections,actor,created_at)
        SELECT id,1,'','[]','migration',? FROM episodes`).run(stamp);
      if (!channelSchema) {
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
      }
      for (const row of this.db.prepare("SELECT id,cards FROM episodes").all()) {
        const legacy = parse(row.cards, []);
        if (!legacy.some((card) => !card.type)) continue;
        this.db.prepare("UPDATE episodes SET cards=? WHERE id=?").run(JSON.stringify(this.normalizeLegacyCards(row.id, legacy)), row.id);
      }
      this.db.prepare("INSERT OR REPLACE INTO migration_log(version,completed_at) VALUES(5,?)").run(stamp);
      this.db.exec("PRAGMA user_version=5; COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  // Schema 6: shared channels. Existing data becomes the first channel with every ID, path and byte preserved.
  // Table rebuilds follow SQLite's documented procedure: foreign keys off outside the transaction,
  // rebuild, foreign_key_check before commit, then enforcement back on.
  migrateV6({ firstChannelName = DEFAULT_CHANNEL_NAME, origin = "init" } = {}) {
    const stamp = now();
    this.db.exec("PRAGMA foreign_keys=OFF");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS channels (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          name_key TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS data_root (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          id TEXT NOT NULL,
          origin TEXT NOT NULL,
          default_channel_id TEXT REFERENCES channels(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      const hasData = ["episodes", "assets", "branding_templates"].some((table) => this.db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get());
      let firstChannelId = this.db.prepare("SELECT id FROM channels ORDER BY created_at,id LIMIT 1").get()?.id || null;
      if (!firstChannelId && hasData) {
        const name = normalizeChannelName(firstChannelName);
        firstChannelId = id("channel");
        this.db.prepare("INSERT INTO channels(id,name,name_key,created_at,updated_at) VALUES(?,?,?,?,?)")
          .run(firstChannelId, name, channelNameKey(name), stamp, stamp);
      }
      if (!this.columns("episodes").has("channel_id")) {
        this.db.exec(`CREATE TABLE episodes_v6 (
          id TEXT PRIMARY KEY,
          channel_id TEXT NOT NULL REFERENCES channels(id),
          directory TEXT NOT NULL,
          title TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL,cards TEXT NOT NULL,
          created_at TEXT NOT NULL,updated_at TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'Scaffold'
        )`);
        // Legacy episodes keep their recorded episodes/<id> directory; nothing is moved.
        this.db.prepare(`INSERT INTO episodes_v6(id,channel_id,directory,title,notes,revision,cards,created_at,updated_at,state)
          SELECT id,?,'episodes/' || id,title,notes,revision,cards,created_at,updated_at,state FROM episodes`).run(firstChannelId);
        this.db.exec("DROP TABLE episodes; ALTER TABLE episodes_v6 RENAME TO episodes;");
      }
      if (!this.columns("assets").has("channel_id")) {
        // The prototype's global UNIQUE(hash) becomes channel-scoped deduplication.
        this.db.exec(`CREATE TABLE assets_v6 (
          id TEXT PRIMARY KEY,
          channel_id TEXT NOT NULL REFERENCES channels(id),
          name TEXT NOT NULL,hash TEXT NOT NULL,kind TEXT NOT NULL,path TEXT NOT NULL,
          duration REAL,width INTEGER,height INTEGER,metadata TEXT NOT NULL,thumbnail_path TEXT,created_at TEXT NOT NULL,
          UNIQUE(channel_id,hash)
        )`);
        this.db.prepare(`INSERT INTO assets_v6(id,channel_id,name,hash,kind,path,duration,width,height,metadata,thumbnail_path,created_at)
          SELECT id,?,name,hash,kind,path,duration,width,height,metadata,thumbnail_path,created_at FROM assets`).run(firstChannelId);
        this.db.exec("DROP TABLE assets; ALTER TABLE assets_v6 RENAME TO assets;");
      }
      if (!this.columns("branding_templates").has("channel_id")) {
        this.db.exec(`CREATE TABLE branding_templates_v6 (
          id TEXT PRIMARY KEY,
          channel_id TEXT NOT NULL REFERENCES channels(id),
          name TEXT NOT NULL,role TEXT,
          source_episode_id TEXT NOT NULL,source_card_id TEXT NOT NULL,
          card_snapshot TEXT NOT NULL,dependency_items TEXT NOT NULL,
          created_at TEXT NOT NULL,updated_at TEXT NOT NULL
        )`);
        this.db.prepare(`INSERT INTO branding_templates_v6(id,channel_id,name,role,source_episode_id,source_card_id,card_snapshot,dependency_items,created_at,updated_at)
          SELECT id,?,name,role,source_episode_id,source_card_id,card_snapshot,dependency_items,created_at,updated_at FROM branding_templates`).run(firstChannelId);
        this.db.exec("DROP TABLE branding_templates; ALTER TABLE branding_templates_v6 RENAME TO branding_templates;");
      }
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS episodes_channel ON episodes(channel_id,updated_at);
        CREATE UNIQUE INDEX IF NOT EXISTS episodes_directory ON episodes(directory);
        CREATE INDEX IF NOT EXISTS assets_channel_hash ON assets(channel_id,hash);
        CREATE INDEX IF NOT EXISTS branding_templates_channel ON branding_templates(channel_id,created_at);
        CREATE INDEX IF NOT EXISTS library_items_episode ON library_items(episode_id,created_at);
        CREATE INDEX IF NOT EXISTS jobs_episode ON jobs(episode_id,created_at);
        CREATE TRIGGER IF NOT EXISTS episodes_ownership_immutable BEFORE UPDATE OF channel_id,directory ON episodes
          WHEN NEW.channel_id IS NOT OLD.channel_id OR NEW.directory IS NOT OLD.directory
          BEGIN SELECT RAISE(ABORT,'episode channel and directory are immutable'); END;
        CREATE TRIGGER IF NOT EXISTS assets_channel_immutable BEFORE UPDATE OF channel_id ON assets
          WHEN NEW.channel_id IS NOT OLD.channel_id
          BEGIN SELECT RAISE(ABORT,'asset channel is immutable'); END;
        CREATE TRIGGER IF NOT EXISTS library_items_channel_insert BEFORE INSERT ON library_items
          WHEN (SELECT channel_id FROM assets WHERE id=NEW.asset_id) IS NOT (SELECT channel_id FROM episodes WHERE id=NEW.episode_id)
          BEGIN SELECT RAISE(ABORT,'library item asset belongs to another channel'); END;
        CREATE TRIGGER IF NOT EXISTS library_items_channel_update BEFORE UPDATE OF asset_id,episode_id ON library_items
          WHEN (SELECT channel_id FROM assets WHERE id=NEW.asset_id) IS NOT (SELECT channel_id FROM episodes WHERE id=NEW.episode_id)
          BEGIN SELECT RAISE(ABORT,'library item asset belongs to another channel'); END;
        CREATE TRIGGER IF NOT EXISTS branding_templates_channel_insert BEFORE INSERT ON branding_templates
          WHEN (SELECT channel_id FROM episodes WHERE id=NEW.source_episode_id) IS NOT NEW.channel_id
          BEGIN SELECT RAISE(ABORT,'branding template source episode belongs to another channel'); END;
      `);
      this.db.prepare("INSERT OR IGNORE INTO data_root(singleton,id,origin,default_channel_id,created_at,updated_at) VALUES(1,?,?,?,?,?)")
        .run(`root_${crypto.randomUUID()}`, origin, firstChannelId, stamp, stamp);
      if (firstChannelId)
        this.db.prepare("UPDATE data_root SET default_channel_id=?,updated_at=? WHERE singleton=1 AND default_channel_id IS NULL").run(firstChannelId, stamp);
      const violations = this.db.prepare("PRAGMA foreign_key_check").all();
      if (violations.length)
        throw new StoreError(`Channel migration found ${violations.length} foreign-key violation(s); first: ${JSON.stringify(violations[0])}`, 500);
      this.db.prepare("INSERT OR REPLACE INTO migration_log(version,completed_at) VALUES(6,?)").run(stamp);
      this.db.exec("PRAGMA user_version=6; COMMIT");
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.db.exec("PRAGMA foreign_keys=ON");
    }
  }
  // Schema 7: episode/card references. Episodes gain a reference prompt and an explicit ordered reference set,
  // initialized once from the prototype's Reference-category items (the old implicit episode-wide scope). After
  // that, library category is organization only. Card JSON, links and URL strings are left exactly as stored.
  migrateV7() {
    const stamp = now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (!this.columns("episodes").has("reference_prompt"))
        this.db.exec("ALTER TABLE episodes ADD COLUMN reference_prompt TEXT NOT NULL DEFAULT ''");
      if (!this.columns("episodes").has("reference_item_ids")) {
        this.db.exec("ALTER TABLE episodes ADD COLUMN reference_item_ids TEXT NOT NULL DEFAULT '[]'");
        const initial = this.db.prepare("SELECT id FROM library_items WHERE episode_id=? AND category='Reference' ORDER BY created_at,id");
        const assign = this.db.prepare("UPDATE episodes SET reference_item_ids=? WHERE id=?");
        for (const episode of this.db.prepare("SELECT id FROM episodes").all()) {
          const ids = initial.all(episode.id).map((row) => row.id);
          if (ids.length) assign.run(JSON.stringify(ids), episode.id);
        }
      }
      // NULL in history means "recorded before references existed": undo leaves current references unchanged.
      if (!this.columns("episode_history").has("reference_prompt"))
        this.db.exec("ALTER TABLE episode_history ADD COLUMN reference_prompt TEXT");
      if (!this.columns("episode_history").has("reference_item_ids"))
        this.db.exec("ALTER TABLE episode_history ADD COLUMN reference_item_ids TEXT");
      // The history row for each episode's current revision records the initialized set, so the first undo
      // after migration restores it. Older rows stay NULL. Rows already written with references are untouched.
      this.db.exec(`UPDATE episode_history SET reference_prompt='',
          reference_item_ids=(SELECT e.reference_item_ids FROM episodes e WHERE e.id=episode_history.episode_id)
        WHERE reference_item_ids IS NULL
          AND revision=(SELECT e.revision FROM episodes e WHERE e.id=episode_history.episode_id)`);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS reference_directions (
          id TEXT PRIMARY KEY,
          episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
          item_id TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
          use TEXT NOT NULL CHECK (use IN ('direct-use','edit')),
          conversation_id TEXT NOT NULL,
          message_id INTEGER NOT NULL,
          request_id TEXT,
          note TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS reference_directions_episode ON reference_directions(episode_id,item_id,created_at);
        CREATE TRIGGER IF NOT EXISTS reference_directions_membership BEFORE INSERT ON reference_directions
          WHEN (SELECT episode_id FROM library_items WHERE id=NEW.item_id) IS NOT NEW.episode_id
          BEGIN SELECT RAISE(ABORT,'reference direction item is not in this episode'); END;
      `);
      this.db.prepare("INSERT OR REPLACE INTO migration_log(version,completed_at) VALUES(7,?)").run(stamp);
      this.db.exec("PRAGMA user_version=7; COMMIT");
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw error;
    }
  }
  // Schema 8: output designation and deletion state on the existing output records (jobs). The designation starts
  // from the output class (final -> final, draft/legacy draft -> draft); output_class stays the original production
  // class. Only dedicated operations change designation/deletion columns, each bumping record_revision.
  migrateV8() {
    const stamp = now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const columns = this.columns("jobs");
      const add = (name, definition) => { if (!columns.has(name)) this.db.exec(`ALTER TABLE jobs ADD COLUMN ${name} ${definition}`); };
      const initialize = !columns.has("designation");
      add("designation", "TEXT");
      add("record_revision", "INTEGER NOT NULL DEFAULT 1");
      add("deletion_state", "TEXT NOT NULL DEFAULT 'present'");
      add("deletion_started_at", "TEXT");
      add("deleted_at", "TEXT");
      add("deleted_bytes", "INTEGER");
      add("deletion_note", "TEXT");
      add("sidecar_paths", "TEXT NOT NULL DEFAULT '[]'");
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS output_designations (
          job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
          revision INTEGER NOT NULL,
          designation TEXT NOT NULL,
          previous TEXT,
          actor TEXT NOT NULL,
          request_id TEXT,
          created_at TEXT NOT NULL,
          PRIMARY KEY(job_id, revision)
        );
        CREATE TRIGGER IF NOT EXISTS jobs_initial_designation AFTER INSERT ON jobs
          WHEN NEW.designation IS NULL AND NEW.output_class IN ('draft','legacy_draft','final')
          BEGIN
            UPDATE jobs SET designation=CASE NEW.output_class WHEN 'final' THEN 'final' ELSE 'draft' END WHERE id=NEW.id;
            INSERT OR IGNORE INTO output_designations(job_id,revision,designation,previous,actor,request_id,created_at)
              VALUES(NEW.id,1,CASE NEW.output_class WHEN 'final' THEN 'final' ELSE 'draft' END,NULL,'render',NULL,NEW.created_at);
          END;
      `);
      if (initialize) {
        this.db.exec(`UPDATE jobs SET designation=CASE output_class WHEN 'final' THEN 'final' ELSE 'draft' END
          WHERE output_class IN ('draft','legacy_draft','final')`);
      }
      this.db.prepare(`INSERT OR IGNORE INTO output_designations(job_id,revision,designation,previous,actor,request_id,created_at)
        SELECT id,record_revision,designation,NULL,'migration',NULL,? FROM jobs WHERE designation IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM output_designations d WHERE d.job_id=jobs.id)`).run(stamp);
      this.db.prepare("INSERT OR REPLACE INTO migration_log(version,completed_at) VALUES(8,?)").run(stamp);
      this.db.exec("PRAGMA user_version=8; COMMIT");
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw error;
    }
  }
  // Schema 9: store-owned conversations with per-conversation harness/model/effort selection, native-session
  // segments, and production requests (one row per visible request: kind, origin, idempotent client request id,
  // bound Final intent with its ending, retry lineage) that jobs link back to. Backfill: existing conversations
  // become codex / migrated / model unknown; a conversation with a thread gets a migrated segment whose id equals
  // the conversation id (existing session folders stay valid). No production_runs backfill.
  migrateV9() {
    const stamp = now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      // The chat service used to create these lazily; create them here (same definitions) so they can be altered.
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,episode_id TEXT NOT NULL,name TEXT NOT NULL,draft TEXT NOT NULL DEFAULT '',state TEXT NOT NULL DEFAULT 'idle',thread_id TEXT,active_turn_id TEXT,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS conversations_episode ON conversations(episode_id,created_at);
        CREATE TABLE IF NOT EXISTS conversation_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,role TEXT NOT NULL,text TEXT NOT NULL,state TEXT NOT NULL,turn_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS conversation_events(conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,sequence INTEGER NOT NULL,type TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(conversation_id,sequence));
        CREATE TABLE IF NOT EXISTS conversation_segments (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          harness TEXT NOT NULL CHECK (harness IN ('codex','claude')),
          native_session_id TEXT,
          reason TEXT NOT NULL CHECK (reason IN ('initial','migrated','harness-switch','harness-return','resume-unavailable')),
          previous_segment_id TEXT REFERENCES conversation_segments(id) ON DELETE SET NULL,
          first_message_id INTEGER,
          seed_included_messages INTEGER,
          seed_omitted_messages INTEGER,
          created_at TEXT NOT NULL,
          ended_at TEXT
        );
        CREATE INDEX IF NOT EXISTS conversation_segments_conversation ON conversation_segments(conversation_id,created_at);
        CREATE UNIQUE INDEX IF NOT EXISTS conversation_segments_native ON conversation_segments(harness,native_session_id) WHERE native_session_id IS NOT NULL;
      `);
      const conversationColumns = this.columns("conversations");
      const addConversation = (name, definition) => { if (!conversationColumns.has(name)) this.db.exec(`ALTER TABLE conversations ADD COLUMN ${name} ${definition}`); };
      const firstSelection = !conversationColumns.has("settings_source");
      addConversation("harness", "TEXT NOT NULL DEFAULT 'codex' CHECK (harness IN ('codex','claude'))");
      addConversation("model", "TEXT");
      addConversation("effort", "TEXT");
      addConversation("settings_source", "TEXT NOT NULL DEFAULT 'default' CHECK (settings_source IN ('default','migrated','explicit'))");
      addConversation("settings_revision", "INTEGER NOT NULL DEFAULT 1");
      addConversation("settings_updated_at", "TEXT");
      addConversation("active_segment_id", "TEXT REFERENCES conversation_segments(id) ON DELETE SET NULL");
      // Existing conversations: codex, model and effort unknown (historical models are never guessed).
      if (firstSelection) this.db.exec("UPDATE conversations SET harness='codex',model=NULL,effort=NULL,settings_source='migrated'");
      // Visible messages record where they came from: typed by the creator, a shortcut button, or the agent.
      if (!this.columns("conversation_messages").has("origin")) {
        this.db.exec("ALTER TABLE conversation_messages ADD COLUMN origin TEXT CHECK (origin IS NULL OR origin IN ('typed','button','agent','system'))");
        this.db.exec("UPDATE conversation_messages SET origin=CASE role WHEN 'user' THEN 'typed' WHEN 'assistant' THEN 'agent' ELSE 'system' END");
      }
      // Migrated segments: id = conversation id, so <state>/harnesses/codex/<conversationId> stays the session folder.
      this.db.prepare(`INSERT OR IGNORE INTO conversation_segments(id,conversation_id,harness,native_session_id,reason,created_at)
        SELECT c.id,c.id,'codex',c.thread_id,'migrated',c.created_at FROM conversations c
        WHERE c.thread_id IS NOT NULL AND c.active_segment_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM conversation_segments s WHERE s.harness='codex' AND s.native_session_id=c.thread_id)`).run();
      this.db.exec(`UPDATE conversations SET active_segment_id=id WHERE active_segment_id IS NULL
        AND EXISTS (SELECT 1 FROM conversation_segments s WHERE s.id=conversations.id AND s.conversation_id=conversations.id)`);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS production_runs (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
          segment_id TEXT REFERENCES conversation_segments(id) ON DELETE SET NULL,
          kind TEXT NOT NULL DEFAULT 'chat' CHECK (kind IN ('chat','card_build','still_graphic','animated_graphic','draft','final','other')),
          origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed','button')),
          client_request_id TEXT,
          target_card_id TEXT,
          originating_message_id INTEGER REFERENCES conversation_messages(id) ON DELETE SET NULL,
          assistant_message_id INTEGER REFERENCES conversation_messages(id) ON DELETE SET NULL,
          harness TEXT NOT NULL CHECK (harness IN ('codex','claude')),
          model_selected TEXT,
          effort_selected TEXT,
          model_resolved TEXT,
          effort_resolved TEXT,
          native_turn_id TEXT,
          state TEXT NOT NULL DEFAULT 'starting' CHECK (state IN ('starting','running','completed','failed','interrupted')),
          error TEXT,
          usage TEXT,
          final_intent TEXT NOT NULL DEFAULT 'none' CHECK (final_intent IN ('none','active','published','ended')),
          final_ended_reason TEXT CHECK (final_ended_reason IS NULL OR final_ended_reason IN ('published','stopped','cancelled','failed','restart','unfulfilled')),
          final_output_job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
          successor_of TEXT REFERENCES production_runs(id) ON DELETE SET NULL,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          updated_at TEXT NOT NULL,
          CHECK ((final_intent IN ('published','ended')) = (final_ended_reason IS NOT NULL)),
          CHECK ((final_intent = 'published') = (final_ended_reason IS 'published')),
          -- A finished request never holds live Final authority.
          CHECK (NOT (state IN ('completed','failed','interrupted') AND final_intent = 'active'))
        );
        CREATE INDEX IF NOT EXISTS production_runs_conversation ON production_runs(conversation_id,started_at);
        CREATE INDEX IF NOT EXISTS production_runs_episode_state ON production_runs(episode_id,state);
        CREATE UNIQUE INDEX IF NOT EXISTS production_runs_client_request ON production_runs(conversation_id,client_request_id) WHERE client_request_id IS NOT NULL;
        -- Related IDs are validated together: the run's episode, segment and messages belong to its conversation.
        -- Update triggers allow clearing to NULL: foreign-key ON DELETE SET NULL actions run as updates.
        CREATE TRIGGER IF NOT EXISTS production_runs_scope BEFORE INSERT ON production_runs
          WHEN (SELECT episode_id FROM conversations WHERE id=NEW.conversation_id) IS NOT NEW.episode_id
            OR (NEW.segment_id IS NOT NULL AND (SELECT conversation_id FROM conversation_segments WHERE id=NEW.segment_id) IS NOT NEW.conversation_id)
            OR (NEW.originating_message_id IS NOT NULL AND (SELECT conversation_id FROM conversation_messages WHERE id=NEW.originating_message_id) IS NOT NEW.conversation_id)
          BEGIN SELECT RAISE(ABORT,'production run references another conversation or episode'); END;
        CREATE TRIGGER IF NOT EXISTS production_runs_scope_update BEFORE UPDATE OF conversation_id,episode_id,segment_id,originating_message_id,assistant_message_id ON production_runs
          WHEN NEW.conversation_id IS NOT OLD.conversation_id OR NEW.episode_id IS NOT OLD.episode_id
            OR (NEW.originating_message_id IS NOT NULL AND NEW.originating_message_id IS NOT OLD.originating_message_id)
            OR (NEW.segment_id IS NOT NULL AND (SELECT conversation_id FROM conversation_segments WHERE id=NEW.segment_id) IS NOT NEW.conversation_id)
            OR (NEW.assistant_message_id IS NOT NULL AND (SELECT conversation_id FROM conversation_messages WHERE id=NEW.assistant_message_id) IS NOT NEW.conversation_id)
          BEGIN SELECT RAISE(ABORT,'production run scope is immutable and must stay within its conversation'); END;
        CREATE TRIGGER IF NOT EXISTS conversation_segments_previous BEFORE INSERT ON conversation_segments
          WHEN NEW.previous_segment_id IS NOT NULL AND (SELECT conversation_id FROM conversation_segments WHERE id=NEW.previous_segment_id) IS NOT NEW.conversation_id
          BEGIN SELECT RAISE(ABORT,'previous segment belongs to another conversation'); END;
        CREATE TRIGGER IF NOT EXISTS conversations_active_segment BEFORE UPDATE OF active_segment_id ON conversations
          WHEN NEW.active_segment_id IS NOT NULL AND (SELECT conversation_id FROM conversation_segments WHERE id=NEW.active_segment_id) IS NOT NEW.id
          BEGIN SELECT RAISE(ABORT,'active segment belongs to another conversation'); END;
      `);
      if (!this.columns("jobs").has("request_id")) this.db.exec("ALTER TABLE jobs ADD COLUMN request_id TEXT REFERENCES production_runs(id) ON DELETE SET NULL");
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS jobs_request ON jobs(request_id) WHERE request_id IS NOT NULL;
        CREATE TRIGGER IF NOT EXISTS jobs_request_scope_insert BEFORE INSERT ON jobs
          WHEN NEW.request_id IS NOT NULL AND (SELECT episode_id FROM production_runs WHERE id=NEW.request_id) IS NOT NEW.episode_id
          BEGIN SELECT RAISE(ABORT,'job request belongs to another episode'); END;
        CREATE TRIGGER IF NOT EXISTS jobs_request_scope_update BEFORE UPDATE OF request_id ON jobs
          WHEN NEW.request_id IS NOT NULL AND NEW.request_id IS NOT OLD.request_id
            AND (OLD.request_id IS NOT NULL OR (SELECT episode_id FROM production_runs WHERE id=NEW.request_id) IS NOT NEW.episode_id)
          BEGIN SELECT RAISE(ABORT,'a job request link is set once, within its episode'); END;
      `);
      const violations = this.db.prepare("PRAGMA foreign_key_check").all();
      if (violations.length) throw new StoreError(`Schema 9 migration found ${violations.length} foreign-key violation(s); first: ${JSON.stringify(violations[0])}`, 500);
      this.db.prepare("INSERT OR REPLACE INTO migration_log(version,completed_at) VALUES(9,?)").run(stamp);
      this.db.exec("PRAGMA user_version=9; COMMIT");
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw error;
    }
  }
  migrateV10() {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec(`CREATE TABLE IF NOT EXISTS channel_standards (
        channel_id TEXT PRIMARY KEY REFERENCES channels(id), colors TEXT NOT NULL DEFAULT '[]',
        fonts TEXT NOT NULL DEFAULT '[]', style_prompt TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS model_default (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), selection TEXT, revision INTEGER NOT NULL DEFAULT 1
      );
      INSERT OR IGNORE INTO model_default(singleton) VALUES(1);`);
      this.db.prepare("INSERT OR REPLACE INTO migration_log(version,completed_at) VALUES(10,?)").run(now());
      this.db.exec("PRAGMA user_version=10; COMMIT");
    } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
  }
  getBrandStandards(channelId) {
    this.requireChannel(channelId);
    const row = this.db.prepare("SELECT * FROM channel_standards WHERE channel_id=?").get(channelId);
    return { channelId, colors: parse(row?.colors, []), fonts: parse(row?.fonts, []), stylePrompt: row?.style_prompt ?? "", revision: row?.revision ?? 1 };
  }
  saveBrandStandards(channelId, expectedRevision, { colors, fonts, stylePrompt } = {}) {
    const current = this.getBrandStandards(channelId);
    if (!Number.isInteger(expectedRevision) || expectedRevision !== current.revision)
      throw new StoreError("Brand standards changed in another view. Reload before saving.", 409, { current });
    if (!Array.isArray(colors) || colors.length > 3 || colors.some((color) => typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)))
      throw new StoreError("Choose up to three colors using six-digit hex values (for example #1255FF)");
    if (!Array.isArray(fonts) || fonts.length > 3 || fonts.some((family) => !fontForFamily(family)) || new Set(fonts).size !== fonts.length)
      throw new StoreError("Choose up to three different supported fonts");
    if (typeof stylePrompt !== "string" || stylePrompt.length > 10000) throw new StoreError("Style prompt must be text of at most 10000 characters");
    const result = this.db.prepare(`INSERT INTO channel_standards(channel_id,colors,fonts,style_prompt,revision) VALUES(?,?,?,?,?)
      ON CONFLICT(channel_id) DO UPDATE SET colors=excluded.colors,fonts=excluded.fonts,style_prompt=excluded.style_prompt,revision=excluded.revision WHERE channel_standards.revision=?`)
      .run(channelId, JSON.stringify(colors.map((color) => color.toUpperCase())), JSON.stringify(fonts), stylePrompt, current.revision + 1, expectedRevision);
    if (!result.changes) throw new StoreError("Brand standards changed in another view. Reload before saving.", 409, { current: this.getBrandStandards(channelId) });
    return this.getBrandStandards(channelId);
  }
  getModelDefault() {
    const row = this.db.prepare("SELECT selection,revision FROM model_default WHERE singleton=1").get();
    return { selection: parse(row.selection, null), revision: row.revision };
  }
  saveModelDefault(expectedRevision, selection) {
    const result = this.db.prepare("UPDATE model_default SET selection=?,revision=revision+1 WHERE singleton=1 AND revision=?")
      .run(JSON.stringify(selection), Number.isInteger(expectedRevision) ? expectedRevision : -1);
    if (!result.changes) throw new StoreError("Default model changed in another view. Reload before saving.", 409, { current: this.getModelDefault() });
    return this.getModelDefault();
  }
  insertHistory(episode, actor, createdAt, parentRevision) {
    this.db.prepare(`INSERT INTO episode_history(episode_id,revision,title,notes,cards,actor,created_at,parent_revision,reference_prompt,reference_item_ids)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(episode.id, episode.revision, episode.title, episode.notes, JSON.stringify(episode.cards), actor, createdAt,
      parentRevision ?? null, episode.referencePrompt ?? "", JSON.stringify(episode.referenceItemIds ?? []));
  }
  dataRootIdentity() {
    const row = this.db.prepare("SELECT * FROM data_root WHERE singleton=1").get();
    return row && { id: row.id, origin: row.origin, defaultChannelId: row.default_channel_id, createdAt: row.created_at,
      schemaVersion: Number(this.db.prepare("PRAGMA user_version").get().user_version) };
  }
  channelRow(row, defaultId = this.dataRootIdentity()?.defaultChannelId) {
    return row && { id: row.id, name: row.name, isDefault: row.id === defaultId, createdAt: row.created_at, updatedAt: row.updated_at };
  }
  listChannels() {
    const defaultId = this.dataRootIdentity()?.defaultChannelId;
    return this.db.prepare("SELECT * FROM channels ORDER BY created_at,id").all().map((row) => this.channelRow(row, defaultId));
  }
  getChannel(channelId) {
    return this.channelRow(this.db.prepare("SELECT * FROM channels WHERE id=?").get(String(channelId ?? "")));
  }
  findChannel(nameOrId) {
    const value = String(nameOrId ?? "").trim();
    if (!value) return null;
    const byId = this.getChannel(value);
    if (byId) return byId;
    return this.channelRow(this.db.prepare("SELECT * FROM channels WHERE name_key=?").get(channelNameKey(value.normalize("NFC").replace(/\s+/g, " "))));
  }
  requireChannel(channelId) {
    const channel = this.getChannel(channelId);
    if (!channel) throw new StoreError(`Channel not found: ${channelId}`, 404);
    return channel;
  }
  createChannel(name) {
    const displayName = normalizeChannelName(name);
    const key = channelNameKey(displayName);
    const stamp = now();
    const channelId = id("channel");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (this.db.prepare("SELECT 1 FROM channels WHERE name_key=?").get(key))
        throw new StoreError(`A channel named "${displayName}" already exists`, 409);
      this.db.prepare("INSERT INTO channels(id,name,name_key,created_at,updated_at) VALUES(?,?,?,?,?)").run(channelId, displayName, key, stamp, stamp);
      // The first channel becomes the default navigation target.
      this.db.prepare("UPDATE data_root SET default_channel_id=?,updated_at=? WHERE singleton=1 AND default_channel_id IS NULL").run(channelId, stamp);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    this.ensureChannelDirectories(channelId);
    return this.getChannel(channelId);
  }
  renameChannel(channelId, name) {
    this.requireChannel(channelId);
    const displayName = normalizeChannelName(name);
    const key = channelNameKey(displayName);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (this.db.prepare("SELECT 1 FROM channels WHERE name_key=? AND id<>?").get(key, channelId))
        throw new StoreError(`A channel named "${displayName}" already exists`, 409);
      this.db.prepare("UPDATE channels SET name=?,name_key=?,updated_at=? WHERE id=?").run(displayName, key, now(), channelId);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.getChannel(channelId);
  }
  getDefaultChannel() {
    const defaultId = this.dataRootIdentity()?.defaultChannelId;
    return defaultId ? this.getChannel(defaultId) : null;
  }
  // Persists only the default navigation target. It never touches jobs, conversations or open views.
  setDefaultChannel(nameOrId) {
    const channel = this.findChannel(nameOrId);
    if (!channel) throw new StoreError(`Channel not found: ${nameOrId}`, 404);
    this.db.prepare("UPDATE data_root SET default_channel_id=?,updated_at=? WHERE singleton=1").run(channel.id, now());
    return this.getChannel(channel.id);
  }
  // Resolves a write destination. An explicit channel must exist; an omitted one is accepted only when the
  // installation has exactly one channel, so a mutable default never silently chooses a destination.
  resolveChannelId(channelId) {
    if (channelId != null && channelId !== "") return this.requireChannel(channelId).id;
    const rows = this.db.prepare("SELECT id FROM channels ORDER BY created_at,id LIMIT 2").all();
    if (!rows.length) throw new StoreError("No channel exists yet; create a channel first", 409);
    if (rows.length > 1) throw new StoreError("channelId is required when several channels exist", 400);
    return rows[0].id;
  }
  assertEpisodeChannel(episodeId, channelId) {
    if (channelId != null && channelId !== "") this.requireChannel(channelId);
    const episode = this.getEpisode(episodeId);
    if (!episode) throw new StoreError("Episode not found", 404);
    if (channelId != null && channelId !== "" && episode.channelId !== channelId)
      throw new StoreError("Episode belongs to another channel", 409, { episodeChannelId: episode.channelId });
    return episode;
  }
  channelDirectory(channelId) {
    if (!SAFE_SEGMENT.test(String(channelId ?? ""))) throw new StoreError("Invalid registered channel path", 403);
    return path.join(this.workspace, "channels", String(channelId));
  }
  channelMediaDirectory(channelId) { return path.join(this.channelDirectory(channelId), "media"); }
  channelBrandingDirectory(channelId) { return path.join(this.channelDirectory(channelId), "branding"); }
  ensureChannelDirectories(channelId) {
    const directory = this.channelDirectory(channelId);
    const rootReal = realpathSync(this.workspace);
    for (const dir of ["", "branding", "media", "episodes"]) {
      const destination = path.join(directory, dir);
      mkdirSync(destination, { recursive: true });
      const resolved = realpathSync(destination);
      if (!resolved.startsWith(rootReal + path.sep))
        throw new StoreError("Registered channel path escapes the workspace", 403);
    }
    return directory;
  }
  episodeLocation(episodeId) {
    if (!SAFE_SEGMENT.test(String(episodeId ?? ""))) throw new StoreError("Invalid registered episode path", 403);
    const row = this.db.prepare("SELECT id,channel_id,directory FROM episodes WHERE id=?").get(String(episodeId));
    if (!row) throw new StoreError("Episode not found", 404);
    const legacy = `episodes/${row.id}`;
    const channelOwned = `channels/${row.channel_id}/episodes/${row.id}`;
    if (!SAFE_SEGMENT.test(row.channel_id) || ![legacy, channelOwned].includes(row.directory))
      throw new StoreError("Invalid registered episode path", 403);
    return { directory: path.join(this.workspace, ...row.directory.split("/")), legacy: row.directory === legacy, channelId: row.channel_id };
  }
  episodeDirectory(episodeId) {
    return this.episodeLocation(episodeId).directory;
  }
  // Managed output folder for drafts, final or graphics. Legacy episodes keep their existing folders.
  episodeOutputDirectory(episodeId, kind) {
    if (!["drafts", "final", "graphics"].includes(kind)) throw new StoreError("Unknown output directory");
    const location = this.episodeLocation(episodeId);
    return location.legacy ? path.join(location.directory, kind) : path.join(location.directory, "outputs", kind);
  }
  episodeWorkDirectory(episodeId) {
    return path.join(this.episodeDirectory(episodeId), "work");
  }
  // Where registered non-media library files (references, pasted text) are stored.
  episodeLibraryFileDirectory(episodeId) {
    const location = this.episodeLocation(episodeId);
    return location.legacy ? path.join(location.directory, "reference") : this.channelMediaDirectory(location.channelId);
  }
  ensureEpisodeDirectories(episodeId) {
    const location = this.episodeLocation(episodeId);
    mkdirSync(location.directory, { recursive: true });
    const actual = realpathSync(location.directory);
    const root = realpathSync(this.workspace);
    if (actual === root || !actual.startsWith(root + path.sep))
      throw new StoreError("Registered episode path escapes the workspace", 403);
    for (const dir of location.legacy ? LEGACY_EPISODE_SUBDIRS : CHANNEL_EPISODE_SUBDIRS) {
      const destination = path.join(location.directory, dir);
      mkdirSync(destination, { recursive: true });
      const resolved = realpathSync(destination);
      if (!resolved.startsWith(actual + path.sep))
        throw new StoreError("Registered episode path escapes the workspace", 403);
    }
    if (!location.legacy) mkdirSync(this.channelMediaDirectory(location.channelId), { recursive: true });
  }
  close() {
    if (this.db.isOpen) this.db.close();
  }
  listEpisodes({ channelId = null } = {}) {
    const rows = channelId
      ? this.db.prepare("SELECT * FROM episodes WHERE channel_id=? ORDER BY updated_at DESC").all(channelId)
      : this.db.prepare("SELECT * FROM episodes ORDER BY updated_at DESC").all();
    return rows.map(episodeRow);
  }
  getEpisode(episodeId) {
    return episodeRow(
      this.db.prepare("SELECT * FROM episodes WHERE id=?").get(episodeId),
    );
  }
  createEpisode({ title = "Untitled episode", notes = "", channelId = null } = {}) {
    const ownerId = this.resolveChannelId(channelId);
    const initialStory = normalizeStory(STARTER_STORY);
    const episode = {
      id: id("episode"),
      channelId: ownerId,
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
        .prepare("INSERT INTO episodes(id,channel_id,directory,title,notes,revision,cards,created_at,updated_at,state) VALUES(?,?,?,?,?,?,?,?,?,?)")
        .run(
          episode.id,
          ownerId,
          `channels/${ownerId}/episodes/${episode.id}`,
          episode.title,
          episode.notes,
          1,
          "[]",
          episode.createdAt,
          episode.updatedAt,
          episode.state,
        );
      this.insertHistory({ ...episode, referencePrompt: "", referenceItemIds: [] }, "human", episode.createdAt, null);
      this.db
        .prepare("INSERT INTO stories(episode_id,source,revision,sections,publication_pending,committed_hash,published_hash,updated_at) VALUES(?,?,?,?,?,?,?,?)")
        .run(episode.id, initialStory.source, 1, JSON.stringify(initialStory.sections), 1, hash(initialStory.source), null, episode.createdAt);
      this.db
        .prepare("INSERT INTO story_history(episode_id,revision,source,sections,actor,created_at) VALUES(?,?,?,?,?,?)")
        .run(episode.id, 1, initialStory.source, JSON.stringify(initialStory.sections), "human", episode.createdAt);
      const insertSection = this.db.prepare("INSERT INTO story_sections(id,episode_id,title,sort_order,retired_at) VALUES(?,?,?,?,NULL)");
      for (const section of initialStory.sections)
        insertSection.run(section.id, episode.id, section.title, section.order);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    this.ensureEpisodeDirectories(episode.id);
    this.publishStory(episode.id);
    const standards = this.listBrandingTemplates({ channelId: ownerId }).filter((value) => value.role);
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
          if (asset.channelId !== current.channelId) throw new StoreError(`${field} asset belongs to another channel`, 409);
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
    // Episode references use this same episode revision. Newly linked items must belong to the episode;
    // links that already exist are kept as-is so an unavailable one can be shown and unlinked, not hidden.
    const referenceItemIds = changes.referenceItemIds == null ? current.referenceItemIds : referenceIds(changes.referenceItemIds, "referenceItemIds");
    for (const itemId of referenceItemIds)
      if (!current.referenceItemIds.includes(itemId) && !libraryById.has(itemId))
        throw new StoreError(`Library item not found for this episode: ${itemId}`);
    const referencePrompt = changes.referencePrompt == null ? current.referencePrompt : String(changes.referencePrompt);
    const cardIds = new Set(cards.map((card) => card.id));
    const currentCards = new Map(current.cards.map((card) => [card.id, card]));
    for (const card of cards) {
      if (card.itemId && !libraryById.has(card.itemId)) throw new StoreError(`Library item not found for this episode: ${card.itemId}`);
      // Like episode references, a link already on this card is kept even if unresolvable; only new links are checked.
      const existingReferences = new Set(currentCards.get(card.id)?.referenceItemIds || []);
      for (const itemId of card.referenceItemIds)
        if (!existingReferences.has(itemId) && !libraryById.has(itemId)) throw new StoreError(`Library item not found for this episode: ${itemId}`);
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
      referencePrompt,
      referenceItemIds,
      revision: current.revision + 1,
      updatedAt: now(),
    };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db
        .prepare(
          "UPDATE episodes SET title=?,notes=?,state=?,revision=?,cards=?,reference_prompt=?,reference_item_ids=?,updated_at=? WHERE id=? AND revision=?",
        )
        .run(
          next.title,
          next.notes,
          next.state,
          next.revision,
          JSON.stringify(next.cards),
          next.referencePrompt,
          JSON.stringify(next.referenceItemIds),
          next.updatedAt,
          episodeId,
          expectedRevision,
        );
      if (!result.changes) throw new StoreError("Stale revision", 409);
      this.insertHistory(next, actor, next.updatedAt, parentRevision);
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
      { title: prior.title, notes: prior.notes, cards: this.normalizeLegacyCards(episodeId, parse(prior.cards, [])),
        ...(prior.reference_item_ids == null ? {} : { referencePrompt: prior.reference_prompt ?? "", referenceItemIds: parse(prior.reference_item_ids, []) }) },
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
    return this.db.prepare(`SELECT l.*,a.id AS id_asset,a.channel_id,a.name,a.hash,a.kind,a.path,a.duration,a.width,a.height,
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
    const row = this.db.prepare(`SELECT l.*,a.channel_id,a.name,a.hash,a.kind,a.path,a.duration,a.width,a.height,
      a.metadata,a.thumbnail_path,a.created_at AS asset_created_at
      FROM library_items l JOIN assets a ON a.id=l.asset_id WHERE l.episode_id=? AND l.id=?`).get(episodeId, itemId);
    return libraryItemRow(row);
  }
  // Explicit creator direction to edit or directly use a specific reference item. It must cite a creator (user)
  // message in one of this episode's conversations; migration, category changes, attachments and model output
  // never create one. Callers attach the returned record to the request/result provenance.
  recordReferenceDirection({ episodeId, itemId, use, conversationId, messageId, requestId = null, note = "" } = {}) {
    if (!this.getEpisode(episodeId)) throw new StoreError("Episode not found", 404);
    if (!REFERENCE_DIRECTION_USES.includes(use)) throw new StoreError(`use must be one of ${REFERENCE_DIRECTION_USES.join(", ")}`);
    if (!this.getLibraryItem(episodeId, itemId)) throw new StoreError("Reference item not found for this episode", 404);
    if (typeof conversationId !== "string" || !conversationId || !Number.isInteger(messageId))
      throw new StoreError("A creator message (conversationId and messageId) is required", 400);
    const message = this.tableExists("conversations") && this.tableExists("conversation_messages")
      ? this.db.prepare(`SELECT m.role FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id
          WHERE m.id=? AND c.id=? AND c.episode_id=?`).get(messageId, conversationId, episodeId)
      : null;
    if (!message) throw new StoreError("The cited message is not in this episode's conversations", 404);
    if (message.role !== "user") throw new StoreError("Only a creator message can direct reference use or edit", 403);
    const value = { id: id("refdir"), episodeId, itemId, use, conversationId, messageId, requestId: requestId ?? null, note: String(note ?? ""), createdAt: now() };
    this.db.prepare(`INSERT INTO reference_directions(id,episode_id,item_id,use,conversation_id,message_id,request_id,note,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(value.id, episodeId, itemId, use, conversationId, messageId, value.requestId, value.note, value.createdAt);
    return value;
  }
  listReferenceDirections(episodeId, { itemId = null, requestId = null } = {}) {
    return this.db.prepare(`SELECT * FROM reference_directions WHERE episode_id=? AND (? IS NULL OR item_id=?) AND (? IS NULL OR request_id=?)
      ORDER BY created_at,id`).all(episodeId, itemId, itemId, requestId, requestId).map((row) => ({
      id: row.id, episodeId: row.episode_id, itemId: row.item_id, use: row.use, conversationId: row.conversation_id,
      messageId: row.message_id, requestId: row.request_id, note: row.note, createdAt: row.created_at }));
  }
  // Helper for production operations: the latest recorded direction permitting exactly this use, or null.
  referenceDirectionFor(episodeId, itemId, use, { requestId = null } = {}) {
    if (!REFERENCE_DIRECTION_USES.includes(use)) throw new StoreError(`use must be one of ${REFERENCE_DIRECTION_USES.join(", ")}`);
    return this.listReferenceDirections(episodeId, { itemId, requestId }).filter((direction) => direction.use === use).at(-1) || null;
  }
  // Reference scopes as delivered to the agent: episode references apply across the episode; card references
  // are local context for that card. Unavailable links are reported, not dropped.
  getReferenceContext(episodeId) {
    const episode = this.getEpisode(episodeId);
    if (!episode) throw new StoreError("Episode not found", 404);
    const library = new Map(this.listEpisodeLibrary(episodeId).map((item) => [item.id, item]));
    const describe = (itemId) => {
      const item = library.get(itemId);
      if (!item) return { itemId, available: false };
      return { itemId, available: true, label: item.label, category: item.category, kind: item.asset?.kind ?? null,
        sourceKind: item.sourceKind, sourceUrl: item.sourceUrl ?? null, extractionStatus: item.extractionStatus,
        hasText: Boolean(item.extractedText), directions: this.listReferenceDirections(episodeId, { itemId }).map(({ id: directionId, use, messageId, requestId }) => ({ id: directionId, use, messageId, requestId })) };
    };
    return {
      rule: REFERENCE_RULE,
      episode: { scope: "episode", prompt: episode.referencePrompt, items: episode.referenceItemIds.map(describe) },
      cards: episode.cards
        .filter((card) => card.referencePrompt || card.referenceItemIds?.length || card.referenceUrls?.length)
        .map((card) => ({ scope: "card", cardId: card.id, title: card.title, prompt: card.referencePrompt ?? "",
          items: (card.referenceItemIds || []).map(describe), legacyUrls: card.referenceUrls || [] })),
    };
  }
  attachLibraryItem(episodeId, assetId, details = {}) {
    const episode = this.getEpisode(episodeId);
    if (!episode) throw new StoreError("Episode not found", 404);
    const asset = this.getAsset(assetId);
    if (!asset) throw new StoreError("Asset not found", 404);
    if (asset.channelId !== episode.channelId)
      throw new StoreError("Asset belongs to another channel; reuse it into this channel first", 409);
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
  listBrandingTemplates({ channelId = null } = {}) {
    const rows = channelId
      ? this.db.prepare("SELECT * FROM branding_templates WHERE channel_id=? ORDER BY created_at,id").all(channelId)
      : this.db.prepare("SELECT * FROM branding_templates ORDER BY created_at,id").all();
    return rows.map((row) => ({
      id: row.id, channelId: row.channel_id, name: row.name, role: row.role, sourceEpisodeId: row.source_episode_id,
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
      const brandingDirectory = this.channelBrandingDirectory(episode.channelId);
      mkdirSync(brandingDirectory, { recursive: true });
      const destination = path.join(brandingDirectory, `${item.asset.hash}-${path.basename(item.asset.path)}`);
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
      if (role) this.db.prepare("UPDATE branding_templates SET role=NULL,updated_at=? WHERE role=? AND channel_id=?").run(stamp, role, episode.channelId);
      this.db.prepare(`INSERT INTO branding_templates(id,channel_id,name,role,source_episode_id,source_card_id,card_snapshot,dependency_items,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`)
        .run(templateId, episode.channelId, String(name || card.title || "Reusable card"), role, episodeId, cardId, JSON.stringify(snapshot), JSON.stringify(dependencies), stamp, stamp);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.getBrandingTemplate(templateId);
  }
  setBrandingRole(templateId, role) {
    if (role != null && !["intro", "outro"].includes(role)) throw new StoreError("Branding role must be intro or outro");
    const template = this.getBrandingTemplate(templateId);
    if (!template) throw new StoreError("Branding template not found", 404);
    const stamp = now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (role) this.db.prepare("UPDATE branding_templates SET role=NULL,updated_at=? WHERE role=? AND channel_id=?").run(stamp, role, template.channelId);
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
    if (template.channelId !== episode.channelId) throw new StoreError("Branding template belongs to another channel", 409);
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
        this.insertHistory({ ...episode, revision: boardRevision, cards }, "story", stamp, episode.revision);
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
  listAssets({ channelId = null } = {}) {
    return (channelId
      ? this.db.prepare("SELECT * FROM assets WHERE channel_id=? ORDER BY created_at DESC").all(channelId)
      : this.db.prepare("SELECT * FROM assets ORDER BY created_at DESC").all()
    ).map(assetRow);
  }
  getAsset(assetId) {
    return assetRow(
      this.db.prepare("SELECT * FROM assets WHERE id=?").get(assetId),
    );
  }
  // Content-hash deduplication is scoped to one channel: equal bytes in two channels are two assets.
  getAssetByHash(hash, channelId = null) {
    const owner = this.resolveChannelId(channelId);
    return assetRow(
      this.db.prepare("SELECT * FROM assets WHERE channel_id=? AND hash=?").get(owner, hash),
    );
  }
  saveAsset(asset) {
    const channelId = this.resolveChannelId(asset.channelId);
    const existing = this.getAssetByHash(asset.hash, channelId);
    if (existing) return existing;
    const value = {
      ...asset,
      id: asset.id || id("asset"),
      createdAt: asset.createdAt || now(),
    };
    try {
      this.db
        .prepare("INSERT INTO assets(id,channel_id,name,hash,kind,path,duration,width,height,metadata,thumbnail_path,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(
          value.id,
          channelId,
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
    } catch (error) {
      // A concurrent writer registered the same bytes in this channel first: return that asset.
      const winner = /UNIQUE/.test(error.message) ? this.getAssetByHash(asset.hash, channelId) : null;
      if (winner) return winner;
      throw error;
    }
    return this.getAsset(value.id);
  }
  repairReferenceAssetAsMedia(assetId, detected) {
    const current = this.getAsset(assetId);
    if (!current) throw new StoreError("Asset not found", 404);
    if (current.kind !== "reference" || current.hash !== detected.hash || !["image", "video", "audio"].includes(detected.kind))
      throw new StoreError("Only a matching reference asset can be repaired as detected media", 409);
    this.db.prepare(`UPDATE assets SET name=?,kind=?,path=?,duration=?,width=?,height=?,metadata=?,thumbnail_path=? WHERE id=? AND hash=? AND kind='reference'`)
      .run(detected.name || current.name, detected.kind, detected.path, detected.duration ?? null,
        detected.width ?? null, detected.height ?? null, JSON.stringify(detected.metadata || {}),
        detected.thumbnailPath ?? null, assetId, detected.hash);
    return this.getAsset(assetId);
  }
  publishGraphicOutput(episodeId, candidate, { recipeId, recipeRevision, jobId, label, targetCard = null, expectedEpisodeRevision }) {
    const episode = this.getEpisode(episodeId);
    if (!episode) throw new StoreError("Episode not found", 404);
    const stamp = now();
    let assetId, itemId, appliedToCard = false, applyNote = null;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existingAsset = this.db.prepare("SELECT id FROM assets WHERE channel_id=? AND hash=?").get(episode.channelId, candidate.hash);
      assetId = existingAsset?.id || candidate.id || id("asset");
      if (!existingAsset) this.db.prepare("INSERT INTO assets(id,channel_id,name,hash,kind,path,duration,width,height,metadata,thumbnail_path,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(
        assetId, episode.channelId, candidate.name, candidate.hash, candidate.kind, candidate.path, candidate.duration ?? null,
        candidate.width ?? null, candidate.height ?? null, JSON.stringify(candidate.metadata || {}),
        candidate.thumbnailPath ?? null, candidate.createdAt || stamp,
      );
      this.beforeGraphicMembership?.();
      const existingItem = this.db.prepare("SELECT id,provenance FROM library_items WHERE episode_id=? AND asset_id=?").all(episodeId, assetId)
        .find((row) => { const provenance = parse(row.provenance, {}); return provenance.recipeId === recipeId && provenance.recipeRevision === recipeRevision; });
      itemId = existingItem?.id || id("library");
      if (!existingItem) this.db.prepare(`INSERT INTO library_items(
        id,episode_id,asset_id,category,label,tags,notes,section_id,source_kind,source_url,
        extracted_text,extraction_status,provenance,revision,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        itemId, episodeId, assetId, "Graphics", String(label || candidate.name), "[]", "", null, "graphic", null,
        "", "not-applicable", JSON.stringify({ recipeId, recipeRevision, jobId }), 1, stamp, stamp,
      );
      const current = episodeRow(this.db.prepare("SELECT * FROM episodes WHERE id=?").get(episodeId));
      const card = targetCard && current.cards.find((value) => value.id === targetCard.id);
      const unchanged = targetCard && current.revision === expectedEpisodeRevision && card &&
        card.type === targetCard.type && card.itemId === targetCard.itemId;
      if (unchanged) {
        const cards = validateCards(current.cards.map((value) => value.id === card.id ? { ...value, itemId,
          type: candidate.kind === "image" ? "Static Graphic" : "Video Graphic" } : value));
        const revision = current.revision + 1;
        this.db.prepare("UPDATE episodes SET cards=?,revision=?,updated_at=? WHERE id=? AND revision=?")
          .run(JSON.stringify(cards), revision, stamp, episodeId, current.revision);
        this.insertHistory({ ...current, revision, cards }, "graphic", stamp, current.revision);
        appliedToCard = true;
      } else if (targetCard) applyNote = "Graphic registered in the library; the target card changed while rendering and was not overwritten";
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return { asset: this.getAsset(assetId), item: this.getLibraryItem(episodeId, itemId), appliedToCard, applyNote };
  }
  listGraphicRecipes(episodeId) {
    return this.db.prepare(`SELECT g.*,r.recipe FROM graphic_recipes g
      JOIN graphic_recipe_revisions r ON r.recipe_id=g.id AND r.revision=g.current_revision
      WHERE g.episode_id=? ORDER BY g.created_at,g.id`).all(episodeId).map(graphicRecipeRow);
  }
  getGraphicRecipe(episodeId, recipeId, revision = null) {
    const row = revision == null
      ? this.db.prepare(`SELECT g.*,r.recipe FROM graphic_recipes g
          JOIN graphic_recipe_revisions r ON r.recipe_id=g.id AND r.revision=g.current_revision
          WHERE g.episode_id=? AND g.id=?`).get(episodeId, recipeId)
      : this.db.prepare(`SELECT g.id,g.episode_id,g.card_id,g.name,g.kind,? AS current_revision,g.created_at,g.updated_at,r.recipe FROM graphic_recipes g
          JOIN graphic_recipe_revisions r ON r.recipe_id=g.id AND r.revision=?
          WHERE g.episode_id=? AND g.id=?`).get(revision, revision, episodeId, recipeId);
    return graphicRecipeRow(row);
  }
  createGraphicRecipe(episodeId, { name, kind, cardId = null, recipe }, actor = "user") {
    if (!this.getEpisode(episodeId)) throw new StoreError("Episode not found", 404);
    if (!name || !String(name).trim()) throw new StoreError("Graphic name is required");
    if (!['still', 'motion'].includes(kind)) throw new StoreError("Graphic kind must be still or motion");
    if (cardId && !this.getEpisode(episodeId).cards.some((card) => card.id === cardId))
      throw new StoreError("Graphic card not found");
    const recipeId = id("graphic");
    const stamp = now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT INTO graphic_recipes VALUES(?,?,?,?,?,?,?,?)")
        .run(recipeId, episodeId, cardId, String(name).trim(), kind, 1, stamp, stamp);
      this.db.prepare("INSERT INTO graphic_recipe_revisions VALUES(?,?,?,?,?)")
        .run(recipeId, 1, JSON.stringify(recipe), actor, stamp);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.getGraphicRecipe(episodeId, recipeId);
  }
  updateGraphicRecipe(episodeId, recipeId, expectedRevision, { name, cardId, recipe }, actor = "user") {
    const current = this.getGraphicRecipe(episodeId, recipeId);
    if (!current) throw new StoreError("Graphic recipe not found", 404);
    if (!Number.isInteger(expectedRevision) || expectedRevision !== current.revision)
      throw new StoreError(`Stale graphic revision: expected ${current.revision}`, 409, { current });
    const nextRevision = current.revision + 1;
    const nextName = name == null ? current.name : String(name).trim();
    const nextCardId = cardId === undefined ? current.cardId : cardId || null;
    if (!nextName) throw new StoreError("Graphic name is required");
    if (nextCardId && !this.getEpisode(episodeId).cards.some((card) => card.id === nextCardId))
      throw new StoreError("Graphic card not found");
    const stamp = now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db.prepare(`UPDATE graphic_recipes SET name=?,card_id=?,current_revision=?,updated_at=?
        WHERE id=? AND episode_id=? AND current_revision=?`).run(nextName, nextCardId, nextRevision, stamp, recipeId, episodeId, expectedRevision);
      if (!result.changes) throw new StoreError("Stale graphic revision", 409);
      this.db.prepare("INSERT INTO graphic_recipe_revisions VALUES(?,?,?,?,?)")
        .run(recipeId, nextRevision, JSON.stringify(recipe), actor, stamp);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.getGraphicRecipe(episodeId, recipeId);
  }
  // Jobs inherit channel ownership through their (immutable) episode relationship.
  listJobs(episodeId, { channelId = null } = {}) {
    const select = "SELECT j.*,e.channel_id FROM jobs j LEFT JOIN episodes e ON e.id=j.episode_id";
    return (
      episodeId
        ? this.db.prepare(`${select} WHERE j.episode_id=? ORDER BY j.created_at DESC`).all(episodeId)
        : channelId
          ? this.db.prepare(`${select} WHERE e.channel_id=? ORDER BY j.created_at DESC`).all(channelId)
          : this.db.prepare(`${select} ORDER BY j.created_at DESC`).all()
    ).map(jobRow);
  }
  getJob(jobId) {
    return jobRow(this.db.prepare("SELECT j.*,e.channel_id FROM jobs j LEFT JOIN episodes e ON e.id=j.episode_id WHERE j.id=?").get(jobId));
  }
  designationHistory(outputId) {
    return this.db.prepare("SELECT * FROM output_designations WHERE job_id=? ORDER BY revision").all(outputId).map((row) => ({
      revision: row.revision, designation: row.designation, previous: row.previous, actor: row.actor, requestId: row.request_id, createdAt: row.created_at }));
  }
  getOutput(episodeId, outputId) {
    const job = this.getJob(outputId);
    if (!job || job.episodeId !== episodeId || !job.designation) throw new StoreError("Output not found in this episode", 404);
    return { ...job, designationHistory: this.designationHistory(outputId) };
  }
  // Move a completed final back to Drafts. Same record, bytes and path; only the designation changes (with history).
  // Without outputId the caller must mean the episode's single current final, otherwise it is ambiguous.
  moveFinalToDrafts({ episodeId, outputId = null, expectedRevision = null, actor = "human", requestId = null } = {}) {
    if (!this.getEpisode(episodeId)) throw new StoreError("Episode not found", 404);
    if (!outputId) {
      const finals = this.listJobs(episodeId).filter((job) => job.designation === "final" && job.state === "completed" && job.deletionState === "present");
      if (finals.length !== 1)
        throw new StoreError(finals.length ? "Several finals exist; identify which output to move" : "No completed final to move", 409,
          { candidates: finals.map((job) => ({ id: job.id, createdAt: job.createdAt, recordRevision: job.recordRevision })) });
      outputId = finals[0].id;
      expectedRevision ??= finals[0].recordRevision;
    }
    const current = this.getOutput(episodeId, outputId);
    if (current.state !== "completed" || current.deletionState !== "present") throw new StoreError("Only a completed, present output can be moved", 409, { current });
    if (current.designation !== "final") throw new StoreError("This output is not currently a Final", 409, { current });
    if (!Number.isInteger(expectedRevision) || expectedRevision !== current.recordRevision)
      throw new StoreError(`Stale output revision: expected ${current.recordRevision}`, 409, { current });
    const stamp = now(), revision = current.recordRevision + 1;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db.prepare(`UPDATE jobs SET designation='draft',record_revision=? WHERE id=? AND episode_id=? AND record_revision=?
        AND designation='final' AND deletion_state='present'`).run(revision, outputId, episodeId, expectedRevision);
      if (!result.changes) throw new StoreError("Stale output revision", 409);
      this.db.prepare(`INSERT INTO output_designations(job_id,revision,designation,previous,actor,request_id,created_at) VALUES(?,?,?,?,?,?,?)`)
        .run(outputId, revision, "draft", "final", String(actor), requestId, stamp);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.getOutput(episodeId, outputId);
  }
  // Paths another retained record depends on: registered library/branding assets and other outputs' files.
  outputPathOwners(relativePath, excludeIds = []) {
    const assets = this.db.prepare("SELECT id FROM assets WHERE path=? OR thumbnail_path=?").all(relativePath, relativePath).map((row) => ({ kind: "asset", id: row.id }));
    const jobs = this.db.prepare("SELECT id,state,deletion_state,output_path,sidecar_paths FROM jobs WHERE deletion_state<>'deleted'").all()
      .filter((row) => !excludeIds.includes(row.id) && (row.output_path === relativePath || parse(row.sidecar_paths, []).includes(relativePath)))
      .map((row) => ({ kind: ["queued", "running", "cancelling"].includes(row.state) ? "active-job" : "retained-output", id: row.id }));
    return [...assets, ...jobs];
  }
  markOutputDeleting(outputId, expectedRevision) {
    const stamp = now();
    const result = this.db.prepare(`UPDATE jobs SET deletion_state='deleting',deletion_started_at=?,record_revision=record_revision+1,deletion_note=NULL
      WHERE id=? AND record_revision=? AND deletion_state='present' AND designation='draft' AND state='completed'`).run(stamp, outputId, expectedRevision);
    return result.changes === 1;
  }
  finishOutputDeletion(outputId, { bytes = null, note = null } = {}) {
    this.db.prepare(`UPDATE jobs SET deletion_state='deleted',deleted_at=?,deleted_bytes=?,deletion_note=?,record_revision=record_revision+1
      WHERE id=? AND deletion_state='deleting'`).run(now(), bytes, note, outputId);
  }
  abortOutputDeletion(outputId, note) {
    this.db.prepare(`UPDATE jobs SET deletion_state='present',deletion_started_at=NULL,deletion_note=?,record_revision=record_revision+1
      WHERE id=? AND deletion_state='deleting'`).run(note, outputId);
  }
  // An interruption between file removal and the metadata update leaves 'deleting' rows. On reopen: a file that is
  // gone is recorded as absent (no reclaimed bytes claimed); a file still present returns to 'present' for retry.
  reconcileOutputDeletions() {
    const outcomes = [];
    for (const row of this.db.prepare("SELECT id,output_path FROM jobs WHERE deletion_state='deleting'").all()) {
      const file = row.output_path ? path.resolve(this.workspace, row.output_path) : null;
      const inside = file && file.startsWith(this.workspace + path.sep);
      if (inside && existsSync(file)) {
        this.abortOutputDeletion(row.id, "Deletion was interrupted; the file is still present and can be deleted again");
        outcomes.push({ id: row.id, state: "present" });
      } else {
        this.finishOutputDeletion(row.id, { bytes: null, note: "Deletion was interrupted; the file was already absent when reconciled" });
        outcomes.push({ id: row.id, state: "deleted" });
      }
    }
    return outcomes;
  }
  // ---- Schema 9 accessors: conversation selection, native-session segments, production requests ----
  conversationRow(row) {
    return row ? { id: row.id, episodeId: row.episode_id, name: row.name, state: row.state, threadId: row.thread_id ?? null,
      harness: row.harness, model: row.model ?? null, effort: row.effort ?? null, settingsSource: row.settings_source,
      settingsRevision: row.settings_revision, settingsUpdatedAt: row.settings_updated_at ?? null, activeSegmentId: row.active_segment_id ?? null,
      createdAt: row.created_at, updatedAt: row.updated_at } : null;
  }
  getConversation(conversationId) {
    return this.conversationRow(this.db.prepare("SELECT * FROM conversations WHERE id=?").get(String(conversationId ?? "")));
  }
  requireConversation(conversationId) {
    const conversation = this.getConversation(conversationId);
    if (!conversation) throw new StoreError("Conversation not found", 404);
    return conversation;
  }
  // An explicit choice from the UI. Optimistic: expectedRevision must match settings_revision.
  // Settings and segments change only between requests: refuse while a request of this conversation, or request-owned
  // work on its episode, is unfinished. `exceptRunId` exempts the request being dispatched (e.g. its resume fallback).
  assertConversationIdle(conversationId, { exceptRunId = null } = {}) {
    const conversation = this.requireConversation(conversationId);
    const busy = this.db.prepare("SELECT id FROM production_runs WHERE conversation_id=? AND state IN ('starting','running') AND id IS NOT ? LIMIT 1").get(conversationId, exceptRunId);
    if (busy) throw new StoreError("A request is still running in this conversation; finish or stop it first", 409, { requestId: busy.id });
    const work = this.db.prepare(`SELECT j.id,j.request_id FROM jobs j JOIN production_runs r ON r.id=j.request_id
      WHERE r.episode_id=? AND j.state IN ('queued','running','cancelling') AND r.id IS NOT ? LIMIT 1`).get(conversation.episodeId, exceptRunId);
    if (work) throw new StoreError("Request-owned production work is still running on this episode; finish or stop it first", 409, { jobId: work.id, requestId: work.request_id });
    return conversation;
  }
  updateConversationSettings(conversationId, expectedRevision, { harness, model = null, effort = null } = {}) {
    const current = this.requireConversation(conversationId);
    if (!HARNESSES.includes(harness)) throw new StoreError(`harness must be one of ${HARNESSES.join(", ")}`);
    const values = [harness, shortText(model, "model"), shortText(effort, "effort")];
    if (!Number.isInteger(expectedRevision) || expectedRevision !== current.settingsRevision)
      throw new StoreError(`Stale conversation settings: expected revision ${current.settingsRevision}`, 409, { current });
    this.assertConversationIdle(conversationId);
    const result = this.db.prepare(`UPDATE conversations SET harness=?,model=?,effort=?,settings_source='explicit',settings_revision=settings_revision+1,settings_updated_at=?
      WHERE id=? AND settings_revision=?`).run(...values, now(), conversationId, expectedRevision);
    if (!result.changes) throw new StoreError("Stale conversation settings", 409, { current: this.getConversation(conversationId) });
    return this.getConversation(conversationId);
  }
  // The most recent explicit choice anywhere, used to preselect a new conversation.
  lastExplicitSettings() {
    const row = this.db.prepare("SELECT harness,model,effort FROM conversations WHERE settings_source='explicit' ORDER BY settings_updated_at DESC, id DESC LIMIT 1").get();
    return row ? { harness: row.harness, model: row.model ?? null, effort: row.effort ?? null } : null;
  }

  segmentRow(row) {
    return row ? { id: row.id, conversationId: row.conversation_id, harness: row.harness, nativeSessionId: row.native_session_id ?? null, reason: row.reason,
      previousSegmentId: row.previous_segment_id ?? null, firstMessageId: row.first_message_id ?? null,
      seedIncludedMessages: row.seed_included_messages ?? null, seedOmittedMessages: row.seed_omitted_messages ?? null, createdAt: row.created_at, endedAt: row.ended_at ?? null } : null;
  }
  getSegment(segmentId) { return this.segmentRow(this.db.prepare("SELECT * FROM conversation_segments WHERE id=?").get(String(segmentId ?? ""))); }
  listSegments(conversationId) {
    return this.db.prepare("SELECT * FROM conversation_segments WHERE conversation_id=? ORDER BY created_at,rowid").all(conversationId).map((row) => this.segmentRow(row));
  }
  getActiveSegment(conversationId) {
    const conversation = this.requireConversation(conversationId);
    return conversation.activeSegmentId ? this.getSegment(conversation.activeSegmentId) : null;
  }
  // Starts a new native-session segment and makes it active; the previous active segment ends. Native session IDs are
  // never carried across harnesses: set the new one with setSegmentNativeSession once the harness reports it.
  createSegment({ id: requestedId = null, conversationId, harness, reason, previousSegmentId, firstMessageId = null, seedIncludedMessages = null, seedOmittedMessages = null, exceptRunId = null } = {}) {
    const conversation = this.assertConversationIdle(conversationId, { exceptRunId });
    if (!HARNESSES.includes(harness)) throw new StoreError(`harness must be one of ${HARNESSES.join(", ")}`);
    // A segment created on behalf of a dispatched request (exceptRunId) must be for that request's own
    // conversation and harness: the exemption never lets a request open another harness's segment.
    if (exceptRunId != null) {
      const run = this.getProductionRun(exceptRunId);
      if (!run || run.conversationId !== conversationId) throw new StoreError("The dispatched request is not in this conversation", 404);
      if (run.harness !== harness) throw new StoreError(`A ${run.harness} request cannot open a ${harness} segment`, 409, { requestId: run.id });
    }
    if (!SEGMENT_REASONS.includes(reason)) throw new StoreError(`reason must be one of ${SEGMENT_REASONS.join(", ")}`);
    const previous = previousSegmentId === undefined ? conversation.activeSegmentId : previousSegmentId;
    for (const [value, field] of [[firstMessageId, "firstMessageId"], [seedIncludedMessages, "seedIncludedMessages"], [seedOmittedMessages, "seedOmittedMessages"]])
      if (value != null && (!Number.isInteger(value) || value < 0)) throw new StoreError(`${field} must be a non-negative integer`);
    if (requestedId != null && (typeof requestedId !== "string" || !SAFE_SEGMENT.test(requestedId))) throw new StoreError("segment id must be a plain identifier");
    const segmentId = requestedId ?? id("segment"), stamp = now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (previous) this.db.prepare("UPDATE conversation_segments SET ended_at=? WHERE id=? AND conversation_id=? AND ended_at IS NULL").run(stamp, previous, conversationId);
      this.db.prepare(`INSERT INTO conversation_segments(id,conversation_id,harness,native_session_id,reason,previous_segment_id,first_message_id,seed_included_messages,seed_omitted_messages,created_at)
        VALUES(?,?,?,NULL,?,?,?,?,?,?)`).run(segmentId, conversationId, harness, reason, previous ?? null, firstMessageId, seedIncludedMessages, seedOmittedMessages, stamp);
      this.db.prepare("UPDATE conversations SET active_segment_id=?,updated_at=? WHERE id=?").run(segmentId, stamp, conversationId);
      this.db.exec("COMMIT");
    } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
    return this.getSegment(segmentId);
  }
  setSegmentNativeSession(segmentId, nativeSessionId) {
    const segment = this.getSegment(segmentId);
    if (!segment) throw new StoreError("Segment not found", 404);
    if (typeof nativeSessionId !== "string" || !nativeSessionId || nativeSessionId.length > 200) throw new StoreError("nativeSessionId must be a non-empty string");
    if (segment.nativeSessionId === nativeSessionId) return segment;
    if (segment.nativeSessionId) throw new StoreError("This segment already has a different native session", 409, { current: segment });
    try { this.db.prepare("UPDATE conversation_segments SET native_session_id=? WHERE id=? AND native_session_id IS NULL").run(nativeSessionId, segmentId); }
    catch (error) { if (/UNIQUE/.test(error.message)) throw new StoreError("That native session already belongs to another segment", 409); throw error; }
    return this.getSegment(segmentId);
  }
  updateSegmentSeed(segmentId, { firstMessageId, seedIncludedMessages, seedOmittedMessages } = {}) {
    if (!this.getSegment(segmentId)) throw new StoreError("Segment not found", 404);
    const sets = [], values = [];
    for (const [value, column] of [[firstMessageId, "first_message_id"], [seedIncludedMessages, "seed_included_messages"], [seedOmittedMessages, "seed_omitted_messages"]]) {
      if (value === undefined) continue;
      if (value !== null && (!Number.isInteger(value) || value < 0)) throw new StoreError(`${column} must be a non-negative integer`);
      sets.push(`${column}=?`); values.push(value);
    }
    if (sets.length) this.db.prepare(`UPDATE conversation_segments SET ${sets.join(",")} WHERE id=?`).run(...values, segmentId);
    return this.getSegment(segmentId);
  }

  // The only supported way to add a visible message: origin is derived from the role, never taken from a request
  // body or a tool call. A creator (user) message is 'typed' unless the app's own shortcut button produced it.
  addConversationMessage({ conversationId, role, text, state = "completed", turnId = null, shortcut = false } = {}) {
    this.requireConversation(conversationId);
    if (!["user", "assistant", "system"].includes(role)) throw new StoreError("role must be user, assistant or system");
    if (typeof text !== "string") throw new StoreError("text must be a string");
    if (shortcut && role !== "user") throw new StoreError("Only a user message can come from a shortcut button");
    const origin = role === "user" ? (shortcut ? "button" : "typed") : role === "assistant" ? "agent" : "system";
    const stamp = now();
    const messageId = Number(this.db.prepare("INSERT INTO conversation_messages(conversation_id,role,text,state,turn_id,created_at,updated_at,origin) VALUES(?,?,?,?,?,?,?,?)")
      .run(conversationId, role, text, String(state), turnId, stamp, stamp, origin).lastInsertRowid);
    return { id: messageId, conversationId, role, text, state: String(state), turnId, origin, createdAt: stamp };
  }
  runRow(row) {
    return row ? { id: row.id, conversationId: row.conversation_id, episodeId: row.episode_id, segmentId: row.segment_id ?? null, kind: row.kind, origin: row.origin,
      clientRequestId: row.client_request_id ?? null, targetCardId: row.target_card_id ?? null, originatingMessageId: row.originating_message_id ?? null,
      assistantMessageId: row.assistant_message_id ?? null, harness: row.harness, modelSelected: row.model_selected ?? null, effortSelected: row.effort_selected ?? null,
      modelResolved: row.model_resolved ?? null, effortResolved: row.effort_resolved ?? null, nativeTurnId: row.native_turn_id ?? null, state: row.state,
      error: row.error ?? null, usage: parse(row.usage, null), finalIntent: row.final_intent, finalEndedReason: row.final_ended_reason ?? null,
      finalOutputJobId: row.final_output_job_id ?? null, successorOf: row.successor_of ?? null, startedAt: row.started_at, finishedAt: row.finished_at ?? null, updatedAt: row.updated_at } : null;
  }
  getProductionRun(runId) { return this.runRow(this.db.prepare("SELECT * FROM production_runs WHERE id=?").get(String(runId ?? ""))); }
  getRunByClientRequestId(conversationId, clientRequestId) {
    return this.runRow(this.db.prepare("SELECT * FROM production_runs WHERE conversation_id=? AND client_request_id=?").get(conversationId, clientRequestId));
  }
  listProductionRuns({ conversationId = null, episodeId = null, states = null } = {}) {
    const where = [], values = [];
    if (conversationId) { where.push("conversation_id=?"); values.push(conversationId); }
    if (episodeId) { where.push("episode_id=?"); values.push(episodeId); }
    if (states?.length) { where.push(`state IN (${states.map(() => "?").join(",")})`); values.push(...states); }
    return this.db.prepare(`SELECT * FROM production_runs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY started_at,rowid`).all(...values).map((row) => this.runRow(row));
  }
  // One visible request. A repeated submission with the same clientRequestId in the conversation returns the
  // existing row ({ created: false }). Final intent is bound to kind 'final' and starts 'active'.
  createProductionRun({ id: runId = null, conversationId, kind = "chat", origin = "typed", clientRequestId = null, targetCardId = null,
    originatingMessageId = null, segmentId = null, harness, modelSelected = null, effortSelected = null, successorOf = null } = {}) {
    const conversation = this.requireConversation(conversationId);
    if (clientRequestId != null) {
      if (typeof clientRequestId !== "string" || !clientRequestId || clientRequestId.length > 200) throw new StoreError("clientRequestId must be a non-empty string");
      const existing = this.getRunByClientRequestId(conversationId, clientRequestId);
      if (existing) return { run: existing, created: false };
    }
    if (!RUN_KINDS.includes(kind)) throw new StoreError(`kind must be one of ${RUN_KINDS.join(", ")}`);
    if (!RUN_ORIGINS.includes(origin)) throw new StoreError(`origin must be one of ${RUN_ORIGINS.join(", ")}`);
    if (!HARNESSES.includes(harness)) throw new StoreError(`harness must be one of ${HARNESSES.join(", ")}`);
    if (runId != null && (typeof runId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(runId))) throw new StoreError("run id must be a plain identifier");
    if (targetCardId != null && !this.getEpisode(conversation.episodeId).cards.some((card) => card.id === targetCardId))
      throw new StoreError(`Target card not found in this episode: ${targetCardId}`, 404);
    if (originatingMessageId != null) {
      const message = this.db.prepare("SELECT conversation_id,role FROM conversation_messages WHERE id=?").get(originatingMessageId);
      if (!message || message.conversation_id !== conversationId) throw new StoreError("The originating message is not in this conversation", 404);
      if (message.role !== "user") throw new StoreError("A request originates from a creator (user) message", 400);
    }
    if (segmentId != null && this.getSegment(segmentId)?.conversationId !== conversationId) throw new StoreError("The segment is not in this conversation", 404);
    if (successorOf != null) {
      const previous = this.getProductionRun(successorOf);
      if (!previous || previous.conversationId !== conversationId) throw new StoreError("The retried request is not in this conversation", 404);
    }
    if (runId != null && this.getProductionRun(runId)) throw new StoreError(`A request with id ${runId} already exists`, 409);
    const stamp = now(), value = runId ?? id("request");
    try {
      this.db.prepare(`INSERT INTO production_runs(id,conversation_id,episode_id,segment_id,kind,origin,client_request_id,target_card_id,originating_message_id,
        harness,model_selected,effort_selected,final_intent,successor_of,started_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(value, conversationId, conversation.episodeId, segmentId, kind, origin, clientRequestId, targetCardId, originatingMessageId,
          harness, shortText(modelSelected, "modelSelected"), shortText(effortSelected, "effortSelected"), kind === "final" ? "active" : "none", successorOf, stamp, stamp);
    } catch (error) {
      // A concurrent identical submission won the insert: return that row.
      if (clientRequestId != null && /UNIQUE/.test(error.message)) {
        const existing = this.getRunByClientRequestId(conversationId, clientRequestId);
        if (existing) return { run: existing, created: false };
      }
      throw error;
    }
    return { run: this.getProductionRun(value), created: true };
  }
  // A typed Final is recognized by the active agent request, then bound by the app to that
  // request's exact originating creator message. Button Finals are already active at creation.
  declareFinalRequest(runId, messageId) {
    const run = this.getProductionRun(runId);
    if (!run) throw new StoreError("Production request not found", 404);
    let root = run;
    const seen = new Set();
    while (root.successorOf) {
      if (seen.has(root.id)) throw new StoreError("The request retry chain is invalid", 409);
      seen.add(root.id);
      root = this.getProductionRun(root.successorOf);
      if (!root || root.conversationId !== run.conversationId) throw new StoreError("The original typed request is unavailable", 409);
    }
    // A Final button (including its Retry chain) has already bound authority; a redundant
    // declaration changes nothing. A typed-root successor still validates the typed identity.
    if (root.origin === "button" && run.kind === "final" && run.finalIntent === "active") return run;
    if (root.origin !== "typed") throw new StoreError("Only a typed creator request can declare Final intent", 403);
    if (root.originatingMessageId !== messageId) throw new StoreError("Final intent must cite the root typed request's originating message", 403);
    const message = this.db.prepare("SELECT conversation_id,role,origin FROM conversation_messages WHERE id=?").get(messageId);
    if (!message || message.conversation_id !== run.conversationId) throw new StoreError("The Final request message is not in this conversation", 404);
    if (message.role !== "user" || message.origin !== "typed") throw new StoreError("Final intent requires the originating typed creator message", 403);
    if (RUN_TERMINAL.includes(run.state)) throw new StoreError(`A ${run.state} request cannot declare Final intent`, 409, { current: run });
    if (run.kind === "final" && run.finalIntent === "active") return run;
    if (run.kind !== "chat" || run.finalIntent !== "none")
      throw new StoreError("Only an ordinary typed request without existing Final intent can be declared Final", 409, { current: run });
    const result = this.db.prepare(`UPDATE production_runs SET kind='final',final_intent='active',updated_at=?
      WHERE id=? AND state IN ('starting','running') AND kind='chat' AND final_intent='none'`)
      .run(now(), runId);
    if (!result.changes) throw new StoreError("The request changed before Final intent could be declared", 409, { current: this.getProductionRun(runId) });
    return this.getProductionRun(runId);
  }
  // Progress and attribution as the harness reports it. Terminal states are final.
  updateProductionRun(runId, changes = {}) {
    const current = this.getProductionRun(runId);
    if (!current) throw new StoreError("Production request not found", 404);
    const sets = [], values = [];
    if (changes.finalEndReason !== undefined && !INTERRUPTION_REASONS.includes(changes.finalEndReason))
      throw new StoreError(`finalEndReason must be one of ${INTERRUPTION_REASONS.join(", ")} (for an interrupted request)`);
    if (changes.state !== undefined && changes.state !== current.state) {
      if (!RUN_TRANSITIONS[current.state]?.includes(changes.state)) throw new StoreError(`A ${current.state} request cannot become ${changes.state}`, 409, { current });
      sets.push("state=?"); values.push(changes.state);
      if (RUN_TERMINAL.includes(changes.state)) {
        sets.push("finished_at=?"); values.push(now());
        // A request that finishes without publishing ends its Final intent in the same update.
        if (current.finalIntent === "active") {
          sets.push("final_intent='ended'", "final_ended_reason=?");
          values.push(changes.state === "interrupted" ? changes.finalEndReason ?? "stopped" : FINAL_END_ON_TERMINAL[changes.state]);
        }
      }
    }
    if (changes.assistantMessageId != null) {
      const message = this.db.prepare("SELECT conversation_id,role FROM conversation_messages WHERE id=?").get(changes.assistantMessageId);
      if (!message || message.conversation_id !== current.conversationId) throw new StoreError("The assistant message is not in this conversation", 404);
      if (message.role !== "assistant") throw new StoreError("assistantMessageId must be an assistant message", 400);
    }
    if (changes.segmentId != null && this.getSegment(changes.segmentId)?.conversationId !== current.conversationId)
      throw new StoreError("The segment is not in this conversation", 404);
    const text = { error: "error", modelResolved: "model_resolved", effortResolved: "effort_resolved", nativeTurnId: "native_turn_id" };
    for (const [key, column] of Object.entries(text)) if (changes[key] !== undefined) { sets.push(`${column}=?`); values.push(changes[key] == null ? null : String(changes[key]).slice(0, 4000)); }
    if (changes.usage !== undefined) { sets.push("usage=?"); values.push(changes.usage == null ? null : JSON.stringify(changes.usage)); }
    for (const [key, column] of [["assistantMessageId", "assistant_message_id"], ["segmentId", "segment_id"]])
      if (changes[key] !== undefined) { sets.push(`${column}=?`); values.push(changes[key]); }
    if (!sets.length) return current;
    sets.push("updated_at=?"); values.push(now());
    // The state guard makes a concurrent transition lose cleanly instead of overwriting a terminal state.
    const result = this.db.prepare(`UPDATE production_runs SET ${sets.join(",")} WHERE id=? AND state=?`).run(...values, runId, current.state);
    if (!result.changes) throw new StoreError("The request changed concurrently", 409, { current: this.getProductionRun(runId) });
    return this.getProductionRun(runId);
  }
  // Final intent ends exactly once: published (with the completed final output of this request) or with a reason.
  publishFinalIntent(runId, jobId, completion = null) {
    const run = this.getProductionRun(runId);
    if (!run) throw new StoreError("Production request not found", 404);
    if (RUN_TERMINAL.includes(run.state)) throw new StoreError(`A ${run.state} request cannot publish a Final`, 409, { current: run });
    let job = this.getJob(jobId);
    if (!job || job.requestId !== runId) throw new StoreError("The output was not produced by this request", 409);
    const pinnedEpisodeRevision = completion?.snapshot?.episode?.revision ?? job.snapshot?.episode?.revision;
    const pinnedStoryRevision = completion?.snapshot?.story?.storyRevision ?? job.snapshot?.story?.storyRevision;
    if (!Number.isInteger(pinnedEpisodeRevision)) throw new StoreError("The Final output is missing its pinned episode revision", 409);
    if (!Number.isInteger(pinnedStoryRevision)) throw new StoreError("The Final output is missing its pinned story revision", 409);
    const stamp = now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (completion) {
        if (!completion.outputPath || !completion.snapshot) throw new StoreError("Completed Final output path and snapshot are required");
        const completed = this.db.prepare(`UPDATE jobs SET state='completed',progress=1,output_path=?,error=NULL,snapshot=?,updated_at=?
          WHERE id=? AND request_id=? AND output_class='final' AND designation='final' AND deletion_state='present' AND state IN ('queued','running')`)
          .run(completion.outputPath, JSON.stringify(completion.snapshot), stamp, jobId, runId);
        if (!completed.changes) throw new StoreError("The Final output changed before publication", 409, { current: this.getJob(jobId) });
        job = this.getJob(jobId);
      }
      if (job.state !== "completed" || job.outputClass !== "final" || job.designation !== "final" || job.deletionState !== "present")
        throw new StoreError("Only a completed, present Final output can publish a Final request", 409);
      const result = this.db.prepare(`UPDATE production_runs SET final_intent='published',final_ended_reason='published',final_output_job_id=?,updated_at=?
        WHERE id=? AND final_intent='active' AND state IN ('starting','running')
          AND (SELECT revision FROM episodes WHERE id=?)=?
          AND (SELECT revision FROM stories WHERE episode_id=?)=?`)
        .run(jobId, stamp, runId, run.episodeId, pinnedEpisodeRevision, run.episodeId, pinnedStoryRevision);
      if (!result.changes) {
        const currentEpisodeRevision = this.db.prepare("SELECT revision FROM episodes WHERE id=?").get(run.episodeId)?.revision;
        const currentStoryRevision = this.db.prepare("SELECT revision FROM stories WHERE episode_id=?").get(run.episodeId)?.revision;
        if (currentEpisodeRevision !== pinnedEpisodeRevision || currentStoryRevision !== pinnedStoryRevision)
          throw new StoreError("Render inputs changed before Final publication; validate the current cut and render again", 409, { currentEpisodeRevision, currentStoryRevision });
        throw new StoreError(`This request has no active Final intent (${run.finalIntent})`, 409, { current: run });
      }
      this.db.exec("COMMIT");
    } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
    return this.getProductionRun(runId);
  }
  endFinalIntent(runId, reason) {
    if (!FINAL_END_REASONS.includes(reason)) throw new StoreError(`reason must be one of ${FINAL_END_REASONS.join(", ")}`);
    const result = this.db.prepare("UPDATE production_runs SET final_intent='ended',final_ended_reason=?,updated_at=? WHERE id=? AND final_intent='active'").run(reason, now(), runId);
    const run = this.getProductionRun(runId);
    if (!run) throw new StoreError("Production request not found", 404);
    if (!result.changes) throw new StoreError(`This request has no active Final intent (${run.finalIntent})`, 409, { current: run });
    return run;
  }
  // An explicit user Retry of a finished request: a successor with the same kind and target, and Final intent again
  // for a Final request that ended unpublished. A published Final is not retried; a new Final request is a new version.
  // Harness, model and effort default to the conversation's current selection (it may have changed since).
  retryProductionRun(runId, { clientRequestId = null, originatingMessageId = null, origin = "button", harness, modelSelected, effortSelected, segmentId = null } = {}) {
    const previous = this.getProductionRun(runId);
    if (!previous) throw new StoreError("Production request not found", 404);
    if (!RUN_TERMINAL.includes(previous.state)) throw new StoreError("Only a finished request can be retried", 409, { current: previous });
    if (previous.finalIntent === "published") throw new StoreError("This Final request was published; request a new Final instead of retrying it", 409, { current: previous });
    if (previous.finalIntent === "active") throw new StoreError("This request's Final intent is still active", 409, { current: previous });
    const selection = this.requireConversation(previous.conversationId);
    return this.createProductionRun({ conversationId: previous.conversationId, kind: previous.kind, origin, clientRequestId, targetCardId: previous.targetCardId,
      originatingMessageId, segmentId, harness: harness ?? selection.harness, modelSelected: modelSelected === undefined ? selection.model : modelSelected,
      effortSelected: effortSelected === undefined ? selection.effort : effortSelected, successorOf: runId });
  }
  // Jobs owned by a request (set once; the episode must match). Stop cancels the active ones.
  linkJobToRequest(jobId, runId) {
    const job = this.getJob(jobId), run = this.getProductionRun(runId);
    if (!job) throw new StoreError("Job not found", 404);
    if (!run) throw new StoreError("Production request not found", 404);
    if (job.requestId === runId) return job;
    if (job.requestId) throw new StoreError("The job already belongs to another request", 409);
    if (job.episodeId !== run.episodeId) throw new StoreError("The job belongs to another episode", 409);
    if (RUN_TERMINAL.includes(run.state)) throw new StoreError(`A ${run.state} request cannot take on new work`, 409, { current: run });
    this.db.prepare("UPDATE jobs SET request_id=? WHERE id=? AND request_id IS NULL").run(runId, jobId);
    return this.getJob(jobId);
  }
  listRequestJobs(runId, { activeOnly = false } = {}) {
    return this.db.prepare(`SELECT j.*,e.channel_id FROM jobs j LEFT JOIN episodes e ON e.id=j.episode_id WHERE j.request_id=?${activeOnly ? " AND j.state IN ('queued','running','cancelling')" : ""} ORDER BY j.created_at`)
      .all(runId).map(jobRow);
  }
  // Startup: an application restart ends unfinished requests (interrupted, never replayed) and their Final intent.
  reconcileProductionRuns() {
    if (!this.tableExists("production_runs")) return;
    const stamp = now();
    this.db.prepare(`UPDATE production_runs SET state='interrupted',error=COALESCE(error,'Interrupted by an application restart'),finished_at=?,updated_at=?,
      final_ended_reason=CASE WHEN final_intent='active' THEN 'restart' ELSE final_ended_reason END,
      final_intent=CASE WHEN final_intent='active' THEN 'ended' ELSE final_intent END
      WHERE state IN ('starting','running')`).run(stamp, stamp);
  }
  saveJob(job) {
    const old = job.id && this.getJob(job.id);
    if (old?.state === "completed") throw new StoreError("Completed job records are immutable", 409);
    // A new job may be created for a live request only; its episode must match (the trigger enforces it too).
    if (!old && job.requestId != null) {
      const run = this.getProductionRun(job.requestId);
      if (!run) throw new StoreError("Production request not found", 404);
      if (run.episodeId !== job.episodeId) throw new StoreError("The request belongs to another episode", 409);
      if (RUN_TERMINAL.includes(run.state)) throw new StoreError(`A ${run.state} request cannot take on new work`, 409, { current: run });
    }
    const value = {
      ...old,
      ...job,
      id: job.id || id("job"),
      createdAt: old?.createdAt || job.createdAt || now(),
      updatedAt: now(),
    };
    this.db
      .prepare(
        `INSERT INTO jobs(id,episode_id,kind,state,progress,revision,output_path,error,snapshot,created_at,updated_at,output_class,request_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,progress=excluded.progress,output_path=excluded.output_path,error=excluded.error,snapshot=excluded.snapshot,updated_at=excluded.updated_at,output_class=excluded.output_class`,
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
        value.outputClass || "active",
        // Set on insert only: the upsert never changes an existing job's request.
        old ? old.requestId : value.requestId ?? null,
      );
    return this.getJob(value.id);
  }
}

export default Store;
