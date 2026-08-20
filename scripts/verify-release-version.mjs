import { readFile } from 'node:fs/promises';

const tag = process.argv[2];
if (!tag?.startsWith('v')) {
  throw new Error('Expected a release tag argument such as v1.0.0.');
}

const expectedVersion = tag.slice(1);
const packageManifest = JSON.parse(await readFile('package.json', 'utf8'));
const tauriManifest = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
const cargoManifest = await readFile('src-tauri/Cargo.toml', 'utf8');
const cargoVersion = cargoManifest.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

const versions = new Map([
  ['package.json', packageManifest.version],
  ['src-tauri/tauri.conf.json', tauriManifest.version],
  ['src-tauri/Cargo.toml', cargoVersion],
]);

for (const [file, version] of versions) {
  if (version !== expectedVersion) {
    throw new Error(`${file} has version ${String(version)}; expected ${expectedVersion}.`);
  }
}

console.log(`Release manifests match ${tag}.`);
