import { randomBytes, scrypt, timingSafeEqual } from 'crypto';

const PREFIX = 'cmem_ak_';
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;

export function generateApiKey(): string {
  const random = randomBytes(32).toString('hex');
  return `${PREFIX}${random}`;
}

export async function hashApiKey(key: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH).toString('hex');
  return new Promise((resolve, reject) => {
    scrypt(key, salt, KEY_LENGTH, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

export async function verifyApiKey(key: string, storedHash: string): Promise<boolean> {
  const [salt, hashHex] = storedHash.split(':');
  if (!salt || !hashHex) return false;
  return new Promise((resolve, reject) => {
    scrypt(key, salt, KEY_LENGTH, (err, derivedKey) => {
      if (err) { reject(err); return; }
      const derivedHex = derivedKey.toString('hex');
      const hashBuf = Buffer.from(hashHex, 'hex');
      const derivedBuf = Buffer.from(derivedHex, 'hex');
      if (hashBuf.length !== derivedBuf.length) {
        resolve(false);
        return;
      }
      resolve(timingSafeEqual(hashBuf, derivedBuf));
    });
  });
}
