import yauzl from 'yauzl';
import { z } from 'zod';
import { extname } from 'node:path';

export const PACKAGE_LIMITS = Object.freeze({ compressed: 10 * 1024 ** 2, expanded: 30 * 1024 ** 2, entry: 5 * 1024 ** 2, count: 256 });
const mimeTypes = Object.freeze({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.woff': 'font/woff', '.woff2': 'font/woff2', '.wasm': 'application/wasm' });
const manifestSchema = z.object({
  version: z.literal(1), title: z.string().trim().min(1).max(80), entry: z.string().default('index.html'),
  capabilities: z.array(z.enum(['identity', 'storage', 'multiplayer', 'ads', 'subscriptions'])).max(5).default([]),
  maxPlayers: z.number().int().min(1).max(8).default(1),
}).strict();

export class PackageValidationError extends Error {
  constructor(message) { super(message); this.name = 'PackageValidationError'; this.status = 400; this.statusCode = 400; }
}
function invalid(message) { throw new PackageValidationError(message); }
function validPath(path, directory = false) {
  if (typeof path !== 'string' || !path || path.length > 240 || /[\\:%?#\u0000-\u001f\u007f]/u.test(path) || path.startsWith('/')) invalid('Unsafe file path in package.');
  const clean = directory && path.endsWith('/') ? path.slice(0, -1) : path;
  if (clean.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part))) invalid('Unsafe file path in package.');
  return clean.normalize('NFC').toLowerCase();
}
// Check actual content as well as directory metadata; ZIP CRC is integrity, not malware detection.
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let i = 0; i < 8; i++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function updateCrc(crc, chunk) { for (const byte of chunk) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return crc; }

/** Validate a browser ZIP entirely in memory. Returned content is untrusted and MUST be served on the isolated game origin. */
export async function validatePackage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) invalid('Upload a valid ZIP browser game.');
  if (buffer.length > PACKAGE_LIMITS.compressed) invalid('ZIP exceeds the 10 MB upload limit.');
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (openError, zip) => {
      if (openError) return reject(new PackageValidationError('Invalid ZIP archive.'));
      let settled = false, activeStream, expanded = 0, declared = 0, count = 0;
      const files = [], names = new Map();
      function fail(error) {
        if (settled) return;
        settled = true;
        activeStream?.destroy();
        zip.close();
        reject(error instanceof PackageValidationError ? error : new PackageValidationError('Invalid or damaged ZIP entry.'));
      }
      zip.on('error', fail);
      if (zip.entryCount > PACKAGE_LIMITS.count) return fail(new PackageValidationError('Package exceeds 256 entries.'));
      zip.on('entry', entry => {
        if (settled) return;
        try {
          if (++count > PACKAGE_LIMITS.count) invalid('Package exceeds 256 entries.');
          if (entry.generalPurposeBitFlag & 0x41) invalid('Encrypted ZIP entries are unsupported.');
          if (![0, 8].includes(entry.compressionMethod)) invalid('Unsupported ZIP compression.');
          const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
          if (mode && mode !== 0x8000 && mode !== 0x4000) invalid('Links and special files are unsupported.');
          const directory = entry.fileName.endsWith('/');
          if (mode === 0x4000 && !directory) invalid('Invalid directory entry.');
          const canonical = validPath(entry.fileName, directory);
          if (names.has(canonical)) invalid('Duplicate file paths, including case variants, are unsupported.');
          names.set(canonical, directory);
          if (entry.uncompressedSize > PACKAGE_LIMITS.entry) invalid('A file exceeds the 5 MB limit.');
          declared += entry.uncompressedSize;
          if (declared > PACKAGE_LIMITS.expanded) invalid('Expanded package exceeds 30 MB.');
          if (directory) {
            if (entry.uncompressedSize !== 0) invalid('Directory entries must be empty.');
            zip.readEntry(); return;
          }
          const mime = mimeTypes[extname(entry.fileName).toLowerCase()];
          if (!mime) invalid('Unsupported file extension. Upload browser assets only.');
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError) return fail(streamError);
            if (settled) { stream.destroy(); return; }
            activeStream = stream;
            const chunks = []; let size = 0, crc = 0xffffffff;
            stream.on('error', fail);
            stream.on('data', chunk => {
              if (settled) return;
              size += chunk.length; expanded += chunk.length;
              if (size > PACKAGE_LIMITS.entry || expanded > PACKAGE_LIMITS.expanded || size > entry.uncompressedSize) return fail(new PackageValidationError('Expanded content exceeds declared size or package limits.'));
              crc = updateCrc(crc, chunk); chunks.push(chunk);
            });
            stream.on('end', () => {
              if (settled) return;
              if (size !== entry.uncompressedSize || ((crc ^ 0xffffffff) >>> 0) !== entry.crc32) return fail(new PackageValidationError('ZIP entry integrity check failed.'));
              files.push({ path: entry.fileName, content: Buffer.concat(chunks, size), mime });
              activeStream = undefined; zip.readEntry();
            });
          });
        } catch (error) { fail(error); }
      });
      zip.on('end', () => {
        if (settled) return;
        try {
          for (const name of names.keys()) {
            const pieces = name.split('/');
            for (let n = 1; n < pieces.length; n++) if (names.get(pieces.slice(0, n).join('/')) === false) invalid('A file cannot also be a directory.');
          }
          const manifestFile = files.find(file => file.path === 'orbit.json');
          if (!manifestFile) invalid('Package needs orbit.json at the ZIP root.');
          if (manifestFile.content.length > 16 * 1024) invalid('orbit.json exceeds 16 KB.');
          let input;
          try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestFile.content)); } catch { invalid('orbit.json must contain valid UTF-8 JSON.'); }
          const result = manifestSchema.safeParse(input);
          if (!result.success) invalid('Invalid orbit.json: use version 1, title, entry, supported capabilities, and maxPlayers 1–8.');
          const manifest = result.data;
          validPath(manifest.entry);
          if (new Set(manifest.capabilities).size !== manifest.capabilities.length) invalid('Manifest capabilities must be unique.');
          if (extname(manifest.entry).toLowerCase() !== '.html' || !files.some(file => file.path === manifest.entry)) invalid('Manifest entry must name an included HTML file with exact case.');
          settled = true; resolve({ manifest, files });
        } catch (error) { fail(error); }
      });
      zip.readEntry();
    });
  });
}
