# Architecture

## Product boundary

Chrono Forge has one authoritative deterministic simulation. React presents accessible controls and inspectors; PixiJS renders read-only projections; a module Web Worker owns mutable simulation state; Tauri/Rust owns native capabilities and durable SQLite persistence. Rendering, UI, wall-clock scheduling, and persistence never decide simulation outcomes.

## Runtime topology

```text
React UI ──commands──► typed worker protocol ──► simulation worker
   ▲                                              │
   │                 immutable deltas/events      │
   └──────────── Pixi renderer / inspectors ◄─────┘
   │                                              │
   └──── narrow Tauri IPC ◄──► Rust adapters ◄──► SQLite / OS
```

Source ownership converges toward:

- `src/simulation/`: pure authoritative state, systems, RNG, pathfinding, aggregation, save DTO migrations
- `src/protocol/`: versioned worker messages and persistence envelopes
- `src/workers/`: scheduler and transport only
- `src/rendering/`: Pixi scene graph and projection application
- `src/ui/`: React controls, inspectors, focus flows, settings, history
- `src/adapters/`: Tauri/browser boundaries, clocks, notifications, sound
- `src-tauri/`: typed commands, SQLite, atomic recovery, OS integration, packaging
- `tests/`: unit, invariant/property, determinism, integration, long-run, E2E, visual, benchmark scenarios

Imports flow inward: UI/rendering/adapters may depend on protocol and simulation read models; simulation imports none of them. CI enforces the boundary.

## Deterministic kernel

State advances only at integer logical ticks. Normal mode targets 10 authoritative ticks/second, rendering may run at 60 Hz, and projection publication is capped at 20 Hz. The scheduler uses elapsed wall time only to decide how many fixed ticks are due; it never changes tick results or skips authoritative ticks.

Forbidden in authoritative code: `Date.now`, `performance.now`, `Math.random`, locale-sensitive ordering, DOM/Tauri/Pixi/React imports, unordered asynchronous completion, and time-budgeted work. Use integer units for authoritative resources and measurements, total-order comparators, ascending stable IDs, fixed operation quotas, and quantization before any floating value becomes state.

The initial explicit system order is:

1. calendar and environment
2. needs and health
3. perception
4. personal and communal goal/utility decisions
5. movement
6. gathering, production, and construction
7. storage, transport, and trade
8. demographics, relationships, and institutions
9. research and culture
10. disasters and conflict
11. history events
12. aggregation and invariants

Commands receive worker-assigned sequence numbers and target ticks. Snapshots include RNG streams, queues, scheduler cursors, pending paths, aggregation state, next IDs, and acknowledged commands. Canonical hashes use sorted DTO arrays, never implicit `Map`/`Set` serialization.

## Randomness and decisions

A local, golden-vector-tested TypeScript port of xoshiro128** 1.1 supplies four-word `uint32` streams. Human seed strings normalize once to a displayed 128-bit seed. World generation, each global system, and each agent have independently derived streams so adding a farming draw does not perturb disasters or every citizen.

Agents use a documented utility/goal hybrid. Needs, opportunities, geography, personality, social state, knowledge, risk, plan cost, and bounded randomness produce candidates. A total order breaks ties. Occupations, construction, technology, settlement founding, and responses emerge from selected goals and available actions; the player does not assign routine work.

The M3 settlement slice advances six founders on deterministic 100-tick action pulses. Stable-ID records carry bounded needs, traits, skills, goals, plans, routes, knowledge, factual memories, relationships, activity-derived occupations, carried resources, and independently saved RNG streams. Agents gather from physical tiles, carry and deposit resources, select construction sites, and build, repair, expand, repurpose, abandon, or demolish shelters and storehouses. Pulse boundaries, fixed path quotas, total tie-breakers, and end-of-pulse invariant checks preserve arbitrary tick-partition equivalence.

