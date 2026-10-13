import { spawn, type ChildProcess } from 'node:child_process';
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { Match } from '../lib/types.ts';
import { centre, find, isKey, parseDescribeAll, SCREEN_H, visibleBottom, type AxElement } from './ax.ts';

const run = promisify(execFile);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const KEY_GAP = 300; // ms between key events (memory: faster makes iOS SIGQUIT the app)
const RUNTIME = 'com.apple.CoreSimulator.SimRuntime.iOS-26-5';
const DEVICE_TYPE = 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro';

/** idb_companion's own default is 10882: another port, so the demo never meets a companion it did not start. */
export const IDB_PORT = 10982;

export class StepFailed extends Error {
  readonly dump: string;
  constructor(message: string, dump: string) {
    super(message);
    this.dump = dump;
  }
}

export class Sim {
  private companion: ChildProcess | null = null;
  private recorder: ChildProcess | null = null;
  private port: number;
  private companionCmd: string[] | undefined;
  private recordCmd: string[] | undefined;
  private died: string | null = null;
  private last: AxElement[] = [];
  readonly udid: string;
  private failDir: string;
  /** `companionCmd` and `recordCmd` replace idb_companion and recordVideo (tests). */
  constructor(udid: string, failDir = 'out/capture/fail', o: { port?: number; companionCmd?: string[]; recordCmd?: string[] } = {}) {
    this.udid = udid;
    this.failDir = failDir;
    this.port = o.port ?? IDB_PORT;
    this.companionCmd = o.companionCmd;
    this.recordCmd = o.recordCmd;
  }

  /** The udid of the device `name`, created on the iPhone 17 Pro / iOS 26.5 runtime when absent. */
  static async ensureDevice(name: string): Promise<string> {
    const { stdout } = await run('xcrun', ['simctl', 'list', 'devices', '-j']);
    const devices = JSON.parse(stdout).devices as Record<string, { name: string; udid: string }[]>;
    const have = devices[RUNTIME]?.find((d) => d.name === name);
    if (have) return have.udid;
    const made = await run('xcrun', ['simctl', 'create', name, DEVICE_TYPE, RUNTIME]);
    return made.stdout.trim();
  }

  private simctl = (...args: string[]) => run('xcrun', ['simctl', ...args]);
  private idb = (...args: string[]) => run('idb', [...args, '--udid', this.udid]);

  /** Erases the device, boots it, freezes the status bar at 9:41 and installs `apps`. */
  async prepare(apps: string[]) {
    await this.simctl('shutdown', this.udid).catch(() => undefined);
    await this.simctl('erase', this.udid);
    await this.simctl('boot', this.udid);
    await this.simctl('bootstatus', this.udid, '-b');
    // a fresh device shows first-boot banners ("Ready for Apple Intelligence") over the top of the screen for a while:
    // a tap up there would open them
    await sleep(25_000);
    await this.simctl('status_bar', this.udid, 'override', '--time', '9:41', '--dataNetwork', 'wifi', '--wifiMode', 'active',
      '--wifiBars', '3', '--cellularMode', 'active', '--cellularBars', '4', '--batteryState', 'charged', '--batteryLevel', '100');
    for (const app of apps) await this.simctl('install', this.udid, app);
  }

  async connect() {
    const [cmd, ...args] = this.companionCmd ?? ['idb_companion', '--udid', this.udid, '--grpc-port', String(this.port)];
    const c = spawn(cmd, args, { stdio: 'ignore' });
    this.companion = c;
    let exited: number | null | undefined;
    c.on('exit', (code) => (exited = code));
    c.on('error', () => (exited = -1));
    // the companion takes 3 to 6 s to listen; one that exits (its port taken by another) is not waited for
    for (let i = 0; ; i++) {
      await sleep(1000);
      if (exited !== undefined) throw new Error(`idb_companion exited (${exited}) before answering on port ${this.port}`);
      try {
        await run('idb', ['connect', 'localhost', String(this.port)]);
        return;
      } catch (e) {
        if (i >= 15) throw new Error(`idb_companion did not answer on port ${this.port}: ${(e as Error).message}`);
      }
    }
  }

  async disconnect() {
    await run('idb', ['disconnect', 'localhost', String(this.port)]).catch(() => undefined);
    this.companion?.kill();
    this.companion = null;
  }

  async describe(): Promise<AxElement[]> {
    const { stdout } = await this.idb('ui', 'describe-all');
    return parseDescribeAll(stdout);
  }

