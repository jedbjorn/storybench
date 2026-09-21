#!/usr/bin/env node
// Installed launcher target: `storybench` (see package.json "bin"). All behavior lives in src/cli.
import { main } from "../src/cli/main.js";

process.exitCode = await main(process.argv.slice(2));
