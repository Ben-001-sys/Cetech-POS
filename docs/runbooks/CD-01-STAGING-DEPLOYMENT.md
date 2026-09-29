# CD-01 — Shared Staging Deployment

Status: proposed repository delivery control for issue #64. This runbook does **not** authorize production promotion, live electronic payment, refund/restock effects, or VitePOS cutover.

## Purpose

The repository already performs continuous integration on `main` and contributor/milestone branches. CD-01 adds the missing continuous-delivery step for accepted work: after the existing `CI` workflow succeeds for a push to `main`, the exact CI-tested commit is deployed to Vercel Preview for ongoing runtime, browser, device and integration testing while later milestones continue in parallel.

A custom staging domain is optional. Until one is configured, the immutable Vercel Preview deployment URL returned by the deployment command is the staging URL.

## Delivery model

```text
contributor branch / milestone PR
            |
            v
           CI
            |
     review + merge
            |
            v
          main
            |
            v
           CI  (exact main SHA)
            |
      SUCCESS only
            |
            v
  Staging CD workflow
            |
            v
 Vercel preview deployment
            |
            +--> immutable Vercel URL (required)
            |
            +--> stable custom alias (optional later)
            |
            v
 runtime/device testing
```

A failed CI run does not deploy. A successful CI run for anything other than a `push` to `main` does not deploy. The deployment workflow checks out `workflow_run.head_sha`, not a moving `main` branch.

## Why Vercel Preview is used for this transitional staging deployment

The current transitional architecture selected Vercel for the Next.js POS web application. Vercel Preview deployments provide a non-production target while keeping production promotion separate.

CD-01 uses the Vercel CLI sequence:

1. run `vercel pull --environment=preview` from the repository root;
2. verify the linked Vercel project declares `rootDirectory=apps/pos-web`;
3. set `BUILD_ID` in the build process environment and run `vercel build` from the repository root;
4. run `vercel deploy --prebuilt --env BUILD_ID=<exact-tested-sha>` from the repository root;
5. smoke-test the immutable deployment URL with authenticated `vercel curl`;
6. optionally `vercel alias set` when `VERCEL_STAGING_ALIAS` is configured;
7. if an alias is configured, smoke-test the alias with authenticated `vercel curl`.

The workflow pins Vercel CLI `59.17.0` rather than using an unbounded `latest` install. It invokes that transient CLI through pinned `npm exec` rather than `pnpm dlx`: pnpm 12's strict dependency-build policy blocks the transient Vercel CLI's `esbuild` install script unless separately approved. This avoids weakening the repository's workspace `allowBuilds` policy merely to run a deployment utility.

`vercel build` in CLI `59.17.0` does **not** accept `--build-env`. The exact CI-tested SHA is therefore supplied to the local build through the step's `BUILD_ID` process environment. The `--env BUILD_ID=...` flag remains on `vercel deploy --prebuilt` so the same exact SHA is available to the deployed runtime.

### `vercel curl` authentication rule

The GitHub `staging` job already exports `VERCEL_TOKEN`, which is a supported Vercel CLI authentication mechanism. The smoke commands therefore use `vercel curl / --deployment <url>` without appending a command-level `--token` argument. With `vercel curl`, native curl arguments such as `--fail` and `--show-error` are forwarded to curl; placing `--token` after the `curl` subcommand caused CLI `59.17.0` to forward it to native curl as well, which fails because native curl has no `--token` option.

Keep `VERCEL_TOKEN` in the job environment and retain `--fail --show-error` so protected Preview authentication is handled by Vercel while HTTP 4xx/5xx responses still fail the workflow.

### Monorepo root invocation rule

The Vercel project owns the application subdirectory through `rootDirectory=apps/pos-web`. Therefore **all Vercel CLI commands in CD-01 run from the repository root**. Do not also set the GitHub Actions working directory to `apps/pos-web`, because that would cause Vercel to compose the configured project root a second time and resolve `apps/pos-web/apps/pos-web`.

The workflow verifies `.vercel/project.json` after `vercel pull` and fails if the downloaded project settings do not report `apps/pos-web` as the configured root directory. `settings.rootDirectory` is the canonical current Vercel CLI field; `projectSettings.rootDirectory` is accepted only as a defensive compatibility fallback.

### Runtime evidence from the first three CD attempts

