import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { validatePackage, PACKAGE_LIMITS, PackageValidationError } from '../src/packages.js';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let n = 0; n < 8; n++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
// Small independent ZIP fixture writer; supports intentionally hostile metadata.
function zip(entries) {
  const locals = [], central = []; let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.path), data = Buffer.from(e.content ?? ''), compressed = e.deflate ? deflateRawSync(data) : data;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(e.flags ?? 0x800, 6); local.writeUInt16LE(e.deflate ? 8 : 0, 8);
    local.writeUInt32LE(e.crc ?? crc32(data), 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(e.declared ?? data.length, 22); local.writeUInt16LE(name.length, 26);
    const header = Buffer.alloc(46); header.writeUInt32LE(0x02014b50); header.writeUInt16LE(0x0314, 4); local.copy(header, 6, 4, 30); header.writeUInt32LE(((e.mode ?? 0x81a4) * 65536) >>> 0, 38); header.writeUInt32LE(offset, 42);
    locals.push(local, name, compressed); central.push(header, name); offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
const manifest = overrides => ({ path: 'orbit.json', content: JSON.stringify({ version: 1, title: 'Test game', ...overrides }) });
const html = { path: 'index.html', content: '<!doctype html><title>Game</title>' };
const rejects = entries => assert.rejects(validatePackage(zip(entries)), PackageValidationError);

test('accepts browser game, defaults manifest fields and preserves binary assets', async () => {
  const result = await validatePackage(zip([manifest(), html, { path: 'assets/', mode: 0x41ed }, { path: 'assets/game.wasm', content: Buffer.from([0, 97, 115, 109]), deflate: true }]));
  assert.deepEqual(result.manifest, { version: 1, title: 'Test game', entry: 'index.html', capabilities: [], maxPlayers: 1 });
  assert.equal(result.files.length, 3); assert.equal(result.files[2].mime, 'application/wasm');
  assert.deepEqual(result.files[2].content, Buffer.from([0, 97, 115, 109]));
});
test('requires valid manifest, actual HTML entry, known fields and unique supported capabilities', async () => {
  for (const entries of [[html], [manifest(), { path: 'Index.html', content: '' }], [{ path: 'orbit.json', content: '{' }, html], [manifest({ version: 2 }), html], [manifest({ maxPlayers: 9 }), html], [manifest({ server: 'server.js' }), html], [manifest({ capabilities: ['identity', 'identity'] }), html], [manifest({ capabilities: ['shell'] }), html], [manifest({ entry: 'orbit.json' }), html]]) await rejects(entries);
});
test('rejects unsafe paths, case collisions, links, encrypted and native content', async () => {
  for (const path of ['../evil.js', '/evil.js', 'C:/evil.js', 'a\\evil.js', 'x:evil.js', 'a/./evil.js', 'a//evil.js', '%2e%2e/evil.js', 'x\u0000.js', 'a./evil.js']) await rejects([manifest(), html, { path }]);
  await rejects([manifest(), html, { path: 'INDEX.html' }]);
  await rejects([manifest(), html, { path: 'link.js', mode: 0xa1ff, content: 'index.html' }]);
  await rejects([manifest(), { ...html, flags: 0x801 }]);
  await rejects([manifest(), html, { path: 'server.exe' }]);
  await rejects([manifest(), html, { path: 'data.js' }, { path: 'data.js/child.html' }]);
});
test('rejects malformed, oversized and excessive-entry archives', async () => {
  await assert.rejects(validatePackage(Buffer.from('not a zip')), PackageValidationError);
  await assert.rejects(validatePackage(Buffer.alloc(PACKAGE_LIMITS.compressed + 1)), PackageValidationError);
  await rejects([manifest(), html, ...Array.from({ length: 255 }, (_, n) => ({ path: `f${n}.js` }))]);
  await rejects([manifest(), html, { path: 'big.js', content: Buffer.alloc(PACKAGE_LIMITS.entry + 1), deflate: true }]);
  await rejects([manifest(), html, ...Array.from({ length: 7 }, (_, n) => ({ path: `${n}.js`, content: Buffer.alloc(PACKAGE_LIMITS.entry), deflate: true }))]);
});
test('checks expanded real size and CRC rather than trusting archive metadata', async () => {
  await rejects([manifest(), html, { path: 'bad.js', content: Buffer.alloc(500000), deflate: true, declared: 1 }]);
  await rejects([manifest(), { ...html, crc: 0 }]);
  await rejects([manifest(), html, { path: 'bad/', mode: 0x41ed, content: 'hidden' }]);
});
