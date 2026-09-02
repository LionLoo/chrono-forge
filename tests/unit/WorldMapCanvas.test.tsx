import { fireEvent, render, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import { INITIAL_WORLD_CAMERA, type WorldCamera } from '../../src/rendering/camera';
import { STRUCTURE_KIND_CODES, STRUCTURE_STATE_CODES } from '../../src/protocol';
import { WorldMapCanvas, type WorldMapProjection } from '../../src/rendering/WorldMapCanvas';
import { createInitialWorld, stepWorld } from '../../src/simulation/world';
import { projectWorldFrame } from '../../src/workers/simulation-runtime';

const pixiMocks = vi.hoisted(() => {
  class MockContainer {
    readonly addChild = vi.fn();
    readonly position = { set: vi.fn() };
    readonly scale = { set: vi.fn() };
  }

  class MockGraphics {
    readonly clear = vi.fn(() => this);
    readonly circle = vi.fn(() => this);
    readonly closePath = vi.fn(() => this);
    readonly fill = vi.fn(() => this);
    readonly lineTo = vi.fn(() => this);
    readonly moveTo = vi.fn(() => this);
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

const projection = projectWorldFrame(
  createInitialWorld([1, 2, 3, 4], { width: 2, height: 1, chunkSize: 1 }),
) satisfies WorldMapProjection;

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
      expect(view.getByRole('img', { name: /founding world map/ })).toBeVisible();
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
    host.getBoundingClientRect = vi.fn(() => ({ left: 50, top: 100 }) as DOMRect);

    fireEvent.pointerDown(host, { clientX: 10, clientY: 10, pointerId: 7 });
    fireEvent.pointerMove(host, { clientX: 25, clientY: 30, pointerId: 7 });
    expect(onCameraChange).toHaveBeenCalledWith({ x: 45, y: 60, zoom: 1.5 });
    fireEvent.pointerMove(host, { clientX: 30, clientY: 30, pointerId: 9 });
    fireEvent.pointerUp(host, { pointerId: 7 });
    expect(releasePointerCapture).toHaveBeenCalledWith(7);

    const pageWheel = vi.fn();
    document.addEventListener('wheel', pageWheel);
    const mousePoint = { clientX: 150, clientY: 160 };
    const worldPoint = {
      x: (mousePoint.clientX - 50 - 30) / 1.5,
      y: (mousePoint.clientY - 100 - 40) / 1.5,
    };
    const zoomIn = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: -1,
      ...mousePoint,
    });
    expect(host.dispatchEvent(zoomIn)).toBe(false);
    expect(zoomIn.defaultPrevented).toBe(true);
    expect(pageWheel).not.toHaveBeenCalled();
    const zoomedIn = onCameraChange.mock.calls.at(-1)?.[0] as unknown as WorldCamera;
    expect(zoomedIn).toMatchObject({ zoom: 1.5 * 1.15 });
    expect((mousePoint.clientX - 50 - zoomedIn.x) / zoomedIn.zoom).toBeCloseTo(worldPoint.x);
    expect((mousePoint.clientY - 100 - zoomedIn.y) / zoomedIn.zoom).toBeCloseTo(worldPoint.y);
    const secondZoomIn = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: -1,
      ...mousePoint,
    });
    expect(host.dispatchEvent(secondZoomIn)).toBe(false);
    expect(secondZoomIn.defaultPrevented).toBe(true);
    expect(pageWheel).not.toHaveBeenCalled();
    const zoomedTwice = onCameraChange.mock.calls.at(-1)?.[0] as unknown as WorldCamera;
    expect(zoomedTwice).toMatchObject({ zoom: 1.5 * 1.15 * 1.15 });
    expect((mousePoint.clientX - 50 - zoomedTwice.x) / zoomedTwice.zoom).toBeCloseTo(worldPoint.x);
    expect((mousePoint.clientY - 100 - zoomedTwice.y) / zoomedTwice.zoom).toBeCloseTo(worldPoint.y);
    document.removeEventListener('wheel', pageWheel);

    view.unmount();
    expect(pixiMocks.applications[0]?.destroy).toHaveBeenCalled();
  });

  it('interpolates authoritative agent tile changes without changing the world projection', async () => {
    let now = 1_000;
    let animation: FrameRequestCallback | null = null;
    const performanceNow = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const requestAnimationFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        animation = callback;
        return 1;
      });
    const world = createInitialWorld([1, 2, 3, 4]);
    const initial = projectWorldFrame(world);
    const advanced = projectWorldFrame(stepWorld(world, 100));
    const movedAgentIndex = [...initial.agentTiles].findIndex(
      (tile, index) => tile !== advanced.agentTiles[index],
    );
    expect(movedAgentIndex).toBeGreaterThanOrEqual(0);
    const onCameraChange = vi.fn();
    const view = render(
      <WorldMapCanvas
        camera={INITIAL_WORLD_CAMERA}
        onCameraChange={onCameraChange}
        overlay="terrain"
        projection={initial}
      />,
    );

    await waitFor(() => expect(view.getByRole('img')).toBeVisible());
    const agentGraphics = pixiMocks.graphics[4]!;
    const agentCount = initial.agentIds.length;
    const before = agentGraphics.circle.mock.calls[movedAgentIndex]!;
    now = 11_000;
    view.rerender(
      <WorldMapCanvas
        camera={INITIAL_WORLD_CAMERA}
        onCameraChange={onCameraChange}
        overlay="terrain"
        projection={advanced}
      />,
    );

    const atMotionStart = agentGraphics.circle.mock.calls[agentCount + movedAgentIndex]!;
    expect(atMotionStart.slice(0, 2)).toEqual(before.slice(0, 2));
    const scheduledAnimation = animation as FrameRequestCallback | null;
    expect(scheduledAnimation).not.toBeNull();
    if (scheduledAnimation === null) throw new Error('Agent animation was not scheduled.');
    now = 15_500;
    scheduledAnimation(now);
    const halfway = agentGraphics.circle.mock.calls.at(-agentCount + movedAgentIndex)!;
    const destinationTile = advanced.agentTiles[movedAgentIndex]!;
    const destination = [
      ((destinationTile % advanced.width) + 0.5) * 6,
      (Math.floor(destinationTile / advanced.width) + 0.5) * 6,
    ];
    expect(halfway.slice(0, 2)).not.toEqual(before.slice(0, 2));
    expect(halfway.slice(0, 2)).not.toEqual(destination);

    requestAnimationFrame.mockRestore();
    performanceNow.mockRestore();
  });

  it('keeps reduced-effects agent movement static', async () => {
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame');
    const world = createInitialWorld([1, 2, 3, 4]);
    const initial = projectWorldFrame(world);
    const advanced = projectWorldFrame(stepWorld(world, 100));
    const movedAgentIndex = [...initial.agentTiles].findIndex(
      (tile, index) => tile !== advanced.agentTiles[index],
    );
    expect(movedAgentIndex).toBeGreaterThanOrEqual(0);
    const view = render(
      <WorldMapCanvas
        camera={INITIAL_WORLD_CAMERA}
        onCameraChange={vi.fn()}
        overlay="terrain"
        projection={initial}
        reducedEffects
      />,
    );

    await waitFor(() => expect(view.getByRole('img')).toBeVisible());
    const agentGraphics = pixiMocks.graphics[4]!;
    view.rerender(
      <WorldMapCanvas
        camera={INITIAL_WORLD_CAMERA}
        onCameraChange={vi.fn()}
        overlay="terrain"
        projection={advanced}
        reducedEffects
      />,
    );

    const destinationTile = advanced.agentTiles[movedAgentIndex]!;
    expect(
      agentGraphics.circle.mock.calls.at(-initial.agentIds.length + movedAgentIndex)?.slice(0, 2),
    ).toEqual([
      ((destinationTile % advanced.width) + 0.5) * 6,
      (Math.floor(destinationTile / advanced.width) + 0.5) * 6,
    ]);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    requestAnimationFrame.mockRestore();
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
    const visualProjection = {
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
    };
    const view = render(
      <WorldMapCanvas
        camera={INITIAL_WORLD_CAMERA}
        onCameraChange={vi.fn()}
        overlay="terrain"
        projection={visualProjection}
      />,
    );

    await waitFor(() => {
      expect(view.getByRole('img', { name: /1 visible agents, 1 structures/ })).toBeVisible();
    });
    expect(pixiMocks.graphics[3]?.rect).toHaveBeenCalled();
    expect(pixiMocks.graphics[3]?.stroke).toHaveBeenCalled();
    expect(pixiMocks.graphics[4]?.circle).toHaveBeenCalled();
    expect(pixiMocks.graphics[4]?.rect).toHaveBeenCalled();

    const structureClears = pixiMocks.graphics[3]?.clear.mock.calls.length;
    const agentClears = pixiMocks.graphics[4]?.clear.mock.calls.length;
    view.rerender(
      <WorldMapCanvas
        camera={INITIAL_WORLD_CAMERA}
        onCameraChange={vi.fn()}
        overlay="terrain"
        projection={visualProjection}
      />,
    );
    expect(pixiMocks.graphics[3]?.clear).toHaveBeenCalledTimes(structureClears ?? 0);
    expect(pixiMocks.graphics[4]?.clear).toHaveBeenCalledTimes(agentClears ?? 0);

    view.rerender(
      <WorldMapCanvas
        camera={INITIAL_WORLD_CAMERA}
        onCameraChange={vi.fn()}
        overlay="terrain"
        projection={{
          ...visualProjection,
          agentActions: new Uint8Array([2]),
          structureProgress: new Uint16Array([750]),
        }}
      />,
    );
    expect(pixiMocks.graphics[3]?.clear).toHaveBeenCalledTimes((structureClears ?? 0) + 1);
    expect(pixiMocks.graphics[4]?.clear).toHaveBeenCalledTimes((agentClears ?? 0) + 1);
  });

  it('offers equivalent pointer and keyboard selection while keyboard camera input stays presentational', async () => {
    const onCameraChange = vi.fn();
    const onSelectionChange = vi.fn();
    const view = render(
      <WorldMapCanvas
        camera={INITIAL_WORLD_CAMERA}
        onCameraChange={onCameraChange}
        onSelectionChange={onSelectionChange}
        overlay="terrain"
        projection={projection}
        reducedEffects
      />,
    );

    const canvas = await view.findByRole('img', { name: /founding world map/ });
    const host = view.container.querySelector<HTMLElement>('.world-map-canvas');
    expect(host).not.toBeNull();
    if (host === null) return;
    host.setPointerCapture = vi.fn();
    host.hasPointerCapture = vi.fn(() => true);
    host.releasePointerCapture = vi.fn();

    fireEvent.keyDown(canvas, { key: 'ArrowLeft' });
    expect(onCameraChange).toHaveBeenCalledWith({ x: -12, y: 24, zoom: 1 });
    fireEvent.keyDown(canvas, { key: '+' });
    expect(onCameraChange).toHaveBeenLastCalledWith({ x: 24, y: 24, zoom: 1.15 });
    fireEvent.keyDown(canvas, { key: 'Enter' });
    expect(onSelectionChange).toHaveBeenCalledWith({
      id: projection.agentIds[0],
      kind: 'agent',
    });

    const tile = projection.agentTiles[0] ?? 0;
    const pointerX = INITIAL_WORLD_CAMERA.x + (tile % projection.width) * 6 + 3;
    const pointerY = INITIAL_WORLD_CAMERA.y + Math.floor(tile / projection.width) * 6 + 3;
    fireEvent.pointerDown(host, { clientX: pointerX, clientY: pointerY, pointerId: 4 });
    fireEvent.pointerUp(host, { clientX: pointerX, clientY: pointerY, pointerId: 4 });
    expect(onSelectionChange).toHaveBeenLastCalledWith({
      id: projection.agentIds[0],
      kind: 'agent',
    });
    expect(host).toHaveAttribute('data-effects', 'reduced');
  });

  it('pointer-picks route lines and the static reduced-effects crisis marker', async () => {
    const onSelectionChange = vi.fn();
    const base = projectWorldFrame(
      createInitialWorld([5, 6, 7, 8], { width: 6, height: 2, chunkSize: 1 }),
    );
    const founding = base.civilizations.settlements[0];
    if (founding === undefined) throw new Error('Expected an initial settlement projection.');
    const routeProjection: WorldMapProjection = {
      ...base,
      agentActions: new Uint8Array(),
      agentHealth: new Uint16Array(),
      agentIds: new Uint32Array(),
      agentTiles: new Uint32Array(),
      civilizations: {
        ...base.civilizations,
        routes: [
          {
            endedTick: null,
            firstSettlementId: 101,
            id: 77,
            secondSettlementId: 102,
            startedTick: 0,
            status: 'active',
            volume: 10,
          },
        ],
        settlements: [
          { ...founding, centerTileIndex: 1, id: 101 },
          { ...founding, centerTileIndex: 5, id: 102 },
        ],
      },
      development: {
        ...base.development,
        activeCrises: [
          {
            id: 9,
            kind: 'storm',
            severity: 70,
            startedTick: 0,
            triggerCondition: 'stormPressure',
            triggerValue: 90,
          },
        ],
      },
      structureCondition: new Uint16Array(),
      structureIds: new Uint32Array(),
      structureKinds: new Uint8Array(),
      structureProgress: new Uint16Array(),
      structureStates: new Uint8Array(),
      structureTiles: new Uint32Array(),
    };
    const view = render(
      <WorldMapCanvas
        camera={INITIAL_WORLD_CAMERA}
        onCameraChange={vi.fn()}
        onSelectionChange={onSelectionChange}
        overlay="danger"
        projection={routeProjection}
        reducedEffects
      />,
    );
    await view.findByRole('img', { name: /founding world map/ });
    const host = view.container.querySelector<HTMLElement>('.world-map-canvas');
    if (host === null) throw new Error('World map host is missing.');
    host.setPointerCapture = vi.fn();
    host.hasPointerCapture = vi.fn(() => true);
    host.releasePointerCapture = vi.fn();
    const clickTile = (tileIndex: number, pointerId: number) => {
      const clientX = INITIAL_WORLD_CAMERA.x + (tileIndex % routeProjection.width) * 6 + 3;
      const clientY =
        INITIAL_WORLD_CAMERA.y + Math.floor(tileIndex / routeProjection.width) * 6 + 3;
      fireEvent.pointerDown(host, { clientX, clientY, pointerId });
      fireEvent.pointerUp(host, { clientX, clientY, pointerId });
    };

    clickTile(3, 11);
    expect(onSelectionChange).toHaveBeenLastCalledWith({ id: 77, kind: 'route' });
    clickTile(0, 12);
    expect(onSelectionChange).toHaveBeenLastCalledWith({ id: 9, kind: 'crisis' });
    expect(pixiMocks.graphics[5]?.closePath).toHaveBeenCalled();
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