The first post-merge CD-01 attempt failed before deployment because `vercel build --build-env` is unsupported by CLI `59.17.0`.

The second attempt confirmed the build-process environment fix worked: `vercel build` completed successfully, but `vercel deploy --prebuilt` then failed because the workflow was running inside `apps/pos-web` while the Vercel project also declared `rootDirectory=apps/pos-web`. Vercel therefore tried to resolve a nonexistent `apps/pos-web/apps/pos-web` path.

The third attempt, Staging CD run `35128628092` for exact main SHA `65489066db752fb619b5b6933ead38e6d843fc41`, passed configuration validation, exact-SHA checkout, frozen install, Vercel Preview pull, root-directory verification, local Vercel build, and **successfully created a real Vercel Preview deployment** at `https://cetech-pos-staging-c4cgnym0c-wbdevworlds-projects.vercel.app`. The subsequent smoke step failed only because `--token="$VERCEL_TOKEN"` was placed after the `vercel curl` subcommand and was forwarded to native curl, which reported `curl: option --token=***: is unknown`. Vercel had already successfully generated a deployment-protection bypass token before that native-curl argument error.

The third attempt therefore proves deployment creation now works, but CD-01 runtime acceptance remains pending until the protected immutable smoke probe succeeds and deployment evidence is recorded. No stable alias, production promotion, payment execution, refund/restock effect, or VitePOS cutover was performed.

## Origin protection without a custom staging domain

The POS mutation guard requires the request origin to exactly match one of the server's allowed origins; wildcard origin trust is not allowed.

A Vercel CLI Preview deployment receives a unique deployment URL. For this no-custom-domain phase, `apps/pos-web/src/config/env.ts` resolves the application origin in this order:

1. explicit `APP_ORIGIN`;
2. explicit `NEXT_PUBLIC_APP_ORIGIN` for compatibility;
3. exact HTTPS origin derived from Vercel's runtime `VERCEL_URL` system value;
4. `http://localhost:3000` for local development.

`VERCEL_URL` is platform-provided deployment metadata, not a secret. It is accepted only as HTTPS and is normalized to an origin; malformed or non-HTTPS values are not trusted.

Vercel system environment variables must therefore be available to the deployment. New Vercel projects normally expose them by default; verify the project setting if runtime `VERCEL_URL` is absent.

## One-time external setup

The repository cannot create or recover hosting-account credentials. Complete these one-time steps in the relevant accounts before expecting a real deployment.

### 1. Create/link the Vercel project

Use one Vercel project for staging:

- project: `cetech-pos-staging`
- owner/team: the intended CETECH deployment account/team
- repository root used by the CLI: repository root
- project Root Directory in Vercel: `apps/pos-web`
- framework preset: Next.js
- Node.js: 24.x
- install/build/output commands: framework/project defaults unless a verified blocker requires an override
- Vercel Git auto-deployment may remain disconnected while GitHub Actions controls shared staging
- production deployment remains outside CD-01

Record the Vercel organization/team ID and project ID.

### 2. Configure GitHub staging deployment identity

Create GitHub environment `staging` and configure these environment secrets:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

`VERCEL_STAGING_ALIAS` is **optional**. Do not create it until a stable custom hostname is ready. When used, it must be a hostname without a scheme, for example:

```text
pos-staging.example.com
```

Do not put Vercel tokens or application runtime secrets in source, issues, PR bodies, comments, or browser-exposed variables.

### 3. Configure the Vercel Preview runtime environment

The Preview environment must point only to CETECH staging/training dependencies.

At minimum configure the current server/runtime variables required by the application, using real secret storage in Vercel:

```text
APP_ENV=staging

SUPABASE_URL=<staging Supabase URL>
SUPABASE_PUBLISHABLE_KEY=<staging browser-safe publishable key>
SUPABASE_SERVICE_ROLE_KEY=<staging server-only service key>

BRIDGE_BASE_URL=<training/staging /wp-json/cetech-pos/v1 origin>
BRIDGE_USERNAME=<dedicated staging bridge service user>
BRIDGE_APPLICATION_PASSWORD=<server-only staging application password>

PAYMENT_PROVIDER=disabled
```

