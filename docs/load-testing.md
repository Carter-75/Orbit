# Local multiplayer load baseline

Run `npm run test:load:local` for 24 simulated players, 10 seconds and a target of five state messages per second per player. Override with `-- --players 64 --seconds 20 --hz 5`. Inputs are bounded to 2–128 players, 2–60 seconds and 1–10 Hz. The command accepts no remote target and creates its own disposable database; it never reads an operator database URI or loads a deployed site.

The harness runs the real WebSocket transport and real database-backed session resolver. It seeds synthetic verified adult accounts, hashed sessions and version-bound grants, then joins rooms of up to eight players. Account login/password hashing, HTTP launch endpoints and assets are outside this workload. Joins are ramped sequentially, not a connection-storm test. Each round waits for the sender's own state in a room broadcast; the final check additionally requires every member to see every peer's last sequence. Unexpected closure/error, missing acknowledgement or room leak fails the process.

## Measured October 12, 2026

Windows, Node 22.22.3, local MongoMemoryServer, client generator and application transport in the same Node process. Two separate runs, not concurrent. Results before adding the explicit target-rate boolean to report formatting:

| Measurement | 24 players / 3 rooms | 64 players / 8 rooms |
|---|---:|---:|
| Measured interval | 10.20 s | 20.14 s |
| Requested per-player rate | 5 Hz | 5 Hz |
| Observed per-player rate | 4.90 Hz | 4.12 Hz |
| State messages / acknowledgements | 1,200 / 1,200 | 5,312 / 5,312 |
| Received room snapshots | 9,600 | 42,496 |
| Round-trip p50 | 99.64 ms | 218.80 ms |
| Round-trip p95 | 133.32 ms | 300.56 ms |
| Round-trip p99 | 145.85 ms | 338.44 ms |
| Maximum round trip | 153.39 ms | 362.51 ms |
| Event-loop delay p95 | 24.82 ms | 49.45 ms |
| Combined Node RSS start / end | 111.16 / 117.80 MiB | 112.75 / 182.29 MiB |
| Errors / remaining rooms | 0 / 0 | 0 / 0 |

Both runs synchronized final peer state and cleaned up all rooms. **The 64-player run did not sustain its requested five-Hz rate.** This closed-loop generator backs off while awaiting responses, so zero errors is not proof of meeting the offered workload. The report exposes observed rate and whether it is within five percent of the requested rate; this is a load-shape check, not a production SLO. The 24-player run met that tolerance and the 64-player run did not. No production admission limit is derived from these numbers.

## Limits and next work

The generator shares the application event loop and memory; Mongo memory is excluded. Timing omits internet latency, TLS, Render proxies, Atlas placement and database size. Payloads are small; no slow clients, uploads, HTTP/asset mix, reconnect storms or competing admin work are present. Data is synthetic and modest. Ten/twenty-second runs cannot prove long-term stability or memory leak absence. Heartbeat work overlaps the longer run, but these are not thorough expiry/revocation load experiments.

Next, profile per-message database checks and broadcast cost without weakening authorization. Move the generator to a separate process/host, add fixed-rate bounded scheduling with backlog accounting, representative payload sizes, HTTP/assets and a longer soak. After approved deployment, repeat against isolated staging with provider resource metrics and realistic network/Atlas latency. Establish an explicit acceptable latency/rate/error budget before selecting public admission limits. Do not increase the currently single-instance deployment or promise supported concurrency based on this baseline.

The smoke tests execute the actual harness with two players, assert complete acknowledgements/synchronization/cleanup, and reject external targets and out-of-range workloads. They intentionally do not impose machine-dependent latency thresholds.

Timing implementation follows Node's [performance measurement APIs](https://nodejs.org/download/release/v22.22.3/docs/api/perf_hooks.html); event-loop histogram nanoseconds are converted to milliseconds.
