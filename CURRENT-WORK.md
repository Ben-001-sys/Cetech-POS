## #105 Admin/Manager control plane — ACTIVE P0

Owner/user explicitly made #105 the next blocking implementation before final R9 closure.

```text
human / implementing editor: @wbdevworld
independent reviewer: @Ben-001-sys
issue: #105
branch: ws3/admin-105-control-plane
base: cd37c19f79594ae5c5d3ebdb40520fa51668f9ab
mode: DESIGN / IMPLEMENT / REVIEW-HANDOFF
authority:
  ADR-017 organization control plane + configurable operational permissions
allowed:
  docs/decisions/ADR/017.md
  docs/decisions/DECISION-REGISTER.md
  CURRENT-WORK.md
  apps/pos-web/src/server/auth/**
  apps/pos-web/src/server/admin/**
  apps/pos-web/src/core/admin/**
  apps/pos-web/src/features/admin/**
  apps/pos-web/src/app/admin/**
  apps/pos-web/src/app/api/pos/v1/admin/**
  apps/pos-web/src/ui/shell/** only where needed for role-gated management navigation
  supabase/migrations/** for #105 persistence only
  supabase/tests/** for #105 persistence only
  focused frontend/integration/e2e tests
initial scope:
  authority/control-plane model
  configurable shift-close policy
  management shell
  staff/access read-management foundation
  locations/registers/devices management foundation
  shift/cash oversight foundation
  diagnostics/audit boundary
forbidden:
  Woo pricing/quote authority changes
  electronic-payment expansion
  new refund/restock effects
  VitePOS cutover
  production promotion
  protected-main edits
  self-merge
  requesting Emmanuel
review:
  exact candidate CI must be green
  Ben independent exact-head review required before R9 integration
```

Current R9 PR #63 remains DRAFT. Existing R9 evidence is preserved. Final ADR-012/FRESH_2 and final R9 milestone review are paused until #105 is independently reviewed, integrated and runtime-accepted.

Shift and cash oversight is complete on `ws3/admin-105-control-plane` / PR #109. It is a read-only Management view over existing `pos_shifts` aggregates.

Returns, approvals, and requires-attention oversight is complete on `ws3/admin-105-control-plane` / PR #109. It is a Management view over existing return, refund, stock-disposition, and pending-operation records. It does not invent Approved or Rejected statuses, issue a new refund, or restock. An operational manager at the return location can bind an audited approval for an `approval_required` return. An operational manager at the refund location can check that existing refund through the existing reconciliation path. Organization Owner or Admin authority does not grant either action by itself.

Receipt settings administration is complete on `ws3/admin-105-control-plane` / PR #109. It reuses location-scoped `pos_receipt_settings` and `ReceiptSettings`. Owner and Admin may change settings through the still-unreleased `20260922123000_pos_admin_control_plane.sql` atomic RPC, which also appends `pos_admin_audit_events`. That migration has not been applied to staging or production, so the receipt-settings function was added there instead of as a later migration. Managers can view managed locations only.

System health is complete on `ws3/admin-105-control-plane` / PR #109. It is a read-only Management view over the existing store, commerce-connection, and commerce-contract checks. Owner, Admin, Manager, and Support may read it. Cashiers stay on the existing staff health route.

Audit browser is complete on `ws3/admin-105-control-plane` / PR #109. It is a bounded read-only view over append-only `pos_admin_audit_events`. Owner, Admin, and Support may read organization-wide events; operational managers may read only events tied to verified managed locations. Raw before/after JSON is not exposed to the browser.

## Temporary senior #105 cashier-boundary cleanup — COMPLETE

Owner/user's 2026-09-22 instruction to continue #105 authorizes this bounded task-specific reassignment so step 9 can remove technical/admin/support diagnostics from ordinary cashier surfaces. This does **not** permanently alter `OWNERSHIP.md`. Ben / `@Ben-001-sys` remains the independent reviewer of the frozen #105 head.

```text
human / implementing editor: @wbdevworld
workstream: WS1 surface boundary + bounded WS3 composition
task: #105 step 9 — remove technical/admin controls from ordinary cashier surfaces
branch: ws3/admin-105-control-plane
starting SHA: 32cae139f60534b631a8dee725f04fb82788db6d
allowed WS1:
  apps/pos-web/src/features/settings/SettingsScreen.tsx
  apps/pos-web/src/features/settings/SettingsScreen.test.tsx
  apps/pos-web/src/features/sell/components/QuoteStatus.tsx
  apps/pos-web/src/features/sell/components/QuoteStatus.test.tsx
  apps/pos-web/src/ui/operational/OperationalSurfaces.tsx
  apps/pos-web/src/ui/operational/OperationalSurfaces.test.tsx
  apps/pos-web/src/ui/operational/healthPresentation.ts
  apps/pos-web/src/ui/operational/healthPresentation.test.ts
  apps/pos-web/src/ui/shell/routes.ts
  apps/pos-web/src/ui/shell/AppShell.test.tsx
  tests/frontend/cashier-language-surfaces.test.ts
allowed WS3 composition:
  apps/pos-web/src/app/workspace-runtime.tsx
  apps/pos-web/src/app/pos-app.tsx
  CURRENT-WORK.md
scope:
  keep cashier operational Status and Needs attention behavior
  remove build/API/schema/raw technical details from cashier UI
  remove cashier support/repair controls such as Fix App/manual update diagnostics
  remove Health from primary cashier navigation while retaining the safe /health route via Settings/recovery
  remove raw quote error technical details from cashier markup
  preserve safe retry/recovery, offline, pending-work and attention semantics
forbidden:
  Management redesign
  payment/quote authority changes
  pricing logic changes
  PWA cache/data deletion changes
  refund/restock changes
  Woo/WS2 changes
  production promotion
  self-merge
review:
  exact-head CI green
  @Ben-001-sys independent exact-head review at final #105 freeze
```

Cashier diagnostics cleanup is source-complete on `ws3/admin-105-control-plane` / PR #109. Ordinary cashier Settings/System status no longer expose raw build/API/schema/quote diagnostics or repair controls; safe R9 local-recovery and update-safety behavior remains intact. System status is reached from Settings rather than primary cashier navigation.

## Temporary senior #105 source closeout — COMPLETE

Owner/user's 2026-09-22 instruction to finish #105 authorizes this bounded task-specific reassignment for the remaining source candidate. This does **not** permanently alter `OWNERSHIP.md`. Ben / `@Ben-001-sys` remains the independent reviewer of the frozen #105 head.

```text
human / implementing editor: @wbdevworld
workstream: WS3 control plane + bounded WS1 cashier surfaces
task: #105 source closeout — return approval continuation, cashier diagnostic boundary, manager register assignment, refund reconciliation, X/Z read, cash correction, close visibility
branch: ws3/admin-105-control-plane
starting SHA: ae854d1a1085887c1f379e83eabba9f7164bc0ff
allowed WS1:
  apps/pos-web/src/features/returns/**
  apps/pos-web/src/features/register/**
  apps/pos-web/src/features/sell/components/ReceiptPaper.tsx
  apps/pos-web/src/ui/operational/**
  apps/pos-web/src/ui/shell/**
  tests/frontend/**
  apps/pos-web/e2e/**
allowed WS3:
  apps/pos-web/src/server/admin/**
  apps/pos-web/src/server/auth/**
  apps/pos-web/src/server/returns/**
  apps/pos-web/src/server/payments/**
  apps/pos-web/src/server/sales/**
  apps/pos-web/src/app/management-client.ts
  apps/pos-web/src/app/management-runtime.tsx
  apps/pos-web/src/app/register-runtime.tsx
  apps/pos-web/src/app/api/pos/v1/admin/**
  apps/pos-web/src/app/api/pos/v1/registers/**
  apps/pos-web/src/features/admin/**
  supabase/migrations/20260922123000_pos_admin_control_plane.sql
  supabase/tests/**
  CURRENT-WORK.md
scope:
  finish defined #105 source gaps without new commerce effects
  cashier continuation after server-owned return approval
  manager register assignment inside an existing location assignment
  exact-reversal cash correction only
forbidden:
  OWNERSHIP.md changes
  new refund or restock engines
  pricing or Woo authority changes
  staging migration apply
  production promotion
  self-merge
review:
  exact-head CI green
  @Ben-001-sys independent exact-head review
```