During the generated-URL phase, **do not set `APP_ORIGIN` or `ALLOWED_ORIGINS` merely to a guessed Vercel URL**. The application will use the exact runtime `VERCEL_URL` for ordinary origin checks. If a stable custom domain is added later, set `APP_ORIGIN=https://<hostname>` and optionally add other explicitly trusted origins through `ALLOWED_ORIGINS`.

Staff invitation emails are stricter. They require that explicit `APP_ORIGIN` and do not fall back to `VERCEL_URL`. Until a stable https origin is configured, invitation send fails before delivery. Hosted Supabase Site URL, redirect allow-list, SMTP, and the invitation template are dashboard settings, not application code. See [CAN-07 staff invitation configuration](CAN-07-STAFF-INVITATION.md).

Do not configure a live Paystack key for CD-01. R7 retains its own sandbox/runtime acceptance gate. If a later milestone authorizes sandbox payment testing, that is a separate explicit change to the staging environment and must not silently become production authority.

The current app rejects public exposure of server-only configuration names. Keep privileged variables out of `NEXT_PUBLIC_*`.

### 4. Optional custom hostname later

A stable custom hostname is not required for the first staging deployment.

When one is added successfully later:

1. configure the hostname in Vercel;
2. configure GitHub variable `VERCEL_STAGING_ALIAS` with the hostname only;
3. configure Vercel Preview `APP_ORIGIN=https://<hostname>`;
4. redeploy;
5. verify both the immutable deployment URL and stable alias.

The alias step in CD-01 automatically activates only when `VERCEL_STAGING_ALIAS` is non-empty.

## What happens after merge

When CD-01 lands on `main`:

1. the normal `CI` workflow runs on that merge commit;
2. if CI fails, no staging deployment occurs;
3. if CI succeeds, `Staging CD` receives that completed run;
4. it verifies the required deployment credentials/project configuration;
5. it checks out the exact SHA that CI tested;
6. it performs a frozen workspace install;
7. from the repository root, it pulls Vercel Preview project settings and verifies `rootDirectory=apps/pos-web`;
8. it sets `BUILD_ID` to the exact CI-tested SHA in the local build process and creates the Vercel prebuilt artifact;
9. it deploys that prebuilt artifact and also supplies the exact SHA to runtime as `BUILD_ID`;
10. it captures the immutable Vercel deployment URL;
11. it smoke-probes the immutable deployment URL through authenticated `vercel curl` and fails on HTTP 4xx/5xx;
12. only after that smoke passes, if `VERCEL_STAGING_ALIAS` exists, it moves the alias to the deployment;
13. if an alias exists, it smoke-probes the alias and fails on HTTP 4xx/5xx;
14. it records the CI SHA and deployment URL, plus alias when present, in the workflow summary.

The required order is therefore:

`deploy immutable URL -> smoke immutable URL -> move optional alias -> smoke alias -> record deployment evidence`.

If Vercel token/org/project configuration is missing, the workflow records `BLOCKED_CONFIGURATION` and performs no deployment. A skipped deployment must never be reported as deployed.

## Staging safety rules

Shared staging is continuously replaceable application delivery, not permission to perform every business effect implemented in code.

The following remain independently gated:

- pricing parity/cutover truth in issue #4;
- electronic-payment provider sandbox/live execution;
- refunds and restock effects;
- production WooCommerce mutations not specifically authorized by their runtime gate;
- production promotion;
- VitePOS deactivation/cutover.

Feature/capability availability must continue to fail closed where its runtime authority is absent.

## PR previews

CD-01 deploys only accepted `main`. Do not expose GitHub/Vercel deployment credentials to arbitrary PR workflow code merely to obtain previews.

Provider-managed PR previews may be reconsidered later with an explicit safe-credentials model; they are not required for the shared staging deployment.

## Exact SHA Preview (manual)

Use this only when an immutable Vercel Preview of a CI-green candidate SHA is required **without** merging that candidate to `main` and **without** moving the shared staging alias.

Automatic Vercel Git previews may be disabled while GitHub Actions owns shared staging. That does **not** by itself prove a targeted Git-source deployment is impossible. Vercel can still create a Preview from a Git commit SHA when the project remains linked to `WB-DevWorld/cetech-pwa-pos`:

- Dashboard: Project → Deployments → Create Deployment → commit SHA
- REST: `POST /v13/deployments` with `gitSource.type=github` and the exact `sha`, omitting `target` so the deployment is Preview

