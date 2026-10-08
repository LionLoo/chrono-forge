import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { App } from '../../src/App';
import {
  createInMemoryPersistenceGateway,
  DEFAULT_APP_SETTINGS,
  type PersistenceGateway,
} from '../../src/adapters/persistence';
import type { RuntimePersistence } from '../../src/adapters/runtime-persistence';
import type { GameSoundscape } from '../../src/adapters/soundscape';
import { projectFocusCheckpoint } from '../../src/focus/session-review';
import { PROJECT_META } from '../../src/project-meta';
import {
  WORKER_PROTOCOL_VERSION,
  type UiToWorkerMessage,
  type WorkerToUiMessage,
  type WorldFrameProjection,
} from '../../src/protocol';
import type { WorldCamera } from '../../src/rendering/camera';
import type { WorldOverlay } from '../../src/rendering/world-palette';
import { deserializeWorldSnapshot, serializeWorldSnapshot } from '../../src/simulation/persistence';
import { createInitialWorld } from '../../src/simulation/world';
import {
  DEMO_WORLD_CONFIG,
  DEMO_WORLD_SEED,
  type SimulationWorkerPort,
} from '../../src/ui/useWorldSimulation';
import { createSimulationRuntime } from '../../src/workers/simulation-runtime';

vi.mock('../../src/rendering/WorldMapCanvas', () => ({
  WorldMapCanvas: ({
    camera,
    onViewportResize,
    overlay,
    reducedEffects,
    selection,
  }: {
    readonly camera: WorldCamera;
    readonly onViewportResize?: (width: number, height: number) => void;
    readonly overlay: WorldOverlay;
    readonly reducedEffects?: boolean;
    readonly selection?: { readonly id: number; readonly kind: string } | null;
  }) => (
    <>
      <div
        aria-label="Generated Chrono Forge world"
        data-camera={`${camera.x}:${camera.y}:${camera.zoom}`}
        data-effects={reducedEffects ? 'reduced' : 'full'}
        data-overlay={overlay}
        data-selection={
          selection === undefined || selection === null
            ? 'none'
            : `${selection.kind}:${selection.id}`
        }
        role="img"
      />
      <button
        aria-label="Simulate large map viewport"
        onClick={() => onViewportResize?.(1_600, 1_000)}
        type="button"
      />
      <button
        aria-label="Simulate larger map viewport"
        onClick={() => onViewportResize?.(2_000, 1_200)}
        type="button"
      />
    </>
  ),
}));

function createRuntimeWorker(): SimulationWorkerPort {
  let active = true;
  const runtime = createSimulationRuntime((message: WorkerToUiMessage) => {
    queueMicrotask(() => {
      if (active) port.onmessage?.(new MessageEvent('message', { data: message }));
    });
  });

  const port: SimulationWorkerPort = {
    onerror: null,
    onmessage: null,
    postMessage(message: UiToWorkerMessage) {
      runtime.handleMessage(message);
    },
    terminate() {
      active = false;
    },
  };
  return port;
}

