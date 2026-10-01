# Hostile uploaded-game browser regression

September 27, 2026. Local Chrome test, disposable real MongoDB, platform `127.0.0.1:3040`, assets `127.0.0.1:3041`, and a synthetic sink on `127.0.0.1:3042`. This is selected browser-boundary evidence, not a complete penetration test or a public-launch approval.

## Story and method

An authenticated creator creates a draft, selects a ZIP, uploads through the actual UI and previews the stored build. Production ZIP validation and Mongo asset serving are used. The ZIP includes `tests/fixtures/hostile-game/probe.js` as ordinary creator JavaScript; tests do not inject the adversarial operations through privileged browser evaluation. Its manifest declares no SDK capabilities. Nothing is approved or published, and the fixture never runs in production startup.

A real click triggers probes for parent DOM, cookies, local storage, IndexedDB, top navigation, popups, workers, fetch, beacon, image/script/frame loading, form submission and SDK identity/storage/multiplayer calls. Every attempted network destination is a local test listener or the local platform; markers are synthetic. No real private data or third-party service is involved. The listener records actual received HTTP requests independently of browser instrumentation.

## Verified outcome

- Parent DOM, cookie, localStorage, IndexedDB, top-navigation and worker probes returned `SecurityError`.
- Popup creation returned null. No popup page appeared.
- External fetch and attempted platform logout fetch rejected with `TypeError`. The signed-in session was then checked through the platform API and remained valid.
- Browser CSP violation events covered connect, image, script and nested-frame attempts. Worker creation was rejected earlier by the opaque-origin check, so it did not produce a worker-src violation event. An initial overly specific test assertion expected that later event; the assertion was corrected while keeping the required SecurityError check.
- No requests reached the sink, including the image/script/frame/form/beacon destinations. The beacon method returned true (queued), which was **not** treated as successful delivery; sink evidence and CSP enforcement determine the result.
- All three undeclared SDK calls returned the capability-denial message. The handshake message contained only its type field, not session cookies or launch-grant IDs.
- The top page URL remained unchanged. No uncaught page errors were recorded. Expected browser security/CSP console errors are not misreported as a blank or broken application.

The test attaches a JSON evidence record and a screenshot under ignored `test-results/`. GitHub's browser job retains this evidence with other browser results. Run `npm run test:browser -- tests/browser/sandbox.spec.js` for the isolated scenario or `npm run test:browser` for the suite. Use free ports and a fresh temporary test database for the full suite.

## What this does not prove

No claim is made about every browser/version, mobile browsers, iframe self-navigation, downloads, nested opaque-origin handshakes, user deception/phishing rendered inside a game, timing/side channels, all WebAssembly/graphics/audio APIs, device-permission prompts, resource-exhaustion attacks, dependency supply chain, DNS prefetch, newly discovered browser exploits or all possible network channels. No real browser sandbox should be described as making arbitrary hostile code risk-free. Current policy also limits game networking and workers, so compatibility with larger third-party engines requires deliberate research and testing rather than simply relaxing permissions.

Launch tickets are short-lived asset authorizations, not session cookies. A September 30 follow-up added real UI sign-out after the probes: the play area closes and a new request to the previously issued asset URL returns 404. A separate real-auth, two-device integration test verifies issuing-session binding, logout/rotation/expiry rejection, legacy unbound-grant rejection and preservation of the other device's access. The original regression failed with a 200 after logout before session binding was implemented. Existing asset tests separately check grant expiry, ownership, approval and account-authVersion changes. This does not erase previously delivered content or replace full threat modeling, browser coverage, moderation and operational safeguards.

References: [MDN iframe sandbox restrictions](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe), [MDN CSP sandbox](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox). The specific outcomes above come from Orbit's local browser test, not from assuming the documentation alone proves enforcement.
