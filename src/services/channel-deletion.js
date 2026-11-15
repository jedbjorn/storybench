import crypto from "node:crypto";
import { lstatSync, readdirSync, rmdirSync, unlinkSync, realpathSync } from "node:fs";
import path from "node:path";

// A deletion is accepted once for the whole batch. Its file inventory and target IDs survive a crash;
// retries only finish that accepted operation. The rows stay unavailable until cleanup completes.
export function createChannelDeletion(store, StoreError) {
  const db = store.db;
  const root = realpathSync(store.workspace);
  const allowedRoots = new Set(["channels", "episodes", "media", "branding", "cache", "exports"]);
  const missing = (error) => error?.code === "ENOENT";
  const placeholders = (ids) => ids.map(() => "?").join(",");
  const episodeIds = (ids) => `SELECT id FROM episodes WHERE channel_id IN (${placeholders(ids)})`;
  const conversationIds = (ids) => `SELECT id FROM conversations WHERE episode_id IN (${episodeIds(ids)})`;

  function location(relative) {
    if (typeof relative !== "string" || !relative || path.isAbsolute(relative) || relative.includes("\\"))
      throw new StoreError("A recorded channel file path is unsafe", 409);
    const parts = relative.split("/");
    if (!allowedRoots.has(parts[0]) || parts.some((part) => !part || part === "." || part === ".."))
      throw new StoreError(`A recorded channel file path is unsafe: ${relative}`, 409);
    let current = root, stat = null;
    for (const part of parts) {
      current = path.join(current, part);
      try { stat = lstatSync(current); }
      catch (error) { if (missing(error)) return { full: path.join(root, ...parts), stat: null }; throw error; }
      if (stat.isSymbolicLink()) throw new StoreError(`A recorded channel path uses a symbolic link: ${relative}`, 409);
    }
    return { full: current, stat };
  }

  function inventory(ids) {
    const files = new Map(), dirs = new Map();
    const addFile = (relative) => {
      if (!relative) return;
      const { stat } = location(relative);
      if (!stat) return;
      if (!stat.isFile()) throw new StoreError(`A recorded channel file is not a file: ${relative}`, 409);
      files.set(relative, { path: relative, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, inode: stat.ino });
    };
    const addDirectory = (relative) => {
      if (dirs.has(relative)) return;
      const { full, stat } = location(relative);
      if (!stat) return;
      if (!stat.isDirectory()) throw new StoreError(`A recorded channel directory is not a directory: ${relative}`, 409);
      for (const name of readdirSync(full).sort()) {
        const child = `${relative}/${name}`, childStat = location(child).stat;
        if (!childStat) throw new StoreError(`A channel file changed during review: ${child}`, 409);
        if (childStat.isDirectory()) addDirectory(child);
        else addFile(child);
      }
      dirs.set(relative, { path: relative });
    };
    const selected = db.prepare(`SELECT id,name,revision FROM channels WHERE id IN (${placeholders(ids)}) AND pending_delete_id IS NULL`).all(...ids);
    if (selected.length !== ids.length) throw new StoreError("A selected channel is missing or already being deleted. Refresh channels.", 409);
    const productions = db.prepare(`SELECT id,channel_id,directory FROM episodes WHERE channel_id IN (${placeholders(ids)})`).all(...ids);
    for (const channel of selected) addDirectory(`channels/${channel.id}`);
    for (const production of productions) {
      const expected = [`episodes/${production.id}`, `channels/${production.channel_id}/episodes/${production.id}`];
      if (!expected.includes(production.directory)) throw new StoreError("A production has an unsafe recorded directory", 409);
      if (production.directory.startsWith("episodes/")) addDirectory(production.directory);
    }
    const assets = db.prepare(`SELECT path,thumbnail_path FROM assets WHERE channel_id IN (${placeholders(ids)})`).all(...ids);
    for (const asset of assets) { addFile(asset.path); addFile(asset.thumbnail_path); }
    for (const table of ["library_items", "episode_library"]) {
      if (db.prepare(`SELECT 1 FROM ${table} l JOIN episodes e ON e.id=l.episode_id JOIN assets a ON a.id=l.asset_id
        WHERE a.channel_id IN (${placeholders(ids)}) AND e.channel_id NOT IN (${placeholders(ids)}) LIMIT 1`).get(...ids, ...ids))
        throw new StoreError("A retained production still uses media from a selected channel; remove that dependency first", 409);
    }
    const jobs = db.prepare(`SELECT output_path,sidecar_paths FROM jobs WHERE episode_id IN (${episodeIds(ids)})`).all(...ids);
    for (const job of jobs) {
      addFile(job.output_path);
      for (const sidecar of JSON.parse(job.sidecar_paths || "[]")) addFile(sidecar);
    }
    const filePaths = new Set(files.keys()), dirPaths = [...dirs.keys()];
    const survivingDirs = [
      ...db.prepare(`SELECT id FROM channels WHERE id NOT IN (${placeholders(ids)})`).all(...ids).map(({ id }) => `channels/${id}`),
      ...db.prepare(`SELECT directory FROM episodes WHERE channel_id NOT IN (${placeholders(ids)})`).all(...ids).map(({ directory }) => directory),
    ];
    for (const retainedDir of survivingDirs) {
      location(retainedDir);
      if ([...filePaths, ...dirPaths].some((candidate) => candidate === retainedDir ||
        candidate.startsWith(`${retainedDir}/`) || retainedDir.startsWith(`${candidate}/`)))
        throw new StoreError(`A retained channel or production owns ${retainedDir}; deletion cannot proceed`, 409);
    }
    const retainedAssets = db.prepare(`SELECT path,thumbnail_path FROM assets WHERE channel_id NOT IN (${placeholders(ids)})`).all(...ids);
    const retainedJobs = db.prepare(`SELECT j.output_path,j.sidecar_paths FROM jobs j JOIN episodes e ON e.id=j.episode_id WHERE e.channel_id NOT IN (${placeholders(ids)})`).all(...ids);
    const retained = retainedAssets.flatMap((item) => [item.path, item.thumbnail_path]).concat(
      retainedJobs.flatMap((item) => [item.output_path, ...JSON.parse(item.sidecar_paths || "[]")]));
    for (const value of retained.filter(Boolean)) {
      const relative = String(value);
      location(relative);
      if (filePaths.has(relative) || dirPaths.some((dir) => relative === dir || relative.startsWith(`${dir}/`)))
        throw new StoreError(`A retained production still uses ${relative}; deletion cannot proceed`, 409);
    }
    return { root, files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)), dirs: [...dirs.values()],
      productionCount: productions.length };
  }

  function contentToken(ids, manifest) {
    const digest = crypto.createHash("sha256");
    const ep = episodeIds(ids), conv = conversationIds(ids), chosen = placeholders(ids);
    const queries = [
      ["channels", `SELECT id,name,revision FROM channels WHERE id IN (${chosen})`],
      ...["episodes", "assets", "branding_templates", "channel_standards"].map((table) =>
        [table, `SELECT * FROM ${table} WHERE channel_id IN (${chosen})`]),
      ...["episode_history", "stories", "story_sections", "story_history", "episode_library", "library_items", "graphic_recipes", "final_authorizations", "jobs", "conversations", "reference_directions"].map((table) =>
        [table, `SELECT * FROM ${table} WHERE episode_id IN (${ep})`]),
      ["graphic_recipe_revisions", `SELECT * FROM graphic_recipe_revisions WHERE recipe_id IN (SELECT id FROM graphic_recipes WHERE episode_id IN (${ep}))`],
      ["output_designations", `SELECT * FROM output_designations WHERE job_id IN (SELECT id FROM jobs WHERE episode_id IN (${ep}))`],
      ...["conversation_messages", "conversation_events", "conversation_segments"].map((table) =>
        [table, `SELECT * FROM ${table} WHERE conversation_id IN (${conv})`]),
      ["production_runs", `SELECT * FROM production_runs WHERE episode_id IN (${ep})`],
    ];
    for (const table of ["chats", "chat_messages", "chat_events"])
      if (store.tableExists(table)) queries.push([table, `SELECT * FROM ${table} WHERE episode_id IN (${ep})`]);
    for (const [table, sql] of queries) {
      digest.update(table);
      const rows = db.prepare(sql).all(...ids);
      rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      for (const row of rows) digest.update(JSON.stringify(row));
    }
    digest.update(JSON.stringify(manifest));
    return digest.digest("hex");
  }

  function inspect(channelIds) {
    if (!Array.isArray(channelIds) || !channelIds.length || channelIds.length > 100 ||
      channelIds.some((id) => typeof id !== "string" || !/^channel_[0-9a-f-]{36}$/.test(id)) ||
      new Set(channelIds).size !== channelIds.length)
      throw new StoreError("Select one to 100 distinct channels by ID", 400);
    const ids = [...channelIds].sort(), manifest = inventory(ids);
    const channels = db.prepare(`SELECT id,name,revision FROM channels WHERE id IN (${placeholders(ids)}) ORDER BY name,id`).all(...ids);
    const survivors = store.listChannels().filter((channel) => !ids.includes(channel.id));
    const currentDefaultId = store.getDefaultChannel()?.id ?? null;
    const fallbackChannelId = currentDefaultId && !ids.includes(currentDefaultId) ? currentDefaultId : survivors[0]?.id ?? null;
    return { channelIds: ids, channels, productionCount: manifest.productionCount, token: contentToken(ids, manifest),
      fallbackChannelId, currentDefaultId, manifest };
  }
  function preview(channelIds) {
    const { manifest, ...visible } = inspect(channelIds);
    return visible;
  }
  function status(operationId) {
    const row = db.prepare("SELECT * FROM channel_deletions WHERE id=?").get(operationId);
    if (!row) throw new StoreError("Channel deletion not found", 404);
    return { id: row.id, state: row.state, error: row.error, channelIds: JSON.parse(row.channel_ids),
      channels: JSON.parse(row.manifest).channels ?? [],
      fallbackChannelId: row.fallback_channel_id, createdAt: row.created_at, updatedAt: row.updated_at };
  }
  function list() {
    return db.prepare("SELECT id FROM channel_deletions WHERE state='pending' ORDER BY created_at,id").all().map(({ id }) => status(id));
  }
  function finish(operationId) {
    const row = db.prepare("SELECT * FROM channel_deletions WHERE id=?").get(operationId);
    if (!row) throw new StoreError("Channel deletion not found", 404);
    if (row.state === "completed") return status(operationId);
    const ids = JSON.parse(row.channel_ids), manifest = JSON.parse(row.manifest);
    try {
      if (realpathSync(store.workspace) !== manifest.root) throw new StoreError("Data root moved during channel deletion", 409);
      for (const file of manifest.files) {
        const { full, stat } = location(file.path);
        if (!stat) continue;
        if (!stat.isFile() || stat.size !== file.size || stat.mtimeMs !== file.mtimeMs ||
          stat.ctimeMs !== file.ctimeMs || stat.ino !== file.inode)
          throw new StoreError(`A channel file changed during deletion: ${file.path}`, 409);
        unlinkSync(full);
        store.afterChannelDeleteFile?.(file.path);
      }
      for (const dir of manifest.dirs) {
        const { full, stat } = location(dir.path);
        if (!stat) continue;
        if (!stat.isDirectory()) throw new StoreError(`A channel directory changed during deletion: ${dir.path}`, 409);
        rmdirSync(full);
      }
      const chosen = placeholders(ids), ep = episodeIds(ids);
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(`DELETE FROM production_runs WHERE episode_id IN (${ep})`).run(...ids);
        db.prepare(`DELETE FROM conversations WHERE episode_id IN (${ep})`).run(...ids);
        db.prepare(`DELETE FROM jobs WHERE episode_id IN (${ep})`).run(...ids);
        for (const table of ["episode_history", "story_history", "chat_events", "chat_messages", "chats"])
          if (store.tableExists(table)) db.prepare(`DELETE FROM ${table} WHERE episode_id IN (${ep})`).run(...ids);
        db.prepare(`DELETE FROM episodes WHERE channel_id IN (${chosen})`).run(...ids);
        for (const table of ["branding_templates", "channel_standards", "assets"])
          db.prepare(`DELETE FROM ${table} WHERE channel_id IN (${chosen})`).run(...ids);
        db.prepare(`DELETE FROM channels WHERE id IN (${chosen}) AND pending_delete_id=?`).run(...ids, operationId);
        const violations = db.prepare("PRAGMA foreign_key_check").all();
        if (violations.length) throw new StoreError(`Channel deletion would leave ${violations.length} broken database references`, 500);
        db.prepare("UPDATE channel_deletions SET state='completed',manifest='{}',error=NULL,updated_at=? WHERE id=?").run(new Date().toISOString(), operationId);
        db.exec("COMMIT");
      } catch (error) { if (db.isTransaction) db.exec("ROLLBACK"); throw error; }
    } catch (error) {
      db.prepare("UPDATE channel_deletions SET error=?,updated_at=? WHERE id=?")
        .run(error.message || String(error), new Date().toISOString(), operationId);
    }
    return status(operationId);
  }
  function accept(input, busyReason = () => null) {
    const { channelIds, token, operationId } = input ?? {};
    if (typeof operationId !== "string" || !/^delete_[0-9a-f-]{36}$/.test(operationId))
      throw new StoreError("A unique deletion operation ID is required", 400);
    const existing = db.prepare("SELECT channel_ids,token,state FROM channel_deletions WHERE id=?").get(operationId);
    if (existing) {
      if (!Array.isArray(channelIds) || JSON.stringify([...channelIds].sort()) !== existing.channel_ids || token !== existing.token)
        throw new StoreError("Deletion operation ID was already used for different channels", 409);
      if (existing.state === "pending") {
        const reason = databaseBusyReason(operationId) || busyReason();
        if (reason) throw new StoreError(reason, 409);
      }
      return finish(operationId);
    }
    const reason = databaseBusyReason() || busyReason();
    if (reason) throw new StoreError(reason, 409);
    db.exec("BEGIN IMMEDIATE");
    try {
      const reviewed = inspect(channelIds);
      if (typeof token !== "string" || token !== reviewed.token)
        throw new StoreError("Channels changed since confirmation. Review them again before deleting.", 409);
      const reasonNow = databaseBusyReason() || busyReason();
      if (reasonNow) throw new StoreError(reasonNow, 409);
      const fallback = reviewed.fallbackChannelId;
      const stamp = new Date().toISOString();
      db.prepare("INSERT INTO channel_deletions(id,channel_ids,token,manifest,state,error,fallback_channel_id,created_at,updated_at) VALUES(?,?,?,?, 'pending',NULL,?,?,?)")
        .run(operationId, JSON.stringify(reviewed.channelIds), token,
          JSON.stringify({ ...reviewed.manifest, channels: reviewed.channels.map(({ id, name }) => ({ id, name })) }), fallback, stamp, stamp);
      const changed = db.prepare(`UPDATE channels SET pending_delete_id=? WHERE id IN (${placeholders(reviewed.channelIds)}) AND pending_delete_id IS NULL`)
        .run(operationId, ...reviewed.channelIds);
      if (changed.changes !== reviewed.channelIds.length) throw new StoreError("Channels changed before deletion could begin", 409);
      if (reviewed.currentDefaultId && reviewed.channelIds.includes(reviewed.currentDefaultId))
        db.prepare("UPDATE data_root SET default_channel_id=?,updated_at=? WHERE singleton=1").run(fallback, stamp);
      db.exec("COMMIT");
    } catch (error) { if (db.isTransaction) db.exec("ROLLBACK"); throw error; }
    store.afterChannelDeleteAccepted?.(operationId);
    return finish(operationId);
  }
  function recover() {
    if (databaseBusyReason(null, false)) return;
    for (const { id } of db.prepare("SELECT id FROM channel_deletions WHERE state='pending' ORDER BY created_at,id").all()) finish(id);
  }
  function databaseBusyReason(exceptOperationId = null, checkPending = true) {
    if (checkPending && db.prepare("SELECT 1 FROM channel_deletions WHERE state='pending' AND id<>? LIMIT 1").get(exceptOperationId ?? ""))
      return "Another channel deletion is pending. Finish or retry it before deleting more channels.";
    if (db.prepare("SELECT 1 FROM jobs WHERE state IN ('queued','running','cancelling') LIMIT 1").get())
      return "Production work is active. Let it finish or cancel it before deleting channels.";
    if (db.prepare("SELECT 1 FROM conversations WHERE state IN ('queued','running','interrupting') LIMIT 1").get() ||
      db.prepare("SELECT 1 FROM production_runs WHERE state IN ('starting','running') LIMIT 1").get())
      return "An agent turn is active. Let it finish and its worker stop before deleting channels.";
    return null;
  }
  return { preview, accept, status, list, finish, recover };
}
