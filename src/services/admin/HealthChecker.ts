import pkg from '../../../package.json' with { type: 'json' };

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
      workerVersion: pkg.version,
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
      const res = await fetch(`${this.config.syncServerUrl}/api/health`, { signal: AbortSignal.timeout(3000) });
      return res.ok ? 'ok' : 'error';
    } catch {
      return 'error';
    }
  }
}
