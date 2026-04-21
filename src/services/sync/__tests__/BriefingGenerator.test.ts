import { describe, test, expect } from 'bun:test';
import { BriefingGenerator, type BriefingInput } from '../BriefingGenerator.js';

const baseInput: BriefingInput = {
  memorySessionId: 'sess-1',
  project: '/my/proj',
  transcriptTail: 'User: fix the login bug. Assistant: Found null check missing in auth.ts line 42.',
  recentFiles: ['src/auth.ts', 'src/login.ts'],
  recentDecisions: ['Use JWT for session tokens'],
  recentErrors: ['TypeError: Cannot read property of null at auth.ts:42'],
  openTodos: ['Fix null check in auth.ts'],
};

describe('BriefingGenerator', () => {
  test('generates briefing with template sections', async () => {
    const gen = new BriefingGenerator({ llm: async () => 'LLM summary: fixing auth null check' });
    const result = await gen.generate(baseInput);

    expect(result.text).toContain('src/auth.ts');
    expect(result.text).toContain('Fix null check');
    expect(result.text).toContain('JWT');
  });

  test('includes LLM summary when llm succeeds', async () => {
    const gen = new BriefingGenerator({ llm: async () => 'Active task: fixing login null check in auth.ts' });
    const result = await gen.generate(baseInput);

    expect(result.text).toContain('Active task: fixing login null check');
    expect(result.usedLlm).toBe(true);
  });

  test('falls back to template-only when LLM throws', async () => {
    const gen = new BriefingGenerator({ llm: async () => { throw new Error('LLM unavailable'); } });
    const result = await gen.generate(baseInput);

    expect(result.text).toContain('src/auth.ts');
    expect(result.usedLlm).toBe(false);
  });

  test('returns template-only when no llm provided', async () => {
    const gen = new BriefingGenerator({});
    const result = await gen.generate(baseInput);
    expect(result.text.length).toBeGreaterThan(20);
    expect(result.usedLlm).toBe(false);
  });

  test('total briefing fits within 500 token budget (~2000 chars)', async () => {
    const longInput: BriefingInput = {
      ...baseInput,
      recentFiles: Array(50).fill('src/very-long-file-name-that-takes-many-tokens.ts'),
      openTodos: Array(30).fill('Fix extremely verbose todo description that takes many tokens'),
    };
    const gen = new BriefingGenerator({ llm: async () => 'summary' });
    const result = await gen.generate(longInput);
    expect(result.text.length).toBeLessThanOrEqual(2000);
  });
});