M4 adds a deterministic 1,000-tick society pulse over the same settlement authority. A persisted calendar uses 100,000 ticks per civil year in normal worlds and 5,000 only in declared accelerated acceptance worlds. Society state owns stable person profiles, parent-linked households, cultural identities, groups, institutions, government, household inventories/credits/offers, production ledgers, inequality/stability, bounded biography references, and its own RNG stream and quotas. The communal survival stockpile remains the settlement safety reserve; declared recipes move conserved inputs into household exchange goods, and stable-price/time/ID ordering resolves offers. Births, deaths, inheritance, off-map migration, culture, and institutions never create a second settlement before M6.

M4.5 replaces the shallow M3/M4 social baseline with one canonical sparse interpersonal model. Stable bond IDs and canonical person-pair keys carry culturally appropriate roles/status, directional affinity/trust or equivalent state, closeness/commitment/grievance, lifecycle ticks, deterministic trend, bounded shared-event references, and isolated RNG state. The parent/guardian graph remains canonical genealogy; indexed queries derive sibling and practical extended-kin connections without materializing every relative pair. Direct family, active partner, household, and historically salient records are protected, while ordinary social edges and event references use declared deterministic caps and eviction/summary rules. No pulse enumerates every possible population pair.

Relationship opportunities run on fixed quotas in the demographics/relationships system and use total ordering over proximity, repeated interaction, shared work/events, traits, compatibility, culture, kinship, need, and deterministic RNG. Relationship state is an input to person-level utility and plans for cooperation, aid, caregiving, resources, household/partner/child decisions, migration, knowledge, politics/factions, conflict, reconciliation, crisis assistance, and inheritance; it biases autonomous decisions without directly scripting them. Household membership is versioned history, not a permanent birth assignment: formation, join, leave, split, merge, co-migration, separation, child arrival, and care changes are explicit typed events.

Child arrival must reference an eligible persistent relationship/family structure and a logged cultural rule. Important formations, transitions, conflict, reconciliation, separation, household change, and bereavement emit immutable source events used by biographies and relationship history. Worker read models expose bounded person relationship summaries and pageable details only on request; React provides deliberate keyboard-accessible family and relationship navigation outside the default calm focus surface. M5 crisis response, M6 cross-settlement movement/politics, and M8 aggregation must consume and conserve this same authority.

M5 adds one world-owned `DevelopmentState`, advanced after ordinary settlement and society work at each civil-year boundary. It contains a stable contextual knowledge graph, bounded modeled-condition pressures, active crises and retained outcomes, a closed queue of condition-changing interventions, independent persisted research and disaster RNG streams, and operation counts. The pure development pulse reads a fixed 256-tile terrain sample with binary sparse-depletion lookup plus immutable civilization context, evaluates fixed candidate quotas with total ordering, and returns ordered factual drafts and bounded conserved effects; it never mutates settlement, relationship, or tile authority itself. World orchestration applies those patches, synchronizes crisis health/death state, assigns stable event IDs, and then reuses the existing memory, biography, and sparse relationship attachment path. Crisis assistance and shared trauma update the already-authoritative M4.5 edge; harmed people and deterministic exposure drive caregiving, protection, and evacuation choices. Interventions may change weather/resource/organism/omen/artifact/protection/disaster/signal conditions, but cannot name a discovery, crisis, victim, helper, or outcome. Snapshot v5 persists this authority and migrates v4 saves to a no-retroactive-history baseline.

M6 adds one world-owned `CivilizationsState` after M5 development at each civil-year boundary. It owns globally unique settlement/civilization/residency/route/relation/conflict/ruin identities, fixed tile ownership and bounded ownership history, independent persisted RNG, and stable-ID-sorted annual market and political resolution. The M3-M5 `CivilizationState` remains the global registry for detailed named people, structures, households, cultures, groups, institutions, genealogy, and sparse relationships, so cross-settlement movement never clones social authority or weakens M4.5 limits. The founding settlement keeps the detailed action-pulse reserve; additional communities own authoritative annual reserves and named-resident membership, and founding/market transfers conserve goods exactly once so no resource exists in both layers. Active routes rebalance actual shortages within fixed route capacity; disruption stops exchange. Secondary residents use camera-independent annual community production/consumption until M8 generalizes validated aggregation/deaggregation.

