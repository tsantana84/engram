import { describe, expect, test, mock } from 'bun:test';
import { SyncClient } from '../SyncClient.js';

const clientConfig = { serverUrl: 'https://e.test', apiKey: 'k', agentName: 'test-agent', timeoutMs: 5000 };

describe('SyncClient.pushLearnings', () => {
  test('POSTs to /api/sync/learnings with target_status', async () => {
    const captured: any = {};
    globalThis.fetch = mock(async (url: any, init: any) => {
      captured.url = String(url);
      captured.body = JSON.parse(init.body);
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as any;

    const c = new SyncClient(clientConfig);
    await c.pushLearnings([{
      claim: 'x', evidence: null, scope: null, confidence: 0.9,
      project: 'p', source_session: 's', content_hash: 'h',
    }], 'approved');

    expect(captured.url).toBe('https://e.test/api/sync/learnings');
    expect(captured.body.target_status).toBe('approved');
    expect(captured.body.learnings.length).toBe(1);
  });

  test('throws with HTTP status on non-2xx', async () => {
    globalThis.fetch = mock(async () => new Response('boom', { status: 500 })) as any;
    const c = new SyncClient(clientConfig);
    await expect(c.pushLearnings([], 'pending')).rejects.toThrow(/500/);
  });
});
