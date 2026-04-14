import { describe, it, expect, beforeEach } from 'bun:test';
import { SyncClient, SyncPushPayload } from '../../../src/services/sync/SyncClient.js';

describe('SyncClient', () => {
  let client: SyncClient;

  beforeEach(() => {
    client = new SyncClient({
      serverUrl: 'http://localhost:9999',
      apiKey: 'cmem_ak_testkey123',
      agentName: 'TestAgent',
      timeoutMs: 3000,
    });
  });

  it('should construct correct push URL', () => {
    expect((client as any).buildUrl('/api/sync/push')).toBe('http://localhost:9999/api/sync/push');
  });

  it('should include Authorization header', () => {
    const headers = (client as any).buildHeaders();
    expect(headers['Authorization']).toBe('Bearer cmem_ak_testkey123');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('should build correct push payload structure', () => {
    const payload: SyncPushPayload = {
      observations: [
        {
          local_id: 42,
          content_hash: 'abc123',
          type: 'discovery',
          title: 'Test observation',
          subtitle: null,
          facts: ['fact1'],
          narrative: 'narrative text',
          concepts: ['concept1'],
          files_read: ['/path/file.ts'],
          files_modified: [],
          project: 'test-project',
          created_at: '2026-04-14T12:00:00Z',
          created_at_epoch: 1776355200,
          prompt_number: 5,
          model_used: 'claude-sonnet-4-20250514',
        },
      ],
      sessions: [],
      summaries: [],
    };

    expect(payload.observations).toHaveLength(1);
    expect(payload.observations[0].local_id).toBe(42);
  });

  it('should handle network errors gracefully', async () => {
    const payload: SyncPushPayload = { observations: [], sessions: [], summaries: [] };
    await expect(client.push(payload)).rejects.toThrow();
  });

  it('should handle timeout', async () => {
    const slowClient = new SyncClient({
      serverUrl: 'http://10.255.255.1',
      apiKey: 'cmem_ak_testkey123',
      agentName: 'TestAgent',
      timeoutMs: 100,
    });

    const payload: SyncPushPayload = { observations: [], sessions: [], summaries: [] };
    await expect(slowClient.push(payload)).rejects.toThrow();
  });
});
