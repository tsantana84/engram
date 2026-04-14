/**
 * Sync command for engram multi-agent sync.
 * Delegates to Bun since we need bun:sqlite for database access.
 */
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import pc from 'picocolors';
import { resolveBunBinaryPath } from '../utils/bun-resolver.js';
import { isPluginInstalled, marketplaceDirectory } from '../utils/paths.js';

function ensureInstalledOrExit(): void {
  if (!isPluginInstalled()) {
    console.error(pc.red('claude-mem is not installed.'));
    console.error(`Run: ${pc.bold('npx claude-mem install')}`);
    process.exit(1);
  }
}

function resolveBunOrExit(): string {
  const bunPath = resolveBunBinaryPath();
  if (!bunPath) {
    console.error(pc.red('Bun not found.'));
    console.error('Install Bun: https://bun.sh');
    console.error('After installation, restart your terminal.');
    process.exit(1);
  }
  return bunPath;
}

export async function runSyncCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (subcommand === 'status' || subcommand === 'retry') {
    ensureInstalledOrExit();
    const bunPath = resolveBunOrExit();
    
    const syncScriptPath = join(marketplaceDirectory(), 'plugin', 'scripts', 'sync-command.cjs');
    
    if (!existsSync(syncScriptPath)) {
      console.error(pc.red(`Sync script not found at: ${syncScriptPath}`));
      console.error('The installation may be corrupted. Try: npx claude-mem install');
      process.exit(1);
    }

    const child = spawn(bunPath, [syncScriptPath, subcommand, ...args.slice(1)], {
      stdio: 'inherit',
      cwd: marketplaceDirectory(),
      env: process.env,
    });

    child.on('error', (error) => {
      console.error(pc.red(`Failed to start Bun: ${error.message}`));
      process.exit(1);
    });

    child.on('close', (exitCode) => {
      process.exit(exitCode ?? 0);
    });
    return;
  }

  console.log(`Usage: engram sync <command>

Commands:
  status    Show sync state, queue counts, server connection
  retry     Reset all failed items to pending for retry
`);
}