#105 exact head `054e386fe13360f255fb44fdfc37cec7fcfe4218` passed source review, exact-SHA Preview identity, and staging database acceptance. The final UI/language audit reopened only a bounded Management presentation remediation: missing Staff/Policy layout styles, compact responsive navigation, 44px Management touch targets, operator-facing Management copy, and CI-running Management viewport tests. Business authorization/accounting/return/payment/PWA semantics remain frozen. The staging `pos_admin_control_plane` migration is already applied; production remains untouched. This remediation requires fresh exact-head CI and a new independent Ben review before runtime acceptance resumes. R9 remains paused.

The inherited operational policy includes `returnApprovalRequired` (default false). Return preview resolves it server-side at organization → location → register scope. Staging and production do not fall back to an ephemeral policy store. An operational manager binds an atomic, audited, replay-safe approval. The cashier continues the same stored return; the server matches return id and fingerprint and does not require a pasted approval id. Approval does not refund or change stock. `pos_returns.status` stays `approval_required` until existing return execution advances it.

Manager register assignment can change registers only for operational staff already assigned at a location the manager manages. It cannot change the operational role, add a location, invite, disable, or change Owner/Admin/Support membership. Owner and Admin keep full assignment management.

Cash correction reuses the existing exact-reversal rule: the signed amount is the negative of the original movement, the original row is unchanged, a correction cannot correct a correction, and expected cash moves only through the existing insert trigger. A manager at the shift location supplies a reason. Owner or Admin authority alone does not reverse cash.

Management X report is the live expected-cash view and is not stored. Z report reads the durable closed report and is not recalculated. Shift close controls on the register follow effective policy; the server close command remains the final gate.

## 5PM bounded UX-01 cashier-copy slice — ACTIVE until 2026-09-21 17:00 Africa/Accra

Owner/user explicitly authorizes only this narrow #78 slice for today's release candidate.

```text
human / implementing editor: @wbdevworld
independent reviewer: @Ben-001-sys
issue: #78
branch: ws1/ux-78-5pm-cashier-copy
allowed:
  apps/pos-web/src/features/sell/components/CartPanel.tsx
  apps/pos-web/src/features/sell/state/quotePresentation.ts
  tests/frontend/cashier-language-surfaces.test.ts
scope:
  hide cashier-facing cart revision
  change confirmed-price copy to "Price ready"
  hide zero discount row
forbidden:
  auth diagnostics
  returns/register terminology sweep
  payment-provider behavior
  pricing authority changes
  contract/schema changes
  production promotion
```

# Current work ledger

## SALE-RECOVERY-01 — explicit original-order repair and truthful recovery feedback

Owner report on 2026-10-03: “IT'S NOT RESOLVING”, with the installed-client Needs attention sale-recovery screen. Existing urgent direction requires fixing discovered tester defects while preserving the same tester origin. This is a new bounded WS3 recovery task; the expired receipt-only release exception is not general approval for this task.

```text
editor: @wbdevworld / WS3
task: SALE-RECOVERY-01
independent human reviewer: @Ben-001-sys (pending; AI review is evidence only)
integration branch: ws3/sale-recovery-2026-10-03
starting tested local equivalent: d2816447203f6ef76b6eb683643811da12afe92f
starting deployed source: 0ce2db1be990a75fec500c410e980384fd05ec74
parallel UI candidate to preserve: PR #136 / 14a56f0a8f985dd596d576712487a605f134d935
allowed: src/app/attention-recovery.*, src/app/pos-app.tsx,
  src/app/checkout-client*, src/app/operational-client*,
  src/server/sales/prepare-sale.ts and focused recovery tests,
  src/server/sales/supabase-checkout-store.ts and focused store tests,
  src/core/checkout/in-memory-store.ts and focused store tests,
  src/server/sales/confirm-cash.ts, src/server/payments/initialize-electronic.ts
  and focused tests only to reject first new effects after reservation expiry,
  src/local/checkout-attempt* only for safe original-attempt handoff,
  focused app/e2e fixtures, staff recovery documentation, evidence, this ledger
paths beginning src/ are relative to apps/pos-web
canonical owners: Woo commerce; Supabase POS operations; IndexedDB journal/drafts
contracts/migrations/dependencies: unchanged
acceptance: explicit original-key existing-order repair only; no payment/receipt/
  cash/finalize/cancel evidence; matching frozen quote/intent and real reservation;
  no repair on GET; no new transaction/key; retained journal/drafts;
  clear nonterminal/error feedback and current-context sign-in restoration
forbidden: new payment/finalization/refund/stock engine, journal deletion,
  quote expiry bypass for new sales, pricing changes, WS2 edits, peer UI edits,
  protected main/integration merge, production, fabricated approval
contributor sale_recovery_trace: isolated sale-recovery-feedback worktree;
  src/app/attention-recovery.*, src/app/pos-app.tsx and client recovery helpers/tests
contributor sale_recovery_safety: isolated sale-recovery-original worktree;
  src/server/sales/prepare-sale.ts and focused server recovery tests;
  bounded store expansion: insert-if-absent prepared seeding in the durable
  and in-memory stores, preserving an existing sale/payment state under races
contributor sale_recovery_expiry: isolated sale-recovery-expiry worktree;
  effect-free expiry guards immediately before new payment effects; preserve
  all existing payment/cash replay and reconciliation, no reservation renewal
root: docs/ledger, imports, combined review/test/freshness and qualified handoff
review: different human source approval or a new explicit task-specific owner
  staging release exception is required before rollout; no blanket exception
staff-documentation impact: YES
```

Source implementation is complete on the bounded recovery branch, preserving the pinned UI/receipt baseline. The [recovery evidence](docs/testing/sale-recovery-2026-10-03/README.md) records original command/attempt preservation, lost-response handoff, first-write-wins persistence, reservation/payment guards, contributor provenance and verification limits. No live sale repair or staging rollout has occurred. Contributor source leases are released after root import; root retains qualification/handoff only. Final remote head, exact-head CI and bounded freshness observations belong in the PR handoff. Different-human review or an explicit owner exception for this candidate remains pending.

## 5PM emergency senior expansion — ACTIVE until 2026-09-21 17:00 Africa/Accra

Owner/user explicitly authorizes a bounded same-day expansion so production-MVP usability defects #82, #83 and #84 can be resolved in parallel before the 17:00 deadline. This is a temporary task-specific reassignment only and does **not** permanently alter `OWNERSHIP.md`.

```text
human / implementing editor: @wbdevworld
independent reviewer: @Ben-001-sys
deadline: 2026-09-21 17:00 Africa/Accra
mode: IMPLEMENT / INTEGRATE / REVIEW-HANDOFF
authorized issues:
  #82 Orders → Return items selected-flow visibility/focus/durable handoff
  #83 Sell customer picker remote-first BFF search
  #84 immutable sale-time customer presentation snapshot
already integrated:
  #85 receipt-only 80mm browser printing
allowed WS1 for #82/#83 only:
  apps/pos-web/src/features/returns/**
  apps/pos-web/src/features/orders/**
  apps/pos-web/src/features/sell/**
  apps/pos-web/src/features/customers/loadCustomerSearch*
  tests/frontend/**
allowed WS3 for #82/#83 bounded composition only:
  apps/pos-web/src/app/returns-runtime.tsx
  apps/pos-web/src/app/pos-app.tsx
  apps/pos-web/src/app/workspace-runtime.tsx
  apps/pos-web/src/app/operational-client.ts
allowed WS3 for #84:
  docs/contracts/**
  apps/pos-web/src/core/**
  apps/pos-web/src/server/**
  apps/pos-web/src/app/** where required for composition
  supabase/** only if persistence schema truly requires it
  relevant integration/unit tests
forbidden:
  pricing authority changes
  electronic-payment expansion
  real refund/restock execution
  production promotion
  VitePOS cutover
  unrelated #78/#86/#87/#88 implementation
review rule:
  each exact candidate must be CI-green and independently reviewed by @Ben-001-sys before integration
```

