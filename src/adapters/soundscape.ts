import type { AppSettings } from './persistence';
import type { WorldFrameProjection, WorkerEvent } from '../protocol';

export type SoundCue =
  | 'focus-start'
  | 'focus-pause'
  | 'focus-resume'
  | 'focus-complete'
  | 'selection'
  | 'progress'
  | 'danger'
  | 'discovery'
  | 'major-event';

export type AtmosphereScene =
  'founding' | 'settlement-growth' | 'crisis' | 'advanced-city' | 'space';

export interface GameSoundscape {
  playCue(cue: SoundCue, settings: AppSettings): Promise<void>;
  updateAtmosphere(scene: AtmosphereScene, settings: AppSettings): Promise<void>;
  stop(): Promise<void>;
}

export interface GameSoundscapeDependencies {
  readonly createAudioContext?: () => AudioContext;
}

interface CueStep {
  readonly durationSeconds: number;
  readonly frequencyHz: number;
  readonly offsetSeconds: number;
  readonly peak: number;
  readonly wave: OscillatorType;
}

interface AtmosphereSpec {
  readonly frequenciesHz: readonly [number, number];
  readonly level: number;
  readonly waves: readonly [OscillatorType, OscillatorType];
}

interface AtmosphereLayer {
  readonly gain: GainNode;
  readonly oscillators: readonly OscillatorNode[];
  readonly scene: AtmosphereScene;
}

type FactualSoundCue = 'progress' | 'danger' | 'discovery' | 'major-event';

function cueSteps(...steps: readonly CueStep[]): readonly CueStep[] {
  return Object.freeze(steps);
}

const CUE_PATTERNS: Readonly<Record<SoundCue, readonly CueStep[]>> = Object.freeze({
  'focus-start': cueSteps(
    { durationSeconds: 0.11, frequencyHz: 392, offsetSeconds: 0, peak: 0.16, wave: 'sine' },
    { durationSeconds: 0.14, frequencyHz: 523.25, offsetSeconds: 0.08, peak: 0.14, wave: 'sine' },
  ),
  'focus-pause': cueSteps({
    durationSeconds: 0.16,
    frequencyHz: 329.63,
    offsetSeconds: 0,
    peak: 0.12,
    wave: 'triangle',
  }),
  'focus-resume': cueSteps(
    { durationSeconds: 0.1, frequencyHz: 440, offsetSeconds: 0, peak: 0.13, wave: 'sine' },
    { durationSeconds: 0.13, frequencyHz: 587.33, offsetSeconds: 0.07, peak: 0.12, wave: 'sine' },
  ),
  'focus-complete': cueSteps(
    { durationSeconds: 0.16, frequencyHz: 523.25, offsetSeconds: 0, peak: 0.15, wave: 'sine' },
    { durationSeconds: 0.18, frequencyHz: 659.25, offsetSeconds: 0.1, peak: 0.14, wave: 'sine' },
    { durationSeconds: 0.22, frequencyHz: 783.99, offsetSeconds: 0.2, peak: 0.12, wave: 'sine' },
  ),
  selection: cueSteps({
    durationSeconds: 0.07,
    frequencyHz: 698.46,
    offsetSeconds: 0,
    peak: 0.08,
    wave: 'sine',
  }),
  progress: cueSteps(
    { durationSeconds: 0.09, frequencyHz: 392, offsetSeconds: 0, peak: 0.09, wave: 'triangle' },
    {
      durationSeconds: 0.12,
      frequencyHz: 493.88,
      offsetSeconds: 0.06,
      peak: 0.08,
      wave: 'triangle',
    },
  ),
  danger: cueSteps(
    { durationSeconds: 0.24, frequencyHz: 196, offsetSeconds: 0, peak: 0.12, wave: 'triangle' },
    { durationSeconds: 0.2, frequencyHz: 174.61, offsetSeconds: 0.13, peak: 0.1, wave: 'triangle' },
  ),
  discovery: cueSteps(
    { durationSeconds: 0.12, frequencyHz: 523.25, offsetSeconds: 0, peak: 0.1, wave: 'sine' },
    { durationSeconds: 0.17, frequencyHz: 783.99, offsetSeconds: 0.08, peak: 0.09, wave: 'sine' },
    { durationSeconds: 0.22, frequencyHz: 1046.5, offsetSeconds: 0.17, peak: 0.07, wave: 'sine' },
  ),
  'major-event': cueSteps(
    { durationSeconds: 0.14, frequencyHz: 329.63, offsetSeconds: 0, peak: 0.09, wave: 'triangle' },
    {
      durationSeconds: 0.18,
      frequencyHz: 493.88,
      offsetSeconds: 0.1,
      peak: 0.08,
      wave: 'triangle',
    },
    { durationSeconds: 0.2, frequencyHz: 659.25, offsetSeconds: 0.2, peak: 0.07, wave: 'sine' },
  ),
});

