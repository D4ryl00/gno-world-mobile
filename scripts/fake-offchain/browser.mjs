// npm run fake-browser -- offer | accept <code> — gno.world in a browser, for pairing the app on a simulator or an
// emulator against npm run fake-offchain: the site's own sync code (site-sync.ts), a reserved name and two rooms.
// SERVER (default http://127.0.0.1:8787) and NAME (default browsie) choose the server and the name.
import { randomBytes } from 'node:crypto';

import { SiteBrowser } from './site-sync.ts';

const [cmd, code] = process.argv.slice(2);
const server = process.env.SERVER ?? 'http://127.0.0.1:8787';
const name = process.env.NAME ?? 'browsie';
if (!(cmd === 'offer' || (cmd === 'accept' && code))) {
  console.error('usage: npm run fake-browser -- offer | accept <code>');
  process.exit(2);
}
const b = new SiteBrowser(server);
const key = randomBytes(16).toString('hex');
await fetch(`${server}/__test/name`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, key, addr: `g1${'q'.repeat(38)}` }),
});
b.reserve(name, key);
b.roomRemember({ id: 'BrowserRoomWithKey01', name: 'made in the browser', key: randomBytes(12).toString('hex') });
b.roomRemember({ id: 'BrowserRoomNoKey0002', name: 'joined in the browser', key: '' });

if (cmd === 'offer') console.log(`code ${await b.syncOffer()} — in the app: Chat → pair → Enter a code`);
else console.log(await b.syncAccept(code));

// what this browser holds, each time it changes, for ten minutes
let last = '';
const show = () => {
  const now = JSON.stringify({ name: b.chatReservedName(), rooms: b.roomsKnown().map((r) => `${r.name}${r.key ? ' 🔑' : ''}`) });
  if (now !== last) console.log((last = now));
};
show();
const end = Date.now() + 600_000;
while (Date.now() < end) {
  await new Promise((r) => setTimeout(r, 5000));
  await b.syncPull();
  show();
}
