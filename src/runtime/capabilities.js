// What a worker request can actually do, derived only from what is wired: the tool
// definitions really served to this harness, the image-returning tools among them, and
// the media command versions verified in this release's worker image (release manifest).
// Nothing is advertised on assumption; unverified items say so.
const IMAGE_TOOLS = ["inspect_image", "inspect_contact_sheet"];
// Both harnesses receive Storybench tools over the request's MCP bridge. Image routes are
// advertised as verified only after the repeatable nonce proof (scripts/image-receipt-proof.mjs:
// both harnesses must echo random text drawn in fresh images, 5/5). Codex 0.155.1 production
// models run tools in code mode: an MCP result's image blocks are forwarded with image(...);
// the earlier app-server dynamic-tool route flattened results to a string and was unreliable.
const HARNESS_IMAGE_ROUTE = {
  codex: { via: "Storybench MCP tool results as image content blocks (forwarded by Codex code mode with image())", verified: true, evidence: "scripts/image-receipt-proof.mjs 5/5 (gpt-5.6-terra)" },
  claude: { via: "Storybench MCP tool results as image content blocks", verified: true, evidence: "scripts/image-receipt-proof.mjs 5/5 (sonnet)" },
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
    imageInput: !imageTools.length ? { available: false, reason: "no image-returning tool is served in this request" }
      : HARNESS_IMAGE_ROUTE[scope.harness]?.verified
        ? { available: true, verified: true, via: HARNESS_IMAGE_ROUTE[scope.harness].via, evidence: HARNESS_IMAGE_ROUTE[scope.harness].evidence, tools: imageTools }
        : { available: false, verified: false, reason: `image delivery to ${scope.harness} is unverified`, tools: imageTools },
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
