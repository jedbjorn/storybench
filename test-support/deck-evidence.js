// Fixed synthetic host-side receipts; real production checks run separately in image CI.
export function deckCheckFixture(role) {
  const svg = { role, checkVersion: 2, profile: 'storybench-svg-1', parser: true, nativeRasterInspection: true, invalidRejected: true,
    ...(role === 'worker' ? { authoringCommand: true } : { import: true, registration: true, reuse: true, imageTool: true, savedStaticExport: true, savedStagedExport: true, retainedZipSource: true }) };
  const route = { imageBlocks: true, delivered: true, presenter: true, mp4Playback: true, webmPlayback: true, stagedInteraction: true, contactSheet: true, evidenceRetained: true };
  return { role, checkVersion: 1, template: 'staged-svg-1', svg, ...(role === 'app' ? { browser: { checkVersion: 1, exactZip: true,
    browser: { controller: '1.63.0', revision: '1243', browserVersion: '153.0.8010.12', actualVersion: '153.0.8010.12' },
    routes: { codex: { ...route }, claude: { ...route }, opencode: { ...route } } } } : {}) };
}