const ATMOSPHERE_SPECS: Readonly<Record<AtmosphereScene, AtmosphereSpec>> = Object.freeze({
  founding: { frequenciesHz: [65.41, 98], level: 0.055, waves: ['sine', 'triangle'] },
  'settlement-growth': {
    frequenciesHz: [73.42, 110],
    level: 0.065,
    waves: ['triangle', 'sine'],
  },
  crisis: { frequenciesHz: [49, 73.42], level: 0.05, waves: ['triangle', 'sawtooth'] },
  'advanced-city': {
    frequenciesHz: [82.41, 123.47],
    level: 0.055,
    waves: ['sine', 'triangle'],
  },
  space: { frequenciesHz: [55, 82.41], level: 0.05, waves: ['sine', 'sine'] },
});

const DIRECT_FOCUS_CUES = new Set<SoundCue>([
  'focus-start',
  'focus-pause',
  'focus-resume',
  'focus-complete',
]);

const PROGRESS_EVENT_KINDS = new Set([
  'shelter-planned',
  'storehouse-planned',
  'shelter-expanded',
  'storehouse-expanded',
  'shelter-operational',
  'storehouse-operational',
  'settlement-stage-changed',
]);

const DANGER_EVENT_KINDS = new Set([
  'supply-shortage',
  'person-died',
  'conflict',
  'theft',
  'settlement-collapsed',
  'route-disrupted',
  'conflict-started',
  'settlement-ruined',
  'civilization-fragmented',
  'cargo-lost',
  'colony-abandoned',
  'knowledge-lost',
]);

const DISCOVERY_EVENT_KINDS = new Set([
  'knowledge-discovered',
  'knowledge-recovered',
  'settlement-founded',
  'space-program-advanced',
  'spacecraft-launched',
  'mission-arrived',
  'colony-founded',
  'alien-contacted',
  'artifact-intervened',
  'alien-signal-intervened',
]);

const MAJOR_EVENT_KINDS = new Set([
  'settlement-recovered',
  'settlement-restored',
  'conflict-resolved',
  'federation-formed',
  'diplomacy-changed',
  'space-relation-changed',
  'colony-diverged',
]);

const CUE_PRIORITY: Readonly<Record<FactualSoundCue, number>> = {
  danger: 4,
  discovery: 3,
  progress: 2,
  'major-event': 1,
};

/** Derives presentation-only atmosphere from current Worker facts, never camera state. */
export function deriveAtmosphereScene(frame: WorldFrameProjection): AtmosphereScene {
  if (frame.development.activeCrises.length > 0) return 'crisis';
  if (
    frame.space.colonies.length > 0 ||
    frame.space.missions.length > 0 ||
    frame.space.programs.some((program) => program.stage === 'spaceflight')
  ) {
    return 'space';
  }
  if (
    frame.civilizations.settlements.some(
      (settlement) => settlement.developmentStage === 'advanced-city',
    )
  ) {
    return 'advanced-city';
  }
  if (
    frame.civilizations.settlements.some((settlement) => settlement.developmentStage !== 'founding')
  ) {
    return 'settlement-growth';
  }
  return 'founding';
}

/** Maps one recorded factual event to optional presentation feedback. */
export function classifyFactualSoundCue(event: WorkerEvent): SoundCue | null {
  if (PROGRESS_EVENT_KINDS.has(event.type)) return 'progress';
  if (
    DANGER_EVENT_KINDS.has(event.type) ||
    (event.type.endsWith('-started') && event.type !== 'relationship-started')
  ) {
    return 'danger';
  }
  if (DISCOVERY_EVENT_KINDS.has(event.type)) return 'discovery';
  if (MAJOR_EVENT_KINDS.has(event.type) || event.type.endsWith('-recovered')) {
    return 'major-event';
  }
  return null;
}

/** Selects at most one restrained cue for a batch of newly recorded events. */
export function highestPriorityFactualCue(events: readonly WorkerEvent[]): SoundCue | null {
  let selected: FactualSoundCue | null = null;
  for (const event of events) {
    const cue = classifyFactualSoundCue(event);
    if (!isFactualSoundCue(cue)) continue;
    if (selected === null || CUE_PRIORITY[cue] > CUE_PRIORITY[selected]) selected = cue;
  }
  return selected;
}

function isFactualSoundCue(cue: SoundCue | null): cue is FactualSoundCue {
  return cue !== null && cue in CUE_PRIORITY;
}

