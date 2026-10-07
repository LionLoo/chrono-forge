# M10.7 backend bug-hunt evidence

## Contract and current status

- Branch: `release/v1-backend-bug-hunt` from exact merged and merge-head-green M10.65 main `dfb79527828f9fefe86cef4b2b5bcb96b6e3158c`.
- M10.7 remains active and release-blocking. This file records completed defect campaigns; it does not claim milestone acceptance before the complete backend matrix, independent final review, full local gate, exact-head CI, sequential merge, and exact merge-head CI pass.
- Campaigns must preserve deterministic Worker-owned authority, exact canonical reload, factual event provenance, population/resource/reference conservation, bounded work and queues, and fail-closed native persistence.

## Campaign 1 — mature M9 resolution boundaries

- Checkpoint `7723b4b5453c6641326d3810a8a64835e5f40275` adds a mature-space determinism property across mission, cargo, and communication due ticks. Twenty-four generated cut arrays per scenario form irregular partitions over 5,001 ticks, with canonical save/reload after every partition.
- The resumed worlds must equal uninterrupted authority byte-for-byte through canonical JSON, state hash, and exact new-event order. Full world invariants recheck population conservation, off-world/terrestrial resident disjointness, entity references, space validity, finite authority, and path/scale invariants; explicit assertions also retain every active/completed mission, cargo, and communication queue cap.
- The Worker integration loads a five-year mature M9 snapshot, advances to one tick before the next civil-year boundary, saves/reloads, crosses the boundary, requests factual history, saves/reloads at the boundary, and advances beyond it. The exact snapshots, event batch, request-scoped final timeline page, reconstructed read-only frame, and direct authoritative world must match.
- The initial Worker expectation incorrectly compared the one-tick boundary response with events emitted by the preceding 4,999-tick request. That test-only error failed visibly and was corrected to derive the expected response from the direct pre-boundary state; no product code changed.
- Focused validation passes 2 files/17 tests, type checking, zero-warning full lint and clippy, focused ESLint, formatting, and diff hygiene. Independent Terra/high review found one P2 coverage gap because the requested history page was not asserted. The exact request-ID-scoped page payload, bounds, total, entries, and order are now asserted; re-review reran 2 files/17 tests in 25.27 seconds plus typecheck, ESLint, formatting, and diff hygiene and reported no remaining finding.
- No authoritative product defect was reproduced in this campaign. The durable value is regression coverage for a previously unstressed cross-system resolution and Worker persistence boundary.

## Remaining release-blocking campaigns

- Stress the exact 5,000-detailed/100,000-aggregate release fixture through repeated population reconciliation and saturated path demand, irregular partitions, pending fallback work, and canonical reload. Require exact identity/population totals, valid traversal and references, cache/work bounds, and direct-versus-resumed equality.
- Add a historical SQLite schema matrix for realistic v2, v4, v5, and v7 databases. Migrate each through v8 twice, then load, commit, recover, and export while proving idempotence, valid authority preservation, conservative defaults, and retention safety.
- Continue corrupt/historical candidate, Worker validation/interleaving, focus/offline accounting, civilization/disaster/family, Rust command, and installed-desktop persistence campaigns until the M10.7 acceptance matrix has no known critical or high-severity backend defect.
