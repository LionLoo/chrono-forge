import { invoke, isTauri } from '@tauri-apps/api/core';

import { confirmSemanticSaveThroughBroker } from './persistence-broker';
import {
  createInMemoryPersistenceGateway,
  createTauriPersistenceGateway,
  type NativeSemanticSaveConfirmer,
  type PersistenceGateway,
  type TauriInvoke,
} from './persistence';

export type PersistenceMode = 'native' | 'browser-preview';

export interface RuntimePersistence {
  readonly gateway: PersistenceGateway;
  readonly mode: PersistenceMode;
}

interface RuntimePersistenceDependencies {
  readonly detectTauri?: () => boolean;
  readonly invokeTauri?: TauriInvoke;
  readonly confirmSemanticSave?: NativeSemanticSaveConfirmer;
  readonly createBrowserGateway?: () => PersistenceGateway;
}

const invokeTauri: TauriInvoke = (command, arguments_) => invoke(command, arguments_);

export function confirmFirstSemanticSavePerSlot(
  confirmSemanticSave: NativeSemanticSaveConfirmer,
): NativeSemanticSaveConfirmer {
  const attemptedSlotIds = new Set<string>();
  return async (invokeConfirmation, loaded) => {
    if (attemptedSlotIds.has(loaded.slotId)) return;
    attemptedSlotIds.add(loaded.slotId);
    await confirmSemanticSave(invokeConfirmation, loaded);
  };
}

/**
 * Selects the narrow native command boundary without making browser preview
 * builds depend on a mocked Tauri global.
 */
export function createRuntimePersistence(
  dependencies: RuntimePersistenceDependencies = {},
): RuntimePersistence {
  const detectTauri = dependencies.detectTauri ?? isTauri;
  if (detectTauri()) {
    return {
      gateway: createTauriPersistenceGateway(
        dependencies.invokeTauri ?? invokeTauri,
        confirmFirstSemanticSavePerSlot(
          dependencies.confirmSemanticSave ?? confirmSemanticSaveThroughBroker,
        ),
      ),
      mode: 'native',
    };
  }

  return {
    gateway: (dependencies.createBrowserGateway ?? createInMemoryPersistenceGateway)(),
    mode: 'browser-preview',
  };
}

let sharedRuntimePersistence: RuntimePersistence | null = null;

/** Preserves the process-local browser preview across React remounts. */
export function getRuntimePersistence(): RuntimePersistence {
  sharedRuntimePersistence ??= createRuntimePersistence();
  return sharedRuntimePersistence;
}
