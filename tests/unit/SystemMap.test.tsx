import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import type { SpaceProjection } from '../../src/protocol';
import { SystemMap } from '../../src/rendering/SystemMap';
import {
  INITIAL_SYSTEM_CAMERA,
  parseSystemSelection,
  systemBodyLayout,
  systemSelectionDetail,
  systemSelectionOptions,
} from '../../src/rendering/system-map-model';

const zeroResources = Object.freeze({ food: 0, metal: 0, stone: 0, timber: 0, water: 0 });

const space: SpaceProjection = Object.freeze({
  aliens: Object.freeze([
    Object.freeze({ discoveredTick: 900, homeBodyId: 2, id: 7, trait: 'curious' as const }),
  ]),
  bodies: Object.freeze([
    Object.freeze({
      distance: 0,
      habitable: true,
      id: 1,
      kind: 'home' as const,
      name: 'Hearthworld',
      remainingDeposit: zeroResources,
    }),
    Object.freeze({
      distance: 12,
      habitable: true,
      id: 2,
      kind: 'planet' as const,
      name: 'Aster Haven',
      remainingDeposit: zeroResources,
    }),
  ]),
  cargoTransfers: Object.freeze([
    Object.freeze({
      cargo: zeroResources,
      civilizationId: 1,
      departureTick: 800,
      destination: Object.freeze({ colonyId: 8, kind: 'colony' as const }),
      dueTick: 1_000,
      id: 6,
      origin: Object.freeze({ civilizationId: 1, kind: 'settlement' as const, settlementId: 1 }),
      status: 'active' as const,
    }),
  ]),
  colonies: Object.freeze([
    Object.freeze({
      bodyId: 2,
      civilizationId: 1,
      cultureDivergence: 4,
      cultureId: 1,
      foundedTick: 700,
      id: 8,
      residentCount: 24,
      settlementId: 1,
      status: 'active' as const,
      stores: zeroResources,
    }),
  ]),
  communications: Object.freeze([
    Object.freeze({
      civilizationId: 1,
      destinationBodyId: 2,
      dueTick: 1_050,
      id: 10,
      originBodyId: 1,
      sentTick: 950,
      status: 'pending' as const,
      topic: 'contact' as const,
    }),
  ]),
  ledger: Object.freeze({
    alienImports: zeroResources,
    bodyExtraction: zeroResources,
    consumed: zeroResources,
    lost: zeroResources,
    surfaceExports: zeroResources,
    surfaceImports: zeroResources,
  }),
  missions: Object.freeze([
    Object.freeze({
      cargo: zeroResources,
      civilizationId: 1,
      completedTick: null,
      departureTick: 800,
      destinationBodyId: 2,
      dueTick: 1_000,
      id: 5,
      kind: 'colony' as const,
      originBodyId: 1,
      passengerCount: 24,
      spacecraftId: 4,
      status: 'active' as const,
    }),
  ]),
  offworldPopulation: 24,
  operationCount: 12,
  programs: Object.freeze([
    Object.freeze({
      civilizationId: 1,
      id: 3,
      launchCapacity: 12,
      planetaryTransportCapacity: 18,
      settlementId: 1,
      stage: 'spaceflight' as const,
    }),
  ]),
  relations: Object.freeze([
    Object.freeze({
      alienId: 7,
      changedTick: 950,
      civilizationId: 1,
      conflictCount: 0,
      exchangeCount: 1,
      id: 11,
      status: 'cooperative' as const,
      tension: 12,
      trust: 68,
    }),
  ]),
  spacecraft: Object.freeze([
    Object.freeze({
      civilizationId: 1,
      currentBodyId: 2,
      id: 4,
      missionId: 5,
      status: 'orbiting' as const,
    }),
  ]),
  tick: 1_000,
});

describe('system map', () => {
  it('derives a stable factual layout and exposes every visible fact as a selection', () => {
    expect(systemBodyLayout(space.bodies)).toStrictEqual(
      systemBodyLayout([...space.bodies].reverse()),
    );
    expect(systemBodyLayout(space.bodies)[0]).toStrictEqual({ bodyId: 1, x: 0, y: 0 });

    const options = systemSelectionOptions(space);
    expect(options.map((option) => option.selection.kind)).toStrictEqual([
      'body',
      'body',
      'spacecraft',
      'mission',
      'colony',
      'cargo',
      'communication',
      'alien',
    ]);
    expect(systemSelectionDetail(space, { id: 7, kind: 'alien' })).toStrictEqual({
      heading: 'Contacted civilization 7',
      lines: [
        'Home body 2',
        'Observed behavior: curious',
        'Discovered tick 900',
        'cooperative relation · trust 68 · tension 12',
      ],
    });
    expect(parseSystemSelection('alien:7')).toStrictEqual({ id: 7, kind: 'alien' });
    expect(parseSystemSelection('unknown:7')).toBeNull();
  });

  it('supports pointer and keyboard selection plus keyboard-only camera movement', async () => {
    const user = userEvent.setup();
    const onCameraChange = vi.fn();
    const onSelectionChange = vi.fn();
    render(
      <SystemMap
        camera={INITIAL_SYSTEM_CAMERA}
        onCameraChange={onCameraChange}
        onSelectionChange={onSelectionChange}
        selection={null}
        space={space}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Aster Haven, planet body' }));
    expect(onSelectionChange).toHaveBeenCalledWith({ id: 2, kind: 'body' });

    const mission = screen.getByRole('button', { name: 'colony mission 5, active' });
    fireEvent.keyDown(mission, { key: 'Enter' });
    expect(onSelectionChange).toHaveBeenCalledWith({ id: 5, kind: 'mission' });

    const map = screen.getByRole('region', { name: 'Known celestial system map' });
    fireEvent.keyDown(map, { key: 'ArrowRight' });
    expect(onCameraChange).toHaveBeenCalledWith({ x: 36, y: 0, zoom: 1 });
    expect(screen.getByText(/2 known bodies/)).toBeVisible();
    expect(screen.getByText(/1 contacted civilizations/)).toBeVisible();
  });
});
