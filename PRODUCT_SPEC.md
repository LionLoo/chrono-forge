# Chrono Forge v1.0 product specification

This is the authoritative product definition and acceptance contract. `PLAN.md` supplies implementation detail; neither it nor `ROADMAP.md` may weaken this document.

## Promise and player role

“Focus on your work while another world builds itself.”

Chrono Forge is a visually rich, local-first desktop focus timer and autonomous civilization simulator. Starting or resuming focused work advances a seeded world. Inhabitants—not the player—normally choose work, ordinary buildings, sites, settlement growth, social organization, and technology. The player observes, inspects factual history, and may use limited condition-changing interventions. Interrupting focus is non-punitive: progression pauses or slows and never destroys the civilization.

### Core product enjoyment

A typical 30–60 minute focus session produces noticeable but appropriately small civilization progress, reveals a few meaningful recorded developments, remains interesting without demanding attention, ends with a concise factual recap, and is polished and frictionless to start. Major settlement, societal, technological, and historical progression remains gradual and earned across many hours and many sessions. Check periodically: “Would a user want to return to this same world over many hours of work?”

## Required v1 systems

### Focus and recap

Custom durations and useful presets; start, pause, resume, complete, cancel, and optional breaks; calm focus mode; sound/notification controls; focus history/statistics; configurable real-to-sim time; reliable recovery across focus changes and system sleep where possible; post-session recap grounded exclusively in actual event IDs.

### Autonomous people and decisions

Individuals have needs, traits, skills, age, health, relationships/family or cultural equivalents, summarized memories, personal/communal goals, emerging occupation, and bounded knowledge. A documented utility/goal hybrid uses needs, opportunities, geography, personality, social conditions, knowledge, plan cost, and deterministic randomness. Worlds must not follow one disguised script.

### Construction and settlements

People independently identify construction need, choose building type/site from terrain/resources/safety/transport/neighbors/settlement needs, acquire materials, build over time, and repair, expand, replace, repurpose, abandon, or demolish. Demand/planning creates paths and roads. Settlements visibly evolve through shelters, villages, towns, cities, advanced cities, and off-world colonies. Architecture reflects culture, environment, material, technology, wealth, damage, and age.

### Procedural world and environment

Seeded reproducible terrain, water, climate/biomes, resources, habitability/danger, plants/animals at appropriate abstraction, environmental change, and meaningful natural constraints.

### Economy and survival

Food, water, shelter, health, safety, gathering, storage, transportation, production chains, scarcity/surplus, local exchange/trade, specialization, inter-settlement trade, and disruptions from disasters, conflict, migration, and technology. Important changes must affect visible inhabitants and world state, not only hidden counters.

### Population and society

Birth, aging, death, generations, relationships, families/equivalents, migration, groups, leaders, institutions, cooperation, disagreement, crime, conflict, reconciliation, emergent/changing government or coordination, inequality, stability/social pressure, named important people, and inspectable biographies.

### Persistent interpersonal relationships and family life

V1 must maintain a sparse, bounded, persistent interpersonal graph rather than treating social life as parent IDs, household membership, settlement-wide averages, temporary counters, or one generic bond. As culturally appropriate, people can become acquaintances, friends and close friends, rivals or enemies, mentors or proteges, romantic or equivalent partners, long-term partners or spouses, separated/broken-up/divorced former partners or equivalents, estranged relatives, reconciled relatives, and widowed survivors. Bonds have durable identity and history; they can form, strengthen, weaken, change type, end, reconcile, and remain influential over decades. Parent-child, sibling, household, and practical extended-kin connections must be meaningful and inspectable beyond genealogy alone.

Relationship formation and change arise autonomously from personality and traits, compatibility, proximity, repeated interaction, shared work, memories and recorded experiences, culture, kinship, cooperation, conflict, scarcity, disasters, migration, political or social events, and controlled deterministic randomness. Important positive and negative experiences between the same people affect their future bond and choices. Household membership evolves as people mature, partner, separate, migrate, care for family, or have children, allowing recognizable families and lineages to emerge across generations.

