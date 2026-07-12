import { randomBytes, timingSafeEqual, scrypt as scryptCallback } from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const PREFIX = 'scrypt';

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `${PREFIX}:${salt}:${derivedKey.toString('hex')}`;
}

export async function verifyPassword(password: string, hash: string) {
  const [prefix, salt, key] = hash.split(':');
  if (prefix !== PREFIX || !salt || !key) return false;

  const expected = Buffer.from(key, 'hex');
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
