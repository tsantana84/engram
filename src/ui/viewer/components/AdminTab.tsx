import { useEffect, useRef, useState } from 'react';

interface SyncQueueData {
  pending: number;
  failed: number;
  lastFlushAt: string | null;
  failedItems: Array<{ id: number; type: string; retries: number; lastError: string | null }>;
}

interface ExtractionData {
  enabled: boolean;
  threshold: number;
  lastRunAt: string | null;
  lastRunStats: { observationsProcessed: number; extracted: number; skipped: number; failed: number } | null;
}

interface HealthData {
  uptimeSeconds: number;
  chroma: string;
  syncServer: string;
  workerVersion: string;
}

interface AdminData {
  syncQueue: SyncQueueData | null;
  extraction: ExtractionData | null;
  health: HealthData | null;
  errors: Array<{ ts: string; level: string; ctx: string; msg: string }>;
  fetchedAt: string;
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m up` : `${m}m up`;
}

function formatRelative(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function StatusBadge({ status, label }: { status: string; label: string }) {
  const color = status === 'ok' ? 'green' : status === 'error' ? 'red' : 'gray';
  return (
    <span className={`admin-badge admin-badge--${color}`}>
      {label} {status === 'ok' ? '✓' : status === 'unavailable' ? '—' : '✗'}
    </span>
  );
}

export function AdminTab() {
  const [data, setData] = useState<AdminData | null>(null);
  const [workerDown, setWorkerDown] = useState(false);
  const [secondsAgo, setSecondsAgo] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();
  const tickerRef = useRef<ReturnType<typeof setInterval>>();

  const fetchData = async () => {
    try {
      const res = await fetch('/api/admin');
      if (res.ok) {
        setData(await res.json());
        setSecondsAgo(0);
        setWorkerDown(false);
      } else {
        setWorkerDown(true);
      }
    } catch {
      setWorkerDown(true);
    }
  };

  useEffect(() => {
    fetchData();

    intervalRef.current = setInterval(() => {
      if (!document.hidden) fetchData();
    }, 10_000);

    tickerRef.current = setInterval(() => setSecondsAgo(s => s + 1), 1000);

    return () => {
      clearInterval(intervalRef.current);
      clearInterval(tickerRef.current);
    };
  }, []);

  if (workerDown) {
    return <div className="admin-status">Worker unavailable — retrying</div>;
  }

  if (!data) {
    return <div className="admin-status">Loading admin data…</div>;
  }

  return (
    <div className="admin-tab">
      <div className="admin-header">
        <span className="admin-fetched">last updated {secondsAgo}s ago</span>
      </div>

      {/* System Health */}
      <section className="admin-section">
        <h3>System Health</h3>
        {data.health ? (
          <div className="admin-health">
            <span>{formatUptime(data.health.uptimeSeconds)}</span>
            <StatusBadge status={data.health.chroma} label="Chroma" />
            <StatusBadge status={data.health.syncServer} label="Sync server" />
            <span>v{data.health.workerVersion}</span>
          </div>
        ) : (
          <p className="admin-unavailable">unavailable</p>
        )}
      </section>

      {/* Sync Queue */}
      <section className="admin-section">
        <h3>Sync Queue</h3>
        {data.syncQueue ? (
          <>
            <p>{data.syncQueue.pending} pending · {data.syncQueue.failed} failed</p>
            {data.syncQueue.failedItems.length > 0 && (
              <details>
                <summary>Failed items ({data.syncQueue.failedItems.length})</summary>
                <ul className="admin-failed-items">
                  {data.syncQueue.failedItems.map(item => (
                    <li key={item.id}>{item.type} · {item.retries} retries · {item.lastError ?? 'unknown'}</li>
                  ))}
                </ul>
              </details>
            )}
          </>
        ) : (
          <p className="admin-unavailable">unavailable</p>
        )}
      </section>

      {/* Learning Extraction — only when extraction is configured */}
      {data.extraction && (
        <section className="admin-section">
          <h3>Learning Extraction</h3>
          <p>
            <span className={`admin-status-dot admin-status-dot--${data.extraction.enabled ? 'green' : 'red'}`} />
            {data.extraction.enabled ? 'enabled' : 'disabled'} · threshold {data.extraction.threshold}
            {data.extraction.lastRunAt && ` · last run ${formatRelative(data.extraction.lastRunAt)}`}
          </p>
          {data.extraction.lastRunStats ? (
            <p className="admin-extraction-stats">
              {data.extraction.lastRunStats.observationsProcessed} processed →{' '}
              {data.extraction.lastRunStats.extracted} extracted,{' '}
              {data.extraction.lastRunStats.skipped} skipped,{' '}
              {data.extraction.lastRunStats.failed} failed
            </p>
          ) : (
            <p className="admin-muted">no runs yet</p>
          )}
        </section>
      )}

      {/* Errors */}
      <section className="admin-section">
        <h3>Errors</h3>
        {data.errors.length === 0 ? (
          <p className="admin-muted">no errors</p>
        ) : (
          <ul className="admin-errors">
            {data.errors.map((e, i) => (
              <li key={i} className="admin-error-entry">
                <span className="admin-error-time">{formatTime(e.ts)}</span>
                <span className={`admin-error-level admin-error-level--${e.level}`}>[{e.level}]</span>
                <span className="admin-error-ctx">{e.ctx}</span>
                <span className="admin-error-msg">{e.msg}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