Annual M6 order is founding/residency, community economy, markets/routes, diplomacy, conflict/refugees, conquest/federation/fragmentation, ruins/territory history, factual attachment, and invariants. Every candidate set and mutation uses fixed quotas and total tie-breakers; no elapsed-time budget or population-wide relationship pair scan is allowed. Cross-settlement decisions query only indexed household/kin/salient-edge candidates and use `relationshipDecisionInfluence` beside material, scarcity, stability, and diplomatic utility, never as an outcome command. Conflict targets and political partners are utility-selected; conflict winners use conserved material strength; abandonment uses settlement pressure. Conquest/ruin must evacuate residents, close invalid routes, transfer or clear territory, and collapse a civilization that has no active member settlement. Historical entities remain retained and referenceable after conquest, federation, fragmentation, abandonment, or ruin. M5 knowledge stays one world-observed graph in M6; route/conflict evidence feeds future contextual development without duplicating knowledge authority. Snapshot v6 conservatively wraps v5 as one provenance-labelled settlement/civilization at the saved tick and creates no retroactive M6 history. Worker v6 exposes bounded read-only settlements, civilizations, markets, diplomacy, conflicts, residencies, and ruins; React provides deliberate keyboard-accessible inspection, while rich era/world rendering remains M7.

The locked detailed-person budget is 24 active elective edges, 24 archived relationship summaries, 16 significant shared-event references per edge, eight rows per detail page, 16 recent household-membership intervals plus one prefix summary, and eight new-candidate evaluations per person per civil year. Active partners are protected within the edge cap. Canonical parent/guardian-child records carry evolving directional emotional state in a separate O(population) family index; current-household membership is also linear, while emotionally salient sibling/extended-kin bonds use elective slots. Fixed retention tuples prioritize major events, then integer closeness/grievance, recency, and stable IDs; overflow becomes bounded category/tick summaries. These constants and total orders are authoritative versioned data, not runtime timing heuristics.

M4.5 v1 supports exactly two child/family policies: `pair-bond` and `communal-guardianship`. Both require living adults aged at least 18, valid settlement/household capacity and resources, a persisted cooldown, compatible selected family/care goals, and stable tie-breakers. Partner formation and pair-bond co-parent selection exclude parent/child and all ancestor/descendant, sibling/half-sibling, aunt-or-uncle/nibling, and first-cousin pairs. Pair-bond arrival additionally requires reciprocal active partner/long-term-partner state with bidirectional trust at least 50 and commitment at least 60. Communal guardianship requires the culture flag and one or two co-resident guardians; two guardians may be direct kin and otherwise need an existing partner or close-friend bond. Default cultures allow one committed partner; an explicit plural-partnership culture may allow at most two. Adoption/guardianship of an existing dependent selects only current household, direct kin, or salient caregiver/friend candidates and never creates a child or retroactive parentage.

World events use explicit entity kinds (`world`, `person`, `structure`, `household`, `culture`, `group`, or `institution`) plus stable IDs and an immutable bounded factual summary. Display surfaces quote that saved summary and source ID rather than reconstructing historical claims from mutable current state. The authoritative event archive remains canonical; Worker frames expose eight-row timeline pages, at most 256 recent events, and at most 16 biography references per person. Snapshot v3 migrates v2 by initializing society at the saved tick and preserving every old event; it does not synthesize births, institutions, or other retroactive history. Migration may begin between society boundaries, so the next pulse uses the next absolute 1,000-tick boundary rather than assuming the saved tick was aligned.

M4 acceptance can apply one explicit recorded `supply-shortage` input to a deterministic checkpoint. It conservatively removes communal and household goods, may damage one shelter, and then leaves mortality, migration, collapse, and recovery to normal pulses. This is scenario evidence for economic propagation, not an unrecorded ambient disaster or a substitute for M5's modeled crisis systems. Collapse recovery uses scarcity/stability hysteresis so it cannot oscillate at one threshold.

