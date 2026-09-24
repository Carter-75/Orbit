# Online-status privacy

Online-status sharing is off by default for every account. A verified player explicitly enables it in Friends. While that Orbit page is visible, it checks status every 30 seconds and renews its online expiry when sharing is enabled. The server expires online state after 90 seconds without a heartbeat. There is no public status endpoint, exact last-seen value, status history, game name, room code, location or device disclosure.

Readers must be authenticated and verified. Only accepted, unblocked friends who are currently in the same age band can appear online. Suspended/unverified targets are excluded. A teen target's age transition is evaluated even if they have not logged in since turning 18. Heartbeats are bound to the current account authorization version, so reset/revocation hides stale status. Logout removes the expiry immediately; another still-authenticated device can renew it if sharing remains enabled. Turning sharing off removes the expiry and prevents any other tab from renewing it until sharing is explicitly re-enabled.

The UI says “Status not shared or offline” to avoid exposing which private setting another player chose. Blocking removes the friend row on refresh and prevents subsequent presence reads. An already rendered status can remain in another client's memory until its next refresh; this is not an instantaneous remote erasure guarantee.

This is application-page presence, not robust background/mobile presence or a room invitation system. Friend invites and room invitations remain distinct: accepted friend requests exist, but invitation-to-game UI and server-validated invitation lifecycle are unfinished. Single-instance API rate limits currently bound polling; shared limits and multi-instance operation remain release work.

Local tests cover default-off, explicit opt-in, non-friend exclusion, age transition, expiry, block, opt-out, authorization-version revocation, Origin/field validation, and logout clearing. Browser verification of the presence controls remains required before release.
