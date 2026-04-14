import { describe, it, before, after } from 'bun:test';
import { equal, ok } from 'bun';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const skipIfNoDatabase = (name: string) => {
  if (!TEST_DATABASE_URL) {
    describe.skip(name, () => {
      it('skipping - no TEST_DATABASE_URL', () => {
        console.log('TEST_DATABASE_URL not set, skipping test');
      });
    });
    return true;
  }
  return false;
};

if (skipIfNoDatabase('PostgresManager')) {
  // Tests skipped - no database
} else {
  const { PostgresManager } = await import('../../src/services/server/PostgresManager.js');

  describe('PostgresManager', () => {
    let pg: PostgresManager;
    const testAgentName = `test-agent-${Date.now()}`;
    const testApiKeyHash = 'test-hash-123';

    before(async () => {
      pg = new PostgresManager(TEST_DATABASE_URL!);
      await pg.connect();
      await pg.runMigrations();
    });

    after(async () => {
      await pg.close();
    });

    describe('runMigrations', () => {
      it('should execute migrations without error', async () => {
        await pg.runMigrations();
        ok(true);
      });
    });

    describe('createAgent', () => {
      it('should create a new agent', async () => {
        const agent = await pg.createAgent(testAgentName, testApiKeyHash);
        equal(agent.name, testAgentName);
        equal(agent.api_key_hash, testApiKeyHash);
        equal(agent.status, 'active');
      });

      it('should throw on duplicate name', async () => {
        try {
          await pg.createAgent(testAgentName, testApiKeyHash);
          ok(false, 'Should have thrown');
        } catch (err: any) {
          equal(err.code, '23505');
        }
      });
    });

    describe('getActiveAgents', () => {
      it('should return active agents', async () => {
        const agents = await pg.getActiveAgents();
        ok(Array.isArray(agents));
        ok(agents.length > 0);
        ok(agents.some(a => a.name === testAgentName));
      });
    });

    describe('getAgentByName', () => {
      it('should return agent by name', async () => {
        const agent = await pg.getAgentByName(testAgentName);
        ok(agent !== null);
        equal(agent!.name, testAgentName);
      });

      it('should return null for non-existent agent', async () => {
        const agent = await pg.getAgentByName('non-existent-agent');
        equal(agent, null);
      });
    });

    describe('insertObservation', () => {
      it('should insert observation', async () => {
        const agent = await pg.getAgentByName(testAgentName);
        const result = await pg.insertObservation({
          agent_id: agent!.id,
          local_id: 1,
          content_hash: 'hash-123',
          type: 'observation',
          title: 'Test Title',
          subtitle: 'Test Subtitle',
          facts: ['fact1', 'fact2'],
          narrative: 'Test narrative',
          concepts: ['concept1'],
          files_read: ['file1.txt'],
          files_modified: ['file2.txt'],
          project: 'test-project',
          created_at: new Date().toISOString(),
          created_at_epoch: Date.now(),
          prompt_number: 1,
          model_used: 'claude-3-5-sonnet',
        });
        equal(result.inserted, true);
      });

      it('should skip duplicate observation', async () => {
        const agent = await pg.getAgentByName(testAgentName);
        const result = await pg.insertObservation({
          agent_id: agent!.id,
          local_id: 1,
          content_hash: 'hash-123',
          type: 'observation',
          title: 'Test Title',
          subtitle: 'Test Subtitle',
          facts: ['fact1'],
          narrative: 'Test narrative',
          concepts: [],
          files_read: [],
          files_modified: [],
          project: 'test-project',
          created_at: new Date().toISOString(),
          created_at_epoch: Date.now(),
          prompt_number: null,
          model_used: null,
        });
        equal(result.inserted, false);
      });
    });

    describe('insertSession', () => {
      it('should insert session', async () => {
        const agent = await pg.getAgentByName(testAgentName);
        const result = await pg.insertSession({
          agent_id: agent!.id,
          local_session_id: 1,
          content_session_id: 'session-123',
          project: 'test-project',
          platform_source: 'claude',
          user_prompt: 'Test prompt',
          custom_title: 'Test Session',
          started_at: new Date().toISOString(),
          started_at_epoch: Date.now(),
          completed_at: null,
          completed_at_epoch: null,
          status: 'active',
        });
        equal(result.inserted, true);
      });
    });

    describe('insertSummary', () => {
      it('should insert summary', async () => {
        const agent = await pg.getAgentByName(testAgentName);
        const result = await pg.insertSummary({
          agent_id: agent!.id,
          local_summary_id: 1,
          local_session_id: 1,
          project: 'test-project',
          request: 'Test request',
          investigated: 'Test investigated',
          learned: 'Test learned',
          completed: 'Test completed',
          next_steps: 'Test next steps',
          files_read: 'file1.txt',
          files_edited: 'file2.txt',
          notes: 'Test notes',
          created_at: new Date().toISOString(),
          created_at_epoch: Date.now(),
        });
        equal(result.inserted, true);
      });
    });

    describe('searchObservations', () => {
      it('should search observations', async () => {
        const results = await pg.searchObservations('Test', { limit: 10 });
        ok(Array.isArray(results));
        ok(results.length > 0);
      });

      it('should filter by project', async () => {
        const results = await pg.searchObservations('', { project: 'test-project' });
        ok(Array.isArray(results));
        ok(results.every(r => r.project === 'test-project'));
      });

      it('should filter by agent', async () => {
        const results = await pg.searchObservations('', { agent: testAgentName });
        ok(Array.isArray(results));
        ok(results.every(r => r.agent_name === testAgentName));
      });
    });

    describe('getTimeline', () => {
      it('should return timeline', async () => {
        const results = await pg.getTimeline({ limit: 50 });
        ok(Array.isArray(results));
        ok(results.length > 0);
      });
    });

    describe('getAgentSyncStatus', () => {
      it('should return sync status', async () => {
        const agent = await pg.getAgentByName(testAgentName);
        const status = await pg.getAgentSyncStatus(agent!.id);
        ok(status !== null);
        equal(typeof status.observation_count, 'number');
        equal(typeof status.session_count, 'number');
      });
    });

    describe('revokeAgent', () => {
      it('should revoke agent', async () => {
        await pg.revokeAgent(testAgentName);
        const agent = await pg.getAgentByName(testAgentName);
        equal(agent!.status, 'revoked');
      });
    });
  });
}
