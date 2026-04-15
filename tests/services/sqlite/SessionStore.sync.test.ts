import { describe, it, expect } from 'bun:test';
import { SessionStore } from '../../../src/services/sqlite/SessionStore.js';
import { SyncQueue } from '../../../src/services/sync/SyncQueue.js';

function createStore(): { store: SessionStore; queue: SyncQueue } {
  const store = new SessionStore(':memory:');
  const queue = new SyncQueue(store.db);
  store.setSyncQueue(queue);
  return { store, queue };
}

describe('SessionStore sync queue integration', () => {
  it('enqueues observation after storeObservation', () => {
    const { store, queue } = createStore();

    store.createSDKSession('test-content-id', '/test-project');
    store.updateMemorySessionId(1, 'test-memory-id');

    store.storeObservation('test-memory-id', '/test-project', {
      type: 'code',
      title: 'Test obs',
      subtitle: null,
      facts: [],
      narrative: 'some narrative',
      concepts: [],
      files_read: [],
      files_modified: [],
    });

    const status = queue.getStatus();
    expect(status.pending).toBe(1);

    const pending = queue.getPending(10);
    expect(pending[0].entity_type).toBe('observation');
    expect(pending[0].entity_id).toBe(1);
  });

  it('enqueues summary after storeSummary', () => {
    const { store, queue } = createStore();

    store.createSDKSession('test-content-id-2', '/test-project');
    store.updateMemorySessionId(1, 'test-memory-id-2');

    store.storeSummary('test-memory-id-2', '/test-project', {
      request: 'test request',
      investigated: 'test investigated',
      learned: 'test learned',
      completed: 'test completed',
      next_steps: 'test next steps',
      notes: null,
    });

    const status = queue.getStatus();
    expect(status.pending).toBe(1);

    const pending = queue.getPending(10);
    expect(pending[0].entity_type).toBe('summary');
  });

  it('does not enqueue deduplicated observations', () => {
    const { store, queue } = createStore();

    store.createSDKSession('test-content-id-3', '/test-project');
    store.updateMemorySessionId(1, 'test-memory-id-3');

    const obs = {
      type: 'code',
      title: 'Dup obs',
      subtitle: null,
      facts: [],
      narrative: 'same narrative',
      concepts: [],
      files_read: [],
      files_modified: [],
    };

    store.storeObservation('test-memory-id-3', '/test-project', obs);
    store.storeObservation('test-memory-id-3', '/test-project', obs); // duplicate

    // Only 1 should be enqueued (dedup hit returns early)
    expect(queue.getStatus().pending).toBe(1);
  });

  it('does not throw when no syncQueue set', () => {
    const store = new SessionStore(':memory:');

    store.createSDKSession('test-content-id-4', '/test-project');
    store.updateMemorySessionId(1, 'test-memory-id-4');

    expect(() => {
      store.storeObservation('test-memory-id-4', '/test-project', {
        type: 'code',
        title: 'No queue',
        subtitle: null,
        facts: [],
        narrative: 'narrative',
        concepts: [],
        files_read: [],
        files_modified: [],
      });
    }).not.toThrow();
  });
});
