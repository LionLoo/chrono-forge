import { useState } from 'react';

import type { CivilizationsProjection } from '../protocol';

export interface CivilizationsPanelProps {
  /** Bounded read-only M6 records projected by the authoritative Worker. */
  readonly civilizations: CivilizationsProjection;
  /** Names from the separately projected culture registry; never synthesized by this view. */
  readonly cultureNames: ReadonlyMap<number, string>;
  /** Names from the bounded Society projection; IDs remain the stable cross-panel identity. */
  readonly personNames: ReadonlyMap<number, string>;
}

function formatLabel(value: string): string {
  return value.replaceAll('-', ' ');
}

function recordName(names: ReadonlyMap<number, string>, id: number, kind: string): string {
  return names.get(id) ?? `${kind} #${id}`;
}

function settlementName(names: ReadonlyMap<number, string>, id: number): string {
  return id === 0 ? 'Unclaimed territory' : recordName(names, id, 'Settlement');
}

function SettlementFacts({
  settlement,
  civilizationNames,
  settlementNames,
  cultureNames,
}: {
  readonly settlement: CivilizationsProjection['settlements'][number];
  readonly civilizationNames: ReadonlyMap<number, string>;
  readonly settlementNames: ReadonlyMap<number, string>;
  readonly cultureNames: ReadonlyMap<number, string>;
}) {
  return (
    <>
      <dl className="civilization-facts">
        <div>
          <dt>Civilization</dt>
          <dd>{recordName(civilizationNames, settlement.civilizationId, 'Civilization')}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{formatLabel(settlement.status)}</dd>
        </div>
        <div>
          <dt>Population</dt>
          <dd>{settlement.population}</dd>
        </div>
        <div>
          <dt>Stability</dt>
          <dd>{settlement.stability}</dd>
        </div>
        <div>
          <dt>Development</dt>
          <dd>{formatLabel(settlement.developmentStage)}</dd>
        </div>
        <div>
          <dt>Development changed</dt>
          <dd>Tick {settlement.developmentStageChangedTick}</dd>
        </div>
        <div>
          <dt>Development record</dt>
          <dd>{formatLabel(settlement.developmentStageProvenance)}</dd>
        </div>
        <div>
          <dt>Culture</dt>
          <dd>{recordName(cultureNames, settlement.cultureId, 'Culture')}</dd>
        </div>
        <div>
          <dt>Center tile</dt>
          <dd>{settlement.centerTileIndex}</dd>
        </div>
        <div>
          <dt>Founded</dt>
          <dd>Tick {settlement.foundedTick}</dd>
        </div>
        <div>
          <dt>Record origin</dt>
          <dd>{formatLabel(settlement.provenance)}</dd>
        </div>
      </dl>
      <h4>Community reserves</h4>
      <dl className="civilization-facts">
        {Object.entries(settlement.reserves).map(([resource, amount]) => (
          <div key={resource}>
            <dt>{formatLabel(resource)}</dt>
            <dd>{amount}</dd>
          </div>
        ))}
      </dl>
      <h4>Territory record</h4>
      {settlement.territoryHistory.length === 0 ? (
        <p>No territory changes are retained for this settlement.</p>
      ) : (
        <ol className="civilization-list">
          {settlement.territoryHistory.map((entry) => (
            <li key={entry.id}>
              Tick {entry.tick}: tile {entry.tileIndex} moved from{' '}
              {settlementName(settlementNames, entry.previousSettlementId)} to{' '}
              {settlementName(settlementNames, entry.nextSettlementId)}.
            </li>
          ))}
        </ol>
      )}
      {settlement.territoryHistorySummaryCount === 0 ? null : (
        <p>{settlement.territoryHistorySummaryCount} earlier territory changes are summarized.</p>
      )}
    </>
  );
}

/**
 * Deliberate read-only M6 inspector. Local state only selects bounded Worker
 * records; it never requests or changes diplomacy, conflict, or settlement authority.
 */
