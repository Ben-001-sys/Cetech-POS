# CAN-07 staff invitation configuration

Application code sends invitations through the existing admin path:

`POST /api/pos/v1/admin/staff/invite` → `StaffIdentityAdminStore.invite` → Supabase Auth `POST /auth/v1/invite`.

The server adds `redirect_to={APP_ORIGIN}/auth/invite`. The request body cannot choose that address. Staging and production require an explicit `https` `APP_ORIGIN` that is not localhost. `APP_ORIGIN` and `NEXT_PUBLIC_APP_ORIGIN` must be that root origin only: no username, password, path, query, or hash. A path such as `https://pos.example.com/some/path` is rejected and is not trimmed back to the host. A one-off `VERCEL_URL` deployment hash is not an invitation destination. If the origin is missing or unsafe, the invitation is not sent.

Accepting the invitation at `/auth/invite` only lets the invited person set a password. It does not create a POS role, register assignment, or organization control membership. POS access stays disabled until an owner or admin assigns it. The person then uses ordinary POS sign-in.

## What this repository can configure

Local Supabase, in `supabase/config.toml`:

- `site_url` stays the local app origin.
- `additional_redirect_urls` includes the exact local `/auth/invite` addresses.
- `[auth.email.template.invite]` uses `supabase/templates/invite.html`.

The local template links to GoTrue `{{ .ConfirmationURL }}`, which carries the server-supplied `redirect_to`. Restart local Supabase after changing the template or allow-list.

## What code cannot set on a hosted Supabase project

Set these in the hosted Auth dashboard for the staging or production project. Deploying the application does not change them.

1. **Site URL.** Set the stable `https` application origin, for example `https://pos-staging.example.com`. Do not leave a localhost or local Site URL on a hosted project. If Site URL is localhost, invitation links that omit an allowed `redirect_to` open localhost.
2. **Redirect allow-list.** Add the exact URL `{APP_ORIGIN}/auth/invite`. GoTrue ignores a `redirect_to` that is not on this list and falls back to Site URL.
3. **SMTP sender.** Configure the hosted project's custom SMTP. Local Inbucket does not deliver hosted mail.
4. **Invitation email template.** Point the hosted Invite template at the same acceptance wording, with `{{ .ConfirmationURL }}` as the link. Do not paste access tokens, service-role keys, or a Vercel deployment hash into the template.

Also set the matching Vercel (or host) `APP_ORIGIN` to that same stable `https` origin. Until that origin exists, invitation send fails before delivery instead of using a generated deployment URL.
