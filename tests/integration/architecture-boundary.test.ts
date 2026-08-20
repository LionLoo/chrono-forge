import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const simulationRoot = path.resolve(import.meta.dirname, '../../src/simulation');
const forbiddenPatterns = [
  /\bDate\.now\s*\(/,
  /\bMath\.random\s*\(/,
  /\bperformance\.now\s*\(/,
  /from\s+['"](?:react|pixi\.js|@tauri-apps\/)/,
  /\b(?:document|window)\./,
] as const;

async function listTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory()
        ? listTypeScriptFiles(entryPath)
        : entry.name.endsWith('.ts')
          ? [entryPath]
          : [];
    }),
  );
  return paths.flat().sort();
}

describe('authoritative simulation boundary', () => {
  it('contains no wall-clock, ambient randomness, UI, rendering, or desktop imports', async () => {
    const files = await listTypeScriptFiles(simulationRoot);
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      for (const pattern of forbiddenPatterns) {
        expect(source, `${path.relative(simulationRoot, file)} matched ${pattern}`).not.toMatch(
          pattern,
        );
      }
    }
  });
});
