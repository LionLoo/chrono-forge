export type RuntimeRenderReason = 'initial' | 'motion' | 'projection' | 'view';

export type RuntimeActivityEvent =
  | {
      readonly kind: 'worker-request';
      readonly messageType: string;
      readonly requestId: string;
    }
  | {
      readonly kind: 'worker-response';
      readonly messageType: string;
      readonly requestId: string;
    }
  | {
      readonly kind: 'frame-applied';
      readonly requestId: string;
      readonly source: 'delta' | 'ready';
      readonly tick: number;
    }
  | {
      readonly kind: 'render-applied';
      readonly reason: RuntimeRenderReason;
      readonly tick: number;
    };

export interface RuntimeActivityRecorder {
  record(event: RuntimeActivityEvent): void;
}

type RecordedRuntimeActivity<Event extends RuntimeActivityEvent> =
  Event extends RuntimeActivityEvent
    ? Event & {
        readonly observedAtMs: number;
        readonly sequence: number;
      }
    : never;

export type RuntimeActivitySample = RecordedRuntimeActivity<RuntimeActivityEvent>;

export interface TestRuntimeActivityRecorder extends RuntimeActivityRecorder {
  count(kind: RuntimeActivityEvent['kind']): number;
  latencyMs(requestId: string, completion: 'frame-applied' | 'worker-response'): number | null;
  samples(): readonly RuntimeActivitySample[];
  sequenceDistance(
    requestId: string,
    completion: 'frame-applied' | 'worker-response',
  ): number | null;
}

/** Test-only ordered activity recorder. Production callers provide no recorder. */
export function createTestRuntimeActivityRecorder(
  now: () => number = () => globalThis.performance.now(),
): TestRuntimeActivityRecorder {
  const recorded: RuntimeActivitySample[] = [];

  function completionSample(
    requestId: string,
    completion: 'frame-applied' | 'worker-response',
  ): readonly [RuntimeActivitySample, RuntimeActivitySample] | null {
    const request = recorded.find(
      (sample) => sample.kind === 'worker-request' && sample.requestId === requestId,
    );
    if (request === undefined) return null;
    const completed = recorded.find(
      (sample) =>
        sample.sequence > request.sequence &&
        sample.kind === completion &&
        sample.requestId === requestId,
    );
    return completed === undefined ? null : [request, completed];
  }

  return Object.freeze({
    record(event: RuntimeActivityEvent): void {
      recorded.push(
        Object.freeze({
          ...event,
          observedAtMs: now(),
          sequence: recorded.length + 1,
        }),
      );
    },
    count(kind: RuntimeActivityEvent['kind']): number {
      return recorded.filter((sample) => sample.kind === kind).length;
    },
    latencyMs(requestId: string, completion: 'frame-applied' | 'worker-response'): number | null {
      const pair = completionSample(requestId, completion);
      return pair === null ? null : pair[1].observedAtMs - pair[0].observedAtMs;
    },
    samples(): readonly RuntimeActivitySample[] {
      return Object.freeze([...recorded]);
    },
    sequenceDistance(
      requestId: string,
      completion: 'frame-applied' | 'worker-response',
    ): number | null {
      const pair = completionSample(requestId, completion);
      return pair === null ? null : pair[1].sequence - pair[0].sequence;
    },
  });
}
