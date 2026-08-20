import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import {
  DEFAULT_APP_SETTINGS,
  createInMemoryPersistenceGateway,
  type PersistenceGateway,
} from '../../src/adapters/persistence';
import { completeFocus, createIdleFocusState, startFocus } from '../../src/focus';
import { deserializeWorldSnapshot, serializeWorldSnapshot } from '../../src/simulation/persistence';
import { createInitialWorld, stepWorld, type WorldState } from '../../src/simulation/world';
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
      frame: null,
      loadSnapshot,
      mainThreadHash: null,
      performOfflineCatchUp,
      requestSave: vi.fn<() => Promise<string>>().mockResolvedValue(snapshot),
      status: 'ready',
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
      frame: null,
      loadSnapshot: vi.fn(async (savedSnapshot: string) => {
        world = deserializeWorldSnapshot(savedSnapshot);
        await Promise.resolve();
      }),
      mainThreadHash: null,
      performOfflineCatchUp: vi.fn().mockResolvedValue(undefined),
      requestSave: vi.fn(async () => {
        await Promise.resolve();
        return serializeWorldSnapshot(world);
      }),
      status: 'ready',
    },
    currentTick: () => world.tick,
    advanceTicks,
  };
}

describe('FocusPersistencePanel offline progression', () => {
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

  it('scopes statistics and recaps to the active world slot', async () => {
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
      focusSessionFromState('primary-session', 'primary', primaryState, [1]),
      [1],
    );
    await gateway.recordFocusSession(
      focusSessionFromState('second-session', 'world-2', secondState, [1]),
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
