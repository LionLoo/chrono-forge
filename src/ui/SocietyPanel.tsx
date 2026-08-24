import { useState } from 'react';

const TIMELINE_PAGE_SIZE = 8;

export interface SocietyDashboard {
  readonly year: number;
  readonly population: number;
  readonly households: number;
  readonly meals: number;
  readonly tools: number;
  readonly exchangeVolume: number;
  readonly transportDemand: number;
  readonly scarcity: number;
  readonly stability: number;
  readonly inequality: number;
  readonly government: string;
  readonly leaderName: string;
}

export interface SocietyBiographyEntry {
  readonly eventId: number;
  readonly tick: number;
  readonly summary: string;
}

export interface SocietyPerson {
  readonly id: number;
  readonly name: string;
  readonly ageYears: number;
  readonly lifeStage: string;
  readonly status: string;
  readonly role: string;
  readonly cultureName: string;
  readonly householdName: string;
  readonly biography: readonly SocietyBiographyEntry[];
}

export interface SocietyCulture {
  readonly id: number;
  readonly name: string;
  readonly preference: string;
  readonly belief: string;
  readonly tradition: string;
  readonly architectureStyle: string;
}

export interface SocietyTimelineEntry {
  readonly id: number;
  readonly tick: number;
  readonly summary: string;
}

export interface SocietyPanelProps {
  readonly dashboard: SocietyDashboard;
  readonly people: readonly SocietyPerson[];
  readonly cultures: readonly SocietyCulture[];
  readonly timeline: readonly SocietyTimelineEntry[];
  readonly timelineOffset: number;
  readonly timelineTotal: number;
  readonly onTimelinePageRequest: (offset: number) => void;
}

function DashboardMetric({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | number;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/**
 * Read-only presentation for Worker-projected M4 society data. All text is
 * supplied by the caller so this surface cannot manufacture history or mutate
 * simulation authority.
 */
export function SocietyPanel({
  dashboard,
  people,
  cultures,
  timeline,
  timelineOffset,
  timelineTotal,
  onTimelinePageRequest,
}: SocietyPanelProps) {
  const [selectedPersonId, setSelectedPersonId] = useState<number | null>(people[0]?.id ?? null);
  const selectedPerson =
    people.find((person) => person.id === selectedPersonId) ?? people[0] ?? null;
  const timelinePageCount = Math.ceil(timelineTotal / TIMELINE_PAGE_SIZE);
  const visibleTimelinePage = Math.floor(timelineOffset / TIMELINE_PAGE_SIZE);

  return (
    <section className="society-panel" aria-labelledby="society-title">
      <header className="card-heading">
        <div>
          <p>Society projection</p>
          <h2 id="society-title">Settlement and society</h2>
        </div>
        <span>Year {dashboard.year}</span>
      </header>

      <section aria-labelledby="settlement-dashboard-title">
        <h3 id="settlement-dashboard-title">Settlement dashboard</h3>
        <dl className="society-dashboard">
          <DashboardMetric label="Population" value={dashboard.population} />
          <DashboardMetric label="Households" value={dashboard.households} />
          <DashboardMetric label="Meals" value={dashboard.meals} />
          <DashboardMetric label="Tools" value={dashboard.tools} />
          <DashboardMetric label="Exchange volume" value={dashboard.exchangeVolume} />
          <DashboardMetric label="Transport demand" value={dashboard.transportDemand} />
          <DashboardMetric label="Scarcity" value={dashboard.scarcity} />
          <DashboardMetric label="Stability" value={dashboard.stability} />
          <DashboardMetric label="Inequality" value={dashboard.inequality} />
          <DashboardMetric label="Government" value={dashboard.government} />
          <DashboardMetric label="Leader" value={dashboard.leaderName} />
        </dl>
      </section>

      <section aria-labelledby="people-title">
        <h3 id="people-title">People</h3>
        {people.length === 0 ? (
          <p>No people are available in this projection.</p>
        ) : (
          <>
            <label>
              Inspect person
              <select
                aria-label="Inspect person"
                onChange={(event) => setSelectedPersonId(Number(event.target.value))}
                value={selectedPerson?.id ?? ''}
              >
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </label>
            {selectedPerson === null ? null : (
              <article className="biography-panel" aria-labelledby="biography-title">
                <h4 id="biography-title">{selectedPerson.name}</h4>
                <dl>
                  <DashboardMetric label="Age" value={selectedPerson.ageYears} />
                  <DashboardMetric label="Life stage" value={selectedPerson.lifeStage} />
                  <DashboardMetric label="Status" value={selectedPerson.status} />
                  <DashboardMetric label="Role" value={selectedPerson.role} />
                  <DashboardMetric label="Culture" value={selectedPerson.cultureName} />
                  <DashboardMetric label="Household" value={selectedPerson.householdName} />
                </dl>
                <h5>Factual biography</h5>
                {selectedPerson.biography.length === 0 ? (
                  <p>No source events are available for this biography.</p>
                ) : (
                  <ol>
                    {selectedPerson.biography.map((entry) => (
                      <li key={entry.eventId}>
                        <span>
                          Event #{entry.eventId} · tick {entry.tick}:{' '}
                        </span>
                        {entry.summary}
                      </li>
                    ))}
                  </ol>
                )}
              </article>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="cultures-title">
        <h3 id="cultures-title">Cultures</h3>
        {cultures.length === 0 ? (
          <p>No cultures are available in this projection.</p>
        ) : (
          <ul className="culture-list">
            {cultures.map((culture) => (
              <li key={culture.id}>
                <h4>{culture.name}</h4>
                <dl>
                  <DashboardMetric label="Preference" value={culture.preference} />
                  <DashboardMetric label="Belief" value={culture.belief} />
                  <DashboardMetric label="Tradition" value={culture.tradition} />
                  <DashboardMetric label="Architecture" value={culture.architectureStyle} />
                </dl>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="timeline-title">
        <h3 id="timeline-title">Timeline</h3>
        {timeline.length === 0 ? (
          <p>No historical events are available in this projection.</p>
        ) : (
          <>
            <ol className="timeline-list" start={timelineOffset + 1}>
              {timeline.map((entry) => (
                <li key={entry.id}>
                  <span>Tick {entry.tick}: </span>
                  {entry.summary}
                </li>
              ))}
            </ol>
            <nav aria-label="Timeline pages" className="timeline-pagination">
              <button
                disabled={visibleTimelinePage === 0}
                onClick={() =>
                  onTimelinePageRequest(Math.max(0, timelineOffset - TIMELINE_PAGE_SIZE))
                }
                type="button"
              >
                Previous
              </button>
              <span aria-live="polite">
                Page {visibleTimelinePage + 1} of {timelinePageCount}
              </span>
              <button
                disabled={visibleTimelinePage >= timelinePageCount - 1}
                onClick={() =>
                  onTimelinePageRequest(
                    Math.min(
                      Math.max(0, (timelinePageCount - 1) * TIMELINE_PAGE_SIZE),
                      timelineOffset + TIMELINE_PAGE_SIZE,
                    ),
                  )
                }
                type="button"
              >
                Next
              </button>
            </nav>
          </>
        )}
      </section>
    </section>
  );
}
