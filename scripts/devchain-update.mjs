// Usage: node scripts/devchain-update.mjs   (npm run devchain:update)
// Refreshes devchain/: the code of every Bubble Rumble realm as deployed on gno.land, plus every non-stdlib package
// they import (transitively), laid out by package path. `npm run gnodev` loads it offline.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RPC = process.env.RPC ?? 'https://rpc.gno.land:443';
const NS = 'gno.land/r/g1leu8d2vsplhehcfkjg50mwgdpxdkt8tztu95wr';
const ROOTS = ['bubblerumble', 'bubblerumble2', 'bubblerumble3', 'bubblerumble4', 'bubblerumble5', 'bubblerumble6', 'bubble', 'wbubble']
  .map((n) => `${NS}/${n}`);
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'devchain');

async function qfile(path) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'abci_query',
      params: { path: 'vm/qfile', data: Buffer.from(path).toString('base64') },
    }),
  });
  const r = (await res.json()).result.response.ResponseBase;
  if (r.Error) throw new Error(`${path}: ${r.Log?.split('\n')[0] ?? 'query failed'}`);
  return Buffer.from(r.Data ?? '', 'base64').toString();
}

// import "a"; import x "a"; import ( "a"; y "b" )
function importsOf(src) {
  const out = new Set();
  for (const m of src.matchAll(/^import\s*\(([\s\S]*?)\)/gm)) for (const s of m[1].matchAll(/"([^"]+)"/g)) out.add(s[1]);
  for (const m of src.matchAll(/^import\s+(?:[\w.]+\s+)?"([^"]+)"/gm)) out.add(m[1]);
  return out;
}
// only domain packages are fetched; the standard library ("strings", "chain/runtime", …) comes with gnodev
const isDomainPkg = (p) => p.split('/')[0].includes('.');
const isTest = (f) => f.endsWith('_test.gno') || f.endsWith('_filetest.gno');

const height = await fetch(`${RPC}/status`).then((r) => r.json()).then((j) => j.result.sync_info.latest_block_height);
rmSync(OUT, { recursive: true, force: true });
const seen = new Set();
const queue = [...ROOTS];
while (queue.length) {
  const pkg = queue.shift();
  if (seen.has(pkg)) continue;
  seen.add(pkg);
  const files = (await qfile(pkg)).split('\n').filter(Boolean);
  const dir = join(OUT, pkg);
  mkdirSync(dir, { recursive: true });
  let hasMod = false;
  for (const f of files) {
    if (isTest(f)) continue; // a dev chain does not need tests, nor what only they import
    const src = await qfile(`${pkg}/${f}`);
    writeFileSync(join(dir, f), src);
    if (f === 'gnomod.toml') hasMod = true;
    if (f.endsWith('.gno')) for (const i of importsOf(src)) if (isDomainPkg(i) && !seen.has(i)) queue.push(i);
  }
  if (!hasMod) writeFileSync(join(dir, 'gnomod.toml'), `module = "${pkg}"\ngno = "0.9"\n`);
  console.log(`fetched ${pkg}`);
}
writeFileSync(
  join(OUT, 'SOURCE.md'),
  `# devchain\n\nCode of the Bubble Rumble realms and their dependencies as deployed on gno.land, fetched from ${RPC} at height ${height} by \`npm run devchain:update\` (scripts/devchain-update.mjs). Do not edit by hand.\n\n${[...seen].sort().map((p) => `- ${p}`).join('\n')}\n`,
);
console.log(`${seen.size} packages → devchain/ (height ${height})`);
