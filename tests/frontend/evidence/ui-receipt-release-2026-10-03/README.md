# Combined UI and receipt tester release

The owner explicitly instructed at 2026-10-03 03:04 UTC: implement the UI, retain the receipt changes, and deploy both to the same tester link. `CURRENT-WORK.md` records this bounded `UI-REL-20261003` staging assignment and one-time owner exception. This does not assert independent human approval or authorize main/production changes.

## Source composition

| Contribution | Exact published source | Equivalent local source/tree |
| --- | --- | --- |
| UI refinement, PR #135 | `b8fb4610092dc544e5bba76f920048d170088600` | local `b4b6676622129469627001adb8c8484eebae6792`; tree `2ee0f9b23b3b797cb7a40c29c3be5d180c3d5e58` |
| Receipt layout/settings and latest top-alignment fix, PR #134 | `0ce2db1be990a75fec500c410e980384fd05ec74` | local `d2816447203f6ef76b6eb683643811da12afe92f`; tree `75df239ff4bc4b4ece0421ad268b01da42b4eedd` |
| Earlier provisional UI/receipt verification | unpublished `1cf24631a7eec96703c5f370dfc6b0917e57cfb0` | before latest print-position import |

Root imported the declared receipt delta with a three-way patch and preserved both UI and receipt changes in shared Management, Settings and CSS files. Independent source union inspection found all 34 receipt-only paths identical to the latest receipt source, all 51 UI-only paths retained, and identical receipt deltas in all four overlapping source files. Receipt core/server/contracts/migrations/composition, renderer and settings panel match the latest receipt source exactly. No application conflict remains.

The combined Orders reprint test explicitly selects an 80 × 297mm printer sheet and scale 1, verifies `size: auto`, and checks the resulting width and height. The previous fixture incorrectly relied on the removed custom CSS page dimensions; the production receipt correction remains unchanged.

## Local qualification

| Check | Result |
| --- | --- |
| `python3 scripts/verify_control_plane.py` | PASS: 83 schemas, 68 fixtures, 28 immutable references |
| `python3 -m unittest discover -s tests/tooling` | PASS: 76 tests |
| `pnpm --dir apps/pos-web lint` | PASS: zero errors, five existing warnings |
| `pnpm --dir apps/pos-web typecheck` | PASS |
| `TZ=UTC pnpm --dir apps/pos-web test` | PASS: 192 files / 1,466 tests |
| `pnpm --dir apps/pos-web build` | PASS: production build / 46 routes |
| Production Chromium Playwright run, all project e2e suites | PASS: all 45 tests in one run, 27.6 seconds |
| Scoped authorization/Management audit | PASS: 92 focused tests; no scoped source blocker |

Toolchain: Node 24.21.0, pnpm 12.4.1; installed Chromium executable `/tmp/cetech-ui-browser/chromium`. Local browser verification used the existing temporary production-server config with `UI_VERIFY_REPO` pointing at this isolated checkout, `UI_VERIFY_SERVER=production`, and one worker. The checked-in CI workflow/config is unchanged.

The unit suite was run under UTC, matching its existing fixed-time receipt assertion and CI environment. The first local attempt used the host's UTC+2 timezone and failed only that timestamp assertion; no receipt formatting code changed. The first combined browser attempt passed 44 cases and exposed the outdated printer-sheet fixture above; after correcting it, all 45 passed together. Generated historical fixtures/screens were restored after verification.

Coverage includes refined light/dark Sell across desktop/tablet/phone, keyboard dialogs, persisted product view preferences, mobile attention navigation, loading announcement, cart/customer feedback, cash sale/reprint safety, Manager read-only receipt settings, sample printing, and short/long 58/80mm PDF paper dimensions, text scale, top position and pagination. Fixtures do not establish physical printer, Safari, live electronic payment or real stock/refund acceptance.

[Original UI screenshots and implementation evidence](../ui-refinement-2026-10-03/README.md) remain preserved. Those screenshots precede the later receipt-top correction and are not presented as receipt positioning evidence.

## Staging and rollback

Existing tester URL: https://cetech-pos-staging-git-integration-9578df-wbdevworlds-projects.vercel.app/

Before this release, the alias was independently observed pointing to READY Preview `dpl_D7MsnvDWV9PySXGjHrPbW7Gvd6q6`, exact source `0ce2db1be990a75fec500c410e980384fd05ec74`, immutable URL `https://cetech-pos-staging-lv8tiflph-wbdevworlds-projects.vercel.app/`. Preserve that receipt/top-print build as rollback. Do not roll back to pricing-only `2c7eb2d` after receipts with new additive fields exist; its strict old parser rejects them on reprint.

Receipt migration `20261003012953` is already applied on the staging project. Read-only catalog checks verified the presentation JSONB column, the single eight-argument defaulted RPC, empty search path and execution restricted to service role. This combined release makes no additional schema/data changes.

Exact combined remote SHA/tree, Linux/Windows CI, immutable Preview acceptance and final same-hostname deployment evidence are recorded in the combined PR handoff. Alias reassignment follows exact-head CI and Preview smoke. Final human review remains pending; no review/protection/workflow changes or main merge are part of this assignment.
