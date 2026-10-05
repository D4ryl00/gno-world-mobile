// Playwright bench: Chromium with the built Adena extension, onboarded with
// test1 on the local gnodev, drives the test page through the spec's scenarios
// for both key types. Run `npm run gnodev` in ~/bubblerumble first.
/* global chrome -- only inside callbacks evaluated in the extension's service worker */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { chromium } from 'playwright';

const EXT = process.env.ADENA_DIST || '/Users/remi/adena-wallet/packages/adena-extension/dist';
const RPC = 'http://127.0.0.1:26657';
const TEST1 = 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5';
const MNEMONIC =
  'source bonus chronic canvas draft south burst lottery vacant surface solve popular case indicate oppose farm nothing bullet exhibit title speed wink action roast';
const PASSWORD = 'Bench-pass-1234';
const PAGE_DIR = resolve(import.meta.dirname, '..');
const GRANT = { allow: ['vm/exec:gno.land/r/demo/inpage'], spend: '5000000ugnot', period: 3600 };

const log = (...args) => console.error('#', new Date().toISOString().slice(11, 19), ...args);

let ctx;
let swDebug;
let extId;
let server;
let base;
let profile;

function serve() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
  server = createServer(async (req, res) => {
    const path = join(PAGE_DIR, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!path.startsWith(PAGE_DIR)) return res.writeHead(403).end();
    try {
      const body = await readFile(path.endsWith('/') ? join(path, 'index.html') : path);
      res.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(`http://localhost:${server.address().port}`)));
}

/** Adena's onboarding, as a user would click it: import test1, set a password, select Local. */
async function onboard() {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/register.html`);
  const next = () => page.getByRole('button', { name: 'Next' }).first().click();
  const pause = (ms = 900) => page.waitForTimeout(ms);
  log('onboarding');
  await page.getByText('Standard Wallets').click();
  await page.getByText('Import Existing Wallet').click();
  await next(); // sensitive information
  await pause();
  await next(); // questionnaire intro
  for (const answer of ['Nobody', 'Ignore the request', 'A Secure Offline Environment']) {
    await page.getByText(answer).first().click();
    await pause(400);
    await next();
    await pause(1200);
  }
  await next(); // questionnaire complete
  await pause(2000);
  await page.getByText('24 words', { exact: true }).click();
  const words = MNEMONIC.split(' ');
  const inputs = page.locator('input:not([type=checkbox]):not([type=password])');
  for (let i = 0; i < words.length; i++) await inputs.nth(i).fill(words[i]);
  await page.getByText('This will only be stored').evaluate((el) => el.previousElementSibling.click());
  await next();
  await pause(2000);
  const passwords = page.locator('input[type=password]');
  for (let i = 0; i < (await passwords.count()); i++) await passwords.nth(i).fill(PASSWORD);
  await page.evaluate(() => document.querySelector('#terms').click());
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Start' }).waitFor({ timeout: 30000 });
  log('wallet imported');

  await page.goto(`chrome-extension://${extId}/popup.html#/settings/change-network`);
  await page.getByText('Local', { exact: true }).click();
  await pause(2000);
  log('network Local selected');
  await page.close();
}

/** Opens the test page with `query` and waits for the wallet to be discovered. */
async function openPage(query) {
  const page = await ctx.newPage();
  page.on('console', (m) => (process.env.DEBUG || m.type() === 'error') && log('page console:', m.type(), m.text().slice(0, 400)));
  await page.goto(`${base}/index.html?${query}`);
  if (process.env.DEBUG) {
    await page.evaluate(() => window.addEventListener('message', (e) => console.log('window message', JSON.stringify(e.data).slice(0, 400))));
  }
  await page.waitForFunction(() => document.getElementById('state').textContent.includes('wallet: ') &&
    !document.getElementById('state').textContent.includes('wallet: none'), null, { timeout: 15000 });
  return page;
}

/**
 * Runs `action` on the page and answers each Adena window that opens meanwhile
 * with the next of `answers` ('Connect', 'Approve', 'Reject', or CLOSE_ON_SEND:
 * Approve, then close the window as soon as its transaction leaves). Asserts
 * that exactly that many windows opened.
 */
const CLOSE_ON_SEND = 'Approve, then close once sent';

