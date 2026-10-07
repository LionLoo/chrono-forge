import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { SpaceProjection } from '../../src/protocol';
import { SpacePanel } from '../../src/ui/SpacePanel';

const EMPTY = Object.freeze({ food: 0, water: 0, timber: 0, stone: 0, metal: 0 });
const space: SpaceProjection = {
  tick: 20_000,
  operationCount: 12,
  offworldPopulation: 2,
  bodies: [
    {
      id: 1,
      kind: 'home',
      name: 'Body-1',
      distance: 0,
      habitable: true,
      remainingDeposit: { ...EMPTY, stone: 100, metal: 100 },
    },
    {
      id: 2,
      kind: 'planet',
      name: 'Body-2',
      distance: 8,
      habitable: true,
      remainingDeposit: { ...EMPTY, water: 24, stone: 52, metal: 41 },
    },
  ],
  programs: [
    {
      id: 1,
      civilizationId: 2,
      settlementId: 1,
      stage: 'spaceflight',
      planetaryTransportCapacity: 3,
      launchCapacity: 1,
    },
  ],
  spacecraft: [{ id: 2, civilizationId: 2, status: 'in-flight', currentBodyId: 1, missionId: 3 }],
  missions: [
    {
      id: 3,
      spacecraftId: 2,
      civilizationId: 2,
      kind: 'colony',
      originBodyId: 1,
      destinationBodyId: 2,
      departureTick: 20_000,
      dueTick: 20_030,
      status: 'active',
      completedTick: null,
      passengerCount: 2,
      cargo: { food: 3, water: 3, timber: 1, stone: 1, metal: 1 },
    },
  ],
  colonies: [],
  cargoTransfers: [
    {
      id: 4,
      civilizationId: 2,
      origin: { kind: 'settlement', civilizationId: 2, settlementId: 1 },
      destination: { kind: 'colony', colonyId: 8 },
      departureTick: 20_000,
      dueTick: 20_040,
      status: 'active',
      cargo: { ...EMPTY, food: 2, water: 2 },
    },
  ],
  communications: [
    {
      id: 5,
      civilizationId: 2,
      originBodyId: 1,
      destinationBodyId: 2,
      sentTick: 20_000,
      dueTick: 20_050,
      status: 'pending',
      topic: 'mission',
    },
  ],
  aliens: [{ id: 1, homeBodyId: 2, trait: 'curious', discoveredTick: 19_000 }],
  relations: [
    {
      id: 6,
      civilizationId: 2,
      alienId: 1,
      status: 'cooperative',
      trust: 61,
      tension: 22,
      changedTick: 19_000,
      exchangeCount: 3,
      conflictCount: 0,
    },
  ],
  ledger: {
    surfaceImports: EMPTY,
    alienImports: EMPTY,
    bodyExtraction: EMPTY,
    consumed: EMPTY,
    lost: EMPTY,
    surfaceExports: EMPTY,
  },
};

describe('SpacePanel', () => {
  it('presents missions, bodies, and contacted alien relations as factual read-only state', () => {
    render(<SpacePanel space={space} />);

    expect(screen.getByRole('heading', { name: 'The wider system' })).toBeVisible();
    expect(screen.getByText('Off-world population').nextElementSibling).toHaveTextContent('2');
    expect(screen.getByRole('list', { name: 'Space missions' })).toHaveTextContent(
      'colony mission #3: body 1 to 2, active; due tick 20030; passengers 2',
    );
    expect(screen.getByText('Body-2').parentElement).toHaveTextContent(
      'planet · distance 8 · habitable',
    );
    expect(screen.getByRole('list', { name: 'Alien civilizations' })).toHaveTextContent(
      'cooperative relation, trust 61, tension 22, exchanges 3, conflicts 0',
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps detailed delayed logistics behind a keyboard-operable disclosure', async () => {
    const user = userEvent.setup();
    render(<SpacePanel space={space} />);

    const disclosure = screen.getByText('Logistics: 1 cargo and 1 communications in transit');
    expect(screen.getByRole('list', { name: 'Interworld cargo' })).not.toBeVisible();
    await user.click(disclosure);
    expect(screen.getByRole('list', { name: 'Interworld cargo' })).toBeVisible();
    expect(screen.getByRole('list', { name: 'Interworld communications' })).toHaveTextContent(
      'mission message #5: body 1 to 2, pending, due tick 20050',
    );
  });

  it('explains the contextual pre-space state without exposing undiscovered contacts', () => {
    render(
      <SpacePanel
        space={{
          ...space,
          offworldPopulation: 0,
          programs: [],
          spacecraft: [],
          missions: [],
          cargoTransfers: [],
          communications: [],
          aliens: [],
          relations: [],
        }}
      />,
    );

    expect(screen.getByText('Pre-spaceflight')).toBeVisible();
    expect(screen.getByText(/No civilization has yet assembled the knowledge/)).toBeVisible();
    expect(screen.getByText('No alien civilization has been contacted.')).toBeVisible();
  });

  it('fails closed if an uncontacted alien reaches the read-only projection', () => {
    render(
      <SpacePanel
        space={{
          ...space,
          aliens: [{ id: 1, homeBodyId: 2, trait: 'curious', discoveredTick: null }],
        }}
      />,
    );

    expect(screen.getByText('Contacted civilizations').nextElementSibling).toHaveTextContent('0');
    expect(screen.queryByRole('list', { name: 'Alien civilizations' })).not.toBeInTheDocument();
    expect(screen.getByText('No alien civilization has been contacted.')).toBeVisible();
  });
});
