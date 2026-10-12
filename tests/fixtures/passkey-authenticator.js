// Synthetic authenticator for server-protocol tests only. Real P-256 keys and
// signatures exercise the unmodified WebAuthn verifier; this is not device UX evidence.
import { generateKeyPairSync, randomBytes, createHash, sign } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
const digest = bytes => createHash('sha256').update(bytes).digest();
const base64 = bytes => Buffer.from(bytes).toString('base64url');
export function testAuthenticator() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' }), id = randomBytes(32);
  const cose = Buffer.from(isoCBOR.encode(new Map([[1, 2], [3, -7], [-1, 1],
    [-2, new Uint8Array(Buffer.from(jwk.x, 'base64url'))], [-3, new Uint8Array(Buffer.from(jwk.y, 'base64url'))]])));
  let counter = 0;
  const responseBase = { id: base64(id), rawId: base64(id), type: 'public-key', clientExtensionResults: {} };
  return {
    register(options, origin) {
      const client = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin, crossOrigin: false }));
      const size = Buffer.alloc(2); size.writeUInt16BE(id.length);
      const authData = Buffer.concat([digest(options.rp.id), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), size, id, cose]);
      const attestation = isoCBOR.encode(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', new Uint8Array(authData)]]));
      return { ...responseBase, response: { clientDataJSON: base64(client), attestationObject: base64(attestation), transports: ['internal'] } };
    },
    authenticate(options, origin, { verified = true, rpID = options.rpId, challenge = options.challenge } = {}) {
      const client = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false }));
      const count = Buffer.alloc(4); count.writeUInt32BE(++counter);
      const authData = Buffer.concat([digest(rpID), Buffer.from([verified ? 0x05 : 0x01]), count]);
      const signature = sign('sha256', Buffer.concat([authData, digest(client)]), privateKey);
      return { ...responseBase, response: { clientDataJSON: base64(client), authenticatorData: base64(authData), signature: base64(signature) } };
    },
  };
}
