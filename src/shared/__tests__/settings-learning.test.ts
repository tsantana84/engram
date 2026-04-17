import { describe, expect, test } from 'bun:test';
import { SettingsDefaultsManager } from '../SettingsDefaultsManager.js';

describe('learning extraction settings defaults', () => {
  test('extraction enabled by default', () => {
    expect(SettingsDefaultsManager.get('CLAUDE_MEM_LEARNING_EXTRACTION_ENABLED')).toBe('true');
  });
  test('threshold default 0.8', () => {
    expect(SettingsDefaultsManager.get('CLAUDE_MEM_LEARNING_CONFIDENCE_THRESHOLD')).toBe('0.8');
  });
  test('max per session default 10', () => {
    expect(SettingsDefaultsManager.get('CLAUDE_MEM_LEARNING_MAX_PER_SESSION')).toBe('10');
  });
  test('max retries default 3', () => {
    expect(SettingsDefaultsManager.get('CLAUDE_MEM_LEARNING_EXTRACTION_MAX_RETRIES')).toBe('3');
  });
  test('llm model key present (string)', () => {
    expect(typeof SettingsDefaultsManager.get('CLAUDE_MEM_LEARNING_LLM_MODEL')).toBe('string');
  });
});
