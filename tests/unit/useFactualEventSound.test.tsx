import { renderHook, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import { DEFAULT_APP_SETTINGS, type AppSettings } from '../../src/adapters/persistence';
import type { GameSoundscape } from '../../src/adapters/soundscape';
import type { WorkerEvent } from '../../src/protocol';
import { useFactualEventSound } from '../../src/ui/useFactualEventSound';

function event(id: number, type: string): WorkerEvent {
  return {
    amount: 0,
    id,
    subjectId: 0,
    subjectKind: 'world',
    summary: `${type}.`,
    targetId: 0,
    targetKind: 'world',
    tick: id,
    tileIndex: 0,
    type,
  };
}

describe('one-shot factual event sound routing', () => {
  it('does not replay the last factual cue when audio settings change', async () => {
    const playCue = vi.fn<GameSoundscape['playCue']>();
    const soundscape: GameSoundscape = {
      playCue,
      stop: vi.fn<GameSoundscape['stop']>(),
      updateAtmosphere: vi.fn<GameSoundscape['updateAtmosphere']>(),
    };
    const firstBatch = [event(1, 'alien-contacted')];
    const { rerender } = renderHook(
      ({ events, settings }: { events: readonly WorkerEvent[]; settings: AppSettings }) =>
        useFactualEventSound(events, settings, soundscape),
      { initialProps: { events: firstBatch, settings: DEFAULT_APP_SETTINGS } },
    );

    await waitFor(() => expect(playCue).toHaveBeenCalledOnce());
    expect(playCue).toHaveBeenLastCalledWith('discovery', DEFAULT_APP_SETTINGS);

    rerender({
      events: firstBatch,
      settings: { ...DEFAULT_APP_SETTINGS, audioMuted: true, volumePercent: 20 },
    });
    rerender({
      events: firstBatch,
      settings: { ...DEFAULT_APP_SETTINGS, audioMuted: false, volumePercent: 35 },
    });
    expect(playCue).toHaveBeenCalledOnce();

    const latestSettings = { ...DEFAULT_APP_SETTINGS, volumePercent: 35 };
    rerender({ events: [event(2, 'famine-started')], settings: latestSettings });
    await waitFor(() => expect(playCue).toHaveBeenCalledTimes(2));
    expect(playCue).toHaveBeenLastCalledWith('danger', latestSettings);
  });
});
