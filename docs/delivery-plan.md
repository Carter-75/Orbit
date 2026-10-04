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

### Automated browser checkpoint

Added Playwright with an automatically managed disposable two-origin preview, generated validated starter package, and separate cookie contexts. Local UI scenarios individually passed for friends/presence/invitation/automatic multiplayer joining and creator upload/preview/submission → separate moderator preview/approval → creator publishing → separate player discovery/launch. The latter verifies one real player launch authorization in creator analytics. Screenshot inspection identified and fixed a stretched social avatar; the regression test checks its dimensions. Added a separate GitHub Chromium browser job with retained test evidence. Full backend rerun passed 33/33. Clean combined browser and remote CI verification follow; no live deployment, charges, financial activation or promotional publication occurred. Full original goal remains active.

Combined browser run exposed a 120/minute shared-IP quota and social refreshes exhausting the 30/minute action budget. Added coarse pre-auth network protection plus account/guest API quotas, JSON/no-store quota replies, and separate bounded social read/write quotas with regression tests. Clean combined Chrome rerun passed 2/2 in 16.5 seconds without retries. Remote GitHub browser verification remains a separate gate.

Final local backend rerun for this checkpoint: 34/34 passed. Script syntax and diff whitespace checks passed.

Remote evidence: commit 27ee58a passed GitHub run 36028654728, including the separate Linux Chromium browser job and backend tests/audit.

### Payment-event foundation, September 27

Using the payments skill and current primary Stripe references, added disabled-by-default test-only configuration, raw signed webhook intake, minimal durable event references, duplicate protection, leased canonical-event retrieval, bounded retry/exhaustion states and admin-only diagnostics. Seven targeted local tests passed against real MongoDB and real Stripe signature verification with a stubbed retrieval provider. No live keys are accepted; no checkout, entitlement, ledger or payout handler is installed, and no Stripe account was connected. Full backend rerun follows. See payment-events.md for exact contract and limitations. Financial integrations, deployment, promotion and the rest of the original objective remain unfinished.

Final checkpoint evidence: expanded payment suite 9/9 passed; full integrated suite 44/44 passed; production dependency audit reported zero vulnerabilities after authorized network access (the initial restricted-network audit failed, not a security finding). Syntax and diff checks passed. Asked for the business operating country to guide upcoming provider integration; independent work is not blocked on that answer.

### Internal ledger checkpoint, September 27

Implemented test-only balanced single-document accounting journals, business-source idempotency/conflict detection, immutable policy snapshots, append-only full accounting reversals, currency-separated exact trial balances, pure Stripe balance-transaction mapping and read-only comparison, and verified-admin diagnostics. No posting HTTP route, financial handler, real provider connection or payout is enabled. Targeted ledger suite passed 6/6 after its precision stress test exposed scientific notation in Decimal128 totals; fixed by exact BigInt expansion. Added admin privacy/authorization tests; integrated rerun follows. See ledger.md for limitations and remaining full financial scope. The business-country answer is still pending; independent work continues.

Integrated local rerun: 51/51 passed. Syntax and diff checks passed. Previous payment-event commit 019c56f passed GitHub run 36369033758, including backend and browser jobs. Ledger changes have local test evidence only until their new remote checks complete.

### Uploaded-content sandbox browser check

Added an actual hostile ZIP fixture (synthetic loopback targets only), generated by the browser-preview script and uploaded through creator UI in a new browser scenario. Local Chrome verified parent/cookie/storage/IndexedDB/top-navigation/worker rejection, blocked popup/network/resource attempts with zero requests received by a real local sink, preserved login, and denial of undeclared SDK capabilities. Corrected one test expectation: worker origin rejection precedes its CSP violation event. No runtime policy was weakened. Baseline agent-browser check and visual screenshots reviewed. See sandbox-browser.md for detailed evidence and exclusions, including the still-required launch-ticket/logout lifecycle review. Isolated browser scenario passed; full three-scenario rerun follows. Full remaining goal scope is unchanged.

Fresh integrated Chrome run passed 3/3 in 19.3 seconds without retries; script syntax and diff checks passed. Previous ledger commit 86dd10b passed GitHub run 36369535055. The manually started local preview was stopped after testing; no production environment was changed.

### Game access lifecycle, September 30

Added a real-auth two-device regression and reproduced a game URL remaining readable after logout (200 when 404 was required). Bound grants to their issuing session hash; capped expiry at session expiry; assets and shared SDK/realtime access now require that session to remain present, unexpired and associated with the same user/authVersion. Other devices remain valid. Legacy unbound grants fail closed. Updated controlled fixtures to include session records, not weaken the new checks. Full backend suite passed 52/52. Added UI sign-out/old-URL rejection to the hostile-upload browser scenario; full browser rerun follows. Existing delivered content/in-flight authorization cannot be recalled, and coordinated app/asset release is required. Full launch/financial/deployment/promotion scope remains active.

