import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SocietyPanel, type SocietyPanelProps } from '../../src/ui/SocietyPanel';

const dashboard: SocietyPanelProps['dashboard'] = {
  year: 12,
  population: 24,
  households: 6,
  meals: 120,
  tools: 15,
  exchangeVolume: 32,
  transportDemand: 9,
  scarcity: 18,
  stability: 74,
  inequality: 22,
  government: 'Council',
  leaderName: 'Ari',
};

const people: SocietyPanelProps['people'] = [
  {
    id: 1,
    name: 'Ari',
    ageYears: 31,
    lifeStage: 'Adult',
    status: 'Living',
    role: 'Miller',
    cultureName: 'Riverfolk',
    householdName: 'Willow household',
    biography: [{ eventId: 41, tick: 900, summary: 'Recorded a grain exchange.' }],
  },
  {
    id: 2,
    name: 'Bea',
    ageYears: 18,
    lifeStage: 'Adult',
    status: 'Living',
    role: 'Carrier',
    cultureName: 'Riverfolk',
    householdName: 'Willow household',
    biography: [{ eventId: 52, tick: 1_100, summary: 'Recorded a route delivery.' }],
  },
];

const cultures: SocietyPanelProps['cultures'] = [
  {
    id: 1,
    name: 'Riverfolk',
    preference: 'Shared granaries',
    belief: 'River stewardship',
    tradition: 'Spring exchange',
    architectureStyle: 'Timber halls',
  },
];

function renderPanel(overrides: Partial<SocietyPanelProps> = {}) {
  return render(
    <SocietyPanel
      cultures={cultures}
      dashboard={dashboard}
      people={people}
      timeline={Array.from({ length: 9 }, (_, index) => ({
        id: index + 1,
        tick: (index + 1) * 100,
        summary: `Recorded event ${index + 1}.`,
      }))}
      {...overrides}
    />,
  );
}

describe('SocietyPanel', () => {
  it('exposes dashboard and culture fields as read-only semantic facts', () => {
    renderPanel();

    expect(screen.getByRole('heading', { name: 'Settlement dashboard' })).toBeVisible();
    expect(screen.getByText('Year 12')).toBeVisible();
    expect(screen.getByText('Population').nextElementSibling).toHaveTextContent('24');
    expect(screen.getByText('Exchange volume').nextElementSibling).toHaveTextContent('32');
    expect(screen.getByText('Government').nextElementSibling).toHaveTextContent('Council');
    expect(screen.getByRole('heading', { name: 'Riverfolk' })).toBeVisible();
    expect(screen.getByText('Architecture').nextElementSibling).toHaveTextContent('Timber halls');
  });

  it('supports keyboard-reachable native person selection and source-grounded biographies', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.tab();
    const selector = screen.getByRole('combobox', { name: 'Inspect person' });
    expect(selector).toHaveFocus();
    await user.selectOptions(selector, '2');

    expect(screen.getByRole('heading', { name: 'Bea' })).toBeVisible();
    expect(screen.getByText('Event #52 · tick 1100:')).toBeVisible();
    expect(screen.getByText('Recorded a route delivery.')).toBeVisible();
    expect(screen.queryByText('Event #41 · tick 900:')).not.toBeInTheDocument();
  });

  it('keeps timeline input order and paginates eight entries at a time', async () => {
    const user = userEvent.setup();
    renderPanel();

    const timeline = screen.getByRole('heading', { name: 'Timeline' }).parentElement;
    if (timeline === null) throw new Error('Expected timeline section');
    expect(within(timeline).getByText('Recorded event 1.')).toBeVisible();
    expect(within(timeline).getByText('Recorded event 8.')).toBeVisible();
    expect(within(timeline).queryByText('Recorded event 9.')).not.toBeInTheDocument();
    expect(screen.getByText('Page 1 of 2')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(within(timeline).getByText('Recorded event 9.')).toBeVisible();
    expect(screen.getByText('Page 2 of 2')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('reports explicit empty states and disables pagination when history is absent', () => {
    renderPanel({ cultures: [], people: [], timeline: [] });

    expect(screen.getByText('No people are available in this projection.')).toBeVisible();
    expect(screen.getByText('No cultures are available in this projection.')).toBeVisible();
    expect(
      screen.getByText('No historical events are available in this projection.'),
    ).toBeVisible();
    expect(screen.queryByRole('combobox', { name: 'Inspect person' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Previous' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
  });

  it('shows an explicit empty biography when selected factual sources are absent', () => {
    renderPanel({ people: [{ ...people[0]!, biography: [] }] });

    expect(screen.getByText('No source events are available for this biography.')).toBeVisible();
  });
});
