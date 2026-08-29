import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { SocietyPanel, type SocietyPanelProps } from '../../src/ui/SocietyPanel';
import type { SocietyRelationshipProjection } from '../../src/protocol';

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
    parentIds: [],
    guardianIds: [],
    childIds: [2],
    siblingIds: [],
    extendedKinIds: [],
    childArrival: null,
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
    parentIds: [1],
    guardianIds: [],
    childIds: [],
    siblingIds: [],
    extendedKinIds: [],
    childArrival: {
      tick: 1_000,
      eventId: 51,
      eligibilityEventId: 52,
      policy: 'pair-bond',
      householdId: 1,
      guardianIds: [1, 3],
      partnerRelationshipId: 7,
      partnerKindAtArrival: 'long-term-partner',
      minimumPartnerTrustAtArrival: 74,
      minimumPartnerCommitmentAtArrival: 82,
      selectionScoreAtArrival: 176,
    },
    biography: [{ eventId: 52, tick: 1_100, summary: 'Recorded a route delivery.' }],
  },
  {
    id: 3,
    name: 'Cara',
    ageYears: 30,
    lifeStage: 'Adult',
    status: 'Living',
    role: 'Builder',
    cultureName: 'Riverfolk',
    householdName: 'Willow household',
    parentIds: [],
    guardianIds: [],
    childIds: [],
    siblingIds: [],
    extendedKinIds: [],
    childArrival: null,
    biography: [],
  },
];

const relationships: readonly SocietyRelationshipProjection[] = [
  {
    id: 'family:parent:1:2',
    category: 'family',
    status: 'family',
    kind: 'parent',
    firstPersonId: 1,
    secondPersonId: 2,
    firstRole: 'parent',
    secondRole: 'child',
    trend: 'improving',
    formedTick: 100,
    changedTick: 1_000,
    endedTick: null,
    firstToSecond: { affinity: 92, trust: 88, closeness: 76, commitment: 80, grievance: 4 },
    secondToFirst: { affinity: 86, trust: 84, closeness: 70, commitment: 0, grievance: 2 },
    sharedEventTotal: 1,
    sharedEvents: [
      { eventId: 41, tick: 900, summary: 'Recorded a grain exchange.', importance: 2 },
    ],
  },
  {
    id: 'social:7',
    category: 'social',
    status: 'active',
    kind: 'close-friend',
    firstPersonId: 2,
    secondPersonId: 3,
    firstRole: 'peer',
    secondRole: 'peer',
    trend: 'improving',
    formedTick: 600,
    changedTick: 1_100,
    endedTick: null,
    firstToSecond: { affinity: 90, trust: 87, closeness: 83, commitment: 14, grievance: 1 },
    secondToFirst: { affinity: 89, trust: 85, closeness: 80, commitment: 12, grievance: 0 },
    sharedEventTotal: 1,
    sharedEvents: [
      { eventId: 52, tick: 1_100, summary: 'Recorded a route delivery.', importance: 3 },
    ],
  },
  {
    id: 'social:8',
    category: 'social',
    status: 'archived',
    kind: 'long-term-partner',
    firstPersonId: 1,
    secondPersonId: 3,
    firstRole: 'partner',
    secondRole: 'partner',
    trend: 'deteriorating',
    formedTick: 300,
    changedTick: 800,
    endedTick: 900,
    firstToSecond: { affinity: 30, trust: 28, closeness: 44, commitment: 30, grievance: 68 },
    secondToFirst: { affinity: 24, trust: 27, closeness: 39, commitment: 22, grievance: 72 },
    sharedEventTotal: 0,
    sharedEvents: [],
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
    familyPolicy: 'pair-bond',
  },
];

