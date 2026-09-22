import { useEffect, useRef } from 'react';

import type { AppSettings } from '../adapters/persistence';
import { highestPriorityFactualCue, type GameSoundscape } from '../adapters/soundscape';
import type { WorkerEvent } from '../protocol';

/** Plays each newly recorded Worker event batch at most once, using the latest audio settings. */
export function useFactualEventSound(
  events: readonly WorkerEvent[],
  settings: AppSettings,
  soundscape: GameSoundscape,
): void {
  const settingsRef = useRef(settings);
  const playedBatchRef = useRef<readonly WorkerEvent[] | null>(null);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    if (events.length === 0 || playedBatchRef.current === events) return;
    playedBatchRef.current = events;
    const cue = highestPriorityFactualCue(events);
    if (cue !== null) void soundscape.playCue(cue, settingsRef.current);
  }, [events, soundscape]);
}
