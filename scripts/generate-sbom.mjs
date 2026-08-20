import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const outputPath = path.resolve(process.argv[2] ?? 'release-artifacts/chrono-forge.cdx.json');
const cargoCommand = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
const npmCli = process.env.npm_execpath;

if (!npmCli) {
  throw new Error('Run this generator through `npm run generate:sbom` so npm_execpath is defined.');
}

function commandJson(command, args) {
  return JSON.parse(
    execFileSync(command, args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }),
  );
}

const bom = commandJson(process.execPath, [
  npmCli,
  'sbom',
  '--package-lock-only',
  '--sbom-format',
  'cyclonedx',
  '--sbom-type',
  'application',
]);
const cargo = commandJson(cargoCommand, [
  'metadata',
  '--manifest-path',
  'src-tauri/Cargo.toml',
  '--format-version',
  '1',
  '--filter-platform',
  'x86_64-pc-windows-msvc',
  '--locked',
]);

const cargoRef = (packageId) => `cargo:${packageId}`;
const cargoPackages = new Map(cargo.packages.map((item) => [item.id, item]));
const cargoComponents = cargo.packages.map((item) => {
  const component = {
    type: item.source === null ? 'application' : 'library',
    'bom-ref': cargoRef(item.id),
    name: item.name,
    version: item.version,
    purl: `pkg:cargo/${encodeURIComponent(item.name)}@${encodeURIComponent(item.version)}`,
  };

  if (item.checksum) component.hashes = [{ alg: 'SHA-256', content: item.checksum }];
  if (item.license) component.licenses = [{ expression: item.license }];
  if (item.description) component.description = item.description;

  const references = [];
  if (item.homepage) references.push({ type: 'website', url: item.homepage });
  if (item.repository) references.push({ type: 'vcs', url: item.repository });
  if (references.length > 0) component.externalReferences = references;

  return component;
});

const cargoDependencies = (cargo.resolve?.nodes ?? []).map((node) => ({
  ref: cargoRef(node.id),
  dependsOn: node.dependencies
    .filter((id) => cargoPackages.has(id))
    .map(cargoRef)
    .sort(),
}));
const workspaceRefs = (cargo.workspace_members ?? []).map(cargoRef);
const rootRef = bom.metadata?.component?.['bom-ref'];
const rootDependency = (bom.dependencies ?? []).find((dependency) => dependency.ref === rootRef);

if (rootDependency) {
  rootDependency.dependsOn = [
    ...new Set([...(rootDependency.dependsOn ?? []), ...workspaceRefs]),
  ].sort();
}

bom.components = [...(bom.components ?? []), ...cargoComponents].sort((left, right) =>
  left['bom-ref'].localeCompare(right['bom-ref'], 'en'),
);
bom.dependencies = [...(bom.dependencies ?? []), ...cargoDependencies].sort((left, right) =>
  left.ref.localeCompare(right.ref, 'en'),
);

if (bom.metadata) delete bom.metadata.timestamp;
delete bom.serialNumber;

const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const componentNames = new Set(bom.components.map((component) => component.name));
const missingRuntimePackages = Object.keys(manifest.dependencies ?? {}).filter(
  (name) => !componentNames.has(name),
);
const allRefs = new Set([
  bom.metadata?.component?.['bom-ref'],
  ...bom.components.map((component) => component['bom-ref']),
]);
const brokenDependencyRefs = bom.dependencies.flatMap((dependency) => [
  ...(allRefs.has(dependency.ref) ? [] : [dependency.ref]),
  ...(dependency.dependsOn ?? []).filter((reference) => !allRefs.has(reference)),
]);

if (missingRuntimePackages.length > 0) {
  throw new Error(`SBOM omitted runtime packages: ${missingRuntimePackages.join(', ')}`);
}
if (!componentNames.has('tauri')) {
  throw new Error('SBOM omitted the Tauri Rust runtime.');
}
if (brokenDependencyRefs.length > 0) {
  throw new Error(
    `SBOM contains unresolved dependency references: ${brokenDependencyRefs.slice(0, 5).join(', ')}`,
  );
}

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(bom, null, 2)}\n`, 'utf8');

const npmCount = (bom.components ?? []).length - cargoComponents.length;
process.stdout.write(
  `Wrote ${path.relative(process.cwd(), outputPath)} with ${npmCount} npm and ${cargoComponents.length} Cargo components.\n`,
);
