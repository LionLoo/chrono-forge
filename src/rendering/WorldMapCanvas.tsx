import 'pixi.js/unsafe-eval';

import { Application, Container, Graphics } from 'pixi.js';
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';

import { panCamera, zoomCamera, type WorldCamera } from './camera';
import { colorForTile, type WorldOverlay } from './world-palette';

export interface WorldMapProjection {
  readonly width: number;
  readonly height: number;
  readonly biome: Uint8Array;
  readonly resource: Uint16Array;
  readonly habitability: Uint8Array;
  readonly hazard: Uint8Array;
}

interface WorldMapCanvasProps {
  readonly camera: WorldCamera;
  readonly onCameraChange: (camera: WorldCamera) => void;
  readonly overlay: WorldOverlay;
  readonly projection: WorldMapProjection;
}

interface PixiScene {
  readonly application: Application;
  readonly graphics: Graphics;
  readonly worldLayer: Container;
}

const TILE_SIZE = 6;

function drawProjection(
  graphics: Graphics,
  projection: WorldMapProjection,
  overlay: WorldOverlay,
): void {
  graphics.clear();

  for (let index = 0; index < projection.biome.length; index += 1) {
    const x = index % projection.width;
    const y = Math.floor(index / projection.width);
    graphics
      .rect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE + 0.25, TILE_SIZE + 0.25)
      .fill(
        colorForTile(
          overlay,
          projection.biome[index] ?? 0,
          projection.resource[index] ?? 0,
          projection.habitability[index] ?? 0,
          projection.hazard[index] ?? 0,
        ),
      );
  }
}

export function WorldMapCanvas({
  camera,
  onCameraChange,
  overlay,
  projection,
}: WorldMapCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<PixiScene | null>(null);
  const cameraRef = useRef(camera);
  const onCameraChangeRef = useRef(onCameraChange);
  const overlayRef = useRef(overlay);
  const projectionRef = useRef(projection);
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);

  useEffect(() => {
    cameraRef.current = camera;
    onCameraChangeRef.current = onCameraChange;
    overlayRef.current = overlay;
    projectionRef.current = projection;
  }, [camera, onCameraChange, overlay, projection]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    const application = new Application();

    void application
      .init({
        antialias: false,
        autoDensity: true,
        background: '#0b1510',
        preference: 'webgl',
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        resizeTo: host,
      })
      .then(() => {
        if (disposed) {
          application.destroy(true, { children: true });
          return;
        }

        const worldLayer = new Container();
        const graphics = new Graphics();
        worldLayer.addChild(graphics);
        application.stage.addChild(worldLayer);
        const canvas = application.canvas;
        canvas.setAttribute('aria-label', 'Generated Chrono Forge world');
        canvas.setAttribute('role', 'img');
        canvas.tabIndex = 0;
        host.appendChild(canvas);

        sceneRef.current = { application, graphics, worldLayer };
        drawProjection(graphics, projectionRef.current, overlayRef.current);
        worldLayer.position.set(cameraRef.current.x, cameraRef.current.y);
        worldLayer.scale.set(cameraRef.current.zoom);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          host.dataset.renderError =
            error instanceof Error ? error.message : 'Renderer unavailable';
        }
        application.destroy(true, { children: true });
      });

    return () => {
      disposed = true;
      if (sceneRef.current?.application === application) {
        sceneRef.current = null;
        application.destroy(true, { children: true });
      }
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    drawProjection(scene.graphics, projection, overlay);
    scene.worldLayer.position.set(camera.x, camera.y);
    scene.worldLayer.scale.set(camera.zoom);
  }, [camera, overlay, projection]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;

    const next = panCamera(cameraRef.current, event.clientX - drag.x, event.clientY - drag.y);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    onCameraChangeRef.current(next);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      className="world-map-canvas"
      data-overlay={overlay}
      onPointerCancel={handlePointerUp}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={(event) => {
        event.preventDefault();
        onCameraChangeRef.current(
          zoomCamera(cameraRef.current, event.deltaY < 0 ? 1.15 : 1 / 1.15),
        );
      }}
      ref={hostRef}
    />
  );
}
