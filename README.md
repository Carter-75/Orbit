# Orbit

An independent creator game platform under active construction. Target audience: ages 13+. This repository is **not yet production ready**. No live ads, payments or production services have been activated.

## Current implementation

- Mongo-backed accounts, age-band checks, password hashing, secure sessions, verification/recovery and durable email outbox.
- Browser ZIP validation with bounded decompression, path/type/CRC checks; creator-owned projects, staged builds, review submission, approved-version publication and rollback.
- Separate asset service with sandboxed content and expiring launch grants. Draft previews require creator/admin ownership. No platform static source serving.
- Responsive discovery/account/creator screens using real data. Published catalog starts empty.
- Render Blueprint and GitHub checks. These remain deployment preparation, not proof of a live deployment.
- Authenticated social play, invitations, creator publication and separate-player browser regression checks.
- Test-only signed Stripe event intake and durable retry foundation; see [payment-event status](docs/payment-events.md). Checkout, paid access and payouts are not yet enabled or implemented.

## Local development

Use Node 22 and run `npm ci`. Copy `.env.example` to `.env` and provide a MongoDB URI, then `npm start`. Run asset hosting separately with `PORT=3001` and the same database settings (`node --env-file=.env src/asset-server.js`; set the port in your shell). Ports and both origin URLs must match.

For an explicit temporary development preview without your own database, run `node scripts/preview.js`. Its database is disposable, email is unavailable, and it is not a production startup path. Tests use their own disposable MongoDB instances: `npm test`.

## Delivery status and deployment

See [delivery plan](docs/delivery-plan.md), [deployment guide](docs/deployment.md), [account contract](docs/accounts.md), [hosting/monetization research](docs/research-hosting-monetization.md), and [product/security research](docs/research-product-security.md).

Remaining goal work includes expanded creator/social/admin workflows, stronger teen-specific controls and safety operations, provider monetization integrations and financial reconciliation, operational/load/security verification, production deployment, ChatGPT integration and promotional artifacts. Existing SDK, starter game and multiplayer functionality are documented under `docs/` and covered by selected local/CI tests, not a complete launch audit. Do not infer production readiness from passing tests.

The earlier local multiplayer prototype is preserved in `archive/prototype-2026-09-20` for reference. It contains known defects and is not the active application.