  async waitFor(m: Match, o: { timeout?: number; enabled?: boolean } = {}): Promise<AxElement> {
    const until = Date.now() + (o.timeout ?? 20_000);
    let last: AxElement[] = [];
    while (Date.now() < until) {
      last = await this.describe().catch(() => last);
      const e = find(last, m, { enabled: o.enabled });
      if (e) {
        this.last = last;
        return e;
      }
      await sleep(400);
    }
    throw new StepFailed(`no element matching ${String(m)} within ${o.timeout ?? 20_000} ms`, await this.dump(String(m), last));
  }

  async tap(m: Match, o: { timeout?: number; enabled?: boolean } = {}): Promise<AxElement> {
    return this.tapWhere(m, o, centre);
  }

  /** Taps a text field near its right end: the cursor lands after the text, not in the middle of it. */
  async tapEnd(m: Match): Promise<AxElement> {
    return this.tapWhere(m, {}, (b) => [b.x + b.w - 6, b.y + b.h / 2]);
  }

  async tapAt(x: number, y: number) {
    await this.idb('ui', 'tap', String(Math.round(x)), String(Math.round(y)));
    await sleep(KEY_GAP);
  }

  private async tapWhere(m: Match, o: { timeout?: number; enabled?: boolean }, where: (b: AxElement['box']) => [number, number]): Promise<AxElement> {
    let e = await this.waitFor(m, { enabled: true, ...o });
    // below the fold, or under the keyboard: scroll it up, swiping in the upper half so the keyboard never takes the
    // swipe (a key of the keyboard itself is tapped where it is)
    for (let i = 0; i < 8 && !isKey(e) && e.box.y + e.box.h / 2 > visibleBottom(this.last); i++) {
      await this.swipe(200, 400, 200, 140);
      e = await this.waitFor(m, { enabled: true, ...o });
    }
    const [x, y] = where(e.box);
    await this.tapAt(x, y);
    return e;
  }

  /** One character at a time: the app's fields drop characters typed in one go. */
  async type(text: string) {
    for (const c of text) {
      await this.idb('ui', 'text', c);
      await sleep(KEY_GAP);
    }
  }

  async backspace(n: number) {
    for (let i = 0; i < n; i++) {
      await this.idb('ui', 'key', '42');
      await sleep(KEY_GAP);
    }
  }

  async swipe(x1: number, y1: number, x2: number, y2: number) {
    await this.idb('ui', 'swipe', String(x1), String(y1), String(x2), String(y2), '--duration', '0.4');
    await sleep(KEY_GAP);
  }

  async launch(bundle: string) {
    await this.simctl('launch', this.udid, bundle);
    await sleep(1500);
  }

  async screenshot(file: string) {
    await this.idb('screenshot', file);
  }

  async screenSize() {
    const els = await this.describe();
    const app = els.find((e) => e.type === 'Application') ?? els[0];
    return { width: app.box.w, height: app.box.h };
  }

  /** Starts recording; resolves with Date.now() at the first frame ("Recording started" on stderr). */
  startRecording(file: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const [cmd, ...args] = this.recordCmd ?? ['xcrun', 'simctl', 'io', this.udid, 'recordVideo', '--codec=h264', '--force', file];
      const p = spawn(cmd, args);
      this.recorder = p;
      this.died = null;
      let said = '';
      p.stderr.on('data', (d: Buffer) => {
        said += d.toString();
        if (said.includes('Recording started')) resolve(Date.now());
      });
      // before the first frame it fails the start; after, the capture asks recorderDied() between steps
      p.on('exit', (code) => {
        if (this.recorder === p) this.died = `recordVideo exited (${code}): ${said.trim().split('\n').at(-1) ?? ''}`;
        reject(new Error(`recordVideo stopped (${code}): ${said.trim()}`));
      });
    });
  }

  /** Why the recording stopped on its own, or null while it runs (or once stopped by stopRecording). */
  recorderDied(): string | null {
    return this.died;
  }

  async stopRecording() {
    const p = this.recorder;
    if (!p) return;
    this.recorder = null;
    if (p.exitCode !== null || p.signalCode !== null) return; // already gone: nothing to wait for
    await new Promise<void>((resolve) => {
      p.removeAllListeners('exit');
      p.on('exit', () => resolve());
      p.kill('SIGINT'); // recordVideo finishes the file on SIGINT
    });
  }

  private async dump(what: string, els: AxElement[]): Promise<string> {
    mkdirSync(this.failDir, { recursive: true });
    const base = join(this.failDir, `${Date.now()}`);
    writeFileSync(`${base}.json`, JSON.stringify({ waitingFor: what, elements: els }, null, 2));
    await this.screenshot(`${base}.png`).catch(() => undefined);
    return base;
  }
}
