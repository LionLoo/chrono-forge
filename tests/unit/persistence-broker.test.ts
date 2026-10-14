import { vi } from 'vitest';

const eventMocks = vi.hoisted(() => {
  type Listener = (event: { payload: unknown }) => unknown;
  const listeners = new Map<string, Set<Listener>>();
  return {
    emitTo: vi.fn(async (_target: string, eventName: string, payload: unknown) => {
      await Promise.all(
        [...(listeners.get(eventName) ?? [])].map((listener) => listener({ payload })),
      );
    }),
    listen: vi.fn((eventName: string, listener: Listener) => {
      const eventListeners = listeners.get(eventName) ?? new Set<Listener>();
      eventListeners.add(listener);
      listeners.set(eventName, eventListeners);
      return Promise.resolve(() => eventListeners.delete(listener));
    }),
    listeners,
  };
});

vi.mock('@tauri-apps/api/event', () => ({
  emitTo: eventMocks.emitTo,
  listen: eventMocks.listen,
}));

import {
  PERSISTENCE_BROKER_CONFIRM_EVENT,
  PERSISTENCE_BROKER_CONFIRM_RESULT_EVENT,
  PERSISTENCE_BROKER_PING_EVENT,
  PERSISTENCE_BROKER_READY_EVENT,
  PERSISTENCE_BROKER_RETIRED_EVENT,
  brokerEnvelope,
  brokerResult,
  requestSemanticSaveConfirmation,
  validateAndConfirmSemanticSave,
  type SemanticSaveIdentity,
} from '../../src/adapters/persistence-broker';
import type { LoadedSave, PersistenceGateway, TauriInvoke } from '../../src/adapters/persistence';

const identity: SemanticSaveIdentity = {
  slotId: 'alpha',
  generation: 4,
  checksum: 'a'.repeat(64),
};

const loaded: LoadedSave = {
  slotId: identity.slotId,
  name: 'Alpha',
  headGeneration: identity.generation,
  recoveredGeneration: identity.generation,
  recoveredFromCorruption: false,
  savedAtMs: 1,
  focusSession: null,
  snapshot: '{}',
  checksum: identity.checksum,
};

function gatewayReturning(value: LoadedSave | null): PersistenceGateway {
  return {
    loadSaveSlot: vi.fn().mockResolvedValue(value),
  } as unknown as PersistenceGateway;
}

