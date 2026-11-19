import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';
import { createApp } from '../src/server.js';
import { listenInRange } from '../test-support/loopback-port.js';

const drawerTest = 'Channels and Productions overlay the workspace; selection, rename and bulk deletion work';
const failureProbe = process.env.STORYBENCH_CHANNEL_DRAWER_FAILURE_PROBE === '1';

async function launchChromium() {
  const options = { timeout: 10_000 };
  try { return await chromium.launch({ ...options, channel: 'chromium' }); }
  catch (error) {
    if (error.name === 'TimeoutError') throw error;
    if (existsSync('/usr/bin/chromium')) return chromium.launch({ ...options, executablePath: '/usr/bin/chromium' });
    if (!existsSync(chromium.executablePath())) return null;
    throw error;
  }
}

async function drawerFixture(t) {
  const cleanup = new AsyncDisposableStack();
  const setup = (async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'storybench-channel-drawer-'));
    cleanup.defer(() => rmSync(root, { recursive: true, force: true }));
    const app = await createApp({ workspace: root });
    cleanup.defer(() => {
      // Stop accepting requests before dropping active fixture connections.
      const stopped = app.close();
      app.server.closeAllConnections();
      return stopped;
    });
    const port = await listenInRange(app.server);
    const browser = await launchChromium();
    if (browser) cleanup.defer(() => browser.close());
    return { app, browser, port, root };
  })();
  t.after(async () => {
    // Setup can still be acquiring a resource when the test timeout fires.
    await setup.catch(() => {});
    await cleanup.disposeAsync();
  }, { timeout: 45_000 });
  const fixture = await setup;
  t.signal.throwIfAborted();
  return fixture;
}

async function holdChannelRequest(server, port) {
  const url = '/api/channels?drawerFailureProbe=1';
  const received = Promise.withResolvers();
  const onRequest = req => {
    if (req.url === url) received.resolve();
  };
  server.on('request', onRequest);
  const socket = createConnection(port, '127.0.0.1');
  socket.on('error', received.reject);
  const closed = new Promise(resolve => socket.once('close', resolve));
  try {
    // The app is reading this JSON body when the Playwright wait fails.
    socket.write(`POST ${url} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Length: 40\r\nContent-Type: application/json\r\n\r\n{`);
    await received.promise;
    return { socket, closed };
  } finally {
    server.off('request', onRequest);
  }
}