function createFrameRemovalWorker(): {
  readonly removeFirstAgent: () => void;
  readonly workerFactory: () => SimulationWorkerPort;
} {
  let initialFrame: WorldFrameProjection | null = null;
  let pendingLoadRequestId: string | null = null;
  let removalRequested = false;
  let publishRequestedRemoval: (() => void) | null = null;
  const workerFactory = () => {
    let active = true;
    const publishRemovedFrame = () => {
      if (!active || !removalRequested || initialFrame === null || pendingLoadRequestId === null)
        return;
      const removedId = initialFrame.agentIds[0];
      if (removedId === undefined) throw new Error('test frame has no removable agent');
      const frame: WorldFrameProjection = {
        ...initialFrame,
        agentActions: initialFrame.agentActions.slice(1),
        agentHealth: initialFrame.agentHealth.slice(1),
        agentIds: initialFrame.agentIds.slice(1),
        agentTiles: initialFrame.agentTiles.slice(1),
        society: {
          ...initialFrame.society,
          people: initialFrame.society.people.filter((person) => person.id !== removedId),
        },
        stateHash: `${initialFrame.stateHash}-without-${removedId}`,
        tick: initialFrame.tick + 1,
      };
      port.onmessage?.(
        new MessageEvent('message', {
          data: {
            frame,
            protocolVersion: WORKER_PROTOCOL_VERSION,
            requestId: pendingLoadRequestId,
            type: 'ready',
          } satisfies WorkerToUiMessage,
        }),
      );
      pendingLoadRequestId = null;
    };
    publishRequestedRemoval = publishRemovedFrame;
    const runtime = createSimulationRuntime((message: WorkerToUiMessage) => {
      if (message.type === 'ready' && initialFrame === null) initialFrame = message.frame;
      queueMicrotask(() => {
        if (active) port.onmessage?.(new MessageEvent('message', { data: message }));
      });
    });

    const port: SimulationWorkerPort = {
      onerror: null,
      onmessage: null,
      postMessage(message: UiToWorkerMessage) {
        if (message.type === 'load') {
          pendingLoadRequestId = message.requestId;
          publishRemovedFrame();
          return;
        }
        runtime.handleMessage(message);
      },
      terminate() {
        active = false;
      },
    };
    return port;
  };
  return {
    removeFirstAgent() {
      removalRequested = true;
      publishRequestedRemoval?.();
    },
    workerFactory,
  };
}

function createRuntimeErrorWorker(): {
  readonly fail: () => void;
  readonly workerFactory: () => SimulationWorkerPort;
} {
  let fail: (() => void) | null = null;
  return {
    fail() {
      if (fail === null) throw new Error('test worker is not ready');
      fail();
    },
    workerFactory() {
      const port = createRuntimeWorker();
      fail = () => {
        port.onerror?.(new ErrorEvent('error', { message: 'Injected runtime failure' }));
      };
      return port;
    },
  };
}

function createPreviewPersistence(): RuntimePersistence {
  return { gateway: createInMemoryPersistenceGateway(), mode: 'browser-preview' };
}

const UI_READY_TIMEOUT = { timeout: 5_000 } as const;