async function run(page, action, answers = []) {
  const opened = [];
  const onPage = async (popup) => {
    // A new window reports about:blank until its first navigation.
    if (popup.url() === 'about:blank') await popup.waitForURL(/^chrome-extension:/, { timeout: 10000 }).catch(() => undefined);
    if (!popup.url().startsWith(`chrome-extension://${extId}/popup.html`)) return;
    const answer = answers[opened.length];
    opened.push(popup.url());
    log(`${action}: window ${popup.url().split('#')[1]?.split('?')[0]} -> ${answer ?? '(unexpected)'}`);
    if (!answer) return;
    const closeOnSend = answer === CLOSE_ON_SEND;
    const button = popup.getByRole('button', { name: closeOnSend ? 'Approve' : answer, exact: true });
    await button.waitFor({ timeout: 30000 });
    // The review composes its transaction first; Approve is enabled once it is ready.
    for (let i = 0; i < 60 && (await button.isDisabled().catch(() => false)); i++) await popup.waitForTimeout(500);
    const sent = closeOnSend
      ? popup.waitForRequest((r) => (r.postData() ?? '').includes('broadcast_tx'), { timeout: 30000 })
      : null;
    await button.click();
    if (sent) {
      await sent;
      log(`${action}: transaction sent, closing the window`);
      await popup.close();
    }
  };
  ctx.on('page', onPage);
  const watch = process.env.DEBUG
    ? setInterval(async () => {
        log('pages:', ctx.pages().map((p) => p.url().slice(0, 90)).join(' | '));
        const logs = await swDebug?.evaluate(() => globalThis.__logs.splice(0)).catch((e) => [`(sw gone: ${e.message})`]);
        for (const l of logs ?? []) log('sw:', l);
      }, 3000)
    : null;
  try {
    log(`${action}: start`);
    const line = await page.evaluate((name) => window.runAction(name), action);
    log(`${action}:`, JSON.stringify(line));
    if (swDebug) {
      const sites = await swDebug.evaluate(async () => {
        const raw = (await chrome.storage.local.get('ADENA_DATA')).ADENA_DATA;
        return JSON.stringify(JSON.parse(raw ?? '{}')?.data?.ESTABLISH_SITES ?? null);
      });
      log(`${action}: sites`, sites);
    }
    assert.equal(opened.length, answers.length, `${action}: ${opened.length} windows for ${answers.length} answers (${JSON.stringify(line)})`);
    return line;
  } finally {
    if (watch) clearInterval(watch);
    ctx.off('page', onPage);
  }
}

async function abci(path) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'abci_query', params: { path, data: '' } }),
  });
  return (await res.json()).result.response.ResponseBase;
}

before(async () => {
  assert.ok((await fetch(`${RPC}/status`)).ok, 'gnodev is not running on 26657 (npm run gnodev)');
  base = await serve();
  profile = await mkdtemp(join(tmpdir(), 'adena-bench-'));
  ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: process.env.HEADED ? false : true,
    viewport: { width: 1000, height: 800 },
    // Adena opens its windows at left 800, top 300; headless's default virtual
    // screen is too small for that, and Chrome then refuses to create them.
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--screen-info={0,0 1920x1080}'],
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  extId = new URL(sw.url()).host;
  if (process.env.DEBUG) {
    swDebug = sw;
    await sw.evaluate(() => {
      globalThis.__logs = [];
      for (const level of ['log', 'warn', 'error']) {
        const orig = console[level].bind(console);
        console[level] = (...args) => {
          globalThis.__logs.push(`${level}: ${args.map((a) => (a instanceof Error ? a.stack : typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')}`.slice(0, 500));
          orig(...args);
        };
      }
      const create = chrome.windows.create.bind(chrome.windows);
      chrome.windows.create = (...args) => {
        globalThis.__logs.push(`windows.create ${JSON.stringify(args[0]).slice(0, 200)}`);
        return create(...args);
      };
      self.addEventListener('unhandledrejection', (e) => globalThis.__logs.push(`unhandled: ${e.reason?.stack ?? e.reason}`));
    });
  }
  await onboard();
});

after(async () => {
  await ctx?.close();
  server?.close();
  if (profile) await rm(profile, { recursive: true, force: true });
});

