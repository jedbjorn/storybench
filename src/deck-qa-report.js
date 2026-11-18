// Self-QA is evidence for an exact output, separate from successful ZIP creation.
// Image delivery proves transport; explicit model assessments supply visual judgment.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { readDeckBundle } from './deck-qa-bundle.js';

const key = state => JSON.stringify([state.slideId, state.stage, state.gallery, state.viewport, state.emulation]);
const screen = state => state.emulation?.media === 'screen' && state.emulation?.reducedMotion === 'no-preference';
const page = state => state.pageId === 'audience' ? 'audience' : 'presenter';
const normal = v => v.width >= 1200 && v.height >= 700, constrained = v => v.width <= 1000 && v.height <= 800;
// As the runtime reads a stage: an explicit trigger decides, otherwise a positive delay is automatic.
const automatic = stage => stage.trigger ? stage.trigger === 'auto' : stage.afterMs > 0;
// A slide whose stages play on their own or move geometry; a manual fade is fully shown by its end state.
const moves = slide => slide.stages.some(stage => automatic(stage) || ['draw', 'enter'].includes(stage.motion) || stage.changes?.length);
const text = (value, name, max = 2000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid QA ${name}`);
  return value;
};

export function recordReview(record, args) {
  const summary = text(args.summary, 'summary');
  if (!Array.isArray(args.reviews) || args.reviews.length > 120) throw new Error('QA reviews must contain at most 120 image assessments');
  if (!Array.isArray(args.changesMade) || args.changesMade.length > 40) throw new Error('QA changesMade must be an array of at most 40 changes');
  const changesMade = args.changesMade.map(v => text(v, 'change'));
  const reviews = args.reviews.map(review => {
    const shot = [...record.screenshots, ...(record.filmstrips ?? [])].find(s => s.artifactId === review.artifactId);
    if (!shot?.delivered) throw new Error('Review requires an image delivered in this session; inspect it through the model image route first');
    const assessment = text(review.assessment, 'image assessment');
    if (!Array.isArray(review.findings) || review.findings.length > 20) throw new Error('QA findings must be an array of at most 20 findings');
    const findings = review.findings.map(f => {
      if (!['blocking', 'advisory'].includes(f.severity)) throw new Error('QA finding severity must be blocking or advisory');
      return { severity: f.severity, description: text(f.description, 'finding') };
    });
    if (record.reviews.some(r => r.artifactId === shot.artifactId)) throw new Error('Image already reviewed; inspect again to record a new assessment');
    return { artifactId: shot.artifactId, assessment, findings, at: new Date().toISOString() };
  });
  if (new Set(reviews.map(r => r.artifactId)).size !== reviews.length) throw new Error('Duplicate image assessment');
  record.reviews.push(...reviews);
  record.summary = summary;
  record.changesMade = [...new Set([...record.changesMade, ...changesMade])];
  record.reviewedAt = new Date().toISOString();
}

export async function readQaSessions(parent) {
  const dir = path.join(parent, 'qa');
  const entries = await readdir(dir, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const records = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(dir, entry.name, 'session.json');
    // All paths are app-owned. Refuse replaced evidence rather than following links.
    if (await realpath(file) !== file) throw new Error('Unsafe QA evidence path');
    records.push(JSON.parse(await readFile(file, 'utf8')));
  }
  return records.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

// Only the request-owned report operation can vouch for a live open session.
const usableLifecycle = (record, activeSession) => record.lifecycle === 'closed' ||
  (record.lifecycle === 'open' && activeSession?.sessionId && activeSession?.requestId &&
    record.sessionId === activeSession.sessionId && record.requestId === activeSession.requestId);

export function evaluateQa(job, records, activeSession) {
  const missing = new Set();
  const usable = records.filter(r => r.bundleSha256 === job.snapshot.bundleSha256 && r.sourceRevision === job.revision &&
    usableLifecycle(r, activeSession));
  const shots = usable.flatMap(r => r.screenshots.filter(s => s.delivered).map(s => ({ ...s,
    review: r.reviews?.find(v => v.artifactId === s.artifactId), artifactRoot: r.artifactRoot })));
  const reviewed = shots.filter(s => s.review && s.fullResolutionDelivered && !s.clip);
  // A filmstrip is one reviewed image of a slide at several times; a single time shows no motion.
  const strips = usable.flatMap(r => (r.filmstrips ?? []).filter(f => f.delivered).map(f => ({ ...f,
    review: r.reviews?.find(v => v.artifactId === f.artifactId), artifactRoot: r.artifactRoot }))).filter(f => f.review);
  // Sessions can overlap. Compare observation time, then session identity and
  // in-session order for equal timestamps, independently of batch start order.
  const checks = usable.flatMap(r => r.checks.map((check, index) => ({ check, sessionId: r.sessionId, index })))
    .sort((a, b) => (Date.parse(a.check.at) || 0) - (Date.parse(b.check.at) || 0) ||
      a.sessionId.localeCompare(b.sessionId) || a.index - b.index)
    .map(entry => entry.check);
  const actions = usable.flatMap(r => r.actions);
  const viewports = [...new Map(reviewed.filter(s => screen(s.state)).map(s => [JSON.stringify(s.state.viewport), s.state.viewport])).values()];
  if (!viewports.some(normal)) missing.add('normal viewport (at least 1200x700)');
  if (!viewports.some(constrained)) missing.add('constrained viewport (at most 1000x800)');
  if (!usable.some(r => r.summary)) missing.add('visual/narrative summary');
  if (usable.some(r => r.errors.length)) missing.add('browser console/resource errors');
  const findings = [...shots, ...strips].flatMap(s => (s.review?.findings ?? []).map(f => ({ ...f, artifactId: s.artifactId, state: s.state })));
  if (findings.some(f => f.severity === 'blocking')) missing.add('unresolved blocking visual findings (correct and rebuild)');
  const latestCheck = (state, name) => checks.filter(c => c.state.pageId === 'audience' && key(c.state) === key(state) && c.results[name]).at(-1)?.results[name];
  const hasAction = predicate => actions.some(predicate);
  const requireAction = (name, predicate) => { if (!hasAction(predicate)) missing.add(name); };
  requireAction('audience navigation', a => a.pageId === 'audience' && a.action === 'click' && /data-go|#next|#previous/.test(a.selector ?? ''));
  requireAction('keyboard navigation', a => a.pageId === 'audience' && a.action === 'key' && /Arrow|Home|End/.test(a.key));
  requireAction('presenter navigation', a => a.pageId !== 'audience' && a.action === 'select' && a.selector === '#slide-select');
  requireAction('presenter disconnect recovery', a => a.action === 'close-page');
  if (actions.filter(a => a.action === 'click' && a.selector === '#presenter-open').length < 2) missing.add('presenter reopen');
  if (!checks.some(c => c.results.fullscreen?.status === 'pass')) missing.add('actual fullscreen entry');
  const entered = actions.findIndex(a => a.state.fullscreen);
  if (entered < 0 || !actions.slice(entered + 1).some(a => a.pageId === 'audience' && !a.state.fullscreen)) missing.add('fullscreen exit');
  for (const slide of job.snapshot.slides) {
    const stages = slide.stages.length ? slide.stages.map((_, i) => [String(i)]) : [[]];
    // Timed first reveals also have a genuine pre-reveal state.
    if (slide.stages[0]?.afterMs > 0 && automatic(slide.stages[0])) stages.unshift([]);
    const galleries = slide.subnav.length ? slide.subnav.map((_, i) => [String(i)]) : [[]];
    for (const viewport of viewports) for (const stage of stages) for (const gallery of galleries) {
      const state = { slideId: slide.id, stage, gallery, viewport, emulation: { media: 'screen', reducedMotion: 'no-preference' } };
      for (const target of ['audience', 'presenter']) {
        if (!reviewed.some(s => page(s.state) === target && key(s.state) === key(state))) missing.add(`${slide.id}: ${target} image review ${JSON.stringify([stage, gallery, viewport])}`);
      }
      for (const name of ['console', 'resources', 'fonts', 'layout', 'presenter']) {
        if (latestCheck(state, name)?.status !== 'pass') missing.add(`${slide.id}: ${name} check ${JSON.stringify([stage, gallery, viewport])}`);
      }
      const itemId = slide.subnav.length ? slide.subnav[Number(gallery[0])]?.itemId : slide.media?.itemId;
      if (job.snapshot.library.find(i => i.id === itemId)?.asset.kind === 'video') {
        if (latestCheck(state, 'media')?.status !== 'pass') missing.add(`${slide.id}: advancing media ${JSON.stringify([gallery, viewport])}`);
        requireAction(`${slide.id}: presenter media control ${JSON.stringify([stage, gallery, viewport])}`, a =>
          /^presenter-\d+$/.test(a.pageId) && key(a.state) === key(state) && a.action === 'click' &&
          /^\[data-command=(["']?)(video-toggle|video-restart)\1\]$/.test(a.selector ?? ''));
      }
    }
    for (const mode of ['print', 'reduce']) {
      if (!reviewed.some(s => s.state.pageId === 'audience' && s.state.slideId === slide.id &&
          (mode === 'print' ? s.state.emulation?.media === 'print' : s.state.emulation?.media === 'screen' && s.state.emulation?.reducedMotion === 'reduce')))
        missing.add(`${slide.id}: ${mode} image review`);
    }
    if (slide.stages.length) {
      requireAction(`${slide.id}: replay`, a => a.state.slideId === slide.id && a.action === 'click' && /replay/.test(a.selector ?? ''));
      requireAction(`${slide.id}: manual stage selection`, a => a.state.slideId === slide.id &&
        ((a.action === 'click' && /\[data-stage(?:=|\])/.test(a.selector ?? '')) ||
          (a.action === 'select' && a.selector === '#stage-select')));
      if (slide.stages.some(s => s.afterMs > 0)) requireAction(`${slide.id}: reveal timing`, a => a.state.slideId === slide.id && a.action === 'wait' && a.state.stage.includes(String(slide.stages.length - 1)));
    }
    // End-state screenshots cannot show motion: it needs frames at both viewport classes and a real-time run.
    if (moves(slide)) {
      for (const [name, fits] of [['normal', normal], ['constrained', constrained]]) {
        if (!strips.some(f => f.state.slideId === slide.id && screen(f.state) && fits(f.state.viewport) && new Set(f.frames.map(frame => frame.timeMs)).size > 1))
          missing.add(`${slide.id}: motion filmstrip review (${name} viewport, at least two times)`);
      }
      if (checks.filter(c => c.state.slideId === slide.id && c.results.motion).at(-1)?.results.motion.status !== 'pass') missing.add(`${slide.id}: motion check`);
    }
    if (slide.subnav.length) requireAction(`${slide.id}: gallery navigation`, a => a.state.slideId === slide.id &&
      a.action === 'click' && /\[data-gallery(?:=|\])/.test(a.selector ?? ''));
  }
  return { qaStatus: missing.size ? 'incomplete' : 'complete', missing: [...missing], viewports, findings,
    reviewedImages: reviewed.map(s => ({ artifactId: s.artifactId, sha256: s.sha256, path: `${s.artifactRoot}/${s.file}`, state: s.state, review: s.review })),
    reviewedFilmstrips: strips.map(f => ({ artifactId: f.artifactId, sha256: f.sha256, path: `${f.artifactRoot}/${f.file}`, state: f.state, frames: f.frames, review: f.review })),
    sessions: records.map(r => ({ sessionId: r.sessionId, lifecycle: r.lifecycle, artifactRoot: r.artifactRoot, browser: r.browser,
      summary: r.summary, changesMade: r.changesMade, reviewedAt: r.reviewedAt })),
    coverage: usable.flatMap(r => r.coverage), checks, limitations: ['Model self-QA; creator aesthetic judgment and physical displays remain unverified.'] };
}

export async function getQaReport(store, episodeId, jobId, activeSession) {
  const build = await readDeckBundle(store, episodeId, jobId);
  const records = await readQaSessions(build.parent);
  const report = evaluateQa(build.job, records, activeSession);
  if (records.length && !usableLifecycle(records.at(-1), activeSession)) {
    report.qaStatus='incomplete'; report.missing.push('latest QA session not explicitly closed or currently active (interrupted or unverified)');
  }
  // Never trust the historical qaStatus in a session file as current delivery status.
  const latest = store.listJobs(episodeId).find(j => j.kind === 'deck' && j.state === 'completed');
  const stale = store.getDeck(episodeId).revision !== build.sourceRevision || latest?.id !== jobId ||
    JSON.stringify(store.getBrandStandards(store.getDeck(episodeId).channelId).fonts) !== JSON.stringify(build.job.snapshot.fonts);
  if (stale) { report.qaStatus = 'incomplete'; report.missing.push('stale build: saved revision, fonts or latest completed output changed'); }
  // Missing screenshots cannot turn historical review statements into current proof.
  for (const image of [...report.reviewedImages, ...report.reviewedFilmstrips]) {
    const file = path.join(store.workspace, image.path);
    try {
      if (await realpath(file) !== file || createHash('sha256').update(await readFile(file)).digest('hex') !== image.sha256) throw new Error('missing image');
    } catch { report.qaStatus = 'incomplete'; report.missing.push(`missing screenshot: ${image.artifactId}`); }
  }
  return { jobId, bundleSha256: build.bundleSha256, sourceRevision: build.sourceRevision, stale,
    evaluatedAt: new Date().toISOString(), ...report };
}
