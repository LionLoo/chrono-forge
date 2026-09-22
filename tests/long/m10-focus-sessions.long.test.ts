import { hashWorldState, createInitialWorld, stepWorld } from '../../src/simulation/world';
import { deserializeWorldSnapshot, serializeWorldSnapshot } from '../../src/simulation/persistence';
import { runReviewedFocusSession } from '../fixtures/m10-focus-session-evidence';

function assertFactualSession(
  evidence: ReturnType<typeof runReviewedFocusSession>,
  expectedTicks: number,
): void {
  expect(evidence.review.after.tick - evidence.review.before.tick).toBe(expectedTicks);
  expect(evidence.completed.moment).toStrictEqual(evidence.review.after);
  expect(evidence.completed.recapEntries.length).toBeLessThanOrEqual(12);
  expect(evidence.completed.recapEntries).toStrictEqual(
    evidence.world.eventLog
      .filter((event) => event.id > evidence.review.baselineEventId)
      .slice(-12)
      .map((event) => ({ id: event.id, tick: event.tick, summary: event.summary })),
  );
  const revisitSourceEventId = evidence.review.revisitTarget?.sourceEventId;
  if (revisitSourceEventId !== null && revisitSourceEventId !== undefined) {
    expect(evidence.completed.recapEntries.map((entry) => entry.id)).toContain(
      revisitSourceEventId,
    );
  }
  expect(serializeWorldSnapshot(evidence.world)).toBe(evidence.snapshot);
}

describe.sequential('M10.1 consecutive factual focus sessions', () => {
  it('preserves calm, exact continuity across consecutive early 25-minute sessions', () => {
    const first = runReviewedFocusSession(createInitialWorld([1, 2, 3, 4]), 15_000);
    const second = runReviewedFocusSession(first.world, 15_000);

    assertFactualSession(first, 15_000);
    assertFactualSession(second, 15_000);
    expect(second.review.before).toStrictEqual(first.review.after);
    expect(second.review.before.tick).toBe(15_000);
    expect(second.review.after.tick).toBe(30_000);
    expect(second.world.civilization.agents.filter((person) => person.alive)).toHaveLength(6);
  });

  it('resumes one canonical middle world after a days-away gap with offline progression disabled', () => {
    const middle = stepWorld(createInitialWorld([1, 2, 3, 4]), 600_000);
    const checkpoint = serializeWorldSnapshot(middle);
    // A multi-day wall-clock gap with offline progression disabled performs no simulation step.
    const afterDaysAway = deserializeWorldSnapshot(checkpoint);
    expect(afterDaysAway.tick).toBe(middle.tick);
    expect(hashWorldState(afterDaysAway)).toBe(hashWorldState(middle));

    const first = runReviewedFocusSession(afterDaysAway, 30_000);
    const second = runReviewedFocusSession(first.world, 30_000);

    assertFactualSession(first, 30_000);
    assertFactualSession(second, 30_000);
    expect(second.review.before).toStrictEqual(first.review.after);
    expect(second.review.before.tick).toBe(630_000);
    expect(second.review.after.tick).toBe(660_000);
  }, 30_000);
});
