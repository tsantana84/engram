import { describe, it, expect } from 'bun:test';
import { SettingsDefaultsManager } from '../../src/shared/SettingsDefaultsManager.js';

describe('SettingsDefaultsManager - Sync Settings', () => {
  it('should have sync settings with correct defaults', () => {
    const defaults = SettingsDefaultsManager.getAllDefaults();
    
    expect(defaults.CLAUDE_MEM_SYNC_ENABLED).toBe('false');
    expect(defaults.CLAUDE_MEM_SYNC_SERVER_URL).toBe('');
    expect(defaults.CLAUDE_MEM_SYNC_API_KEY).toBe('');
    expect(defaults.CLAUDE_MEM_SYNC_AGENT_NAME).toBe('');
    expect(defaults.CLAUDE_MEM_SYNC_INTERVAL_MS).toBe('30000');
    expect(defaults.CLAUDE_MEM_SYNC_TIMEOUT_MS).toBe('3000');
    expect(defaults.CLAUDE_MEM_SYNC_MAX_RETRIES).toBe('5');
  });

  it('should override sync settings from env vars', () => {
    process.env.CLAUDE_MEM_SYNC_ENABLED = 'true';
    process.env.CLAUDE_MEM_SYNC_SERVER_URL = 'https://test.example.com';
    
    // get() applies env overrides
    const enabled = SettingsDefaultsManager.get('CLAUDE_MEM_SYNC_ENABLED');
    const url = SettingsDefaultsManager.get('CLAUDE_MEM_SYNC_SERVER_URL');
    expect(enabled).toBe('true');
    expect(url).toBe('https://test.example.com');
    
    delete process.env.CLAUDE_MEM_SYNC_ENABLED;
    delete process.env.CLAUDE_MEM_SYNC_SERVER_URL;
  });

  it('should get boolean sync setting correctly', () => {
    process.env.CLAUDE_MEM_SYNC_ENABLED = 'true';
    
    const boolVal = SettingsDefaultsManager.getBool('CLAUDE_MEM_SYNC_ENABLED');
    expect(boolVal).toBe(true);
    
    delete process.env.CLAUDE_MEM_SYNC_ENABLED;
  });

  it('should get integer sync setting correctly', () => {
    process.env.CLAUDE_MEM_SYNC_INTERVAL_MS = '60000';
    
    const intVal = SettingsDefaultsManager.getInt('CLAUDE_MEM_SYNC_INTERVAL_MS');
    expect(intVal).toBe(60000);
    
    delete process.env.CLAUDE_MEM_SYNC_INTERVAL_MS;
  });
});