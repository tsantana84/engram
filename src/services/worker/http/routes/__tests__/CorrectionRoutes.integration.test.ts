import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import express from 'express';
import { SessionStore } from '../../../../sqlite/SessionStore.js';
import { CorrectionRoutes } from '../CorrectionRoutes.js';

function buildApp(store: SessionStore) {
  const dbManager = {
    getSessionStore: () => store,
  } as any;

  const app = express();
  app.use(express.json());
  new CorrectionRoutes(dbManager).setupRoutes(app);
  return app;
}

async function post(app: ReturnType<typeof buildApp>, body: Record<string, unknown>) {
  const server = app.listen(0);
  const port = (server.address() as any).port;
  try {
    const res = await fetch(`http://localhost:${port}/api/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

describe('CorrectionRoutes integration', () => {
  let store: SessionStore;

  beforeEach(() => { store = new SessionStore(':memory:'); });
  afterEach(() => { store.close(); });

  const correction = {
    tried: 'use rm -rf',
    wrong_because: 'deletes permanently',
    fix: 'use trash-put instead',
    trigger_context: 'deleting files safely',
    project: '/test/project',
  };

  describe('validation', () => {
    it('returns 400 when tried missing', async () => {
      const { tried: _, ...rest } = correction;
      const { status, body } = await post(buildApp(store), rest);
      expect(status).toBe(400);
      expect(body.error).toContain('required');
    });

    it('returns 400 when wrong_because missing', async () => {
      const { wrong_because: _, ...rest } = correction;
      const { status } = await post(buildApp(store), rest);
      expect(status).toBe(400);
    });

    it('returns 400 when fix missing', async () => {
      const { fix: _, ...rest } = correction;
      const { status } = await post(buildApp(store), rest);
      expect(status).toBe(400);
    });

    it('returns 400 when trigger_context missing', async () => {
      const { trigger_context: _, ...rest } = correction;
      const { status } = await post(buildApp(store), rest);
      expect(status).toBe(400);
    });

    it('returns 400 when trigger_context empty string', async () => {
      const { status } = await post(buildApp(store), { ...correction, trigger_context: '' });
      expect(status).toBe(400);
    });

    it('returns 400 when trigger_context whitespace only', async () => {
      const { status } = await post(buildApp(store), { ...correction, trigger_context: '   ' });
      expect(status).toBe(400);
    });
  });

  describe('dual-write', () => {
    it('returns 200 with id on valid input', async () => {
      const { status, body } = await post(buildApp(store), correction);
      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(typeof body.id).toBe('number');
    });

    it('writes to corrections table', async () => {
      await post(buildApp(store), correction);
      const row = store.db.prepare(
        'SELECT tried, wrong_because, fix, trigger_context, project FROM corrections LIMIT 1'
      ).get() as any;
      expect(row.tried).toBe(correction.tried);
      expect(row.wrong_because).toBe(correction.wrong_because);
      expect(row.fix).toBe(correction.fix);
      expect(row.trigger_context).toBe(correction.trigger_context);
      expect(row.project).toBe(correction.project);
    });

    it('writes observation with type=correction', async () => {
      const { body } = await post(buildApp(store), correction);
      const obs = store.db.prepare(
        "SELECT type, title, narrative FROM observations WHERE id = ?"
      ).get(body.id) as any;
      expect(obs.type).toBe('correction');
      expect(obs.title).toContain('Correction:');
      expect(obs.narrative).toContain(correction.tried);
      expect(obs.narrative).toContain(correction.fix);
    });

    it('corrections table and observations table are in sync (same count)', async () => {
      await post(buildApp(store), correction);
      await post(buildApp(store), { ...correction, tried: 'another mistake' });
      const corrCount = (store.db.prepare('SELECT COUNT(*) as n FROM corrections').get() as any).n;
      const obsCount = (store.db.prepare("SELECT COUNT(*) as n FROM observations WHERE type='correction'").get() as any).n;
      expect(corrCount).toBe(2);
      expect(obsCount).toBe(2);
    });

    it('stores created_at as epoch milliseconds', async () => {
      const before = Date.now();
      await post(buildApp(store), correction);
      const after = Date.now();
      const row = store.db.prepare('SELECT created_at FROM corrections LIMIT 1').get() as any;
      expect(row.created_at).toBeGreaterThanOrEqual(before);
      expect(row.created_at).toBeLessThanOrEqual(after);
    });

    it('stores weight_multiplier default 2.0', async () => {
      await post(buildApp(store), correction);
      const row = store.db.prepare('SELECT weight_multiplier FROM corrections LIMIT 1').get() as any;
      expect(row.weight_multiplier).toBe(2.0);
    });
  });

  describe('prewarm query integration', () => {
    it('stored correction is returned by project-scoped prewarm query', async () => {
      await post(buildApp(store), correction);
      const rows = store.db.prepare(`
        SELECT tried, trigger_context FROM corrections
        WHERE project = ? AND trigger_context != ''
        ORDER BY weight_multiplier DESC, created_at DESC
        LIMIT 10
      `).all(correction.project) as any[];
      expect(rows.length).toBe(1);
      expect(rows[0].tried).toBe(correction.tried);
      expect(rows[0].trigger_context).toBe(correction.trigger_context);
    });

    it('correction not returned for different project', async () => {
      await post(buildApp(store), correction);
      const rows = store.db.prepare(`
        SELECT tried FROM corrections WHERE project = ? AND trigger_context != ''
      `).all('/other/project') as any[];
      expect(rows.length).toBe(0);
    });
  });

  describe('search weight integration', () => {
    it('stored correction observation has type=correction for weight boost lookup', async () => {
      const { body } = await post(buildApp(store), correction);
      const row = store.db.prepare(
        "SELECT id, type FROM observations WHERE id = ? AND type = 'correction'"
      ).get(body.id) as any;
      expect(row).toBeTruthy();
      expect(row.type).toBe('correction');
    });
  });
});
