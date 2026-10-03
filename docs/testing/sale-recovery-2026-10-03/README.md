# SALE-RECOVERY-01 — original-sale recovery candidate

Implementing human/workstream: @wbdevworld / WS3. Independent human approval remains pending. AI review is source evidence only. The release exception for the completed receipt/UI candidate does not authorize this new order-recovery rollout.

## Observed defect

Read-only staging evidence and the owner's Manager screenshot confirmed that the sale lookup succeeded but the existing order remained `requires_attention`, with the original quote expired and no local prepared-sale record. The client hid the nonterminal recovery result; its original-prepare retry only repeated a lookup. No live order, payment, stock, receipt, journal or draft was changed during diagnosis.

## Resulting behavior

- Check / Recover reads status and shows a locally authored result. Authentication restoration keeps local work and bounds automatic inbox refresh to its original context.
- A matching original local prepare command and checkout attempt can offer explicit Repair this sale. It replays the original payload, key and transaction, including the frozen customer snapshot.
- The BFF verifies original command ownership, frozen intent/economics, the same unpaid order, absence of payment/receipt/cash/finalize/cancel evidence and a real finite future reservation. GET performs no bridge repair. New expired quotes and alternate preparation keys remain refused.
- Successful explicit repair writes the same durable attempt at payment choice before acknowledging its journal. Lost responses, changed context/attempt and invalid results retain unresolved evidence. No repair path calls payment or finalization.
- Prepared seeding is insert-if-absent, so a delayed repair cannot replace a concurrent payment state. Expired reservations refuse first new payment effects while existing cash/intent reconciliation remains possible.
- Manager authority does not waive order identity, original local authorship, active scope, or payment evidence checks.

## Pinned baseline and provenance

The consumed UI/receipt baseline is PR #136, source `14a56f0a8f985dd596d576712487a605f134d935`, tree `5299cd7d68cfbab9cf9ab7af66c7f38118fd61af`. Source and tracked images were imported exactly before recovery edits. Receipt and peer UI paths remain unchanged by this task. The published recovery commit must have that actual remote source as its parent; local synthetic import history is not remote ancestry.

| Contributor source | Imported local commit | Scope |
| --- | --- | --- |
| `1a047ad` | `3f89fa8` | Original client repair, guarded handoff, recovery feedback |
| `222aea24` | `688949d` | Explicit original-order server repair and refusal tests |
| `ea649f6` | `b24a256` | First-write-wins prepared seeding and concurrent payment test |
| `2d22f9c` | `740b1c2` | Bounded materialization diagnostic eligibility |
| `b54e1c1` | `f1ee4a3` | Fully persisted lost-response recovery |
| `1ccd9b5` | `e0bb6e5` | Expiry guard before first new payment effect |
| `a0a67fb` | `0f64491` | Bounded inbox auth refresh and stale prepared-response preservation |
| `eea6243` | `88f3317` | Current unpaid-state guard on acknowledged preparation replay |

All contributions are WS3-owned, isolated-worktree progress checkpoints under the recorded task lease. Root maintains staff guidance, shared fixtures, combined verification and final two-pass freshness. Contracts, migrations, dependencies, environment and CI/release configuration are unchanged.

## Verification and limits

The exact remote head and CI result belong in the PR handoff. Local production browser verification passes all 50 tests, including the five focused recovery cases; client source is unchanged by the final server replay guard. Final combined `pnpm --dir apps/pos-web test` passes 1,573 tests across 196 files; `pnpm --dir apps/pos-web build` passes. Local app checks run with `TZ=UTC` to match the receipt timestamp fixtures. App lint passes with zero errors and five inherited warnings; typecheck, foundation and 76 tooling tests pass. Focused production-browser fixtures cover manager original repair, both lost-response states, expired sign-in with saved work and persistent inbox authorization failure. These fixtures are synthetic and take no payment.

A first full browser run revealed that the authenticated shared fixture left its inbox unmocked, yielding contradictory session-200/inbox-401 responses and triggering repeated authentication refresh. The shared fixture now consistently mocks its authenticated inbox; a separate regression intentionally retains session-200/inbox-401 to prove the automatic refresh is bounded. Original browser assertions remain intact. Generated inherited screenshot/HTML/bridge fixtures are restored after verification.

Local PHP and local database runtimes are unavailable. Bridge PHP/parity and PostgreSQL/RLS acceptance depend on the unchanged required Linux CI job; no local pass is asserted for those checks. No real operator repair or thermal-printer acceptance is claimed.

Supabase verification: the staging table has `PRIMARY KEY (transaction_id)` and `UNIQUE (organization_id, sale_id)`, confirmed by a read-only constraint query. PostgREST's documented conflict-ignore insertion preserves duplicates; the store reads the actual retained row afterward. Supabase changelog index and relevant PostgreSQL/Data API breaking-change entries were inspected; this existing table/API and built-in conflict handling do not need schema/grant changes. No live POST acceptance was performed.

- [PostgREST conflict handling](https://docs.postgrest.org/en/v13/references/api/tables_views.html#upsert)
- [Supabase upsert reference](https://supabase.com/docs/reference/javascript/upsert)
- [Supabase changelog](https://supabase.com/changelog)

## Freshness and release

START: `2026-10-03T03:33:09.628Z`; main `c49045dd02c46574af5d341cc65c177116fa7306`; declared `integration/r9-staff-remediation-final` `1021cd113c783e25030fe9c0bda1be9ddcf5888c`. Final Pass 1 / Pass 2 and exact candidate CI are pending; no completed freshness label is asserted here.

Same tester origin must remain `https://cetech-pos-staging-git-integration-9578df-wbdevworlds-projects.vercel.app/`. Rollout requires different-human source approval or a new explicit owner exception for this tested staging candidate. Keep normal protections, main/integration branches and production unchanged. Deployment alone must not invoke the live sale repair; the operator selects the qualified action on their original saved attempt.
