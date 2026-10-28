// Usage: node scripts/set-version.mjs 1.2.3
// Writes the release version into app.json (the store version: CFBundleShortVersionString / versionName),
// package.json and package-lock.json. semantic-release runs it before committing the release; build numbers
// are not here — EAS keeps them remotely (eas.json: appVersionSource "remote", autoIncrement).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error(`usage: node scripts/set-version.mjs X.Y.Z (got ${version})`);
  process.exit(1);
}
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function edit(file, change) {
  const path = join(ROOT, file);
  const json = JSON.parse(readFileSync(path, 'utf8'));
  change(json);
  writeFileSync(path, JSON.stringify(json, null, 2) + '\n');
}

edit('app.json', (j) => { j.expo.version = version; });
edit('package.json', (j) => { j.version = version; });
edit('package-lock.json', (j) => { j.version = version; j.packages[''].version = version; });
