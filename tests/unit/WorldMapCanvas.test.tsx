import { fireEvent, render, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import { INITIAL_WORLD_CAMERA } from '../../src/rendering/camera';
import { STRUCTURE_KIND_CODES, STRUCTURE_STATE_CODES } from '../../src/protocol';
import { WorldMapCanvas, type WorldMapProjection } from '../../src/rendering/WorldMapCanvas';

const pixiMocks = vi.hoisted(() => {
  class MockContainer {
    readonly addChild = vi.fn();
    readonly position = { set: vi.fn() };
    readonly scale = { set: vi.fn() };
  }

  class MockGraphics {
    readonly clear = vi.fn(() => this);
    readonly circle = vi.fn(() => this);
    readonly fill = vi.fn(() => this);
    readonly rect = vi.fn(() => this);
    readonly stroke = vi.fn(() => this);
  }

  const applications: MockApplication[] = [];
  const containers: MockContainer[] = [];
  const graphics: MockGraphics[] = [];
  let initialize = () => Promise.resolve();

  class MockApplication {
    readonly canvas = document.createElement('canvas');
    readonly destroy = vi.fn();
    readonly stage = new MockContainer();
    readonly init = vi.fn(() => initialize());

    constructor() {
      applications.push(this);
    }
  }

  return {
    applications,
    containers,
    graphics,
    MockApplication,
    MockContainer: class extends MockContainer {
      constructor() {
        super();
        containers.push(this);
      }
    },
    MockGraphics: class extends MockGraphics {
      constructor() {
        super();
        graphics.push(this);
      }
    },
    reset() {
      applications.length = 0;
      containers.length = 0;
      graphics.length = 0;
      initialize = () => Promise.resolve();
    },
    rejectInitialization(message: string) {
      initialize = () => Promise.reject(new Error(message));
    },
    deferInitialization() {
      let resolve!: () => void;
      initialize = () =>
        new Promise<void>((complete) => {
          resolve = complete;
        });
      return () => {
        resolve();
      };
    },
  };
});

vi.mock('pixi.js', () => ({
  Application: pixiMocks.MockApplication,
  Container: pixiMocks.MockContainer,
  Graphics: pixiMocks.MockGraphics,
}));

const projection = {
  width: 2,
  height: 1,
  biome: new Uint8Array([2, 3]),
  resource: new Uint16Array([200, 500]),
  habitability: new Uint8Array([160, 180]),
  hazard: new Uint8Array([20, 40]),
  agentIds: new Uint32Array(),
  agentTiles: new Uint32Array(),
  agentHealth: new Uint16Array(),
  agentActions: new Uint8Array(),
  structureIds: new Uint32Array(),
  structureTiles: new Uint32Array(),
  structureKinds: new Uint8Array(),
  structureStates: new Uint8Array(),
  structureProgress: new Uint16Array(),
  structureCondition: new Uint16Array(),
} satisfies WorldMapProjection;

describe('Pixi world projection', () => {
  beforeEach(() => {
    pixiMocks.reset();
  });

  it('draws dense tiles and applies projection, camera, pointer, and wheel updates', async () => {
    const onCameraChange = vi.fn();
    const view = render(
      <WorldMapCanvas
        camera={INITIAL_WORLD_CAMERA}
        onCameraChange={onCameraChange}
        overlay="terrain"
        projection={projection}
      />,
    );

    await waitFor(() => {
      expect(view.getByRole('img', { name: /Autonomous settlement map/ })).toBeVisible();
    });
    const graphics = pixiMocks.graphics[0];
    const worldLayer = pixiMocks.containers[0];
    expect(graphics?.rect).toHaveBeenCalledTimes(2);
    expect(graphics?.fill).toHaveBeenCalledTimes(2);
    expect(worldLayer?.position.set).toHaveBeenCalledWith(24, 24);
    expect(worldLayer?.scale.set).toHaveBeenCalledWith(1);

    view.rerender(
      <WorldMapCanvas
        camera={{ x: 30, y: 40, zoom: 1.5 }}
        onCameraChange={onCameraChange}
        overlay="resources"
        projection={projection}
      />,
    );
    expect(graphics?.clear).toHaveBeenCalledTimes(2);
    expect(worldLayer?.position.set).toHaveBeenLastCalledWith(30, 40);
    expect(worldLayer?.scale.set).toHaveBeenLastCalledWith(1.5);

    const host = view.container.querySelector<HTMLElement>('.world-map-canvas');
    expect(host).not.toBeNull();
    if (host === null) return;
    host.setPointerCapture = vi.fn();
    host.hasPointerCapture = vi.fn(() => true);
    const releasePointerCapture = vi.fn();
    host.releasePointerCapture = releasePointerCapture;

    fireEvent.pointerDown(host, { clientX: 10, clientY: 10, pointerId: 7 });
    fireEvent.pointerMove(host, { clientX: 25, clientY: 30, pointerId: 7 });
    expect(onCameraChange).toHaveBeenCalledWith({ x: 45, y: 60, zoom: 1.5 });
    fireEvent.pointerMove(host, { clientX: 30, clientY: 30, pointerId: 9 });
    fireEvent.pointerUp(host, { pointerId: 7 });
    expect(releasePointerCapture).toHaveBeenCalledWith(7);

    fireEvent.wheel(host, { deltaY: -1 });
    expect(onCameraChange).toHaveBeenLastCalledWith({ x: 30, y: 40, zoom: 1.5 * 1.15 });
    fireEvent.wheel(host, { deltaY: 1 });
    expect(onCameraChange).toHaveBeenLastCalledWith({ x: 30, y: 40, zoom: 1.5 / 1.15 });

    view.unmount();
    expect(pixiMocks.applications[0]?.destroy).toHaveBeenCalled();
  });

  it('surfaces renderer initialization errors', async () => {
    pixiMocks.rejectInitialization('WebGL unavailable');
    const view = render(
      <WorldMapCanvas
        camera={INITIAL_WORLD_CAMERA}
        onCameraChange={vi.fn()}
        overlay="terrain"
        projection={projection}
      />,
    );

    await waitFor(() => {
      expect(view.container.querySelector('.world-map-canvas')).toHaveAttribute(
        'data-render-error',
        'WebGL unavailable',
      );
      expect(pixiMocks.applications[0]?.destroy).toHaveBeenCalledWith(true, { children: true });
    });
  });

  it('draws separate agent and construction layers with progress, condition outlines, and redundant condition marks', async () => {
    const view = render(
      <WorldMapCanvas
        camera={INITIAL_WORLD_CAMERA}
        onCameraChange={vi.fn()}
        overlay="terrain"
        projection={{
          ...projection,
          agentIds: new Uint32Array([1]),
          agentTiles: new Uint32Array([0]),
          agentHealth: new Uint16Array([700]),
          agentActions: new Uint8Array([1]),
          structureIds: new Uint32Array([1]),
          structureTiles: new Uint32Array([1]),
          structureKinds: new Uint8Array([STRUCTURE_KIND_CODES.shelter]),
          structureStates: new Uint8Array([STRUCTURE_STATE_CODES.building]),
          structureProgress: new Uint16Array([500]),
          structureCondition: new Uint16Array([600]),
        }}
      />,
    );

    await waitFor(() => {
      expect(view.getByRole('img', { name: /1 visible agents and 1 structures/ })).toBeVisible();
    });
    expect(pixiMocks.graphics[1]?.rect).toHaveBeenCalled();
    expect(pixiMocks.graphics[1]?.stroke).toHaveBeenCalled();
    expect(pixiMocks.graphics[1]?.rect).toHaveBeenCalledTimes(4);
    expect(pixiMocks.graphics[2]?.circle).toHaveBeenCalled();
    expect(pixiMocks.graphics[2]?.rect).toHaveBeenCalled();
  });

  it('destroys an application whose async initialization finishes after unmount', async () => {
    const resolveInitialization = pixiMocks.deferInitialization();
    const view = render(
      <WorldMapCanvas
        camera={INITIAL_WORLD_CAMERA}
        onCameraChange={vi.fn()}
        overlay="terrain"
        projection={projection}
      />,
    );
    view.unmount();
    resolveInitialization();

    await waitFor(() => {
      expect(pixiMocks.applications[0]?.destroy).toHaveBeenCalledWith(true, { children: true });
    });
  });
});
