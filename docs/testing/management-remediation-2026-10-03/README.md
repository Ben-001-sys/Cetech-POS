# Management remediation — 3 October 2026

MANAGE-REMEDIATION-01 is an owner-requested WS3 implementation and review handoff. The senior editor's bounded delegation covers the named management surfaces; Ben remains the independent human reviewer. AI review is supporting evidence, not human approval. The consumed SALE-RECOVERY-01 staging exception does not approve this new release.

## Candidate and preserved baseline

- Branch: `ws3/management-remediation-2026-10-03`.
- Deployed baseline: `51c0664d3ca96c5742ff6a2324a2fdf412dddd3b`, PR #137.
- Byte-identical local baseline: `cd36379e1930ef7acee8c487d2a204ef0bca30ae`, tree `f423e2ea1410a54b853b0b849a8bf2213aa4c51d`.
- The isolated local checkout has synthetic ancestry. Remote publication uses the exact local tree with the real deployed remote commit as parent; local synthetic history is not pushed.
- Current tester alias remains on the previous deployed baseline until a new explicit release decision. Final remote SHA, exact-head CI, freshness observations and release status are recorded in the PR handoff, avoiding a self-referential source hash.

## Implemented behavior

| Surface | Result | Preserved boundary |
| --- | --- | --- |
| Receipt settings | Shared organization defaults; sparse local overrides; explicit reviewed apply-to-all; reset a location to inheritance. Bulk layout application preserves local address, contact and tax details. | Legacy settings remain until an explicit reset/bulk action. Location names remain actual location names. Completed receipts retain immutable presentation snapshots. |
| Staff and access | Auth metadata maps to POS actors and organizations; bounded complete pagination; email, login state and last sign-in; filters and confirmed deactivation/reactivation. | No email identity merge, hard deletion or live access changes. Self-disable and last usable owner removal fail closed. |
| Locations/registers/devices | Confirmed deactivation/disable and reactivation, truthful failures and retained editing controls. | Historical references remain. Open, closing and attention shifts block removal. New shifts/preparations reject inactive parents. |
| Returns | Pure read-only exact saved-return review; existing scoped approval/refund reconciliation actions; expired previews shown as history. | Organization administration does not grant operational money authority. No new refund/restock engine and no effects on detail GET. |
| Hanging sale | Authorized location managers can inspect and explicitly repair an original unpaid sale without the cashier's browser journal, only when server reconstruction matches its durable original hash. | Original transaction/key and frozen economics; no new sale or payment; terminal, payment, cancellation, ambiguous or incomplete proof blocks repair. |
| Loading/status | Loaders match each management surface at phone/tablet/desktop widths; bounded fetch/body timeouts; actionable failure copy; repeated selection does not strand the screen. | No fabricated healthy status or cleared browser storage. |

Manager repair reads are pure. POST checks current operational authority and original evidence again after recording its requested audit entry. If repair creates a previously absent local preparation record, its actor is truthfully the recovering manager; an existing cashier's history is never rewritten. Payment is a later explicit business action using the original register and matching original cart.

## Additive migrations

Allocated through the Supabase CLI after documented telemetry opt-out; no live application in this task:

1. `20261003072147_management_receipt_shared_defaults.sql`: nullable organization receipt scope, sparse local JSON overrides, serialized shared-layout operations.
2. `20261003072434_management_topology_lifecycle.sql`: active-parent and unresolved-shift safeguards with consistent location/register/device locks; original shift trigger stays security-invoker. The narrow security-definer helper only validates and locks authorized topology.
3. `20261003072537_management_staff_owner_safeguard.sql`: fresh caller authority, self/last-owner safeguards and serialized membership/access mutations.

Their pgTAP files exercise receipt legacy preservation and hierarchy, inactive parents and historical shifts, authorization and owner/access safeguards. Static SQL review addressed a legacy full-row overwrite, organization-lock/FK compatibility and topology lock ordering. Local Docker/PostgreSQL was unavailable; runtime migration reset/pgTAP must pass on this exact candidate in Linux CI. True overlapping database timing remains unverified by the sequential pgTAP cases.

## Qualification evidence

Pinned environment: Node `24.21.0`, pnpm `12.4.1`, Next `16.3.4`, `TZ=UTC`. App checks run from `apps/pos-web`; repository checks run from the repository root. Local dependencies were copied from the existing installed snapshot into this isolated checkout so Turbopack would not follow symlinks outside its filesystem root. No dependency, lockfile or configuration change was made.

