import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SessionStore } from '../../sqlite/SessionStore.js';
import { buildSessionBriefing, buildPromptBriefing } from '../BriefingComposer.js';

function seedData(store: SessionStore) {
  store.db.prepare(`
    INSERT INTO sdk_sessions (content_session_id, memory_session_id, project, started_at, started_at_epoch)
    VALUES ('cs-1', 'ms-1', '/test/proj', datetime('now'), ?)
  `).run(Date.now());

  store.db.prepare(`
    INSERT INTO session_summaries (memory_session_id, project, next_steps, completed, created_at, created_at_epoch)
    VALUES ('ms-1', '/test/proj', 'Finish the auth migration', 'Set up DB schema', datetime('now'), ?)
  `).run(Date.now());

  store.db.prepare(`
    INSERT INTO corrections (tried, wrong_because, fix, trigger_context, project, created_at)
    VALUES ('use rm -rf', 'deletes permanently', 'use trash-put', 'deleting files', '/test/proj', ?)
  `).run(Date.now());

  const sessionRow = store.db.prepare(
    "SELECT memory_session_id FROM sdk_sessions WHERE project = ? LIMIT 1"
  ).get('/test/proj') as any;
  store.db.prepare(`
    INSERT INTO observations (memory_session_id, project, type, text, title, narrative, created_at, created_at_epoch, discovery_tokens)
    VALUES (?, '/test/proj', 'decision', '', 'Use SQLite not Postgres', 'We decided SQLite because simpler', datetime('now'), ?, 0)
  `).run(sessionRow.memory_session_id, Date.now());
}

describe('buildSessionBriefing', () => {
  let store: SessionStore;
  beforeEach(() => { store = new SessionStore(':memory:'); });
  afterEach(() => { store.close(); });

  it('returns empty string for fresh project (no data)', () => {
    expect(buildSessionBriefing(store, '/empty/proj')).toBe('');
  });

  it('returns briefing string when data exists', () => {
    seedData(store);
    const result = buildSessionBriefing(store, '/test/proj');
    expect(result).toContain('AGENT BRIEFING');
  });

  it('includes last session next_steps', () => {
    seedData(store);
    const result = buildSessionBriefing(store, '/test/proj');
    expect(result).toContain('Finish the auth migration');
  });

  it('includes corrections in Watch out section', () => {
    seedData(store);
    const result = buildSessionBriefing(store, '/test/proj');
    expect(result).toContain('Watch out');
    expect(result).toContain('rm -rf');
    expect(result).toContain('trash-put');
  });

  it('includes decisions', () => {
    seedData(store);
    const result = buildSessionBriefing(store, '/test/proj');
    expect(result).toContain('Use SQLite not Postgres');
  });

  it('excludes sections for other projects', () => {
    seedData(store);
    const result = buildSessionBriefing(store, '/other/proj');
    expect(result).toBe('');
  });

  it('omits Watch out section when no corrections', () => {
    store.db.prepare(`
      INSERT INTO sdk_sessions (content_session_id, memory_session_id, project, started_at, started_at_epoch)
      VALUES ('cs-2', 'ms-2', '/proj2', datetime('now'), ?)
    `).run(Date.now());
    store.db.prepare(`
      INSERT INTO session_summaries (memory_session_id, project, next_steps, created_at, created_at_epoch)
      VALUES ('ms-2', '/proj2', 'Do X next', datetime('now'), ?)
    `).run(Date.now());

    const result = buildSessionBriefing(store, '/proj2');
    expect(result).not.toContain('Watch out');
    expect(result).toContain('Do X next');
  });

  it('caps output at 2000 chars', () => {
    store.db.prepare(`
      INSERT INTO sdk_sessions (content_session_id, memory_session_id, project, started_at, started_at_epoch)
      VALUES ('cs-3', 'ms-3', '/proj3', datetime('now'), ?)
    `).run(Date.now());
    for (let i = 0; i < 10; i++) {
      store.db.prepare(`
        INSERT INTO observations (memory_session_id, project, type, text, title, narrative, created_at, created_at_epoch, discovery_tokens)
        VALUES ('ms-3', '/proj3', 'decision', '', ?, 'narrative', datetime('now'), ?, 0)
      `).run('A'.repeat(200), Date.now() + i);
    }
    const result = buildSessionBriefing(store, '/proj3');
    expect(result.length).toBeLessThanOrEqual(2000);
  });
});

describe('buildPromptBriefing', () => {
  let store: SessionStore;
  beforeEach(() => { store = new SessionStore(':memory:'); });
  afterEach(() => { store.close(); });

  it('returns empty string when no data', async () => {
    const llm = async () => 'some response';
    expect(await buildPromptBriefing(store, '/empty', 'task', llm)).toBe('');
  });

  it('returns LLM-composed briefing when data exists', async () => {
    seedData(store);
    const llm = async () => 'Watch out for rm -rf. Next: finish auth.';
    const result = await buildPromptBriefing(store, '/test/proj', 'fix the auth bug', llm);
    expect(result).toContain('AGENT BRIEFING');
    expect(result).toContain('Watch out for rm -rf');
  });

  it('falls back to static template on LLM error', async () => {
    seedData(store);
    const llm = async () => { throw new Error('LLM failed'); };
    const result = await buildPromptBriefing(store, '/test/proj', 'task', llm);
    expect(result).toContain('AGENT BRIEFING');
    expect(result).toContain('Finish the auth migration');
  });

  it('caps LLM output at 2000 chars', async () => {
    seedData(store);
    const llm = async () => 'X'.repeat(3000);
    const result = await buildPromptBriefing(store, '/test/proj', 'task', llm);
    expect(result.length).toBeLessThanOrEqual(2000);
  });
});
