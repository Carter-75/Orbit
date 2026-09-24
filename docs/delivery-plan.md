# Orbit delivery plan — 2026-09-20

Status: active implementation. Not production ready or deployed.

## Baseline audit

Seven prototype files, no repository, dependencies, database, tests, real accounts, upload workflow, or deployment manifest. Fake activity and friends. Static handler serves entire working directory. WebSocket parser cannot handle fragmented/coalesced TCP frames, does not authenticate upgrades, and has no quotas or reconnect recovery. Chat key handler intercepts typing. Browser verification in earlier conversation did not demonstrate working multiplayer. Prototype preserved under archive/prototype-2026-09-20 before replacement.

## Intended architecture

- Maintained Node/Express application and WebSocket transport; MongoDB persisted identity, sessions, social graph, projects, versions, reports and money ledger.
- Explicit public static directory; no repository-root serving. Private session cookies and same-origin mutation checks. No browser secrets.
- Separate asset service origin, sandboxed iframe, versioned assets and capability-limited postMessage bridge. ZIP browser exports supported initially; native binaries/Roblox files unsupported. Creator servers require a later isolated execution service, not execution inside the API process.
- Render Blueprint, GitHub CI, MongoDB indexes and environment preflight. Single-instance beta only until shared realtime coordination is implemented and tested. Asset storage choice pending hosting research.
- Stripe Connect test flows first; live commission, costs and payouts await user approval. Ads pending eligible provider approval; no invented ad revenue.
- ChatGPT: official plugin docs confirm MCP tools and optional iframe UI; likely useful for discovery and creator status. This does not establish arbitrary embedded game compatibility or publication approval.

## Milestones and acceptance evidence

1. Foundation: explicit server boundaries, validated configuration, real Mongo-backed accounts/sessions/recovery, security tests and persistence checks.
2. Publishing: a second independent creator imports a documented browser ZIP, previews, submits/publishes, updates/rolls back, while untrusted code cannot access platform sessions.
3. Social/gameplay: distinct users friend/block/invite, join a published example, synchronize state, reconnect; mobile and keyboard checks; no fake metrics.
4. Revenue/admin: test webhooks, deduplication and entitlements, cancellation/refunds/disputes, creator ledger; moderation/support/reconciliation controls.
5. Delivery: reproducible fresh deployment, backup restore and restart checks, measured capacity, clear operational runbook, final requirement audit.
6. Launch materials: cited positioning/channel experiments, original visual assets, honest copy, vertical/horizontal videos where possible or complete fallback production package.

## Decisions pending

- User confirmed ages 13+, with age-appropriate protections. Account age-band checks implemented; broader teen controls still required before public launch.
- User supplied https://github.com/Carter-75/Orbit, verified empty/public. Local Git initialized and origin configured. GitHub CLI connected to Carter-75, checked without exposing credential.
- No Mongo/Render/Stripe/ad account configuration established. Work continues locally without live billing or external promotion.

## Verification levels

Record implemented, locally verified, staging verified and production verified separately. A mock or syntax check is not evidence of an end-to-end live flow. Goal remains active until all requirements have appropriate evidence or required external actions are explicitly surfaced after independent work is complete.

## First implementation checkpoint

- Installed maintained Express/Mongo/ws/validation dependencies. Initial package audit: zero reported vulnerabilities (not proof of application security).
- Implemented auth, email outbox, package validator, projects, separate asset service and launch grants; account/discovery/creator UI in public/.
- Auth, package, foundation and asset authorization tests passed locally against disposable real MongoDB. Projects tests passed separately. Rerun integrated suite after mounting social/admin modules and review final totals.
- Prepared Render Blueprint (two paid service definitions, no provisioning) and CI. Expected minimum compute $14/month per cited current plan; user has not authorized spending.
- No staging/production verification. No full browser-game isolation/SDK integration test yet. No video frames inspected; visual references remain text/image search descriptions.

### Integration checkpoint, September 21

Auth now uses durable mail queue with leases/retry and no recovery secrets in job payloads. Social and admin routes are mounted; friend UI added after a delegated UI task hit an agent usage limit. Social same-age-band restrictions are a provisional implemented policy, not the full teen safety program. Project/asset routes are mounted; studio styling linked. Production registration is disabled while PUBLIC_LAUNCH=false. Admin bootstrap and staging test-account creation still need an operator workflow.

Next required work: browser verification of account and creator flows; finish moderator/profile screens; platform SDK and starter packages; authenticated realtime rooms, privacy-aware presence/invitations and moderated chat; favorites/analytics/reports/support; full monetization; release/deployment evidence and promotion. Preserve this full scope through continuation.

