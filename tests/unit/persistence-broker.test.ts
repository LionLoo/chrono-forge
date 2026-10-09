import { vi } from 'vitest';

import {
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
});
