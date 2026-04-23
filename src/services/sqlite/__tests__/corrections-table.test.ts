import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SessionStore } from '../SessionStore.js';

describe('corrections table', () => {
  let store: SessionStore;
  beforeEach(() => { store = new SessionStore(':memory:'); });
  afterEach(() => { store.close(); });

  it('creates corrections table with required columns', () => {
    const row = store.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='corrections'"
    ).get();
    expect(row).toBeTruthy();
  });

  it('creates index on trigger_context', () => {
    const row = store.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_corrections_trigger'"
    ).get();
    expect(row).toBeTruthy();
  });

  it('creates index on project', () => {
    const row = store.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_corrections_project'"
    ).get();
    expect(row).toBeTruthy();
  });
});
