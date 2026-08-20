import {
  WORKER_PROTOCOL_VERSION,
  type UiToWorkerMessage,
  type WorkerToUiMessage,
} from '../../src/protocol';
import { createSimulationRuntime } from '../../src/workers/simulation-runtime';

function messageOfType<TType extends WorkerToUiMessage['type']>(
  messages: readonly WorkerToUiMessage[],
  type: TType,
): Extract<WorkerToUiMessage, { type: TType }> {
  const message = messages.find((candidate) => candidate.type === type);
  if (message === undefined) {
    throw new Error(`Expected ${type} response.`);
  }
  return message as Extract<WorkerToUiMessage, { type: TType }>;
}

function lastMessageOfType<TType extends WorkerToUiMessage['type']>(
  messages: readonly WorkerToUiMessage[],
  type: TType,
): Extract<WorkerToUiMessage, { type: TType }> {
  return messageOfType([...messages].reverse(), type);
}

describe('simulation worker runtime', () => {
  it('initializes and advances a world using only typed messages', () => {
    const responses: WorkerToUiMessage[] = [];
    const runtime = createSimulationRuntime((message) => responses.push(message));
    const initialize: UiToWorkerMessage = {
      type: 'initialize',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'initialize',
      seed: [10, 20, 30, 40],
    };
    runtime.handleMessage(initialize);

    const ready = messageOfType(responses, 'ready');
    expect(ready.frame.tick).toBe(0);
    expect(ready.frame.biome.length).toBe(ready.frame.width * ready.frame.height);

    runtime.handleMessage({
      type: 'advanceTicks',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'advance',
      ticks: 7,
    });
    const frame = messageOfType(responses, 'frameDelta');
    expect(frame.frame.tick).toBe(7);
    expect(lastMessageOfType(responses, 'metrics').metrics.tick).toBe(7);
  });

  it('returns typed faults for uninitialized, unsupported, and wrong-version operations', () => {
    const responses: WorkerToUiMessage[] = [];
    const runtime = createSimulationRuntime((message) => responses.push(message));
    runtime.handleMessage({
      type: 'advanceTicks',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'uninitialized',
      ticks: 1,
    });
    runtime.handleMessage({
      type: 'queueCommand',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'command',
      command: { kind: 'focus-session', payload: {} },
    });
    runtime.handleMessage({
      type: 'requestSave',
      protocolVersion: 2,
      requestId: 'wrong-version',
    });

    expect(responses).toMatchObject([
      { type: 'fault', code: 'not-initialized' },
      { type: 'fault', code: 'unsupported-operation' },
      { type: 'fault', code: 'protocol-version-mismatch' },
    ]);
  });

  it('contains malformed structured-clone input behind typed invalid-request faults', () => {
    const responses: WorkerToUiMessage[] = [];
    const runtime = createSimulationRuntime((message) => responses.push(message));
    const malformedMessages: readonly unknown[] = [
      null,
      {},
      { requestId: 'missing-type', protocolVersion: WORKER_PROTOCOL_VERSION },
      {
        requestId: 'bad-ticks',
        type: 'advanceTicks',
        protocolVersion: WORKER_PROTOCOL_VERSION,
        ticks: 'seven',
      },
      {
        requestId: 'bad-seed',
        type: 'initialize',
        protocolVersion: WORKER_PROTOCOL_VERSION,
        seed: [1, 2, 3],
      },
      {
        requestId: 'unknown-type',
        type: 'eraseWorld',
        protocolVersion: WORKER_PROTOCOL_VERSION,
      },
    ];

    for (const message of malformedMessages) {
      expect(() => runtime.handleMessage(message)).not.toThrow();
    }

    expect(responses).toMatchObject([
      { type: 'fault', code: 'invalid-request', requestId: 'invalid-request' },
      { type: 'fault', code: 'invalid-request', requestId: 'invalid-request' },
      { type: 'fault', code: 'invalid-request', requestId: 'missing-type' },
      { type: 'fault', code: 'invalid-request', requestId: 'bad-ticks' },
      { type: 'fault', code: 'invalid-request', requestId: 'bad-seed' },
      { type: 'fault', code: 'invalid-request', requestId: 'unknown-type' },
    ]);
  });

  it('preserves the version fault for numeric unsupported versions before request-specific validation', () => {
    const responses: WorkerToUiMessage[] = [];
    const runtime = createSimulationRuntime((message) => responses.push(message));

    expect(() =>
      runtime.handleMessage({
        requestId: 'old-client',
        type: 'advanceTicks',
        protocolVersion: 99,
        ticks: 'not checked for an unsupported protocol version',
      }),
    ).not.toThrow();

    expect(responses).toMatchObject([
      {
        type: 'fault',
        code: 'protocol-version-mismatch',
        requestId: 'old-client',
      },
    ]);
  });
});
