import { useEffect, useState } from 'react';
import type {
  SocietyCultureProjection,
  SocietyDashboardProjection,
  SocietyPersonProjection,
  SocietyRelationshipProjection,
  SocietyTimelineProjection,
} from '../protocol';

const TIMELINE_PAGE_SIZE = 8;

export type SocietyDashboard = SocietyDashboardProjection;
export type SocietyBiographyEntry = SocietyPersonProjection['biography'][number];
export type SocietyPerson = SocietyPersonProjection;
export type SocietyCulture = SocietyCultureProjection;
export type SocietyTimelineEntry = SocietyTimelineProjection;

export interface SocietyPanelProps {
  readonly dashboard: SocietyDashboard;
  readonly people: readonly SocietyPerson[];
  readonly relationshipPage: {
    readonly personId: number | null;
    readonly offset: number;
    readonly total: number;
    readonly relationships: readonly SocietyRelationshipProjection[];
  };
  readonly relationshipEventPage: {
    readonly personId: number | null;
    readonly relationshipId: string | null;
    readonly offset: number;
    readonly total: number;
    readonly events: SocietyRelationshipProjection['sharedEvents'];
  };
  readonly cultures: readonly SocietyCulture[];
  readonly timeline: readonly SocietyTimelineEntry[];
  readonly timelineOffset: number;
  readonly timelineTotal: number;
  readonly onTimelinePageRequest: (offset: number) => void;
  readonly onRelationshipPageRequest: (personId: number, offset: number) => void;
  readonly onRelationshipEventPageRequest: (
    personId: number,
    relationshipId: string,
    offset: number,
  ) => void;
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

function relationshipOtherPersonId(
  relationship: SocietyRelationshipProjection,
  personId: number,
): number {
  return relationship.firstPersonId === personId
    ? relationship.secondPersonId
    : relationship.firstPersonId;
}

function formatRelationshipKind(kind: string): string {
  return kind.replaceAll('-', ' ');
}

function FamilyOrSocialList({
  heading,
  relationships,
  personId,
  namesById,
}: {
  readonly heading: string;
  readonly relationships: readonly SocietyRelationshipProjection[];
  readonly personId: number;
  readonly namesById: ReadonlyMap<number, string>;
}) {
  if (relationships.length === 0) return null;
  return (
    <section className="relationship-list" aria-label={heading}>
      <h6>{heading}</h6>
      <ul>
        {relationships.map((relationship) => {
          const otherId = relationshipOtherPersonId(relationship, personId);
          const otherName = namesById.get(otherId);
          if (otherName === undefined) return null;
          return (
            <li key={relationship.id}>
              {otherName} · {formatRelationshipKind(relationship.kind)}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function NameList({
  heading,
  names,
}: {
  readonly heading: string;
  readonly names: readonly string[];
}) {
  if (names.length === 0) return null;
  return (
    <section className="relationship-list" aria-label={heading}>
      <h6>{heading}</h6>
      <ul>
        {names.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </section>
  );
}

function PersonIdList({
  heading,
  personIds,
  namesById,
  suffix,
}: {
  readonly heading: string;
  readonly personIds: readonly number[];
  readonly namesById: ReadonlyMap<number, string>;
  readonly suffix?: string;
}) {
  const names = personIds.flatMap((personId) => {
    const name = namesById.get(personId);
    return name === undefined ? [] : [`${name}${suffix === undefined ? '' : ` · ${suffix}`}`];
  });
  return <NameList heading={heading} names={names} />;
}

function RelationshipDetail({
  relationship,
  namesById,
  personId,
  relationshipEventPage,
  onRelationshipEventPageRequest,
}: {
  readonly relationship: SocietyRelationshipProjection;
  readonly namesById: ReadonlyMap<number, string>;
  readonly personId: number;
  readonly relationshipEventPage: SocietyPanelProps['relationshipEventPage'];
  readonly onRelationshipEventPageRequest: SocietyPanelProps['onRelationshipEventPageRequest'];
}) {
  const firstName = namesById.get(relationship.firstPersonId);
  const secondName = namesById.get(relationship.secondPersonId);
  if (firstName === undefined || secondName === undefined) return null;
  const pageMatches =
    relationshipEventPage.personId === personId &&
    relationshipEventPage.relationshipId === relationship.id;
  const events = pageMatches ? relationshipEventPage.events : relationship.sharedEvents;
  const total = pageMatches ? relationshipEventPage.total : relationship.sharedEventTotal;
  const offset = pageMatches ? relationshipEventPage.offset : 0;
  const pageCount = Math.ceil(total / TIMELINE_PAGE_SIZE);
  const visiblePage = Math.floor(offset / TIMELINE_PAGE_SIZE);
  return (
    <article className="relationship-detail" aria-labelledby="relationship-detail-title">
      <h5 id="relationship-detail-title">Relationship detail</h5>
      <p>
        {firstName} and {secondName}
      </p>
      <dl>
        <DashboardMetric label="Type" value={formatRelationshipKind(relationship.kind)} />
        <DashboardMetric label="Status" value={relationship.status} />
        <DashboardMetric label={`${firstName} role`} value={relationship.firstRole} />
        <DashboardMetric label={`${secondName} role`} value={relationship.secondRole} />
        <DashboardMetric label="Trend" value={relationship.trend} />
        <DashboardMetric
          label="Began"
          value={
            relationship.formedTick === null
              ? 'Not recorded in this save'
              : `Tick ${relationship.formedTick}`
          }
        />
        <DashboardMetric label="Changed" value={`Tick ${relationship.changedTick}`} />
        {relationship.endedTick === null ? null : (
          <DashboardMetric label="Ended" value={`Tick ${relationship.endedTick}`} />
        )}
        <DashboardMetric
          label={`${firstName} → ${secondName} affinity`}
          value={relationship.firstToSecond.affinity}
        />
        <DashboardMetric
          label={`${firstName} → ${secondName} trust`}
          value={relationship.firstToSecond.trust}
        />
        <DashboardMetric
          label={`${firstName} → ${secondName} closeness`}
          value={relationship.firstToSecond.closeness}
        />
        <DashboardMetric
          label={`${firstName} → ${secondName} commitment`}
          value={relationship.firstToSecond.commitment}
        />
        <DashboardMetric
          label={`${firstName} → ${secondName} grievance`}
          value={relationship.firstToSecond.grievance}
        />
        <DashboardMetric
          label={`${secondName} → ${firstName} affinity`}
          value={relationship.secondToFirst.affinity}
        />
        <DashboardMetric
          label={`${secondName} → ${firstName} trust`}
          value={relationship.secondToFirst.trust}
        />
        <DashboardMetric
          label={`${secondName} → ${firstName} closeness`}
          value={relationship.secondToFirst.closeness}
        />
        <DashboardMetric
          label={`${secondName} → ${firstName} commitment`}
          value={relationship.secondToFirst.commitment}
        />
        <DashboardMetric
          label={`${secondName} → ${firstName} grievance`}
          value={relationship.secondToFirst.grievance}
        />
      </dl>
      <h6>Significant factual events</h6>
      {events.length === 0 ? (
        <p>No source events are available for this relationship.</p>
      ) : (
        <ol>
          {events.map((event) => (
            <li key={event.eventId}>
              <span>
                Event #{event.eventId} · tick {event.tick}:{' '}
              </span>
              {event.summary}
            </li>
          ))}
        </ol>
      )}
      {pageCount <= 1 ? null : (
        <nav aria-label="Shared relationship event pages" className="timeline-pagination">
          <button
            disabled={visiblePage === 0}
            onClick={() =>
              onRelationshipEventPageRequest(
                personId,
                relationship.id,
                Math.max(0, offset - TIMELINE_PAGE_SIZE),
              )
            }
            type="button"
          >
            Previous shared events
          </button>
          <span aria-live="polite">
            Shared events page {visiblePage + 1} of {pageCount}
          </span>
          <button
            disabled={visiblePage >= pageCount - 1}
            onClick={() =>
              onRelationshipEventPageRequest(
                personId,
                relationship.id,
                Math.min((pageCount - 1) * TIMELINE_PAGE_SIZE, offset + TIMELINE_PAGE_SIZE),
              )
            }
            type="button"
          >
            Next shared events
          </button>
        </nav>
      )}
    </article>
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
  relationshipEventPage,
  relationshipPage,
  cultures,
  timeline,
  timelineOffset,
  timelineTotal,
  onTimelinePageRequest,
  onRelationshipEventPageRequest,
  onRelationshipPageRequest,
}: SocietyPanelProps) {
  const [selectedPersonId, setSelectedPersonId] = useState<number | null>(people[0]?.id ?? null);
  const [selectedRelationshipId, setSelectedRelationshipId] = useState<string | null>(null);
  const selectedPerson =
    people.find((person) => person.id === selectedPersonId) ?? people[0] ?? null;
  const namesById = new Map(people.map((person) => [person.id, person.name]));
  const selectedPersonRelationships =
    selectedPerson !== null && relationshipPage.personId === selectedPerson.id
      ? relationshipPage.relationships
      : [];
  const selectedRelationship =
    selectedPersonRelationships.find(
      (relationship) => relationship.id === selectedRelationshipId,
    ) ??
    selectedPersonRelationships[0] ??
    null;
  const relationshipPageCount = Math.ceil(relationshipPage.total / TIMELINE_PAGE_SIZE);
  const visibleRelationshipPage = Math.floor(relationshipPage.offset / TIMELINE_PAGE_SIZE);
  const timelinePageCount = Math.ceil(timelineTotal / TIMELINE_PAGE_SIZE);
  const visibleTimelinePage = Math.floor(timelineOffset / TIMELINE_PAGE_SIZE);

  useEffect(() => {
    if (selectedPerson !== null && relationshipPage.personId !== selectedPerson.id)
      onRelationshipPageRequest(selectedPerson.id, 0);
  }, [onRelationshipPageRequest, relationshipPage.personId, selectedPerson]);

  useEffect(() => {
    if (
      selectedPerson !== null &&
      selectedRelationship !== null &&
      selectedRelationship.sharedEventTotal > 0 &&
      (relationshipEventPage.personId !== selectedPerson.id ||
        relationshipEventPage.relationshipId !== selectedRelationship.id)
    )
      onRelationshipEventPageRequest(selectedPerson.id, selectedRelationship.id, 0);
  }, [
    onRelationshipEventPageRequest,
    relationshipEventPage.personId,
    relationshipEventPage.relationshipId,
    selectedPerson,
    selectedRelationship,
  ]);

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
                onChange={(event) => {
                  setSelectedPersonId(Number(event.target.value));
                  setSelectedRelationshipId(null);
                }}
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
                {selectedPerson.childArrival === null ? null : (
                  <section aria-label="Family arrival evidence" className="family-arrival-evidence">
                    <h5>Family arrival evidence</h5>
                    <dl>
                      <DashboardMetric
                        label="Policy"
                        value={formatRelationshipKind(selectedPerson.childArrival.policy)}
                      />
                      <DashboardMetric
                        label="Arrival tick"
                        value={selectedPerson.childArrival.tick}
                      />
                      <DashboardMetric
                        label="Household"
                        value={`Household ${selectedPerson.childArrival.householdId}`}
                      />
                      <DashboardMetric
                        label="Eligibility event"
                        value={`#${selectedPerson.childArrival.eligibilityEventId}`}
                      />
                      <DashboardMetric
                        label="Selection score"
                        value={selectedPerson.childArrival.selectionScoreAtArrival}
                      />
                    </dl>
                    <PersonIdList
                      heading="Recorded arrival guardians"
                      namesById={namesById}
                      personIds={selectedPerson.childArrival.guardianIds}
                      suffix="guardian"
                    />
                    {selectedPerson.childArrival.partnerRelationshipId === null ? null : (
                      <p>
                        Recorded{' '}
                        {formatRelationshipKind(selectedPerson.childArrival.partnerKindAtArrival!)}{' '}
                        bond #{selectedPerson.childArrival.partnerRelationshipId} · minimum trust{' '}
                        {selectedPerson.childArrival.minimumPartnerTrustAtArrival} · minimum
                        commitment {selectedPerson.childArrival.minimumPartnerCommitmentAtArrival}
                      </p>
                    )}
                  </section>
                )}
                <h5>Social and family connections</h5>
                <div className="relationship-categories">
                  <PersonIdList
                    heading="Parents"
                    namesById={namesById}
                    personIds={selectedPerson.parentIds}
                    suffix="parent"
                  />
                  <PersonIdList
                    heading="Guardians"
                    namesById={namesById}
                    personIds={selectedPerson.guardianIds}
                    suffix="guardian"
                  />
                  <PersonIdList
                    heading="Children"
                    namesById={namesById}
                    personIds={selectedPerson.childIds}
                  />
                  <PersonIdList
                    heading="Siblings"
                    namesById={namesById}
                    personIds={selectedPerson.siblingIds}
                  />
                  <PersonIdList
                    heading="Extended family"
                    namesById={namesById}
                    personIds={selectedPerson.extendedKinIds}
                  />
                  <NameList
                    heading="Household members"
                    names={people
                      .filter(
                        (person) =>
                          person.id !== selectedPerson.id &&
                          person.householdName === selectedPerson.householdName,
                      )
                      .map((person) => person.name)}
                  />
                  {(() => {
                    const partnerRelationships = selectedPersonRelationships.filter(
                      (relationship) =>
                        relationship.category === 'social' &&
                        relationship.status === 'active' &&
                        ['partner', 'long-term-partner'].includes(relationship.kind),
                    );
                    const formerPartnerRelationships = selectedPersonRelationships.filter(
                      (relationship) =>
                        relationship.category === 'social' &&
                        (relationship.kind === 'former-partner' ||
                          (relationship.status === 'archived' &&
                            ['partner', 'long-term-partner'].includes(relationship.kind))),
                    );
                    const closeFriendRelationships = selectedPersonRelationships.filter(
                      (relationship) =>
                        relationship.category === 'social' && relationship.kind === 'close-friend',
                    );
                    const rivalRelationships = selectedPersonRelationships.filter(
                      (relationship) =>
                        relationship.category === 'social' &&
                        ['rival', 'enemy'].includes(relationship.kind),
                    );
                    const featuredIds = new Set(
                      [
                        ...partnerRelationships,
                        ...formerPartnerRelationships,
                        ...closeFriendRelationships,
                        ...rivalRelationships,
                      ].map((relationship) => relationship.id),
                    );
                    return (
                      <>
                        <FamilyOrSocialList
                          heading="Partner or equivalent"
                          namesById={namesById}
                          personId={selectedPerson.id}
                          relationships={partnerRelationships}
                        />
                        <FamilyOrSocialList
                          heading="Former partners"
                          namesById={namesById}
                          personId={selectedPerson.id}
                          relationships={formerPartnerRelationships}
                        />
                        <FamilyOrSocialList
                          heading="Close friends"
                          namesById={namesById}
                          personId={selectedPerson.id}
                          relationships={closeFriendRelationships}
                        />
                        <FamilyOrSocialList
                          heading="Rivals and enemies"
                          namesById={namesById}
                          personId={selectedPerson.id}
                          relationships={rivalRelationships}
                        />
                        <FamilyOrSocialList
                          heading="Other salient bonds"
                          namesById={namesById}
                          personId={selectedPerson.id}
                          relationships={selectedPersonRelationships.filter(
                            (relationship) =>
                              !featuredIds.has(relationship.id) &&
                              relationship.category === 'social',
                          )}
                        />
                      </>
                    );
                  })()}
                </div>
                {relationshipPage.personId !== selectedPerson.id ? (
                  <p>Loading bounded relationship page.</p>
                ) : relationshipPage.total === 0 ? (
                  <p>No recorded elective social relationships are available.</p>
                ) : (
                  <>
                    <nav aria-label="Relationship pages" className="timeline-pagination">
                      <button
                        disabled={visibleRelationshipPage === 0}
                        onClick={() =>
                          onRelationshipPageRequest(
                            selectedPerson.id,
                            Math.max(0, relationshipPage.offset - TIMELINE_PAGE_SIZE),
                          )
                        }
                        type="button"
                      >
                        Previous relationships
                      </button>
                      <span aria-live="polite">
                        Page {visibleRelationshipPage + 1} of {relationshipPageCount}
                      </span>
                      <button
                        disabled={visibleRelationshipPage >= relationshipPageCount - 1}
                        onClick={() =>
                          onRelationshipPageRequest(
                            selectedPerson.id,
                            Math.min(
                              Math.max(0, (relationshipPageCount - 1) * TIMELINE_PAGE_SIZE),
                              relationshipPage.offset + TIMELINE_PAGE_SIZE,
                            ),
                          )
                        }
                        type="button"
                      >
                        Next relationships
                      </button>
                    </nav>
                    <label>
                      Inspect relationship
                      <select
                        aria-label="Inspect relationship"
                        onChange={(event) => setSelectedRelationshipId(event.target.value)}
                        value={selectedRelationship?.id ?? ''}
                      >
                        {selectedPersonRelationships.map((relationship) => {
                          const otherName = namesById.get(
                            relationshipOtherPersonId(relationship, selectedPerson.id),
                          );
                          if (otherName === undefined) return null;
                          return (
                            <option key={relationship.id} value={relationship.id}>
                              {otherName} · {formatRelationshipKind(relationship.kind)}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                    {selectedRelationship === null ? null : (
                      <RelationshipDetail
                        namesById={namesById}
                        onRelationshipEventPageRequest={onRelationshipEventPageRequest}
                        personId={selectedPerson.id}
                        relationship={selectedRelationship}
                        relationshipEventPage={relationshipEventPage}
                      />
                    )}
                  </>
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
                <details className="culture-family-policy">
                  <summary>Family policy</summary>
                  <p>{formatRelationshipKind(culture.familyPolicy)}</p>
                </details>
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