Verification recorded September 21: complete integrated suite 26/26 passing; targeted foundation suite 2/2 passing after adding production-registration gate assertion. Public app/social modules pass syntax checks. These are local tests, not browser or production evidence. Git checkpoint preparation in progress; remote push/deployment not yet verified.

### SDK and realtime checkpoint

Previous foundation commit 69145b5 pushed to Carter-75/Orbit; GitHub CI run 35594001021 succeeded. Added authenticated single-instance WebSocket rooms with age-band/block checks, capacity limits, curated phrases, reconnect replacement, and session/grant revocation checks. Added capability-scoped game saves (8 KB JSON; preview isolated from published progress), browser MessagePort host bridge, distributable SDK and SDK documentation. Separate realtime and storage tests passed against real disposable MongoDB; browser handshake/isolation remains unverified. No deployment or billing activated. The broader release deliverables above remain active, including invites/presence, starter games, browser checks, admin/profile UI, monetization, operations and promotion.

Follow-up evidence: complete backend suite passed 28/28. Added Star Garden editable starter, Windows ZIP packaging script, and an explicit ephemeral two-origin demo with separate test accounts. Real browser checks verified SDK identity, two-account room joining, greeting delivery, save/relaunch persistence and cross-origin DOM denial. Details and limitations are in browser-verification.md. Fixed launch-error handling and low-contrast controls. No paid services or live launch occurred.

### Reporting and moderation checkpoint

Implemented player reports/support with private request history and public responses; game/social reporting entry points; moderator build-preview/review and report-response/suspension UI; atomic audited case decisions and permission/input/privacy tests. Real browser flow verified a local report submitted by DemoPlayer, resolved by DemoModerator, and returned as a public reply without internal notes. Full local suite: 29/29 passed. Added docs/moderation.md with operating gaps.

GitHub run 35596952599 for 7b605ca exposed a realtime cleanup timing failure (27/28 passed): client close preceded server room cleanup on Linux. Fixed runtime revocation to remove membership before closing, and prevented asynchronous joins from re-adding already-closed sockets. Local full suite passed after fix; remote follow-up required. Local moderation preview on ports 3010/3011 because older preview still held 3000/3001 and its attempted process stop failed. Both are disposable, not deployments.

Follow-up: moderation and cleanup commit 37c365f pushed; GitHub run 35633042840 passed all checks, including tests and production dependency audit.

### Library and analytics, September 24

Added private saved games (200 per account, atomic quota and duplicate protection), discovery/library toggle and removal controls including unavailable-game placeholders. Added owner-only 30-day daily launch-authorization counts excluding previews/owner/admin activity, with 90-day aggregate retention and no player identifiers in metrics. Explicit labels do not equate authorization with confirmed play, unique players, engagement or earnings. Publishing now sets publishedAt for discovery ordering. Full local suite 31/31 passed; browser verification of these new controls remains. See library-analytics.md for semantics and limitations. All broader outstanding goal requirements remain active.

Follow-up: 0864bf9 passed GitHub run 36024893788. Added profile editor with six labeled avatar presets, 160-character bio, verified-email edit gate, save feedback and stale-account request protection. Friend rows now render avatar/bio as safe DOM text. Social/profile tests 4/4 and script syntax checks passed. Browser verified profile save/reload, favorite save/reload/filter/removal and creator zero-count analytics rendering; see browser-verification.md. Full production, invites/presence, publishing UI end-to-end, finance/ads, operations and promotional deliverables remain unfinished.

### Presence checkpoint

Added opt-in friend-only online status, default off, 90-second expiry, visible-page polling and logout cleanup. Reads enforce verified/current accounts, accepted unblocked relationships, matching age bands (including pending adult transition), and current authorization version. No last-seen/history/game/room data is exposed. UI includes sharing choice and ambiguous private/offline labels. Targeted auth/social suite passed 10/10 before adding the explicit authorization-version assertion; full rerun follows. Browser presence and actual game invitation lifecycle remain required. See presence.md for policy and limitations.

Full integrated rerun after authorization-version assertion: 32/32 tests passed locally. Public social module syntax and diff whitespace checks passed. This does not constitute browser or production verification of online status.

### Game invitation checkpoint

Implemented expiring friend-to-live-room invitations with permission/session/build/age/block/capacity checks, owner-only single acceptance and decline; trusted-host send/list/join controls; SDK bridge auto-join routing and live room callback; production/local room-directory integration. Targeted real-Mongo invitation tests passed and changed browser modules passed syntax checks. Browser automatic-join verification remains required, alongside presence verification. No external messages or invitations to real users were sent. Full remaining platform, finance, deployment and launch scope is unchanged.

Integrated invitation checkpoint: all 33 local tests passed. Diff whitespace checks passed. Backend room-directory tests are controlled fixtures; actual two-browser invitation flow remains the next verification step.