export function CivilizationsPanel({
  civilizations,
  cultureNames,
  personNames,
}: CivilizationsPanelProps) {
  const [selectedSettlementId, setSelectedSettlementId] = useState<number | null>(null);
  const [selectedCivilizationId, setSelectedCivilizationId] = useState<number | null>(null);
  const settlementNames = new Map(
    civilizations.settlements.map((settlement) => [settlement.id, settlement.name]),
  );
  const civilizationNames = new Map(
    civilizations.civilizations.map((civilization) => [civilization.id, civilization.name]),
  );
  const selectedSettlement =
    civilizations.settlements.find((settlement) => settlement.id === selectedSettlementId) ??
    civilizations.settlements[0] ??
    null;
  const selectedCivilization =
    civilizations.civilizations.find(
      (civilization) => civilization.id === selectedCivilizationId,
    ) ??
    civilizations.civilizations[0] ??
    null;

  return (
    <section className="civilizations-panel" aria-labelledby="civilizations-title">
      <header className="card-heading">
        <div>
          <p>Read-only annual projection</p>
          <h2 id="civilizations-title">Civilizations and settlements</h2>
        </div>
      </header>

      <section aria-labelledby="settlement-inspector-title">
        <h3 id="settlement-inspector-title">Settlement inspector</h3>
        {selectedSettlement === null ? (
          <p>No settlements are available in this projection.</p>
        ) : (
          <>
            <label>
              Inspect settlement
              <select
                aria-label="Inspect settlement"
                onChange={(event) => setSelectedSettlementId(Number(event.target.value))}
                value={selectedSettlement.id}
              >
                {civilizations.settlements.map((settlement) => (
                  <option key={settlement.id} value={settlement.id}>
                    {settlement.name}
                  </option>
                ))}
              </select>
            </label>
            <article
              aria-label={`${selectedSettlement.name} settlement facts`}
              className="civilization-detail"
            >
              <h4>{selectedSettlement.name}</h4>
              <SettlementFacts
                civilizationNames={civilizationNames}
                cultureNames={cultureNames}
                settlementNames={settlementNames}
                settlement={selectedSettlement}
              />
            </article>
          </>
        )}
      </section>

      <section aria-labelledby="civilization-inspector-title">
        <h3 id="civilization-inspector-title">Civilization inspector</h3>
        {selectedCivilization === null ? (
          <p>No civilizations are available in this projection.</p>
        ) : (
          <>
            <label>
              Inspect civilization
              <select
                aria-label="Inspect civilization"
                onChange={(event) => setSelectedCivilizationId(Number(event.target.value))}
                value={selectedCivilization.id}
              >
                {civilizations.civilizations.map((civilization) => (
                  <option key={civilization.id} value={civilization.id}>
                    {civilization.name}
                  </option>
                ))}
              </select>
            </label>
            <dl
              className="civilization-facts"
              aria-label={`${selectedCivilization.name} civilization facts`}
            >
              <div>
                <dt>Status</dt>
                <dd>{formatLabel(selectedCivilization.status)}</dd>
              </div>
              <div>
                <dt>Culture</dt>
                <dd>{recordName(cultureNames, selectedCivilization.cultureId, 'Culture')}</dd>
              </div>
              <div>
                <dt>Founding settlement</dt>
                <dd>
                  {recordName(
                    settlementNames,
                    selectedCivilization.foundingSettlementId,
                    'Settlement',
                  )}
                </dd>
              </div>
              <div>
                <dt>Member settlements</dt>
                <dd>{selectedCivilization.memberSettlementIds.length}</dd>
              </div>
              <div>
                <dt>Founded</dt>
                <dd>Tick {selectedCivilization.foundedTick}</dd>
              </div>
              <div>
                <dt>Record origin</dt>
                <dd>{formatLabel(selectedCivilization.provenance)}</dd>
              </div>
            </dl>
          </>
        )}
      </section>

      <section aria-labelledby="residency-title">
        <h3 id="residency-title">Residency and migration</h3>
        <dl className="civilization-facts">
          <div>
            <dt>Active residency records</dt>
            <dd>{civilizations.activeResidencyCount}</dd>
          </div>
          <div>
            <dt>Active records shown</dt>
            <dd>{civilizations.residencies.length}</dd>
          </div>
          <div>
            <dt>Historical residency records</dt>
            <dd>{civilizations.historicalResidencyCount}</dd>
          </div>
          <div>
            <dt>Annual operations</dt>
            <dd>{civilizations.operationCount}</dd>
          </div>
        </dl>
        {selectedSettlement === null ? null : (
          <>
            <h4>Active residents in {selectedSettlement.name}</h4>
            {civilizations.residencies.filter(
              (residency) => residency.settlementId === selectedSettlement.id,
            ).length === 0 ? (
              <p>No named people or households are included for this settlement.</p>
            ) : (
              <ul
                aria-label={`${selectedSettlement.name} active residents`}
                className="civilization-list"
              >
                {civilizations.residencies
                  .filter((residency) => residency.settlementId === selectedSettlement.id)
                  .map((residency) => (
                    <li key={residency.id}>
                      {residency.subjectKind === 'person'
                        ? `${recordName(personNames, residency.subjectId, 'Person')} (person #${residency.subjectId})`
                        : `Household #${residency.subjectId}`}{' '}
                      — resident since tick {residency.startedTick}.
                    </li>
                  ))}
              </ul>
            )}
            {civilizations.activeResidencyCount > civilizations.residencies.length ? (
              <p>
                This bounded view omits{' '}
                {civilizations.activeResidencyCount - civilizations.residencies.length} additional
                active residency records.
              </p>
            ) : null}
          </>
        )}
      </section>

      <section aria-labelledby="routes-title">
        <h3 id="routes-title">Trade routes</h3>
        {civilizations.routes.length === 0 ? (
          <p>No trade routes are retained in this projection.</p>
        ) : (
          <ul aria-label="Trade routes" className="civilization-list">
            {civilizations.routes.map((route) => (
              <li key={route.id}>
                {recordName(settlementNames, route.firstSettlementId, 'Settlement')} and{' '}
                {recordName(settlementNames, route.secondSettlementId, 'Settlement')}:{' '}
                {formatLabel(route.status)}; volume {route.volume}; began at tick{' '}
                {route.startedTick}
                {route.endedTick === null ? '.' : `; ended at tick ${route.endedTick}.`}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="diplomacy-title">
        <h3 id="diplomacy-title">Diplomacy</h3>
        {civilizations.diplomacy.length === 0 ? (
          <p>No diplomatic relationships are retained in this projection.</p>
        ) : (
          <ul aria-label="Diplomacy" className="civilization-list">
            {civilizations.diplomacy.map((relation) => (
              <li key={relation.id}>
                {recordName(civilizationNames, relation.firstCivilizationId, 'Civilization')} and{' '}
                {recordName(civilizationNames, relation.secondCivilizationId, 'Civilization')}:{' '}
                {formatLabel(relation.status)}; score {relation.score}; changed at tick{' '}
                {relation.changedTick}.
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="conflicts-title">
        <h3 id="conflicts-title">Conflicts</h3>
        {civilizations.conflicts.length === 0 ? (
          <p>No conflicts are retained in this projection.</p>
        ) : (
          <ul aria-label="Conflicts" className="civilization-list">
            {civilizations.conflicts.map((conflict) => (
              <li key={conflict.id}>
                {recordName(civilizationNames, conflict.attackerCivilizationId, 'Civilization')} and{' '}
                {recordName(civilizationNames, conflict.defenderCivilizationId, 'Civilization')}:{' '}
                {formatLabel(conflict.status)}; pressure {conflict.pressure}; began at tick{' '}
                {conflict.startedTick}
                {conflict.endedTick === null ? '.' : `; ended at tick ${conflict.endedTick}.`}
                {conflict.winnerCivilizationId === null
                  ? ''
                  : ` Winner: ${recordName(civilizationNames, conflict.winnerCivilizationId, 'Civilization')}.`}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="ruins-title">
        <h3 id="ruins-title">Ruins</h3>
        {civilizations.ruins.length === 0 ? (
          <p>No ruins are retained in this projection.</p>
        ) : (
          <ul aria-label="Ruins" className="civilization-list">
            {civilizations.ruins.map((ruin) => (
              <li key={ruin.id}>
                {recordName(settlementNames, ruin.settlementId, 'Settlement')}:{' '}
                {formatLabel(ruin.cause)} ruin recorded at tick {ruin.createdTick}.
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
