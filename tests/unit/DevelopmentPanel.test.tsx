import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { DevelopmentPanel, type DevelopmentPanelProps } from '../../src/ui/DevelopmentPanel';

const development: DevelopmentPanelProps['development'] = {
  researchFocusId: 'water-management',
  knowledge: [
    { id: 'foraging-lore', status: 'known', progress: 100 },
    { id: 'shelter-craft', status: 'known', progress: 100 },
    { id: 'water-lore', status: 'lost', progress: 0 },
    { id: 'water-management', status: 'unknown', progress: 45 },
  ],
  conditions: {
    droughtPressure: 0,
    floodPressure: 0,
    firePressure: 0,
    stormPressure: 0,
    seismicPressure: 0,
    diseasePressure: 0,
    faminePressure: 0,
    resourcePressure: 0,
    politicalPressure: 0,
    accidentPressure: 0,
    meteorPressure: 0,
    protection: 0,
  },
  activeCrises: [
    {
      id: 4,
      kind: 'drought',
      severity: 73,
      startedTick: 300,
      triggerCondition: 'droughtPressure',
      triggerValue: 91,
    },
  ],
  recoveredCrisisCount: 2,
  operationCount: 22,
};

function renderPanel(overrides: Partial<DevelopmentPanelProps> = {}) {
  const onQueueIntervention =
    overrides.onQueueIntervention ??
    vi.fn<(command: Parameters<DevelopmentPanelProps['onQueueIntervention']>[0]) => void>();
  const result = render(
    <DevelopmentPanel
      development={development}
      onQueueIntervention={onQueueIntervention}
      targetTileIndex={12}
      {...overrides}
    />,
  );
  return { ...result, onQueueIntervention };
}

describe('DevelopmentPanel', () => {
  it('keeps optional intervention controls collapsed by default', () => {
    renderPanel();

    const optionalIntervention = screen.getByText('Optional intervention').parentElement;
    if (!(optionalIntervention instanceof HTMLDetailsElement))
      throw new Error('Expected optional intervention details.');
    expect(optionalIntervention).not.toHaveAttribute('open');
  });

  it('presents factual research and active crisis values as text', () => {
    renderPanel();

    expect(screen.getByRole('heading', { name: 'Research' })).toBeVisible();
    expect(screen.getByText('Current focus').nextElementSibling).toHaveTextContent(
      'water management',
    );
    expect(screen.getByText('Known').nextElementSibling).toHaveTextContent('2');
    expect(screen.getByText('Lost').nextElementSibling).toHaveTextContent('1');
    const crises = screen.getByRole('list', { name: 'Active crises' });
    expect(within(crises).getByText('drought')).toBeVisible();
    expect(crises).toHaveTextContent('severity 73; triggered by droughtPressure at 91.');
  });

  it('queues the selected typed request through keyboard-operated native controls', async () => {
    const user = userEvent.setup();
    const { onQueueIntervention } = renderPanel();

    await user.click(screen.getByText('Optional intervention'));
    const kind = screen.getByRole('combobox', { name: 'Intervention kind' });
    kind.focus();
    await user.selectOptions(kind, 'artifact');
    await user.click(screen.getByRole('radio', { name: 'Challenging' }));
    await user.clear(screen.getByRole('spinbutton', { name: 'Intensity' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Intensity' }), '77');
    const submit = screen.getByRole('button', { name: 'Queue intervention' });
    submit.focus();
    await user.keyboard('{Enter}');

    expect(onQueueIntervention).toHaveBeenCalledWith({
      kind: 'intervention',
      payload: {
        interventionKind: 'artifact',
        intensity: 77,
        polarity: 'challenging',
        targetTileIndex: 12,
      },
    });
  });

  it('exposes exactly every closed intervention kind', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByText('Optional intervention'));
    expect(
      within(screen.getByRole('combobox', { name: 'Intervention kind' }))
        .getAllByRole('option')
        .map((option) => option.getAttribute('value')),
    ).toEqual([
      'weather',
      'resource',
      'organism',
      'omen',
      'artifact',
      'protection',
      'disaster',
      'alien-signal',
    ]);
  });

  it.each([
    'weather',
    'resource',
    'organism',
    'omen',
    'artifact',
    'protection',
    'disaster',
    'alien-signal',
  ] as const)('queues the closed %s intervention kind', async (interventionKind) => {
    const user = userEvent.setup();
    const { onQueueIntervention } = renderPanel();

    await user.click(screen.getByText('Optional intervention'));
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Intervention kind' }),
      interventionKind,
    );
    await user.click(screen.getByRole('button', { name: 'Queue intervention' }));

    expect(onQueueIntervention).toHaveBeenCalledWith({
      kind: 'intervention',
      payload: {
        interventionKind,
        intensity: 50,
        polarity: 'supportive',
        targetTileIndex: 12,
      },
    });
  });

  it.each([
    ['disabled', { disabled: true }],
    ['pending', { isPending: true }],
  ] as const)('does not queue a request while %s', async (_label, props) => {
    const user = userEvent.setup();
    const { onQueueIntervention } = renderPanel(props);

    await user.click(screen.getByText('Optional intervention'));
    expect(screen.getByRole('combobox', { name: 'Intervention kind' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Queue intervention' })).toBeDisabled();
    expect(onQueueIntervention).not.toHaveBeenCalled();
  });
});
