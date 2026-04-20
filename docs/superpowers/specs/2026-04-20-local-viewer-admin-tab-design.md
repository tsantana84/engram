# Local Viewer Admin Tab — Design Spec

**Date**: 2026-04-20  
**Status**: Approved  
**Scope**: Phase 1 of observability — local viewer only (Vercel dashboard is a separate future phase)

## Problem

Engram's local worker (port 37777) runs sync, learning extraction, and Chroma/Supabase interactions with no admin visibility. Errors are buried in log files. Sync queue failures are silent. Extraction state is opaque. An admin tab in the existing React viewer gives full local health in one place.

## Architecture

```
Local Viewer (React, port 37777)
  └── Admin tab (new)
        └── polls GET /api/admin every 10s
              └── AdminRoutes (registered late, in initializeBackground)
                    ├── SyncQueue.getStatus() + getFailedItems()  → queue depth, failed items
                    ├── SyncWorker.getExtractionStats()           → last run metadata
                    ├── HealthChecker (new)                       → uptime, Chroma ping, sync server ping
                    └── ErrorStore (new, in-memory)               → last 50 errors via Logger sink
```

### New backend pieces

| Piece | Location | Notes |
|---|---|---|
| `GET /api/admin` | `src/services/admin/AdminRoutes.ts` | Registered late inside `initializeBackground()` (CorpusRoutes pattern) |
| `SyncQueue.getFailedItems(limit)` | `src/services/sync/SyncQueue.ts` | New method; `getStatus()` already exists with different shape. Add `last_error` column to `sync_queue` schema |
| `SyncWorker.getExtractionStats()` | `src/services/sync/SyncWorker.ts` | SyncWorker has call context after each `extractSessionLearnings()` run — track stats there, not in LearningExtractor |
| `HealthChecker` | `src/services/admin/HealthChecker.ts` | Chroma: delegates to `ChromaMcpManager.isHealthy()`. Sync server: HTTP GET to `CLAUDE_MEM_SYNC_SERVER_URL/api/health`. Worker uptime via `process.uptime()` |
| `ErrorStore` | `src/services/admin/ErrorStore.ts` | In-memory ring buffer (cap 50). Wired via new `Logger.addSink(fn)` method |
| `Logger.addSink(fn)` | `src/utils/logger.ts` | Optional subscriber list; called on `warn`/`error` level writes |

### New frontend pieces

| Piece | Location | Notes |
|---|---|---|
| Tab infrastructure | `src/ui/viewer/App.tsx` | App.tsx has no tabs today — must build `activeTab` state + tab bar from scratch |
| `AdminTab.tsx` | `src/ui/viewer/components/AdminTab.tsx` | New component; existing content moves to `SessionsTab.tsx` |

## API Contract

`GET /api/admin` — no auth required (localhost only)

```json
{
  "syncQueue": {
    "pending": 4,
    "failed": 1,
    "lastFlushAt": "2026-04-20T20:10:00Z",
    "failedItems": [
      { "id": "abc", "type": "observation", "retries": 3, "lastError": "timeout" }
    ]
  },
  "extraction": {
    "enabled": true,
    "threshold": 0.9,
    "lastRunAt": "2026-04-20T19:55:00Z",
    "lastRunStats": {
      "observationsProcessed": 12,
      "extracted": 3,
      "skipped": 9,
      "failed": 0
    }
  },
  "health": {
    "uptimeSeconds": 3600,
    "chroma": "ok",
    "syncServer": "ok",
    "workerVersion": "12.1.0"
  },
  "errors": [
    { "ts": "2026-04-20T20:01:00Z", "level": "error", "msg": "Chroma connection lost", "ctx": "ChromaSync" }
  ],
  "fetchedAt": "2026-04-20T20:12:00Z"
}
```

**Field notes**:
- `failedItems` capped at 10. Requires new `last_error TEXT` column in `sync_queue` table (migration needed)
- `errors` ring buffer capped at 50, `warn`+`error` level only, in-memory (resets on worker restart)
- `chroma`: `"ok" | "error" | "unavailable"` — unavailable when `CLAUDE_MEM_CHROMA_ENABLED=false` or manager not initialized; delegates to `ChromaMcpManager.isHealthy()`
- `syncServer`: `"ok" | "error" | "unavailable"` — HTTP GET to `CLAUDE_MEM_SYNC_SERVER_URL/api/health`; unavailable when sync disabled. **Not a direct Supabase connection** — worker has no Supabase client
- `extraction`: `null` when sync is fully disabled (syncWorker not instantiated)
- Sections with fetch failures return `null`; partial data still returned from other sections

## UI Layout

New "Admin" tab alongside Sessions. Auto-polls every 10s. Visible "last updated X seconds ago" counter.

**Tab bar must be built** — App.tsx currently has no tab infrastructure.

```
┌─────────────────────────────────────────────────┐
│ Sessions | Admin                                 │
├─────────────────────────────────────────────────┤
│ SYSTEM HEALTH              last updated 3s ago  │
│ Worker 1h 2m up  Chroma ✓  Sync server ✓  v12.1 │
├─────────────────────────────────────────────────┤
│ SYNC QUEUE                                       │
│ 4 pending  1 failed  last flush 2 min ago        │
│ ▼ Failed items                                   │
│   abc123  observation  3 retries  "timeout"      │
├─────────────────────────────────────────────────┤
│ LEARNING EXTRACTION                              │
│ ● enabled  threshold 0.9  last run 17 min ago    │
│ 12 processed → 3 extracted, 9 skipped, 0 failed  │
├─────────────────────────────────────────────────┤
│ ERRORS (last 50)                                 │
│ 20:01 [error] ChromaSync  Chroma connection lost │
│ 19:44 [warn]  SyncWorker  retry limit reached    │
└─────────────────────────────────────────────────┘
```

- Health badges: green/red per status
- Failed items: collapsible
- Errors: scrollable, newest first
- `extraction` section hidden when null (sync disabled)

## Schema Change

New column on `sync_queue` table:

```sql
ALTER TABLE sync_queue ADD COLUMN last_error TEXT;
```

`SyncWorker` must write the error message to `last_error` when marking an item failed. Requires a migration version bump.

## Error Handling & Edge Cases

| Scenario | Behavior |
|---|---|
| Worker not running | Tab shows "Worker unavailable — retrying", poll continues |
| Chroma manager null | `chroma: "unavailable"` |
| Chroma ping throws | `chroma: "error"` |
| Sync disabled | `syncServer: "unavailable"`, `extraction: null` |
| Sync server HTTP ping fails | `syncServer: "error"` |
| ErrorStore on cold start | Empty (in-memory only). Pre-restart errors in log file |
| SyncQueue DB failure | `syncQueue: null`, UI shows "unavailable" for section |
| Extraction never run | `lastRunAt: null`, `lastRunStats: null`, UI shows "no runs yet" |
| Admin tab not active | Poll pauses (Visibility API), resumes on focus |

## Implementation Notes

- `AdminRoutes` must be registered inside `initializeBackground()`, not the constructor — follows `CorpusRoutes` precedent so service refs are available
- `Logger.addSink()` must be called before worker init completes, so ErrorStore captures early startup errors
- Tab infrastructure in App.tsx: add `activeTab: 'sessions' | 'admin'` state, render tab bar, move current content into `SessionsTab` component

## Out of Scope (Phase 1)

- Vercel dashboard observability (separate design)
- Controls in admin tab (toggle extraction, retry failed items) — read-only for now
- Persisting error history across worker restarts
- Prometheus/metrics export
