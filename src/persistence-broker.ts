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
const gateway = createTauriPersistenceGateway(invokeTauri);

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
