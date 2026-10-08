# Ben's CETECH POS — Hetzner/Dokploy practice deployment

This configuration is private training/deployment work in Ben-001-sys/Cetech-POS, based on original CETECH POS source commit `7f0c897d068c90e44e6f183c218f934ccdbb7cf4`. It is NOT a qualified production release. No writes are made to WB-DevWorld/cetech-pwa-pos.

## Deployment architecture

Browser -> HTTPS / Dokploy Traefik -> `pos-web` port 3000 -> approved Supabase and training WordPress bridge.
No PostgreSQL container, WordPress instance, privileged API or Keycloak container is introduced by this Compose file. Supabase remains externally hosted.
Compose deploys the `pos-web` application; use Dokploy's Docker Compose mode (not Docker Stack).

## Before deploying

1. Use Dokploy on the assigned Hetzner host with Docker Compose functioning.
2. Configure a real staging hostname resolving to the host, with TLS/HTTPS. Register its required redirect/origin settings with Supabase as appropriate.
3. In Dokploy create Project -> Service -> Compose. Use Git/HTTPS `https://github.com/Ben-001-sys/Cetech-POS.git`, branch `main` and Compose Path `./docker-compose.yml`.
4. In Dokploy's Environment section set the variables listed below. Never commit credentials or copy them into the Dockerfile. Dokploy reads environment values into Compose.
5. Deploy and configure the domain in the **Compose** Domains tab using service `pos-web` and internal container port `3000`. Dokploy applies its proxy routing; redeploy after domain changes. Do not publish port 3000 to the public host.
6. Validate application response, staff authentication, Supabase session/store, bridge health, PWA manifest/service worker and restart behavior. Protected health routes may require a staff session and should not be assumed to return HTTP 200 anonymously.

## Required Dokploy Environment values

`APP_ORIGIN=https://<actual-pos-hostname>` (exact deployed HTTPS origin)
`SUPABASE_URL=https://<approved-staging-project>.supabase.co`
`SUPABASE_PUBLISHABLE_KEY=<publishable-or-anon-key>`
`SUPABASE_SERVICE_ROLE_KEY=<server-only-secret>`
`NEXT_PUBLIC_SUPABASE_URL=<same-public-Supabase-URL>`
`NEXT_PUBLIC_SUPABASE_ANON_KEY=<browser-safe-anon-key>`
`BRIDGE_BASE_URL=https://<training-wordpress-host>/wp-json/cetech-pos/v1`
`BRIDGE_USERNAME=<dedicated-training-bridge-account>`
`BRIDGE_APPLICATION_PASSWORD=<server-only-application-password>`

Use actual approved credentials in Dokploy only. Do not paste their values into issue bodies, assistant messages or GitHub. Public NEXT_PUBLIC variables are baked into the Next.js browser bundle at **build time**. Updating either public value requires an image rebuild, not merely a container restart.

`BUILD_ID` may be set to the exact personal repository deployment SHA, particularly when updating the PWA. `APP_ENV=staging` and `PAYMENT_PROVIDER=disabled` are fixed in this practice Compose setup.

## Runtime and rollout boundaries

This copy includes the exact 2026-10-03 source commit; its original CI Linux pgTAP suite reported failures around `pos_jwt_claims()`. Independent human approval, migration qualification, and environment-specific safe-write isolation were not established by the clone. No migrations should be applied against the connected Supabase project without explicit review and authorization. A successful container start does not clear those gates.

This configuration does not enable live payments, production Woo order/stock/refund effects or VitePOS cutover. Use only approved staging/training integrations, with business writes disabled unless their isolation and authorization are confirmed.
