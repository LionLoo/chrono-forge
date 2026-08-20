import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { App } from '../../src/App';
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

describe('deterministic world lab', () => {
  it('shows an independently reproduced seeded worker world', async () => {
    render(<App workerFactory={createRuntimeWorker} />);

    expect(screen.getByRole('heading', { name: PROJECT_META.promise })).toBeVisible();
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Worker synchronized · deterministic match',
    );
    expect(screen.getByText('4348524f-4e4f464f-52474531-00000001')).toBeVisible();
    expect(screen.getByRole('img', { name: 'Generated Chrono Forge world' })).toHaveAttribute(
      'data-overlay',
      'terrain',
    );
  });

  it('changes overlays, camera, and fixed logical ticks through keyboard-accessible controls', async () => {
    const user = userEvent.setup();
    render(<App workerFactory={createRuntimeWorker} />);
    await screen.findByText('Worker synchronized · deterministic match');

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

    await user.click(screen.getByRole('button', { name: 'Advance 100 fixed ticks' }));
    await waitFor(() => {
      expect(screen.getByText('100')).toBeVisible();
      expect(screen.getByRole('status')).toHaveTextContent('deterministic match');
    });
  });

  it('reports a worker bootstrap fault without hiding the map controls', async () => {
    render(
      <App
        workerFactory={() => {
          throw new Error('Worker blocked for test');
        }}
      />,
    );

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Simulation fault: Worker blocked for test',
    );
    expect(screen.getByRole('group', { name: 'Map overlay' })).toBeVisible();
  });
});
