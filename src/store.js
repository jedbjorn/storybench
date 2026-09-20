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
  let inSections = false;
  let fence = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const fenceMatch = /^ {0,3}(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      const token = fenceMatch[1];
      if (!fence) fence = { character: token[0], length: token.length };
      else if (fence.character === token[0] && token.length >= fence.length)
        fence = null;
      continue;
    }
    if (fence) continue;
    const h1 = /^ {0,3}#\s+(.+?)\s*#*\s*$/.exec(line);
    if (h1) {
      inSections = h1[1].trim().toLowerCase() === "sections";
      continue;
    }
    if (!inSections) continue;
    const h2 = /^ {0,3}##\s+(.+?)\s*#*\s*$/.exec(line);
    if (!h2) continue;
    const marker = index > 0 ? STORY_MARKER.exec(lines[index - 1]) : null;
    let sectionId = marker?.[1]?.toLowerCase();
    if (sectionId && seen.has(sectionId))
      throw new StoreError(`Duplicate story section id: ${sectionId}`);
    if (!sectionId) {
      sectionId = crypto.randomUUID();
      lines.splice(index, 0, `<!-- storybench:section ${sectionId} -->`);
      index++;
    }
    seen.add(sectionId);
    sections.push({ id: sectionId, title: h2[1].trim(), order: sections.length });
  }
  return {
    source: lines.join(newline),
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
    return {
      id: cardId,
      title: String(card.title ?? ""),
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
    if (version >= 2) return;
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
      this.db.prepare("INSERT OR REPLACE INTO migration_log(version,completed_at) VALUES(2,?)").run(stamp);
      this.db.exec("PRAGMA user_version=2; COMMIT");
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
    return episode;
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
      { title: prior.title, notes: prior.notes, cards: parse(prior.cards, []) },
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
    return this.db.prepare(`SELECT l.episode_id AS episodeId,l.asset_id AS assetId,l.category,l.created_at AS createdAt
      FROM episode_library l WHERE l.episode_id=? ORDER BY l.created_at,l.asset_id`).all(episodeId);
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
      this.db.prepare("UPDATE story_sections SET retired_at=? WHERE episode_id=? AND retired_at IS NULL").run(stamp, episodeId);
      const upsert = this.db.prepare(`INSERT INTO story_sections(id,episode_id,title,sort_order,retired_at) VALUES(?,?,?,?,NULL)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title,sort_order=excluded.sort_order,retired_at=NULL`);
      for (const section of normalized.sections)
        upsert.run(section.id, episodeId, section.title, section.order);
      this.db.prepare(`UPDATE stories SET source=?,revision=?,sections=?,publication_pending=1,committed_hash=?,updated_at=?
        WHERE episode_id=? AND revision=?`).run(normalized.source, nextRevision, JSON.stringify(normalized.sections), hash(normalized.source), stamp, episodeId, expectedStoryRevision);
      this.db.prepare("INSERT INTO story_history(episode_id,revision,source,sections,actor,created_at) VALUES(?,?,?,?,?,?)")
        .run(episodeId, nextRevision, normalized.source, JSON.stringify(normalized.sections), actor, stamp);
      if (unassignedCardIds.length) {
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
      return { ...published, mappingChanges: { retiredSectionIds: normalized.retiredSectionIds, unassignedCardIds } };
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