## World, pathfinding, and scale

Terrain is a chunked tile world; the initial chunk is 32×32 tiles. Dynamic entities use a deterministic uniform spatial grid. Local movement uses A* with fixed neighbor order and heap order `(f, h, nodeId)`. Shared goals can use reverse-Dijkstra flow fields; long routes use chunk portals. Cache keys include navigation revision and movement class, and incremental work consumes fixed node-expansion quotas.

The M1 baseline world is 96×64 tiles arranged as six 32×32-or-smaller chunks. Authoritative tile fields are dense typed arrays for elevation, water, temperature, moisture, biome, five resources, habitability, hazard, plants, and animals. Integer-only multi-scale lattice noise creates coherent regions; coordinate hashing supplies local resource detail. A central sanctuary guarantees a substantial connected habitable region without changing seed determinism. Initial history contains factual `world-generated` and `founders-arrived` events at tick 0.

The version-2 frame projection copies biome, aggregate resource, habitability, and hazard arrays plus stable-ID-sorted packed agent and structure arrays, normalized structure progress/condition, and settlement totals before transfer. The main thread never receives authoritative arrays. Worker input is treated as untrusted structured-clone data: every request is validated and reconstructed before dispatch, malformed input becomes a typed fault, and an unsupported numeric protocol version takes precedence over version-specific field validation.

Camera distance affects rendering detail only. Authoritative LOD uses deterministic population/settlement tiers, historical importance, and scheduled cadence. Aggregation/deaggregation must conserve population, resources, historically salient relationships, genealogy, household membership/history, ownership, knowledge, and referenced events covered by invariants. M4.5 relationship work and storage are measured against people plus represented edges/index records, never the square of population.

## Worker protocol

The UI sends `initialize`, `load`, `queueCommand`, `setRunMode`, `advanceTicks`, `requestSave`, `requestTimelinePage`, and `performOfflineCatchUp`. The worker returns `ready`, `commandAccepted`, `frameDelta`, `eventBatch`, `timelinePage`, `saveSnapshot`, `metrics`, and `fault`. `advanceTicks` is rejected above 1,000,000 ticks per request, every event-emission path is capped at the newest 256 records, and complete history is requested in bounded pages. Large projections use transferable buffers; messages are batched per frame, not per entity. Pixi stays on the main thread for v1. Shared memory and OffscreenCanvas require profiling evidence before adoption.

Offline progression is an explicit logged input containing elapsed milliseconds, configured rate, and policy version. It is clamped and simulated in deterministic coarse batches; unbounded real-time catch-up loops are forbidden.

## Persistence and recovery

Rust exposes only typed commands such as list/load/commit/delete slots, import/export, settings, focus history, and database checks. The WebView never receives a general SQL surface. SQLite lives in Tauri `AppLocalData` with WAL, `synchronous=FULL`, foreign keys, and a busy timeout. Authoritative snapshots begin as canonical JSON envelopes with format, engine/content versions, seed, tick, checksum, and payload. Snapshot v3 persists the complete settlement and society graphs and validates lifecycle, ownership, parentage, household/culture/group/institution references, routes, plans, event sources, resources, RNG streams, and bounds during rehydration. v2 adds society at the saved tick without replaying a past; v0/v1 terrain-only saves found the six agents at the saved logical tick in constant time and record that founding event. Migration never retroactively simulates or invents unlogged history.

