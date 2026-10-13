import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const HELPER = new URL('./pty-run.py', import.meta.url).pathname;
const tail = (s: string) => s.split('\n').slice(-20).join('\n');

export class Computer {
  private p: ChildProcessWithoutNullStreams | null = null;
  private out = '';
  private exited: number | null = null;
  private waiters: (() => void)[] = [];
  private o: { bin: string; args: string[]; clock: () => number; log: string; env?: Record<string, string> };

  constructor(o: { bin: string; args: string[]; clock: () => number; log: string; env?: Record<string, string> }) {
    this.o = o;
  }

  async start() {
    this.p = spawn('python3', ['-I', HELPER, this.o.bin, ...this.o.args], { env: { ...process.env, ...this.o.env } });
    let buf = '';
    this.p.stdout.on('data', (d: Buffer) => {
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const msg = JSON.parse(buf.slice(0, i)) as { text?: string; exit?: number };
        buf = buf.slice(i + 1);
        if (msg.text !== undefined) {
          this.out += msg.text;
          appendFileSync(this.o.log, JSON.stringify({ t: this.o.clock(), text: msg.text }) + '\n');
        }
        if (msg.exit !== undefined) this.exited = msg.exit;
        for (const w of this.waiters.splice(0)) w();
      }
    });
  }

  private wait(test: () => string | null, what: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`gnokey-pair asked something else (waiting for ${what}):\n${tail(this.out)}`)), timeoutMs);
      const check = () => {
        const hit = test();
        if (hit !== null) { clearTimeout(timer); return resolve(hit); }
        if (this.exited !== null) { clearTimeout(timer); return reject(new Error(`gnokey-pair exited (${this.exited}) while waiting for ${what}:\n${tail(this.out)}`)); }
        this.waiters.push(check);
      };
      check();
    });
  }

  /** The code to type in the wallet: the magic-wormhole code ("7-guitarist-revenge") after "or type it:", not a QR line. */
  code(timeoutMs = 30_000) {
    return this.wait(() => this.out.match(/or type it:[\s\S]*?\n {4}(\d+(?:-[a-z]+)+)\r?\n/)?.[1] ?? null, 'the pairing code', timeoutMs);
  }

  /** Waits for `re` in the output that follows the last match of an earlier expect. */
  expect(re: RegExp, timeoutMs = 120_000) {
    const from = this.out.length;
    return this.wait(() => {
      const m = this.out.slice(Math.max(0, from - 200)).match(re);
      return m ? m[0] : null;
    }, String(re), timeoutMs);
  }

  send(text: string) {
    this.p?.stdin.write(text);
  }

  async done(timeoutMs = 120_000) {
    // a pty ends lines with \r\n
    const r = await this.wait(() => (/\nDone\.\r?\n/.test(this.out) ? 'done' : /\n(Failed:[^\r\n]*|Cancelled\.)\r?\n/.exec(this.out)?.[1] ?? null), 'Done.', timeoutMs);
    if (r !== 'done') throw new Error(`gnokey-pair: ${r}\n${tail(this.out)}`);
  }

  kill() {
    this.p?.kill();
  }
}
