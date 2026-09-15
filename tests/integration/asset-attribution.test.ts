import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

interface AttributionGroup {
  readonly id: string;
  readonly paths: readonly string[];
  readonly source: string;
  readonly license: string;
  readonly creationMethod: string;
  readonly distribution: string;
}

interface AttributionManifest {
  readonly schemaVersion: 1;
  readonly assetGroups: readonly AttributionGroup[];
}

const ASSET_EXTENSIONS = new Set([
  '.aac',
  '.aif',
  '.aiff',
  '.avif',
  '.bmp',
  '.eot',
  '.flac',
  '.gif',
  '.glb',
  '.gltf',
  '.heic',
  '.icns',
  '.ico',
  '.jpeg',
  '.jpg',
  '.ktx',
  '.ktx2',
  '.m4a',
  '.mid',
  '.midi',
  '.mov',
  '.mp3',
  '.mp4',
  '.ogg',
  '.opus',
  '.otf',
  '.png',
  '.svg',
  '.ttf',
  '.wav',
  '.webm',
  '.webp',
  '.woff',
  '.woff2',
]);

const SHIPPED_ASSET_ROOTS = Object.freeze(['assets', 'public', 'src', 'src-tauri'] as const);
const IGNORED_DIRECTORIES = new Set(['dist', 'node_modules', 'target']);

function walk(root: string): readonly string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) return [];
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function normalize(path: string): string {
  return path.split(sep).join('/');
}

function matches(pattern: string, path: string): boolean {
  return pattern.endsWith('/**') ? path.startsWith(pattern.slice(0, -2)) : path === pattern;
}

describe('runtime asset attribution', () => {
  it('covers every shipped asset exactly once with distribution metadata', () => {
    const projectRoot = process.cwd();
    const manifestPath = join(projectRoot, 'assets', 'attribution.json');
    expect(existsSync(manifestPath), 'assets/attribution.json must exist').toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as AttributionManifest;
    expect(manifest.schemaVersion).toBe(1);

    const shippedAssets = SHIPPED_ASSET_ROOTS.flatMap((root) => walk(join(projectRoot, root)))
      .filter((path) => ASSET_EXTENSIONS.has(extname(path).toLowerCase()))
      .map((path) => normalize(relative(projectRoot, path)))
      .sort();

    expect(shippedAssets.length).toBeGreaterThan(0);
    expect(new Set(manifest.assetGroups.map((group) => group.id)).size).toBe(
      manifest.assetGroups.length,
    );
    for (const group of manifest.assetGroups) {
      expect(group.id).toMatch(/^[a-z0-9-]+$/);
      expect(group.paths.length).toBeGreaterThan(0);
      expect(group.source.trim().length).toBeGreaterThan(0);
      expect(group.license.trim().length).toBeGreaterThan(0);
      expect(group.creationMethod.trim().length).toBeGreaterThan(0);
      expect(group.distribution.trim().length).toBeGreaterThan(0);
    }
    for (const asset of shippedAssets) {
      const owners = manifest.assetGroups.filter((group) =>
        group.paths.some((pattern) => matches(pattern, asset)),
      );
      expect(
        owners.map((group) => group.id),
        `${asset} attribution owners`,
      ).toHaveLength(1);
    }
    for (const group of manifest.assetGroups) {
      for (const pattern of group.paths) {
        expect(
          shippedAssets.some((asset) => matches(pattern, asset)),
          `${group.id} pattern ${pattern} must cover a shipped asset`,
        ).toBe(true);
      }
    }
  });
});