describe('deterministic world lab', () => {
  it('shows an independently reproduced seeded worker world', async () => {
    const user = userEvent.setup();
    render(<App persistence={createPreviewPersistence()} workerFactory={createRuntimeWorker} />);

    expect(screen.getByRole('heading', { name: PROJECT_META.promise })).toBeVisible();
    expect(
      await screen.findByText('Worker projection ready · autonomous world active'),
    ).toBeVisible();
    expect(screen.getByText('4348524f-4e4f464f-52474531-00000001')).toBeVisible();
    expect(screen.getByRole('img', { name: 'Generated Chrono Forge world' })).toHaveAttribute(
      'data-overlay',
      'terrain',
    );
    expect(
      screen.queryByRole('heading', { name: 'Settlement and society' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open world inspection' }));
    const society = screen
      .getByRole('heading', { name: 'Settlement and society' })
      .closest('section');
    expect(society).not.toBeNull();
    expect(within(society!).getByRole('heading', { name: 'Settlement dashboard' })).toBeVisible();
    expect(within(society!).getByRole('combobox', { name: 'Inspect person' })).toBeVisible();
    expect(within(society!).getByRole('heading', { name: 'Cultures' })).toBeVisible();
    expect(within(society!).getByText('The founding world formed.')).toBeVisible();
  });

  it('reduces map motion when the operating system requests reduced motion', async () => {
    const preference = {
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    } satisfies MediaQueryList;
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => preference),
    );
    try {
      render(<App persistence={createPreviewPersistence()} workerFactory={createRuntimeWorker} />);

      expect(
        await screen.findByText('Worker projection ready · autonomous world active'),
      ).toBeVisible();
      expect(screen.getByRole('img', { name: 'Generated Chrono Forge world' })).toHaveAttribute(
        'data-effects',
        'reduced',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('updates map motion when the operating system preference changes', async () => {
    const preference = Object.assign(new EventTarget(), {
      addListener: vi.fn(),
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      removeListener: vi.fn(),
    }) satisfies MediaQueryList;
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => preference),
    );
    try {
      render(<App persistence={createPreviewPersistence()} workerFactory={createRuntimeWorker} />);

      expect(
        await screen.findByText('Worker projection ready · autonomous world active'),
      ).toBeVisible();
      const map = screen.getByRole('img', { name: 'Generated Chrono Forge world' });
      expect(map).toHaveAttribute('data-effects', 'full');

      act(() => {
        const change = new Event('change');
        Object.defineProperty(change, 'matches', { value: true });
        preference.dispatchEvent(change);
      });

      expect(map).toHaveAttribute('data-effects', 'reduced');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('changes overlays and camera without exposing a direct world-advance control', async () => {
    const user = userEvent.setup();
    const playCue = vi.fn<GameSoundscape['playCue']>(() => Promise.resolve());
    const updateAtmosphere = vi.fn<GameSoundscape['updateAtmosphere']>(() => Promise.resolve());
    render(
      <App
        persistence={createPreviewPersistence()}
        soundscape={{
          playCue,
          stop: vi.fn(() => Promise.resolve()),
          updateAtmosphere,
        }}
        workerFactory={createRuntimeWorker}
      />,
    );
    await screen.findByText('Worker projection ready · autonomous world active');
    await waitFor(() =>
      expect(updateAtmosphere).toHaveBeenCalledWith('founding', expect.any(Object)),
    );

    await user.click(screen.getByRole('radio', { name: 'Resources' }));
    expect(screen.getByRole('img', { name: 'Generated Chrono Forge world' })).toHaveAttribute(
      'data-overlay',
      'resources',
    );
    expect(screen.getByText(/Material abundance\. Pattern cue: speckle\./)).toBeVisible();

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Inspect map object' }),
      'agent:1',
    );
    expect(screen.getByRole('article', { name: 'Selected map object' })).toHaveTextContent(
      'Person 1',
    );
    expect(playCue).toHaveBeenCalledWith('selection', expect.any(Object));

    await user.click(screen.getByRole('button', { name: 'Zoom world in' }));
    expect(screen.getByText(/1\.80×/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Pan world left' }));
    await user.click(screen.getByRole('button', { name: 'Pan world up' }));
    await user.click(screen.getByRole('button', { name: 'Pan world down' }));
    await user.click(screen.getByRole('button', { name: 'Pan world right' }));
    await user.click(screen.getByRole('button', { name: 'Zoom world out' }));
    await user.click(screen.getByRole('button', { name: 'Overview' }));
    expect(screen.getByLabelText('Camera position')).toHaveTextContent('X -676 · Y -598 · 1.50×');

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Inspect map object' }),
      'agent:1',
    );
    await user.click(screen.getByRole('button', { name: 'Frame selection' }));
    expect(screen.getByLabelText('Camera position')).toHaveTextContent('3.50×');

    expect(
      screen.queryByRole('button', { name: /Observe .* fixed ticks/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Logical tick').closest('div')).toHaveTextContent('0');
    expect(
      screen.getByText(/Only accepted focus time advances the live world directly/),
    ).toBeVisible();
  });

  it('switches between factual Surface and System views with independent cameras', async () => {
    const user = userEvent.setup();
    render(<App persistence={createPreviewPersistence()} workerFactory={createRuntimeWorker} />);
    await screen.findByText(
      'Worker projection ready · autonomous world active',
      undefined,
      UI_READY_TIMEOUT,
    );

    expect(screen.getByRole('radio', { name: 'Surface' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Zoom world in' }));
    expect(screen.getByLabelText('Camera position')).toHaveTextContent('1.80×');

    await user.click(screen.getByRole('radio', { name: 'System' }));
    expect(
      screen.queryByRole('img', { name: 'Generated Chrono Forge world' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Known celestial system map' })).toBeVisible();
    expect(screen.getByLabelText('Camera position')).toHaveTextContent('X 0 · Y 0 · 1.00×');
    expect(screen.queryByRole('group', { name: 'Map overlay' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Zoom system in' }));
    expect(screen.getByLabelText('Camera position')).toHaveTextContent('1.20×');
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Inspect system object' }),
      'body:1',
    );
    expect(screen.getByRole('article', { name: 'Selected map object' })).toHaveTextContent(
      'home body 1',
    );

    await user.click(screen.getByRole('radio', { name: 'Surface' }));
    expect(screen.getByRole('img', { name: 'Generated Chrono Forge world' })).toBeVisible();
    expect(screen.getByLabelText('Camera position')).toHaveTextContent('1.80×');
  });

  it('clears a map selection when the next valid Worker frame removes that object', async () => {
    const user = userEvent.setup();
    const controlledWorker = createFrameRemovalWorker();
    const persistence = createPreviewPersistence();
    await persistence.gateway.commitSaveSlot(
      'primary',
      'Founding world',
      serializeWorldSnapshot(createInitialWorld(DEMO_WORLD_SEED, DEMO_WORLD_CONFIG)),
    );
    render(<App persistence={persistence} workerFactory={controlledWorker.workerFactory} />);
    await screen.findByText('Worker projection ready · autonomous world active');

    const inspector = screen.getByRole('combobox', { name: 'Inspect map object' });
    await user.selectOptions(inspector, 'agent:1');
    expect(inspector).toHaveValue('agent:1');
    expect(screen.getByRole('article', { name: 'Selected map object' })).toBeVisible();
    expect(screen.getByRole('img', { name: 'Generated Chrono Forge world' })).toHaveAttribute(
      'data-selection',
      'agent:1',
    );

    act(() => {
      controlledWorker.removeFirstAgent();
    });

    await waitFor(() => {
      expect(inspector).toHaveValue('');
      expect(
        screen.queryByRole('article', { name: 'Selected map object' }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'Generated Chrono Forge world' })).toHaveAttribute(
        'data-selection',
        'none',
      );
    });
  });

  it('refits the release-world founding region on resize without discarding exploration', async () => {
    const user = userEvent.setup();
    render(<App persistence={createPreviewPersistence()} workerFactory={createRuntimeWorker} />);
    await screen.findByText('Worker projection ready · autonomous world active');
    const world = screen.getByRole('img', { name: 'Generated Chrono Forge world' });

    await waitFor(() => expect(world).toHaveAttribute('data-camera', '-676.5:-598.5:1.5'));
    await user.click(screen.getByRole('button', { name: 'Simulate large map viewport' }));
    await waitFor(() => expect(world).not.toHaveAttribute('data-camera', '-676.5:-598.5:1.5'));

    await user.click(screen.getByRole('button', { name: 'Zoom world in' }));
    const exploredCamera = world.getAttribute('data-camera');
    await user.click(screen.getByRole('button', { name: 'Simulate larger map viewport' }));
    expect(world).toHaveAttribute('data-camera', exploredCamera ?? 'missing');

    await user.click(screen.getByRole('button', { name: 'Overview' }));
    await user.click(screen.getByRole('button', { name: 'Simulate larger map viewport' }));
    expect(world.getAttribute('data-camera')).not.toBe(exploredCamera);
  });

  it('keeps indirect interventions optional and queues them through the Worker', async () => {
    const user = userEvent.setup();
    render(<App persistence={createPreviewPersistence()} workerFactory={createRuntimeWorker} />);
    await screen.findByText('Worker projection ready · autonomous world active');

    await user.click(screen.getByRole('button', { name: 'Open world inspection' }));
    expect(screen.getByRole('heading', { name: 'Research and conditions' })).toBeVisible();
    await user.click(screen.getByText('Optional intervention'));
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Intervention kind' }),
      'protection',
    );
    await user.click(screen.getByRole('button', { name: 'Queue intervention' }));

    expect(
      await screen.findByText('Intervention queued for the next civil-year development pulse.'),
    ).toBeVisible();
  });

  it('replaces an indefinite map bootstrap spinner with a recoverable worker fault', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    render(
      <App
        persistence={createPreviewPersistence()}
        workerFactory={() => {
          attempts += 1;
          if (attempts === 1) throw new Error('Worker blocked for test');
          return createRuntimeWorker();
        }}
      />,
    );

    expect(await screen.findByText('Simulation fault: Worker blocked for test')).toBeVisible();
    const mapFault = screen.getByRole('alert');
    expect(within(mapFault).getByText('World simulation unavailable.')).toBeVisible();
    expect(within(mapFault).getByText('Worker blocked for test')).toBeVisible();
    expect(screen.queryByText('Forging the first landscape')).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Map overlay' })).toBeVisible();

    await user.click(within(mapFault).getByRole('button', { name: 'Retry world simulation' }));

    expect(await screen.findByRole('img', { name: 'Generated Chrono Forge world' })).toBeVisible();
    expect(screen.getByText('Worker projection ready · autonomous world active')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it('keeps the last verified frame visible while making a fatal Worker error prominent', async () => {
    const controlledWorker = createRuntimeErrorWorker();
    render(
      <App
        persistence={createPreviewPersistence()}
        workerFactory={controlledWorker.workerFactory}
      />,
    );
    expect(await screen.findByRole('img', { name: 'Generated Chrono Forge world' })).toBeVisible();
    expect(await screen.findByRole('button', { name: 'Start focus' })).toBeEnabled();

    act(() => controlledWorker.fail());

    const faultHeading = await screen.findByText('World simulation paused.');
    const mapFault = faultHeading.closest<HTMLElement>('[role="alert"]');
    expect(mapFault).not.toBeNull();
    expect(within(mapFault!).getByText(/Injected runtime failure/)).toBeVisible();
    expect(screen.getByRole('img', { name: 'Generated Chrono Forge world' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Start focus' })).toBeDisabled();
  });

  it('runs a controlled-clock focus session and durably records its factual recap', async () => {
    const user = userEvent.setup();
    let epochMs = 10_000;
    const persistence = createPreviewPersistence();
    render(
      <App
        focusClock={{ now: () => epochMs }}
        persistence={persistence}
        workerFactory={createRuntimeWorker}
      />,
    );
    await screen.findByRole('button', { name: 'Start focus' }, UI_READY_TIMEOUT);

    const duration = screen.getByRole('spinbutton', { name: 'Custom focus minutes' });
    await user.clear(duration);
    await user.type(duration, '2');
    await user.click(screen.getByRole('button', { name: 'Start focus' }));
    expect(screen.getByRole('timer', { name: 'Focus time remaining' })).toHaveTextContent('02:00');

    act(() => {
      epochMs += 30_000;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => {
      const metric = screen.getByText('Logical tick').closest('div');
      expect(metric).not.toBeNull();
      expect(within(metric!).getByText('300')).toBeVisible();
    });

    await user.click(screen.getByRole('button', { name: 'Pause' }));
    act(() => {
      epochMs += 30_000;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    act(() => {
      epochMs += 30_000;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => {
      const metric = screen.getByText('Logical tick').closest('div');
      expect(within(metric!).getByText('600')).toBeVisible();
    });

    await user.click(screen.getByRole('button', { name: 'Complete focus' }));
    expect(await screen.findByText('Session recorded with a factual recap.')).toBeVisible();
    const recap = screen.getByRole('heading', { name: 'Latest factual recap' }).parentElement;
    expect(recap).not.toBeNull();
    expect(within(recap!).getByText('Construction underway')).toBeVisible();
    expect(recap).toHaveTextContent('0 → 1 (+1)');
    expect(
      within(recap!).getByRole('listitem', { name: 'Tick 100: Shelter 1 was planned.' }),
    ).toBeVisible();
    expect(within(recap!).queryByText('The founding world formed.')).not.toBeInTheDocument();
    const completed = screen.getByText('Completed sessions').closest('div');
    expect(completed).not.toBeNull();
    expect(within(completed!).getByText('1')).toBeVisible();
    expect(await persistence.gateway.listFocusSessions()).toMatchObject([{ recapEventIds: [3] }]);
  }, 30_000);

  it('persists exact consecutive 25, 50, and 60 minute controller-to-Worker reviews', async () => {
    const user = userEvent.setup();
    let epochMs = 10_000;
    let expectedTick = 0;
    const persistence = createPreviewPersistence();
    render(
      <App
        focusClock={{ now: () => epochMs }}
        persistence={persistence}
        workerFactory={createRuntimeWorker}
      />,
    );
    await screen.findByRole('button', { name: 'Start focus' }, UI_READY_TIMEOUT);

    for (const [index, minutes] of [25, 50, 60].entries()) {
      fireEvent.change(screen.getByRole('spinbutton', { name: 'Custom focus minutes' }), {
        target: { value: String(minutes) },
      });
      await user.click(screen.getByRole('button', { name: 'Start focus' }));
      await waitFor(async () => {
        const baselineSave = await persistence.gateway.loadSaveSlot('primary');
        expect(baselineSave?.focusSession).toMatchObject({
          status: 'active',
          issuedSimulationTicks: 0,
          review: {
            before: { tick: expectedTick },
            after: { tick: expectedTick },
          },
        });
      });

      const expectedIssuedTicks = minutes * 60 * 10;
      act(() => {
        epochMs += minutes * 60_000;
      });
      await user.click(screen.getByRole('button', { name: 'Complete focus' }));
      expectedTick += expectedIssuedTicks;

      await waitFor(async () => {
        const completedSave = await persistence.gateway.loadSaveSlot('primary');
        const session = completedSave?.focusSession;
        expect(session).toMatchObject({
          status: 'completed',
          focusedMs: minutes * 60_000,
          issuedSimulationTicks: expectedIssuedTicks,
          review: {
            before: { tick: expectedTick - expectedIssuedTicks },
            after: { tick: expectedTick },
          },
        });
        const world = deserializeWorldSnapshot(completedSave!.snapshot);
        const expectedReview = projectFocusCheckpoint(world, session!.review!.baselineEventId);
        expect(session!.review!.after).toEqual(expectedReview.moment);
        expect(session!.recapEntries).toEqual(expectedReview.recapEntries);
        expect(session!.review!.revisitTarget).toEqual(expectedReview.revisitTarget);
      });

      if (index < 2) {
        await user.click(screen.getByRole('button', { name: 'New session' }));
        await screen.findByRole('button', { name: 'Start focus' }, UI_READY_TIMEOUT);
      }
    }

    await expect(persistence.gateway.listFocusSessions()).resolves.toHaveLength(3);
  }, 60_000);

  it('manages multiple slots, validated exports, and calm local settings', async () => {
    const user = userEvent.setup();
    const persistence = createPreviewPersistence();
    render(<App persistence={persistence} workerFactory={createRuntimeWorker} />);
    await screen.findByRole('button', { name: 'Start focus' }, UI_READY_TIMEOUT);

    await user.click(screen.getByText('Create another slot'));
    await user.click(screen.getByRole('button', { name: 'Save as new slot' }));
    await waitFor(async () => {
      expect(await persistence.gateway.listSaveSlots()).toHaveLength(2);
    });
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Load local slot' })).toHaveValue('world-2');
    });

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await screen.findByText('Export package refreshed from the current world.');
    await user.click(screen.getByText('Import or export package'));
    const exported = screen.getByRole('textbox', { name: 'Export package' });
    if (!(exported instanceof HTMLTextAreaElement)) throw new TypeError('Expected export textarea');
    expect(exported.value).toContain('chrono-forge-save-export');

    await user.click(screen.getByText('Focus and accessibility settings'));
    await user.click(screen.getByRole('checkbox', { name: 'Calm focus mode' }));
    await user.click(screen.getByRole('checkbox', { name: 'Reduce visual effects' }));
    expect(document.documentElement).toHaveClass('calm-mode');
    expect(document.documentElement).toHaveClass('reduced-effects');
    expect(screen.getByRole('img', { name: 'Generated Chrono Forge world' })).toHaveAttribute(
      'data-effects',
      'reduced',
    );
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('Settings saved locally.')).toBeVisible();
    await expect(persistence.gateway.loadSettings()).resolves.toMatchObject({
      calmMode: true,
      reducedEffects: true,
    });
  });

  it('supports an optional paused break, reset, and non-punitive cancellation', async () => {
    const user = userEvent.setup();
    let epochMs = 50_000;
    const notifyCompletion = vi.fn(() => Promise.resolve());
    const persistence = createPreviewPersistence();
    await persistence.gateway.saveSettings({
      ...DEFAULT_APP_SETTINGS,
      breaksEnabled: true,
      defaultBreakMinutes: 1,
      defaultFocusMinutes: 1,
    });
    render(
      <App
        focusAlerts={{ notifyCompletion }}
        focusClock={{ now: () => epochMs }}
        persistence={persistence}
        workerFactory={createRuntimeWorker}
      />,
    );
    await screen.findByRole('button', { name: 'Start focus' }, UI_READY_TIMEOUT);

    await user.click(screen.getByRole('button', { name: 'Start focus' }));
    act(() => {
      epochMs += 10_000;
    });
    await user.click(screen.getByRole('button', { name: 'Complete focus' }));
    await waitFor(() => expect(notifyCompletion).toHaveBeenCalledOnce());
    expect(notifyCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ notificationsEnabled: true, soundEnabled: true }),
    );
    expect(screen.getByRole('button', { name: 'End break' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    await user.click(screen.getByRole('button', { name: 'End break' }));
    await screen.findByRole('button', { name: 'New session' });
    await waitFor(async () => {
      expect(await persistence.gateway.listFocusSessions()).toEqual([
        expect.objectContaining({ status: 'completed' }),
      ]);
    });

    await user.click(screen.getByRole('button', { name: 'New session' }));
    await user.click(screen.getByRole('button', { name: 'Start focus' }));
    act(() => {
      epochMs += 5_000;
    });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(async () => {
      const sessions = await persistence.gateway.listFocusSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions.some((session) => session.status === 'cancelled')).toBe(true);
    });
    expect(notifyCompletion).toHaveBeenCalledOnce();
  }, 30_000);

  it('validates imported packages, manually saves, and loads another slot', async () => {
    const user = userEvent.setup();
    const persistence = createPreviewPersistence();
    render(<App persistence={persistence} workerFactory={createRuntimeWorker} />);
    await screen.findByRole('button', { name: 'Start focus' }, UI_READY_TIMEOUT);

    await user.click(screen.getByRole('button', { name: 'Save now' }));
    await screen.findByText('World saved manually.');
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await screen.findByText('Export package refreshed from the current world.');
    await user.click(screen.getByText('Import or export package'));
    const exported = screen.getByRole('textbox', { name: 'Export package' });
    const imported = screen.getByRole('textbox', { name: 'Import package' });
    if (!(exported instanceof HTMLTextAreaElement)) throw new TypeError('Expected export textarea');
    fireEvent.change(imported, { target: { value: exported.value } });
    await user.click(screen.getByRole('button', { name: 'Validate and import' }));
    await waitFor(async () => {
      expect((await persistence.gateway.loadSaveSlot('primary'))?.headGeneration).toBeGreaterThan(
        2,
      );
    });

    await user.click(screen.getByText('Create another slot'));
    await user.click(screen.getByRole('button', { name: 'Save as new slot' }));
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Load local slot' })).toHaveValue('world-2');
    });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Load local slot' }), 'primary');
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Load local slot' })).toHaveValue('primary');
    });
  }, 30_000);

  it('reports a local persistence bootstrap failure without obscuring the world', async () => {
    const fallback = createInMemoryPersistenceGateway();
    const failingGateway: PersistenceGateway = {
      ...fallback,
      loadSettings: () => Promise.reject(new Error('Injected database failure')),
    };
    render(
      <App
        persistence={{ gateway: failingGateway, mode: 'native' }}
        workerFactory={createRuntimeWorker}
      />,
    );

    expect(await screen.findByText('Persistence fault: Injected database failure')).toBeVisible();
    expect(screen.getByRole('img', { name: 'Generated Chrono Forge world' })).toBeVisible();
  });
});
