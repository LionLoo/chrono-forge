import { createInitialWorld, hashWorldState } from '../../src/simulation/world';

function seedFor(index: number): readonly [number, number, number, number] {
  return [index + 1, index * 17 + 3, index * 31 + 5, index * 47 + 7];
}

function generatedIdentity(index: number) {
  const world = createInitialWorld(seedFor(index));
  return {
    hash: hashWorldState(world),
    personRoots: world.civilization.society.people.map((person) => person.name.split('-')[0]!),
    cultureNames: world.civilization.society.cultures.map((culture) => culture.name),
    beliefs: world.civilization.society.cultures.map((culture) => culture.belief),
    traditions: world.civilization.society.cultures.map((culture) => culture.tradition),
    styles: world.civilization.society.cultures.map((culture) => culture.architectureStyle),
    bodyNames: world.space.bodies.map((body) => body.name),
  };
}

describe('release content breadth', () => {
  it('is deterministic for identical seeds', () => {
    expect(generatedIdentity(9)).toStrictEqual(generatedIdentity(9));
  });

  it('provides broad cultural, personal, architectural, and celestial identity', () => {
    const identities = Array.from({ length: 64 }, (_, index) => generatedIdentity(index));
    const distinct = (values: readonly string[]) => new Set(values).size;

    expect(distinct(identities.flatMap((identity) => identity.hash))).toBe(64);
    expect(distinct(identities.flatMap((identity) => identity.personRoots))).toBeGreaterThanOrEqual(
      32,
    );
    expect(
      distinct(identities.flatMap((identity) => identity.cultureNames)),
    ).toBeGreaterThanOrEqual(24);
    expect(distinct(identities.flatMap((identity) => identity.beliefs))).toBeGreaterThanOrEqual(12);
    expect(distinct(identities.flatMap((identity) => identity.traditions))).toBeGreaterThanOrEqual(
      16,
    );
    expect(distinct(identities.flatMap((identity) => identity.styles))).toBeGreaterThanOrEqual(16);
    expect(distinct(identities.flatMap((identity) => identity.bodyNames))).toBeGreaterThanOrEqual(
      32,
    );
    expect(identities.flatMap((identity) => identity.bodyNames)).not.toContainEqual(
      expect.stringMatching(/^Body-\d+$/),
    );
  });
});
