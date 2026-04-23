import { describe, it, expect } from 'bun:test';
import { CorrectionExtractor } from '../CorrectionExtractor.js';

describe('CorrectionExtractor', () => {
  it('returns null when LLM returns null', async () => {
    const extractor = new CorrectionExtractor({
      enabled: true,
      llm: async () => 'null',
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 300,
    });
    const result = await extractor.extract('some context');
    expect(result).toBeNull();
  });

  it('parses valid correction JSON', async () => {
    const record = { tried: 'use rm -rf', wrong_because: 'destructive', fix: 'use trash command', trigger_context: 'deleting files' };
    const extractor = new CorrectionExtractor({
      enabled: true,
      llm: async () => JSON.stringify(record),
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 300,
    });
    const result = await extractor.extract('context');
    expect(result).toEqual(record);
  });

  it('returns null when trigger_context is empty', async () => {
    const record = { tried: 'x', wrong_because: 'y', fix: 'z', trigger_context: '' };
    const extractor = new CorrectionExtractor({
      enabled: true,
      llm: async () => JSON.stringify(record),
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 300,
    });
    expect(await extractor.extract('context')).toBeNull();
  });

  it('returns null when disabled', async () => {
    const extractor = new CorrectionExtractor({
      enabled: false,
      llm: async () => '{}',
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 300,
    });
    expect(await extractor.extract('context')).toBeNull();
  });

  it('returns null on LLM error', async () => {
    const extractor = new CorrectionExtractor({
      enabled: true,
      llm: async () => { throw new Error('LLM failed'); },
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 300,
    });
    expect(await extractor.extract('context')).toBeNull();
  });
});
