/** A deterministic port of xoshiro128** 1.1 (public domain reference). */
export type Xoshiro128State = readonly [number, number, number, number];

const UINT32_RANGE = 0x1_0000_0000;

function uint32(value: number): number {
  return value >>> 0;
}

function rotateLeft(value: number, bits: number): number {
  return uint32((value << bits) | (value >>> (32 - bits)));
}

function normalizeWords(state: Xoshiro128State): Xoshiro128State {
  if (
    state.length !== 4 ||
    state.some((word) => !Number.isSafeInteger(word) || word < 0 || word > 0xffff_ffff)
  ) {
    throw new RangeError('xoshiro128** state must contain exactly four uint32 words.');
  }
  const normalized: Xoshiro128State = [
    uint32(state[0]),
    uint32(state[1]),
    uint32(state[2]),
    uint32(state[3]),
  ];

  return normalized;
}

function validateState(state: Xoshiro128State): Xoshiro128State {
  const normalized = normalizeWords(state);
  if ((normalized[0] | normalized[1] | normalized[2] | normalized[3]) === 0) {
    throw new RangeError('xoshiro128** state must not be all zero.');
  }

  return normalized;
}

/**
 * Mutable only inside this RNG object. Its exact four-word state can be saved
 * and restored without changing the subsequent sequence.
 */
export class Xoshiro128StarStar {
  #s0: number;
  #s1: number;
  #s2: number;
  #s3: number;

  public constructor(state: Xoshiro128State) {
    const normalized = validateState(state);
    this.#s0 = normalized[0];
    this.#s1 = normalized[1];
    this.#s2 = normalized[2];
    this.#s3 = normalized[3];
  }

  public nextUint32(): number {
    const result = uint32(Math.imul(rotateLeft(Math.imul(this.#s1, 5), 7), 9));
    const temporary = uint32(this.#s1 << 9);

    this.#s2 = uint32(this.#s2 ^ this.#s0);
    this.#s3 = uint32(this.#s3 ^ this.#s1);
    this.#s1 = uint32(this.#s1 ^ this.#s2);
    this.#s0 = uint32(this.#s0 ^ this.#s3);
    this.#s2 = uint32(this.#s2 ^ temporary);
    this.#s3 = rotateLeft(this.#s3, 11);

    return result;
  }

  /** Returns a uniform integer in [0, exclusiveMaximum) using rejection sampling. */
  public nextInt(exclusiveMaximum: number): number {
    if (
      !Number.isSafeInteger(exclusiveMaximum) ||
      exclusiveMaximum <= 0 ||
      exclusiveMaximum > UINT32_RANGE
    ) {
      throw new RangeError('Bounded RNG maximum must be a positive uint32-sized safe integer.');
    }

    const acceptanceLimit = UINT32_RANGE - (UINT32_RANGE % exclusiveMaximum);
    let candidate: number;
    do {
      candidate = this.nextUint32();
    } while (candidate >= acceptanceLimit);

    return candidate % exclusiveMaximum;
  }

  public save(): Xoshiro128State {
    return [this.#s0, this.#s1, this.#s2, this.#s3];
  }

  public restore(state: Xoshiro128State): void {
    const normalized = validateState(state);
    this.#s0 = normalized[0];
    this.#s1 = normalized[1];
    this.#s2 = normalized[2];
    this.#s3 = normalized[3];
  }
}

function mix32(value: number): number {
  let mixed = uint32(value);
  mixed = uint32(Math.imul(mixed ^ (mixed >>> 16), 0x21f0aaad));
  mixed = uint32(Math.imul(mixed ^ (mixed >>> 15), 0x735a2d97));
  return uint32(mixed ^ (mixed >>> 15));
}

function streamLabelHash(label: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < label.length; index += 1) {
    hash = uint32(Math.imul(hash ^ label.charCodeAt(index), 0x01000193));
  }

  return hash;
}

/** Derives an independent deterministic stream state from a four-word root and stable label. */
export function deriveXoshiro128State(root: Xoshiro128State, label: string): Xoshiro128State {
  const normalized = normalizeWords(root);
  const labelHash = streamLabelHash(label);
  const derived: Xoshiro128State = [
    mix32(normalized[0] ^ labelHash ^ 0x9e3779b9),
    mix32(normalized[1] ^ rotateLeft(labelHash, 7) ^ 0x243f6a88),
    mix32(normalized[2] ^ rotateLeft(labelHash, 13) ^ 0xb7e15162),
    mix32(normalized[3] ^ rotateLeft(labelHash, 21) ^ 0xdeadbeef),
  ];

  return (derived[0] | derived[1] | derived[2] | derived[3]) === 0 ? [1, 0, 0, 0] : derived;
}
