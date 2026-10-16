import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import {
  DEFAULT_APP_SETTINGS,
  createInMemoryPersistenceGateway,
  type AppSettings,
  type PersistenceGateway,
} from '../../src/adapters/persistence';
import { completeFocus, createIdleFocusState, startFocus } from '../../src/focus';
import {
  FOCUS_SESSION_REVIEW_VERSION,
  projectFocusCheckpoint,
} from '../../src/focus/session-review';
import { deserializeWorldSnapshot, serializeWorldSnapshot } from '../../src/simulation/persistence';
import {
  appendWorldEvent,
  createInitialWorld,
  stepWorld,
  type WorldState,
} from '../../src/simulation/world';
import { FocusPersistencePanel } from '../../src/ui/FocusPersistencePanel';
import { focusSessionFromState } from '../../src/ui/useFocusController';
import type { WorldSimulationView } from '../../src/ui/useWorldSimulation';

const snapshot = serializeWorldSnapshot(
  createInitialWorld([1, 2, 3, 4], { width: 2, height: 2, chunkSize: 2 }),
);

function createSimulation(): {
  readonly simulation: WorldSimulationView;
  readonly loadSnapshot: ReturnType<typeof vi.fn>;
  readonly performOfflineCatchUp: ReturnType<typeof vi.fn>;
} {
  const loadSnapshot = vi.fn<(snapshot: string) => Promise<void>>().mockResolvedValue();
  const performOfflineCatchUp = vi
    .fn<(elapsed: number, rate: number) => Promise<void>>()
    .mockResolvedValue();
  return {
    simulation: {
      advanceTicks: vi.fn(),
      error: null,
      events: [],
      latestRecordedEvents: [],
      frame: null,
      loadSnapshot,
      performOfflineCatchUp,
      queueCommand: vi.fn().mockResolvedValue(undefined),
      requestFocusCheckpoint: vi.fn((baselineEventId: number | null) =>
        Promise.resolve({
          snapshot,
          checkpoint: projectFocusCheckpoint(deserializeWorldSnapshot(snapshot), baselineEventId),
        }),
      ),
      requestSave: vi.fn<() => Promise<string>>().mockResolvedValue(snapshot),
      requestFreshWorldSnapshot: vi.fn<WorldSimulationView['requestFreshWorldSnapshot']>(
        (seed, config) => Promise.resolve(serializeWorldSnapshot(createInitialWorld(seed, config))),
      ),
      requestRelationshipEventPage: vi.fn(),
      requestRelationshipPage: vi.fn(),
      requestTimelinePage: vi.fn(),
      retryInitialization: vi.fn(),
      relationshipEventPage: {
        personId: null,
        relationshipId: null,
        offset: 0,
        total: 0,
        events: [],
      },
      relationshipPage: { personId: null, offset: 0, total: 0, relationships: [] },
      status: 'ready',
      timeline: { entries: [], offset: 0, total: 0 },
    },
    loadSnapshot,
    performOfflineCatchUp,
  };
}

function createStatefulSimulation(initialWorld?: WorldState): {
  readonly simulation: WorldSimulationView;
  readonly currentWorld: () => WorldState;
  readonly currentTick: () => number;
  readonly advanceTicks: ReturnType<typeof vi.fn>;
} {
  let world =
    initialWorld ?? createInitialWorld([1, 2, 3, 4], { width: 2, height: 2, chunkSize: 2 });
  const advanceTicks = vi.fn((ticks: number) => {
    world = stepWorld(world, ticks);
  });
  return {
    simulation: {
      advanceTicks,
      error: null,
      events: [],
      latestRecordedEvents: [],
      frame: null,
      loadSnapshot: vi.fn(async (savedSnapshot: string) => {
        world = deserializeWorldSnapshot(savedSnapshot);
        await Promise.resolve();
      }),
      performOfflineCatchUp: vi.fn().mockResolvedValue(undefined),
      queueCommand: vi.fn().mockResolvedValue(undefined),
      requestFocusCheckpoint: vi.fn((baselineEventId: number | null) =>
        Promise.resolve({
          snapshot: serializeWorldSnapshot(world),
          checkpoint: projectFocusCheckpoint(world, baselineEventId),
        }),
      ),
      requestSave: vi.fn(async () => {
        await Promise.resolve();
        return serializeWorldSnapshot(world);
      }),
      requestFreshWorldSnapshot: vi.fn<WorldSimulationView['requestFreshWorldSnapshot']>(
        async (seed, config) => {
          await Promise.resolve();
          return serializeWorldSnapshot(createInitialWorld(seed, config));
        },
      ),
      requestTimelinePage: vi.fn(),
      requestRelationshipEventPage: vi.fn(),
      requestRelationshipPage: vi.fn(),
      retryInitialization: vi.fn(),
      relationshipEventPage: {
        personId: null,
        relationshipId: null,
        offset: 0,
        total: 0,
        events: [],
      },
      relationshipPage: { personId: null, offset: 0, total: 0, relationships: [] },
      status: 'ready',
      timeline: { entries: [], offset: 0, total: 0 },
    },
    currentWorld: () => world,
    currentTick: () => world.tick,
    advanceTicks,
  };
}

