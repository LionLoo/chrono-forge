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
import { PROJECT_META } from '../../src/project-meta';
import type { UiToWorkerMessage, WorkerToUiMessage } from '../../src/protocol';
import type { WorldOverlay } from '../../src/rendering/world-palette';
import type { SimulationWorkerPort } from '../../src/ui/useWorldSimulation';
import { createSimulationRuntime } from '../../src/workers/simulation-runtime';

vi.mock('../../src/rendering/WorldMapCanvas', () => ({
  WorldMapCanvas: ({ overlay }: { readonly overlay: WorldOverlay }) => (
    <div aria-label="Generated Chrono Forge world" data-overlay={overlay} role="img" />
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

function createPreviewPersistence(): RuntimePersistence {
  return { gateway: createInMemoryPersistenceGateway(), mode: 'browser-preview' };
}

describe('deterministic world lab', () => {
  it('shows an independently reproduced seeded worker world', async () => {
    render(<App persistence={createPreviewPersistence()} workerFactory={createRuntimeWorker} />);

    expect(screen.getByRole('heading', { name: PROJECT_META.promise })).toBeVisible();
    expect(
      await screen.findByText('Worker projection ready · autonomous settlement active'),
    ).toBeVisible();
    expect(screen.getByText('4348524f-4e4f464f-52474531-00000001')).toBeVisible();
    expect(screen.getByRole('img', { name: 'Generated Chrono Forge world' })).toHaveAttribute(
      'data-overlay',
      'terrain',
    );
    const society = screen
      .getByRole('heading', { name: 'Settlement and society' })
      .closest('section');
    expect(society).not.toBeNull();
    expect(within(society!).getByRole('heading', { name: 'Settlement dashboard' })).toBeVisible();
    expect(within(society!).getByRole('combobox', { name: 'Inspect person' })).toBeVisible();
    expect(within(society!).getByRole('heading', { name: 'Cultures' })).toBeVisible();
    expect(within(society!).getByText('The founding world formed.')).toBeVisible();
  });

  it('changes overlays, camera, and fixed logical ticks through keyboard-accessible controls', async () => {
    const user = userEvent.setup();
    render(<App persistence={createPreviewPersistence()} workerFactory={createRuntimeWorker} />);
    await screen.findByText('Worker projection ready · autonomous settlement active');

    await user.click(screen.getByRole('radio', { name: 'Resources' }));
    expect(screen.getByRole('img', { name: 'Generated Chrono Forge world' })).toHaveAttribute(
      'data-overlay',
      'resources',
    );

    await user.click(screen.getByRole('button', { name: 'Zoom world in' }));
    expect(screen.getByText(/1\.20×/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Pan world left' }));
    await user.click(screen.getByRole('button', { name: 'Pan world up' }));
    await user.click(screen.getByRole('button', { name: 'Pan world down' }));
    await user.click(screen.getByRole('button', { name: 'Pan world right' }));
    await user.click(screen.getByRole('button', { name: 'Zoom world out' }));
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByLabelText('Camera position')).toHaveTextContent('X 24 · Y 24 · 1.00×');

    await user.click(screen.getByRole('button', { name: 'Observe 100 fixed ticks' }));
    await waitFor(() => {
      expect(screen.getByText('100')).toBeVisible();
      expect(
        screen.getByText('Worker projection ready · autonomous settlement active'),
      ).toBeVisible();
    });
    expect(
      screen.getByRole('listitem', {
        name: /Shelter 1: status planned; condition 100% \(sound\); progress 0%; tile \d+\./,
      }),
    ).toBeVisible();
  });

  it('reports a worker bootstrap fault without hiding the map controls', async () => {
    render(
      <App
        persistence={createPreviewPersistence()}
        workerFactory={() => {
          throw new Error('Worker blocked for test');
        }}
      />,
    );

    expect(await screen.findByText('Simulation fault: Worker blocked for test')).toBeVisible();
    expect(screen.getByRole('group', { name: 'Map overlay' })).toBeVisible();
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
    await screen.findByRole('button', { name: 'Start focus' });

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
    expect(within(recap!).getByText('Shelter 1 was planned.')).toBeVisible();
    expect(within(recap!).queryByText('The founding world formed.')).not.toBeInTheDocument();
    const completed = screen.getByText('Completed sessions').closest('div');
    expect(completed).not.toBeNull();
    expect(within(completed!).getByText('1')).toBeVisible();
    expect(await persistence.gateway.listFocusSessions()).toMatchObject([{ recapEventIds: [3] }]);
  });

  it('manages multiple slots, validated exports, and calm local settings', async () => {
    const user = userEvent.setup();
    const persistence = createPreviewPersistence();
    render(<App persistence={persistence} workerFactory={createRuntimeWorker} />);
    await screen.findByRole('button', { name: 'Start focus' });

    await user.click(screen.getByText('Create another slot'));
    await user.click(screen.getByRole('button', { name: 'Save as new slot' }));
    await waitFor(async () => {
      expect(await persistence.gateway.listSaveSlots()).toHaveLength(2);
    });
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Load local slot' })).toHaveValue('world-2');
    });

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await screen.findByText('Export package ready to copy.');
    await user.click(screen.getByText('Import or export package'));
    const exported = screen.getByRole('textbox', { name: 'Export package' });
    if (!(exported instanceof HTMLTextAreaElement)) throw new TypeError('Expected export textarea');
    expect(exported.value).toContain('chrono-forge-save-export');

    await user.click(screen.getByText('Focus and accessibility settings'));
    await user.click(screen.getByRole('checkbox', { name: 'Calm focus mode' }));
    expect(document.documentElement).toHaveClass('calm-mode');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('Settings saved locally.')).toBeVisible();
    await expect(persistence.gateway.loadSettings()).resolves.toMatchObject({ calmMode: true });
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
    await screen.findByRole('button', { name: 'Start focus' });

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
  });

  it('validates imported packages, manually saves, and loads another slot', async () => {
    const user = userEvent.setup();
    const persistence = createPreviewPersistence();
    render(<App persistence={persistence} workerFactory={createRuntimeWorker} />);
    await screen.findByRole('button', { name: 'Start focus' });

    await user.click(screen.getByRole('button', { name: 'Save now' }));
    await screen.findByText('World saved manually.');
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await screen.findByText('Export package ready to copy.');
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
  });

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