| Check | Command | Result |
| --- | --- | --- |
| Foundation/contracts | `python3 scripts/verify_control_plane.py` | PASS: 3 packages, 30 tasks, 28 references, 83 schemas, 68 fixtures and generated contract checks. |
| Tooling | `python3 -m unittest discover -s tests/tooling -v` | PASS: 76 tests. |
| App units | `TZ=UTC node node_modules/vitest/vitest.mjs run` | PASS: 1,718 tests in 206 files. |
| Client deadline/envelope coverage | `node node_modules/vitest/vitest.mjs run src/app/management-client.test.ts` | PASS: 13 tests. |
| Typecheck | `next typegen` and `tsc --noEmit` through the installed package binaries | PASS. |
| App lint | `eslint .` through the installed package binary | PASS: no errors; five existing unrelated warnings. Latest changed browser/runtime files also passed focused lint. |
| Production build | `TZ=UTC node node_modules/next/dist/bin/next build` | PASS, including new scoped return detail and manager recovery routes. |
| Browser suite | `TZ=UTC node node_modules/@playwright/test/cli.js test` | PASS: all 72 tests, one worker, no retries; production server built by Playwright in the same execution namespace. |
| Whitespace | `git diff --check` | PASS. |
| Runtime SQL | Existing Linux CI Supabase reset and pgTAP steps | Pending exact remote head at source checkpoint; final result belongs in PR. |

The first browser run had 67/72 passing. Three failures exposed a real no-op receipt scope/location selection bug. Independent review found the same section-navigation bug; both were fixed with early no-op guards and retained regression coverage. Other failures were selectors that collided with Next's route announcer, ignored the Attention count badge, or used a wrapping label rather than the textarea's accessible role/name. A focused intermediate run had 10/11 passing before the final selector correction. A subsequent full run was interrupted to incorporate the section guard and is not counted as passing. The final full production browser run passed all 72 checks.

Tests exercise shared defaults, deliberate false/blank overrides, legacy reset cancellation, bulk local-detail preservation, empty locations, pending-save navigation and wrong-scope responses; manager repair without a local attempt, blocked proofs and delayed context changes; expired return previews, pure scoped detail, existing approvals, revoked/mismatched and late detail responses; deactivation/reactivation and blocked unresolved shifts; staff identity/filter controls; responsive loaders; and the retained cash, PWA, thermal-print and immutable receipt flows. Browser API fixtures and unit mocks are not live commerce evidence. Generated existing screenshot/bridge fixture changes were restored rather than committed as unrelated baseline updates.

## Live diagnostic limits

Read-only staging inspection found Auth identities linked by actor/organization metadata, with no missing email or unmatched operational references in the inspected directory. The reported manager has operational manager scope for the relevant locations. Returns showed no actual `approval_required` records at inspection: the apparent pending item was an expired preview; attention counts include work items beyond approvals.

The hanging sale has a durable original intent and an open original register/device/shift, but no local prepared sale record. Reconstruction of its six original request fields matches the durable SHA-256. This supports the implemented capability; it is not a claim that live commerce repair succeeded. No live repair, payment, refund, stock change, approval, role change, deactivation, receipt-setting mutation, migration apply or tester alias change was performed. Live Commerce health and authenticated post-release manager acceptance remain UNVERIFIED.

## Contributor provenance and next action

Isolated contributors supplied skeleton (`18952fe` import), topology (`da9a058`), returns (`4fa1a68`, `b29099c`, `054c425`, `701c717`), staff (`1070f36`, `63cbdb4`), receipt (`6445547`, `6a6a46a`, `605acaf`, `22529e1`, `e8ed648`), manager-recovery (`12d86f5`, `579ec41`), staff documentation (`a781f27`) and operator bootstrap documentation (`0fa1e77`). Imported commits retain source references. Root owns shared runtime/client composition, migration allocation/import, final tests/docs and handoff. Contributor leases are released after import; no other workstream ownership transfers.

After exact-head Linux/Windows CI and the two final upstream observations, hand off the concrete candidate for independent review or a new explicitly scoped staging release decision. Any approved release applies only these additive migrations and this tested candidate, keeps the same tester hostname, and must verify immutable deployment identity and same-hostname acceptance. It does not authorize the agent to execute the hanging sale's business action or any refund/payment.
