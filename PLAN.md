# Chrono Forge v1.0 execution plan

This is the ordered, release-blocking backlog. A milestone is complete only when its observable acceptance criteria pass, its required validation is recorded in `PROGRESS.md`, an independent reviewer has no unresolved release-relevant findings, its PR is green, and it is merged to `main`. Branch names are fixed to keep automation and recovery predictable.

## M0 — Repository and architecture bootstrap

Branch: `bootstrap/repository-harness`

Deliver the pinned React/Vite/Pixi/Tauri toolchain, deterministic module boundaries, local-first persistence decision, project instructions and agents, required documentation, CI/release workflow skeletons, a production-buildable desktop shell, and smoke tests.

Acceptance: clean install; formatting, lint, type checking, unit tests, Rust tests, web E2E smoke, web build, and Windows desktop build pass; app launches; private origin exists; bootstrap PR is independently reviewed, green, and merged.

## M1 — Deterministic world and simulation kernel

Branch: `feature/deterministic-world-kernel`

Implement xoshiro128** streams and golden vectors, integer fixed ticks, canonical state hashing, seeded chunked terrain/water/climate/biomes/resources/habitability/hazards, plants and animals at population-field level, spatial indexes, local A*, event log, worker protocol, and renderer projections.

Acceptance: identical seed/config produces identical initial world and checkpoint hashes in Node, browser main thread, and worker; generated worlds contain reachable habitable regions and meaningful resource variation; no authoritative DOM/wall-clock/random imports; camera pan/zoom and terrain/resource overlays work in the launched app.

## M2 — Focus loop and durable saves

Branch: `feature/focus-and-persistence`

Implement custom durations, presets, start/pause/resume/complete/cancel, optional breaks, calm mode, controlled-clock timer recovery across focus/sleep, configurable focus-to-sim ratio, history/statistics, notifications/sound controls, multiple SQLite save slots, autosave/manual save, seed visibility, import/export, immutable generations, corruption fallback, payload/database migrations, and bounded offline catch-up.

Acceptance: timer controlled-clock tests pass; interruptions never destroy civilization state; save/load and every migration fixture round-trip canonically; corrupt head recovers from an older verified generation; one desktop E2E starts, pauses, resumes, saves, exits, reloads, and completes a session; recap contains only logged events.

## M3 — Autonomous survival, agents, and construction

Branch: `feature/autonomous-settlement`

Implement individual needs, traits, skills, age/health, relationships, summarized memories, personal/communal goals, knowledge, utility/GOAP hybrid decisions, emergent occupations, gathering/storage/transport, food/water/shelter/health/safety, autonomous building demand/site selection/material acquisition/construction/repair/expansion/repurposing/abandonment/demolition, and travel-demand paths.

Acceptance: founding agents survive and autonomously create a viable settlement without player building/job input; choices vary by geography, traits, social state, and deterministic randomness; construction progress and condition are visible; property tests enforce resources, ownership, living-agent actions, placements, finite values, and references across at least 100 cases per PR. Locked M3 evidence uses at least three deterministic seeds through 60,000 ticks, requires every founder alive with sustainable food/water activity and an operational shelter, and proves equivalent results across tick partitions. A 15,000-36,000-tick representative focus window must show a few factual developments and visible incremental construction without completing later societal progression. Packed Worker projections, accessible text, canonical v2 snapshot migration/round trips, real-Worker browser coverage, and save/reload continuation must expose the same authoritative agents, structures, condition, progress, stores, and events. No build or job controls are added.

## M4 — Economy, generations, society, culture, and history

Branch: `feature/living-societies`

Implement production chains, scarcity/surplus, local exchange, specialization, transport, births/aging/deaths/generations, families or cultural equivalents, migration, social groups, leaders/institutions/government change, cooperation/disagreement/crime/conflict/reconciliation, inequality/stability, generated names, beliefs/philosophies/traditions/architectural styles, biographies, event-grounded timeline, and factual session recaps.

Acceptance: the checked-in M4 scenario catalogue fixes seeds `[1,2,3,4]`, `[101,202,303,404]`, and `[4294967295,0,2147483648,17]` as viable accelerated multi-generation worlds through 600,000 ticks; `[77,88,99,111]` as the scarcity/control comparison through 240,000 ticks; and `[31337,4242,9001,17]` as economic/social collapse and autonomous recovery through 600,000 ticks. Expected canonical hashes are locked in tests after implementation. Accelerated worlds persist a 5,000-tick civil year; normal worlds persist a 100,000-tick civil year so the representative 15,000-36,000-tick focus window remains incremental and founding-scale rather than compressing generations into one session.

All three viable worlds must contain stable generated names, founder/child/grandchild-or-later cohorts, valid family-or-equivalent links, births, aging, deaths, inheritance or knowledge continuity, and at least two inspectably distinct cultural identities. The scarcity world compares the same pre-shock checkpoint against a control and proves a recorded input shortage changes production, stores, exchange, transport, prices, and affected people's work, movement, needs, health, or holdings. The recovery world records economic/social decline, loss of population/capacity/production/stability, and autonomous recovery without a fixture reset, invented resource, M5 disaster, or M6 conquest.

Production chains conserve declared inputs/outputs; household ownership, offers, credits, specialization, and carried transport are graph-valid; migration is explicit; leadership, institutions, government change, cooperation, disagreement/crime/conflict, reconciliation, inequality, and stability are deterministically exercised with total tie-breakers. Every biography claim, timeline row, and recap item resolves to an immutable typed source event whose saved factual summary and participant references match. Canonical v3 round trips, v2 migration without invented past events, corrupt-head recovery, partition/save/Worker equivalence, at least 100 property cases, bounded memories/projection pages/queues, long-run activity, and operation-count baselines pass. React exposes keyboard-accessible biographies, economy/culture/settlement dashboards, timeline pages, and factual recaps after reload; browser and native flows pass reduced-motion, text-scale, and non-color status checks. M4 establishes an intermediate baseline only and does not claim M8's release-scale targets.

