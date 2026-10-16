import type { WorldSeed } from '../simulation/world';

export const WORLD_SEED_PATTERN = /^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{8}){3}$/;

export function formatWorldSeed(seed: WorldSeed): string {
  return seed.map((word) => word.toString(16).padStart(8, '0')).join('-');
}

export function parseWorldSeed(value: string): WorldSeed | null {
  if (!WORLD_SEED_PATTERN.test(value)) return null;
  const words = value.split('-').map((word) => Number.parseInt(word, 16));
  if (words.length !== 4) return null;
  return Object.freeze([words[0]!, words[1]!, words[2]!, words[3]!]);
}

export type WorldSeedRandomSource = (values: Uint32Array<ArrayBuffer>) => Uint32Array<ArrayBuffer>;

export function createRandomWorldSeed(
  randomSource: WorldSeedRandomSource = (values) => {
    globalThis.crypto.getRandomValues(values);
    return values;
  },
): WorldSeed {
  const words = randomSource(new Uint32Array(new ArrayBuffer(4 * Uint32Array.BYTES_PER_ELEMENT)));
  if (!(words instanceof Uint32Array) || words.length !== 4) {
    throw new TypeError('World seed randomness must return four uint32 words.');
  }
  // Reserve the visibly ambiguous all-zero value rather than silently producing it.
  if (words.every((word) => word === 0)) words[3] = 1;
  return Object.freeze([words[0]!, words[1]!, words[2]!, words[3]!]);
}
