# Orbit browser-game SDK (implementation preview)

Orbit imports browser games, not arbitrary native executables or Roblox place files. Export a self-contained HTML game, include `public/orbit-sdk.js` in its ZIP, and declare capabilities in `orbit.json`. No external network services are available from the sandbox. Uploads require review before public publication.

```json
{"version":1,"title":"My game","entry":"index.html","capabilities":["identity","storage","multiplayer"],"maxPlayers":8}
```

Check the package validator for the current manifest contract before packaging. Include `<script src="orbit-sdk.js"></script>` before your game code. The SDK connects only when launched within Orbit.

```js
const player = await Orbit.identity.get();
const saved = await Orbit.storage.get(); // null for a new player
await Orbit.storage.set({ level: 2 });
const unsubscribe = Orbit.multiplayer.on(event => {
  if (event.type === 'room') renderPlayers(event.players);
  if (event.type === 'error') showError(event.error);
});
await Orbit.multiplayer.join(); // creates a room; room event contains roomId
// Another player launches the same build, then calls join(roomId).
await Orbit.multiplayer.state({ x: 10, y: 20 });
await Orbit.multiplayer.chat(0); // curated Hello! phrase
await Orbit.multiplayer.leave();
unsubscribe();
```

Join resolves when the request is sent, not when membership succeeds; inspect room/error events. Rooms are ephemeral, single-server, capped at eight players (or a lower manifest limit). Players need verified accounts, matching age bands, and no block relationship. Restart ends rooms. Reconnect explicitly with a room ID if the room still exists. Public matchmaking and friend invitation UI are separate unfinished work.

State payloads are at most 2 KB and are untrusted. Validate every incoming field before use; do not render state as HTML. This transport does not provide authoritative physics, anti-cheat, currency, purchases, or safe free-text communication. Do not implement chat through arbitrary state; game moderation must review communication surfaces. Curated phrases: Hello!, Great game!, Follow me!, Ready?, Thanks!, Goodbye!.

Saves are JSON up to 8 KB per player/game, shared across published versions. Preview saves are separate per build. Do not use client-controlled saves as authoritative balances or entitlements. Save at checkpoints, not each animation frame. API rate limits apply.

The trusted host checks frame identity, transfers a private MessagePort, gates declared capabilities, and owns authenticated network requests. Games receive public player identity only, never cookies, account email, date of birth, launch grants, or database credentials. Ads and subscriptions are not yet available; manifest declaration alone does not activate them.

Local backend tests cover storage authorization/isolation and real WebSocket room behavior. The editable Star Garden starter is in `examples/star-garden/`; its README includes packaging and local two-account instructions. Local browser checks on September 21 verified identity, save/relaunch persistence, two isolated accounts in one room, curated greeting delivery, and cross-origin DOM access rejection. This is not production or exhaustive security evidence; see `docs/browser-verification.md` for limits.