This block explicitly overrides the earlier temporary R9 line `forbidden: #82–#88 implementation` **only for #82, #83 and #84 during this emergency window**. Historical ownership/provenance before this authorization remains historical and must not be rewritten.

Updated 2026-09-20. Canonical repo `WB-DevWorld/cetech-pwa-pos`. Historical scheduler detail remains in Git/PR/evidence history. This file controls current assignment and implementation authority.

## Temporary senior R9 reconciliation — ACTIVE

Senior/user `@wbdevworld` authorizes reconciling accepted protected main plus the unmerged R10 post-merge ledger closeout into existing R9 / PR #63 so the candidate inherits current truth without merging `ws3/r10-prep-close` to protected main first. This does **not** permanently alter `OWNERSHIP.md`. Historical R10 closeout evidence below remains retained.

```text
human: @wbdevworld
workstream: WS3
mode: RECONCILE / RUNTIME QUALIFICATION
task: R9 — PWA recovery, operational close, update safety and genuine installed-client evidence
branch: batch/r9-pwa-recovery-operational-close
PR: #63
previous R9 head: 5592c29ca5a74ca59d7684ccf1a376ae10b37a13
current main: c49045dd02c46574af5d341cc65c177116fa7306
R10 closeout consumed: cf78330f2c5f1b9b8d231aad5b7bdc9a24e2d731
independent reviewer: @Ben-001-sys
Emmanuel: UNAVAILABLE / NOT A CURRENT REVIEW ACTION
allowed:
  existing R9 runtime scope
  semantic reconciliation with accepted main
  R9 migrations/tests
  PWA/update/recovery/device evidence
  operational-close/Z evidence
  directly relevant WS3 CURRENT-WORK/STATUS/HANDOFF/evidence
  PR #63 description/evidence
forbidden:
  #82–#88 implementation
  REC-01 redesign
  R10 implementation expansion
  Woo pricing authority changes
  live electronic payment
  real refund/restock
  production promotion
  VitePOS cutover
  self-merge
  requesting Emmanuel
```

Keep PR #63 DRAFT until genuine installed-client / reconnect / multi-tab / operational-close runtime evidence exists. Do not ask Ben for final milestone approval yet. A source review may be requested after the candidate is frozen.

Ben / `@Ben-001-sys` submitted CHANGES_REQUESTED on exact head `51c2c9bf0148d04113090565585fad3a4c7c2371`. The current slice is a bounded review-fix of SHA `BUILD_ID` minimum-version deadlock only. Do not start installed-device evidence until Ben confirms the source fix. Do not request Emmanuel.

## Temporary senior R10 Prep reconciliation — MERGED / PREPARATION COMPLETE / CONSUMED INTO R9

PR #79 squash-merged 2026-09-20T13:11:06Z. Source SHA: `bb35b8790e1370bc1b0aed6f39fc73c92549019a`. Resulting protected main: `c49045dd02c46574af5d341cc65c177116fa7306`. Ben / `@Ben-001-sys` APPROVED that exact head. This is qualification **preparation** only. QA-01 / #29 and REL-01 / #30 remain OPEN. R10 GO/NO-GO remains NO-GO. Production remains unauthorized. Follow-ups #82–#88 remain separate. Next active task is PR #63 R9 reconciliation; do not start it in this closeout. This does **not** permanently alter `OWNERSHIP.md`.

Historical lease (unchanged): Senior/user `@wbdevworld` authorizes reconciling accepted REC-01 main into existing R10 Prep / PR #79 so Ben reviews current main plus the QA/release qualification framework, not obsolete `1399a8fac...`. This does **not** permanently alter `OWNERSHIP.md`. REC-01 application source and CD-01 exact-SHA Preview infrastructure are already on protected main and are inherited here by a zero-overlap two-parent merge.

```text
human: @wbdevworld
workstream: WS3
mode: RECONCILE / QUALIFICATION PREPARATION
task: R10 Prep — reconcile QA/release qualification framework onto accepted REC-01 main
branch: ws3/r10-qa-release-preparation
PR: #79
previous head: 1399a8fac4c7b4b77fe436ccda1c88893a072101
new main parent: 7c5d6ca0cd93d7aeb5a7a1c97153ca187548c3fb
independent reviewer: @Ben-001-sys
Emmanuel / @Emmanuel-coder-prog: UNAVAILABLE / NOT A CURRENT REVIEW ACTION
allowed:
  existing R10 Prep 14-file scope
  CURRENT-WORK.md
  WS3 STATUS/HANDOFF only where necessary for exact reconciliation evidence
  PR #79 description/evidence
forbidden:
  R9 implementation
  #82–#88 implementation
  REC-01 source changes
  Woo commercial behavior changes
  electronic payment execution
  refund/restock execution
  production promotion
  VitePOS cutover
  protected-main direct edits
  self-merge
  requesting Emmanuel
```

Do not ask Ben to review obsolete `1399a8fac...`. Request review only on the replacement exact head after CI-green qualification. Do not merge PR #79 from this assignment. This historical instruction is closed by the squash merge above.

## Temporary senior REC-01 main-reconciliation — MERGED / CLOSED

PR #80 merged 2026-09-20T12:27:52Z. Accepted source SHA: `6995e1c2324432e4cba234f6844bcb224e3d7a57`. Resulting protected main: `7c5d6ca0cd93d7aeb5a7a1c97153ca187548c3fb`. REC-01 application acceptance PASS for the behavior actually exercised. Follow-ups #82–#88 are separate and must not reopen REC-01. This does **not** permanently alter `OWNERSHIP.md`.

Historical lease (unchanged): Senior/user `@wbdevworld` authorizes reconciling merged CD-01 exact-SHA Preview main into existing REC-01 / PR #80 so Ben reviews current main plus REC-01, not obsolete `7e9da309...`. This does **not** permanently alter `OWNERSHIP.md`. CD-01 Preview infrastructure is already on protected main and is inherited here by a zero-overlap two-parent merge.

```text
human: @wbdevworld
workstream: WS3
mode: IMPLEMENT / INTEGRATE
task: REC-01 — reconcile exact-SHA Preview main into immutable receipt snapshots
branch: ws3/receipt-product-name-sku
PR: #80
previous REC-01 head: 7e9da309bddbccdabf41b8ba753351e8697041d9
new main parent: c1f659ea118a885180fe6a543797efa908abf210
merge-base before reconcile: c320be8c5ad41c190200381cd52f853dd95212dc
independent reviewer: @Ben-001-sys
Emmanuel / @Emmanuel-coder-prog: UNAVAILABLE; not requested; not a current-head gate
allowed: two-parent merge of origin/main into this REC-01 branch; CURRENT-WORK / WS3 STATUS evidence; PR #80 reviewer packet
forbidden:
  changing REC-01 receipt/sales behavior
  modifying Exact SHA Preview workflow
  dispatching Exact SHA Preview
  Woo/synthetic commercial sale
  merging PR #80
  production promotion
  --prod
  alias movement
  live electronic payment
  refund/restock
  VitePOS cutover
  requesting Emmanuel
```

Do not ask Ben to review obsolete `7e9da309...`. Request review only on the replacement exact head after CI-green qualification.

## Temporary senior CD-01 exact-SHA Preview authority — MERGED / INHERITED

