# M10.1 focus-session engagement evidence

This file locks the observable M10.1 contract and records its delivery evidence. It supplements `PLAN.md` without weakening it.

## Product boundary

- Accepted focus time remains the only direct player action that advances the live world. Merely observing, moving the camera, opening inspectors, or changing settings cannot issue simulation ticks. Explicit bounded offline progression remains a separately labelled persisted policy.
- The Worker remains the sole owner of mutable world state. A session review is a bounded immutable read model captured beside the exact save checkpoint; React may compare and display it but may not infer new simulation history or change an outcome.
- A recap event is still admitted only by authoritative event ID, tick, summary, and source references. M10.1 adds factual before/after state, not synthetic events, achievements, streak pressure, currency, quests, or fabricated rewards.
- Major societal progression remains gradual. Normal-world 25-, 50-, and 60-minute sessions issue exactly 15,000, 30,000, and 36,000 ticks at the default pace of ten ticks per accepted focus second.

## Versioned session-review contract

The Worker must produce one exact checkpoint response containing the canonical snapshot plus a bounded version-1 session moment from the same authoritative state. A moment records integer facts needed to explain session-scale continuity:

- logical tick;
- detailed and total population;
- food, water, timber, and stone stores;
- operational structures, active construction, households, scarcity, and stability;
- active settlements, civilizations, routes, conflicts, crises, and ruins;
- the leading active settlement's stable ID, name, and factual development stage;
- off-world population, active missions, active colonies, and contacted alien civilizations.

The first durable checkpoint for a new session locks the `before` moment and the latest pre-session event ID. Later checkpoints preserve that baseline and update only the exact `after` moment, up to twelve post-baseline authoritative event copies, and one bounded optional revisit target. A completed review survives save/reload and slot switching with its own slot. Legacy sessions without a review remain readable and gain no invented baseline.

Revisit selection is deterministic: prefer the newest recap event's still-referenceable person, structure, settlement, route, or ruin; otherwise prefer active construction, then an active named settlement, then a living named person. The saved label and stable ID describe the captured end state. Opening a revisit is optional, opens deliberate inspection, and never advances or mutates the world.

## Observable recap behavior

- Before starting, the focus surface names the active persistent world, current tick, settlement stage, and what accepted focus time will do.
- During focus, the timer and a compact current-world line remain calm and readable; optional inspection remains closed by default.
- After completion, the latest review states accepted duration and exact tick interval, lists a small deterministic set of nonzero before/after changes, quotes only authoritative session events, and offers the bounded revisit route when available.
- If no event occurred, the review says that no major event was recorded. It still shows exact tick/state continuity when facts changed and never substitutes celebratory or dramatic prose.
- A cancelled session retains accepted-time accounting and world durability but is not counted as a completed-session return-value recap.

## Locked deterministic evidence

- **Early world:** seed `[1,2,3,4]`, normal 100,000-tick civil year, consecutive 25-minute sessions at the default pace. Each session advances exactly 15,000 ticks, produces a canonical checkpoint, and reports only actual construction/resource/population changes or an honest quiet interval.
- **Growing world:** the same seed resumed from a canonical middle checkpoint, including a multi-day wall-clock gap with offline progression disabled, then consecutive 50-minute sessions. Each session advances exactly 30,000 ticks; reload preserves baseline, event provenance, and review copy.
- **Late/space world:** `concord-orbit` seed `[7,11,13,17]` at the established accelerated 240-year checkpoint, followed by consecutive 60-minute equivalents. Each advances exactly 36,000 ticks, retains real space authority, and exposes factual late-world continuity without compressing the historical arc.
- Controlled-clock UI tests cover one eventful completion and one event-quiet completion, durable notification ordering, keyboard-visible revisit, slot scoping, and remount/reload.
- Protocol, TypeScript persistence, Rust/SQLite migration, native relaunch, and browser E2E tests reject malformed or oversized reviews, mismatched recap sources, changed slot authority, and tick/accounting inconsistency.
- Independent product review must use the real focus loop and answer whether a user receives a credible, calm, factual reason to return to the same world over multiple sessions.

