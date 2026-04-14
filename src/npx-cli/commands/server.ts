import { ServerService } from '../../services/server/ServerService.js';
import { generateApiKey, hashApiKey } from '../../services/server/auth/key-generator.js';
import { PostgresManager } from '../../services/server/PostgresManager.js';

export async function runServerCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case 'start': {
      const port = parseInt(getFlag(args, '--port') || '8888');
      const databaseUrl = getFlag(args, '--database-url') || process.env.DATABASE_URL;

      if (!databaseUrl) {
        console.error('Error: --database-url or DATABASE_URL env var is required');
        process.exit(1);
      }

      const server = new ServerService({ port, databaseUrl });
      await server.start();
      
      process.on('SIGINT', async () => {
        console.log('\nShutting down...');
        await server.stop();
        process.exit(0);
      });
      process.on('SIGTERM', async () => {
        await server.stop();
        process.exit(0);
      });
      break;
    }

    case 'create-agent': {
      const name = getFlag(args, '--name');
      const databaseUrl = getFlag(args, '--database-url') || process.env.DATABASE_URL;

      if (!name) {
        console.error('Error: --name is required');
        process.exit(1);
      }
      if (!databaseUrl) {
        console.error('Error: --database-url or DATABASE_URL env var is required');
        process.exit(1);
      }

      const pg = new PostgresManager(databaseUrl);
      await pg.connect();
      await pg.runMigrations();

      const apiKey = generateApiKey();
      const hash = await hashApiKey(apiKey);

      try {
        const agent = await pg.createAgent(name, hash);
        console.log(`\nAgent created: ${agent.name}`);
        console.log(`API Key: ${apiKey}`);
        console.log(`\nSave this key — it cannot be retrieved again.`);
        console.log(`\nAdd to ~/.claude-mem/settings.json:`);
        console.log(JSON.stringify({
          CLAUDE_MEM_SYNC_ENABLED: true,
          CLAUDE_MEM_SYNC_SERVER_URL: 'http://your-server:8888',
          CLAUDE_MEM_SYNC_API_KEY: apiKey,
          CLAUDE_MEM_SYNC_AGENT_NAME: name,
        }, null, 2));
      } catch (error: any) {
        if (error.code === '23505') {
          console.error(`Error: Agent "${name}" already exists`);
        } else {
          console.error(`Error: ${error.message}`);
        }
        process.exit(1);
      } finally {
        await pg.close();
      }
      break;
    }

    case 'list-agents': {
      const databaseUrl = getFlag(args, '--database-url') || process.env.DATABASE_URL;
      if (!databaseUrl) {
        console.error('Error: --database-url or DATABASE_URL env var is required');
        process.exit(1);
      }

      const pg = new PostgresManager(databaseUrl);
      await pg.connect();

      const agents = await pg.getActiveAgents();
      if (agents.length === 0) {
        console.log('No active agents');
      } else {
        console.log(`\nActive agents (${agents.length}):\n`);
        for (const agent of agents) {
          console.log(`  ${agent.name} (created ${agent.created_at})`);
        }
      }

      await pg.close();
      break;
    }

    case 'revoke-agent': {
      const name = getFlag(args, '--name');
      const databaseUrl = getFlag(args, '--database-url') || process.env.DATABASE_URL;

      if (!name) {
        console.error('Error: --name is required');
        process.exit(1);
      }
      if (!databaseUrl) {
        console.error('Error: --database-url or DATABASE_URL env var is required');
        process.exit(1);
      }

      const pg = new PostgresManager(databaseUrl);
      await pg.connect();

      const agent = await pg.getAgentByName(name);
      if (!agent) {
        console.error(`Error: Agent "${name}" not found`);
        process.exit(1);
      }

      await pg.revokeAgent(name);
      console.log(`Agent "${name}" revoked`);

      await pg.close();
      break;
    }

    default:
      console.log(`Usage: engram server <command>

Commands:
  start              Start the sync server
    --port           Port (default: 8888)
    --database-url   Postgres connection string

  create-agent       Register a new agent
    --name           Agent display name

  list-agents        List all active agents

  revoke-agent       Revoke an agent's access
    --name           Agent name to revoke
`);
  }
}

function getFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) return undefined;
  return args[index + 1];
}
