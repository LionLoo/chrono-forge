import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';

import {
  PERSISTENCE_BROKER_CONFIRM_EVENT,
  PERSISTENCE_BROKER_CONFIRM_RESULT_EVENT,
  PERSISTENCE_BROKER_PING_EVENT,
  PERSISTENCE_BROKER_READY_EVENT,
  brokerEnvelope,
  brokerResult,
  validateAndConfirmSemanticSave,
  type SemanticSaveIdentity,
} from './adapters/persistence-broker';
import { createTauriPersistenceGateway, type TauriInvoke } from './adapters/persistence';

const MAIN_WINDOW_LABEL = 'main';
const invokeTauri: TauriInvoke = (command, arguments_) => invoke(command, arguments_);
// validateAndConfirmSemanticSave performs the single exact identity-bound confirmation after the
// broker gateway loads and canonically parses the requested generation. Disable the gateway's
// ordinary post-load confirmation here to avoid recursion or confirming a fallback before the
// requested identity has been compared.
const gateway = createTauriPersistenceGateway(invokeTauri, () => Promise.resolve());

export async function startPersistenceBroker(): Promise<void> {
  await listen<ReturnType<typeof brokerEnvelope<null>>>(PERSISTENCE_BROKER_PING_EVENT, (event) => {
    void emitTo(
      MAIN_WINDOW_LABEL,
      PERSISTENCE_BROKER_READY_EVENT,
      brokerEnvelope(event.payload.requestId, null),
    );
  });

  await listen<ReturnType<typeof brokerEnvelope<SemanticSaveIdentity>>>(
    PERSISTENCE_BROKER_CONFIRM_EVENT,
    (event) => {
      void (async () => {
        const { requestId, value } = event.payload;
        let error: string | null = null;
        try {
          await validateAndConfirmSemanticSave(gateway, invokeTauri, value);
        } catch (reason) {
          error = reason instanceof Error ? reason.message : String(reason);
        }
        await emitTo(
          MAIN_WINDOW_LABEL,
          PERSISTENCE_BROKER_CONFIRM_RESULT_EVENT,
          brokerEnvelope(requestId, brokerResult(requestId, error)),
        );
      })();
    },
  );
}
