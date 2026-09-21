# Deploy Orbit from GitHub

This repository prepares two Render web services and MongoDB-backed persistence. It has not by itself created a live deployment. Both services are paid resources; deployment requires the owner's cost approval. Public registration stays disabled until launch review is complete.

[Deploy the Orbit repository to Render](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2FCarter-75%2FOrbit)

## Cost to review first

As checked September 20, 2026, Render's `0.5c-512mb` service plan costs $7/month per service. Two services total **$14/month in base compute**. This is not the complete operating bill: Atlas, email, outbound bandwidth over included allowances, workspace upgrades and payment/ad-provider costs are separate. Compute is prorated. No disk is requested. The new compute plan identifier replaces the old `starter` identifier without a pricing change. [Render pricing](https://render.com/pricing), [compute plan IDs](https://render.com/docs/compute-plans)

Do not select a free instance expecting equivalent availability. No spending has been authorized by this file.

## Smallest setup flow

1. Push the finished code and lockfile to [Carter-75/Orbit](https://github.com/Carter-75/Orbit). Let GitHub's Platform checks finish successfully. The workflow installs locked dependencies and runs syntax checks, database-backed tests, and a production-dependency vulnerability audit.
2. Create an Atlas cluster and an application database user scoped to the `orbit` database. Obtain its `mongodb+srv://` URI without posting it in GitHub or chat. Create a second user for the asset service, ideally with only the required collection-read privileges; use the same database name for both services. The asset service must not build indexes or write data with that read-only identity.
3. Connect GitHub to Render and open the deployment link above. Review the two services and estimated charges. Initial setup asks for each service's `MONGODB_URI`, plus the app's `RESEND_API_KEY` and verified `EMAIL_FROM`. Supply the asset user's URI to `orbit-assets`. Set up a verified sending domain with Resend before expecting account verification/recovery email delivery.
4. Add the selected Render services' outbound IP ranges to Atlas Network Access. Get the ranges from each service's Connect → Outbound view. The database handshake can fail until this is done; retry the failed deploy after allowlisting. Do not use unrestricted `0.0.0.0/0` merely to skip setup. [Atlas connection prerequisites](https://www.mongodb.com/docs/atlas/connect-to-database-deployment/), [Render outbound IPs](https://render.com/docs/outbound-ip-addresses)
5. Verify `/health/ready` returns a successful response on both services. Test account/email flows, imported games, separate-player multiplayer and persistence across a redeploy. Keep `PUBLIC_LAUNCH` false until outstanding release gates are resolved.

Build/start commands, Node version, health routes, instance counts and cross-service origin configuration are in `render.yaml`; no manual Render command/port changes are intended. Render injects the listening port. No `.env` file is committed or needed on Render.

## Why there are two services

The app serves trusted platform pages, identity and realtime connections. `orbit-assets` serves third-party game files from a separate browser origin, without platform authentication cookies. Uploaded files are stored with version records in MongoDB, rather than on Render's ephemeral filesystem. The current small-bundle limit is 5 MB per version; larger engine exports require the object-storage upgrade before claiming support.

`ASSET_ORIGIN` references the asset service's `RENDER_EXTERNAL_URL`. The asset service's `APP_ORIGIN` references the app's `RENDER_EXTERNAL_URL`, and its `ASSET_ORIGIN` references itself. These are full public HTTPS URLs. Render's `host` property is a private-network hostname and is deliberately not used here. Blueprint interpolation is unsupported; the file uses documented `envVarKey` references. References update on Blueprint sync. [Blueprint environment references](https://render.com/docs/blueprint-spec), [default URLs](https://render.com/docs/environment-variables)

If adding custom domains later, explicitly update both origin values through a repository configuration change and verify cookie isolation and allowed frame origins. `RENDER_EXTERNAL_URL` denotes the provider's onrender.com URL, not a promise to follow a custom domain.

## Launch, recovery and scale

- Public launch is a separate release decision for the intended 13+ audience. Complete the operational/security review before changing `PUBLIC_LAUNCH` to `true` in the Blueprint. Email credentials alone do not establish moderated public-launch readiness.
- Paid deployment does not enable live monetization. Stripe and advertising remain gated by provider setup, verified integration, approved commission/fees and actual business eligibility. See `research-hosting-monetization.md`.
- The Blueprint deliberately runs one app instance. In-memory rooms are interrupted by app restarts; persistent accounts/games should survive through Atlas. Shared room routing/state and reconnect recovery must be verified before increasing the instance count. [Render WebSockets](https://render.com/docs/websocket)
- Choose an Atlas backup offering appropriate to production, enable it, and perform a restore into a separate database before launch. Record restore time and verify users, game versions and ledger consistency. A database backup is not a substitute for testing restoration.
- A rollback requires redeploying a known-good code commit on both services. Keep database migrations backward-compatible or prepare a tested restore/migration reversal. Never overwrite the production database during a rollback experiment.
- For a red health check, inspect sanitized startup logs, Atlas allowlisting and secret values; never print database URIs. For asset failures, verify both services point to the same database and the iframe points to the isolated asset origin.
- Render requests `sync: false` secrets on initial Blueprint creation only. Adding a new secret later requires provider-side secret entry; it cannot be supplied securely in source control. [Blueprint secret handling](https://render.com/docs/blueprint-spec)

## Verification status

The YAML is prepared using current provider documentation. Local parsing is not equivalent to a Render account-side Blueprint validation or live deployment. Those require a connected account and must be recorded separately. Cross-service URL resolution, outbound access, real email delivery, uptime, backup restoration and production load are release checks, not claims made by this document.
