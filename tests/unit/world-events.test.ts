import { appendWorldEvent, createInitialWorld } from '../../src/simulation/world';

describe('world event reference admission', () => {
  it('accepts resolved typed references and rejects unknown or unresolved ones eagerly', () => {
    const world = createInitialWorld([1, 2, 3, 4]);
    const appended = appendWorldEvent(world, 'household-observed', world.tick, {
      subjectKind: 'person',
      subjectId: 1,
      targetKind: 'household',
      targetId: 1,
      summary: 'A founder observed their household.',
    });

    expect(appended.eventLog).toHaveLength(world.eventLog.length + 1);
    expect(() =>
      appendWorldEvent(world, 'unknown-kind', world.tick, {
        subjectKind: 'unknown' as never,
        subjectId: 1,
      }),
    ).toThrow(/references/i);
    for (const details of [
      { subjectKind: 'person' as const, subjectId: 999 },
      { targetKind: 'structure' as const, targetId: 999 },
      { targetKind: 'household' as const, targetId: 999 },
      { targetKind: 'culture' as const, targetId: 999 },
      { targetKind: 'group' as const, targetId: 999 },
      { targetKind: 'institution' as const, targetId: 999 },
      { subjectKind: 'world' as const, subjectId: 1 },
      { targetKind: 'world' as const, targetId: 1 },
      { subjectKind: 'person' as const, subjectId: 0 },
    ]) {
      expect(() => appendWorldEvent(world, 'invalid-reference', world.tick, details)).toThrow(
        /references/i,
      );
    }
  });
});
