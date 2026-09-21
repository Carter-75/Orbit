# Product, publishing, and security research

Research date: 20 September 2026. This is an audit and design recommendation, not a statement that the implementation meets these requirements. Local audit covers the original seven-file prototype read before the rebuild.

## Findings from primary sources

Roblox separates saving a creation from making it public: new games start private and publishing visibility has account and content requirements. Orbit should similarly separate draft, validated build, private preview, pending review, published, and suspended states. Updates must retain an immutable version history rather than replacing the only playable build. Source: [Roblox publishing](https://create.roblox.com/docs/production/publishing/publish-games-and-places).

itch.io provides a useful browser-native import precedent: HTML/CSS/JavaScript in a ZIP with an index.html entry point, embedded in an iframe. Relative asset paths, case-sensitive filenames, responsive sizing, and click-to-play are important. Orbit can support this ecosystem without inventing another 3D engine. It must publish a tested compatibility matrix rather than claim every export works. Source: [itch.io HTML5 publishing](https://itch.io/docs/creators/html5).

CrazyGames' friend integration requires games to report room identity and whether the room can be joined. Invitations carry join parameters; round transitions should keep the group together. This is a strong contract for Orbit's SDK: games implement real multiplayer and report joinable sessions, while the platform provides discovery, invitations, and identity. Merely loading two copies of an imported game does not synchronize its world. Source: [CrazyGames multiplayer requirements](https://docs.crazygames.com/requirements/multiplayer/).

## Visual and video references; inspection limits

The following are research references, not assets licensed for reuse in Orbit branding or advertisements.

- [Official CrazyGames invitation screenshot](https://docs.crazygames.com/img/requirements/multiplayer/invite-link.png), found through image search on the official multiplayer documentation. Search-provided image description shows a game-centered view, an invite sidebar, copy-link action, and friend availability. Direct image fetch returned a cache miss. The full-resolution pixels were **not directly inspected**; this observation is based on the search description and surrounding official documentation.
- [Roblox Creator Hub navigation announcement](https://devforum.roblox.com/t/a-clearer-way-to-navigate-creator-hub/2672229) and its [interface image](https://devforum-uploads.s3.dualstack.us-east-2.amazonaws.com/uploads/optimized/5X/b/4/d/2/b4d256eafcd8e88d6c563dcac5310ef69ee28ef5_2_1380x696.jpeg). Image reference retrieved through search; direct image fetch failed. Do not represent this as a current pixel-level screenshot review.
- [Roblox Studio interface documentation](https://create.roblox.com/docs/studio/ui-overview) and [3D art overview](https://create.roblox.com/docs/art/overview-studio) were read as text. They distinguish workspace, hierarchy, properties, assets, and output. These are creator-tool concepts, not reasons to put a dense desktop editor in the player interface.
- [Official Roblox Creator Showdown announcement, April 24, 2026](https://about.roblox.com/newsroom/2026/04/creator-showdown-tournament-vegas) describes competitive and cooperative games including Rivals, Chained, Racket Rivals, and Knockout, and links to [Roblox's official video channel](https://www.youtube.com/Roblox). Announcement text and video destination were inspected; **no footage was played or frames inspected**. Treat as a reference for a future visual review, not evidence of watched gameplay.

The practical design inference is a game-first player interface with one clear Play action, optional invite panel, and a distinct Creator workspace. Reuse familiar interaction patterns, not Roblox names, logos, avatars, or copyrighted footage.

## Recommended release scope and user journeys

These are recommended acceptance targets, not verified features.

1. Player: browse without signing in, inspect controls/device support, sign in to use social or persistent features, launch a game, invite a friend, recover from disconnection, report or block a user, and leave without losing navigation context.
2. Creator: create a project, download a starter, upload a ZIP, see actionable validation errors, privately preview it, submit for review, publish, upload a second version, and roll back. The owner must be a separate test account from the platform operator.
3. Moderator: inspect report context and a quarantined preview, approve/reject builds, suspend content, record a reason, and retain an audit trail. Suspension must prevent new launches and revoke affected permissions.
4. Monetization: report provider state truthfully, separate gross revenue/fees/refunds/platform share/creator balance, and never display invented earnings or imply that a SDK ad request guarantees an impression or payment.

Initial package contract: browser HTML/CSS/JavaScript, an entrypoint and manifest, local static assets, and explicitly declared SDK capabilities. Test vanilla Canvas first. Add engine exports only after verifying them: WebAssembly MIME, cross-origin resource loading, compression headers, fullscreen, pointer lock, audio activation, and mobile performance can differ. Native executables and .rbxl files are not browser bundles. Threaded WebAssembly and creator-operated servers require separate capability design and should not be advertised until verified.

Arbitrary uploaded server code must never run in the API process. A first release may provide platform-managed rooms and bounded messaging, while explicitly stating that authoritative custom game simulation requires a future isolated compute service or an approved creator backend. This limitation is material and must remain visible in the compatibility documentation.

## Security architecture

- Serve trusted app assets from an explicit public directory. Run uploaded games from a separate origin with no platform cookies, credentials, source tree, or admin endpoints. Prefer an independently registrable domain for production rather than relying solely on sibling subdomains.
- Use a sandboxed iframe with the minimum permissions. Never combine scripts and same-origin privileges for attacker content sharing the parent origin. Consider response-level CSP sandboxing so directly opening the game URL does not evade iframe restrictions. An opaque-origin iframe affects module imports, fetch, WebAssembly, and SDK origin checks; test the chosen policy against actual supported games. Source: [MDN iframe](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe).
- Bridge SDK calls through a bounded protocol. Check event.source against the expected frame; check exact origin when non-opaque; bind an unpredictable per-launch channel nonce; validate every operation; do not treat the nonce as permission. Authorize identity, storage, rooms, and entitlements on the server. For opaque frames, origin "null" alone is not identification. Do not forward raw session credentials to game code.
- ZIP intake needs authenticated ownership, upload quotas, compressed and actual expanded-byte limits, entry-count and per-entry limits, and bounded decompression. Reject absolute paths, traversal, backslashes/drive prefixes, colon/NTFS streams, links, duplicate normalized paths, and unsupported/encrypted entries. Validate before writing to an isolated quarantine location; never extract over application files. Do not trust MIME declarations or archive-reported sizes. Sources: [OWASP file upload](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html), [OWASP input validation](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html).
- Use a maintained WebSocket implementation, TLS, exact browser-origin allowlists, authenticated sessions, message-level permissions, bounded messages/rooms/connections, throttling, heartbeat cleanup, and backpressure handling. Invalidate connections on logout/suspension and enforce room join rules at the server. Never accept client messages as authoritative purchases, payouts, or competitive scores. Source: [OWASP WebSocket security](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html).
- Account sessions should use secure HttpOnly cookies, appropriate SameSite policy, CSRF protection for state changes, password hashing, login throttles, recovery-token expiry and single use, and non-enumerating account responses. Source: [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

## Concrete original-code audit

| Location | Observed defect | Consequence / repair |
| --- | --- | --- |
| server.mjs HTTP handler | Static file root is process.cwd(); arbitrary existing files are served | Source and future secrets/config files become downloadable. Restrict to public asset directory and explicit routes. |
| server.mjs HTTP handler | URL decoding occurs outside error handling | Malformed encoded paths can reject the async callback unexpectedly. Return a controlled 400 response. |
| server.mjs upgrade data handler | Assumes every TCP chunk is one complete WebSocket frame; unchecked readUInt16BE | Valid fragmentation or short attacker input can fail; concatenated frames are lost. Replace custom framing. |
| server.mjs message(join) | Repeated joins create new players without removing old membership | Ghost players and resource growth. Enforce one membership or perform an atomic leave/join. |
| server.mjs message(move/chat) | No authentication, rate limit, room cap, authorization, or origin validation | Anyone can join known rooms, spoof identity, and flood traffic. Use authenticated bounded protocol. |
| server.mjs rooms Map | All state is in memory | Restart loses sessions; independent replicas disagree. Persist durable entities; document single realtime instance until coordinated state exists. |
| app.js worlds/friends constants | Invented visit/player totals and online friends | Misrepresents a live product. Seed only actual playable examples and derive counts from data. |
| app.js keydown listener | Captures WASD while chat input is focused | Typing chat triggers movement and loses letters. Ignore editable elements; clear keys on blur. |
| app.js tick | Movement uses fixed distance per animation frame | Refresh rate changes movement speed. Use elapsed time, bounded server validation, and tested interpolation. |
| app.js new-world and friend/project actions | Room-name prompt; remaining actions show placeholder toasts | Does not create/upload/publish a third-party game, an account, or a friendship. Implement real state transitions. |
| app.js controls/reconnect | Keyboard-only motion; connection failure asks user to rejoin | Mobile gameplay lacks controls and network recovery. Add touch controls and explicit reconnect state. |

These findings come from source inspection, not exploitation or a running production audit. No app files were modified as part of this research.

## Accessible, clear interface acceptance targets

Use WCAG 2.2 AA as the platform target: visible unobscured keyboard focus, labelled form fields, error association, contrast verification, reduced motion, and keyboard-complete navigation. W3C's minimum pointer target criterion is 24 by 24 CSS pixels with specified exceptions; choose approximately 44-pixel controls in the platform for comfortable touch use. Sources: [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [W3C target size explanation](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

Prefer 3–4 primary destinations: Discover, Friends, Create, Account. Show device compatibility, multiplayer capacity, content rating, creator, and controls before play. Keep game controls separate from page shortcuts. Use explicit labels for save, preview, submit, and publish; do not hide distinct irreversible state changes behind one ambiguous button. Announce async status without repeatedly flooding screen readers. Show real empty states with a next action. A platform cannot guarantee accessibility inside arbitrary creator games; require creators to declare controls and test examples, and provide reporting for inaccessible content.

Release evidence should include two-user invite/join/block checks, upload of a second independently owned project, invalid archive fixtures, authorization boundary tests, safe iframe escape attempts, room flood limits, disconnect/restart behavior, keyboard-only navigation, a mobile viewport, and measured launch capacity. A local pass is not equivalent to public launch approval or a complete independent security review.
