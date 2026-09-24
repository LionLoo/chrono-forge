import { vi } from 'vitest';

import { DEFAULT_APP_SETTINGS } from '../../src/adapters/persistence';
import {
  classifyFactualSoundCue,
  createGameSoundscape,
  deriveAtmosphereScene,
  highestPriorityFactualCue,
} from '../../src/adapters/soundscape';
import type { WorldFrameProjection, WorkerEvent } from '../../src/protocol';

function frameWith(
  stage: 'founding' | 'village' | 'town' | 'city' | 'advanced-city',
  options: { readonly crisis?: boolean; readonly space?: boolean } = {},
): WorldFrameProjection {
  return {
    civilizations: { settlements: [{ developmentStage: stage }] },
    development: { activeCrises: options.crisis ? [{ id: 1 }] : [] },
    space: {
      colonies: options.space ? [{ id: 1 }] : [],
      missions: [],
      programs: options.space ? [{ stage: 'spaceflight' }] : [],
    },
  } as unknown as WorldFrameProjection;
}

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

function createAudioHarness(initialState: AudioContextState = 'running') {
  let state = initialState;
  const scheduledFrequencies: number[] = [];
  const gainRamps: number[] = [];
  const oscillators: {
    frequency: { setValueAtTime: ReturnType<typeof vi.fn> };
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    type: OscillatorType;
  }[] = [];
  const gains: {
    gain: {
      linearRampToValueAtTime: ReturnType<typeof vi.fn>;
      setValueAtTime: ReturnType<typeof vi.fn>;
      value: number;
    };
  }[] = [];
  const close = vi.fn(() => {
    state = 'closed';
    return Promise.resolve();
  });
  const resume = vi.fn(() => {
    state = 'running';
    return Promise.resolve();
  });
  const context = {
    close,
    createGain: vi.fn(() => {
      const gain = {
        connect: vi.fn(),
        gain: {
          linearRampToValueAtTime: vi.fn((value: number) => {
            gain.gain.value = value;
            gainRamps.push(value);
          }),
          setValueAtTime: vi.fn((value: number) => {
            gain.gain.value = value;
          }),
          value: 0,
        },
      };
      gains.push(gain);
      return gain;
    }),
    createOscillator: vi.fn(() => {
      const oscillator = {
        connect: vi.fn(),
        frequency: {
          setValueAtTime: vi.fn((value: number) => scheduledFrequencies.push(value)),
        },
        start: vi.fn(),
        stop: vi.fn(),
        type: 'sine' as OscillatorType,
      };
      oscillators.push(oscillator);
      return oscillator;
    }),
    currentTime: 4,
    destination: {},
    get state() {
      return state;
    },
    resume,
  };
  return {
    close,
    context: context as unknown as AudioContext,
    gainRamps,
    gains,
    oscillators,
    resume,
    scheduledFrequencies,
  };
}

describe('M10.2 factual atmosphere', () => {
  it('derives founding, growth, crisis, advanced-city, and space scenes from Worker facts', () => {
    expect(deriveAtmosphereScene(frameWith('founding'))).toBe('founding');
    expect(deriveAtmosphereScene(frameWith('town'))).toBe('settlement-growth');
    expect(deriveAtmosphereScene(frameWith('advanced-city'))).toBe('advanced-city');
    expect(deriveAtmosphereScene(frameWith('advanced-city', { space: true }))).toBe('space');
    expect(deriveAtmosphereScene(frameWith('advanced-city', { crisis: true, space: true }))).toBe(
      'crisis',
    );
  });

  it('classifies only recorded factual events and selects one restrained priority cue', () => {
    expect(classifyFactualSoundCue(event(1, 'shelter-operational'))).toBe('progress');
    expect(classifyFactualSoundCue(event(2, 'meteor-impact-started'))).toBe('danger');
    expect(classifyFactualSoundCue(event(3, 'alien-contacted'))).toBe('discovery');
    expect(classifyFactualSoundCue(event(4, 'settlement-recovered'))).toBe('major-event');
    expect(classifyFactualSoundCue(event(5, 'local-exchange'))).toBeNull();
    expect(
      highestPriorityFactualCue([
        event(6, 'settlement-recovered'),
        event(7, 'shelter-operational'),
        event(8, 'alien-contacted'),
        event(9, 'famine-started'),
      ]),
    ).toBe('danger');
  });
});

describe('M10.2 procedural soundscape', () => {
  it('plays distinct project-original focus cue steps through bounded master and effects gains', async () => {
    const audio = createAudioHarness();
    const createAudioContext = vi.fn(() => audio.context);
    const soundscape = createGameSoundscape({ createAudioContext });

    await soundscape.playCue('focus-start', {
      ...DEFAULT_APP_SETTINGS,
      effectsVolumePercent: 50,
      volumePercent: 40,
    });

    expect(createAudioContext).toHaveBeenCalledOnce();
    expect(audio.oscillators).toHaveLength(2);
    expect(audio.scheduledFrequencies).toEqual([392, 523.25]);
    expect(audio.gains).toHaveLength(2);
    expect(Math.max(...audio.gainRamps)).toBeLessThanOrEqual(0.2);
  });

  it('does not create audio while muted and suppresses nonessential cues in calm mode', async () => {
    const audio = createAudioHarness();
    const createAudioContext = vi.fn(() => audio.context);
    const soundscape = createGameSoundscape({ createAudioContext });

    await soundscape.playCue('focus-start', {
      ...DEFAULT_APP_SETTINGS,
      audioMuted: true,
    });
    await soundscape.playCue('selection', {
      ...DEFAULT_APP_SETTINGS,
      calmMode: true,
    });

    expect(createAudioContext).not.toHaveBeenCalled();

    await soundscape.playCue('focus-pause', {
      ...DEFAULT_APP_SETTINGS,
      calmMode: true,
    });
    expect(createAudioContext).toHaveBeenCalledOnce();
    expect(audio.oscillators).toHaveLength(1);
  });

  it('waits for a user cue before starting quiet ambience and replaces it when Worker facts change', async () => {
    const audio = createAudioHarness('suspended');
    const soundscape = createGameSoundscape({ createAudioContext: () => audio.context });
    const settings = {
      ...DEFAULT_APP_SETTINGS,
      ambienceEnabled: true,
      ambienceVolumePercent: 20,
      effectsVolumePercent: 40,
      volumePercent: 50,
    };

    await soundscape.updateAtmosphere('founding', settings);
    expect(audio.oscillators).toHaveLength(0);

    await soundscape.playCue('selection', settings);
    expect(audio.oscillators).toHaveLength(3);
    expect(audio.resume).toHaveBeenCalledOnce();
    const foundingOscillators = audio.oscillators.slice(-2);

    await soundscape.updateAtmosphere('space', settings);
    expect(audio.oscillators).toHaveLength(5);
    for (const oscillator of foundingOscillators)
      expect(oscillator.stop.mock.calls).not.toHaveLength(0);
  });

  it('silently contains unavailable audio and cleanup failures', async () => {
    const unavailable = createGameSoundscape({
      createAudioContext: () => {
        throw new Error('audio unavailable');
      },
    });
    await expect(
      unavailable.playCue('focus-complete', DEFAULT_APP_SETTINGS),
    ).resolves.toBeUndefined();

    const audio = createAudioHarness();
    audio.close.mockImplementation(() => Promise.reject(new Error('close failed')));
    const soundscape = createGameSoundscape({ createAudioContext: () => audio.context });
    await soundscape.playCue('focus-complete', DEFAULT_APP_SETTINGS);
    await expect(soundscape.stop()).resolves.toBeUndefined();
  });
});