Merged to protected main as `c1f659ea118a885180fe6a543797efa908abf210` (PR #81 squash, 2026-09-19T19:57:06Z). REC-01 / PR #80 is now also merged. Exact-SHA Preview infrastructure is accepted; dispatch remains a later authorized action and is not production promotion. This does **not** permanently alter `OWNERSHIP.md`.

## Temporary senior CD-01 exact-SHA Preview authority — HISTORICAL (merged as c1f659ea)

Senior/user `@wbdevworld` authorizes this bounded WS3 infrastructure/security extension so REC-01 can be qualified on an immutable Vercel Preview without merging the candidate. This does **not** permanently alter `OWNERSHIP.md`. Authority is task-specific and expires at CD-01 exact-SHA Preview merge/handoff or explicit senior close.

This assignment is required because GitHub Actions Staging CD deploys only CI-green `main`, while unmerged same-repository candidates still need a trusted Preview path. Candidate source is never built in GitHub Actions with `VERCEL_TOKEN`; Vercel executes it remotely in Preview, so exact-head independent review remains required before any Vercel deployment request.

```text
human: @wbdevworld
workstream: WS3
mode: IMPLEMENT / INFRASTRUCTURE SECURITY REMEDIATION
task: CD-01 exact-SHA immutable Preview deployment authority
branch: ws3/exact-sha-preview
issue: #64 (authorized extension of original main->staging CD; not a rewrite of historical evidence)
PR: #81
protected main: c320be8c5ad41c190200381cd52f853dd95212dc
independent reviewer: @Ben-001-sys
Emmanuel / @Emmanuel-coder-prog: UNAVAILABLE today; not a current action; not a same-day gate
purpose: Provide a trusted protected-main workflow capable of deploying an independently reviewed, CI-green, same-repository exact PR SHA to immutable Vercel Preview without merging the candidate and without moving production/shared-staging aliases.
allowed:
  .github/workflows/deploy-exact-sha-preview.yml
  scripts/exact_sha_preview.py
  docs/runbooks/CD-01-STAGING-DEPLOYMENT.md
  tests/tooling/**
  CURRENT-WORK.md
  docs/workstreams/WS-03-CORE-DATA-INTEGRATION/STATUS.md
  issue #64 governance/scope record only
forbidden:
  PR #80 source
  application feature/runtime implementation
  WooCommerce bridge behavior
  production promotion
  production alias
  shared staging alias movement
  --prod
  live electronic payment
  refund/restock
  VitePOS cutover
  secret exposure
  arbitrary unrelated CI/CD changes
  self-merge
review rule: repository policy remains one independent exact-head APPROVED review from an authorized repository reviewer who is not the PR author (GitHub required_approving_review_count=1; OWNERSHIP/ADR-014 senior-authored changes need a different competent human). Do not hard-code simultaneous Ben+Emmanuel approval.
```

Do not merge PR #81 from this assignment. Do not dispatch Preview until the replacement head is independently approved. Do not change PR #80 source.

## Temporary senior STG-01 final review-fix — MERGED / CLOSED / HISTORICAL

STG-01 / PR #77 was accepted onto protected main as `c320be8c5ad41c190200381cd52f853dd95212dc`. This lease is no longer current assignment authority. Later accepted main advances: CD-01 `c1f659ea118a885180fe6a543797efa908abf210`, REC-01 `7c5d6ca0cd93d7aeb5a7a1c97153ca187548c3fb`. Do not reuse.

Historical lease (unchanged): Senior/user `@wbdevworld` authorizes Cursor working with the senior/user to make ONLY the minimum WS3 + WS2 changes required to resolve Ben's two exact review blockers on exact reviewed head `33d3748b525dfea2e4979e58e795516df27aa552`, directly on existing `batch/stg-01-staging-runtime-acceptance` / PR #77. This does **not** permanently alter `OWNERSHIP.md`. Authority expires at final review-fix handoff.

```text
human: @wbdevworld
workstream: WS3 (+ bounded WS2 catalog source-row pagination)
mode: IMPLEMENT (review-fix)
task: STG-01 final review-fix — assigned-register selection/persistence + Woo catalog pagination/convergence
branch: batch/stg-01-staging-runtime-acceptance
reviewed SHA: 33d3748b525dfea2e4979e58e795516df27aa552
origin/main: 778348c0bcf2f3cef5280cf6cf7a1d057aa8f9e5
allowed WS3: selected-register runtime state; authorized register choice; selected-register persistence; checkout/register composition; relevant tests; catalog full-rebuild vs incremental mode; catalog sync tests; CURRENT-WORK / handoff evidence
allowed WS2: wordpress/cetech-pos-bridge catalog source-row pagination cursor; tests/bridge catalog pagination regression
forbidden: another contributor branch; UX-02/03/04 reopen; electronic capability; R9/R10/REC-01; pricing/quote engine; payment; refund/restock; customer; unrelated Sell UI; Woo order behavior; frozen-contract churn unless unavoidable; production promotion; merging PR #77; protected main
```

## Temporary senior UX-04 review-fix — EXPIRED / CLOSED

Bounded review remediation on existing `ws1/ux-04-operational-workspaces-demo-alignment` from reviewed SHA `b36720093477f38e58f3cfc1132da8aa61887ffe`. Senior/user `@wbdevworld` reauthorized only the minimum existing UX-04 WS1/WS3/WS2 read paths to (1) recover the same payment/sale identity from Needs Attention Check / Recover and (2) stop customer search from replacing the local customer cache, plus truthful name/company/phone search. This does not permanently change `OWNERSHIP.md`. Do not reuse. Do not create another feature branch. Do not mutate PR #77 or `batch/stg-01-staging-runtime-acceptance`. Do not merge main. Do not redesign UX-04. Do not reopen UX-02/UX-03.

```text
human: @wbdevworld
workstream: WS1 (+ bounded WS3 attention recovery wiring; smallest read-only WS2 customer search) — EXPIRED / CLOSED
mode: IMPLEMENT (review-fix)
task: UX-04 final review-fix — attention recovery identity + customer search/cache truth
branch: ws1/ux-04-operational-workspaces-demo-alignment
reviewed SHA: b36720093477f38e58f3cfc1132da8aa61887ffe
base / STG-01: c857b097bca5b4eaaed4a4de0e33826639a91809
was allowed WS1: apps/pos-web/src/ui/operational/**, apps/pos-web/src/features/customers/**, tests/frontend/**, docs/workstreams/WS-01-FRONTEND-UX/**
was allowed bounded WS3: apps/pos-web/src/app/pos-app.tsx, workspace-runtime.tsx, attention-recovery*, operational-client.ts, apps/pos-web/src/server/attention/**, CURRENT-WORK.md
was allowed optional WS2: wordpress/cetech-pos-bridge/includes/class-customers-engine.php + tests/bridge/test-customers.php (read-only search fields only)
forbidden: UX-04 redesign; UX-02/UX-03 Sell/payment redesign; Woo order-history subsystem; Woo/B2BKing/WoodMart pricing; frozen contracts; customer/order/payment/refund/stock mutation; PR #77; shared STG-01 batch; protected main; production deploy
```

## Temporary senior UX-04 authority — EXPIRED / CLOSED

Closed on contributor branch `ws1/ux-04-operational-workspaces-demo-alignment` after the UX-04 operational-workspace handoff. Base remained `origin/batch/stg-01-staging-runtime-acceptance` `c857b097bca5b4eaaed4a4de0e33826639a91809` (accepted UX-03-containing STG-01 / PR #77 head). This does not permanently change `OWNERSHIP.md`. Do not reuse. Do not mutate PR #77 or `batch/stg-01-staging-runtime-acceptance`. Do not merge main. Do not deploy production.

```text
human: @wbdevworld
workstream: WS1 (+ bounded WS3 integration; smallest read-only WS2 customer search) — EXPIRED / CLOSED
mode: IMPLEMENT (complete)
task: UX-04 — remaining operational workspaces demo alignment + real runtime
branch: ws1/ux-04-operational-workspaces-demo-alignment
start SHA / UX-03-containing STG-01 head: c857b097bca5b4eaaed4a4de0e33826639a91809
origin/main at close: 778348c0bcf2f3cef5280cf6cf7a1d057aa8f9e5
was allowed WS1: apps/pos-web/src/features/orders/**, customers/**, returns/**, register/**, settings/**, apps/pos-web/src/ui/operational/**, ui/shell/**, ui/workspace*, ui/toast/**, directly relevant shared UI, tests/frontend/**, docs/workstreams/WS-01-FRONTEND-UX/**
was allowed bounded WS3: apps/pos-web/src/app/workspace-runtime.tsx, pos-app.tsx, relevant BFF routes under apps/pos-web/src/app/api/**, bounded server read-model/orchestration under apps/pos-web/src/server/**, bounded local projection/state under apps/pos-web/src/local/**, directly necessary integration/e2e tests, CURRENT-WORK.md
was allowed optional WS2: wordpress/cetech-pos-bridge/** + tests/bridge/** smallest read-only GET /customers
forbidden (unchanged): UX-02/UX-03 Sell/payment redesign; Woo/B2BKing/WoodMart pricing formulas; frozen-contract edits for UI convenience; order/payment/refund/stock mutation via WS2; PR #77; shared STG-01 batch; protected main; production deploy; VitePOS cutover; Demo controls / fictional production data
```

## Temporary senior UX-03 final review-fix — EXPIRED / CLOSED

Bounded visible ProductCard refresh on `ws1/ux-03-payment-barcode-variable-range` from reviewed SHA `253ef2886ed4c447d911ba11f789375f1e35c66d`. Senior/user `@wbdevworld` reauthorized only the minimum WS1 paths to re-query the current Sell search presentation after `catalogProjectionGeneration` advances, without remounting the workspace or mutating cart/quote/checkout. This does not permanently change `OWNERSHIP.md`. Do not reuse. Do not mutate PR #77 or `batch/stg-01-staging-runtime-acceptance`.

```text
human: @wbdevworld
workstream: WS1 — EXPIRED / CLOSED
mode: IMPLEMENT (review-fix)
task: UX-03 final review-fix — refresh visible product price presentation
branch: ws1/ux-03-payment-barcode-variable-range
reviewed SHA: 253ef2886ed4c447d911ba11f789375f1e35c66d
was allowed: apps/pos-web/src/features/sell/**, tests/frontend/**, CURRENT-WORK.md, docs/workstreams/WS-01-FRONTEND-UX/**
forbidden: payment UX redesign; cancel semantics; Woo/B2BKing/WoodMart pricing; WordPress; frozen contracts; PR #77; shared STG-01 batch; protected main
```

## Temporary senior UX-03 review-fix — EXPIRED / CLOSED

Bounded cache-invalidation remediation on `ws1/ux-03-payment-barcode-variable-range` from reviewed SHA `408cbaeaf8389052cc8936d9e3dfefb0c72f4a46`. Senior/user `@wbdevworld` reauthorized only the minimum WS1/WS3 paths to add a local catalog projection generation and clear the Sell price cache when it advances, plus the selected-tender fail-closed handler. This does not permanently change `OWNERSHIP.md`. Do not reuse. Do not mutate PR #77 or `batch/stg-01-staging-runtime-acceptance`.

```text
human: @wbdevworld
workstream: WS1 (+ bounded WS3 local/app wiring) — EXPIRED / CLOSED
mode: IMPLEMENT (review-fix)
task: UX-03 review-fix — variable price cache invalidation
branch: ws1/ux-03-payment-barcode-variable-range
reviewed SHA: 408cbaeaf8389052cc8936d9e3dfefb0c72f4a46
was allowed: apps/pos-web/src/features/sell/**, apps/pos-web/src/app/pos-app.tsx, apps/pos-web/src/local/catalog-sync.ts, apps/pos-web/src/local/index.ts, tests/frontend/**, CURRENT-WORK.md, docs/workstreams/WS-01-FRONTEND-UX/**
forbidden: payment UX redesign; cancel semantics; Woo/B2BKing/WoodMart pricing; frozen contracts; PR #77; shared STG-01 batch; protected main
```

## Temporary senior UX-03 authority — EXPIRED / CLOSED

Closed on contributor branch `ws1/ux-03-payment-barcode-variable-range` after the UX-03 payment / barcode / variable-range handoff. This does not permanently change `OWNERSHIP.md`. Do not reuse this exception. Do not mutate PR #77 or `batch/stg-01-staging-runtime-acceptance` as part of this closeout.

```text
human: @wbdevworld
workstream: WS1 (+ bounded WS3 integration) — EXPIRED / CLOSED
mode: IMPLEMENT (complete)
task: UX-03 — payment experience, barcode exception states, variable-product price ranges
branch: ws1/ux-03-payment-barcode-variable-range
start SHA / UX-02 baseline: 04166509c2b9505980338e4baaf630981c00d2e8
START_FRESHNESS_SNAPSHOT UTC: 2026-09-19T08:59:20Z
origin/main at close: 778348c0bcf2f3cef5280cf6cf7a1d057aa8f9e5
origin/batch/stg-01-staging-runtime-acceptance / PR #77 head at close: 04166509c2b9505980338e4baaf630981c00d2e8
was allowed WS1: apps/pos-web/src/features/**, apps/pos-web/src/ui/**, tests/frontend/**, docs/workstreams/WS-01-FRONTEND-UX/**
was allowed bounded WS3: apps/pos-web/src/app/**, apps/pos-web/src/server/**, tests/integration/**, apps/pos-web/e2e/**
  only as required to mount frozen PaymentPort.initialize and SalesPort.cancel plus directly required tests/composition
was allowed control-plane: CURRENT-WORK.md, docs/workstreams/WS-01-FRONTEND-UX/**, directly relevant handoff/evidence
forbidden (unchanged): unrelated WS2; Woo/B2BKing/WoodMart pricing formulas; frozen-contract edits for UI convenience; unrelated schema/auth/PWA; production deploy/data; protected main; VitePOS cutover; mutating PR #77 / shared STG-01 batch
```

## Temporary senior UX-02 closeout — EXPIRED / CLOSED

Closed on `ws1/ux-02-sell-demo-alignment` after the variable-parent advisory-price review remediation. Implementation SHA `6409d4264ad67184d100a3a9c806deebe9236ad9`. This exception is no longer current assignment authority. OWNERSHIP.md is unchanged. Do not treat this as permission for further WS1/WS2/WS3 cross-ownership work.

## Current authority

- accepted `main`: `c49045dd02c46574af5d341cc65c177116fa7306` — squash-merged `[R10 PREP] QA and release qualification framework` (PR #79). Source SHA `bb35b8790e1370bc1b0aed6f39fc73c92549019a`.
- STG-01 accepted: PR #77 merged as `c320be8c5ad41c190200381cd52f853dd95212dc`.
- exact-SHA Preview infrastructure accepted: PR #81 squash-merged as `c1f659ea118a885180fe6a543797efa908abf210`.
- REC-01 accepted: source `6995e1c2324432e4cba234f6844bcb224e3d7a57`; resulting main at that time `7c5d6ca0cd93d7aeb5a7a1c97153ca187548c3fb`; application acceptance PASS only for the behavior actually exercised.
- R10 Prep / PR #79: MERGED / PREPARATION COMPLETE. QA-01 / #29 remains OPEN. REL-01 / #30 remains OPEN. R10 GO/NO-GO remains NO-GO.
- R10 post-merge ledger closeout `cf78330f2c5f1b9b8d231aad5b7bdc9a24e2d731` is consumed as an R9 ancestry parent. It is not separately merged to protected main.
- Current active task: PR #63 R9 reconciliation / runtime qualification on `batch/r9-pwa-recovery-operational-close`.
- Follow-ups #82–#88 remain separate and are not started here.
- Issue #4 remains OPEN; `pricingParityVerified=false`.
- Production remains unauthorized.
- Live electronic payment, real refund/restock and VitePOS cutover remain independently gated.

```text
human: @wbdevworld
workstream: WS3
mode: RECONCILE / RUNTIME QUALIFICATION
task: R9 — PWA recovery, operational close, update safety and genuine installed-client evidence
branch: batch/r9-pwa-recovery-operational-close
PR: #63
previous R9 head: 5592c29ca5a74ca59d7684ccf1a376ae10b37a13
current main: c49045dd02c46574af5d341cc65c177116fa7306
R10 closeout consumed: cf78330f2c5f1b9b8d231aad5b7bdc9a24e2d731
independent reviewer: @Ben-001-sys
Emmanuel: UNAVAILABLE / NOT A CURRENT REVIEW ACTION
```

Do not implement #82–#88. Do not promote production. Keep PR #63 DRAFT until installed-device gates pass.

## Historical R10 Prep closeout lease (consumed; not current authority)

```text
human: @wbdevworld
workstream: WS3
mode: CLOSEOUT
task: R10 Prep — record PR #79 squash-merge and leave R9 / #63 as the next active task
branch: ws3/r10-prep-close
merged PR: #79
source SHA: bb35b8790e1370bc1b0aed6f39fc73c92549019a
resulting main: c49045dd02c46574af5d341cc65c177116fa7306
independent reviewer of #79: @Ben-001-sys
Emmanuel / @Emmanuel-coder-prog: UNAVAILABLE / NOT REQUESTED
forbidden:
  R9 / PR #63 source edits
  #82–#88 implementation
  production promotion
  live electronic payment
  refund/restock
  VitePOS cutover
  closing QA-01 #29
  closing REL-01 #30
```

This historical closeout did not modify PR #63. It is now consumed as R9 ancestry; R9 is the current assignment.

## Historical STG-06 / R8 authority (retained, not current)

- historical accepted `main` at that time: `778348c0bcf2f3cef5280cf6cf7a1d057aa8f9e5` — squash-merged `[R8] Safe returns and payment/register states (#69)`.
- STG-01 candidate observed on `origin/batch/stg-01-staging-runtime-acceptance` at STG-06 freshness cutoff: `a02cd21875d0717adb6694d293b41575302b2415` (forward from previously recorded `4e47a1f793bb8b75f6cf4fa03ee8f66675b4a897` by STG-02 route persistence + docs correction; that contributor branch already started at that SHA).
- STG-02 route persistence docs-corrected head: `a02cd21875d0717adb6694d293b41575302b2415` on `ws3/stg-02-route-session-persistence`. That STG-06 contributor branch started exactly there.
- Issue #4 remained OPEN; `pricingParityVerified=false`. Production promotion, live Paystack, real refund/restock and VitePOS deactivation were not authorized.
- R9 PR #63 remained draft / must not merge while STG-01 was still open.

```text
human: @wbdevworld
workstream: WS3
mode: REMEDIATE
task: STG-06 — live quote identity mapping + register authority preservation
branch: ws3/stg-06-quote-identity-register-authority
start SHA: a02cd21875d0717adb6694d293b41575302b2415
allowed: apps/pos-web/src/server/**, apps/pos-web/src/core/**, apps/pos-web/src/app/**, apps/pos-web/src/local/**, CURRENT-WORK.md, docs/workstreams/WS-03-CORE-DATA-INTEGRATION/**, docs/integration/evidence/**
forbidden: main, R9, WS1 feature/ui redesign, WS2 plugin, auth/CSRF/RLS weakening, CatalogItem.id = Woo ID, sourceItemId in Sell UI contracts, B2BKing/WoodMart pricing in BFF/frontend, new pos_catalog_items migration unless schema is insufficient
```

Senior instruction 2026-09-18 authorized that WS3 contributor branch from the exact SHA above. It is not current assignment authority.

## STG-01 recovery context (historical, retained)

This snapshot records the pre-acceptance STG-01 recovery state. STG-01 / #70, CORE-06 / #25 and R6 / #54 were later accepted via PR #77 / main `c320be8c5ad41c190200381cd52f853dd95212dc` and are not current open recovery gates.

- latest successful shared staging for merged main remains historical; application-runtime acceptance was gated on STG-01 / #70 plus this live navigation fix.
- CORE-06 / #25 and R6 / #54 remained reopened until isolated-staging runtime evidence existed.
- STG-02 original composition branch `ws3/stg-02-session-runtime-composition` established real session/CSRF/register authority. That assignment did not rewrite that; it persisted that runtime across App Router navigations.


## Historical STG-01 assignments (accepted; not current authority)

### WS3 / @wbdevworld

1. **STG-02 / #71 — staff session, CSRF and authoritative register state**
   - branch: `ws3/stg-02-session-runtime-composition`
   - remove hard-coded `Staff member` / `shiftOpen=true` authority;
   - establish real transitional staff session through the existing identity abstraction and `/api/pos/v1/session`;
   - preserve exact-origin CSRF and server authorization;
   - drive cashier/register/shift UI from authoritative server state.

2. **STG-04 / #73 — training Woo catalog projection**
   - branch: `ws3/stg-04-training-catalog-projection`
   - staging must stop treating `CASHIER_SEED_CATALOG` as operational truth;
   - local/test/demo may retain synthetic fixtures;
   - staging consumes a provider-derived, rebuildable IndexedDB projection;
   - Woo remains commerce truth; quote pricing remains bridge/Woo/B2BKing/WoodMart owned.

3. **STG-06 / #75 — functional staging acceptance gate**
   - branch: `ws3/stg-06-functional-staging-gate`
   - root HTTP smoke remains necessary but is not application acceptance;
   - acceptance must prove real session/CSRF, authoritative register state, real training projection, quote path and authorized synthetic cash-sale trace before #25/#54/#70 can close.

4. **STG-07 / #76 — CD summary audit fix**
   - branch: `ws3/stg-07-cd-summary-audit-fix`
   - fix Bash backtick command substitution in deployment summary without changing deployment semantics.

### WS2 boundary — task-specific implementation reassignment to @wbdevworld

**STG-05 / #74 — training Woo bridge producer/runtime**

- branch: `ws2/stg-05-training-bridge-runtime`
- original WS2 owner remains Emmanuel / `@Emmanuel-coder-prog`, but the senior authority explicitly reassigns implementation of this task to `@wbdevworld` for this remediation cycle because Emmanuel currently lacks SSH/repository implementation access.
- This does **not** transfer general WS2 ownership to WS3.
- Changes must remain inside STG-05's WS2-owned paths: `wordpress/cetech-pos-bridge/**`, `tests/bridge/**`, `tests/fixtures/commerce/**`, WS2 evidence/handoff.
- Do not mix WS2 bridge edits into STG-02/STG-04 branches.
- Emmanuel may still independently review the resulting GitHub PR; SSH is not required for review.

### WS1 / @Ben-001-sys

1. **STG-03 / #72**
   - branch: `ws1/stg-03-approved-workspaces`
   - implement approved production-intent Orders, Customers and Settings feature/UI surfaces;
   - do not edit provider/server/core/local logic.

2. **FE-07 / #12** remains canonical for Store Health, Attention/recovery, update/offline/degraded/passive-tab/migration UI.

Ben publishes exact tested source SHAs + mount instructions. WS3 mounts accepted WS1 components during STG-01 integration; integration ownership does not transfer WS1 implementation ownership.

## Integration order

1. STG-02 real session/CSRF/register composition.
2. STG-05 bridge producer verification/minimal repair (may run in parallel with STG-02; keep separate branch/path ownership).
3. STG-04 training catalog projection consumes the verified STG-05 producer boundary.
4. Ben delivers STG-03 + FE-07 source SHAs.
5. Integration editor imports only declared tested owner/reassigned-owner commits into `batch/stg-01-staging-runtime-acceptance`, preserving source SHA → imported SHA → tested combined SHA provenance.
6. Mount accepted WS1 features in WS3-owned app composition; no accepted route may fall through to the generic R4 placeholder.
7. Apply STG-07 audit fix.
8. Implement/run STG-06 functional staging acceptance against the exact immutable Vercel deployment produced from the candidate.
9. Capture redacted exact-SHA staging evidence; independent human review; final ADR-012 freshness procedure.
10. Only after all STG-01 gates pass may #25, #54 and #70 close and R9 resume.

## Imported provenance (this integration head)

Do not treat STG-04 contributor `CURRENT-WORK.md` as the shared ledger.

| Contribution | Owner | Source branch | Source SHA | Imported SHA |
| --- | --- | --- | --- | --- |
| STG-01 control | WS3 / @wbdevworld | `batch/stg-01-staging-runtime-acceptance` | `acd4a2f009c58f734186cf9e44f278da93499a4b` | base |
| STG-02 / #71 | WS3 / @wbdevworld | `ws3/stg-02-session-runtime-composition` | `8a6aba2ce82ebe265a154f89999c2caab7a08beb` | `9bfb535ca86f7bd27108b3a82c6876e4b5f19c81` |
| STG-05 / #74 | WS2 boundary; implementer @wbdevworld | `ws2/stg-05-training-bridge-runtime` | `4d549167f7d6dcecf0eff24f35e1f24a3429d3d8` | `7cab23415d622cef7369ddc03e007e6576cc4ce7` |
| STG-04 / #73 | WS3 / @wbdevworld | `ws3/stg-04-training-catalog-projection` | `01e4438d3553c633e7b0234de44743ff4cea2368` | `981722e7c8ff6ea7163532f03218f59ea2b9e20d` |
| STG-03 / FE-07 | WS1 / @Ben-001-sys | `ws1/stg-03-approved-workspaces` | `169f8155fe4cb34b6fe27db3bb6b445a13ade712` | `8073ef59dbf481160387000886b0b7da4a25d237` |
| STG-07 / #76 | WS3 / @wbdevworld | isolated on this integration branch | `4a978b9a67291c34c34f6cb75fddf31d14a7cbdd` | same commit |

WS3 composition (mount + session/catalog keep-both): `6df4e1edc503aa2ab0fe37f2f26a9177e6726177`. Combined tested SHA is recorded in WS3 HANDOFF after the e2e-isolation commit; it is not self-embedded here.

Semantic conflict: `apps/pos-web/src/app/pos-app.tsx` and `apps/pos-web/src/config/env.ts` plus WS3 STATUS/HANDOFF. Composition keeps STG-02 staff/CSRF/register authority and STG-04 catalog projection. `readPublicStaffAuthEnv` and `readAppEnv` both remain. Staging still never silently seeds `CASHIER_SEED_CATALOG`. Ben Orders has no frozen list port: mounted empty/unavailable, no Woo from UI, no invented contract.

## Safety boundaries

- No production promotion.
- No live electronic payment execution.
- No real customer refund/restock.
- No VitePOS deactivation.
- Training/staging effects must remain inside CP-04 authorization.
- No secrets in prompts, commits, screenshots, logs or evidence.
- No wildcard origin/CSRF bypass.
- Do not clear IndexedDB/drafts/journal as a routine recovery or catalog-sync technique.

## Final #105 source remediation — IN SOURCE, NOT RUNTIME-ACCEPTED

The 2026-09-23 whole-system remediation stays on `ws3/admin-105-control-plane` / PR #109.
Starting remote head: `b5e70f6edd338428cc5e079db85ec4da45879645`.
It does not merge the PR, close #105, resume R9, promote production, or launch an Exact SHA Preview.

Source now includes one Settings navigation control, direct staff creation with a durable password-change gate, policy scope selection, server-owned payment-method capabilities, and owner/admin location, register, and device administration.
Location lifecycle uses forward migration `20260923140000_pos_admin_topology.sql`.
`20260922123000_pos_admin_control_plane.sql` stays unchanged because it is already applied on shared staging.

No persistent staging Owner was created. The next controlled runtime action is `docs/runbooks/ADMIN-105-FIRST-OWNER-BOOTSTRAP.md`.
Screen classification is `docs/workstreams/WS-03-CORE-DATA-INTEGRATION/evidence/ADMIN-105-SCREEN-CAPABILITY-MATRIX.md`.
Fresh `@Ben-001-sys` review is required for the exact final SHA. Older review does not carry forward.
## STAFF-QUOTE-132 — Urgent quote latency correction

Owner instruction, 2026-10-02 16:02 UTC: fix discovered defects immediately because testers are waiting, and serve the correction at the existing integration staging alias when they refresh. This bounded runtime task supersedes the earlier documentation-only freeze; it does not authorize production promotion or an integration/main merge.

```text
task: STAFF-QUOTE-132 / issue #132
editor: @wbdevworld / WS3 senior
branch: ws3/quote-latency-2026-10-02
application baseline: 1021cd113c783e25030fe9c0bda1be9ddcf5888c
allowed: src/app/pos-app.tsx, src/server/quotes/**,
  src/app/api/pos/v1/quotes/route.ts, focused tests,
  CURRENT-WORK.md, docs/integration/evidence/STAFF-QUOTE-132.md,
  current docs/staff documents and formatted reading copies
bounded consumer implementation delegation to this editor for this task:
  src/features/sell/runtime/{useCartQuote,pricingClient,quoteRequest,SellRuntimeScreen}.*,
  src/features/sell/{SellScreen.*,components/CartPanel.*,components/QuoteStatus.*},
  tests/frontend/sell-quote-runtime.test.ts, e2e/sell-runtime.spec.ts
forbidden: unrelated WS1/WS2 implementation, contract/migration/dependency changes,
  account/register/device/order/payment/refund/stock mutations,
  protected #102, production promotion, self-merge
source ownership: Woo owns prices; Supabase POS operations; local drafts/journal retained
contract/ADR changes: none; staff-documentation impact: yes
acceptance: equivalent cart inputs do not restart quotes; bounded failures and retry;
  current-cart/revision safety; timing evidence; same tester origin after deployment
independent integration review: required before any integration/main merge
```

Paths beginning `src/` or `e2e/` are relative to `apps/pos-web`. The consumer delegation is limited to the owner's urgent quote correction, not a transfer of general WS1 ownership. Upstream WordPress latency must remain open until live timings prove improvement. A timeout is not proof that pricing became fast.

---


## UI-REF-20261003 — owner-authorized UI refinement — REVIEW HANDOFF

Owner instruction, 2026-10-03 01:39 UTC: implement the UI changes discussed in this chat, with an 80-minute target and parallel agents as needed. This is an explicit bounded WS1 presentation reassignment to the senior/user implementing editor (@wbdevworld), expiring at review handoff. Existing source/reference bytes and commercial workflows remain intact.

- Branch: `ws1/ui-refinement-2026-10-03`.
- Baseline: deployed quote correction `2c7eb2ddeb22c3402d82673421a54dbe6ad236f1`; declared integration `1021cd113c783e25030fe9c0bda1be9ddcf5888c`.
- Allowed: non-receipt `apps/pos-web/src/ui/**`, `src/features/**`; focused frontend/e2e tests; this ledger, WS1 evidence/handoff and affected staff documentation. WS3 presentation-only composition in `src/app/globals.css` may be edited by the root integration editor if necessary.
- Parallel ownership: shell agent owns tokens/workspace/shell/toast/auth; Sell agent owns non-receipt Sell components/styles; operations agent owns Orders/Returns/Register/Customers; management agent owns non-receipt Management panels/styles; verification agent owns new refinement browser evidence/tests. Root alone owns docs/integration/composition and Settings outside receipt-owned controls. Each contributor has an isolated branch/worktree.
- Forbidden: receipt layout/settings/snapshot/print components and receipt CSS rules; core/server/local/config/contracts/migrations/dependencies/CI/service worker; WordPress bridge; main/protected branches; live commercial mutations; production promotion. Receipt work remains owned by `RECEIPT-REF-01` in its separate checkout.
- Canonical owners: Woo prices/orders/stock; Supabase POS operations; local drafts/journal remain preserved. Consumes existing v1 ports; no contract/migration/architecture changes.
- Acceptance: refined coherent visuals, usable responsive layouts, stable loading/error feedback, keyboard/touch accessibility, unchanged quote/payment/refund/shift/update safeguards; foundation/lint/typecheck/unit/build and relevant browser checks. Synthetic browser tests are not live payment/hardware proof.
- Staff documentation impact: yes; update current guide/workbook and formatted copies together after assembly.
- Independent exact-head human review remains required before integration/main merge. Publish a reviewable contributor candidate; do not self-merge. Staging deployment must use a qualified combined candidate that preserves any completed receipt handoff.

Implementation and local production verification are complete. Contributor leases are released after import. [PR #135](https://github.com/WB-DevWorld/cetech-pwa-pos/pull/135) holds the UI-only review candidate; [UI evidence](tests/frontend/evidence/ui-refinement-2026-10-03/README.md) records tests, screenshots, contributor provenance and the pinned receipt compatibility checkout. The designated independent human reviewer is @Ben-001-sys; approval is pending and AI quality review does not supply that approval. No integration/main merge, staging alias change, database write or production promotion occurred. Final upstream cutoff: 2026-10-03T02:12:22.605Z, main `c49045dd02c46574af5d341cc65c177116fa7306`, declared integration `1021cd113c783e25030fe9c0bda1be9ddcf5888c`. Final remote head and exact-head CI result belong in the PR handoff. No autonomous third freshness pass.

---

## RECEIPT-REF-01 — reference receipt layout and bounded settings — REVIEW HANDOFF

Owner instructions on 2026-10-03: implement the receipt reference and accepted configuration recommendation; update the existing tester URL after qualification. This authorizes a bounded WS1 receipt/settings presentation reassignment to the senior implementing editor and the necessary WS3 schema, settings, immutable snapshot and print composition changes. It does not transfer general WS1 ownership. Current explicit owner instructions govern this new assignment over historical task prohibitions below.

```text
human / implementing editor: @wbdevworld
workstream: WS3 + bounded WS1 receipt/settings surfaces
task: RECEIPT-REF-01
branch: ws3/receipt-layout-2026-10-03
source baseline: ws3/quote-latency-2026-10-02 / 2c7eb2ddeb22c3402d82673421a54dbe6ad236f1
declared integration baseline: integration/r9-staff-remediation-final / 1021cd113c783e25030fe9c0bda1be9ddcf5888c
staging tester URL: https://cetech-pos-staging-git-integration-9578df-wbdevworlds-projects.vercel.app/
allowed:
  receipt settings schema/types, core settings and server persistence
  additive receipt presentation migration and focused database tests
  sale finalization receipt snapshot only
  ReceiptPaper, receipt view mapping, sell receipt CSS
  receipt Management editor and preview/test print
  device printer paper preference and Settings binding
  existing browser print adapter only
  focused receipt tests, staff documentation, ADR/evidence and this ledger
forbidden:
  commerce pricing/payment/refund/stock/recovery changes
  protected main or existing frozen PR #133 source edits
  production promotion, VitePOS cutover, #102 incident disposition
  destructive data cleanup or rewritten historical receipts
review:
  fresh exact-head CI and different competent human source review
  staging rollout is authorized; production remains unauthorized
```

Receipt presentation settings remain location-scoped; paper width is a separate local printer preference. Snapshot content freezes presentation at completion and reads without live settings on reprint. Parallel contributors use isolated worktrees with non-overlapping scopes; the senior controls canonical schema generation and integration.

Receipt source implementation and local combined verification are complete. Final remote candidate/CI/freshness and rollout state are recorded in PR #134. Independent reviewer: @Ben-001-sys (approval pending). The owner subsequently authorized a one-time staging exception, and candidate `37bcc76ac33e3c9eb8bded2c49cb2f319223ae89` plus the additive receipt migration were deployed to the existing tester alias. Normal independent review remains pending; no merge or production promotion occurred. All contributor worktree leases for that task are released after import.

## RECEIPT-TOP-01 — preserve selected paper and start printing at the top

Current owner instruction, 2026-10-03: “my same size but it should be at the top.” This is a bounded correction to the receipt release, retaining the existing tester URL and paper/text size. The previous exact receipt source `37bcc76ac33e3c9eb8bded2c49cb2f319223ae89` is already on staging under the recorded owner exception; PR #134 remains open for Ben. No independent approval is implied by deployment.

```text
human / integrating editor: @wbdevworld, WS3
task: RECEIPT-TOP-01
integration branch: ws3/receipt-print-top-2026-10-03
base source: 37bcc76ac33e3c9eb8bded2c49cb2f319223ae89
base tree: cada5de37e7dc4c4b0adffa5fa708fb656d51694
synthetic local equivalent: 23ad0f847dc40e7f6a80b58a33053c3ecef257b1
declared integration baseline: integration/r9-staff-remediation-final, 1021cd113c783e25030fe9c0bda1be9ddcf5888c
start main: c49045dd02c46574af5d341cc65c177116fa7306
allowed implementation:
  apps/pos-web/src/core/receipt/printer-preference.ts and its tests
  apps/pos-web/e2e/thermal-receipt-print.spec.ts
  apps/pos-web/e2e/receipt-settings.spec.ts sample print width assertion only
  apps/pos-web/src/features/sell/sell.css print documentation only
allowed integration/docs:
  CURRENT-WORK.md, ADR-018 printing clarification
  affected canonical staff guide/workbook and their maintained mirrors
contributor: receipt_render, isolated local/receipt-print-top worktree
contributor lease: printer helper + unit/e2e tests + print CSS comment only
root lease: docs, import, review, verification and staging handoff
contracts / schema / migrations / dependencies: unchanged
acceptance:
  selected 80/58 mm printer paper is preserved
  same receipt text scale starts near the top, with small margins
  fixed-sheet Chromium PDFs cover CSS-preferred and driver-preferred modes
  long receipts paginate, no clipping/blank leading page, print lifecycle preserved
  sample printing has no commerce effects; exact source CI green
forbidden:
  payment, pricing, stock, refunds, PWA recovery or historical snapshot rewrites
  protected main, frozen PR #133, unrelated peer branches, production
release:
  owner explicitly instructed “deploy the fixes using the bypass” on 2026-10-03
  one-time staging release exception for this exact tested positioning correction
  no fabricated independent review, merge, protection/workflow changes
  normal independent review remains pending with Ben; no blanket future exception
expiry: this receipt positioning correction's tested staging handoff
staff-documentation impact: YES, top alignment and selected printer paper behavior
```

The receipt_render contributor produced local source `e595619e4bd6cf1609ad8e768397d0e1bbbbf5bd` from the pinned equivalent receipt baseline. Its four allowed files were imported without other contributor changes. The contributor lease is released; the root is now the sole integration editor. Local source review found no new runtime blocker. Focused verification passed: 16 unit tests, 9 Chromium tests, focused lint and TypeScript. A negative control using the old helper failed the actual PDF heading-position assertion (~197 pt down), demonstrating that the new tests detect the reported defect rather than only checking DOM position or CSS spelling. Exact remote combined SHA, CI, final freshness and rollout evidence belong in the PR handoff. Physical printer/Safari output remains unverified.


## UI-REL-20261003 — combined UI and receipt tester deployment — ACTIVE

Current owner instructions, 2026-10-03 03:04 UTC: “IMPLEMENT THE UI AND RETAIN THE RECEIPT CHANGES”, “DEPLOY THEM TO SAME LINK”, “AS TESTERS”. This explicitly authorizes combined staging qualification and deployment under the previously requested one-time owner release exception. The implementing/integration editor remains @wbdevworld / WS3 with the bounded WS1 UI reassignment. AI review supplies evidence; no independent human approval is asserted.

- Integration branch: `ws3/ui-receipts-testers-2026-10-03`; root is the sole integration editor, using an isolated checkout.
- UI source: PR #135 / `b8fb4610092dc544e5bba76f920048d170088600`, tree `2ee0f9b23b3b797cb7a40c29c3be5d180c3d5e58`.
- Receipt and top-print source: `0ce2db1be990a75fec500c410e980384fd05ec74`, tree `75df239ff4bc4b4ece0421ad268b01da42b4eedd`; local equivalent `d2816447203f6ef76b6eb683643811da12afe92f`.
- Provisional combined UI/receipt verification source before top-print import: `1cf24631a7eec96703c5f370dfc6b0917e57cfb0`.
- Allowed: import these declared tested sources; compose shared presentation and staff-doc hunks; qualification tests and evidence; this ledger; publish a combined review candidate; create a qualified staging Preview and move only the existing tester alias.
- Tester URL: https://cetech-pos-staging-git-integration-9578df-wbdevworlds-projects.vercel.app/
- Required qualification: preserved UI/receipt source union, source review, foundation/lint/typecheck/unit/build/browser checks, exact-head Linux/Windows CI, immutable Preview identity/smoke, same-hostname acceptance after alias assignment.
- Receipt migration `20261003012953` is already applied to CETECH POS staging; this assignment does not reapply it. Read-only catalog inspection verified the JSONB column and single optional-argument RPC with service-role-only execution.
- Rollback must retain additive receipt contract/parser support. Use the qualified receipt/top-print Preview as fallback, not pre-receipt pricing-only source `2c7eb2d` after new snapshots exist.
- Forbidden: permanent review/workflow/protection changes, fabricated approval, main/integration merge, production promotion, electronic payment/refund/restock, VitePOS cutover, historical receipt rewrite, cache/IndexedDB/draft/journal clearing, secret disclosure, unrelated source changes.
- Expiry: this exact combined tester release handoff; Ben's independent source review remains pending and the exception does not authorize future releases.
- Staff documentation impact: YES. Preserve current UI guide/workbook changes and the latest receipt paper/top-position instructions in their maintained copies.

Final combined local/remote SHA, exact-head CI results, immutable Preview and alias evidence belong in the combined PR handoff and its release evidence index. The earlier UI task's two-pass cutoff remains historical; this is a new owner-authorized deployment assignment, not an autonomous third freshness pass.
