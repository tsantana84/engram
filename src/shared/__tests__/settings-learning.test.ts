import { describe, expect, test } from 'bun:test';
import { SettingsDefaultsManager } from '../SettingsDefaultsManager.js';

// Use getAllDefaults() instead of get() to avoid interference from mock.module
// in other test files that stub SettingsDefaultsManager.get() to return ''
describe('learning extraction settings defaults', () => {
  test('extraction enabled by default', () => {
    expect(SettingsDefaultsManager.getAllDefaults().CLAUDE_MEM_LEARNING_EXTRACTION_ENABLED).toBe('true');
  });
  test('threshold default 0.8', () => {
    expect(SettingsDefaultsManager.getAllDefaults().CLAUDE_MEM_LEARNING_CONFIDENCE_THRESHOLD).toBe('0.9');
  });
  test('max per session default 10', () => {
    expect(SettingsDefaultsManager.getAllDefaults().CLAUDE_MEM_LEARNING_MAX_PER_SESSION).toBe('10');
  });
  test('max retries default 3', () => {
    expect(SettingsDefaultsManager.getAllDefaults().CLAUDE_MEM_LEARNING_EXTRACTION_MAX_RETRIES).toBe('3');
  });
  test('llm model key present (string)', () => {
    expect(typeof SettingsDefaultsManager.getAllDefaults().CLAUDE_MEM_LEARNING_LLM_MODEL).toBe('string');
  });
});
