import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Generate a tiny stored ZIP for the test fixture; production only reads and
// validates uploads. No source files are rewritten by this preview script.
function zip(files) {
  const parts = [], directory = []; let offset = 0;
  for (const [path, data] of files) {
    const name = Buffer.from(path); let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); local.copy(central, 6, 4, 30); central.writeUInt32LE(offset, 42);
    parts.push(local, name, data); directory.push(central, name); offset += local.length + name.length + data.length;
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, central, end]);
}
const files = [];
for (const path of ['index.html', 'game.css', 'game.js', 'orbit.json']) files.push([path, await readFile(new URL(`../examples/star-garden/${path}`, import.meta.url))]);
files.push(['orbit-sdk.js', await readFile(new URL('../public/orbit-sdk.js', import.meta.url))]);
const directory = new URL('../.data/', import.meta.url); await mkdir(directory, { recursive: true });
const destination = new URL('browser-starter.zip', directory); await writeFile(destination, zip(files));
process.env.PORT = '3040';
process.argv.push('--demo-package', resolve('.data/browser-starter.zip'));
await import('./preview.js');
