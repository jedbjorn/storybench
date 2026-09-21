// Offline metadata backup/restore entry point executed inside the exact selected app
// image. Only the database and one empty backup directory are mounted by the host CLI;
// media is never copied or mounted separately.
import { closeSync, copyFileSync, constants, existsSync, fsyncSync, lstatSync, openSync, renameSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

function sqliteLiteral(value) { return `'${value.replaceAll("'", "''")}'`; }

function regularAbsolute(file, label, { mayNotExist = false } = {}) {
  if (!path.isAbsolute(file) || path.normalize(file) !== file) throw new Error(`${label} must be a normalized absolute path`);
  if (mayNotExist && !existsSync(file)) return file;
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
  return file;
}

function inspectDatabase(file) {
  const db = new DatabaseSync(regularAbsolute(file, "Database"), { readOnly: true });
  try {
    const integrity = Object.values(db.prepare("PRAGMA quick_check").get())[0];
    if (integrity !== "ok") throw new Error(`database integrity check failed: ${integrity}`);
    const schema = Number(db.prepare("PRAGMA user_version").get().user_version);
    const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='data_root'").get();
    const identity = table ? db.prepare("SELECT id FROM data_root WHERE singleton=1").get()?.id ?? null : null;
    return { schema, identity };
  } finally { db.close(); }
}

export function backupDatabase(source, destination) {
  regularAbsolute(source, "Source database");
  regularAbsolute(destination, "Backup destination", { mayNotExist: true });
  if (existsSync(destination)) throw new Error("Backup destination already exists");
  const sourceDb = new DatabaseSync(source, { readOnly: true });
  try { sourceDb.exec(`VACUUM INTO ${sqliteLiteral(destination)}`); } finally { sourceDb.close(); }
  return inspectDatabase(destination);
}

export function restoreDatabase(source, destination) {
  const info = inspectDatabase(source);
  regularAbsolute(destination, "Database destination", { mayNotExist: true });
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${process.pid}.restore.tmp`);
  rmSync(temporary, { force: true });
  try {
    copyFileSync(source, temporary, constants.COPYFILE_EXCL);
    const descriptor = openSync(temporary, "r+");
    try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
    // The service is stopped before restore. Removing stale sidecars before the atomic
    // database replacement prevents replaying pages from the failed release.
    rmSync(`${destination}-wal`, { force: true });
    rmSync(`${destination}-shm`, { force: true });
    renameSync(temporary, destination);
    const directory = openSync(path.dirname(destination), "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } catch (error) { rmSync(temporary, { force: true }); throw error; }
  return info;
}

function main(argv) {
  const [operation, source, destination, ...extra] = argv;
  if (extra.length || !source || !destination || !["backup", "restore"].includes(operation))
    throw new Error("Usage: backup-image.js backup|restore SOURCE DESTINATION");
  const result = operation === "backup" ? backupDatabase(source, destination) : restoreDatabase(source, destination);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`storybench metadata ${process.argv[2] || "operation"}: ${error.message}\n`); process.exitCode = 1; }
}
