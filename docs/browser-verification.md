# Local browser verification — September 21, 2026

Environment: explicit `scripts/preview.js --demo-package <ZIP>`; disposable real MongoDB; platform at loopback port 3000, separate game assets at 3001; no deployed services, production accounts, real email, payments, or promotion. The ZIP was built using `scripts/package-example.ps1` and validated by the production package validator before local demo seeding.

Tool: agent-browser 0.27.0, separate default and orbit-player sessions. Native click attempts did not consistently activate offscreen controls; focused keyboard Enter activation did. One parent launch was exercised by DOM click while diagnosing that tooling behavior, then a second launch succeeded through keyboard UI. This is not evidence that pointer interaction is fully verified.

Verified:

- Desktop home renders its intended cream/forest/lime design and a clearly labeled local demo listing, not fake public activity.
- DemoCreator and DemoPlayer each sign in through the actual UI using separate browser sessions.
- Starter iframe loads from the separate asset origin; its SDK gets the correct signed-in public username and reads its own save.
- Creator collects a star with the movement controls; save reports success. Close/relaunch reads Stars collected: 1 from MongoDB. The second account independently starts at zero.
- Creator creates a room; the second player joins using its code. Both game snapshots list both usernames and show 2 players.
- DemoPlayer sends the curated Hello! phrase; DemoCreator displays DemoPlayer: Hello!.
- Attempt to read the iframe document from the parent throws SecurityError, confirming browser cross-origin enforcement. This alone is not a comprehensive sandbox-escape audit.
- Both browser page-error lists were empty after the tested flows.
- Phone-sized 390x844 platform viewport reports no document width exceeding window width. Visual inspection also identified a low-contrast close button; explicit dark text/background styling was added. Further full mobile interaction/accessibility testing remains.
- Script syntax checks passed for preview, demo seed, starter game and public app.
- Integrated backend suite passed 28/28 in the preceding SDK checkpoint, including actual WebSocket synchronization and storage authorization tests.

Still required: repeatable automated browser regression suite; pointer/touch flow verification; fresh independent creator upload/review/publish through UI; browser-level hostile package tests (cookies, parent access, requests/navigation/popups); mobile game movement; moderation/profile/admin workflows; startup/restart persistence in deployment; capacity testing; all financial and launch requirements. Do not describe this checkpoint as production-ready.

Screenshots reviewed during this session reside under the local browser tool's temporary screenshots directory. These are local inspection evidence, not public promotional assets.

## Moderation follow-up

New disposable preview on loopback 3010/3011. Separate DemoPlayer and DemoModerator browser sessions completed: game Report button → populated target → case submission and reference → moderator open-case queue → internal reason plus distinct public reply → resolve → reporter page reload showing resolved status and public reply. Reporter DOM inspection for the internal-only note returned false. Page-error checks showed no errors in the tested sessions. Backend tests independently verify private field exclusion, ownership and concurrent decision conflicts. Creator build review UI and suspension confirmation were implemented but not exercised in this browser flow.

## Profile, library and analytics — September 24

Disposable preview on loopback 3020/3021. DemoCreator changed the avatar from teal to rose and saved a short bio. After reload, the radio selection and bio were retained. Saved Star Garden through the library control; reload displayed Remove from saved. Switched to saved games, removed the item, and observed the empty-library message. Manage builds → View launch activity displayed the real zero count in this fresh demo, with explicit authorization-not-play wording and expandable UTC daily counts. No fabricated nonzero activity was seeded. Page-error list was empty. Screenshot inspection confirmed labeled radio choices, bio and visible focus state; it also identified a social-button contrast issue, corrected by inheriting page text color for otherwise unstyled buttons. The zero-count UI check does not replace the backend tests for nonzero increments or exclusions. Two-account friend/profile display and mobile profile editing still need browser coverage.
