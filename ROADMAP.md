# Chrono Forge roadmap

`PRODUCT_SPEC.md` is the product contract and `PLAN.md` contains the decision-complete acceptance criteria, branches, and validation for each item. Milestones run in this order:

Current checkpoint: M0-M7 are merged, independently reviewed, and hosted-verified on `main`. M8 implementation and local acceptance are complete on `feature/simulation-scale`; its reviewed PR, hosted CI, and merge remain required before M9. M8-M12 and the private v1.0.0 release remain fully blocking until their gates finish.

| Order | Milestone                                                    | Outcome                                                                                       |
| ----- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| M0    | Repository and architecture bootstrap                        | Reproducible toolchain, persistent harness/memory, desktop shell, tests, CI, private remote   |
| M1    | Deterministic world and simulation kernel                    | Seeded world, fixed ticks, RNG, worker, pathfinding, projections, determinism evidence        |
| M2    | Focus loop and durable saves                                 | Timer/breaks/history/recap, SQLite slots, recovery, migration, bounded offline progression    |
| M3    | Autonomous survival, agents, and construction                | Needs/decisions/occupations, economy foundations, autonomous settlement building              |
| M4    | Economy, generations, society, culture, and history          | Multi-generation living societies, institutions, identities, biographies, factual timeline    |
| M4.5  | Deep interpersonal relationships and family life             | Persistent social bonds, dynamic households, relationship-grounded families and life stories  |
| M5    | Contextual technology and disasters                          | Emergent knowledge branches/loss, modeled crises, indirect player interventions               |
| M6    | Multiple settlements, civilizations, diplomacy, and conflict | Trade, divergence, alliances, war, federation/fragmentation, ruins                            |
| M7    | Visual eras, inspection, and accessibility                   | Rich readable animated world, overlays/inspection, calm focus UX, full accessibility controls |
| M8    | Scale and authoritative aggregation                          | Deterministic LOD, conservation, path caches, transfer deltas, performance budgets            |
| M9    | Planetary civilization and space age                         | Autonomous orbit/missions/colonies/interworld exchange/aliens and space relations             |
| M10   | Content coherence and long-run hardening                     | Balanced complete content/assets/docs and multi-seed soak fixes                               |
| M11   | Release candidate and clean verification                     | Installed-artifact end-to-end proof, accessibility/performance QA, independent final review   |
| M12   | v1.0.0 release                                               | Green main, exact tag, private GitHub release, checksummed usable Windows artifact            |

No explicit v1 requirement may move to future work. Optional post-v1 ideas: signed/notarized macOS and supported Linux releases, authenticated updater hosting, mod/data-pack SDK, cooperative sharing, galaxy-scale expansion, localization, and optional store/cloud integrations subject to separate cost/account authorization.
