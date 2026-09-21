import {
  createFocusSessionReview,
  projectFocusCheckpoint,
  type FocusCheckpointProjection,
  type FocusSessionReview,
} from '../../src/focus/session-review';
import { deserializeWorldSnapshot, serializeWorldSnapshot } from '../../src/simulation/persistence';
import { stepWorld, type WorldState } from '../../src/simulation/world';

export interface FocusSessionEvidence {
  readonly baseline: FocusCheckpointProjection;
  readonly completed: FocusCheckpointProjection;
  readonly review: FocusSessionReview;
  readonly snapshot: string;
  readonly world: WorldState;
}

/** Runs one accepted-focus interval and canonically reloads its exact factual checkpoint. */
export function runReviewedFocusSession(
  world: WorldState,
  acceptedFocusTicks: number,
): FocusSessionEvidence {
  const baseline = projectFocusCheckpoint(world, null);
  const advanced = stepWorld(world, acceptedFocusTicks);
  const completed = projectFocusCheckpoint(advanced, baseline.latestEventId);
  const review = createFocusSessionReview(baseline, completed);
  const snapshot = serializeWorldSnapshot(advanced);
  return {
    baseline,
    completed,
    review,
    snapshot,
    world: deserializeWorldSnapshot(snapshot),
  };
}
