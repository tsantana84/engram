import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { SessionStore } from '../SessionStore.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('SessionStore migration 29 — extraction_status columns', () => {
  let tmp: string;
  let dbPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'engram-test-'));
    dbPath = join(tmp, 'test.db');
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  test('adds extraction_status and extraction_attempts columns to sdk_sessions', () => {
    const store = new SessionStore(dbPath);
    const db = new Database(dbPath);
    const cols = db.query<{ name: string }, []>("PRAGMA table_info('sdk_sessions')").all();
    const names = cols.map((c) => c.name);
    expect(names).toContain('extraction_status');
    expect(names).toContain('extraction_attempts');
    store.close();
    db.close();
  });

  test('extraction_status defaults to "pending"', () => {
    const store = new SessionStore(dbPath);
    const memoryId = `test-${Date.now()}`;
    const sessionId = store.createSDKSession(memoryId, 'test-proj', 'hello');
    const db = new Database(dbPath);
    const row = db.query<{ extraction_status: string; extraction_attempts: number }, [number]>(
      'SELECT extraction_status, extraction_attempts FROM sdk_sessions WHERE id = ?'
    ).get(sessionId);
    expect(row?.extraction_status).toBe('pending');
    expect(row?.extraction_attempts).toBe(0);
    store.close();
    db.close();
  });
});