test(drawerTest, { timeout: 45_000 }, async (t) => {
  const { app, browser, port, root } = await drawerFixture(t);
  if (!browser) return t.skip('No launchable Chromium on this seat');
  const main = app.store.getDefaultChannel();
  const episode = app.store.createEpisode({ title: 'Main production', channelId: main.id });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(15_000);
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/episodes?channel=${main.id}&episode=${episode.id}`);
  await page.locator('[data-chat-title]').waitFor();
  const geometry = async () => page.locator('.workspace').boundingBox();
  const base = await geometry(), chat = await page.locator('.chat').boundingBox();
  const rail = page.locator('#episodeRailToggle');
  const railBox = await rail.boundingBox();
  assert.equal(railBox.x, 0);
  assert.equal(railBox.y + railBox.height, 900, 'Productions rail reaches the viewport bottom');
  await rail.click({ position: { x: railBox.width / 2, y: railBox.height - 10 } });
  assert.equal(await page.locator('#episodeRail').getAttribute('aria-hidden'), 'false');
  assert.equal((await geometry()).width, base.width);
  await rail.click({ position: { x: railBox.width / 2, y: 10 } });
  assert.equal(await page.locator('#episodeRail').getAttribute('aria-hidden'), 'true');
  await rail.focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#episodeRail').getAttribute('aria-hidden'), 'false');
  await page.click('#channelsToggle');
  await page.locator('#channelsBack').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#episodeRail').getAttribute('aria-hidden'), 'true');
  assert.equal((await geometry()).width, base.width);
  assert.equal((await page.locator('.chat').boundingBox()).x, chat.x);
  await page.click('#channelsBack');
  assert.equal(await page.locator('#episodeRail').getAttribute('aria-hidden'), 'false');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#episodeRailToggle').getAttribute('aria-expanded'), 'false');
  await page.click('#channelsToggle');
  await page.click('#newChannel');
  await page.fill('#channelNameInput', 'Second');
  await page.click('#channelNameForm button[type=submit]');
  await page.waitForFunction(() => document.querySelector('#channelName').textContent === 'Second');
  assert.equal(await page.locator('#editor').isVisible(), false, 'creation opens an empty channel');
  assert.equal(app.store.getDefaultChannel().id, main.id, 'creation does not change the default');
  await page.click('#channelsToggle');
  await page.waitForFunction(() => document.querySelectorAll('.channel-card').length === 2);
  assert.match(await page.locator('.channel-card').first().textContent(), /Second/);
  const heldRefresh = Promise.withResolvers();
  if (failureProbe) {
    const { socket, closed } = await holdChannelRequest(app.server, port);
    t.after(async () => {
      await closed;
      assert.equal(browser.isConnected(), false, 'browser disconnected');
      assert.equal(app.server.address(), null, 'listener closed');
      assert.equal(existsSync(root), false, 'workspace removed');
      t.diagnostic(`Released browser, listener ${port}, unfinished HTTP connection and workspace ${root}`);
    }, { timeout: 5_000 });
    assert.equal(socket.destroyed, false, 'an unfinished HTTP request is live');
  }
  await page.route('**/api/channel-deletions', (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    // Leave the refresh in flight so the real pending-panel wait times out.
    if (failureProbe) return heldRefresh.resolve();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'delete_pending', state: 'pending', error: 'Storage unavailable', channelIds: [] }]) });
  });
  await page.keyboard.press('Escape');
  await page.click('#channelsToggle');
  if (failureProbe) {
    await heldRefresh.promise;
    console.log('Reopened Channels drawer; pending-deletion GET intercepted and held');
  }
  await page.waitForFunction(() => !document.querySelector('#channelDeletePending').hidden, null, { timeout: failureProbe ? 1_000 : undefined });
  assert.equal(await page.locator('#newChannel').isVisible(), true, 'pending cleanup leaves unrelated channels usable');
  assert.equal(await page.locator('.channel-card').count(), 2);
  await page.unroute('**/api/channel-deletions');
  await page.keyboard.press('Escape');
  await page.click('#channelsToggle');
  await page.waitForFunction(() => document.querySelector('#channelDeletePending').hidden);
  await page.click('#selectChannels');
  assert.equal(await page.locator('#renameChannel').isEnabled(), false);
  assert.equal(await page.locator('#deleteChannels').isEnabled(), false);
  await page.locator('.channel-card').first().click();
  assert.equal(await page.locator('.channel-card').first().evaluate((element) => element === document.activeElement), true, 'selection restores keyboard focus');
  assert.equal(await page.locator('#renameChannel').isEnabled(), true);
  await page.locator('.channel-card').last().click();
  assert.equal(await page.locator('#renameChannel').isEnabled(), false);
  assert.equal(await page.locator('#deleteChannels').isEnabled(), true);
  await page.locator('.channel-card').last().click();
  await page.click('#renameChannel');
  await page.fill('#channelNameInput', 'Second renamed');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#channelNameForm').isVisible(), false, 'Escape cancels the form first');
  await page.click('#renameChannel');
  await page.fill('#channelNameInput', 'Second renamed');
  await page.click('#channelNameForm button[type=submit]');
  await page.waitForFunction(() => document.querySelector('#channelName').textContent === 'Second renamed');
  assert.equal(await page.locator('#channelSelectionCount').textContent(), '1 selected');
  await page.click('#doneChannels');
  await page.locator('.channel-card').filter({ hasText: 'Main' }).click();
  await page.waitForFunction(() => document.querySelector('#channelName').textContent === 'Main');
  await page.waitForFunction(() => document.querySelector('#channelsDrawer').getAttribute('aria-hidden') === 'true');
  assert.equal(await page.inputValue('#episodeTitle'), '', 'switching clears the previous production selection');
  await page.click('#channelsToggle');
  await page.waitForFunction(() => document.querySelectorAll('.channel-card').length === 2 && document.querySelector('.channel-card').textContent.includes('Main'));
  assert.match(await page.locator('.channel-card').first().textContent(), /Main/, 'opened channel rises to top');
  await page.click('#selectChannels');
  await page.locator('.channel-card').first().click();
  await page.locator('.channel-card').last().click();
  await page.route('**/api/channel-deletions/preview', (route) => route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"Retained media dependency"}' }));
  await page.click('#deleteChannels');
  await page.waitForFunction(() => document.querySelector('#channelActionError').textContent.includes('Retained media dependency'));
  assert.equal(await page.locator('#channelActionError').isVisible(), true);
  await page.unroute('**/api/channel-deletions/preview');
  await page.click('#deleteChannels');
  await page.waitForFunction(() => !document.querySelector('#channelDeleteConfirm').hidden);
  assert.match(await page.locator('#channelDeleteSummary').textContent(), /2 channels, 1 production/);
  assert.match(await page.locator('#channelDeleteNames').textContent(), /Main/);
  assert.match(await page.locator('#channelDeleteNames').textContent(), /Second renamed/);
  await page.click('#confirmChannelDelete');
  await page.waitForFunction(() => document.querySelector('#channelName').textContent === 'No channel');
  assert.equal(await page.locator('#firstEpisode').textContent(), 'Create a channel');
  assert.equal(app.store.listChannels().length, 0);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.click('#channelsToggle');
  await page.waitForFunction(() => document.querySelector('#channelsDrawer').getBoundingClientRect().x >= 0);
  const drawer = await page.locator('#channelsDrawer').boundingBox();
  assert.ok(drawer.x >= 0 && drawer.x + drawer.width <= 390);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
});

test('channel navigation exposes story leave choices and preserves a failed title save', { timeout: 20000 }, async (t) => {
  const { app, browser, port } = await drawerFixture(t);
  if (!browser) return t.skip('No launchable Chromium on this seat');
  const first = app.store.getDefaultChannel(), second = app.store.createChannel('Second');
  const episode = app.store.createEpisode({ title: 'Original title', channelId: first.id });
  const page = await browser.newPage();
  page.setDefaultTimeout(15_000);
  await page.goto(`http://127.0.0.1:${port}/episodes?channel=${first.id}&episode=${episode.id}`);
  await page.locator('#episodeTitle').waitFor();
  await page.click('[data-tab=story]');
  await page.click('[data-story-edit]');
  await page.locator('.cm-content').press('End');
  await page.locator('.cm-content').press('x');
  await page.click('#channelsToggle');
  await page.locator(`[data-channel-id="${second.id}"]`).click();
  await page.locator('[data-story-leave]').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#channelsDrawer').getAttribute('aria-hidden'), 'true', 'drawer yields to the leave prompt');
  await page.click('[data-leave-stay]');
  assert.equal(await page.locator('#channelsDrawer').getAttribute('aria-hidden'), 'false');
  assert.equal(await page.locator('#channelName').textContent(), first.name);
  await page.locator(`[data-channel-id="${second.id}"]`).click();
  await page.locator('[data-story-leave]').waitFor({ state: 'visible' });
  await page.click('[data-leave-discard]');
  await page.waitForFunction(() => document.querySelector('#channelName').textContent === 'Second');

  await page.goto(`http://127.0.0.1:${port}/episodes?channel=${first.id}&episode=${episode.id}`);
  await page.locator('#episodeTitle').waitFor();
  await page.route(`**/api/episodes/${episode.id}`, (route) => route.request().method() === 'PUT'
    ? route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"Injected conflict"}' })
    : route.continue());
  await page.fill('#episodeTitle', 'Unsaved title');
  await page.click('#channelsToggle');
  await page.locator(`[data-channel-id="${second.id}"]`).click();
  await page.waitForFunction(() => document.querySelector('#saveState').textContent.includes('reload'));
  assert.equal(await page.inputValue('#episodeTitle'), 'Unsaved title');
  assert.equal(await page.locator('#channelName').textContent(), first.name);
});

