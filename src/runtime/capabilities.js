// What a worker request can actually do, derived only from what is wired: the tool
// definitions really served to this harness, the image-returning tools among them, and
// the media command versions verified in this release's worker image (release manifest).
// Nothing is advertised on assumption; unverified items say so.
const IMAGE_TOOLS = ["inspect_image", "inspect_contact_sheet"];
const HARNESS_IMAGE_ROUTE = {
  codex: "Storybench tool results as app-server inputImage content items",
  claude: "Storybench MCP tool results as image content blocks",
};
// Not provided by Storybench to either production harness in this release.
export const NOT_AVAILABLE = Object.freeze([
  "image generation services",
  "audio listening/understanding (metadata only via inspect_media)",
  "web browsing or external stock/publishing services",
  "direct database or managed-output writes (use the Storybench tools)",
]);

export function describeCapabilities({ scope, served, release = null }) {
  const names = served.map((definition) => definition.name);
  const imageTools = IMAGE_TOOLS.filter((name) => names.includes(name));
  const commands = release?.tools && typeof release.tools === "object"
    ? { verified: true, source: "release manifest (probed in the worker image)", versions: release.tools }
    : { verified: false, source: "no release manifest in this app; command availability is unverified" };
  return {
    harness: scope.harness,
    model: scope.model ?? null,
    tools: served.map((definition) => ({ name: definition.name, description: definition.description })),
    imageInput: imageTools.length
      ? { available: true, via: HARNESS_IMAGE_ROUTE[scope.harness] ?? "tool results", tools: imageTools }
      : { available: false, reason: "no image-returning tool is served in this request" },
    commandExecution: {
      available: true,
      workingDirectory: scope.episodeDir,
      writable: [scope.workDir, ...(scope.requestWorkDir ? [scope.requestWorkDir] : [])],
      readOnly: "all Storybench project directories (channels, legacy episodes/media/branding); the database is not visible",
      commands,
    },
    workArea: { episodeWork: scope.workDir, requestWork: scope.requestWorkDir ?? null },
    notAvailable: NOT_AVAILABLE,
  };
}
