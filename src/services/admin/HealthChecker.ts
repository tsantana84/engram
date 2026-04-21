import { readFileSync } from 'fs';
import { join } from 'path';
import { fetchWithTimeout } from '../../shared/worker-utils.js';
import { MARKETPLACE_ROOT } from '../../shared/paths.js';

function readVersion(): string {
  try {
    return JSON.parse(readFileSync(join(MARKETPLACE_ROOT, 'package.json'), 'utf8')).version;
  } catch {
    return 'unknown';
  }
}
const _version = readVersion();

type HealthStatus = 'ok' | 'error' | 'unavailable';

interface HealthCheckerConfig {
  chromaManager: { isHealthy(): Promise<boolean> } | null;
  syncServerUrl: string | null;
}

export interface HealthResult {
  uptimeSeconds: number;
  chroma: HealthStatus;
  syncServer: HealthStatus;
  workerVersion: string;
}

export class HealthChecker {
  constructor(private config: HealthCheckerConfig) {}

  async check(): Promise<HealthResult> {
    return {
      uptimeSeconds: Math.floor(process.uptime()),
      chroma: await this.checkChroma(),
      syncServer: await this.checkSyncServer(),
      workerVersion: _version,
    };
  }

  private async checkChroma(): Promise<HealthStatus> {
    if (!this.config.chromaManager) return 'unavailable';
    try {
      const ok = await this.config.chromaManager.isHealthy();
      return ok ? 'ok' : 'error';
    } catch {
      return 'error';
    }
  }

  private async checkSyncServer(): Promise<HealthStatus> {
    if (!this.config.syncServerUrl) return 'unavailable';
    try {
      const res = await fetchWithTimeout(`${this.config.syncServerUrl}/api/health`, {}, 3000);
      return res.ok ? 'ok' : 'error';
    } catch {
      return 'error';
    }
  }
}
