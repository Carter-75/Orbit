# Star Garden

An original, editable browser-game starter for Orbit. No external assets or network services. Keyboard and touch-friendly movement, personal star score, saved progress, multiplayer position sharing, room-code joining and curated greetings demonstrate the platform SDK.

From the repository root on Windows:

```powershell
./scripts/package-example.ps1
```

The command prints a new ZIP path under `.data/packages/`. Upload that ZIP through your verified creator account. It contains the manifest, HTML, CSS, game script, and a copy of the current Orbit SDK. Editing source files requires building and uploading a new ZIP.

For a disposable local demo with separate platform and game servers:

```powershell
node scripts/preview.js --demo-package "<printed ZIP path>"
```

Open `http://127.0.0.1:3000`. The script creates only temporary local accounts: DemoCreator, DemoPlayer and DemoModerator, all using `Orbit local demo only!`. They do not exist in production. Stop the preview to discard its temporary database. Never reuse this password or seed these accounts into a real database.

Sign in as DemoCreator in one browser and DemoPlayer in a separate browser profile. Play Star Garden, create a room in the first window, then copy its code into the second window and join. Move and say hello. Save your score, close the game, and launch again to load it. Preview saves and public-play saves are intentionally separate.

This is a teaching example, not an authoritative competitive simulation. Scores and positions are controlled by clients and must never represent balances, entitlements or money. Blocking and age-band policies apply to multiplayer membership. See `docs/game-sdk.md` for limits and release status.
