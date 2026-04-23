import { describe, it, expect } from 'bun:test';
import { CorrectionExtractor } from '../CorrectionExtractor.js';

const record = { tried: 'use rm -rf', wrong_because: 'destructive', fix: 'use trash command', trigger_context: 'deleting files' };

function makeExtractor(llm: () => Promise<string>, enabled = true) {
  return new CorrectionExtractor({ enabled, llm, model: 'test', maxTokens: 300 });
}

describe('CorrectionExtractor', () => {
  describe('disabled', () => {
    it('returns null when disabled', async () => {
      expect(await makeExtractor(async () => JSON.stringify(record), false).extract('ctx')).toBeNull();
    });
  });

  describe('LLM returns null', () => {
    it('handles literal "null"', async () => {
      expect(await makeExtractor(async () => 'null').extract('ctx')).toBeNull();
    });

    it('handles empty string', async () => {
      expect(await makeExtractor(async () => '').extract('ctx')).toBeNull();
    });

    it('handles whitespace-only', async () => {
      expect(await makeExtractor(async () => '   ').extract('ctx')).toBeNull();
    });
  });

  describe('LLM errors', () => {
    it('returns null on throw', async () => {
      expect(await makeExtractor(async () => { throw new Error('LLM failed'); }).extract('ctx')).toBeNull();
    });

    it('returns null on invalid JSON', async () => {
      expect(await makeExtractor(async () => 'not json at all').extract('ctx')).toBeNull();
    });

    it('returns null on truncated JSON', async () => {
      expect(await makeExtractor(async () => '{"tried": "x"').extract('ctx')).toBeNull();
    });
  });

  describe('markdown fence stripping', () => {
    it('strips ```json fences', async () => {
      const fenced = '```json\n' + JSON.stringify(record) + '\n```';
      expect(await makeExtractor(async () => fenced).extract('ctx')).toEqual(record);
    });

    it('strips ``` fences without language tag', async () => {
      const fenced = '```\n' + JSON.stringify(record) + '\n```';
      expect(await makeExtractor(async () => fenced).extract('ctx')).toEqual(record);
    });

    it('strips fences with trailing whitespace', async () => {
      const fenced = '```json  \n' + JSON.stringify(record) + '\n```  ';
      expect(await makeExtractor(async () => fenced).extract('ctx')).toEqual(record);
    });
  });

  describe('field validation', () => {
    it('parses valid correction JSON', async () => {
      expect(await makeExtractor(async () => JSON.stringify(record)).extract('ctx')).toEqual(record);
    });

    it('returns null when tried missing', async () => {
      const { tried: _, ...rest } = record;
      expect(await makeExtractor(async () => JSON.stringify(rest)).extract('ctx')).toBeNull();
    });

    it('returns null when wrong_because missing', async () => {
      const { wrong_because: _, ...rest } = record;
      expect(await makeExtractor(async () => JSON.stringify(rest)).extract('ctx')).toBeNull();
    });

    it('returns null when fix missing', async () => {
      const { fix: _, ...rest } = record;
      expect(await makeExtractor(async () => JSON.stringify(rest)).extract('ctx')).toBeNull();
    });

    it('returns null when trigger_context empty string', async () => {
      expect(await makeExtractor(async () => JSON.stringify({ ...record, trigger_context: '' })).extract('ctx')).toBeNull();
    });

    it('returns null when trigger_context whitespace only', async () => {
      expect(await makeExtractor(async () => JSON.stringify({ ...record, trigger_context: '   ' })).extract('ctx')).toBeNull();
    });

    it('ignores extra fields', async () => {
      const withExtra = { ...record, extra_field: 'ignored', another: 42 };
      expect(await makeExtractor(async () => JSON.stringify(withExtra)).extract('ctx')).toEqual(record);
    });
  });

  describe('extraction prompt', () => {
    it('passes context to LLM prompt', async () => {
      let capturedPrompt = '';
      const extractor = makeExtractor(async (p) => { capturedPrompt = p; return JSON.stringify(record); });
      await extractor.extract('USER_CONTEXT_MARKER');
      expect(capturedPrompt).toContain('USER_CONTEXT_MARKER');
    });
  });
});