## M5 — Contextual technology and disasters

Branch: `feature/emergent-technology-disasters`

Implement a contextual knowledge graph whose discoveries depend on prior knowledge, materials, pressures, skilled people, institutions, trade, conflict, experimentation, accidents, and controlled RNG; knowledge loss/recovery; drought, flood, fire, storm, earthquake, disease, famine, resource collapse, political crisis, technological accident, and meteor impact; limited weather/resource/organism/omen/artifact/protection/disaster/alien-signal interventions.

Acceptance: multiple fixed seeds demonstrate different branch order, specialization, delay/skips, and occasional knowledge loss; technologies never violate contextual requirements; each disaster arises from modeled conditions, changes inhabitants/world/economy, and admits autonomous response/recovery; interventions alter conditions without selecting exact outcomes.

## M6 — Multiple settlements, civilizations, diplomacy, and conflict

Branch: `feature/multiple-civilizations`

Implement autonomous settlement founding, trade routes, cultural divergence, diplomacy, alliances/rivalries, conflict/war, conquest, federation, fragmentation, coexistence, ruins, historical layers, migration/refugees, and settlement-to-settlement markets.

Acceptance: long fixed-seed worlds produce multiple independent communities; at least two peaceful and two conflict outcomes are deterministically reproducible; trade and disruption are visible; territory/history remain valid after conquest, federation, collapse, and abandoned ruins.

## M7 — Visual eras, inspection, and accessibility

Branch: `feature/visual-world-accessibility`

Deliver Pixi render batching/culling, visible agents/construction/buildings/roads/districts/farms/industry/infrastructure/ruins, era/culture/environment/material/wealth/damage/age visual variation, weather/time/disaster effects, resource/population/trade/technology/danger overlays, selection/inspection, focus recap, keyboard-first primary controls, scalable UI, reduced motion/effects, color-accessible palettes, volume, simulation speed, and local-data explanations.

Acceptance: deterministic visual baselines cover founding, town, industrial, disaster, advanced, and space scenes; all primary controls work by keyboard; WCAG AA contrast is measured for interface text; reduced-motion mode removes nonessential motion; real app remains calm and legible at 100%, 150%, and 200% scaling.

## M8 — Scale and authoritative aggregation

Branch: `feature/simulation-scale`

Implement deterministic settlement/population LOD independent of camera position, event-driven schedules, aggregation/deaggregation conservation, cached hierarchical paths/flow fields, fixed work quotas, projection deltas/transfer buffers, backlog telemetry, and benchmark/soak harnesses.

Acceptance on the documented CI reference machine: 5,000 detailed agents sustain 10 ticks/s with p95 tick under 50 ms and p99 under 100 ms; 100,000 aggregate residents preserve key totals; projection application p95 under 8 ms and payload under 4 MiB; peak heap under 512 MiB; no >25% median regression that also breaks an absolute budget.

## M9 — Planetary civilization and space age

Branch: `feature/planetary-space-age`

Implement advanced energy and planetary engineering, planet-scale travel abstraction, contextual spaceflight, spacecraft/orbits/missions, a generated star system and celestial bodies, communication/travel delays, autonomous colonies, cultural divergence, interworld exchange, alien life/civilizations, and diplomacy/cooperation/competition/conflict in space.

Acceptance: accelerated deterministic worlds can autonomously progress from founding through advanced cities to orbit and another world; missions, ships, orbital activity, colonies, transfers, delays, alien contact, and consequences are visible and present in history; at least two seeds demonstrate materially different space development and encounter outcomes.

## M10 — Content coherence and long-run hardening

Branch: `release/v1-content-hardening`

Balance all systems, expand procedural names/cultures/architecture/event descriptions, finish original or licensed assets/audio, run 25+ fixed seeds through long horizons, fix inactivity/runaway population/resource corruption/deadlocks/performance collapse, and complete controls, simulation-rules, licensing, limitations, and troubleshooting documentation.

Acceptance: every explicit product area has functioning non-placeholder content; long runs cover collapse and recovery, multiple societies, divergent technology, disasters, advanced cities, and space; no critical/high correctness issue remains; all asset attribution is complete.

## M11 — Release candidate and clean verification

Branch: `release/v1.0.0-rc`

Freeze save/content versions and release notes. From a clean checkout: install; run the full validation suite; build the Windows NSIS artifact; launch/install it; create a world; complete an accelerated focus session; observe autonomous gathering/construction; verify eras, disaster/recovery, multiple settlements, seed divergence, space, save/reload, accessibility, performance, and uninstall/reinstall continuity where intended.

Acceptance: evidence for every final-verification step is recorded; an independent final code/product review finds no unresolved release blocker; all fixes are revalidated; main CI is green; artifact checksum and SBOM are produced.

## M12 — v1.0.0 release

Branch: `release/v1.0.0`

Synchronize versions, merge the green release candidate, tag the exact main commit `v1.0.0`, build from that tag, create the private GitHub release with notes/checksum/SBOM/usable Windows x64 installer, smoke the downloaded artifact, and publish only after manifest verification.

Acceptance: private repository history is complete; tag and release exist; repository/release links, installation steps, supported platform, CI/test evidence, architectural decisions, non-blocking limitations, and demonstrated civilization progression are ready for the final report.