describe('isolated persistence semantic validation broker', () => {
  beforeEach(() => {
    eventMocks.emitTo.mockClear();
    eventMocks.listen.mockClear();
    eventMocks.listeners.clear();
  });

  it('confirms only the exact generation accepted by the canonical gateway', async () => {
    const invoke: TauriInvoke = vi.fn().mockResolvedValue(undefined);

    await validateAndConfirmSemanticSave(gatewayReturning(loaded), invoke, identity);

    expect(invoke).toHaveBeenCalledWith('confirm_semantically_valid_save_generation', {
      slotId: identity.slotId,
      generation: identity.generation,
      checksum: identity.checksum,
    });
  });

  it.each([
    null,
    { ...loaded, recoveredGeneration: identity.generation - 1 },
    { ...loaded, checksum: 'b'.repeat(64) },
  ])(
    'rejects absent or mismatched canonical authority without invoking native confirmation',
    async (candidate) => {
      const invoke: TauriInvoke = vi.fn().mockResolvedValue(undefined);

      await expect(
        validateAndConfirmSemanticSave(gatewayReturning(candidate), invoke, identity),
      ).rejects.toThrow(/exact canonical snapshot validation/i);
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it('creates the validator on demand and resolves only after its matching retirement', async () => {
    const invoke: TauriInvoke = vi.fn().mockResolvedValue(undefined);
    let releaseRetirement: (() => void) | undefined;
    const retirementGate = new Promise<void>((resolve) => {
      releaseRetirement = resolve;
    });
    await eventMocks.listen(PERSISTENCE_BROKER_PING_EVENT, async (event) => {
      await eventMocks.emitTo('main', PERSISTENCE_BROKER_READY_EVENT, event.payload);
    });
    await eventMocks.listen(PERSISTENCE_BROKER_CONFIRM_EVENT, async (event) => {
      const request = event.payload as ReturnType<typeof brokerEnvelope<SemanticSaveIdentity>>;
      await eventMocks.emitTo(
        'main',
        PERSISTENCE_BROKER_CONFIRM_RESULT_EVENT,
        brokerEnvelope(request.requestId, brokerResult(request.requestId, null)),
      );
      await retirementGate;
      await eventMocks.emitTo(
        'main',
        PERSISTENCE_BROKER_RETIRED_EVENT,
        brokerEnvelope(request.requestId, null),
      );
    });

    let settled = false;
    const confirmation = requestSemanticSaveConfirmation(invoke, identity).finally(() => {
      settled = true;
    });
    await vi.waitFor(() =>
      expect(eventMocks.emitTo).toHaveBeenCalledWith(
        'main',
        PERSISTENCE_BROKER_CONFIRM_RESULT_EVENT,
        expect.anything(),
      ),
    );
    expect(settled).toBe(false);
    releaseRetirement?.();
    await expect(confirmation).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith('ensure_persistence_broker');
  });

  it('serializes different-slot confirmations through the single validator lifecycle', async () => {
    const invoke: TauriInvoke = vi.fn().mockResolvedValue(undefined);
    let releaseFirstRetirement: (() => void) | undefined;
    const firstRetirementGate = new Promise<void>((resolve) => {
      releaseFirstRetirement = resolve;
    });
    const confirmedRequestIds: string[] = [];
    await eventMocks.listen(PERSISTENCE_BROKER_PING_EVENT, async (event) => {
      await eventMocks.emitTo('main', PERSISTENCE_BROKER_READY_EVENT, event.payload);
    });
    await eventMocks.listen(PERSISTENCE_BROKER_CONFIRM_EVENT, async (event) => {
      const request = event.payload as ReturnType<typeof brokerEnvelope<SemanticSaveIdentity>>;
      confirmedRequestIds.push(request.requestId);
      await eventMocks.emitTo(
        'main',
        PERSISTENCE_BROKER_CONFIRM_RESULT_EVENT,
        brokerEnvelope(request.requestId, brokerResult(request.requestId, null)),
      );
      if (confirmedRequestIds.length === 1) await firstRetirementGate;
      await eventMocks.emitTo(
        'main',
        PERSISTENCE_BROKER_RETIRED_EVENT,
        brokerEnvelope(request.requestId, null),
      );
    });

    const first = requestSemanticSaveConfirmation(invoke, identity);
    const second = requestSemanticSaveConfirmation(invoke, {
      ...identity,
      slotId: 'beta',
    });
    await vi.waitFor(() => expect(confirmedRequestIds).toHaveLength(1));
    await Promise.resolve();
    expect(confirmedRequestIds).toHaveLength(1);

    releaseFirstRetirement?.();
    await expect(first).resolves.toBeUndefined();
    await vi.waitFor(() => expect(confirmedRequestIds).toHaveLength(2));
    await expect(second).resolves.toBeUndefined();
    expect(confirmedRequestIds[0]).not.toBe(confirmedRequestIds[1]);
  });

  it('propagates the broker error after matching retirement', async () => {
    const invoke: TauriInvoke = vi.fn().mockResolvedValue(undefined);
    await eventMocks.listen(PERSISTENCE_BROKER_PING_EVENT, async (event) => {
      await eventMocks.emitTo('main', PERSISTENCE_BROKER_READY_EVENT, event.payload);
    });
    await eventMocks.listen(PERSISTENCE_BROKER_CONFIRM_EVENT, async (event) => {
      const request = event.payload as ReturnType<typeof brokerEnvelope<SemanticSaveIdentity>>;
      await eventMocks.emitTo(
        'main',
        PERSISTENCE_BROKER_CONFIRM_RESULT_EVENT,
        brokerEnvelope(
          request.requestId,
          brokerResult(request.requestId, 'canonical parse failed'),
        ),
      );
      await eventMocks.emitTo(
        'main',
        PERSISTENCE_BROKER_RETIRED_EVENT,
        brokerEnvelope(request.requestId, null),
      );
    });

    await expect(requestSemanticSaveConfirmation(invoke, identity)).rejects.toThrow(
      'canonical parse failed',
    );
  });
});
