import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Durations } from '../lib/types.ts';

export const cacheName = (scene: string, voice: string, text: string) =>
  `${scene}-${createHash('sha256').update(`${voice}\n${text}`).digest('hex').slice(0, 8)}.wav`;

/** Length of a PCM/float WAV from its fmt and data chunks. */
export function wavSeconds(bytes: Uint8Array): number {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let rate = 0, channels = 0, bits = 0;
  for (let i = 12; i + 8 <= bytes.length;) {
    const id = new TextDecoder().decode(bytes.subarray(i, i + 4));
    const size = v.getUint32(i + 4, true);
    if (id === 'fmt ') {
      channels = v.getUint16(i + 10, true);
      rate = v.getUint32(i + 12, true);
      bits = v.getUint16(i + 22, true);
    } else if (id === 'data') {
      return size / (rate * channels * (bits / 8));
    }
    i += 8 + size + (size % 2);
  }
  throw new Error('not a WAV with fmt and data chunks');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { loadScript } = await import('../lib/which.ts');
  const { script, out: base } = await loadScript();
  const out = join(base, 'voice');
  mkdirSync(out, { recursive: true });
  const { KokoroTTS } = await import('kokoro-js');
  let tts: Awaited<ReturnType<typeof KokoroTTS.from_pretrained>> | null = null;
  const durations: Durations = {};
  for (const s of script.scenes) {
    if (!s.voice) continue;
    const name = cacheName(s.id, script.voice, s.voice);
    const file = join(out, name);
    if (!existsSync(file)) {
      tts ??= await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' });
      const audio = await tts.generate(s.voice, { voice: script.voice as never });
      await audio.save(file);
      console.log(`voiced ${s.id}`);
    }
    durations[s.id] = { file: `voice/${name}`, seconds: wavSeconds(readFileSync(file)) };
  }
  writeFileSync(join(out, 'durations.json'), JSON.stringify(durations, null, 2));
  console.log(`durations: ${Object.entries(durations).map(([k, d]) => `${k} ${d.seconds.toFixed(1)} s`).join(', ')}`);
}