describe('FocusPersistencePanel offline progression', () => {
  it('creates and selects a separate fresh world when the current slot cannot be restored', async () => {
    const user = userEvent.setup();
    const base = createInMemoryPersistenceGateway(() => 1_000);
    await base.commitSaveSlot('primary', 'Founding world', snapshot);
    const gateway: PersistenceGateway = {
      ...base,
      async loadSaveSlot(slotId) {
        if (slotId === 'primary') {
          throw new Error('save slot has no semantically valid generation');
        }
        return base.loadSaveSlot(slotId);
      },
    };
    const { simulation } = createSimulation();

    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => 1_000 }}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={simulation}
      />,
    );

    await screen.findByText('Persistence fault: save slot has no semantically valid generation');
    await user.click(screen.getByRole('button', { name: 'Start a fresh world' }));

    await screen.findByRole('button', { name: 'Start focus' });
    expect((await base.listSaveSlots()).map((slot) => slot.slotId).sort()).toEqual([
      'fresh-world-1',
      'primary',
    ]);
    expect((await base.loadSettings()).activeSlotId).toBe('fresh-world-1');
    expect(await base.loadSaveSlot('primary')).not.toBeNull();
  });

  it('bounds elapsed time and clamps the configured rate to the worker limit', async () => {
    let nowMs = 1_000;
    const gateway = createInMemoryPersistenceGateway(() => nowMs);
    await gateway.commitSaveSlot('primary', 'Founding world', snapshot);
    await gateway.saveSettings({
      ...DEFAULT_APP_SETTINGS,
      focusToSimRatio: 10_000,
      maxOfflineHours: 1,
    });
    nowMs += 2 * 60 * 60 * 1_000;
    const { simulation, loadSnapshot, performOfflineCatchUp } = createSimulation();

    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => nowMs }}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={simulation}
      />,
    );

    await screen.findByRole('button', { name: 'Start focus' });
    expect(loadSnapshot).toHaveBeenCalledWith(snapshot);
    expect(performOfflineCatchUp).toHaveBeenCalledWith(60 * 60 * 1_000, 1_000);
    expect(await gateway.loadSaveSlot('primary')).toMatchObject({ savedAtMs: nowMs });
    expect(screen.getByText('Applied bounded offline progression.')).toBeVisible();
  });

  it.each([
    ['disabled', false, 1_000],
    ['legacy unknown timestamp', true, 0],
  ])('does not apply progression when %s', async (_label, offlineProgressionEnabled, savedAtMs) => {
    let nowMs = 5_000;
    const gateway = createInMemoryPersistenceGateway(() => nowMs);
    await gateway.commitSaveSlot('primary', 'Founding world', snapshot);
    if (savedAtMs === 0) {
      nowMs = 0;
      await gateway.commitSaveSlot('primary', 'Founding world', snapshot);
      nowMs = 5_000;
    }
    await gateway.saveSettings({ ...DEFAULT_APP_SETTINGS, offlineProgressionEnabled });
    nowMs += 1_000;
    const { simulation, performOfflineCatchUp } = createSimulation();

    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => nowMs }}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={simulation}
      />,
    );

    await screen.findByRole('button', { name: 'Start focus' });
    expect(performOfflineCatchUp).not.toHaveBeenCalled();
  });

  it('leaves elapsed progression to a restored running focus session', async () => {
    let nowMs = 1_000;
    const gateway = createInMemoryPersistenceGateway(() => nowMs);
    const runningState = startFocus(
      createIdleFocusState(),
      { focusDurationMs: 10_000, breakDurationMs: 0, simulationTicksPerFocusSecond: 10 },
      nowMs,
    );
    await gateway.commitFocusCheckpoint(
      'primary',
      'Founding world',
      snapshot,
      {
        sessionId: 'focus-running',
        slotId: 'primary',
        startedAtMs: nowMs,
        endedAtMs: null,
        plannedFocusMs: 10_000,
        focusedMs: 0,
        plannedBreakMs: 0,
        breakMs: 0,
        issuedSimulationTicks: 0,
        status: 'active',
        stateJson: JSON.stringify(runningState),
        recapEventIds: [],
        recapEntries: [],
      },
      [],
    );
    nowMs += 1_000;
    const { simulation, performOfflineCatchUp } = createSimulation();

    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => nowMs }}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={simulation}
      />,
    );

    await screen.findByRole('button', { name: 'Pause' });
    expect(performOfflineCatchUp).not.toHaveBeenCalled();
  });

  it('captures events created after a restored running-session checkpoint', async () => {
    const user = userEvent.setup();
    const gateway = createInMemoryPersistenceGateway(() => 1_000);
    const savedWorld = createInitialWorld([1, 2, 3, 4], {
      width: 2,
      height: 2,
      chunkSize: 2,
    });
    const advancedWorld = appendWorldEvent(savedWorld, 'offline-catch-up', savedWorld.tick, {
      summary: `Bounded offline progression reached tick ${savedWorld.tick}.`,
    });
    const runningState = startFocus(
      createIdleFocusState(),
      { focusDurationMs: 10_000, breakDurationMs: 0, simulationTicksPerFocusSecond: 10 },
      1_000,
    );
    await gateway.commitFocusCheckpoint(
      'primary',
      'Founding world',
      serializeWorldSnapshot(savedWorld),
      {
        ...focusSessionFromState('resumed-running', 'primary', runningState, []),
        review: {
          version: FOCUS_SESSION_REVIEW_VERSION,
          baselineEventId: projectFocusCheckpoint(savedWorld, null).latestEventId,
          before: projectFocusCheckpoint(savedWorld, null).moment,
          after: projectFocusCheckpoint(savedWorld, null).moment,
          revisitTarget: projectFocusCheckpoint(savedWorld, null).revisitTarget,
        },
      },
      [],
    );
    await gateway.saveSettings({
      ...DEFAULT_APP_SETTINGS,
      activeSlotId: 'primary',
      offlineProgressionEnabled: false,
    });
    const base = createSimulation().simulation;
    const simulation: WorldSimulationView = {
      ...base,
      events: advancedWorld.eventLog.map((event) => ({
        amount: event.amount,
        id: event.id,
        subjectId: event.subjectId,
        subjectKind: event.subjectKind,
        summary: event.summary,
        targetId: event.targetId,
        targetKind: event.targetKind,
        tick: event.tick,
        tileIndex: event.tileIndex,
        type: event.kind,
      })),
      requestSave: vi.fn().mockResolvedValue(serializeWorldSnapshot(advancedWorld)),
      requestFocusCheckpoint: vi.fn((baselineEventId: number | null) =>
        Promise.resolve({
          snapshot: serializeWorldSnapshot(advancedWorld),
          checkpoint: projectFocusCheckpoint(advancedWorld, baselineEventId),
        }),
      ),
    };

    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => 1_000 }}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={simulation}
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Pause' }));
    await waitFor(async () => {
      const restored = (await gateway.loadSaveSlot('primary'))?.focusSession;
      expect(restored?.recapEventIds).toEqual([3]);
      expect(restored?.recapEntries).toEqual([
        { id: 3, tick: 0, summary: 'Bounded offline progression reached tick 0.' },
      ]);
    });
  });

  it('commits caught-up state immediately so elapsed time is not replayed', async () => {
    let nowMs = 1_000;
    const gateway = createInMemoryPersistenceGateway(() => nowMs);
    await gateway.commitSaveSlot('primary', 'Founding world', snapshot);
    nowMs = 2_000;
    const first = createSimulation();
    const firstRender = render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => nowMs }}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={first.simulation}
      />,
    );

    await screen.findByRole('button', { name: 'Start focus' });
    await waitFor(() => expect(first.performOfflineCatchUp).toHaveBeenCalledWith(1_000, 10));
    expect((await gateway.loadSaveSlot('primary'))?.savedAtMs).toBe(nowMs);
    firstRender.unmount();

    const second = createSimulation();
    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => nowMs }}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={second.simulation}
      />,
    );

    await screen.findByRole('button', { name: 'Start focus' });
    expect(second.performOfflineCatchUp).not.toHaveBeenCalled();
  });

  it('reloads active focus with exact fractional tick carry and no offline replay', async () => {
    const user = userEvent.setup();
    let nowMs = 1_000;
    const gateway = createInMemoryPersistenceGateway(() => nowMs);
    await gateway.saveSettings({
      ...DEFAULT_APP_SETTINGS,
      focusToSimRatio: 7,
      offlineProgressionEnabled: true,
    });
    const first = createStatefulSimulation();
    const firstRender = render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => nowMs }}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={first.simulation}
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Start focus' }));
    nowMs += 10_500;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(first.currentTick()).toBe(73));
    await user.click(screen.getByRole('button', { name: 'Save now' }));
    await screen.findByText('World saved manually.');

    const checkpoint = await gateway.loadSaveSlot('primary');
    expect(deserializeWorldSnapshot(checkpoint!.snapshot).tick).toBe(73);
    expect(checkpoint?.focusSession).toMatchObject({
      focusedMs: 10_500,
      issuedSimulationTicks: 73,
      status: 'active',
      review: {
        version: 1,
        before: { tick: 0 },
        after: { tick: 73 },
      },
    });
    expect(JSON.parse(checkpoint!.focusSession!.stateJson)).toMatchObject({
      simulationTickRemainder: 500,
    });
    const checkpointRequests = vi.mocked(first.simulation.requestFocusCheckpoint).mock.calls.length;
    const durableGeneration = checkpoint!.headGeneration;
    await user.click(screen.getByRole('button', { name: 'Save now' }));
    await waitFor(() =>
      expect(first.simulation.requestFocusCheckpoint).toHaveBeenCalledTimes(checkpointRequests + 1),
    );
    expect((await gateway.loadSaveSlot('primary'))?.headGeneration).toBe(durableGeneration);
    firstRender.unmount();

    const restored = createStatefulSimulation();
    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => nowMs }}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={restored.simulation}
      />,
    );

    await screen.findByRole('button', { name: 'Pause' });
    expect(restored.currentTick()).toBe(73);
    expect(restored.simulation.performOfflineCatchUp).not.toHaveBeenCalled();
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(restored.advanceTicks).not.toHaveBeenCalled();
    nowMs += 500;
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(restored.currentTick()).toBe(77));
    await waitFor(async () =>
      expect((await gateway.loadSaveSlot('primary'))?.focusSession?.review).toMatchObject({
        before: { tick: 0 },
        after: { tick: 77 },
      }),
    );
  });

  it('restores the persisted active slot instead of always preferring primary', async () => {
    const gateway = createInMemoryPersistenceGateway(() => 1_000);
    const secondWorld = stepWorld(
      createInitialWorld([5, 6, 7, 8], { width: 2, height: 2, chunkSize: 2 }),
      42,
    );
    await gateway.commitSaveSlot('primary', 'Founding world', snapshot);
    await gateway.commitSaveSlot('world-2', 'Second world', serializeWorldSnapshot(secondWorld));
    await gateway.saveSettings({
      ...DEFAULT_APP_SETTINGS,
      activeSlotId: 'world-2',
      offlineProgressionEnabled: false,
    });
    const restored = createStatefulSimulation();

    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => 1_000 }}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={restored.simulation}
      />,
    );

    await screen.findByRole('button', { name: 'Start focus' });
    expect(screen.getByRole('combobox', { name: 'Load local slot' })).toHaveValue('world-2');
    expect(restored.currentTick()).toBe(42);
  });

  it('persists a focus session after duplicating the current world changes archive authority', async () => {
    const user = userEvent.setup();
    const gateway = createInMemoryPersistenceGateway(() => 1_000);

    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => 1_000 }}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={createStatefulSimulation().simulation}
      />,
    );

    await user.click(await screen.findByText('World lifecycle'));
    await user.click(screen.getByRole('button', { name: 'Duplicate current world' }));
    await screen.findByText('Current world duplicated into Second world.');
    expect(screen.getByRole('combobox', { name: 'Load local slot' })).toHaveValue('world-2');

    await user.click(screen.getByRole('button', { name: 'Start focus' }));
    await user.click(screen.getByRole('button', { name: 'Complete focus' }));
    await screen.findByText('Session recorded with a factual recap.');

    expect((await gateway.loadSaveSlot('world-2'))?.focusSession).toMatchObject({
      slotId: 'world-2',
      status: 'completed',
    });
    expect((await gateway.loadSaveSlot('primary'))?.focusSession).toBeNull();
  });

  it('applies a queued duplicate to the final Worker-owned world and remounts that slot', async () => {
    const user = userEvent.setup();
    const base = createInMemoryPersistenceGateway(() => 1_000);
    const secondSnapshot = serializeWorldSnapshot(
      stepWorld(createInitialWorld([5, 6, 7, 8], { width: 2, height: 2, chunkSize: 2 }), 42),
    );
    await base.commitSaveSlot('primary', 'Founding world', snapshot);
    await base.commitSaveSlot('world-2', 'Second world', secondSnapshot);
    await base.saveSettings({
      ...DEFAULT_APP_SETTINGS,
      activeSlotId: 'primary',
      offlineProgressionEnabled: false,
    });
    let releaseSecondWorld!: () => void;
    const secondWorldGate = new Promise<void>((resolve) => {
      releaseSecondWorld = resolve;
    });
    let secondWorldLoadStarted = false;
    const gateway: PersistenceGateway = {
      ...base,
      async loadSaveSlot(slotId) {
        if (slotId === 'world-2') {
          secondWorldLoadStarted = true;
          await secondWorldGate;
        }
        return base.loadSaveSlot(slotId);
      },
    };
    const stateful = createStatefulSimulation();

    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => 1_000 }}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={stateful.simulation}
      />,
    );

    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Load local slot' }),
      'world-2',
    );
    await waitFor(() => expect(secondWorldLoadStarted).toBe(true));
    await user.click(screen.getByText('World lifecycle'));
    await user.clear(screen.getByLabelText('Slot ID'));
    await user.type(screen.getByLabelText('Slot ID'), 'world-copy');
    await user.clear(screen.getByLabelText('Slot name'));
    await user.type(screen.getByLabelText('Slot name'), 'World copy');
    await user.click(screen.getByRole('button', { name: 'Duplicate current world' }));

    releaseSecondWorld();
    await screen.findByText('Current world duplicated into World copy.');
    expect(screen.getByRole('combobox', { name: 'Load local slot' })).toHaveValue('world-copy');
    expect(stateful.currentTick()).toBe(42);
    expect((await base.loadSettings()).activeSlotId).toBe('world-copy');
    expect(deserializeWorldSnapshot((await base.loadSaveSlot('primary'))!.snapshot).tick).toBe(0);
    expect(deserializeWorldSnapshot((await base.loadSaveSlot('world-2'))!.snapshot).tick).toBe(42);
    expect(deserializeWorldSnapshot((await base.loadSaveSlot('world-copy'))!.snapshot).tick).toBe(
      42,
    );
  });

  it('creates a genuinely fresh seeded world without changing the source slot', async () => {
    const user = userEvent.setup();
    const gateway = createInMemoryPersistenceGateway(() => 1_000);
    const sourceWorld = stepWorld(
      createInitialWorld([2, 3, 5, 7], { width: 8, height: 6, chunkSize: 2 }),
      42,
    );
    const stateful = createStatefulSimulation(sourceWorld);

    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => 1_000 }}
        createWorldSeed={() => [11, 13, 17, 19]}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={stateful.simulation}
      />,
    );

    await user.click(await screen.findByText('World lifecycle'));
    expect(screen.getByLabelText('New world seed')).toHaveValue(
      '0000000b-0000000d-00000011-00000013',
    );
    await user.click(screen.getByRole('button', { name: 'Create new world' }));
    await screen.findByText('Fresh world Second world created.');

    const source = deserializeWorldSnapshot((await gateway.loadSaveSlot('primary'))!.snapshot);
    const fresh = deserializeWorldSnapshot((await gateway.loadSaveSlot('world-2'))!.snapshot);
    expect(source.seed).toStrictEqual([2, 3, 5, 7]);
    expect(source.tick).toBe(42);
    expect(fresh.seed).toStrictEqual([11, 13, 17, 19]);
    expect(fresh.tick).toBe(0);
    expect(fresh.eventLog.map((event) => event.kind)).toStrictEqual([
      'world-generated',
      'founders-arrived',
    ]);
    expect(stateful.currentWorld().seed).toStrictEqual([11, 13, 17, 19]);
    expect(stateful.currentTick()).toBe(0);
    expect((await gateway.loadSettings()).activeSlotId).toBe('world-2');
  });

  it('resets only the active slot and rolls Worker authority back if the durable reset fails', async () => {
    const user = userEvent.setup();
    const base = createInMemoryPersistenceGateway(() => 1_000);
    const primaryWorld = stepWorld(
      createInitialWorld([2, 3, 5, 7], { width: 8, height: 6, chunkSize: 2 }),
      42,
    );
    const otherWorld = stepWorld(
      createInitialWorld([23, 29, 31, 37], { width: 8, height: 6, chunkSize: 2 }),
      84,
    );
    await base.commitSaveSlot('primary', 'Founding world', serializeWorldSnapshot(primaryWorld));
    await base.commitSaveSlot('world-2', 'Second world', serializeWorldSnapshot(otherWorld));
    await base.saveSettings({
      ...DEFAULT_APP_SETTINGS,
      activeSlotId: 'primary',
      offlineProgressionEnabled: false,
    });
    let rejectReset = true;
    const gateway: PersistenceGateway = {
      ...base,
      async commitSaveSlot(slotId, name, savedSnapshot) {
        const savedWorld = deserializeWorldSnapshot(savedSnapshot);
        if (rejectReset && slotId === 'primary' && savedWorld.seed[0] === 41) {
          throw new Error('Injected reset commit failure');
        }
        return base.commitSaveSlot(slotId, name, savedSnapshot);
      },
    };
    const stateful = createStatefulSimulation();

    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => 1_000 }}
        createWorldSeed={() => [41, 43, 47, 53]}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={stateful.simulation}
      />,
    );

    await user.click(await screen.findByText('World lifecycle'));
    await user.type(screen.getByLabelText('Reset confirmation'), 'Founding world');
    await user.click(screen.getByRole('button', { name: 'Reset active world' }));
    expect(await screen.findByText('Archive fault: Injected reset commit failure')).toBeVisible();
    expect(stateful.currentWorld().seed).toStrictEqual([2, 3, 5, 7]);
    expect(stateful.currentTick()).toBe(42);
    expect(deserializeWorldSnapshot((await base.loadSaveSlot('primary'))!.snapshot).tick).toBe(42);
    expect(deserializeWorldSnapshot((await base.loadSaveSlot('world-2'))!.snapshot).tick).toBe(84);
    expect((await base.loadSettings()).activeSlotId).toBe('primary');

    rejectReset = false;
    await user.click(screen.getByRole('button', { name: 'Reset active world' }));
    await screen.findByText('Founding world was reset with a fresh seed.');
    expect(stateful.currentWorld().seed).toStrictEqual([41, 43, 47, 53]);
    expect(stateful.currentTick()).toBe(0);
    expect(deserializeWorldSnapshot((await base.loadSaveSlot('world-2'))!.snapshot).tick).toBe(84);
  });

  it('keeps the old world active when a committed fresh slot cannot load', async () => {
    const user = userEvent.setup();
    const base = createInMemoryPersistenceGateway(() => 1_000);
    const sourceWorld = stepWorld(
      createInitialWorld([2, 3, 5, 7], { width: 8, height: 6, chunkSize: 2 }),
      42,
    );
    await base.commitSaveSlot('primary', 'Founding world', serializeWorldSnapshot(sourceWorld));
    await base.saveSettings({
      ...DEFAULT_APP_SETTINGS,
      activeSlotId: 'primary',
      offlineProgressionEnabled: false,
    });
    const stateful = createStatefulSimulation();
    const loadSnapshot = stateful.simulation.loadSnapshot;
    const simulation: WorldSimulationView = {
      ...stateful.simulation,
      loadSnapshot: vi.fn(async (savedSnapshot: string) => {
        if (deserializeWorldSnapshot(savedSnapshot).seed[0] === 61) {
          throw new Error('Injected fresh-world load failure');
        }
        await loadSnapshot(savedSnapshot);
      }),
    };

    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => 1_000 }}
        createWorldSeed={() => [61, 67, 71, 73]}
        runtime={{ gateway: base, mode: 'browser-preview' }}
        simulation={simulation}
      />,
    );

    await user.click(await screen.findByText('World lifecycle'));
    await user.click(screen.getByRole('button', { name: 'Create new world' }));
    expect(
      await screen.findByText('Archive fault: Injected fresh-world load failure'),
    ).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Load local slot' })).toHaveValue('primary');
    expect(stateful.currentWorld().seed).toStrictEqual([2, 3, 5, 7]);
    expect(stateful.currentTick()).toBe(42);
    expect(await base.loadSaveSlot('world-2')).not.toBeNull();
    expect((await base.loadSettings()).activeSlotId).toBe('primary');
  });

  it('adopts a durable fresh world before reporting an active-slot preference failure', async () => {
    const user = userEvent.setup();
    const base = createInMemoryPersistenceGateway(() => 1_000);
    let rejectFreshPreference = false;
    const gateway: PersistenceGateway = {
      ...base,
      async saveSettings(settings) {
        if (rejectFreshPreference && settings.activeSlotId === 'world-2') {
          throw new Error('Injected fresh preference failure');
        }
        return base.saveSettings(settings);
      },
    };
    const stateful = createStatefulSimulation();

    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => 1_000 }}
        createWorldSeed={() => [79, 83, 89, 97]}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={stateful.simulation}
      />,
    );

    await screen.findByRole('button', { name: 'Start focus' });
    rejectFreshPreference = true;
    await user.click(screen.getByText('World lifecycle'));
    await user.click(screen.getByRole('button', { name: 'Create new world' }));

    expect(
      await screen.findByText('Archive fault: Injected fresh preference failure'),
    ).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Load local slot' })).toHaveValue('world-2');
    expect(stateful.currentWorld().seed).toStrictEqual([79, 83, 89, 97]);
    expect(stateful.currentTick()).toBe(0);
    expect(await base.loadSaveSlot('world-2')).not.toBeNull();
    expect((await base.loadSettings()).activeSlotId).toBe('primary');
  });

  it('adopts a reset that committed durably before its gateway receipt failed', async () => {
    const user = userEvent.setup();
    const base = createInMemoryPersistenceGateway(() => 1_000);
    const primaryWorld = stepWorld(
      createInitialWorld([2, 3, 5, 7], { width: 8, height: 6, chunkSize: 2 }),
      42,
    );
    await base.commitSaveSlot('primary', 'Founding world', serializeWorldSnapshot(primaryWorld));
    await base.saveSettings({
      ...DEFAULT_APP_SETTINGS,
      activeSlotId: 'primary',
      offlineProgressionEnabled: false,
    });
    let failAfterCommit = true;
    const gateway: PersistenceGateway = {
      ...base,
      async commitSaveSlot(slotId, name, savedSnapshot) {
        const committed = await base.commitSaveSlot(slotId, name, savedSnapshot);
        if (failAfterCommit && deserializeWorldSnapshot(savedSnapshot).seed[0] === 101) {
          failAfterCommit = false;
          throw new Error('Injected post-commit receipt failure');
        }
        return committed;
      },
    };
    const stateful = createStatefulSimulation();

    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => 1_000 }}
        createWorldSeed={() => [101, 103, 107, 109]}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={stateful.simulation}
      />,
    );

    await user.click(await screen.findByText('World lifecycle'));
    await user.type(screen.getByLabelText('Reset confirmation'), 'Founding world');
    await user.click(screen.getByRole('button', { name: 'Reset active world' }));
    await screen.findByText('Founding world was reset with a fresh seed.');

    expect(screen.queryByText(/Injected post-commit receipt failure/)).not.toBeInTheDocument();
    expect(stateful.currentWorld().seed).toStrictEqual([101, 103, 107, 109]);
    expect(stateful.currentTick()).toBe(0);
    expect(deserializeWorldSnapshot((await base.loadSaveSlot('primary'))!.snapshot).seed).toEqual([
      101, 103, 107, 109,
    ]);
  });

  it('refuses a same-turn reset behind a pending switch even when slot names match', async () => {
    const user = userEvent.setup();
    const base = createInMemoryPersistenceGateway(() => 1_000);
    const secondSnapshot = serializeWorldSnapshot(
      stepWorld(createInitialWorld([5, 6, 7, 8], { width: 2, height: 2, chunkSize: 2 }), 42),
    );
    await base.commitSaveSlot('primary', 'Shared world', snapshot);
    await base.commitSaveSlot('world-2', 'Shared world', secondSnapshot);
    await base.saveSettings({
      ...DEFAULT_APP_SETTINGS,
      activeSlotId: 'primary',
      offlineProgressionEnabled: false,
    });
    let releaseSecondWorld = (): void => undefined;
    const secondWorldGate = new Promise<void>((resolve) => {
      releaseSecondWorld = resolve;
    });
    let secondWorldLoadStarted = false;
    let lifecycleCommitCalls = 0;
    const gateway: PersistenceGateway = {
      ...base,
      async commitSaveSlot(slotId, name, savedSnapshot) {
        lifecycleCommitCalls += 1;
        return base.commitSaveSlot(slotId, name, savedSnapshot);
      },
      async loadSaveSlot(slotId) {
        if (slotId === 'world-2') {
          secondWorldLoadStarted = true;
          await secondWorldGate;
        }
        return base.loadSaveSlot(slotId);
      },
    };
    const stateful = createStatefulSimulation();

    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => 1_000 }}
        createWorldSeed={() => [109, 113, 127, 131]}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={stateful.simulation}
      />,
    );

    await user.click(await screen.findByText('World lifecycle'));
    await user.type(screen.getByLabelText('Reset confirmation'), 'Shared world');
    const slots = screen.getByRole('combobox', { name: 'Load local slot' });
    const resetButton = screen.getByRole('button', { name: 'Reset active world' });
    act(() => {
      fireEvent.change(slots, { target: { value: 'world-2' } });
      fireEvent.click(resetButton);
    });

    await waitFor(() => expect(secondWorldLoadStarted).toBe(true));
    expect(resetButton).toBeDisabled();
    expect(lifecycleCommitCalls).toBe(0);
    releaseSecondWorld();

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Load local slot' })).toHaveValue('world-2'),
    );
    expect(stateful.currentTick()).toBe(42);
    expect(lifecycleCommitCalls).toBe(0);
    expect(deserializeWorldSnapshot((await base.loadSaveSlot('primary'))!.snapshot).tick).toBe(0);
    expect(deserializeWorldSnapshot((await base.loadSaveSlot('world-2'))!.snapshot).tick).toBe(42);
  });

  it('blocks immediate focus and save actions while a successful reset is in flight', async () => {
    const user = userEvent.setup();
    const base = createInMemoryPersistenceGateway(() => 1_000);
    const primaryWorld = stepWorld(
      createInitialWorld([2, 3, 5, 7], { width: 8, height: 6, chunkSize: 2 }),
      42,
    );
    await base.commitSaveSlot('primary', 'Founding world', serializeWorldSnapshot(primaryWorld));
    await base.saveSettings({
      ...DEFAULT_APP_SETTINGS,
      activeSlotId: 'primary',
      offlineProgressionEnabled: false,
    });
    let resetCommitStarted = false;
    let resetCommitCalls = 0;
    let releaseResetCommit = (): void => undefined;
    const resetCommitGate = new Promise<void>((resolve) => {
      releaseResetCommit = resolve;
    });
    const gateway: PersistenceGateway = {
      ...base,
      async commitSaveSlot(slotId, name, savedSnapshot) {
        resetCommitCalls += 1;
        resetCommitStarted = true;
        await resetCommitGate;
        return base.commitSaveSlot(slotId, name, savedSnapshot);
      },
    };
    const stateful = createStatefulSimulation();

    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => 1_000 }}
        createWorldSeed={() => [113, 127, 131, 137]}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={stateful.simulation}
      />,
    );

    await user.click(await screen.findByText('World lifecycle'));
    await user.type(screen.getByLabelText('Reset confirmation'), 'Founding world');
    const resetButton = screen.getByRole('button', { name: 'Reset active world' });
    const startButton = screen.getByRole('button', { name: 'Start focus' });
    const saveButton = screen.getByRole('button', { name: 'Save now' });
    act(() => {
      fireEvent.click(resetButton);
      fireEvent.click(startButton);
      fireEvent.click(saveButton);
    });

    await waitFor(() => expect(resetCommitStarted).toBe(true));
    expect(startButton).toBeDisabled();
    expect(saveButton).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
    expect(stateful.advanceTicks).not.toHaveBeenCalled();
    expect(resetCommitCalls).toBe(1);

    releaseResetCommit();
    await screen.findByText('Founding world was reset with a fresh seed.');

    expect(screen.getByRole('button', { name: 'Start focus' })).toBeEnabled();
    expect(stateful.advanceTicks).not.toHaveBeenCalled();
    expect(stateful.currentWorld().seed).toStrictEqual([113, 127, 131, 137]);
    expect(stateful.currentTick()).toBe(0);
    expect(deserializeWorldSnapshot((await base.loadSaveSlot('primary'))!.snapshot).tick).toBe(0);
    expect(resetCommitCalls).toBe(1);
  });

  it('freezes queued world operations when a reset result cannot be verified', async () => {
    const user = userEvent.setup();
    const base = createInMemoryPersistenceGateway(() => 1_000);
    const primaryWorld = stepWorld(
      createInitialWorld([2, 3, 5, 7], { width: 8, height: 6, chunkSize: 2 }),
      42,
    );
    await base.commitSaveSlot('primary', 'Founding world', serializeWorldSnapshot(primaryWorld));
    await base.saveSettings({
      ...DEFAULT_APP_SETTINGS,
      activeSlotId: 'primary',
      offlineProgressionEnabled: false,
    });
    let rejectVerificationRead = false;
    let resetCommitCalls = 0;
    let releaseReceiptFailure = (): void => undefined;
    const receiptFailureGate = new Promise<void>((resolve) => {
      releaseReceiptFailure = resolve;
    });
    const gateway: PersistenceGateway = {
      ...base,
      async commitSaveSlot(slotId, name, savedSnapshot) {
        resetCommitCalls += 1;
        await base.commitSaveSlot(slotId, name, savedSnapshot);
        rejectVerificationRead = true;
        await receiptFailureGate;
        throw new Error('Injected post-commit receipt failure');
      },
      async loadSaveSlot(slotId) {
        if (rejectVerificationRead && slotId === 'primary') {
          throw new Error('Injected verification read failure');
        }
        return base.loadSaveSlot(slotId);
      },
    };
    const stateful = createStatefulSimulation();

    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => 1_000 }}
        createWorldSeed={() => [127, 131, 137, 139]}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={stateful.simulation}
      />,
    );

    await user.click(await screen.findByText('World lifecycle'));
    await user.type(screen.getByLabelText('Reset confirmation'), 'Founding world');
    const resetButton = screen.getByRole('button', { name: 'Reset active world' });
    const startButton = screen.getByRole('button', { name: 'Start focus' });
    const saveButton = screen.getByRole('button', { name: 'Save now' });
    act(() => {
      fireEvent.click(resetButton);
      fireEvent.click(startButton);
      fireEvent.click(saveButton);
    });
    await waitFor(() => expect(resetCommitCalls).toBe(1));
    expect(startButton).toBeDisabled();
    expect(saveButton).toBeDisabled();
    releaseReceiptFailure();

    expect(
      await screen.findByText(/World controls are frozen because the reset's durable outcome/),
    ).toBeVisible();
    expect(startButton).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Load local slot' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save now' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Create new world' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Duplicate current world' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset active world' })).toBeDisabled();
    await user.click(screen.getByText('Focus and accessibility settings'));
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled();
    await waitFor(() => expect(resetCommitCalls).toBe(1));
    expect(stateful.advanceTicks).not.toHaveBeenCalled();
    expect(stateful.currentWorld().seed).toStrictEqual([127, 131, 137, 139]);
    expect(deserializeWorldSnapshot((await base.loadSaveSlot('primary'))!.snapshot).seed).toEqual([
      127, 131, 137, 139,
    ]);
  });

  it('freezes world operations if reset rollback cannot restore Worker authority', async () => {
    const user = userEvent.setup();
    const base = createInMemoryPersistenceGateway(() => 1_000);
    const primaryWorld = stepWorld(
      createInitialWorld([2, 3, 5, 7], { width: 8, height: 6, chunkSize: 2 }),
      42,
    );
    await base.commitSaveSlot('primary', 'Founding world', serializeWorldSnapshot(primaryWorld));
    await base.saveSettings({
      ...DEFAULT_APP_SETTINGS,
      activeSlotId: 'primary',
      offlineProgressionEnabled: false,
    });
    let rejectRollback = false;
    const gateway: PersistenceGateway = {
      ...base,
      commitSaveSlot() {
        rejectRollback = true;
        return Promise.reject(new Error('Injected reset commit failure'));
      },
    };
    const stateful = createStatefulSimulation();
    const loadSnapshot = stateful.simulation.loadSnapshot;
    const simulation: WorldSimulationView = {
      ...stateful.simulation,
      loadSnapshot: vi.fn(async (savedSnapshot: string) => {
        if (rejectRollback && deserializeWorldSnapshot(savedSnapshot).seed[0] === 2) {
          throw new Error('Injected Worker rollback failure');
        }
        await loadSnapshot(savedSnapshot);
      }),
    };

    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => 1_000 }}
        createWorldSeed={() => [149, 151, 157, 163]}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={simulation}
      />,
    );

    await user.click(await screen.findByText('World lifecycle'));
    await user.type(screen.getByLabelText('Reset confirmation'), 'Founding world');
    await user.click(screen.getByRole('button', { name: 'Reset active world' }));

    expect(
      await screen.findByText(/World controls are frozen because the reset's durable outcome/),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save now' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
    expect(stateful.currentWorld().seed).toStrictEqual([149, 151, 157, 163]);
    expect(deserializeWorldSnapshot((await base.loadSaveSlot('primary'))!.snapshot).seed).toEqual([
      2, 3, 5, 7,
    ]);
  });

  it('freezes world operations if a committed reset cannot refresh archive state', async () => {
    const user = userEvent.setup();
    const base = createInMemoryPersistenceGateway(() => 1_000);
    const primaryWorld = stepWorld(
      createInitialWorld([2, 3, 5, 7], { width: 8, height: 6, chunkSize: 2 }),
      42,
    );
    await base.commitSaveSlot('primary', 'Founding world', serializeWorldSnapshot(primaryWorld));
    await base.saveSettings({
      ...DEFAULT_APP_SETTINGS,
      activeSlotId: 'primary',
      offlineProgressionEnabled: false,
    });
    let rejectArchiveRefresh = false;
    const gateway: PersistenceGateway = {
      ...base,
      async commitSaveSlot(slotId, name, savedSnapshot) {
        const committed = await base.commitSaveSlot(slotId, name, savedSnapshot);
        rejectArchiveRefresh = true;
        return committed;
      },
      async listSaveSlots() {
        if (rejectArchiveRefresh) throw new Error('Injected archive refresh failure');
        return base.listSaveSlots();
      },
    };
    const stateful = createStatefulSimulation();

    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => 1_000 }}
        createWorldSeed={() => [167, 173, 179, 181]}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={stateful.simulation}
      />,
    );

    await user.click(await screen.findByText('World lifecycle'));
    await user.type(screen.getByLabelText('Reset confirmation'), 'Founding world');
    await user.click(screen.getByRole('button', { name: 'Reset active world' }));

    expect(
      await screen.findByText(/World controls are frozen because the reset's durable outcome/),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save now' })).toBeDisabled();
    expect(stateful.currentWorld().seed).toStrictEqual([167, 173, 179, 181]);
    expect(deserializeWorldSnapshot((await base.loadSaveSlot('primary'))!.snapshot).seed).toEqual([
      167, 173, 179, 181,
    ]);
  });

  it('does not replay stale bootstrap state when the simulation projection changes', async () => {
    const user = userEvent.setup();
    const gateway = createInMemoryPersistenceGateway(() => 1_000);
    await gateway.commitSaveSlot('primary', 'Founding world', snapshot);
    await gateway.commitSaveSlot('world-2', 'Second world', snapshot);
    const stateful = createStatefulSimulation();
    const alerts = { notifyCompletion: () => Promise.resolve() };
    const clock = { now: () => 1_000 };
    const runtime = { gateway, mode: 'browser-preview' } as const;
    const rendered = render(
      <FocusPersistencePanel
        alerts={alerts}
        clock={clock}
        runtime={runtime}
        simulation={stateful.simulation}
      />,
    );

    const slots = await screen.findByRole('combobox', { name: 'Load local slot' });
    await user.selectOptions(slots, 'world-2');
    await screen.findByText('Loaded Second world.');
    expect(screen.getByRole('combobox', { name: 'Load local slot' })).toHaveValue('world-2');

    rendered.rerender(
      <FocusPersistencePanel
        alerts={alerts}
        clock={clock}
        runtime={runtime}
        simulation={{ ...stateful.simulation, events: [] }}
      />,
    );
    await act(async () => Promise.resolve());
    expect(screen.getByRole('combobox', { name: 'Load local slot' })).toHaveValue('world-2');
    expect(screen.getByText('Loaded Second world.')).toBeVisible();
  });

  it('keeps Worker authority on the active slot when target-slot archive refresh fails', async () => {
    const user = userEvent.setup();
    const base = createInMemoryPersistenceGateway(() => 1_000);
    const secondWorld = stepWorld(
      createInitialWorld([5, 6, 7, 8], { width: 2, height: 2, chunkSize: 2 }),
      42,
    );
    await base.commitSaveSlot('primary', 'Founding world', snapshot);
    await base.commitSaveSlot('world-2', 'Second world', serializeWorldSnapshot(secondWorld));
    await base.saveSettings({
      ...DEFAULT_APP_SETTINGS,
      activeSlotId: 'primary',
      offlineProgressionEnabled: false,
    });
    let rejectSecondWorldHistory = false;
    const gateway: PersistenceGateway = {
      ...base,
      async listFocusSessions(sourceSave) {
        if (rejectSecondWorldHistory && sourceSave?.slotId === 'world-2') {
          throw new Error('Injected target history failure');
        }
        return base.listFocusSessions(sourceSave);
      },
    };
    const stateful = createStatefulSimulation();

    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => 1_000 }}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={stateful.simulation}
      />,
    );

    await screen.findByRole('button', { name: 'Start focus' });
    expect(stateful.currentTick()).toBe(0);
    rejectSecondWorldHistory = true;
    await user.selectOptions(screen.getByRole('combobox', { name: 'Load local slot' }), 'world-2');

    expect(await screen.findByText('Archive fault: Injected target history failure')).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Load local slot' })).toHaveValue('primary');
    expect(stateful.currentTick()).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Save now' }));
    await waitFor(async () => {
      const primary = await base.loadSaveSlot('primary');
      expect(deserializeWorldSnapshot(primary!.snapshot).tick).toBe(0);
    });
  });

  it('does not change the active-slot setting when the target Worker load fails', async () => {
    const user = userEvent.setup();
    const base = createInMemoryPersistenceGateway(() => 1_000);
    const secondSnapshot = serializeWorldSnapshot(
      stepWorld(createInitialWorld([5, 6, 7, 8], { width: 2, height: 2, chunkSize: 2 }), 42),
    );
    await base.commitSaveSlot('primary', 'Founding world', snapshot);
    await base.commitSaveSlot('world-2', 'Second world', secondSnapshot);
    await base.saveSettings({
      ...DEFAULT_APP_SETTINGS,
      activeSlotId: 'primary',
      offlineProgressionEnabled: false,
    });
    const savedActiveSlots: (string | null)[] = [];
    const gateway: PersistenceGateway = {
      ...base,
      async saveSettings(settings) {
        savedActiveSlots.push(settings.activeSlotId);
        return base.saveSettings(settings);
      },
    };
    const stateful = createStatefulSimulation();
    const loadSnapshot = stateful.simulation.loadSnapshot;
    const simulation: WorldSimulationView = {
      ...stateful.simulation,
      loadSnapshot: vi.fn(async (savedSnapshot: string) => {
        if (savedSnapshot === secondSnapshot) throw new Error('Injected target load failure');
        await loadSnapshot(savedSnapshot);
      }),
    };

    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => 1_000 }}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={simulation}
      />,
    );

    await screen.findByRole('button', { name: 'Start focus' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Load local slot' }), 'world-2');

    expect(await screen.findByText('Archive fault: Injected target load failure')).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Load local slot' })).toHaveValue('primary');
    expect(stateful.currentTick()).toBe(0);
    expect(savedActiveSlots).toStrictEqual([]);
    expect((await base.loadSettings()).activeSlotId).toBe('primary');
  });

  it('adopts the loaded target safely when its active-slot preference write fails', async () => {
    const user = userEvent.setup();
    const base = createInMemoryPersistenceGateway(() => 1_000);
    const secondSnapshot = serializeWorldSnapshot(
      stepWorld(createInitialWorld([5, 6, 7, 8], { width: 2, height: 2, chunkSize: 2 }), 42),
    );
    await base.commitSaveSlot('primary', 'Founding world', snapshot);
    await base.commitSaveSlot('world-2', 'Second world', secondSnapshot);
    await base.saveSettings({
      ...DEFAULT_APP_SETTINGS,
      activeSlotId: 'primary',
      offlineProgressionEnabled: false,
    });
    let rejectTargetPreference = false;
    const gateway: PersistenceGateway = {
      ...base,
      async saveSettings(settings) {
        if (rejectTargetPreference && settings.activeSlotId === 'world-2') {
          throw new Error('Injected active preference failure');
        }
        return base.saveSettings(settings);
      },
    };
    const stateful = createStatefulSimulation();

    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => 1_000 }}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={stateful.simulation}
      />,
    );

    await screen.findByRole('button', { name: 'Start focus' });
    rejectTargetPreference = true;
    await user.selectOptions(screen.getByRole('combobox', { name: 'Load local slot' }), 'world-2');

    expect(
      await screen.findByText('Archive fault: Injected active preference failure'),
    ).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Load local slot' })).toHaveValue('world-2');
    expect(stateful.currentTick()).toBe(42);
    expect((await base.loadSettings()).activeSlotId).toBe('primary');

    await user.click(screen.getByRole('button', { name: 'Save now' }));
    await waitFor(async () => {
      const primary = await base.loadSaveSlot('primary');
      const second = await base.loadSaveSlot('world-2');
      expect(deserializeWorldSnapshot(primary!.snapshot).tick).toBe(0);
      expect(deserializeWorldSnapshot(second!.snapshot).tick).toBe(42);
    });

    rejectTargetPreference = false;
    await user.click(screen.getByText('Focus and accessibility settings'));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('Settings saved locally.')).toBeVisible();
    expect((await base.loadSettings()).activeSlotId).toBe('world-2');
    expect(
      screen.queryByText('Archive fault: Injected active preference failure'),
    ).not.toBeInTheDocument();
  });

  it('serializes rapid slot selections so the final choice owns Worker, UI, and settings', async () => {
    const base = createInMemoryPersistenceGateway(() => 1_000);
    const secondSnapshot = serializeWorldSnapshot(
      stepWorld(createInitialWorld([5, 6, 7, 8], { width: 2, height: 2, chunkSize: 2 }), 42),
    );
    const thirdSnapshot = serializeWorldSnapshot(
      stepWorld(createInitialWorld([9, 10, 11, 12], { width: 2, height: 2, chunkSize: 2 }), 84),
    );
    await base.commitSaveSlot('primary', 'Founding world', snapshot);
    await base.commitSaveSlot('world-2', 'Second world', secondSnapshot);
    await base.commitSaveSlot('world-3', 'Third world', thirdSnapshot);
    await base.saveSettings({
      ...DEFAULT_APP_SETTINGS,
      activeSlotId: 'primary',
      offlineProgressionEnabled: false,
    });
    let releaseSecondWorld!: () => void;
    const secondWorldGate = new Promise<void>((resolve) => {
      releaseSecondWorld = resolve;
    });
    const targetLoadOrder: string[] = [];
    let targetLoadsInFlight = 0;
    let maximumTargetLoadsInFlight = 0;
    const gateway: PersistenceGateway = {
      ...base,
      async loadSaveSlot(slotId) {
        if (slotId === 'primary') return base.loadSaveSlot(slotId);
        targetLoadOrder.push(slotId);
        targetLoadsInFlight += 1;
        maximumTargetLoadsInFlight = Math.max(maximumTargetLoadsInFlight, targetLoadsInFlight);
        if (slotId === 'world-2') await secondWorldGate;
        const loaded = await base.loadSaveSlot(slotId);
        targetLoadsInFlight -= 1;
        return loaded;
      },
    };
    const stateful = createStatefulSimulation();

    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => 1_000 }}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={stateful.simulation}
      />,
    );

    const slots = await screen.findByRole('combobox', { name: 'Load local slot' });
    fireEvent.change(slots, { target: { value: 'world-2' } });
    fireEvent.change(slots, { target: { value: 'world-3' } });
    await act(async () => Promise.resolve());
    expect(targetLoadOrder).toStrictEqual(['world-2']);
    expect(maximumTargetLoadsInFlight).toBe(1);

    releaseSecondWorld();
    await screen.findByText('Loaded Third world.');
    expect(targetLoadOrder).toStrictEqual(['world-2', 'world-3']);
    expect(maximumTargetLoadsInFlight).toBe(1);
    expect(screen.getByRole('combobox', { name: 'Load local slot' })).toHaveValue('world-3');
    expect(stateful.currentTick()).toBe(84);
    expect((await base.loadSettings()).activeSlotId).toBe('world-3');
  });

  it('saves to the Worker-owned target when Save now queues behind a slot switch', async () => {
    const user = userEvent.setup();
    const base = createInMemoryPersistenceGateway(() => 1_000);
    const secondSnapshot = serializeWorldSnapshot(
      stepWorld(createInitialWorld([5, 6, 7, 8], { width: 2, height: 2, chunkSize: 2 }), 42),
    );
    await base.commitSaveSlot('primary', 'Founding world', snapshot);
    await base.commitSaveSlot('world-2', 'Second world', secondSnapshot);
    await base.saveSettings({
      ...DEFAULT_APP_SETTINGS,
      activeSlotId: 'primary',
      offlineProgressionEnabled: false,
    });
    let releaseSecondWorld!: () => void;
    const secondWorldGate = new Promise<void>((resolve) => {
      releaseSecondWorld = resolve;
    });
    let secondWorldLoadStarted = false;
    const committedSlots: string[] = [];
    const gateway: PersistenceGateway = {
      ...base,
      async commitSaveSlot(slotId, name, savedSnapshot) {
        committedSlots.push(slotId);
        return base.commitSaveSlot(slotId, name, savedSnapshot);
      },
      async loadSaveSlot(slotId) {
        if (slotId === 'world-2') {
          secondWorldLoadStarted = true;
          await secondWorldGate;
        }
        return base.loadSaveSlot(slotId);
      },
    };
    const stateful = createStatefulSimulation();

    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => 1_000 }}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={stateful.simulation}
      />,
    );

    const slots = await screen.findByRole('combobox', { name: 'Load local slot' });
    await user.selectOptions(slots, 'world-2');
    await waitFor(() => expect(secondWorldLoadStarted).toBe(true));
    await user.click(screen.getByRole('button', { name: 'Save now' }));

    releaseSecondWorld();
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Load local slot' })).toHaveValue('world-2'),
    );
    await waitFor(() => expect(committedSlots).toStrictEqual(['world-2']));
    expect(stateful.currentTick()).toBe(42);
    expect(deserializeWorldSnapshot((await base.loadSaveSlot('primary'))!.snapshot).tick).toBe(0);
    expect(deserializeWorldSnapshot((await base.loadSaveSlot('world-2'))!.snapshot).tick).toBe(42);
  });

  it('checkpoints accepted focus time before exporting the current world', async () => {
    const user = userEvent.setup();
    let nowMs = 1_000;
    const gateway = createInMemoryPersistenceGateway(() => nowMs);
    await gateway.commitSaveSlot('primary', 'Founding world', snapshot);
    await gateway.saveSettings({
      ...DEFAULT_APP_SETTINGS,
      activeSlotId: 'primary',
      offlineProgressionEnabled: false,
    });
    const stateful = createStatefulSimulation();

    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => nowMs }}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={stateful.simulation}
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Start focus' }));
    await screen.findByText('Session saved.');
    nowMs += 1_000;
    await user.click(screen.getByText('Import or export package'));
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await screen.findByText('Export package refreshed from the current world.');

    const savePackage = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Export package',
    }).value;
    const exported = JSON.parse(savePackage) as { snapshot: string };
    expect(deserializeWorldSnapshot(exported.snapshot).tick).toBe(10);
    const persisted = await gateway.loadSaveSlot('primary');
    expect(persisted?.focusSession).toMatchObject({
      focusedMs: 1_000,
      issuedSimulationTicks: 10,
      status: 'active',
    });
  });

  it('queues settings behind a slot switch and preserves the final active world', async () => {
    const user = userEvent.setup();
    const base = createInMemoryPersistenceGateway(() => 1_000);
    const secondSnapshot = serializeWorldSnapshot(
      stepWorld(createInitialWorld([5, 6, 7, 8], { width: 2, height: 2, chunkSize: 2 }), 42),
    );
    await base.commitSaveSlot('primary', 'Founding world', snapshot);
    await base.commitSaveSlot('world-2', 'Second world', secondSnapshot);
    await base.saveSettings({
      ...DEFAULT_APP_SETTINGS,
      activeSlotId: 'primary',
      offlineProgressionEnabled: false,
    });
    let releaseSecondWorld!: () => void;
    const secondWorldGate = new Promise<void>((resolve) => {
      releaseSecondWorld = resolve;
    });
    let secondWorldLoadStarted = false;
    const runtimeSettingsWrites: AppSettings[] = [];
    const gateway: PersistenceGateway = {
      ...base,
      async loadSaveSlot(slotId) {
        if (slotId === 'world-2') {
          secondWorldLoadStarted = true;
          await secondWorldGate;
        }
        return base.loadSaveSlot(slotId);
      },
      async saveSettings(nextSettings) {
        runtimeSettingsWrites.push(nextSettings);
        return base.saveSettings(nextSettings);
      },
    };

    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => 1_000 }}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={createStatefulSimulation().simulation}
      />,
    );

    const slots = await screen.findByRole('combobox', { name: 'Load local slot' });
    await user.click(screen.getByText('Focus and accessibility settings'));
    await user.click(screen.getByRole('checkbox', { name: 'Calm focus mode' }));
    fireEvent.change(slots, { target: { value: 'world-2' } });
    await waitFor(() => expect(secondWorldLoadStarted).toBe(true));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await act(async () => Promise.resolve());
    expect(runtimeSettingsWrites).toStrictEqual([]);

    releaseSecondWorld();
    await screen.findByText('Settings saved locally.');
    expect(screen.getByRole('combobox', { name: 'Load local slot' })).toHaveValue('world-2');
    expect(document.documentElement).toHaveClass('calm-mode');
    await expect(base.loadSettings()).resolves.toMatchObject({
      activeSlotId: 'world-2',
      calmMode: true,
    });
  });

  it('publishes an export queued by an outgoing workspace into the remounted target', async () => {
    const user = userEvent.setup();
    const base = createInMemoryPersistenceGateway(() => 1_000);
    const secondSnapshot = serializeWorldSnapshot(
      stepWorld(createInitialWorld([5, 6, 7, 8], { width: 2, height: 2, chunkSize: 2 }), 42),
    );
    await base.commitSaveSlot('primary', 'Founding world', snapshot);
    await base.commitSaveSlot('world-2', 'Second world', secondSnapshot);
    await base.saveSettings({
      ...DEFAULT_APP_SETTINGS,
      activeSlotId: 'primary',
      offlineProgressionEnabled: false,
    });
    let releaseSecondWorld!: () => void;
    const secondWorldGate = new Promise<void>((resolve) => {
      releaseSecondWorld = resolve;
    });
    let releaseTargetPreference!: () => void;
    const targetPreferenceGate = new Promise<void>((resolve) => {
      releaseTargetPreference = resolve;
    });
    let secondWorldLoadStarted = false;
    let targetPreferenceStarted = false;
    const exportedSlots: string[] = [];
    const gateway: PersistenceGateway = {
      ...base,
      async exportSaveSlot(slotId) {
        exportedSlots.push(slotId);
        return base.exportSaveSlot(slotId);
      },
      async loadSaveSlot(slotId) {
        if (slotId === 'world-2') {
          secondWorldLoadStarted = true;
          await secondWorldGate;
        }
        return base.loadSaveSlot(slotId);
      },
      async saveSettings(nextSettings) {
        if (nextSettings.activeSlotId === 'world-2') {
          targetPreferenceStarted = true;
          await targetPreferenceGate;
        }
        return base.saveSettings(nextSettings);
      },
    };

    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => 1_000 }}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={createStatefulSimulation().simulation}
      />,
    );

    const slots = await screen.findByRole('combobox', { name: 'Load local slot' });
    fireEvent.change(slots, { target: { value: 'world-2' } });
    await waitFor(() => expect(secondWorldLoadStarted).toBe(true));
    await user.click(screen.getByRole('button', { name: 'Export' }));
    releaseSecondWorld();
    await screen.findByText('Loaded Second world.');
    await waitFor(() => expect(targetPreferenceStarted).toBe(true));
    expect(exportedSlots).toStrictEqual([]);

    releaseTargetPreference();
    await screen.findByText('Export package refreshed from the current world.');
    expect(exportedSlots).toStrictEqual(['world-2']);
    await user.click(screen.getByText('Import or export package'));
    const savePackage = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Export package',
    }).value;
    const exported = JSON.parse(savePackage) as { slotId: string; snapshot: string };
    expect(exported.slotId).toBe('world-2');
    expect(deserializeWorldSnapshot(exported.snapshot).tick).toBe(42);
  });

  it('keeps Save now behind rapid slot switches across keyed workspace replacements', async () => {
    const user = userEvent.setup();
    const base = createInMemoryPersistenceGateway(() => 1_000);
    const secondSnapshot = serializeWorldSnapshot(
      stepWorld(createInitialWorld([5, 6, 7, 8], { width: 2, height: 2, chunkSize: 2 }), 42),
    );
    const thirdSnapshot = serializeWorldSnapshot(
      stepWorld(createInitialWorld([9, 10, 11, 12], { width: 2, height: 2, chunkSize: 2 }), 84),
    );
    await base.commitSaveSlot('primary', 'Founding world', snapshot);
    await base.commitSaveSlot('world-2', 'Second world', secondSnapshot);
    await base.commitSaveSlot('world-3', 'Third world', thirdSnapshot);
    await base.saveSettings({
      ...DEFAULT_APP_SETTINGS,
      activeSlotId: 'primary',
      offlineProgressionEnabled: false,
    });
    let releaseThirdPreference!: () => void;
    const thirdPreferenceGate = new Promise<void>((resolve) => {
      releaseThirdPreference = resolve;
    });
    let thirdPreferenceStarted = false;
    const committedSlots: string[] = [];
    const gateway: PersistenceGateway = {
      ...base,
      async commitSaveSlot(slotId, name, savedSnapshot) {
        committedSlots.push(slotId);
        return base.commitSaveSlot(slotId, name, savedSnapshot);
      },
      async saveSettings(settings) {
        if (settings.activeSlotId === 'world-3') {
          thirdPreferenceStarted = true;
          await thirdPreferenceGate;
        }
        return base.saveSettings(settings);
      },
    };
    const stateful = createStatefulSimulation();

    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => 1_000 }}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={stateful.simulation}
      />,
    );

    const slots = await screen.findByRole('combobox', { name: 'Load local slot' });
    fireEvent.change(slots, { target: { value: 'world-2' } });
    fireEvent.change(slots, { target: { value: 'world-3' } });
    await waitFor(() => expect(thirdPreferenceStarted).toBe(true));
    await screen.findByText('Loaded Third world.');
    expect(stateful.currentTick()).toBe(84);

    await user.click(screen.getByRole('button', { name: 'Save now' }));
    await act(async () => Promise.resolve());
    expect(committedSlots).toStrictEqual([]);
    releaseThirdPreference();

    await waitFor(() => expect(committedSlots).toStrictEqual(['world-3']));
    expect(deserializeWorldSnapshot((await base.loadSaveSlot('primary'))!.snapshot).tick).toBe(0);
    expect(deserializeWorldSnapshot((await base.loadSaveSlot('world-2'))!.snapshot).tick).toBe(42);
    expect(deserializeWorldSnapshot((await base.loadSaveSlot('world-3'))!.snapshot).tick).toBe(84);
  });

  it('rejects a queued final switch before abandoning an intermediate running session', async () => {
    const user = userEvent.setup();
    let nowMs = 1_000;
    const base = createInMemoryPersistenceGateway(() => nowMs);
    const secondSnapshot = serializeWorldSnapshot(
      stepWorld(createInitialWorld([5, 6, 7, 8], { width: 2, height: 2, chunkSize: 2 }), 42),
    );
    const thirdSnapshot = serializeWorldSnapshot(
      stepWorld(createInitialWorld([9, 10, 11, 12], { width: 2, height: 2, chunkSize: 2 }), 84),
    );
    const runningState = startFocus(
      createIdleFocusState(),
      { focusDurationMs: 10_000, breakDurationMs: 0, simulationTicksPerFocusSecond: 10 },
      nowMs,
    );
    await base.commitSaveSlot('primary', 'Founding world', snapshot);
    await base.commitFocusCheckpoint(
      'world-2',
      'Second world',
      secondSnapshot,
      focusSessionFromState('world-2-running', 'world-2', runningState, []),
      [],
    );
    await base.commitSaveSlot('world-3', 'Third world', thirdSnapshot);
    await base.saveSettings({
      ...DEFAULT_APP_SETTINGS,
      activeSlotId: 'primary',
      offlineProgressionEnabled: false,
    });
    let thirdHistoryReads = 0;
    const gateway: PersistenceGateway = {
      ...base,
      async listFocusSessions(sourceSave) {
        if (sourceSave?.slotId === 'world-3') {
          thirdHistoryReads += 1;
        }
        return base.listFocusSessions(sourceSave);
      },
      async saveSettings(settings) {
        if (settings.activeSlotId === 'world-2') {
          throw new Error('Injected intermediate preference failure');
        }
        return base.saveSettings(settings);
      },
    };
    const stateful = createStatefulSimulation();

    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => nowMs }}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={stateful.simulation}
      />,
    );

    const slots = await screen.findByRole('combobox', { name: 'Load local slot' });
    fireEvent.change(slots, { target: { value: 'world-2' } });
    fireEvent.change(slots, { target: { value: 'world-3' } });
    expect(
      await screen.findByText(
        'Archive fault: Finish or cancel the active focus session before switching worlds.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Load local slot' })).toHaveValue('world-2');
    expect(screen.getByRole('button', { name: 'Pause' })).toBeVisible();
    expect(thirdHistoryReads).toBe(0);
    expect(stateful.currentTick()).toBe(42);
    expect((await base.loadSettings()).activeSlotId).toBe('primary');

    nowMs += 1_000;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });

    await waitFor(() => expect(stateful.currentTick()).toBe(52));
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(async () => {
      const second = await base.loadSaveSlot('world-2');
      expect(deserializeWorldSnapshot(second!.snapshot).tick).toBe(52);
      expect(second?.focusSession?.issuedSimulationTicks).toBe(10);
    });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(
        screen.queryByText(
          'Archive fault: Finish or cancel the active focus session before switching worlds.',
        ),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByText('Archive fault: Injected intermediate preference failure'),
    ).toBeVisible();
    expect(deserializeWorldSnapshot((await base.loadSaveSlot('world-3'))!.snapshot).tick).toBe(84);
  });

  it('freezes an active focus session when the authoritative Worker faults', async () => {
    const user = userEvent.setup();
    let nowMs = 1_000;
    const gateway = createInMemoryPersistenceGateway(() => nowMs);
    const stateful = createStatefulSimulation();
    const alerts = { notifyCompletion: () => Promise.resolve() };
    const clock = { now: () => nowMs };
    const runtime = { gateway, mode: 'browser-preview' } as const;
    const rendered = render(
      <FocusPersistencePanel
        alerts={alerts}
        clock={clock}
        runtime={runtime}
        simulation={stateful.simulation}
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Start focus' }));
    nowMs += 1_000;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(stateful.currentTick()).toBe(10));
    const timerBeforeFault = screen.getByRole('timer', {
      name: 'Focus time remaining',
    }).textContent;

    rendered.rerender(
      <FocusPersistencePanel
        alerts={alerts}
        clock={clock}
        runtime={runtime}
        simulation={{
          ...stateful.simulation,
          error: 'Injected fatal Worker fault',
          status: 'faulted',
        }}
      />,
    );

    expect(await screen.findByText(/Focus controls are frozen/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Complete focus' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save now' })).toBeDisabled();

    nowMs += 5_000;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => Promise.resolve());
    expect(stateful.currentTick()).toBe(10);
    expect(screen.getByRole('timer', { name: 'Focus time remaining' })).toHaveTextContent(
      timerBeforeFault ?? '',
    );
  });

  it('exports the last durable checkpoint without consulting a faulted Worker', async () => {
    const user = userEvent.setup();
    let nowMs = 1_000;
    const gateway = createInMemoryPersistenceGateway(() => nowMs);
    const stateful = createStatefulSimulation();
    const alerts = { notifyCompletion: () => Promise.resolve() };
    const clock = { now: () => nowMs };
    const runtime = { gateway, mode: 'browser-preview' } as const;
    const rendered = render(
      <FocusPersistencePanel
        alerts={alerts}
        clock={clock}
        runtime={runtime}
        simulation={stateful.simulation}
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Start focus' }));
    nowMs += 1_000;
    await user.click(screen.getByRole('button', { name: 'Save now' }));
    await screen.findByText('World saved manually.');
    const durable = await gateway.loadSaveSlot('primary');
    expect(deserializeWorldSnapshot(durable!.snapshot).tick).toBe(10);
    const saveRequestsBeforeFault = vi.mocked(stateful.simulation.requestSave).mock.calls.length;
    const checkpointRequestsBeforeFault = vi.mocked(stateful.simulation.requestFocusCheckpoint).mock
      .calls.length;

    rendered.rerender(
      <FocusPersistencePanel
        alerts={alerts}
        clock={clock}
        runtime={runtime}
        simulation={{
          ...stateful.simulation,
          error: 'Injected fatal Worker fault',
          status: 'faulted',
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await screen.findByText('Export package prepared from the last valid local checkpoint.');
    expect(vi.mocked(stateful.simulation.requestSave)).toHaveBeenCalledTimes(
      saveRequestsBeforeFault,
    );
    expect(vi.mocked(stateful.simulation.requestFocusCheckpoint)).toHaveBeenCalledTimes(
      checkpointRequestsBeforeFault,
    );
    await user.click(screen.getByText('Import or export package'));
    const savePackage = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Export package',
    }).value;
    const exported = JSON.parse(savePackage) as { snapshot: string };
    expect(exported.snapshot).toBe(durable!.snapshot);
  });

  it('scopes statistics and recaps to the active world slot', async () => {
    const user = userEvent.setup();
    const gateway = createInMemoryPersistenceGateway(() => 1_000);
    await gateway.commitSaveSlot('primary', 'Founding world', snapshot);
    await gateway.commitSaveSlot('world-2', 'Second world', snapshot);
    const primaryState = completeFocus(
      startFocus(
        createIdleFocusState(),
        { focusDurationMs: 300_000, breakDurationMs: 0, simulationTicksPerFocusSecond: 1 },
        1_000,
      ),
      301_000,
    );
    const secondState = completeFocus(
      startFocus(
        createIdleFocusState(),
        { focusDurationMs: 120_000, breakDurationMs: 0, simulationTicksPerFocusSecond: 1 },
        500,
      ),
      120_500,
    );
    await gateway.recordFocusSession(
      {
        ...focusSessionFromState('primary-session', 'primary', primaryState, [1]),
        recapEntries: [{ id: 1, tick: 0, summary: 'The founding world formed.' }],
      },
      [1],
    );
    await gateway.recordFocusSession(
      {
        ...focusSessionFromState('second-session', 'world-2', secondState, [1]),
        recapEntries: [{ id: 1, tick: 0, summary: 'The founding world formed.' }],
      },
      [1],
    );
    await gateway.saveSettings({
      ...DEFAULT_APP_SETTINGS,
      activeSlotId: 'world-2',
      offlineProgressionEnabled: false,
    });

    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => 1_000 }}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={createStatefulSimulation().simulation}
      />,
    );

    await screen.findByRole('button', { name: 'Start focus' });
    const completed = screen.getByText('Completed sessions').closest('div');
    const focused = screen.getByText('Focused time').closest('div');
    expect(completed).not.toBeNull();
    expect(focused).not.toBeNull();
    expect(within(completed!).getByText('1')).toBeVisible();
    expect(within(focused!).getByText('2 min')).toBeVisible();
    expect(screen.getByText('Tick 0: The founding world formed.')).toBeVisible();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Load local slot' }), 'primary');
    await screen.findByText('Loaded Founding world.');
    expect(screen.getByText('Tick 0: The founding world formed.')).toBeVisible();
    expect(
      within(screen.getByText('Focused time').closest('div')!).getByText('5 min'),
    ).toBeVisible();
  });

  it('renders a persisted before-and-after review, honest quiet interval, and revisit action', async () => {
    const user = userEvent.setup();
    const gateway = createInMemoryPersistenceGateway(() => 1_000);
    await gateway.commitSaveSlot('primary', 'Founding world', snapshot);
    const completedState = completeFocus(
      startFocus(
        createIdleFocusState(),
        { focusDurationMs: 60_000, breakDurationMs: 0, simulationTicksPerFocusSecond: 1 },
        1_000,
      ),
      61_000,
    );
    const beforeWorld = deserializeWorldSnapshot(snapshot);
    const afterWorld = stepWorld(beforeWorld, 60);
    const baseline = projectFocusCheckpoint(beforeWorld, null);
    const completedCheckpoint = projectFocusCheckpoint(afterWorld, baseline.latestEventId);
    const review = {
      version: FOCUS_SESSION_REVIEW_VERSION,
      baselineEventId: baseline.latestEventId,
      before: baseline.moment,
      after: completedCheckpoint.moment,
      revisitTarget: completedCheckpoint.revisitTarget,
    } as const;
    await gateway.commitFocusCheckpoint(
      'primary',
      'Founding world',
      serializeWorldSnapshot(afterWorld),
      {
        ...focusSessionFromState('persisted-recap', 'primary', completedState, []),
        review,
      },
      [],
    );
    await gateway.saveSettings({
      ...DEFAULT_APP_SETTINGS,
      offlineProgressionEnabled: false,
    });

    const onRevisitTarget = vi.fn();
    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => 1_000 }}
        onRevisitTarget={onRevisitTarget}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={createStatefulSimulation().simulation}
      />,
    );

    const recap = await screen.findByRole('heading', { name: 'Latest factual recap' });
    expect(recap.parentElement).toHaveTextContent('World tick 0 → 60');
    expect(recap.parentElement).toHaveTextContent('Tracked settlement facts were unchanged.');
    expect(recap.parentElement).toHaveTextContent(
      'No major event was recorded during this session.',
    );
    const revisit = within(recap.parentElement!).getByRole('button', { name: /^Revisit / });
    await user.click(revisit);
    expect(onRevisitTarget).toHaveBeenCalledWith(review.revisitTarget);
  });

  it('persists reduced effects and exposes the integration root class', async () => {
    const user = userEvent.setup();
    const gateway = createInMemoryPersistenceGateway(() => 1_000);
    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => 1_000 }}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={createStatefulSimulation().simulation}
      />,
    );

    await user.click(await screen.findByText('Focus and accessibility settings'));
    await user.click(screen.getByRole('checkbox', { name: 'Reduce visual effects' }));
    expect(document.documentElement).toHaveClass('reduced-effects');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await expect(gateway.loadSettings()).resolves.toMatchObject({ reducedEffects: true });
  });

  it('routes focus cues and persists explicit quiet audio controls with visible redundancy', async () => {
    const user = userEvent.setup();
    const gateway = createInMemoryPersistenceGateway(() => 1_000);
    const playCue = vi.fn(() => Promise.resolve());
    const soundscape = {
      playCue,
      stop: vi.fn(() => Promise.resolve()),
      updateAtmosphere: vi.fn(() => Promise.resolve()),
    };
    const onSettingsChange = vi.fn();
    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => 1_000 }}
        onSettingsChange={onSettingsChange}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={createStatefulSimulation().simulation}
        soundscape={soundscape}
      />,
    );

    await user.click(await screen.findByText('Focus and accessibility settings'));
    expect(screen.getByText(/^Audio:/)).toHaveTextContent(
      'Audio: master 70% · ambience off · effects 45%.',
    );
    await user.click(screen.getByRole('button', { name: 'Preview audio' }));
    expect(playCue).toHaveBeenCalledWith('discovery', expect.any(Object));

    await user.click(screen.getByRole('checkbox', { name: 'Ambient soundscape' }));
    fireEvent.change(screen.getByRole('slider', { name: 'Ambience volume percent' }), {
      target: { value: '18' },
    });
    fireEvent.change(screen.getByRole('slider', { name: 'Effects volume percent' }), {
      target: { value: '32' },
    });
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await expect(gateway.loadSettings()).resolves.toMatchObject({
      ambienceEnabled: true,
      ambienceVolumePercent: 18,
      effectsVolumePercent: 32,
    });
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ ambienceEnabled: true, ambienceVolumePercent: 18 }),
    );

    await user.click(screen.getByRole('button', { name: 'Start focus' }));
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(playCue).toHaveBeenCalledWith('focus-start', expect.any(Object));
    expect(playCue).toHaveBeenCalledWith('focus-pause', expect.any(Object));
  });

  it('surfaces native string failures without discarding their actionable message', async () => {
    const user = userEvent.setup();
    const base = createInMemoryPersistenceGateway(() => 1_000);
    let rejectSettings = false;
    const gateway: PersistenceGateway = {
      ...base,
      async saveSettings(settings) {
        // Tauri can reject with a native string; this intentionally exercises that boundary.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        if (rejectSettings) return Promise.reject('native settings write failed');
        return base.saveSettings(settings);
      },
    };
    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => 1_000 }}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={createStatefulSimulation().simulation}
      />,
    );

    await screen.findByRole('button', { name: 'Start focus' });
    rejectSettings = true;
    await user.click(screen.getByText('Focus and accessibility settings'));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Archive fault: native settings write failed',
    );
  });

  it('keeps focus history distinct across remounts at the same clock value', async () => {
    const user = userEvent.setup();
    const gateway = createInMemoryPersistenceGateway(() => 1_000);
    const first = render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => 1_000 }}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={createStatefulSimulation().simulation}
      />,
    );
    await user.click(await screen.findByRole('button', { name: 'Start focus' }));
    await user.click(screen.getByRole('button', { name: 'Complete focus' }));
    await screen.findByText('Session recorded with a factual recap.');
    first.unmount();

    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion: () => Promise.resolve() }}
        clock={{ now: () => 1_000 }}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={createStatefulSimulation().simulation}
      />,
    );
    await user.click(await screen.findByRole('button', { name: 'Start focus' }));
    await user.click(screen.getByRole('button', { name: 'Complete focus' }));
    await screen.findByText('Session recorded with a factual recap.');

    const sessions = await gateway.listFocusSessions();
    expect(sessions).toHaveLength(2);
    expect(new Set(sessions.map((session) => session.sessionId)).size).toBe(2);
  });

  it('emits completion feedback only after the matching checkpoint is durable', async () => {
    const user = userEvent.setup();
    const base = createInMemoryPersistenceGateway(() => 1_000);
    let releaseCompletion: (() => void) | undefined;
    let reportCompletionStarted: (() => void) | undefined;
    const completionGate = new Promise<void>((resolve) => {
      releaseCompletion = resolve;
    });
    const completionStarted = new Promise<void>((resolve) => {
      reportCompletionStarted = resolve;
    });
    const gateway: PersistenceGateway = {
      ...base,
      async commitFocusCheckpoint(slotId, name, savedSnapshot, session, sourceEventIds) {
        if (session.status === 'completed') {
          reportCompletionStarted?.();
          await completionGate;
        }
        return base.commitFocusCheckpoint(slotId, name, savedSnapshot, session, sourceEventIds);
      },
    };
    const notifyCompletion = vi.fn(() => Promise.resolve());
    const rendered = render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion }}
        clock={{ now: () => 1_000 }}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={createStatefulSimulation().simulation}
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Start focus' }));
    await waitFor(async () => expect(await gateway.listFocusSessions()).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Complete focus' }));
    await completionStarted;
    expect(notifyCompletion).not.toHaveBeenCalled();
    releaseCompletion?.();
    await waitFor(() => expect(notifyCompletion).toHaveBeenCalledOnce());
    rendered.unmount();

    render(
      <FocusPersistencePanel
        alerts={{ notifyCompletion }}
        clock={{ now: () => 1_000 }}
        runtime={{ gateway, mode: 'browser-preview' }}
        simulation={createStatefulSimulation().simulation}
      />,
    );
    await screen.findByRole('button', { name: 'Start focus' });
    expect(notifyCompletion).toHaveBeenCalledOnce();
  });
});
