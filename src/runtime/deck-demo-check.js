// Repeatable synthetic delivery from editable saved state through production tools.
// Scripted image receipts/DOM assertions are automated evidence, not model aesthetics.
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Store } from '../store.js';
import { createDemo } from '../deck-demo.js';
import { createDeckService } from '../deck-service.js';
import { HeavyJobQueue } from '../job-runner.js';
import { createScopedTools } from './tools.js';
import { bridgeClient } from './browser-check.js';

export async function checkDemoDelivery(destination) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sb-demo-delivery-'));
  const store = new Store(root), queue = new HeavyJobQueue(), decks = createDeckService({ store, queue });
  let client, closed = false;
  try {
    const deck = await createDemo(store);
    const pending = decks.enqueue({ episodeId: deck.id, expectedRevision: deck.revision });
    await queue.draining;
    const job = decks.getJob(deck.id, pending.id);
    assert.equal(job.state, 'completed', job.error);
    const scope = { episodeId: deck.id, channelId: deck.channelId, requestId: 'demo-delivery', conversationId: 'demo-delivery',
      harness: 'codex', model: 'scripted-image-client', dataRoot: root, episodeDir: store.episodeDirectory(deck.id), workDir: store.episodeWorkDirectory(deck.id) };
    client = await bridgeClient(root, createScopedTools(scope, { store }), 'codex');
    const call = async (name, args = {}) => (await client.call(name, args)).data;
    const opened = await call('open_deck_qa', { jobId: job.id }), sessionId = opened.sessionId;
    const act = args => call('act_deck_qa', { sessionId, ...args });
    const check = checks => call('check_deck_qa', { sessionId, checks });
    const replay = async slide => {
      assert.ok(slide.stages.slice(1).every(stage => stage.afterMs > 0), 'Every later demo stage must advance automatically');
      await act({ action: 'click', selector: `#${slide.id} [data-command="replay"]` });
      let remaining = slide.stages.reduce((sum, stage) => sum + (stage.afterMs ?? 0), 0) + 250;
      let result;
      while (remaining > 0) {
        const milliseconds = Math.min(2000, remaining);
        result = await act({ action: 'wait', milliseconds });
        remaining -= milliseconds;
      }
      assert.deepEqual(result.state.stage, [String(slide.stages.length - 1)], 'Replay must reach the final stage before manual takeover');
    };
    const reviews = [];
    const inspect = async (pageId = 'audience') => {
      const response = await client.call('inspect_deck_qa', { sessionId, pageId });
      assert.ok(response.content.some(c => c.type === 'image' && Buffer.from(c.data, 'base64').length > 5000));
      const shot = response.data.screenshots[0];
      reviews.push({ artifactId: shot.artifactId, assessment: `Automated image receipt and state assertions for ${shot.state.slideId}/${pageId}. Final visual and narrative judgment pending FnB verification.`, findings: [] });
      return shot.state;
    };
    await act({ action: 'click', selector: '[data-go="0"]' });
    await act({ action: 'key', key: 'Home' });
    await act({ action: 'click', selector: '#presenter-open' });
    await act({ action: 'wait', milliseconds: 100 });
    await act({ pageId: 'presenter-1', action: 'close-page' });
    await act({ action: 'click', selector: '#presenter-open' });
    await act({ action: 'wait', milliseconds: 100 });
    const presenter = 'presenter-2';
    await act({ action: 'click', selector: '#fullscreen' });
    assert.equal((await check(['fullscreen'])).results.fullscreen.status, 'pass');
    await act({ action: 'click', selector: '#fullscreen' });
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1000, height: 800 }]) {
      await act({ action: 'resize', viewport });
      await act({ pageId: presenter, action: 'resize', viewport });
      for (const [index, slide] of deck.slides.entries()) {
        await act({ pageId: presenter, action: 'select', selector: '#slide-select', value: String(index) });
        if (slide.stages.length) await replay(slide);
        for (let stage = 0; stage < Math.max(1, slide.stages.length); stage++) {
          if (slide.stages.length) await act({ pageId: presenter, action: 'select', selector: '#stage-select', value: String(stage) });
          for (let gallery = 0; gallery < Math.max(1, slide.subnav.length); gallery++) {
            if (slide.subnav.length) await act({ action: 'click', selector: `#${slide.id} [data-gallery="${gallery}"]` });
            const itemId = slide.subnav.length ? slide.subnav[gallery].itemId : slide.media?.itemId;
            const media = job.snapshot.library.find(item => item.id === itemId)?.asset.kind === 'video';
            if (media) await act({ pageId: presenter, action: 'click', selector: '[data-command="video-restart"]' });
            const state = await inspect();
            assert.equal(state.slideId, slide.id);
            assert.equal((await inspect(presenter)).notes, slide.notes);
            const checks = await check(['console', 'resources', 'fonts', 'layout', 'presenter', ...(media ? ['media'] : [])]);
            for (const [name, result] of Object.entries(checks.results)) assert.equal(result.status, 'pass', `${slide.id} ${name}: ${JSON.stringify(result)}`);
          }
        }
      }
    }
    for (const mode of [{ media: 'screen', reducedMotion: 'reduce' }, { media: 'print', reducedMotion: 'reduce' }]) {
      await act({ action: 'emulate', ...mode });
      for (const [index] of deck.slides.entries()) {
        await act({ pageId: presenter, action: 'select', selector: '#slide-select', value: String(index) });
        await inspect();
      }
    }
    await call('report_deck_qa', { sessionId, summary: 'Synthetic editable demo: automated paired-page/state/image coverage. Live-model interpretation, deployment, physical displays and final aesthetics remain pending.', reviews, changesMade: ['Replaced raster-only demonstration with retained SVG illustration and saved vector group stages.'] });
    await call('close_deck_qa', { sessionId });
    const report = await call('get_deck_qa_report', { jobId: job.id });
    assert.equal(report.qaStatus, 'complete', JSON.stringify(report.missing));
    assert.equal(report.bundleSha256, job.snapshot.bundleSha256);
    await client.close(); client = null; await decks.close(); store.close(); closed = true;
    if (destination) {
      await mkdir(destination, { recursive: true });
      await copyFile(path.join(root, job.outputPath), path.join(destination, 'demo.zip'));
      await writeFile(path.join(destination, 'editable-source.json'), JSON.stringify({ deck, snapshot: job.snapshot }, null, 2));
      await writeFile(path.join(destination, 'report.json'), JSON.stringify({ evidenceKind: 'automated-scripted-client', humanVerification: 'pending after deployment', ...report }, null, 2));
      // Preserve the report's relative image paths and reopenable saved source together.
      await cp(root, path.join(destination, 'workspace'), { recursive: true, filter: source => !source.endsWith('.sock') });
      const reopened = new Store(path.join(destination, 'workspace'));
      try {
        assert.deepEqual(reopened.getDeck(deck.id).slides, deck.slides);
        const { getQaReport } = await import('../deck-qa-report.js');
        assert.equal((await getQaReport(reopened, deck.id, job.id)).qaStatus, 'complete');
      } finally { reopened.close(); }
    }
    return { slides: deck.slides.length, jobId: job.id, bundleSha256: report.bundleSha256, sourceRevision: report.sourceRevision,
      qaStatus: report.qaStatus, evidenceKind: 'automated-scripted-client', humanVerification: 'pending after deployment', images: report.reviewedImages.length };
  } finally { await client?.close(); if (!closed) { await decks.close(); store.close(); } await rm(root, { recursive: true, force: true }); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await checkDemoDelivery(process.argv[2]))); }
  catch (error) { console.error(error.stack); process.exitCode = 1; }
}