Relationships must materially influence person-specific behavior, including preferred cooperation and help, resource sharing and caregiving, household and partner formation, culturally appropriate reproduction, migration, knowledge transfer, political support and faction formation, retaliation and conflict, reconciliation, crisis protection or assistance, and inheritance or family resource transfer where applicable. Births must arise from an established relationship, household, or explicit culturally appropriate family structure recorded by the simulation—not from an arbitrary eligible-adult pairing. The model may remain biologically abstract and culturally flexible.

Deliberate inspection must expose a person's parents, children, siblings, partner or equivalent, relevant former partners, household members, close friends, rivals or enemies, and other especially significant bonds. A relationship view must make its type or roles, underlying state, strength, direction of change, beginning, and significant shared source events understandable where applicable. Biographies and history may describe significant relationship changes only from recorded factual events, supporting readable multi-decade lives without cluttering normal focus mode.

The graph, genealogy, household state, relationship RNG streams, and source-event references must be deterministic, canonical, migration-safe, and fully persistent across save/load and version upgrades. Work and storage must be proportional to represented salient edges and indexed kin/household records, never every possible pair; bounded detailed state and explicit aggregation rules must remain compatible with M8 scale targets.

### Culture and factual history

Generated personal/settlement/civilization names, preferences, beliefs/philosophies, architectural styles, traditions, institutions, alliances/rivalries, discovery, disaster, migration, war/peace, golden ages, decline, collapse, and recovery. A browsable timeline and recaps may state only events the simulation recorded.

### Contextual technology

Branching/emergent discovery depends on existing knowledge, available materials, environment, skilled people, institutions, trade, conflict, accidents, sustained experimentation, and controlled randomness. Development spans primitive survival, agriculture, industry, information technology, advanced energy, planetary engineering, and spaceflight. Worlds can specialize, skip/delay branches, and lose knowledge through collapse; there is no rigid universal ladder.

### Multiple societies

Autonomous settlement founding and migration, independent communities, trade routes, cultural divergence, diplomacy, alliances, rivalries, conflict/war, conquest, federation, fragmentation, coexistence, ruins, and historical layers.

### Disasters and optional interventions

Model context-sensitive drought, flood, fire, storm, earthquake, disease, famine, resource collapse, political crisis, technological accident, and meteor impact. Optional weather/resource/organism/omen/artifact/protection/disaster/alien-signal interventions change conditions without prescribing the civilization's exact response.

### Visual experience

Smooth animated 2D world; responsive location-anchored pan/zoom from a civilization overview into distinct settlements, districts, homes, structures, and visible people; readable terrain/resources; stable factual character identity and activity; construction progress; era/condition buildings, roads, districts, farms, industry, infrastructure, ruins, advanced structures, weather/time/disasters/environment; resource/population/trade/technology/danger overlays; inspection of people/buildings/settlements/events; timeline and recap; calm non-demanding focus presentation. The v1 result must read as a polished, cohesive game rather than a debug dashboard or circle-and-block placeholder view. Assets must be original, generated, procedural, or appropriately licensed and attributed.

The release world must provide a substantially larger civilization canvas than the 96x64 development baseline: the default v1 surface is 256x192 authoritative tiles. The generated homeworld is one continuous surface; civilizations and their territories are the world's countries or polities and expand across that shared map rather than opening unrelated country maps. The camera begins at a readable founding-region scale and the player can always pan, zoom, select, and return to civilization-wide context without camera state changing simulation outcomes.

### Sound, atmosphere, and game feel

Quiet-by-default, optional local audio and restrained atmosphere may communicate actual focus actions, selection, construction/progress, danger, discovery, session completion, and recorded major events without affecting authoritative timing or outcomes. Persist master, music/ambience, effects, mute, calm, and reduced-effects choices; provide redundant visual/text cues; degrade silently when audio is unavailable; and use only original or properly licensed and attributed sounds. The result should make the world feel present without distracting a working user.

### Scale

