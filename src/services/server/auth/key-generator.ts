import { randomBytes } from 'crypto';

const PREFIX = 'cmem_ak_';

export function generateApiKey(): string {
  const random = randomBytes(32).toString('hex');
  return `${PREFIX}${random}`;
}

export async function hashApiKey(key: string): Promise<string> {
  return await Bun.password.hash(key, { algorithm: 'bcrypt', cost: 10 });
}

export async function verifyApiKey(key: string, hash: string): Promise<boolean> {
  return await Bun.password.verify(key, hash);
}
