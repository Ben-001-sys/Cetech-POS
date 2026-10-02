# STAFF-QUOTE-132 — urgent price-delay correction

Kind: REVIEW_HANDOFF / 2 October 2026. Acting human: @wbdevworld, WS3 with bounded consumer implementation delegation recorded in CURRENT-WORK.md. Starting application: `1021cd113c783e25030fe9c0bda1be9ddcf5888c`. Contributor: `ws3/quote-latency-2026-10-02`. Issue: [#132](https://github.com/WB-DevWorld/cetech-pwa-pos/issues/132). Final candidate SHA is recorded in the PR because a commit cannot contain its own hash.

The owner reports two to five minutes between clicking an item and seeing its cart price. The screenshot shows an online, open-shift Sell screen stuck on “Updating price…”. A successful stored quote does not establish timely display.

## Observed evidence

- The current database has repeated successful snapshots for unchanged cart revisions: revision 2 at approximately 15:46:50 and 15:47:51–57 UTC; revision 3 has eight snapshots between 15:51:24 and 15:52:14 UTC. These snapshots do not measure browser display duration or prove every request was redundant.
- Vercel quote logs between 15:35 and 15:59 UTC include successes and validation failures, without a quote runtime-error cluster. The available log output did not include request duration.
- Two read-only, unauthenticated GETs to the training WordPress bridge health route returned expected 401 responses after 29.035 and 39.498 seconds. They measure the combined network/HTTP/bootstrap path, not authenticated cart-pricing execution. Proxy/network overhead remains a possible contributor.
- Source recreates the pricing port on staff authority refresh and depended on restored line/customer object identities. Equivalent objects could cancel and restart a pending price check. Browser and upstream quote fetches had no explicit timeout.

## Correction

- Keep the browser pricing port stable across authority refreshes. Depend on the commercial request contents rather than equivalent restoration objects. Preserve cart identity/revision, online revalidation, stale-response and expiry guards.
- Join only active identical upstream quote work in the same process, scoped by bridge service, organization and the whole translated cart request. Different organizations, customers and revisions remain separate. Completed quotes are not cached or reused.
- Abort the upstream quote fetch after 45 seconds and the browser fetch after 60 seconds. Transport exceptions become typed failed quote states. A failed/expired price check offers “Check price again”; retry preserves the cart and Pay remains blocked while revalidating. Changed-price review is unchanged.
- Log total quote duration and session/assignments/catalog/bridge/snapshot stage durations using only a correlation reference, duration and outcome. No credentials or customer/cart contents are logged.
- Update the canonical brief, training guide, workbook and formatted folder copies together. All 64 test numbers and 16 modules are retained; the September 24 canonical historical brief is unchanged. The revised brief explicitly says the candidate is not yet live.

## Verification at the local candidate

Required runtime: Node 24.21.0, pnpm 12.4.1, TZ=UTC.

- `python3 scripts/verify_control_plane.py`: PASS.
- `pnpm --dir apps/pos-web lint`: PASS, zero errors; five existing warnings.
- `pnpm --dir apps/pos-web typecheck`: PASS.
- `pnpm --dir apps/pos-web test`: PASS, 188 files / 1,418 tests. An initial run used the host's non-UTC timezone and failed one existing receipt-time expectation; the UTC run passed without receipt code changes. Test-generated evidence/fixture timestamp changes were removed.
- `pnpm --dir apps/pos-web build`: PASS, including the final route exception handler.
- New meaningful checks: active-request coalescing/no completed cache/per-caller references; organization/customer/revision separation; upstream and browser abort handling; a rejected pricing adapter produces a failed state and blocks Pay.
- New browser regression cases cover an authority refresh while a quote is pending, and failed-price retry preserving the exact cart request. Local Playwright verification is BLOCKED: the matching Chromium download repeatedly returned an invalid/truncated ZIP. The cases must pass in GitHub CI; no browser PASS is claimed here.
- Canonical/copy equivalence, 64 tests, 16 modules and preserved September history verified by the preparation script; `git diff --check`: PASS.

No contracts, ADRs, migrations, dependency versions, commerce pricing formulas or payment/sale/refund execution paths changed. No live sale, payment, refund, stock action, staff/register/device mutation or protected #102 operation was performed.

## Rollout and remaining work

The owner explicitly requests the correction at the existing URL when testers refresh:

`https://cetech-pos-staging-git-integration-9578df-wbdevworlds-projects.vercel.app`

That URL currently identifies original frozen deployment `dpl_89TVtntmRzjMi8WgdgvkU35KVFLn`. No alias move, integration/main merge or new deployment is claimed. The exact-SHA Preview workflow requires CI-green qualification and an independent exact-head authorized human approval before deployment; it does not itself move the shared alias. Production is outside this task.

Before rollout: pass CI on the exact candidate, obtain the required independent review, deploy in Preview and explicitly bind the existing alias to the qualified deployment using an authorized deployment capability. Preserve the accepted origin, allowed origin configuration, saved cart and local journal. Verify the alias's deployment/SHA identity before telling staff to refresh. Record the confirmed live build in the revised brief and republish formatted folder pages.

After rollout: time a real authenticated whole-cart quote and its visible display; use stage timing references to separate WordPress bridge delay from other services. A basic 401 health response, mock/browser regression or timeout alone cannot close #132. Training host inspection is still needed if upstream latency remains; no SSH credential was available in this environment. Keep #132 open until live performance evidence is satisfactory.

Freshness protocol: implementation is isolated at the original frozen head. Final two-pass upstream observations and final candidate/CI/review/deployment status belong in the PR handoff. Until they are recorded, freshness is UNVERIFIED and this is a provisional candidate.