Fixed deterministic ticks, spatial indexing, validated authoritative aggregation/LOD, event-driven schedules, off-thread simulation, cached/incremental pathfinding, and reduced-detail behavior keep growing worlds responsive. Near/detailed and aggregate transitions conserve key state. Benchmarks and thresholds prevent regressions.

### Planetary and space age

Advanced planetary civilization, planet-scale travel/abstraction, spaceflight research, spacecraft, orbit, missions, additional celestial bodies, autonomous colonies, communication/travel delays, colony divergence, interworld exchange, alien life or civilizations, and space diplomacy/cooperation/competition/conflict. Higher abstraction is acceptable, but systems must be playable, visible, historical, and autonomously reached.

The primary world stage must offer an accessible **Surface** / **System** view switch. Surface renders the shared homeworld and its civilization territories. System renders a deterministic read-only projection of the actual saved star, celestial bodies, orbits, spacecraft, missions, colonies, travel and communication routes, and discovered alien civilizations. Selecting a body or route opens its factual inspector; undiscovered aliens and unrecorded activity remain absent. V1 does not promise a second tile-by-tile terrain simulation for every celestial body, and it never labels the procedural homeworld as Earth unless the saved authority actually defines it that way.

### Saves and offline behavior

Multiple slots, autosave/manual save, visible seed, safe version migrations, practical import/export, interrupted/corrupt-write recovery, configurable offline progression, and bounded summarized catch-up.

### Settings, accessibility, and privacy

Volume and visual-effect controls, color-accessible overlays, scalable UI, keyboard access to primary controls, reduced motion, pause/speed controls outside focus, clear local-data explanations, and no mandatory account or online service.

## Required evidence and invariants

Maintain unit, determinism, property/invariant, save round-trip/migration, controlled-clock timer, integration, accelerated long-run, benchmark, browser/desktop E2E, maintainable visual-regression, and production artifact smoke tests.

Release-blocking invariants: no unexplained negative resources; duplicate ownership; actions by dead/removed people; invalid building placement; broken save references; `NaN`/infinite authoritative values; same-input determinism drift; aggregation loss; context-invalid technology; or recap/history claims without recorded events.

Long accelerated runs across multiple seeds must detect crashes, deadlocks, runaway population, permanent inactivity, impossible resources, and performance collapse.

## v1.0 completion contract

Do not declare completion until all required systems above function without placeholders and evidence shows:

- a new player creates a world and focus session;
- representative 30–60 minute sessions provide satisfying factual feedback without compressing long-term civilization development;
- founders autonomously survive, gather, build, and expand while visibly constructing;
- multi-generation evidence shows persistent friendships, rivalries, partnerships or cultural equivalents, meaningful family bonds, dynamic households, relationship-grounded child arrival and decisions, and factual interpersonal life histories that remain inspectable after save/reload;
- normal buildings/jobs require no player assignment;
- multiple settlements/societies, contextual technology, disasters, interventions, collapse/recovery, advanced cities, space colonies, and alien encounters work visually and mechanically;
- factual history/recaps, saves, autosaves, offline catch-up, import/export, corruption recovery, and migrations work;
- documented target populations remain responsive and primary interfaces pass accessibility gates;
- no known critical/high correctness defect remains;
- formatting, linting, type checking, all automated test layers, accelerated simulations, E2E, performance gates, and production builds pass;
- main CI is green; production configuration is visually inspected; installation/release instructions are tested; architecture, rules, controls, development, testing, limitations, privacy, and licensing are documented;
- a clean checkout reproduces validation and the usable supported-platform artifact;
- the private repository has complete history, an exact `v1.0.0` tag, and a GitHub `v1.0.0` release with notes and artifacts;
- an independent final review has no unresolved release blocker.

Final verification must exercise: clean install/build; installed artifact launch; new world; accelerated focus session; gathering/construction; all major eras; disaster/recovery; multiple settlements; technology divergence across seeds; planetary/space progression; save-exit-reload continuity; accessibility/visual QA; independent review/fixes; rerun of the complete suite; green main CI; tag and release.
