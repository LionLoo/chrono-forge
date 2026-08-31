import { useState } from 'react';
import type { DevelopmentProjection, QueuedCommand } from '../protocol';
import type { InterventionKind, KnowledgeStatus } from '../simulation/development';

const INTERVENTION_KINDS = [
  'weather',
  'resource',
  'organism',
  'omen',
  'artifact',
  'protection',
  'disaster',
  'alien-signal',
] as const satisfies readonly InterventionKind[];

function formatLabel(value: string): string {
  return value.replaceAll('-', ' ');
}

function KnowledgeCount({
  knowledge,
  status,
}: {
  readonly knowledge: DevelopmentProjection['knowledge'];
  readonly status: KnowledgeStatus;
}) {
  return knowledge.filter((entry) => entry.status === status).length;
}

export interface DevelopmentPanelProps {
  /** Read-only data projected by the simulation Worker. */
  readonly development: DevelopmentProjection;
  /** The renderer or selection surface supplies the intended target tile. */
  readonly targetTileIndex: number;
  /** Queues a typed request; this component never changes authoritative state. */
  readonly onQueueIntervention: (command: QueuedCommand) => void;
  /** Disables requests while the owning Worker is unavailable. */
  readonly disabled?: boolean;
  /** Disables duplicate requests until the owner receives an outcome. */
  readonly isPending?: boolean;
}

/**
 * Optional factual M5 development inspector. Authoritative state remains in
 * the Worker; local state is limited to the deliberately opened request form.
 */
export function DevelopmentPanel({
  development,
  targetTileIndex,
  onQueueIntervention,
  disabled = false,
  isPending = false,
}: DevelopmentPanelProps) {
  const [interventionKind, setInterventionKind] = useState<InterventionKind>('weather');
  const [polarity, setPolarity] = useState<'supportive' | 'challenging'>('supportive');
  const [intensity, setIntensity] = useState('50');
  const parsedIntensity = Number(intensity);
  const validIntensity =
    Number.isInteger(parsedIntensity) && parsedIntensity >= 1 && parsedIntensity <= 100;
  const validTargetTileIndex = Number.isSafeInteger(targetTileIndex) && targetTileIndex >= 0;
  const requestsDisabled = disabled || isPending || !validIntensity || !validTargetTileIndex;

  return (
    <section className="development-panel" aria-labelledby="development-title">
      <header className="card-heading">
        <div>
          <p>Development projection</p>
          <h2 id="development-title">Research and conditions</h2>
        </div>
      </header>

      <section aria-labelledby="research-title">
        <h3 id="research-title">Research</h3>
        <dl>
          <div>
            <dt>Current focus</dt>
            <dd>
              {development.researchFocusId === null
                ? 'No research focus is currently projected.'
                : formatLabel(development.researchFocusId)}
            </dd>
          </div>
          <div>
            <dt>Known</dt>
            <dd>
              <KnowledgeCount knowledge={development.knowledge} status="known" />
            </dd>
          </div>
          <div>
            <dt>Lost</dt>
            <dd>
              <KnowledgeCount knowledge={development.knowledge} status="lost" />
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="active-crises-title">
        <h3 id="active-crises-title">Active conditions</h3>
        {development.activeCrises.length === 0 ? (
          <p>No active crises are currently projected.</p>
        ) : (
          <ul aria-label="Active crises">
            {development.activeCrises.map((crisis) => (
              <li key={crisis.id}>
                <strong>{formatLabel(crisis.kind)}</strong>
                <span>: severity {crisis.severity}; triggered by </span>
                <span>{formatLabel(crisis.triggerCondition)}</span>
                <span> at {crisis.triggerValue}.</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="development-intervention-form">
        <summary>Optional intervention</summary>
        <p>
          Queue one bounded condition request for tile {targetTileIndex}. The simulation determines
          the resulting outcome.
        </p>
        <form
          aria-label="Optional intervention"
          onSubmit={(event) => {
            event.preventDefault();
            if (requestsDisabled) return;
            onQueueIntervention({
              kind: 'intervention',
              payload: {
                interventionKind,
                intensity: parsedIntensity,
                polarity,
                targetTileIndex,
              },
            });
          }}
        >
          <fieldset disabled={disabled || isPending}>
            <label>
              Intervention kind
              <select
                aria-label="Intervention kind"
                onChange={(event) =>
                  setInterventionKind(event.currentTarget.value as InterventionKind)
                }
                value={interventionKind}
              >
                {INTERVENTION_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {formatLabel(kind)}
                  </option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend>Polarity</legend>
              <label>
                <input
                  checked={polarity === 'supportive'}
                  name="intervention-polarity"
                  onChange={() => setPolarity('supportive')}
                  type="radio"
                  value="supportive"
                />
                Supportive
              </label>
              <label>
                <input
                  checked={polarity === 'challenging'}
                  name="intervention-polarity"
                  onChange={() => setPolarity('challenging')}
                  type="radio"
                  value="challenging"
                />
                Challenging
              </label>
            </fieldset>
            <label>
              Intensity
              <input
                aria-label="Intensity"
                max={100}
                min={1}
                onChange={(event) => setIntensity(event.currentTarget.value)}
                step={1}
                type="number"
                value={intensity}
              />
            </label>
            <p>Target tile: {targetTileIndex}</p>
            {!validIntensity ? (
              <p role="status">Intensity must be an integer from 1 through 100.</p>
            ) : null}
            {!validTargetTileIndex ? (
              <p role="status">A non-negative integer target tile is required.</p>
            ) : null}
            {isPending ? <p role="status">Intervention request is pending.</p> : null}
            {disabled ? (
              <p role="status">Intervention requests are currently unavailable.</p>
            ) : null}
            <button disabled={requestsDisabled} type="submit">
              Queue intervention
            </button>
          </fieldset>
        </form>
      </details>
    </section>
  );
}