Do not change Vercel Git settings merely to test that path. Do not use a local `vercel build --token` of unmerged candidate code: that executes candidate build scripts in a process that holds the deployment credential.

The trusted workflow is `.github/workflows/deploy-exact-sha-preview.yml` plus `scripts/exact_sha_preview.py` on protected `main`. `workflow_dispatch` is the invocation method. Do not add `pull_request_target`. Do not dispatch from a contributor branch.

Inputs:

- `candidate_sha` (required): full 40-character commit SHA
- `pr_number` (required): open same-repository PR whose **current** head must equal `candidate_sha`

### Credential boundary

- Candidate source is **never** checked out or built in GitHub Actions with `VERCEL_TOKEN`. The Actions runner holds the Vercel credential only for HTTPS calls to Vercel and authenticated `vercel curl` smoke.
- Candidate source **is** executed remotely by Vercel after a Git-source Preview request. Vercel may expose the project's Preview environment variables, including sensitive Preview variables, to that unmerged candidate build/runtime.
- Therefore CI-green plus same-repository is **not** sufficient authorization. Exact-head independent source review is required before any `POST /v13/deployments`.
- Preview remains non-production. The job does **not** pass `--prod`, does **not** assign a production alias, does **not** move the shared staging alias, and does **not** authorize live payment, refund, or restock.
- Do not print, enumerate, or retrieve secret **values**. Policy is enforced by workflow/script behavior, not by dumping environment contents.

### Exact-head review authorization

Before the workflow calls Vercel `POST /v13/deployments`, it fetches PR reviews and requires **one** independent exact-head `APPROVED` review.

Canonical repository rule (not a same-day availability hack):

- Protected `main` requires `required_approving_review_count: 1` and dismisses stale reviews.
- OWNERSHIP / ADR-014: senior-authored changes need a different competent human; the PR author cannot self-approve.
- Authorized repository reviewers are the verified humans in OWNERSHIP.md: `Ben-001-sys`, `Emmanuel-coder-prog`, and `wbdevworld`.
- Any one of those logins may satisfy the Preview gate **except** the current PR author.
- Simultaneous named approval from both developers is **not** repository policy and is not required by this workflow.

Rules:

- Only the latest effective `APPROVED` / `CHANGES_REQUESTED` review from that login on the **current** SHA counts.
- Approvals on older SHAs do not count.
- Older `CHANGES_REQUESTED` reviews on older SHAs do not block a later exact-head `APPROVED`.
- A later exact-head `CHANGES_REQUESTED` from that reviewer supersedes their exact-head `APPROVED`. If no other independent exact-head approval remains, the gate fails.
- Unrelated GitHub users do not count.
- If the independent exact-head approval is absent, the job stops with `REVIEW_AUTHORIZATION_REQUIRED` before any Vercel deployment request. The summary does not print review bodies or secrets.

Temporary reviewer unavailability does not change this durable rule and does not weaken branch protection.

### Source approval is not merge authorization

Exact-head approval of a candidate SHA is permission for **that reviewed source** to enter the credentialed Preview build/runtime so immutable Preview acceptance can proceed.

It is **not** final merge authorization. Independently of this workflow, a candidate such as REC-01 / PR #80 remains blocked by:

- immutable Preview runtime acceptance;
- REC-01 receipt / finalize / reprint acceptance;
- any acceptance failure;
- repository merge protections.

Ben or Emmanuel may therefore approve the exact source SHA before Preview execution while the PR remains explicitly non-mergeable operationally until runtime evidence passes. One independent exact-head approval is sufficient under repository policy; both are not required.

### BUILD_ID truthfulness

The trusted request supplies `BUILD_ID=<candidate_sha>` as a **request assertion**. Vercel Git metadata proving the Git source SHA is separate from observing the running application.

Summary language:

- Git source SHA: **VERIFIED** from Vercel deployment metadata.
- BUILD_ID request: **VERIFIED** that the trusted deployment request supplied the candidate SHA.
- Running application BUILD_ID: **PENDING RUNTIME VERIFICATION** until a later authenticated or otherwise safe application observation reports it.

Do not emit `DEPLOYED_PREVIEW` language that implies the running app BUILD_ID was verified unless that value has actually been observed. Do not add a public diagnostic endpoint on a candidate PR merely to satisfy this workflow. If an existing authenticated or safe endpoint can truthfully report the running build ID, later REC-01 acceptance may use it.