## Delivery gate

M10.1 is complete only after focused and full local gates, real browser and native visual/interaction QA, independent exact-diff review, green aggregate `Required` CI at the final head, resolved review threads, and sequential merge. M10.2 and every later release gate remain independently blocking.

## Implementation checkpoint

- Worker protocol v10 adds `requestFocusCheckpoint`, returning the canonical snapshot and bounded review projection from the same authoritative state. The UI rejects and cleans up pending requests on Worker faults or termination.
- `src/focus/session-review.ts` owns the version-1 moment, exact event copies, deterministic revisit selection, strict bounds, and exhaustive entity-kind behavior. React displays only this persisted read model and maps revisit selection to the existing read-only inspector.
- TypeScript persistence accepts legacy absent reviews but strictly validates new review shape, tick accounting, post-baseline recap IDs, revisit provenance, exact saved-world tick, and deep-clone isolation.
- Native SQLite schema v6 adds nullable `review_json` plus the originating checkpoint generation and a checksummed canonical authority copy. Later saves can prune large world generations without erasing a legitimate completed review; a changed or corrupt standalone history copy cannot supply before/after claims. Rust duplicates the transport-bound validation needed before durable writes and preserves legacy rows as review-less history.
- The production observation button is removed. Restorable active or paused sessions suppress ordinary offline catch-up so elapsed time cannot enter both clocks.
- Browser and native focus flows use controlled clocks and actual accepted sessions; they assert exact tick issuance, save/relaunch continuity, event-source equality, honest quiet copy, and keyboard revisit behavior.

## Validation checkpoint

- Formatting, zero-warning TypeScript/Rust lint, and type checking pass.
- Covered non-long suite: 62 files/440 tests in 257.51 seconds; 87.93% statements, 80.63% branches, 93.60% functions, and 89.70% lines.
- Rust: 22/22. Browser E2E: 6/6. Native SQLite/desktop E2E: 3/3 on schema v6, including the real relaunch path and durable review-authority envelope.
- Dedicated early/growing focus catalogue: 2/2, including consecutive 25- and 50-minute equivalents, canonical reload, and a simulated multi-day gap with offline progression disabled.
- Locked 240-year late-world catalogue: 1/1 in 436.84 seconds, including two consecutive 60-minute equivalents with preserved space authority.
- Aggregate long catalogue: 14 files/31 tests, including the new focus evidence and every retained M3-M10 long-run contract; the prior measured checkpoint completed in 1,676.81 seconds.
- Real browser visual/interaction QA at a 1440×900 desktop viewport completed an actual accepted-time session, inspected the quiet recap, and verified that revisit smoothly scrolls to, focuses, and selects the exact settlement. The first pass exposed nine unchanged fact cards; the accepted correction now shows only up to six nonzero factual changes or one calm unchanged-state sentence. Focused UI rerun: 2 files/25 tests green.
- Independent Terra/high review first found that history review facts were not re-derived from the saved checkpoint and that 25/50/60-minute evidence bypassed the real controller path. The controller-to-Worker-to-persistence test and saved-head reprojection closed those paths. Rereview then found standalone history still unbound and correctly rejected a head-only fix that would erase review continuity. Schema v6 now persists the originating generation plus a checksummed canonical authority copy; focused web 44/44, Rust 22/22, real desktop 3/3, and final independent rereview are green with no release-relevant finding.
- The complete exact-tree `npm run ci` chain passed and generated a 1,051-component SBOM (770 npm, 281 Cargo), rebuilt the 3,108,328-byte unsigned x64 NSIS installer, and verified that the production bundle contains no WDIO bridge, test capability, or global Tauri API. The generated installer SHA-256 is `A6D7D199C120B5D58E6C849FEBD4A1E3C02B5937DE729E81265C96974228B311`; this is milestone evidence, not the final v1 release artifact.
- This runtime exposes browser but not native-window visual attachment. Native product behavior is therefore evidenced by the passing real desktop WebView/SQLite interaction suite; final-head hosted CI and merge remain open at this checkpoint.
