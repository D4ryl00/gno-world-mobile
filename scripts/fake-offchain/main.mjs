// npm run fake-offchain — the chat stand-in for the simulator (Settings → off-chain server http://127.0.0.1:8787).
import { startFakeServer } from './server.ts';

const port = Number(process.env.PORT ?? 8787);
const s = await startFakeServer(port, { host: process.env.HOST ?? '127.0.0.1' });
console.log(`fake off-chain server on ${s.url} — test routes under /__test/`);
