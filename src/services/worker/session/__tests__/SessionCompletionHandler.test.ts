import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { SessionCompletionHandler } from '../SessionCompletionHandler.js';
import { SessionStore } from '../../../sqlite/SessionStore.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('SessionCompletionHandler', () => {
  let tmp: string;
  let dbPath: string;
  let store: SessionStore;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'engram-test-'));
    dbPath = join(tmp, 'test.db');
    store = new SessionStore(dbPath);
  });

  afterEach(() => {
    store.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('completeByDbId marks extraction_status pending (even when previously done)', async () => {
    const sessionId = store.createSDKSession('memory-1', 'proj', 'hello');

    // Pre-condition: simulate prior extraction that finished
    (store as any).db.run(
      "UPDATE sdk_sessions SET extraction_status = 'done' WHERE id = ?",
      [sessionId]
    );

    const fakeSessionManager: any = {
      deleteSession: async () => {},
      getPendingMessageStore: () => ({
        markAllSessionMessagesAbandoned: () => 0,
      }),
    };
    const fakeBroadcaster: any = { broadcastSessionCompleted: () => {} };
    const fakeDbManager: any = { getSessionStore: () => store };

    const handler = new SessionCompletionHandler(fakeSessionManager, fakeBroadcaster, fakeDbManager);
    await handler.completeByDbId(sessionId);

    const row = (store as any).db.query<{ extraction_status: string; completed_at: string | null }, [number]>(
      'SELECT extraction_status, completed_at FROM sdk_sessions WHERE id = ?'
    ).get(sessionId);
    expect(row?.extraction_status).toBe('pending');
    expect(row?.completed_at).not.toBeNull();
  });
});