for (const keyType of (process.env.ONLY_KEY ? [process.env.ONLY_KEY] : ['ed25519', 'secp256k1'])) {
  describe(`${keyType} session key`, () => {
    let page;
    let approved = false;
    const connectAnswers = (review) => (approved ? [] : ['Connect']).concat(review ? ['Approve'] : []);

    before(async () => {
      page = await openPage(`key=${keyType}`);
      await run(page, 'resetKeys');
    });

    test('1. grant: the session is on chain with the requested limits', async () => {
      const line = await run(page, 'grant', connectAnswers(true));
      approved = true;
      assert.equal(line.status, 'Approved', JSON.stringify(line));
      assert.equal(line.granted, true);
      assert.equal(line.session, line.key);
      assert.ok(line.hash, 'a transaction hash');
      assert.deepEqual(line.onChain.allow, GRANT.allow);
      assert.equal(line.onChain.spend, GRANT.spend);
      assert.equal(line.onChain.period, GRANT.period);
      const lifetime = line.onChain.expiresAt - Math.floor(Date.now() / 1000);
      assert.ok(lifetime > 86400 - 300 && lifetime <= 86400 + 60, `expires in ${lifetime}s`);
      const raw = await abci(`auth/accounts/${TEST1}/session/${line.key}`);
      const pubkeyType = JSON.parse(Buffer.from(raw.Data, 'base64')).BaseSessionAccount.BaseAccount.public_key?.['@type'];
      console.log(`# ${keyType}: session ${line.key} on chain, public_key type ${pubkeyType ?? '(not set before its first tx)'}`);
    });

    test('2. the same connect again: answered from the chain, no window, no transaction', async () => {
      const line = await run(page, 'grantAgain', []);
      assert.equal(line.status, 'Approved', JSON.stringify(line));
      assert.equal(line.granted, true);
      assert.equal(line.hash, undefined);
    });

    test('3. renew with old: one transaction, the old session is gone', async () => {
      const line = await run(page, 'renew', ['Approve']);
      assert.equal(line.status, 'Approved', JSON.stringify(line));
      assert.equal(line.granted, true);
      assert.equal(line.revoked, line.old);
      assert.equal(line.oldOnChain, null);
      assert.ok(line.onChain);
    });

    test('4a. disconnect with key, declined: Rejected, the approval is withdrawn anyway', async () => {
      const line = await run(page, 'disconnectWithKey', ['Reject']);
      assert.equal(line.status, 'Rejected', JSON.stringify(line));
      assert.equal(line.revoked, false);
      assert.ok(line.onChain, 'still on chain');
      assert.equal((await run(page, 'account')).approved, false);
      approved = false;
    });

    test('4b. disconnect with key: revoked on chain, approval withdrawn', async () => {
      const line = await run(page, 'disconnectWithKey', ['Approve']);
      assert.equal(line.status, 'Approved', JSON.stringify(line));
      assert.equal(line.revoked, true);
      assert.equal(line.onChain, null);
      assert.equal((await run(page, 'account')).approved, false);
    });

    test('5. disconnect() without a key: approval withdrawn, nothing on chain', async () => {
      const connected = await run(page, 'plainConnect', ['Connect']);
      assert.equal(connected.status, 'Approved');
      assert.equal(connected.granted, false);
      assert.equal((await run(page, 'account')).approved, true);
      const line = await run(page, 'disconnect', []);
      assert.equal(line.status, 'Approved', JSON.stringify(line));
      assert.equal(line.revoked, false);
      assert.equal((await run(page, 'account')).approved, false);
    });

    test('5b. grant, the review closed once its transaction is sent: answered from the chain', async () => {
      await run(page, 'resetKeys');
      const line = await run(page, 'grant', connectAnswers(false).concat([CLOSE_ON_SEND]));
      approved = true;
      assert.equal(line.status, 'Approved', JSON.stringify(line));
      assert.equal(line.granted, true);
      assert.equal(line.session, line.key);
      assert.deepEqual(line.onChain.allow, GRANT.allow);
    });

    test('5c. disconnect with key, the review closed once its transaction is sent: answered from the chain', async () => {
      const line = await run(page, 'disconnectWithKey', [CLOSE_ON_SEND]);
      approved = false;
      assert.equal(line.status, 'Approved', JSON.stringify(line));
      assert.equal(line.revoked, true);
      assert.equal(line.onChain, null);
    });

    test('6. refusals before any window', async () => {
      assert.equal((await run(page, 'badProof', [])).code, 'invalid_proof');
      assert.equal((await run(page, 'stale', [])).code, 'stale_request');
      assert.equal((await run(page, 'oldIsPubkey', [])).code, 'invalid_request');
    });

    after(() => page?.close());
  });
}

test('7. degradation: a wallet that ignores pubkey grants nothing, and the page sees it', async () => {
  const page = await openPage('wallet=legacy');
  const line = await page.evaluate(() => window.runAction('grant'));
  assert.equal(line.status, 'Approved');
  assert.equal(line.granted, false);
  assert.equal(line.session, undefined);
  await page.close();
});
