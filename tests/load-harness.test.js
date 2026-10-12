import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
test('local load harness uses real sessions, reports complete acknowledgements and cleans rooms', { timeout: 60000 }, async () => {
  const result = await run(process.execPath, ['scripts/load-realtime.js', '--players', '2', '--seconds', '2', '--hz', '2'], { timeout: 50000 });
  const report = JSON.parse(result.stdout);
  assert.equal(report.scope, 'local-loopback-disposable-MongoDB');
  assert.equal(report.players, 2); assert.equal(report.rooms, 1); assert.equal(report.errors, 0);
  assert.ok(report.stateMessages > 0); assert.equal(report.stateMessages, report.acknowledgements);
  assert.equal(report.finalPeerStatesSynchronized, true); assert.equal(report.roomsAfterDisconnect, 0);
  assert.ok(report.roundTripMs.p95 >= 0); assert.ok(report.observedHzPerPlayer > 0);
  assert.equal(typeof report.targetRateWithinFivePercent, 'boolean');
});
test('load harness rejects external targets and unbounded workloads', async () => {
  for (const args of [['--target', 'https://example.test'], ['--players', '1000'], ['--seconds', '0'], ['--hz', '31']]) {
    await assert.rejects(run(process.execPath, ['scripts/load-realtime.js', ...args], { timeout: 10000 }));
  }
});