Integrated Chrome rerun passed 3/3 in 15.5 seconds, including actual UI logout and rejection of the old asset URL. Previous sandbox-browser commit d134b65 passed GitHub run 36370007728. This checkpoint has local evidence; its own remote verification remains pending until pushed.

### Creator review feedback and privacy, September 30

Session-binding commit fa00cd8 passed GitHub run 36812624104. Creator build reads and resubmission responses now explicitly select public-to-owner fields, excluding internal reviewer identifiers, moderation history and future internal fields. The original audit history remains in storage. Creator UI now renders review reason and date as text. Added a real-Mongo privacy regression and expanded the existing three-account browser publishing scenario with rejection, literal HTML-shaped feedback, resubmission, approval feedback, publishing and separate-player launch. Targeted project tests passed 6/6; integrated backend suite passed 53/53; expanded Chrome publishing scenario passed 1/1 in 9.3 seconds. Baseline agent-browser check had meaningful UI and no reported page errors; feedback screenshot inspected. Rollback is covered by backend tests only, not yet by the full browser lifecycle. Deployment, finance, promotion and all other outstanding full-goal work remain unfinished.

### Creator rollback browser lifecycle, September 30

Previous creator-feedback commit c13701b passed GitHub run 36812954581. Added short build identifiers, a distinct Restore this version action for older approved builds, and an explanation of new-launch versus already-running behavior. Generated a different second ZIP only in the disposable browser fixture; expanded actual creator/moderator/player workflow to publish it, restore the first build through the rollback endpoint, and verify delivered headings, continuing access/save on the already-running build, restored bytes on relaunch and three real player launch authorizations. Full browser suite passed 3/3 in 17.7 seconds; JavaScript syntax checked and screenshots inspected. No backend behavior changed in this checkpoint. Documented shared-save backward compatibility and that rollback is not security revocation. Production and the original remaining scope are still unfinished.

### Operator administrator assignment, September 30

Added preview-default operator CLI for granting admin to an exact existing UUID with verified email, adult age band and no suspension. Apply requires UUID confirmation; role, authorization-version revocation and internal audit append share one majority-acknowledged update with compare-and-set eligibility. No public route, startup promotion or email/password bypass was added. Tests against real disposable Mongo cover no-write preview, ineligible accounts, concurrent single audit, atomic storage failure and rejection of an old real session after elevation. Integrated backend suite passed 56/56 before adding a subprocess CLI regression; expanded targeted suite passed 4/4 including actual command preview/apply and sanitized invalid-URI errors. CLI help was checked. Production operator access is not configured; closed owner enrollment, admin MFA, demotion/recovery and individual operator attribution remain explicit gaps in admin-provisioning.md. Corrected outdated package-size wording in deployment notes. Full goal remains active.

### Private owner/tester enrollment, September 30

Prior admin-provisioning commit 702a6b7 passed GitHub run 36813641217. Added preview-first operator invitation issuance, 24-hour email-bound random codes stored only as hashes, replacement invalidation and atomic one-use consumption. Moved the production registration gate into the auth router so credentials/Origin limits and invitation checks apply together. Normal age/password validation, unverified player role, mail verification and separate operator admin grant remain mandatory. Browser form masks the code and clears it on switching to sign-in. Full backend run passed 59/59 before the final insertion-conflict recovery regression; expanded enrollment suite passed 3/3. All four browser scenarios passed in 18.0 seconds; enrollment form screenshot inspected, CLI help and syntax/diff checked. Production-mode API test covers invitation → account → captured-mail verification → admin grant → old-session rejection → new login → moderator endpoint while publicLaunch remains false. Browser evidence is limited to form behavior and regression workflows; no real invitation, real mail delivery or live deployment occurred. Remaining original scope, administrator MFA and provider setup are not complete.

### Account-form readability and narrow-screen verification, October 3

Resumed the existing live preview after an approval-service usage-limit interruption; no duplicate preview was started. Corrected native dark dialog colors, bounded vertical scrolling and narrow navigation, and added accessible dialog names. Two browser regressions verify measured text/helper contrast, 320-pixel reflow, keyboard reachability and focus return. Agent-browser baseline had meaningful controls and no reported errors; screenshots inspected. Six browser tests passed in 23.5 seconds, with syntax/diff checks passing. Prior enrollment commit a71391f passed GitHub run 36814167407. These are limited local accessibility checks, not full compliance or production evidence. The complete original build/launch objective remains active.
