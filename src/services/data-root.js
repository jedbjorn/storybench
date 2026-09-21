// Shared data-root services. The HTTP server and an offline CLI both use these; none require a running server.
// A data root is one directory holding storybench.sqlite (all channels) and channels/<channel-id>/ files.
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { DEFAULT_CHANNEL_NAME, SCHEMA_VERSION, Store, StoreError } from "../store.js";

export const DATABASE_FILE = "storybench.sqlite";
// Names that only Storybench creates. Their presence without a usable database is conflicting state.
const STORYBENCH_ENTRIES = new Set([
  "storybench.sqlite-wal", "storybench.sqlite-shm", "storybench.pre-v2.sqlite", "storybench.pre-v6.sqlite",
  "episodes", "media", "channels", "branding", "exports",
]);

function absoluteRoot(dir) {
  if (typeof dir !== "string" || !path.isAbsolute(dir)) throw new StoreError("The data root must be an absolute path");
  return path.resolve(dir);
}

function readDatabase(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const version = Number(db.prepare("PRAGMA user_version").get().user_version);
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
    const identity = tables.has("data_root") ? db.prepare("SELECT * FROM data_root WHERE singleton=1").get() : null;
    const count = (table) => tables.has(table) ? Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n) : 0;
    return { version, tables, identity, counts: { channels: count("channels"), episodes: count("episodes"), assets: count("assets") } };
  } finally { db.close(); }
}

// Describe a directory without changing it. States:
// missing | empty | unrelated (non-Storybench files only) | initialized | legacy (prototype workspace) | newer | conflict
export function inspectDataRoot(dir) {
  const root = absoluteRoot(dir);
  if (!existsSync(root)) return { path: root, state: "missing" };
  if (!statSync(root).isDirectory()) return { path: root, state: "conflict", detail: "The data root path is not a directory" };
  const database = path.join(root, DATABASE_FILE);
  if (existsSync(database)) {
    let info;
    try { info = readDatabase(database); }
    catch (error) { return { path: root, state: "conflict", detail: `${DATABASE_FILE} is not a readable SQLite database: ${error.message}` }; }
    const base = { path: root, schemaVersion: info.version, counts: info.counts };
    if (info.version > SCHEMA_VERSION) return { ...base, state: "newer", detail: `Schema ${info.version} is newer than this release (${SCHEMA_VERSION})` };
    if (info.version >= 6 && info.identity)
      return { ...base, state: "initialized", identity: { id: info.identity.id, origin: info.identity.origin, defaultChannelId: info.identity.default_channel_id, createdAt: info.identity.created_at } };
    if (info.tables.has("episodes")) return { ...base, state: "legacy" };
    return { ...base, state: "conflict", detail: `${DATABASE_FILE} exists but is not a Storybench database` };
  }
  const entries = readdirSync(root);
  const markers = entries.filter((entry) => STORYBENCH_ENTRIES.has(entry));
  if (markers.length) return { path: root, state: "conflict", detail: `Storybench files exist without ${DATABASE_FILE}: ${markers.sort().join(", ")}` };
  return { path: root, state: entries.length ? "unrelated" : "empty" };
}

function summary(store, extra = {}) {
  return { dataRoot: store.workspace, identity: store.dataRootIdentity(), channels: store.listChannels(), ...extra };
}

// Explicitly initialize an empty (or new) data root. Repeating it on an initialized root changes nothing.
// Existing unrelated files are left untouched and never imported. Prototype workspaces must be adopted instead.
export function initDataRoot(dir) {
  const info = inspectDataRoot(dir);
  if (info.state === "initialized") return withDataRoot(info.path, (store) => summary(store, { created: false }));
  if (info.state === "legacy")
    throw new StoreError("This directory holds a Storybench prototype workspace; adopt it instead of initializing", 409, { dataRootState: info.state });
  if (info.state === "newer" || info.state === "conflict")
    throw new StoreError(`Refusing to initialize: ${info.detail}`, 409, { dataRootState: info.state });
  if (info.state === "missing") mkdirSync(info.path, { recursive: true });
  const store = new Store(info.path, { legacyWorkspace: false, origin: "init", startup: false });
  try { return summary(store, { created: true }); } finally { store.close(); }
}

// Validate the prototype workspace, take a consistent metadata backup, then migrate it in place into the first
// channel. IDs, recorded paths and media bytes are preserved; legacy files stay where they are. Adopting an
// already-adopted root is a no-op and never duplicates records.
export function adoptWorkspace(dir, { channelName = DEFAULT_CHANNEL_NAME } = {}) {
  const info = inspectDataRoot(dir);
  if (info.state === "initialized") return withDataRoot(info.path, (store) => summary(store, { adopted: false, alreadyAdopted: true }));
  if (info.state !== "legacy") {
    const reason = info.detail || (info.state === "missing" ? "the directory does not exist" : "no prototype workspace database was found");
    throw new StoreError(`Refusing to adopt: ${reason}`, 409, { dataRootState: info.state });
  }
  const database = path.join(info.path, DATABASE_FILE);
  const backupPath = path.join(info.path, "storybench.pre-v6.sqlite");
  const source = new DatabaseSync(database, { readOnly: true });
  try {
    const integrity = source.prepare("PRAGMA integrity_check").get();
    if (Object.values(integrity)[0] !== "ok") throw new StoreError("The workspace database failed its integrity check; it was not adopted", 409);
    // VACUUM INTO produces a transactionally consistent copy, including committed WAL content.
    if (!existsSync(backupPath)) source.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`);
  } finally { source.close(); }
  const backup = new DatabaseSync(backupPath, { readOnly: true });
  try {
    if (Object.values(backup.prepare("PRAGMA quick_check").get())[0] !== "ok") throw new StoreError("The metadata backup failed its integrity check; the workspace was not adopted", 500);
  } finally { backup.close(); }
  const store = new Store(info.path, { legacyWorkspace: false, firstChannelName: channelName, origin: "adopt", startup: false });
  try {
    if (!store.listChannels().length) store.createChannel(channelName);
    return summary(store, { adopted: true, backupPath, previousSchemaVersion: info.schemaVersion });
  } finally { store.close(); }
}

// Open an explicitly initialized or adopted data root. Never initializes or migrates a prototype implicitly.
// startup=false (the default here) skips server-only recovery such as failing interrupted jobs.
export function openDataRoot(dir, { startup = false, storeOptions = {} } = {}) {
  const info = inspectDataRoot(dir);
  if (info.state === "legacy")
    throw new StoreError("This directory holds a Storybench prototype workspace; adopt it first", 409, { dataRootState: info.state });
  if (info.state !== "initialized")
    throw new StoreError(`Not an initialized Storybench data root (${info.detail || info.state}); initialize it first`, 409, { dataRootState: info.state });
  return new Store(info.path, { ...storeOptions, legacyWorkspace: false, startup });
}

export function withDataRoot(dir, fn, options) {
  const store = openDataRoot(dir, options);
  try { return fn(store); } finally { store.close(); }
}
