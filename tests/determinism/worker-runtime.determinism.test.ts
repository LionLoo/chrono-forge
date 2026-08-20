import { WORKER_PROTOCOL_VERSION, type WorkerToUiMessage } from '../../src/protocol';
import { createInitialWorld, hashWorldState, stepWorld } from '../../src/simulation/world';
import { createSimulationRuntime } from '../../src/workers/simulation-runtime';

describe('worker runtime determinism', () => {
  it('matches the main-runtime world hash for the same seed and fixed tick count', () => {
    const seed = [101, 202, 303, 404] as const;
    const mainRuntimeHash = hashWorldState(stepWorld(createInitialWorld(seed), 250));
    const responses: WorkerToUiMessage[] = [];
    const workerRuntime = createSimulationRuntime((message) => responses.push(message));

    workerRuntime.handleMessage({
      type: 'initialize',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'initialize',
      seed,
    });
    workerRuntime.handleMessage({
      type: 'advanceTicks',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'advance',
      ticks: 250,
    });

    const frame = responses.find((message) => message.type === 'frameDelta');
    expect(frame?.type).toBe('frameDelta');
    if (frame?.type !== 'frameDelta') {
      throw new Error('Worker runtime did not emit a frame delta.');
    }
    expect(frame.frame.stateHash).toBe(mainRuntimeHash);
  });
});
