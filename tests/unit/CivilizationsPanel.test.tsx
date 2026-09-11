import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CivilizationsPanel, type CivilizationsPanelProps } from '../../src/ui/CivilizationsPanel';

const civilizations: CivilizationsPanelProps['civilizations'] = {
  operationCount: 42,
  settlements: [
    {
      id: 1,
      civilizationId: 1,
      name: 'Riverhome',
      cultureId: 1,
      centerTileIndex: 12,
      status: 'active',
      developmentStage: 'advanced-city',
      developmentStageChangedTick: 20_000,
      developmentStageProvenance: 'observed',
      population: 24,
      stability: 73,
      reserves: { food: 40, water: 36, timber: 12, stone: 8, metal: 3 },
      territoryHistory: [],
      territoryHistorySummaryCount: 0,
      foundedTick: 0,
      endedTick: null,
      provenance: 'initial',
    },
    {
      id: 2,
      civilizationId: 2,
      name: 'Stoneford',
      cultureId: 2,
      centerTileIndex: 31,
      status: 'conquered',
      developmentStage: 'town',
      developmentStageChangedTick: 7_000,
      developmentStageProvenance: 'observed',
      population: 11,
      stability: 31,
      reserves: { food: 15, water: 21, timber: 5, stone: 17, metal: 4 },
      territoryHistory: [
        { id: 4, tick: 7_000, tileIndex: 30, previousSettlementId: 1, nextSettlementId: 2 },
      ],
      territoryHistorySummaryCount: 2,
      foundedTick: 5_000,
      endedTick: 9_000,
      provenance: 'm6-founding',
    },
  ],
  civilizations: [
    {
      id: 1,
      name: 'Riverfolk',
      cultureId: 1,
      status: 'independent',
      foundingSettlementId: 1,
      memberSettlementIds: [1],
      foundedTick: 0,
      endedTick: null,
      provenance: 'initial',
    },
    {
      id: 2,
      name: 'Stonefolk',
      cultureId: 2,
      status: 'collapsed',
      foundingSettlementId: 2,
      memberSettlementIds: [2],
      foundedTick: 5_000,
      endedTick: 9_000,
      provenance: 'm6-founding',
    },
  ],
  residencies: [
    {
      id: 1,
      subjectKind: 'person',
      subjectId: 3,
      settlementId: 1,
      startedTick: 0,
      endedTick: null,
    },
  ],
  activeResidencyCount: 24,
  historicalResidencyCount: 5,
  diplomacy: [
    {
      id: 1,
      firstCivilizationId: 1,
      secondCivilizationId: 2,
      status: 'at-war',
      score: -88,
      changedTick: 8_000,
    },
  ],
  routes: [
    {
      id: 1,
      firstSettlementId: 1,
      secondSettlementId: 2,
      status: 'disrupted',
      volume: 7,
      startedTick: 6_000,
      endedTick: null,
    },
  ],
  conflicts: [
    {
      id: 1,
      attackerCivilizationId: 1,
      defenderCivilizationId: 2,
      status: 'resolved',
      pressure: 82,
      startedTick: 8_000,
      endedTick: 9_000,
      winnerCivilizationId: 1,
    },
  ],
  ruins: [{ id: 1, settlementId: 2, createdTick: 9_000, cause: 'conquered' }],
  tileOwners: new Uint32Array([0, 1, 2]),
};

function renderPanel(overrides: Partial<CivilizationsPanelProps> = {}) {
  return render(
    <CivilizationsPanel
      civilizations={civilizations}
      cultureNames={
        new Map([
          [1, 'Riverfolk'],
          [2, 'Stonefolk'],
        ])
      }
      personNames={new Map([[3, 'Mira Vale']])}
      {...overrides}
    />,
  );
}

describe('CivilizationsPanel', () => {
  it('presents named settlement and civilization facts from the bounded read-only projection', () => {
    renderPanel();

    expect(screen.getByRole('heading', { name: 'Civilizations and settlements' })).toBeVisible();
    const settlement = screen.getByRole('article', { name: 'Riverhome settlement facts' });
    expect(within(settlement).getByText('Population').nextElementSibling).toHaveTextContent('24');
    expect(within(settlement).getByText('Status').nextElementSibling).toHaveTextContent('active');
    expect(within(settlement).getByText('Development').nextElementSibling).toHaveTextContent(
      'advanced city',
    );
    expect(within(settlement).getByText('Culture').nextElementSibling).toHaveTextContent(
      'Riverfolk',
    );
    expect(screen.getByText('Active residency records').nextElementSibling).toHaveTextContent('24');
    expect(screen.getByText('Historical residency records').nextElementSibling).toHaveTextContent(
      '5',
    );
    expect(screen.getByRole('list', { name: 'Riverhome active residents' })).toHaveTextContent(
      'Mira Vale (person #3) — resident since tick 0.',
    );
  });

  it('keeps inspector controls keyboard-accessible and changes only the displayed record', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.tab();
    const settlementSelector = screen.getByRole('combobox', { name: 'Inspect settlement' });
    expect(settlementSelector).toHaveFocus();
    await user.selectOptions(settlementSelector, '2');
    expect(screen.getByRole('article', { name: 'Stoneford settlement facts' })).toHaveTextContent(
      'conquered',
    );
    expect(screen.getByText('2 earlier territory changes are summarized.')).toBeVisible();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Inspect civilization' }), '2');
    const civilizationFacts = screen.getByLabelText('Stonefolk civilization facts');
    expect(within(civilizationFacts).getByText('Status').nextElementSibling).toHaveTextContent(
      'collapsed',
    );
  });

  it('spells route disruption, diplomacy, conflicts, and ruins in text without action controls', () => {
    renderPanel();

    expect(screen.getByRole('list', { name: 'Trade routes' })).toHaveTextContent(
      'Riverhome and Stoneford: disrupted; volume 7; began at tick 6000.',
    );
    expect(screen.getByRole('list', { name: 'Diplomacy' })).toHaveTextContent(
      'Riverfolk and Stonefolk: at war; score -88; changed at tick 8000.',
    );
    expect(screen.getByRole('list', { name: 'Conflicts' })).toHaveTextContent(
      'resolved; pressure 82; began at tick 8000; ended at tick 9000. Winner: Riverfolk.',
    );
    expect(screen.getByRole('list', { name: 'Ruins' })).toHaveTextContent(
      'Stoneford: conquered ruin recorded at tick 9000.',
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('provides explicit empty states for every bounded historical category', () => {
    renderPanel({
      civilizations: {
        ...civilizations,
        settlements: [],
        civilizations: [],
        residencies: [],
        activeResidencyCount: 0,
        historicalResidencyCount: 0,
        diplomacy: [],
        routes: [],
        conflicts: [],
        ruins: [],
      },
    });

    expect(screen.getByText('No settlements are available in this projection.')).toBeVisible();
    expect(screen.getByText('No civilizations are available in this projection.')).toBeVisible();
    expect(screen.getByText('No trade routes are retained in this projection.')).toBeVisible();
    expect(
      screen.getByText('No diplomatic relationships are retained in this projection.'),
    ).toBeVisible();
    expect(screen.getByText('No conflicts are retained in this projection.')).toBeVisible();
    expect(screen.getByText('No ruins are retained in this projection.')).toBeVisible();
  });
});
