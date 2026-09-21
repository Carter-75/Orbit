# Orbit

An original creator-first multiplayer-world platform prototype, inspired by the broad category of user-generated social gaming platforms. It does not use Roblox branding, assets, code, or content.

## What works now

- Responsive Discover screen with worlds, player stats, play actions, and online friends.
- Creator-hub entry point and original Orbit visual identity.
- Working shared-room loop: create or enter a room, move with WASD/arrow keys, see other open browser tabs move in real time, and chat.

## Run it

Use a terminal in this folder and run `node server.mjs`, then open `http://localhost:3000`. Open the copied invite link in another browser tab to test multiplayer.

## What turns this into a real platform

This prototype is the product shell. A real public platform requires a backend and operating plan:

1. Identity and safety: sign-in, verified age/guardian controls where needed, block/report tools, audit logs, content review, and trust & safety operations.
2. Creator publishing: projects, asset uploads to object storage, versioning, review, discovery/search, and creator analytics.
3. Multiplayer: an authoritative game-server runtime, websocket/realtime presence, session matchmaking, anti-cheat, scalable hosting, and crash monitoring.
4. Social: database-backed profiles, friendships, invites, messaging with moderation, and privacy settings.
5. Economy (later): a compliant payment provider, payouts, tax checks, fraud controls, and clear creator terms.

## Recommended first real vertical slice

Build a **2D shared-room creator kit** next: creators choose a room template and assets; publish a room; up to 8 signed-in people can join, move an avatar, chat safely, and invite friends. This build implements the shared-room, movement, chat, and invite part using a lightweight in-memory server. It resets when the server restarts and is meant for local prototyping, not public production use.

## Hosting note

ChatGPT Sites can host and share an app, but it is not by itself the infrastructure for persistent user accounts, user uploads, realtime multiplayer servers, or payments. Use it for the frontend/prototype; pair it with a proper backend and realtime/game-server host for the platform features above.
