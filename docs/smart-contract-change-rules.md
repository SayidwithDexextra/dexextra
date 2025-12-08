# Smart Contract Change Rules

Guidelines that MUST be satisfied before merging any smart contract changes.

## Critical invariants
- Liquidation pipeline integrity: no change may alter, bypass, or slow any step in the liquidation flow (trigger conditions, index updates, liquidation accounting, event emission, settlement).
- Socialized loss pipeline integrity: no change may disable, bypass, or divert socialized loss calculations, funding, or settlement.
- Behavior consistency: navigation flows and socialized loss behavior must remain consistent across all entry points (happy path and failure cases).
- Contract size discipline: prefer minimal bytecode growth; target smallest possible deployed size for each facet/contract.

## Required pre-merge actions
1) Impact analysis
   - Map touched functions to liquidation and socialized loss call graphs; confirm no new side effects or reordered calls.
   - Verify storage layout compatibility for all upgraded contracts/facets (no slot collisions, added variables only at end).
2) Code review checklist
   - Confirm revert/require conditions remain unchanged for liquidation triggers and socialized loss distribution.
   - Confirm events and accounting math remain identical or explicitly justified.
   - Confirm no external calls were added inside critical liquidation or distribution loops.
3) Size control
   - Remove dead code, inline only when it reduces bytecode, and prefer libraries/facets for reuse.
   - Avoid needless state writes; keep structs lean; gate feature additions behind size-neutral refactors.
4) Deployment safety
   - Document any expected behavioral deltas; if none, explicitly state “no behavioral change”.
   - Provide a rollback plan and post-deploy checks for liquidation and socialized loss flows.

## Must-not changes
- Do NOT modify liquidation thresholds, sequencing, or settlement ordering without explicit approval and new tests.
- Do NOT alter socialized loss share calculations, caps, or distribution recipients without explicit approval and new tests.
- Do NOT introduce growth-only storage patterns that expand contract size without offsetting reductions.
- Do NOT change any view function signatures, outputs, or semantics that the frontend depends on unless coordinated with frontend owners and explicitly approved.
