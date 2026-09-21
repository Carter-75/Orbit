# Hosting and creator monetization research

Reviewed 2026-09-20 against the primary sources linked below. This is architecture research, not evidence that any account, service, or live payment integration has been provisioned. No deployment or spending occurred during this research.

## Verified provider facts

### Render and GitHub

- Render supports public WebSockets on a web service's HTTP port; use WSS publicly. Connections can end on deploy or maintenance. Implement heartbeat, backoff, graceful shutdown and resumable state. New connections are assigned randomly across instances, without affinity. Public outbound WebSocket traffic counts toward bandwidth. [WebSocket documentation](https://render.com/docs/websocket)
- A root `render.yaml` can describe services, build/start commands, health checks, generated secrets, requested external secrets, scaling, and deployment configuration. Disk-attached services cannot scale horizontally; automatic scaling requires a Pro workspace or higher. [Blueprint specification](https://render.com/docs/blueprint-spec)
- A Deploy to Render button can explicitly target a repository. A private GitHub repository requires Render's GitHub App access. Render recommends disabling automatic deploys for widely distributed template buttons; the owner's own production repository can instead deliberately use its tested release workflow. [Deploy button documentation](https://render.com/docs/deploy-to-render)
- Filesystem changes normally disappear on restart/redeploy. Paid services can attach a persistent disk, but only its mount path persists. [Persistent disks](https://render.com/docs/disks)
- Free web services have usage limits and cannot attach persistent disks. They are unsuitable as the assumed availability model for a public multiplayer launch. [Free tier](https://render.com/docs/free)
- Costs include workspace, compute, bandwidth and storage. The fetched pricing result lists persistent disks at $0.25/GB/month; the dynamically rendered compute table was not available in the page extraction, so a trustworthy full monthly quote needs the actual selected plan checkout. Do not claim a complete fixed-cost deployment from this research. [Pricing](https://render.com/pricing)

### MongoDB Atlas

- Atlas needs a database user, connection string, and allowed source IP/network. Atlas account login is separate from database credentials. [Connection prerequisites](https://www.mongodb.com/docs/atlas/connect-to-database-deployment/)
- Render publishes region-specific outbound CIDR ranges, shared with other services in that region. These can be allowlisted in Atlas; dedicated outbound IPs are another paid option. Retrieve actual ranges for the selected service rather than hard-coding an example. [Outbound addresses](https://render.com/docs/outbound-ip-addresses)
- Atlas connection limits depend on tier. Bound application connection pools instead of opening a new connection per request. [Atlas troubleshooting](https://www.mongodb.com/docs/atlas/troubleshoot-connection/)

### Subscriptions and creator payouts

- Stripe Connect supports subscriptions to connected creators and percentage platform fees. Destination subscriptions can route proceeds to the creator with `transfer_data.destination` and `application_fee_percent`; the platform assumes Stripe fees, refunds and chargebacks with this model. Direct charges offer a different allocation of responsibility. Creator connected accounts and prices/customers must be created in the appropriate account scope. Account and subscription webhooks are necessary to follow eligibility and access changes. [Connect subscriptions](https://docs.stripe.com/connect/subscriptions)
- Verify webhook signatures with the unmodified raw request body. Register a public HTTPS endpoint, or use Stripe CLI forwarding for local tests. Subscribe to the correct platform/connected-account event scopes. Delivery handling must tolerate duplicates and ordering differences. [Webhook documentation](https://docs.stripe.com/webhooks)
- US list pricing shown for platform-controlled Connect pricing includes $2 per monthly active payout account and 0.25% + $0.25 per payout, alongside payment processing and other applicable fees; the page also lists routing fees and alternative pricing models. Stripe-managed pricing differs. This is not a universal country-specific quote. Billing fees are additional and must be checked for the selected account. [Connect pricing](https://stripe.com/connect/pricing)

### Browser game advertising

- Google's H5 Games Ads supports interstitial and rewarded placements, including games in iframes. Place full-screen ads at natural breaks. [H5 help](https://support.google.com/adsense/answer/9959170?hl=en)
- The current H5 product page advertises integration with AdSense for Platforms for dynamic two-way revenue sharing. Publishers may apply, but approval remains Google's decision. [H5 product and eligibility](https://adsense.google.com/start/h5-games-ads/)
- AFP is an enterprise integration with registration of interest, creator account linking, reporting and built-in revenue sharing paid to each party by Google. It must not be treated as an automatically available self-service switch. [AFP overview](https://developers.google.com/adsense/platforms)
- Google's older Ad Placement payments page says the game host controls the monetization tag and further revenue sharing, describing only simple one-way sharing. This conflicts in scope/freshness with current H5/AFP marketing. Confirm the actual approved program and integration with Google before enabling live revenue shares. That page also requires the ad tag in the game document, which matters for an isolated iframe architecture. [Game payments](https://developers.google.com/ad-placement/docs/payments)

## Architecture recommendations (engineering judgment)

1. Serve the platform UI, API and WSS through a Render web service for simple deployment. Keep durable accounts, relationships, game versions, entitlements, reports and ledger records in MongoDB. Use a distinct, credential-free game-serving origin and strict iframe/message permissions for uploaded games.
2. Store immutable game assets in object storage with versioning, retention and a delivery origin. A persistent disk is an acceptable explicitly single-instance private beta compromise, not the intended horizontal scaling design. A shared MongoDB-backed asset store is another initial option requiring size/throughput testing; neither should be represented as unlimited storage.
3. Before running multiple realtime instances, implement shared room ownership/routing, presence and pub/sub. MongoDB alone does not automatically synchronize in-memory game loops. Document single-instance constraints until this exists and load tests pass.
4. Do not execute arbitrary creator server programs inside the platform process. Start with browser bundles and a capability-limited SDK; server-authored games need a separate isolated compute service and resource controls.
5. Provide a single setup command/checklist for account connections, secrets and external approvals. Fail startup clearly when required configuration is absent. Never silently fall back from a production database to transient memory.
6. Start payments in test mode. Use provider-hosted onboarding and checkout, server-owned prices, creator ownership checks, immutable commission snapshots and an auditable ledger. Grant access from verified payment state, never a browser success redirect. Test refund/dispute reversal, duplicate events, cancellation at period end and failed renewals.
7. Offer an illustrative 10% platform commission for discussion, not a configured live commitment. It may be uneconomic for tiny subscriptions: at a hypothetical $5 sale, 10% is only $0.50 before processing, Billing, Connect, hosting and support. Decide explicitly who bears each fee and minimum payout timing before promising creator net earnings.
8. Keep ads disabled until approval, consent/audience policies and iframe integration are verified. SDK ad requests should return honest unavailable/skipped outcomes. Browser callbacks are not reliable financial evidence; reconcile earnings to provider reporting. Do not invent CPMs, balances, guaranteed fill, or guaranteed income.

## External requirements and release gates

| Requirement | Can be prepared in code | Needs external action or proof |
| --- | --- | --- |
| GitHub/Render deployment | Blueprint, deploy link, CI, health checks | Authorized repository destination, provider connection, selected cost approval, deployed smoke test |
| MongoDB | URI validation, indexes, pooling, migrations | Cluster/user, secret, IP access, chosen backup plan and restore drill |
| Assets/realtime scale | Storage adapter, room protocol, load script | Storage credentials, traffic/capacity measurement, shared-state test |
| Creator subscriptions | Onboarding/checkout/webhooks/ledger | Stripe activation, identity/tax/bank details, commission decision, sandbox end-to-end proof |
| Creator ads | SDK contract, disabled adapter, reporting schema | H5/AFP approval, publisher IDs, consent setup, verified isolation compatibility and revenue reports |
| Public launch | Operational docs, reporting/admin UI | Intended audience and countries, tested moderation/support process, real availability and security review |

The minimal owner workflow can be account connection plus secret entry and review of cost/monetization choices. It cannot honestly be zero-input production launch: identity verification and publisher approval cannot be manufactured from repository settings.
