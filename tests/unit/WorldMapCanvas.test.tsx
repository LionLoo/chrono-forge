import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import { INITIAL_WORLD_CAMERA, type WorldCamera } from '../../src/rendering/camera';
import { STRUCTURE_KIND_CODES, STRUCTURE_STATE_CODES } from '../../src/protocol';
import { WorldMapCanvas, type WorldMapProjection } from '../../src/rendering/WorldMapCanvas';
import { createInitialWorld, stepWorld } from '../../src/simulation/world';
import { createTestRuntimeActivityRecorder } from '../../src/testing/runtime-activity';
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
    readonly ellipse = vi.fn(() => this);
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
    readonly render = vi.fn();

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
    allowInitialization() {
      initialize = () => Promise.resolve();
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

function initialAgentHead(
  frame: WorldMapProjection,
  agentIndex: number,
  tileIndex: number,
): readonly [number, number] {
  const id = frame.agentIds[agentIndex] ?? 0;
  const ageYears = frame.society.people.find((person) => person.id === id)?.ageYears ?? 18;
  const ageScale = ageYears < 18 ? 0.76 : ageYears >= 60 ? 0.92 : 1;
  const height = 4.35 * ageScale;
  const offsetX = ((id % 3) - 1) * 0.45;
  const offsetY = ((Math.floor(id / 3) % 3) - 1) * 0.3;
  let identity = Math.imul((id | 0) ^ 0x7ce1, 0x45d9f3b);
  identity ^= identity >>> 16;
  identity = Math.imul(identity, 0x45d9f3b);
  identity ^= identity >>> 16;
  const facing = (identity >>> 0) % 2 === 0 ? -1 : 1;
  return [
    (tileIndex % frame.width) * 6 + 3 + offsetX + facing * height * 0.035,
    Math.floor(tileIndex / frame.width) * 6 + 3 + offsetY - height * 0.32,
  ];
}

describe('Pixi world projection', () => {
  beforeEach(() => {
    pixiMocks.reset();
  });

  it('renders on demand and remains silent while the static world is idle', async () => {
    let nowMs = 0;
    const activity = createTestRuntimeActivityRecorder(() => nowMs);
    const view = render(
      <WorldMapCanvas
        activityRecorder={activity}
        camera={INITIAL_WORLD_CAMERA}
        onCameraChange={vi.fn()}
        overlay="terrain"
        projection={projection}
      />,
    );

    await view.findByRole('application', { name: /founding world map/ });
    const application = pixiMocks.applications[0];
    expect(application?.init).toHaveBeenCalledWith(
      expect.objectContaining({ autoStart: false, preference: 'webgl' }),
    );
    expect(application?.render).toHaveBeenCalledOnce();
    expect(activity.count('render-applied')).toBe(1);

    nowMs = 60_000;
    await act(async () => Promise.resolve());
    expect(application?.render).toHaveBeenCalledOnce();
    expect(activity.count('render-applied')).toBe(1);

    view.rerender(
      <WorldMapCanvas
        activityRecorder={activity}
        camera={{ ...INITIAL_WORLD_CAMERA, x: INITIAL_WORLD_CAMERA.x + 6 }}
        onCameraChange={vi.fn()}
        overlay="terrain"
        projection={projection}
      />,
    );
    expect(application?.render).toHaveBeenCalledTimes(2);
    expect(
      activity
        .samples()
        .filter((sample) => sample.kind === 'render-applied')
        .map((sample) => sample.reason),
    ).toEqual(['initial', 'view']);
  });

  it('contains activity-recorder failures without changing successful renders', async () => {
    const throwingRecorder = {
      record() {
        throw new Error('Injected activity-recorder failure');
      },
    };
    const view = render(
      <WorldMapCanvas
        activityRecorder={throwingRecorder}
        camera={INITIAL_WORLD_CAMERA}
        onCameraChange={vi.fn()}
        overlay="terrain"
        projection={projection}
      />,
    );

    await view.findByRole('application', { name: /founding world map/ });
    expect(view.queryByRole('alert')).not.toBeInTheDocument();
    expect(pixiMocks.applications[0]?.render).toHaveBeenCalledOnce();

    view.rerender(
      <WorldMapCanvas
        activityRecorder={throwingRecorder}
        camera={{ ...INITIAL_WORLD_CAMERA, x: INITIAL_WORLD_CAMERA.x + 6 }}
        onCameraChange={vi.fn()}
        overlay="terrain"
        projection={projection}
      />,
    );
    expect(view.queryByRole('alert')).not.toBeInTheDocument();
    expect(pixiMocks.applications[0]?.render).toHaveBeenCalledTimes(2);
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
      expect(view.getByRole('application', { name: /founding world map/ })).toBeVisible();
    });
    const graphics = pixiMocks.graphics[0];
    const worldLayer = pixiMocks.containers[0];
    expect(graphics?.rect.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(graphics?.fill.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(worldLayer?.position.set).toHaveBeenCalledWith(24, 24);
    expect(worldLayer?.scale.set).toHaveBeenCalledWith(1.5);
    expect(view.container.querySelector('.world-map-canvas')).toHaveAttribute(
      'data-detail',
      'district',
    );

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
    expect(view.container.querySelector('.world-map-canvas')).toHaveAttribute(
      'data-detail',
      'district',
    );

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
    fireEvent.pointerMove(host, { clientX: 30, clientY: 30, pointerId: 7 });
    expect(onCameraChange).toHaveBeenLastCalledWith({ x: 50, y: 60, zoom: 1.5 });
    fireEvent.pointerMove(host, { clientX: 30, clientY: 30, pointerId: 9 });
    fireEvent.pointerUp(host, { pointerId: 7 });
    expect(releasePointerCapture).toHaveBeenCalledWith(7);

    const pageWheel = vi.fn();
    document.addEventListener('wheel', pageWheel);
    const mousePoint = { clientX: 150, clientY: 160 };
    const worldPoint = {
      x: (mousePoint.clientX - 50 - 50) / 1.5,
      y: (mousePoint.clientY - 100 - 60) / 1.5,
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

  it('replans the visible projection and reports the exact host size after a resize', async () => {
    let notifyResize: ((width: number, height: number) => void) | null = null;
    const disconnect = vi.fn();
    const observe = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          notifyResize = (width, height) => {
            callback(
              [
                {
                  contentRect: { height, width } as DOMRectReadOnly,
                } as ResizeObserverEntry,
              ],
              this as unknown as ResizeObserver,
            );
          };
        }

        readonly disconnect = disconnect;
        readonly observe = observe;
      },
    );
    const onViewportResize = vi.fn();
    const view = render(
      <WorldMapCanvas
        camera={INITIAL_WORLD_CAMERA}
        onCameraChange={vi.fn()}
        onViewportResize={onViewportResize}
        overlay="terrain"
        projection={projection}
      />,
    );

    await view.findByRole('application', { name: /founding world map/ });
    const host = view.container.querySelector<HTMLElement>('.world-map-canvas');
    if (host === null || notifyResize === null) throw new Error('Resize observer was not ready.');
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 720 });
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 420 });
    const worldLayer = pixiMocks.containers[0];
    const priorApplications = worldLayer?.position.set.mock.calls.length ?? 0;

    act(() => {
      notifyResize?.(720, 420);
    });

    expect(onViewportResize).toHaveBeenCalledWith(720, 420);
    await waitFor(() => {
      expect(worldLayer?.position.set.mock.calls.length).toBeGreaterThan(priorApplications);
    });
    expect(observe).toHaveBeenCalledWith(host);
    view.unmount();
    expect(disconnect).toHaveBeenCalled();
    vi.unstubAllGlobals();
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
    const advanced = projectWorldFrame(stepWorld(world, 200));
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

    await waitFor(() => expect(view.getByRole('application')).toBeVisible());
    const agentGraphics = pixiMocks.graphics[5]!;
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
    const destination = initialAgentHead(advanced, movedAgentIndex, destinationTile);
    expect(halfway.slice(0, 2)).not.toEqual(before.slice(0, 2));
    expect(halfway.slice(0, 2)).not.toEqual(destination);

    requestAnimationFrame.mockRestore();
    performanceNow.mockRestore();
  });

  it('keeps reduced-effects agent movement static', async () => {
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame');
    const world = createInitialWorld([1, 2, 3, 4]);
    const initial = projectWorldFrame(world);
    const advanced = projectWorldFrame(stepWorld(world, 200));
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

    await waitFor(() => expect(view.getByRole('application')).toBeVisible());
    const agentGraphics = pixiMocks.graphics[5]!;
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
    ).toEqual(initialAgentHead(advanced, movedAgentIndex, destinationTile));
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    requestAnimationFrame.mockRestore();
  });

  it('cancels pending agent interpolation when reduced effects turn on', async () => {
    let nextFrameId = 1;
    const pendingFrames = new Map<number, FrameRequestCallback>();
    const requestAnimationFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        const frameId = nextFrameId;
        nextFrameId += 1;
        pendingFrames.set(frameId, callback);
        return frameId;
      });
    const cancelAnimationFrame = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation((frameId) => {
        pendingFrames.delete(frameId);
      });
    const world = createInitialWorld([1, 2, 3, 4]);
    const initial = projectWorldFrame(world);
    const advanced = projectWorldFrame(stepWorld(world, 200));
    const view = render(
      <WorldMapCanvas
        camera={INITIAL_WORLD_CAMERA}
        onCameraChange={vi.fn()}
        overlay="terrain"
        projection={initial}
      />,
    );

    await view.findByRole('application');
    view.rerender(
      <WorldMapCanvas
        camera={INITIAL_WORLD_CAMERA}
        onCameraChange={vi.fn()}
        overlay="terrain"
        projection={advanced}
      />,
    );
    expect(pendingFrames.size).toBe(1);
    const renderCountBeforeReducedEffects =
      pixiMocks.applications[0]?.render.mock.calls.length ?? 0;

    view.rerender(
      <WorldMapCanvas
        camera={INITIAL_WORLD_CAMERA}
        onCameraChange={vi.fn()}
        overlay="terrain"
        projection={advanced}
        reducedEffects
      />,
    );

    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(pendingFrames.size).toBe(0);
    expect(pixiMocks.applications[0]?.render).toHaveBeenCalledTimes(
      renderCountBeforeReducedEffects + 1,
    );
    requestAnimationFrame.mockRestore();
    cancelAnimationFrame.mockRestore();
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
      expect(view.getByRole('alert')).toHaveTextContent(
        'The world map could not start. WebGL unavailable',
      );
      expect(pixiMocks.applications[0]?.destroy).toHaveBeenCalledWith(true, { children: true });
    });

    pixiMocks.allowInitialization();
    fireEvent.click(view.getByRole('button', { name: 'Retry world map' }));

    await waitFor(() => {
      expect(view.queryByRole('alert')).not.toBeInTheDocument();
      expect(view.getByRole('application', { name: /world map/ })).toBeVisible();
      expect(view.container.querySelector('.world-map-canvas')).not.toHaveAttribute(
        'data-render-error',
      );
    });
    expect(pixiMocks.applications).toHaveLength(2);
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
      expect(
        view.getByRole('application', { name: /1 visible agents, 1 structures/ }),
      ).toBeVisible();
    });
    expect(pixiMocks.graphics[3]?.rect).toHaveBeenCalled();
    expect(pixiMocks.graphics[3]?.stroke).toHaveBeenCalled();
    expect(pixiMocks.graphics[5]?.circle).toHaveBeenCalled();
    expect(pixiMocks.graphics[5]?.moveTo).toHaveBeenCalled();
    expect(pixiMocks.graphics[5]?.lineTo).toHaveBeenCalled();

    const structureClears = pixiMocks.graphics[3]?.clear.mock.calls.length;
    const agentClears = pixiMocks.graphics[5]?.clear.mock.calls.length;
    view.rerender(
      <WorldMapCanvas
        camera={INITIAL_WORLD_CAMERA}
        onCameraChange={vi.fn()}
        overlay="terrain"
        projection={visualProjection}
      />,
    );
    expect(pixiMocks.graphics[3]?.clear).toHaveBeenCalledTimes(structureClears ?? 0);
    expect(pixiMocks.graphics[5]?.clear).toHaveBeenCalledTimes(agentClears ?? 0);

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
    expect(pixiMocks.graphics[5]?.clear).toHaveBeenCalledTimes((agentClears ?? 0) + 1);
  });

  it('draws factual launch, body, craft, and colony silhouettes on a separate presentation layer', async () => {
    const base = projectWorldFrame(createInitialWorld([13, 21, 34, 55]));
    const settlement = base.civilizations.settlements[0];
    const homeBody = base.space.bodies[0];
    if (settlement === undefined || homeBody === undefined)
      throw new Error('Expected founding settlement and home body projections.');
    const emptyStock = { food: 0, metal: 0, stone: 0, timber: 0, water: 0 } as const;
    const spaceProjection: WorldMapProjection = {
      ...base,
      space: {
        ...base.space,
        bodies: [
          homeBody,
          {
            distance: 4,
            habitable: true,
            id: 2,
            kind: 'planet',
            name: 'Test world',
            remainingDeposit: emptyStock,
          },
        ],
        colonies: [
          {
            bodyId: 2,
            cultureDivergence: 3,
            cultureId: settlement.cultureId,
            civilizationId: settlement.civilizationId,
            foundedTick: 10,
            id: 6,
            residentCount: 4,
            settlementId: settlement.id,
            status: 'active',
            stores: emptyStock,
          },
        ],
        missions: [
          {
            cargo: emptyStock,
            civilizationId: settlement.civilizationId,
            completedTick: null,
            departureTick: 10,
            destinationBodyId: 2,
            dueTick: 20,
            id: 3,
            kind: 'colony',
            originBodyId: homeBody.id,
            passengerCount: 4,
            spacecraftId: 2,
            status: 'active',
          },
        ],
        programs: [
          {
            civilizationId: settlement.civilizationId,
            id: 1,
            launchCapacity: 2,
            planetaryTransportCapacity: 4,
            settlementId: settlement.id,
            stage: 'spaceflight',
          },
        ],
        spacecraft: [
          {
            civilizationId: settlement.civilizationId,
            currentBodyId: homeBody.id,
            id: 2,
            missionId: 3,
            status: 'in-flight',
          },
        ],
      },
    };
    const view = render(
      <WorldMapCanvas
        camera={{ ...INITIAL_WORLD_CAMERA, zoom: 3 }}
        onCameraChange={vi.fn()}
        overlay="terrain"
        projection={spaceProjection}
      />,
    );

    await view.findByRole('application', { name: /space world map/ });
    const spaceGraphics = pixiMocks.graphics[4];
    expect(spaceGraphics?.clear).toHaveBeenCalled();
    expect(spaceGraphics?.moveTo).toHaveBeenCalled();
    expect(spaceGraphics?.closePath).toHaveBeenCalled();
    expect(spaceGraphics?.circle).toHaveBeenCalled();
    expect(view.container.querySelector('.world-map-canvas')).toHaveAttribute(
      'data-detail',
      'close',
    );
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

    const map = await view.findByRole('application', { name: /founding world map/ });
    const keyboardHelp = view.getByText(
      'Use arrow keys to pan. Use plus and minus to zoom. Press Enter to inspect the first visible map object.',
    );
    expect(map).toHaveAttribute('aria-roledescription', 'interactive world map');
    expect(map).toHaveAttribute('aria-describedby', keyboardHelp.id);
    expect(map).toHaveAttribute('tabindex', '0');
    const host = view.container.querySelector<HTMLElement>('.world-map-canvas');
    expect(host).not.toBeNull();
    if (host === null) return;
    host.setPointerCapture = vi.fn();
    host.hasPointerCapture = vi.fn(() => true);
    host.releasePointerCapture = vi.fn();

    fireEvent.keyDown(map, { key: 'ArrowLeft' });
    expect(onCameraChange).toHaveBeenCalledWith({ x: -12, y: 24, zoom: 1.5 });
    fireEvent.keyDown(map, { key: '+' });
    const zoomedCamera = onCameraChange.mock.calls.at(-1)?.[0] as WorldCamera;
    expect(zoomedCamera).toMatchObject({ x: -12, y: 24 });
    expect(zoomedCamera.zoom).toBeCloseTo(1.725);
    fireEvent.keyDown(map, { key: 'Enter' });
    expect(onSelectionChange).toHaveBeenCalledWith({
      id: projection.agentIds[0],
      kind: 'agent',
    });

    const tile = projection.agentTiles[0] ?? 0;
    const pointerX =
      INITIAL_WORLD_CAMERA.x + ((tile % projection.width) * 6 + 3) * INITIAL_WORLD_CAMERA.zoom;
    const pointerY =
      INITIAL_WORLD_CAMERA.y +
      (Math.floor(tile / projection.width) * 6 + 3) * INITIAL_WORLD_CAMERA.zoom;
    fireEvent.pointerDown(host, { clientX: pointerX, clientY: pointerY, pointerId: 4 });
    expect(host).toHaveFocus();
    fireEvent.pointerUp(host, { clientX: pointerX, clientY: pointerY, pointerId: 4 });
    expect(onSelectionChange).toHaveBeenLastCalledWith({
      id: projection.agentIds[0],
      kind: 'agent',
    });
    expect(host).toHaveAttribute('data-effects', 'reduced');
  });

  it('pointer-picks route lines without inventing a location for a nonspatial crisis', async () => {
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
    await view.findByRole('application', { name: /founding world map/ });
    const host = view.container.querySelector<HTMLElement>('.world-map-canvas');
    if (host === null) throw new Error('World map host is missing.');
    host.setPointerCapture = vi.fn();
    host.hasPointerCapture = vi.fn(() => true);
    host.releasePointerCapture = vi.fn();
    const clickTile = (tileIndex: number, pointerId: number) => {
      const clientX =
        INITIAL_WORLD_CAMERA.x +
        ((tileIndex % routeProjection.width) * 6 + 3) * INITIAL_WORLD_CAMERA.zoom;
      const clientY =
        INITIAL_WORLD_CAMERA.y +
        (Math.floor(tileIndex / routeProjection.width) * 6 + 3) * INITIAL_WORLD_CAMERA.zoom;
      fireEvent.pointerDown(host, { clientX, clientY, pointerId });
      fireEvent.pointerUp(host, { clientX, clientY, pointerId });
    };

    clickTile(3, 11);
    expect(onSelectionChange).toHaveBeenLastCalledWith({ id: 77, kind: 'route' });
    clickTile(0, 12);
    expect(onSelectionChange).toHaveBeenLastCalledWith(null);
    expect(onSelectionChange).not.toHaveBeenCalledWith({ id: 9, kind: 'crisis' });
    expect(pixiMocks.graphics[6]?.rect).toHaveBeenCalledWith(2, 2, 32, 8);
    expect(pixiMocks.graphics[6]?.stroke).toHaveBeenCalledWith({
      alpha: 0.42,
      color: 0xd76d55,
      width: 1.2,
    });
  });

  it('does not keyboard-pick an effect-only nonspatial crisis from the map', async () => {
    const onSelectionChange = vi.fn();
    const base = projectWorldFrame(
      createInitialWorld([8, 13, 21, 34], { width: 4, height: 2, chunkSize: 1 }),
    );
    const effectOnlyProjection: WorldMapProjection = {
      ...base,
      agentActions: new Uint8Array(),
      agentHealth: new Uint16Array(),
      agentIds: new Uint32Array(),
      agentTiles: new Uint32Array(),
      civilizations: {
        ...base.civilizations,
        routes: [],
        ruins: [],
        settlements: [],
      },
      development: {
        ...base.development,
        activeCrises: [
          {
            id: 19,
            kind: 'storm',
            severity: 80,
            startedTick: 0,
            triggerCondition: 'stormPressure',
            triggerValue: 95,
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
        projection={effectOnlyProjection}
        reducedEffects
      />,
    );

    const map = await view.findByRole('application', { name: /founding world map/ });
    fireEvent.keyDown(map, { key: 'Enter' });

    expect(onSelectionChange).toHaveBeenCalledOnce();
    expect(onSelectionChange).toHaveBeenCalledWith(null);
    expect(onSelectionChange).not.toHaveBeenCalledWith({ id: 19, kind: 'crisis' });
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
