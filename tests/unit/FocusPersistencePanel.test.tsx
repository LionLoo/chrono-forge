import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import {
  DEFAULT_APP_SETTINGS,
  createInMemoryPersistenceGateway,
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

  it('reloads a manual save with the exact matching active focus checkpoint', async () => {
    const user = userEvent.setup();
    let nowMs = 1_000;
    const gateway = createInMemoryPersistenceGateway(() => nowMs);
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
    nowMs += 10_000;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(first.currentTick()).toBe(100));
    await user.click(screen.getByRole('button', { name: 'Save now' }));
    await screen.findByText('World saved manually.');

    const checkpoint = await gateway.loadSaveSlot('primary');
    expect(deserializeWorldSnapshot(checkpoint!.snapshot).tick).toBe(100);
    expect(checkpoint?.focusSession).toMatchObject({
      issuedSimulationTicks: 100,
      status: 'active',
      review: {
        version: 1,
        before: { tick: 0 },
        after: { tick: 100 },
      },
    });
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
    expect(restored.currentTick()).toBe(100);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(restored.advanceTicks).not.toHaveBeenCalled();
    nowMs += 1_000;
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(restored.currentTick()).toBe(110));
    await waitFor(async () =>
      expect((await gateway.loadSaveSlot('primary'))?.focusSession?.review).toMatchObject({
        before: { tick: 0 },
        after: { tick: 110 },
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

    expect(await screen.findByText('Save fault: native settings write failed')).toBeVisible();
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
