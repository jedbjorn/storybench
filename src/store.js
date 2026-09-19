import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const parse = (value, fallback = null) =>
  value == null ? fallback : JSON.parse(value);

export class StoreError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
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
    };
  });
}

function episodeRow(row) {
  return (
    row && {
      id: row.id,
      title: row.title,
      notes: row.notes,
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
      snapshot: parse(row.snapshot),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  );
}

export class Store {
  constructor(workspace) {
    this.workspace = path.resolve(workspace);
    for (const dir of ["", "media", "cache", "exports", "imports"])
      mkdirSync(path.join(this.workspace, dir), { recursive: true });
    this.db = new DatabaseSync(path.join(this.workspace, "storybench.sqlite"));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS episodes (id TEXT PRIMARY KEY,title TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL,cards TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS episode_history (episode_id TEXT NOT NULL,revision INTEGER NOT NULL,title TEXT NOT NULL,notes TEXT NOT NULL,cards TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL,parent_revision INTEGER,PRIMARY KEY(episode_id,revision));
      CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY,name TEXT NOT NULL,hash TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,path TEXT NOT NULL,duration REAL,width INTEGER,height INTEGER,metadata TEXT NOT NULL,thumbnail_path TEXT,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY,episode_id TEXT NOT NULL,kind TEXT NOT NULL,state TEXT NOT NULL,progress REAL NOT NULL DEFAULT 0,revision INTEGER NOT NULL,output_path TEXT,error TEXT,snapshot TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);`);
    if (
      !this.db
        .prepare("PRAGMA table_info('episode_history')")
        .all()
        .some((column) => column.name === "parent_revision")
    ) {
      this.db.exec(
        "ALTER TABLE episode_history ADD COLUMN parent_revision INTEGER",
      );
      this.db.exec(
        "UPDATE episode_history SET parent_revision=revision-1 WHERE revision>1",
      );
    }
    this.db
      .prepare(
        "UPDATE jobs SET state='failed', error='Render interrupted by server restart', updated_at=? WHERE state IN ('queued','running')",
      )
      .run(now());
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
      revision: 1,
      cards: [],
      createdAt: now(),
      updatedAt: now(),
    };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare("INSERT INTO episodes VALUES(?,?,?,?,?,?,?)")
        .run(
          episode.id,
          episode.title,
          episode.notes,
          1,
          "[]",
          episode.createdAt,
          episode.updatedAt,
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
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
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
    const next = {
      ...current,
      title: changes.title == null ? current.title : String(changes.title),
      notes: changes.notes == null ? current.notes : String(changes.notes),
      cards,
      revision: current.revision + 1,
      updatedAt: now(),
    };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db
        .prepare(
          "UPDATE episodes SET title=?,notes=?,revision=?,cards=?,updated_at=? WHERE id=? AND revision=?",
        )
        .run(
          next.title,
          next.notes,
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
