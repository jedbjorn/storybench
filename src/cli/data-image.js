// Narrow data-command entry point for the selected app image. The host mounts exactly one data root at the fixed
// location and receives one JSON envelope; no configuration, credentials, network, or host paths enter the image.
import { pathToFileURL } from "node:url";
import { StoreError } from "../store.js";
import { adoptWorkspace, initDataRoot, inspectDataRoot, withDataRoot } from "../services/data-root.js";
import { createChannel, getDefaultChannel, listChannels, useChannel } from "../services/channels.js";
import { CliError, EXIT } from "./errors.js";
import { assertCurrentSchema } from "./executor.js";

export const DATA_IMAGE_ROOT = "/storybench/data";
export const DATA_IMAGE_SCHEMA = "storybench.data-command/1";
const OPERATIONS = new Set(["init", "adopt", "channel-create", "channel-list", "channel-current", "channel-use"]);

export function executeDataCommand(operation, args = [], dataRoot = DATA_IMAGE_ROOT) {
  if (!OPERATIONS.has(operation)) throw new CliError(`Unknown image data operation: ${operation}`, { exitCode: EXIT.USAGE });
  if (operation === "init") return initDataRoot(dataRoot);
  if (operation === "adopt") return adoptWorkspace(dataRoot, { channelName: args.length ? args[0] : undefined });
  assertCurrentSchema(inspectDataRoot(dataRoot), dataRoot);
  return withDataRoot(dataRoot, (store) => {
    if (operation === "channel-create") return createChannel(store, args[0]);
    if (operation === "channel-list") return listChannels(store);
    if (operation === "channel-current") return getDefaultChannel(store);
    return useChannel(store, args[0]);
  }, { startup: false });
}

function serializedError(error) {
  const known = error instanceof StoreError || error instanceof CliError;
  return {
    message: known ? error.message : "The selected app image could not complete the data command",
    exitCode: error instanceof CliError ? error.exitCode : EXIT.FAILED,
    statusCode: Number.isInteger(error.statusCode) ? error.statusCode : null,
    hint: error instanceof CliError ? error.hint : null,
  };
}

export function runDataImage(argv = process.argv.slice(2), write = (value) => process.stdout.write(value)) {
  const [operation, ...args] = argv;
  try {
    const result = executeDataCommand(operation, args);
    write(`${JSON.stringify({ schema: DATA_IMAGE_SCHEMA, ok: true, result })}\n`);
    return EXIT.OK;
  } catch (error) {
    write(`${JSON.stringify({ schema: DATA_IMAGE_SCHEMA, ok: false, error: serializedError(error) })}\n`);
    return error instanceof CliError ? error.exitCode : EXIT.FAILED;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = runDataImage();
