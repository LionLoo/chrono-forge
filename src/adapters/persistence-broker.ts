import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event';

import type {
  LoadedSave,
  NativeSemanticSaveConfirmer,
  PersistenceGateway,
  TauriInvoke,
} from './persistence';

export const PERSISTENCE_BROKER_LABEL = 'persistence-broker';
export const PERSISTENCE_BROKER_CONFIRM_EVENT = 'chrono-forge://persistence-confirm';
export const PERSISTENCE_BROKER_CONFIRM_RESULT_EVENT = 'chrono-forge://persistence-confirm-result';
export const PERSISTENCE_BROKER_PING_EVENT = 'chrono-forge://persistence-ping';
export const PERSISTENCE_BROKER_READY_EVENT = 'chrono-forge://persistence-ready';

const BROKER_READY_TIMEOUT_MS = 10_000;
const BROKER_CONFIRM_TIMEOUT_MS = 30_000;

export interface SemanticSaveIdentity {
  readonly slotId: string;
  readonly generation: number;
  readonly checksum: string;
}

interface BrokerEnvelope<T> {
  readonly requestId: string;
  readonly value: T;
}

interface BrokerResult {
  readonly error: string | null;
  readonly requestId: string;
}

function waitForEvent<T>(
  eventName: string,
  requestId: string,
  timeoutMs: number,
  trigger: () => Promise<void>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let unlisten: UnlistenFn | null = null;
    const timeout = globalThis.setTimeout(() => {
      unlisten?.();
      reject(new Error(`The persistence validation broker did not answer within ${timeoutMs} ms.`));
    }, timeoutMs);
    void listen<BrokerEnvelope<T>>(eventName, (event) => {
      if (event.payload.requestId !== requestId) return;
      globalThis.clearTimeout(timeout);
      unlisten?.();
      resolve(event.payload.value);
    })
      .then((stopListening) => {
        unlisten = stopListening;
        return trigger();
      })
      .catch((error: unknown) => {
        globalThis.clearTimeout(timeout);
        unlisten?.();
        reject(error instanceof Error ? error : new Error(String(error)));
      });
  });
}

async function waitForBrokerReady(): Promise<void> {
  const requestId = globalThis.crypto.randomUUID();
  await waitForEvent<null>(PERSISTENCE_BROKER_READY_EVENT, requestId, BROKER_READY_TIMEOUT_MS, () =>
    emitTo(PERSISTENCE_BROKER_LABEL, PERSISTENCE_BROKER_PING_EVENT, {
      requestId,
      value: null,
    } satisfies BrokerEnvelope<null>),
  );
}

/**
 * Requests semantic confirmation from the isolated bundled validator. The visible webview cannot
 * call the destructive native confirmation command directly; Rust verifies the caller label.
 */
export const confirmSemanticSaveThroughBroker: NativeSemanticSaveConfirmer = async (
  _invoke,
  loaded,
) => {
  await requestSemanticSaveConfirmation(semanticSaveIdentity(loaded));
};

export async function requestSemanticSaveConfirmation(
  identity: SemanticSaveIdentity,
): Promise<void> {
  await waitForBrokerReady();
  const requestId = globalThis.crypto.randomUUID();
  const result = await waitForEvent<BrokerResult>(
    PERSISTENCE_BROKER_CONFIRM_RESULT_EVENT,
    requestId,
    BROKER_CONFIRM_TIMEOUT_MS,
    () =>
      emitTo(PERSISTENCE_BROKER_LABEL, PERSISTENCE_BROKER_CONFIRM_EVENT, {
        requestId,
        value: identity,
      } satisfies BrokerEnvelope<SemanticSaveIdentity>),
  );
  if (result.requestId !== requestId || result.error !== null) {
    throw new Error(result.error ?? 'The persistence validation broker returned the wrong result.');
  }
}

export function brokerEnvelope<T>(requestId: string, value: T): BrokerEnvelope<T> {
  return { requestId, value };
}

export function brokerResult(requestId: string, error: string | null): BrokerResult {
  return { error, requestId };
}

export function semanticSaveIdentity(loaded: LoadedSave): SemanticSaveIdentity {
  return {
    slotId: loaded.slotId,
    generation: loaded.recoveredGeneration,
    checksum: loaded.checksum,
  };
}

/** Performs the exact canonical parse in the isolated webview before native retention marking. */
export async function validateAndConfirmSemanticSave(
  gateway: PersistenceGateway,
  invoke: TauriInvoke,
  identity: SemanticSaveIdentity,
): Promise<void> {
  const loaded = await gateway.loadSaveSlot(identity.slotId);
  if (
    loaded?.recoveredGeneration !== identity.generation ||
    loaded?.checksum !== identity.checksum
  ) {
    throw new Error('The requested generation did not pass exact canonical snapshot validation.');
  }
  const validated = semanticSaveIdentity(loaded);
  await invoke('confirm_semantically_valid_save_generation', {
    slotId: validated.slotId,
    generation: validated.generation,
    checksum: validated.checksum,
  });
}
