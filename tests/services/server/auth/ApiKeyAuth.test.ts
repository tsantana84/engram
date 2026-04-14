import { describe, it, expect } from 'bun:test';
import { generateApiKey, hashApiKey, verifyApiKey } from '../../../../src/services/server/auth/key-generator.js';

describe('API Key Generation', () => {
  it('should generate key with cmem_ak_ prefix', () => {
    const key = generateApiKey();
    expect(key.startsWith('cmem_ak_')).toBe(true);
  });

  it('should generate unique keys', () => {
    const key1 = generateApiKey();
    const key2 = generateApiKey();
    expect(key1).not.toBe(key2);
  });

  it('should generate key of sufficient length', () => {
    const key = generateApiKey();
    expect(key.length).toBeGreaterThanOrEqual(40);
  });

  it('should hash and verify correctly', async () => {
    const key = generateApiKey();
    const hash = await hashApiKey(key);
    
    expect(hash).not.toBe(key);
    expect(await verifyApiKey(key, hash)).toBe(true);
    expect(await verifyApiKey('wrong_key', hash)).toBe(false);
  });
});
