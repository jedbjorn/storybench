// A release directory is read and checked with its own runtime modules, so a fixture release
// carries the modules a real one does. `template` puts it on another deck template version.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RUNTIME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "runtime");

export function retemplate(file, template) {
  const source = readFileSync(file, "utf8");
  const changed = source.replace(/(DECK_TEMPLATE_VERSION = ')[^']+'/, `$1${template}'`);
  if (changed === source) throw new Error("deck-evidence.js no longer declares DECK_TEMPLATE_VERSION this way");
  writeFileSync(file, changed);
}

export function seedReleaseModules(directory, { template = null } = {}) {
  const target = path.join(directory, "src", "runtime");
  mkdirSync(target, { recursive: true });
  for (const name of ["manifest.js", "deck-evidence.js", "image-verification.js"])
    writeFileSync(path.join(target, name), readFileSync(path.join(RUNTIME, name)));
  if (template) retemplate(path.join(target, "deck-evidence.js"), template);
}