function renderPanel(overrides: Partial<SocietyPanelProps> = {}) {
  const onTimelinePageRequest =
    overrides.onTimelinePageRequest ?? vi.fn<(offset: number) => void>();
  const onRelationshipPageRequest =
    overrides.onRelationshipPageRequest ?? vi.fn<(personId: number, offset: number) => void>();
  const onRelationshipEventPageRequest =
    overrides.onRelationshipEventPageRequest ??
    vi.fn<(personId: number, relationshipId: string, offset: number) => void>();
  const result = render(
    <SocietyPanel
      cultures={cultures}
      dashboard={dashboard}
      onRelationshipEventPageRequest={onRelationshipEventPageRequest}
      onRelationshipPageRequest={onRelationshipPageRequest}
      onTimelinePageRequest={onTimelinePageRequest}
      people={people}
      relationshipEventPage={{
        personId: 2,
        relationshipId: 'family:parent:1:2',
        offset: 0,
        total: 1,
        events: relationships[0]!.sharedEvents,
      }}
      relationshipPage={{ personId: 2, offset: 0, total: relationships.length, relationships }}
      timeline={Array.from({ length: 8 }, (_, index) => ({
        id: index + 1,
        tick: (index + 1) * 100,
        summary: `Recorded event ${index + 1}.`,
      }))}
      timelineOffset={0}
      timelineTotal={9}
      {...overrides}
    />,
  );
  return {
    ...result,
    onTimelinePageRequest,
    onRelationshipPageRequest,
    onRelationshipEventPageRequest,
  };
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
    expect(screen.getByRole('region', { name: 'Family arrival evidence' })).toHaveTextContent(
      'pair bond',
    );
    expect(screen.getByText('Eligibility event').nextElementSibling).toHaveTextContent('#52');
  });

  it('shows optional family and social links, then exposes only projected relationship facts', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Inspect person' }), '2');
    expect(screen.getByRole('heading', { name: 'Parents' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Household members' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Close friends' })).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: 'Parents' })).getByText('Ari · parent'),
    ).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: 'Close friends' })).getByText(
        'Cara · close friend',
      ),
    ).toBeVisible();

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Inspect relationship' }),
      'social:7',
    );
    expect(screen.getByRole('heading', { name: 'Relationship detail' })).toBeVisible();
    expect(screen.getByText('close friend')).toBeVisible();
    expect(screen.getByText('Bea → Cara trust').nextElementSibling).toHaveTextContent('87');
    const detail = screen.getByRole('article', { name: 'Relationship detail' });
    expect(within(detail).getByText('Event #52 · tick 1100:')).toBeVisible();
    expect(within(detail).getByText('Recorded a route delivery.')).toBeVisible();
  });

  it('keeps timeline input order and requests bounded Worker-backed pages', async () => {
    const user = userEvent.setup();
    const { onTimelinePageRequest } = renderPanel();

    const timeline = screen.getByRole('heading', { name: 'Timeline' }).parentElement;
    if (timeline === null) throw new Error('Expected timeline section');
    expect(within(timeline).getByText('Recorded event 1.')).toBeVisible();
    expect(within(timeline).getByText('Recorded event 8.')).toBeVisible();
    expect(within(timeline).queryByText('Recorded event 9.')).not.toBeInTheDocument();
    expect(screen.getByText('Page 1 of 2')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(onTimelinePageRequest).toHaveBeenCalledWith(8);
  });

  it('keeps relationship navigation keyboard-operable and requests the next bounded page', async () => {
    const user = userEvent.setup();
    const { onRelationshipPageRequest } = renderPanel({
      relationshipPage: { personId: 1, offset: 0, total: 9, relationships },
    });

    const next = screen.getByRole('button', { name: 'Next relationships' });
    expect(next).toBeEnabled();
    next.focus();
    await user.keyboard('{Enter}');
    expect(onRelationshipPageRequest).toHaveBeenCalledWith(1, 8);
  });

  it('keeps every retained shared event reachable through keyboard-operable paging', async () => {
    const user = userEvent.setup();
    const sharedEvents = Array.from({ length: 8 }, (_, index) => ({
      eventId: 100 + index,
      tick: 2_000 + index,
      summary: `Shared event ${index + 1}.`,
      importance: 2,
    }));
    const pagedRelationship = {
      ...relationships[1]!,
      sharedEventTotal: 16,
      sharedEvents,
    };
    const { onRelationshipEventPageRequest } = renderPanel({
      relationshipPage: {
        personId: 2,
        offset: 0,
        total: 1,
        relationships: [pagedRelationship],
      },
      relationshipEventPage: {
        personId: 2,
        relationshipId: pagedRelationship.id,
        offset: 0,
        total: 16,
        events: sharedEvents,
      },
    });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Inspect person' }), '2');
    const next = screen.getByRole('button', { name: 'Next shared events' });
    expect(screen.getByText('Shared events page 1 of 2')).toBeVisible();
    next.focus();
    await user.keyboard('{Enter}');
    expect(onRelationshipEventPageRequest).toHaveBeenCalledWith(2, pagedRelationship.id, 8);
  });

  it('reports explicit empty states and disables pagination when history is absent', () => {
    renderPanel({
      cultures: [],
      people: [],
      relationshipPage: { personId: null, offset: 0, total: 0, relationships: [] },
      timeline: [],
      timelineTotal: 0,
    });

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
    renderPanel({
      people: [{ ...people[0]!, biography: [] }],
      relationshipPage: { personId: 1, offset: 0, total: 0, relationships: [] },
    });

    expect(screen.getByText('No source events are available for this biography.')).toBeVisible();
  });

  it('keeps family policy available on demand rather than in the default culture fact grid', async () => {
    const user = userEvent.setup();
    renderPanel();

    const policy = screen.getByText('Family policy').parentElement;
    if (!(policy instanceof HTMLDetailsElement)) throw new Error('Expected family policy details.');
    expect(policy).not.toHaveAttribute('open');
    await user.click(screen.getByText('Family policy'));
    expect(policy).toHaveAttribute('open');
  });
});
