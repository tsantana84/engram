import { describe, test, expect } from 'bun:test';

describe('pre-compact handler', () => {
  test('returns exit 0 when feature flag is disabled', async () => {
    const { preCompactHandler } = await import('../pre-compact.js');
    const result = await preCompactHandler.execute({
      event: 'pre_compact',
      sessionId: 'sess-1',
      cwd: '/my/proj',
      platformSource: 'claude_code',
      hookEventType: 'PreCompact',
      payload: {},
    } as any);
    expect(result.exitCode).toBe(0);
  });
});
