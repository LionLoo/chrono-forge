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

World events use explicit entity kinds (`world`, `person`, `structure`, `household`, `culture`, `group`, or `institution`) plus stable IDs and an immutable bounded factual summary. Display surfaces quote that saved summary and source ID rather than reconstructing historical claims from mutable current state. The authoritative event archive remains canonical; Worker frames expose only bounded recent timeline pages and bounded biography references. Snapshot v3 migrates v2 by initializing society at the saved tick and preserving every old event; it does not synthesize births, institutions, or other retroactive history.

## World, pathfinding, and scale

Terrain is a chunked tile world; the initial chunk is 32×32 tiles. Dynamic entities use a deterministic uniform spatial grid. Local movement uses A* with fixed neighbor order and heap order `(f, h, nodeId)`. Shared goals can use reverse-Dijkstra flow fields; long routes use chunk portals. Cache keys include navigation revision and movement class, and incremental work consumes fixed node-expansion quotas.

The M1 baseline world is 96×64 tiles arranged as six 32×32-or-smaller chunks. Authoritative tile fields are dense typed arrays for elevation, water, temperature, moisture, biome, five resources, habitability, hazard, plants, and animals. Integer-only multi-scale lattice noise creates coherent regions; coordinate hashing supplies local resource detail. A central sanctuary guarantees a substantial connected habitable region without changing seed determinism. Initial history contains factual `world-generated` and `founders-arrived` events at tick 0.

The version-2 frame projection copies biome, aggregate resource, habitability, and hazard arrays plus stable-ID-sorted packed agent and structure arrays, normalized structure progress/condition, and settlement totals before transfer. The main thread never receives authoritative arrays. Worker input is treated as untrusted structured-clone data: every request is validated and reconstructed before dispatch, malformed input becomes a typed fault, and an unsupported numeric protocol version takes precedence over version-specific field validation.

Camera distance affects rendering detail only. Authoritative LOD uses deterministic population/settlement tiers, historical importance, and scheduled cadence. Aggregation/deaggregation must conserve population, resource, relationship, ownership, knowledge, and event totals covered by invariants.

## Worker protocol

The UI sends `initialize`, `load`, `queueCommand`, `setRunMode`, `advanceTicks`, `requestSave`, and `performOfflineCatchUp`. The worker returns `ready`, `commandAccepted`, `frameDelta`, `eventBatch`, `saveSnapshot`, `metrics`, and `fault`. Large projections use transferable buffers; messages are batched per frame, not per entity. Pixi stays on the main thread for v1. Shared memory and OffscreenCanvas require profiling evidence before adoption.

Offline progression is an explicit logged input containing elapsed milliseconds, configured rate, and policy version. It is clamped and simulated in deterministic coarse batches; unbounded real-time catch-up loops are forbidden.

## Persistence and recovery

Rust exposes only typed commands such as list/load/commit/delete slots, import/export, settings, focus history, and database checks. The WebView never receives a general SQL surface. SQLite lives in Tauri `AppLocalData` with WAL, `synchronous=FULL`, foreign keys, and a busy timeout. Authoritative snapshots begin as canonical JSON envelopes with format, engine/content versions, seed, tick, checksum, and payload. Snapshot v2 persists the complete civilization graph and validates lifecycle, ownership, route, plan, relationship-pair, event, resource, RNG, and bound invariants during rehydration. v0/v1 terrain-only saves found the six M3 agents at the saved logical tick in constant time and record that founding event; migration never retroactively simulates or invents unlogged settlement history.

Saves are immutable generations. A transaction inserts generation `N+1`, verifies its SHA-256 readback, updates the slot head, and commits; pruning older generations happens separately after success. When focus is active, the same transaction stores the exact validated timer checkpoint, upserts history, and advances the head, so interruption cannot expose a world/timer mismatch. The newest three fully recoverable generations are retained. Loading is deliberately two-stage: Rust returns verified candidates in head-first/newest-first order with only the focus checkpoint stored on that exact generation, then the TypeScript migration layer validates the envelope, world, timer, references, dimensions, ranges, and checksums. A semantically invalid head is skipped for an older internally consistent pair without deleting evidence, and export targets the exact semantically accepted generation. Full database backups use SQLite's backup API, never a raw copy of a live WAL database.

Database migrations live in Rust. Simulation payload migrations are pure one-version steps, validated after every step and written as a new generation. Unknown future versions are rejected without mutation. At least the prior two released payload versions remain readable throughout v1.x.

## Focus time

The focus timer is a versioned explicit-time state machine. Callers inject every epoch observation; backward wall-clock movement is clamped to the last accepted observation, and sleep-sized intervals account identically to partitioned checkpoints. Pause, cancel, optional breaks, and completion are explicit. Integer remainder accounting converts accepted focus milliseconds to simulation ticks without drift. Persisted state must pass exact-key semantic rehydration and agree with its typed session summary. The last active slot is persisted, session IDs use platform UUIDs, and completion effects occur only after the matching checkpoint is durable. Session recaps contain sorted event IDs validated against the authoritative saved world and are displayed only for their own slot; loading replaces, rather than merges, the UI event set.

## Rendering and accessibility

React owns semantics, focus order, keyboard controls, text scaling, inspectors, timelines, settings, and announcements. Pixi owns terrain/entities/effects and exposes selected objects through typed IDs. The M3 renderer keeps separate dirty layers for terrain, structures, and agents; every visible structure also has text status/progress/condition and a non-color condition marker. The renderer batches by texture/layer, culls by viewport, interpolates projections, and honors reduced motion/effects without changing simulation. Overlay palettes include redundant shape/pattern cues and measured contrast.

Tauri keeps a strict CSP without `unsafe-eval`. PixiJS loads its statically generated `pixi.js/unsafe-eval` fallback before renderer initialization; despite the package entrypoint name, this removes runtime code generation and is required for WebView2 under the strict policy.

All runtime assets are bundled locally. Tauri uses a restrictive capability list and CSP; no account or remote content is required.

## Performance budgets

The release reference world targets 5,000 detailed agents plus 100,000 aggregate residents at 10 ticks/s, p95 tick under 50 ms, p99 under 100 ms, projection application p95 under 8 ms, projection payload under 4 MiB, and peak heap under 512 MiB. A 50 MiB save targets durable commit under one second and load/validation under two seconds on the documented reference machine. CI compares deterministic operation counts and median timing; a timing regression is blocking when it exceeds 25% and an absolute budget.

## Security and privacy

All core data is local. Tauri capabilities grant only needed IPC. Imports are size-limited, version/checksum validated, parsed as data, and never executed. Release workflows receive write permissions only in the release job. Signing secrets never enter PR workflows. A private GitHub release is not used as an anonymous updater endpoint and no reusable repository token is embedded in the app.
