import {
  createFocusSessionReview,
  projectFocusCheckpoint,
  validateFocusSessionReview,
} from '../../src/focus/session-review';
import { createInitialWorld, stepWorld } from '../../src/simulation/world';

describe('M10.1 factual focus-session review', () => {
  it('captures one exact baseline and authoritative post-baseline events', () => {
    const initial = createInitialWorld([1, 2, 3, 4]);
    const baseline = projectFocusCheckpoint(initial, null);
    const advanced = stepWorld(initial, 15_000);
    const completed = projectFocusCheckpoint(advanced, baseline.latestEventId);
    const review = createFocusSessionReview(baseline, completed);

    expect(baseline).toMatchObject({
      latestEventId: 2,
      moment: {
        tick: 0,
        detailedPopulation: 6,
        activeSettlements: 1,
        leadingSettlement: {
          id: 1,
          developmentStage: 'founding',
        },
      },
      recapEntries: [],
    });
    expect(completed.moment.tick).toBe(15_000);
    expect(completed.recapEntries).toStrictEqual(
      advanced.eventLog
        .filter((event) => event.id > baseline.latestEventId)
        .slice(-12)
        .map((event) => ({ id: event.id, tick: event.tick, summary: event.summary })),
    );
    expect(review).toMatchObject({
      version: 1,
      baselineEventId: 2,
      before: baseline.moment,
      after: completed.moment,
    });
    expect(review.revisitTarget?.label.length).toBeGreaterThan(0);
    expect(validateFocusSessionReview(review)).toBe(review);
  });

  it('reports a quiet interval honestly and chooses a bounded factual revisit target', () => {
    const initial = createInitialWorld([1, 2, 3, 4]);
    const baseline = projectFocusCheckpoint(initial, null);
    const quiet = projectFocusCheckpoint(stepWorld(initial, 1), baseline.latestEventId);
    const review = createFocusSessionReview(baseline, quiet);

    expect(quiet.recapEntries).toEqual([]);
    expect(review.after.tick - review.before.tick).toBe(1);
    expect(review.revisitTarget).toMatchObject({
      kind: 'settlement',
      id: 1,
    });
  });

  it('rejects changed baselines, backwards time, and unbounded or malformed display copy', () => {
    const initial = createInitialWorld([1, 2, 3, 4]);
    const baseline = projectFocusCheckpoint(initial, null);
    const completed = projectFocusCheckpoint(stepWorld(initial, 100), baseline.latestEventId);
    const review = createFocusSessionReview(baseline, completed);

    expect(() =>
      validateFocusSessionReview({ ...review, baselineEventId: Number.MAX_SAFE_INTEGER + 1 }),
    ).toThrow(/baseline/i);
    expect(() =>
      validateFocusSessionReview({ ...review, after: { ...review.after, tick: -1 } }),
    ).toThrow(/moment/i);
    expect(() =>
      validateFocusSessionReview({
        ...review,
        revisitTarget: { kind: 'settlement', id: 1, label: ' '.repeat(81), sourceEventId: null },
      }),
    ).toThrow(/revisit/i);
  });
});
