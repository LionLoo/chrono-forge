import type {
  SpaceCargoEndpointProjection,
  SpaceProjection,
  SpaceResourceProjection,
} from '../protocol';

function label(value: string): string {
  return value.replaceAll('-', ' ');
}

function resources(stock: SpaceResourceProjection): string {
  return `food ${stock.food}, water ${stock.water}, timber ${stock.timber}, stone ${stock.stone}, metal ${stock.metal}`;
}

function endpoint(value: SpaceCargoEndpointProjection): string {
  if (value.kind === 'settlement') return `settlement ${value.settlementId}`;
  if (value.kind === 'colony') return `colony ${value.colonyId}`;
  return `alien civilization ${value.alienId}`;
}

export function SpacePanel({ space }: { readonly space: SpaceProjection }) {
  const activeMissions = space.missions.filter((mission) => mission.status === 'active');
  const pendingCargo = space.cargoTransfers.filter((cargo) => cargo.status === 'active');
  const pendingMessages = space.communications.filter(
    (communication) => communication.status === 'pending',
  );
  const activeColonies = space.colonies.filter((colony) => colony.status === 'active');

  return (
    <section className="space-panel" aria-labelledby="space-title">
      <header className="card-heading">
        <div>
          <p>Planetary projection</p>
          <h2 id="space-title">The wider system</h2>
        </div>
        <span>{space.programs.length === 0 ? 'Pre-spaceflight' : 'Autonomous program active'}</span>
      </header>

      <section aria-labelledby="space-status-title">
        <h3 id="space-status-title">Space-age status</h3>
        <dl className="space-facts">
          <div>
            <dt>Programs</dt>
            <dd>{space.programs.length}</dd>
          </div>
          <div>
            <dt>Spacecraft</dt>
            <dd>{space.spacecraft.length}</dd>
          </div>
          <div>
            <dt>Active missions</dt>
            <dd>{activeMissions.length}</dd>
          </div>
          <div>
            <dt>Colonies</dt>
            <dd>{activeColonies.length}</dd>
          </div>
          <div>
            <dt>Off-world population</dt>
            <dd>{space.offworldPopulation}</dd>
          </div>
          <div>
            <dt>Contacted civilizations</dt>
            <dd>{space.aliens.length}</dd>
          </div>
        </dl>
        {space.programs.length === 0 ? (
          <p>
            No civilization has yet assembled the knowledge, institutions, infrastructure, and
            inter-settlement exchange required to begin a space program.
          </p>
        ) : (
          <ul className="space-list" aria-label="Space programs">
            {space.programs.map((program) => (
              <li key={program.id}>
                <strong>Civilization {program.civilizationId}</strong> reached{' '}
                {label(program.stage)} from settlement {program.settlementId}; transport capacity{' '}
                {program.planetaryTransportCapacity}, launch capacity {program.launchCapacity}.
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="celestial-system-title">
        <h3 id="celestial-system-title">Known celestial system</h3>
        <ul className="space-body-list">
          {space.bodies.map((body) => (
            <li key={body.id}>
              <span aria-hidden="true" className={`space-body-mark space-body-${body.kind}`} />
              <div>
                <strong>{body.name}</strong>
                <span>
                  {label(body.kind)} · distance {body.distance} ·{' '}
                  {body.habitable ? 'habitable' : 'inhospitable'}
                </span>
                <small>Remaining deposits: {resources(body.remainingDeposit)}.</small>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="mission-title">
        <h3 id="mission-title">Missions and colonies</h3>
        {space.missions.length === 0 ? (
          <p>No missions have launched.</p>
        ) : (
          <ul className="space-list" aria-label="Space missions">
            {space.missions.map((mission) => (
              <li key={mission.id}>
                <strong>{label(mission.kind)} mission</strong> #{mission.id}: body{' '}
                {mission.originBodyId} to {mission.destinationBodyId}, {label(mission.status)}; due
                tick {mission.dueTick}; passengers {mission.passengerCount}; cargo{' '}
                {resources(mission.cargo)}.
              </li>
            ))}
          </ul>
        )}
        {space.colonies.length === 0 ? null : (
          <ul className="space-list" aria-label="Space colonies">
            {space.colonies.map((colony) => (
              <li key={colony.id}>
                <strong>Colony {colony.id}</strong> on body {colony.bodyId}: {colony.residentCount}{' '}
                residents, culture divergence {colony.cultureDivergence}, {label(colony.status)};
                stores {resources(colony.stores)}.
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="space-contact-title">
        <h3 id="space-contact-title">Contact and delayed exchange</h3>
        {space.aliens.length === 0 ? (
          <p>No alien civilization has been contacted.</p>
        ) : (
          <ul className="space-list" aria-label="Alien civilizations">
            {space.aliens.map((alien) => {
              const relation = space.relations.find((entry) => entry.alienId === alien.id);
              return (
                <li key={alien.id}>
                  <strong>Alien civilization {alien.id}</strong> on body {alien.homeBodyId};
                  observed {label(alien.trait)} behavior
                  {relation === undefined
                    ? '.'
                    : `; ${label(relation.status)} relation, trust ${relation.trust}, tension ${relation.tension}, exchanges ${relation.exchangeCount}, conflicts ${relation.conflictCount}.`}
                </li>
              );
            })}
          </ul>
        )}
        <details>
          <summary>
            Logistics: {pendingCargo.length} cargo and {pendingMessages.length} communications in
            transit
          </summary>
          {space.cargoTransfers.length === 0 ? (
            <p>No interworld cargo has been recorded.</p>
          ) : (
            <ul className="space-list" aria-label="Interworld cargo">
              {space.cargoTransfers.map((cargo) => (
                <li key={cargo.id}>
                  Cargo #{cargo.id}: {endpoint(cargo.origin)} to {endpoint(cargo.destination)},{' '}
                  {label(cargo.status)}, due tick {cargo.dueTick}; {resources(cargo.cargo)}.
                </li>
              ))}
            </ul>
          )}
          {space.communications.length === 0 ? null : (
            <ul className="space-list" aria-label="Interworld communications">
              {space.communications.map((communication) => (
                <li key={communication.id}>
                  {label(communication.topic)} message #{communication.id}: body{' '}
                  {communication.originBodyId} to {communication.destinationBodyId},{' '}
                  {label(communication.status)}, due tick {communication.dueTick}.
                </li>
              ))}
            </ul>
          )}
        </details>
      </section>
    </section>
  );
}
