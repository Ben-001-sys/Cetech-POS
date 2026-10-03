# One-time staging owner exception: review evidence

Audit cutoff: 2026-10-03 02:43 UTC. This is review evidence and a proposed bounded release procedure, not an independent human GitHub approval or a record of a deployment performed by this audit.

## Reviewed source

- UI PR #135: `b8fb4610092dc544e5bba76f920048d170088600`; equivalent local tree `2ee0f9b23b3b797cb7a40c29c3be5d180c3d5e58`.
- Receipt PR #134: `37bcc76ac33e3c9eb8bded2c49cb2f319223ae89`; equivalent local tree `cada5de37e7dc4c4b0adffa5fa708fb656d51694`.
- Local combined verification source: `1cf24631a7eec96703c5f370dfc6b0917e57cfb0`, tree `884ec383ebcee78e87485f12be72a79bf0f82391`. This is a provisional test candidate, not a published combined release.
- Independent union audit found every UI-only application/test path and every receipt-only source path preserved. Shared presentation paths were composed; no unexpected source paths were introduced. The provisional checkout predates the UI closeout README/screenshots and latest ledger closeout.

## Verification and findings

The earlier combined qualification passed foundation checks (83 schemas / 68 fixtures), lint, typecheck, production build and 1,466 unit tests. Forty production browser scenarios were covered across the final run and the corrected-case rerun; this is not a claim that one combined remote CI run has already passed. This audit added 92 focused passing tests across authorization, Management, receipt settings, topology and policy behavior. These are automated source/runtime fixtures, not live commerce or physical printer acceptance.

No blocking authorization or commerce mutation finding was found in the scoped source audit. Owner/Admin durable settings authority, Manager read-only controls, organization/location checks, exact origin/CSRF checks and trusted server grants remain intact. UI source does not change backend authority, dependencies, CI, service worker or commercial calculations. Receipt source freezes presentation without rewriting historical snapshots or changing totals, payments, refunds or stock.

**Rollback restriction:** after this receipt source creates receipts, the old pricing-only application `2c7eb2ddeb22c3402d82673421a54dbe6ad236f1` rejects their additive presentation/customer-phone fields during reprint. Rollback must retain the new receipt contract/parser. Do not rewrite stored snapshots to make an old application accept them.

## Observed staging state

Read-only connector observations confirmed:

- Supabase `iegxncvpsyaitkpzywcr` is the healthy CETECH POS staging project.
- Migration `20261003012953_receipt_presentation` is applied and the nullable `public.pos_receipt_settings.presentation` JSONB column exists.
- There is one `pos_admin_set_receipt_settings(text,text,text,uuid,boolean,integer,boolean,jsonb)` RPC, with one defaulted argument, SECURITY DEFINER and an empty search path. Anonymous/authenticated execution is denied; service-role execution is allowed. The presentation validator also denies anonymous/authenticated execution.
- The shared integration tester hostname resolves to READY Preview deployment `dpl_6U285BX751P9wqNMBAKtDz2ohbdA`, exact receipt Git SHA `37bcc76ac33e3c9eb8bded2c49cb2f319223ae89`. This receipt-aware build is the observed rollback target for a subsequent combined rollout; its runtime reprint acceptance still needs to be checked before alias reassignment.
- Separate UI Preview `dpl_3LaLyv67b9W8J79SS8S2dSZNqpPx` is READY at exact UI Git SHA `b8fb4610092dc544e5bba76f920048d170088600`.
- Both PR review lists were empty at observation. A READY Preview does not establish independent human review or final release acceptance.

No database mutation, new deployment request, alias reassignment, GitHub review submission, merge or protection change was performed by this audit.

## Existing gate and proposed exception

The trusted main-branch Exact SHA Preview workflow has no owner-override input. Its Python gate requires one independent current-head approval and rejects the PR author's own approval. An administrator environment bypass does not bypass that Python source-review check. GitHub self-approval cannot serve as independent review.

A new explicit owner instruction can authorize a separately recorded, one-time staging release exception. Such an exception should bind to the final combined SHA; require green exact-head Linux/Windows CI and source/Preview acceptance; use the existing staging project and tester hostname; retain the receipt-aware rollback deployment; and expire after that one handoff. It must not alter the trusted workflow or permanent branch protections, imply independent approval, merge main, authorize production, or become a blanket future exception. Ben's normal independent source review remains pending.

The receipt parallel checkout now records a new ACTIVE `RECEIPT-TOP-01` owner assignment, preserving selected paper/text size and aligning print content at the top. Its reviewed documentation head is `9dad3703909bbd7505c162120874cd88c8db8d58`; the print source handoff is not yet included in the combined SHA above. The final combined candidate must consume that tested handoff before qualification and release. Do not import its updated staff/ADR claims without the matching code.
