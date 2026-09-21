#!/usr/bin/env node
// Installed launcher target: `storybench` (see package.json "bin"). The bootstrap entry is
// dependency-free so it works in a pristine clone before the staged release runs npm ci.
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

const args = process.argv.slice(2);
if (args[0] === "__install") {
  const { runInstallEntry } = await import("../src/cli/install-entry.js");
  process.exitCode = await runInstallEntry(args.slice(1));
} else {
  const { main } = await import("../src/cli/main.js");
  process.exitCode = await main(args);
}