test('a timed-out channel drawer wait exits and releases its fixture', async t => {
  const env = { ...process.env, STORYBENCH_CHANNEL_DRAWER_FAILURE_PROBE: '1' };
  // The standalone child reports text instead of the outer runner's IPC format.
  delete env.NODE_TEST_CONTEXT;
  const started = performance.now();
  const result = await promisify(execFile)(process.execPath, [
    '--test', '--test-isolation=none', '--test-reporter=spec', `--test-name-pattern=^${drawerTest}$`, fileURLToPath(import.meta.url),
  ], { env, timeout: 45_000 }).catch(error => error);
  const output = `${result.stdout}\n${result.stderr}`;
  if (!result.code && /No launchable Chromium on this seat/.test(output)) return t.skip('No launchable Chromium on this seat');
  assert.equal(result.code, 1, output);
  assert.equal(result.signal, null, output);
  assert.match(output, /Reopened Channels drawer; pending-deletion GET intercepted and held/);
  assert.match(output, /page\.waitForFunction: Timeout 1000ms exceeded/);
  assert.match(output, /Released browser, listener \d+, unfinished HTTP connection and workspace /);
  t.diagnostic(`Child exited 1 in ${Math.round(performance.now() - started)}ms after the 1000ms Playwright wait. ${output.match(/Released browser, listener .+/)[0]}`);
});
