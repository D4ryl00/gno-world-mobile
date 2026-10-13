import { spawn, type ChildProcess } from 'node:child_process';
import { execFile } from 'node:child_process';
import { mkdirSync, openSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { IDB_PORT } from './sim.ts';

const run = promisify(execFile);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const ROOT = resolve(import.meta.dirname, '..', '..');
export const STATE = join(ROOT, 'demo', '.state');
export const PORTS = { rpc: 26657, web: 8888, chat: 8787, relay: 4000, idb: IDB_PORT } as const;
export const CHAIN_ID = 'dev';
export const REALM = 'gno.land/r/g1leu8d2vsplhehcfkjg50mwgdpxdkt8tztu95wr/bubblerumble6';
export const POOL_NAME = 'Friday pot';
// gnodev funds test1 at genesis: Alice is test1
export const ALICE = {
  name: 'alice',
  address: 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5',
  mnemonic: 'source bonus chronic canvas draft south burst lottery vacant surface solve popular case indicate oppose farm nothing bullet exhibit title speed wink action roast',
};
export const BOB = {
  name: 'bob',
  mnemonic: 'place adjust exist demise learn during junior child brown trend van intact hard piece envelope mercy wise renew depend mixed front rice bag token',
};
export const RELAY_BIN = join(homedir(), 'gno-gnokey-pair/contribs/gnokey-pair/.venv/bin/twist');
export const GNOROOT = join(ROOT, '.e2e/gnoroot-5cdbc25fcde0');

export async function busyPorts(ports: number[]): Promise<number[]> {
  const taken = await Promise.all(ports.map((p) => new Promise<boolean>((res) => {
    const c = createConnection({ port: p, host: '127.0.0.1' });
    c.once('connect', () => { c.destroy(); res(true); });
    c.once('error', () => res(false));
  })));
  return ports.filter((_, i) => taken[i]);
}

export const busyMessage = (busy: number[]) =>
  `port${busy.length > 1 ? 's' : ''} ${busy.join(', ')} already in use — stop what listens there (a previous run, npm run gnodev, ` +
  `npm run fake-offchain, an idb companion) and try again; to see who: ${busy.map((p) => `lsof -nP -iTCP:${p} -sTCP:LISTEN`).join(' ; ')}`;

/** Starts `cmd` in its own process group, logging to <logs>/<name>.log; a program that cannot start calls onFail. */
export function spawnLogged(logs: string, name: string, cmd: string, args: string[], env: Record<string, string>, onFail: (why: string) => void): ChildProcess {
  mkdirSync(logs, { recursive: true });
  const log = openSync(join(logs, `${name}.log`), 'w');
  const p = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', log, log], detached: true });
  p.on('error', (e) => onFail(`${name}: ${e.message}`));
  return p;
}

const until = async (what: string, ok: () => Promise<boolean>, failed: () => string | null, ms = 120_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const f = failed();
    if (f) throw new Error(`${what} could not start — ${f}`);
    if (await ok().catch(() => false)) return;
    await sleep(1000);
  }
  throw new Error(`${what} did not come up within ${ms / 1000} s (logs in demo/.state/logs/)`);
};
const httpOk = (url: string) => async () => (await fetch(url)).status < 500;

export class Stage {
  readonly home = join(STATE, 'gnohome');
  readonly bin = join(STATE, 'bin');
  private procs: ChildProcess[] = [];

  private failure: string | null = null;

  private start(name: string, cmd: string, args: string[], env: Record<string, string> = {}) {
    this.procs.push(spawnLogged(join(STATE, 'logs'), name, cmd, args, env, (why) => (this.failure ??= why)));
  }

  /** gnokey list: no key, no password */
  async list(): Promise<string> {
    const { stdout } = await run(join(this.bin, 'gnokey'), ['list', '-home', this.home]);
    return stdout;
  }

  async gnokey(args: string[], key: string): Promise<string> {
    const p = spawn(join(this.bin, 'gnokey'), [...args, '-home', this.home, '-insecure-password-stdin', key]);
    p.stdin.end('\n');
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    const code = await new Promise<number | null>((r) => p.on('exit', r));
    if (code !== 0) throw new Error(`gnokey ${args.slice(0, 3).join(' ')} failed:\n${out}`);
    return out;
  }

  private tx = (args: string[], key: string) =>
    this.gnokey(['maketx', ...args, '-gas-fee', '1000000ugnot', '-gas-wanted', '50000000', '-broadcast', '-chainid', CHAIN_ID,
      '-remote', `127.0.0.1:${PORTS.rpc}`], key);

  async up() {
    const busy = await busyPorts(Object.values(PORTS));
    if (busy.length) throw new Error(busyMessage(busy));
    rmSync(this.home, { recursive: true, force: true });
    mkdirSync(this.home, { recursive: true });
    for (const k of [ALICE, BOB]) {
      const p = spawn(join(this.bin, 'gnokey'), ['add', k.name, '-recover', '-insecure-password-stdin', '-home', this.home]);
      p.stdin.end(`${k.mnemonic}\n\n\n`);
      await new Promise((r) => p.on('exit', r));
    }
    this.start('gnodev', 'bash', ['scripts/gnodev.sh'], { GNODEV_WEB: '1', GNOROOT });
    this.start('chat', 'node', ['--experimental-strip-types', '--no-warnings', 'scripts/fake-offchain/main.mjs'], { PORT: String(PORTS.chat) });
    this.start('relay', RELAY_BIN, ['wormhole-mailbox', '--port', `tcp:${PORTS.relay}`, '--channel-db', join(STATE, 'relay.sqlite')]);
    await until('gnodev', httpOk(`http://127.0.0.1:${PORTS.rpc}/status`), () => this.failure);
    await until('gnoweb', httpOk(`http://127.0.0.1:${PORTS.web}/`), () => this.failure);
    await until('the chat server', httpOk(`http://127.0.0.1:${PORTS.chat}/api/chat?since=0&wait=0&limit=1`), () => this.failure);
    await until('the relay', async () => (await busyPorts([PORTS.relay])).length === 1, () => this.failure);
    const bob = (await this.list()).match(/bob \(local\) - addr: (g1\w+)/)?.[1];
    if (!bob) throw new Error('bob is not in the demo keybase');
    await this.tx(['send', '-send', '1000000000ugnot', '-to', bob], ALICE.name);
    await this.tx(['call', '-pkgpath', REALM, '-func', 'CreatePool', '-args', POOL_NAME, '-args', '3600', '-args', '100000',
      '-send', '50000000ugnot'], BOB.name);
  }

  async bobSays(body: string) {
    const r = await fetch(`http://127.0.0.1:${PORTS.chat}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: BOB.name, body }),
    });
    if (!r.ok) throw new Error(`Bob could not post (${r.status}): ${await r.text()}`);
  }

  async down() {
    for (const p of this.procs) {
      try { process.kill(-p.pid!, 'SIGTERM'); } catch { /* already gone */ }
    }
    this.procs = [];
  }
}

// npm run demo:stage — bring the stage up for a manual look, Ctrl-C to stop
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = new Stage();
  process.on('SIGINT', () => void s.down().then(() => process.exit(0)));
  await s.up().catch(async (e) => { console.error(String(e.message ?? e)); await s.down(); process.exit(1); });
  console.log(`stage up: rpc :${PORTS.rpc}, gnoweb :${PORTS.web}, chat :${PORTS.chat}, relay :${PORTS.relay} — Ctrl-C to stop`);
}