export function createGameSoundscape(
  dependencies: GameSoundscapeDependencies = {},
): GameSoundscape {
  const createAudioContext =
    dependencies.createAudioContext ??
    (() => {
      const Context = globalThis.AudioContext;
      if (Context === undefined) throw new Error('Web Audio is unavailable.');
      return new Context();
    });
  let context: AudioContext | null = null;
  let atmosphere: AtmosphereLayer | null = null;
  let desiredScene: AtmosphereScene = 'founding';
  let desiredSettings: AppSettings | null = null;
  let unlocked = false;

  const ensureContext = async (): Promise<AudioContext> => {
    if (context === null || context.state === 'closed') context = createAudioContext();
    if (context.state === 'suspended') await context.resume();
    unlocked = context.state === 'running';
    return context;
  };

  const stopAtmosphere = (audio: AudioContext, fadeSeconds = 0.18): void => {
    const current = atmosphere;
    atmosphere = null;
    if (current === null) return;
    const endAt = audio.currentTime + fadeSeconds;
    current.gain.gain.setValueAtTime(current.gain.gain.value, audio.currentTime);
    current.gain.gain.linearRampToValueAtTime(0, endAt);
    for (const oscillator of current.oscillators) {
      try {
        oscillator.stop(endAt);
      } catch {
        // Already-stopped ambience is harmless.
      }
    }
  };

  const applyAtmosphere = (): void => {
    const settings = desiredSettings;
    if (!unlocked || context === null || settings === null) return;
    const audible =
      !settings.audioMuted &&
      settings.ambienceEnabled &&
      !settings.calmMode &&
      !settings.reducedEffects &&
      settings.volumePercent > 0 &&
      settings.ambienceVolumePercent > 0;
    if (!audible) {
      stopAtmosphere(context);
      return;
    }

    const spec = ATMOSPHERE_SPECS[desiredScene];
    const targetGain =
      percent(settings.volumePercent) * percent(settings.ambienceVolumePercent) * spec.level;
    if (atmosphere?.scene === desiredScene) {
      atmosphere.gain.gain.linearRampToValueAtTime(targetGain, context.currentTime + 0.2);
      return;
    }

    stopAtmosphere(context);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.linearRampToValueAtTime(targetGain, context.currentTime + 0.35);
    gain.connect(context.destination);
    const oscillators = spec.frequenciesHz.map((frequency, index) => {
      const oscillator = context!.createOscillator();
      oscillator.type = spec.waves[index] ?? 'sine';
      oscillator.frequency.setValueAtTime(frequency, context!.currentTime);
      oscillator.connect(gain);
      oscillator.start(context!.currentTime);
      return oscillator;
    });
    atmosphere = { gain, oscillators, scene: desiredScene };
  };

  const playCue = async (cue: SoundCue, settings: AppSettings): Promise<void> => {
    desiredSettings = settings;
    const cueAllowed =
      !settings.audioMuted &&
      settings.soundEnabled &&
      settings.volumePercent > 0 &&
      settings.effectsVolumePercent > 0 &&
      ((!settings.calmMode && !settings.reducedEffects) || DIRECT_FOCUS_CUES.has(cue));
    const ambienceMayPlay =
      !settings.audioMuted &&
      settings.ambienceEnabled &&
      !settings.calmMode &&
      !settings.reducedEffects &&
      settings.volumePercent > 0 &&
      settings.ambienceVolumePercent > 0;
    if (!cueAllowed && !ambienceMayPlay) return;

    try {
      const audio = await ensureContext();
      if (cueAllowed) {
        const quietScale = settings.calmMode || settings.reducedEffects ? 0.45 : 1;
        const baseGain =
          percent(settings.volumePercent) * percent(settings.effectsVolumePercent) * quietScale;
        for (const step of CUE_PATTERNS[cue]) playStep(audio, step, baseGain);
      }
      applyAtmosphere();
    } catch {
      // Audio is optional. Failure must never affect focus or simulation behavior.
    }
  };

  return {
    playCue,
    updateAtmosphere(scene, settings) {
      desiredScene = scene;
      desiredSettings = settings;
      try {
        applyAtmosphere();
      } catch {
        // Scene changes degrade to the existing visual/text projection.
      }
      return Promise.resolve();
    },
    async stop() {
      const audio = context;
      context = null;
      unlocked = false;
      if (audio === null) return;
      try {
        stopAtmosphere(audio, 0);
        await audio.close();
      } catch {
        // Cleanup is best-effort.
      }
    },
  };
}

function playStep(context: AudioContext, step: CueStep, baseGain: number): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const startAt = context.currentTime + step.offsetSeconds;
  const endAt = startAt + step.durationSeconds;
  const attackEnd = startAt + Math.min(0.025, step.durationSeconds / 3);
  oscillator.type = step.wave;
  oscillator.frequency.setValueAtTime(step.frequencyHz, startAt);
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(Math.min(baseGain * step.peak, 0.2), attackEnd);
  gain.gain.linearRampToValueAtTime(0, endAt);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(endAt);
}

function percent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 100) / 100;
}

let sharedSoundscape: GameSoundscape | null = null;

/** Returns the process-local presentation-only audio adapter. */
export function getGameSoundscape(): GameSoundscape {
  sharedSoundscape ??= createGameSoundscape();
  return sharedSoundscape;
}
