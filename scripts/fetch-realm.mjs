// Usage: node scripts/fetch-realm.mjs <pkgpath> <outdir>
// Copies a realm's files from gno.land mainnet (vm/qfile) into outdir, with a gnomod.toml gnodev can load.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [pkg, out] = process.argv.slice(2);
const q = async (path) => {
  const res = await fetch('https://rpc.gno.land:443', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'abci_query', params: { path: 'vm/qfile', data: Buffer.from(path).toString('base64') } }),
  });
  const j = await res.json();
  return Buffer.from(j.result.response.ResponseBase.Data ?? '', 'base64').toString();
};
mkdirSync(out, { recursive: true });
for (const f of (await q(pkg)).split('\n').filter(Boolean)) {
  if (f === 'gnomod.toml') continue;
  writeFileSync(join(out, f), await q(`${pkg}/${f}`));
}
writeFileSync(join(out, 'gnomod.toml'), `module = "${pkg}"\ngno = "0.9"\n`);
console.log(`fetched ${pkg} → ${out}`);
