import { vi } from 'vitest';

import {
  confirmFirstSemanticSavePerSlot,
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

  it('attempts one isolated semantic baseline per save slot in a native runtime', async () => {
    const confirm = vi.fn().mockResolvedValue(undefined);
    const invoke = vi.fn();
    const loaded = { slotId: 'alpha' };
    const confirmOnce = confirmFirstSemanticSavePerSlot(confirm);

    await confirmOnce(invoke, loaded as never);
    await confirmOnce(invoke, { slotId: 'alpha' } as never);
    await confirmOnce(invoke, { slotId: 'beta' } as never);

    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm).toHaveBeenNthCalledWith(1, invoke, loaded);
    expect(confirm).toHaveBeenNthCalledWith(2, invoke, { slotId: 'beta' });
  });

  it('does not turn a failed process baseline into repeated checkpoint retries', async () => {
    const confirm = vi.fn().mockRejectedValue(new Error('validator unavailable'));
    const invoke = vi.fn();
    const confirmOnce = confirmFirstSemanticSavePerSlot(confirm);

    await expect(confirmOnce(invoke, { slotId: 'alpha' } as never)).rejects.toThrow(
      'validator unavailable',
    );
    await expect(confirmOnce(invoke, { slotId: 'alpha' } as never)).resolves.toBeUndefined();
    await expect(confirmOnce(invoke, { slotId: 'beta' } as never)).rejects.toThrow(
      'validator unavailable',
    );
    expect(confirm).toHaveBeenCalledTimes(2);
  });
});
