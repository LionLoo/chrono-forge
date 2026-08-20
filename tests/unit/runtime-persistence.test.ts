import { vi } from 'vitest';

import {
  createRuntimePersistence,
  getRuntimePersistence,
} from '../../src/adapters/runtime-persistence';
import type { PersistenceGateway, TauriInvoke } from '../../src/adapters/persistence';

describe('runtime persistence selection', () => {
  it('uses one process-local browser preview when Tauri is unavailable', () => {
    const createBrowserGateway = vi.fn(() => ({}) as PersistenceGateway);
    const runtime = createRuntimePersistence({
      detectTauri: () => false,
      createBrowserGateway,
    });

    expect(runtime.mode).toBe('browser-preview');
    expect(createBrowserGateway).toHaveBeenCalledOnce();
    expect(getRuntimePersistence()).toBe(getRuntimePersistence());
  });

  it('routes desktop commands through the validated Tauri gateway', async () => {
    const invokeTauri: TauriInvoke = vi.fn((command) => {
      expect(command).toBe('list_save_slots');
      return Promise.resolve([] as never);
    });
    const runtime = createRuntimePersistence({
      detectTauri: () => true,
      invokeTauri,
      createBrowserGateway: () => {
        throw new Error('browser gateway must not be created');
      },
    });

    expect(runtime.mode).toBe('native');
    await expect(runtime.gateway.listSaveSlots()).resolves.toEqual([]);
    expect(invokeTauri).toHaveBeenCalledWith('list_save_slots');
  });
});