The job:

1. refuses to run unless the dispatch ref is `main` in `WB-DevWorld/cetech-pwa-pos`;
2. checks out the trusted dispatch SHA (`github.sha` / main), never the candidate SHA;
3. verifies the candidate SHA exists in this repository;
4. requires an open PR whose head and base repositories are exactly `WB-DevWorld/cetech-pwa-pos` and whose current head equals `candidate_sha` (forks are rejected);
5. verifies required jobs `control-plane` and `control-plane-windows` succeeded on a GitHub Actions workflow run of `.github/workflows/ci.yml` named `CI` for that SHA, not merely any check run using those names;
6. requires **one** independent exact-head `APPROVED` review from an authorized repository reviewer who is not the PR author, then **stops with `REVIEW_AUTHORIZATION_REQUIRED` before any Vercel deployment request** if that approval is missing;
7. uses GitHub environment `staging` secrets only inside the runner for HTTPS calls to Vercel (`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`);
8. confirms the existing Vercel project is Git-linked to `WB-DevWorld/cetech-pwa-pos`;
9. creates a Vercel Preview with `POST /v13/deployments` from that Git source and `BUILD_ID=<candidate_sha>` (no `target`, no `--prod`, no production/staging alias assignment);
10. polls until `READY` or `ERROR`;
11. proves Preview target and Git source SHA, records the BUILD_ID **request** as verified, leaves running-app BUILD_ID pending, and proves protected production aliases were not assigned;
12. smokes `/` on the immutable URL with authenticated `vercel curl`.

If the Vercel project is not Git-linked, or the Git-source API cannot address the exact SHA, the job stops with `GIT_SOURCE_UNAVAILABLE`. It does **not** fall back to checking out candidate code or running `vercel build --token`.

It does **not** assign a production alias, does **not** pass `--prod`, and does **not** consume or move `VERCEL_STAGING_ALIAS`. It uses a distinct concurrency group so it cannot cancel shared Staging CD.

After this workflow exists on `main`, an authorized operator may dispatch it **only after** the exact-head review gate is satisfied. Example for an open PR candidate:

```text
gh workflow run "Exact SHA Preview" --ref main -f candidate_sha=<40-char-sha> -f pr_number=<n>
```

Merging this workflow to `main` will itself cause ordinary Staging CD of that merge SHA. That is not a preview of an unmerged candidate. Production promotion, live electronic payment, refund/restock, and VitePOS cutover remain unauthorized.

## Production remains separate

Production promotion should later be implemented as a separate release workflow with all of the following:

- explicit human invocation;
- protected `production` environment approval;
- exact reviewed/release SHA;
- production-specific secrets and runtime configuration;
- release/cutover gates from REL-01;
- rollback evidence;
- post-deploy smoke checks;
- no automatic promotion merely because `main` is green.

Until that release control exists and its acceptance gates pass, `main -> staging` is the highest automatic promotion level.

## Verification after first real staging deployment

Record evidence for:

- exact Git SHA shown by deployment/build diagnostics;
- generated Vercel Preview root URL returns successfully;
- `VERCEL_URL` is present at runtime and origin-protected session/mutation requests work from that exact deployment origin;
- Supabase health is staging-only;
- bridge/Woo health points at training/staging only;
- no privileged browser secrets are present;
- electronic payment remains disabled unless separately authorized;
- one installed desktop/mobile PWA can load the deployed staging build;
- a subsequent accepted `main` merge creates a new immutable staging deployment only after CI is green.

If a custom alias is added later, verify the alias separately.

Do not claim CD-01 runtime acceptance until a real Vercel deployment has produced this evidence.

## Rollback

Application rollback is deployment-level and does not undo external commerce/payment/stock effects.

Without a stable alias, rollback means reopening/retesting the last known-good immutable Vercel deployment while the fix is prepared. With a stable alias configured later, move the alias back to the last known-good deployment.

In either case:

1. identify the last known-good deployment associated with an accepted `main` SHA;
2. record the rollback/fallback SHA and deployment in issue #64 or release evidence;
3. reconcile any external effects separately rather than assuming code rollback reversed them.

Never clear IndexedDB or cashier durable state as a routine deployment rollback mechanism.