Canonical snapshot v4 persists bond identity/state/RNG, indexed genealogy and guardianship, household membership history, relationship event references, and immutable child-arrival eligibility evidence. The v3-to-v4 migration maps nonzero parent IDs to provenance-labelled genealogy with unknown start and neutral `migrated-unknown` family-bond state, opens current household intervals with unknown start, and maps only changed legacy affinity/trust or the stored M4 society pair to capped `legacy-contact` edges by copying stored integers. A global deterministic descending importance order greedily admits legacy edges only while both endpoints have capacity. Migration discards default 50/50 complete-graph contacts and infers no friendship, rivalry, partnership, estrangement, or event. Legacy contacts cannot satisfy lifecycle acceptance until a recorded v4 transition occurs. Validation rejects self/duplicate bonds, impossible ancestry cycles, invalid family/partner/household/event references, non-finite values, cap violations, and missing or mismatched child-arrival rule evidence before a migrated or loaded generation can become the slot head.

Saves are immutable generations. A transaction inserts generation `N+1`, verifies its SHA-256 readback, updates the slot head, and commits; pruning older generations happens separately after success. When focus is active, the same transaction stores the exact validated timer checkpoint, upserts history, and advances the head, so interruption cannot expose a world/timer mismatch. The newest three fully recoverable generations are retained. Loading is deliberately two-stage: Rust returns verified candidates in head-first/newest-first order with only the focus checkpoint stored on that exact generation, then the TypeScript migration layer validates the envelope, world, timer, references, dimensions, ranges, and checksums. A semantically invalid head is skipped for an older internally consistent pair without deleting evidence, and export targets the exact semantically accepted generation. Full database backups use SQLite's backup API, never a raw copy of a live WAL database.

Database migrations live in Rust. Simulation payload migrations are pure one-version steps, validated after every step and written as a new generation. Unknown future versions are rejected without mutation. At least the prior two released payload versions remain readable throughout v1.x.

## Focus time

The focus timer is a versioned explicit-time state machine. Callers inject every epoch observation; backward wall-clock movement is clamped to the last accepted observation, and sleep-sized intervals account identically to partitioned checkpoints. Pause, cancel, optional breaks, and completion are explicit. Integer remainder accounting converts accepted focus milliseconds to simulation ticks without drift. Persisted state must pass exact-key semantic rehydration and agree with its typed session summary. The last active slot is persisted, session IDs use platform UUIDs, and completion effects occur only after the matching checkpoint is durable. Session recaps contain sorted event IDs validated against the authoritative saved world and are displayed only for their own slot; loading replaces, rather than merges, the UI event set.

## Rendering and accessibility

React owns semantics, focus order, keyboard controls, text scaling, inspectors, timelines, settings, and announcements. Pixi owns terrain/entities/effects and exposes selected objects through typed IDs. The M3 renderer keeps separate dirty layers for terrain, structures, and agents; every visible structure also has text status/progress/condition and a non-color condition marker. The renderer batches by texture/layer, culls by viewport, interpolates projections, and honors reduced motion/effects without changing simulation. Overlay palettes include redundant shape/pattern cues and measured contrast. M4.5 adds optional person-to-family-to-relationship navigation with bounded summaries and on-demand history pages; no relationship surface is persistently opened or animated during calm focus mode.

Tauri keeps a strict CSP without `unsafe-eval`. PixiJS loads its statically generated `pixi.js/unsafe-eval` fallback before renderer initialization; despite the package entrypoint name, this removes runtime code generation and is required for WebView2 under the strict policy.

All runtime assets are bundled locally. Tauri uses a restrictive capability list and CSP; no account or remote content is required.

## Performance budgets

The release reference world targets 5,000 detailed agents plus 100,000 aggregate residents at 10 ticks/s, p95 tick under 50 ms, p99 under 100 ms, projection application p95 under 8 ms, projection payload under 4 MiB, and peak heap under 512 MiB. A 50 MiB save targets durable commit under one second and load/validation under two seconds on the documented reference machine. CI compares deterministic operation counts and median timing; a timing regression is blocking when it exceeds 25% and an absolute budget.

## Security and privacy

All core data is local. Tauri capabilities grant only needed IPC. Imports are size-limited, version/checksum validated, parsed as data, and never executed. Release workflows receive write permissions only in the release job. Signing secrets never enter PR workflows. A private GitHub release is not used as an anonymous updater endpoint and no reusable repository token is embedded in the app.
