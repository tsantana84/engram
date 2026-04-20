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
              └── AdminController (worker-service.ts)
                    ├── SyncQueue.getStatus()         → queue depth, failed items, last flush
                    ├── LearningExtractor.getStatus() → enabled, threshold, last run stats
                    ├── HealthChecker (new)            → uptime, Chroma ping, Supabase ping
                    └── ErrorStore (new, in-memory)    → last 50 errors from worker logger
```

### New backend pieces

| Piece | Location | Notes |
|---|---|---|
| `GET /api/admin` | `worker-service.ts` or new `AdminRoutes.ts` | Aggregates all 4 groups |
| `SyncQueue.getStatus()` | `src/services/sync/SyncQueue.ts` | Read method on existing queue |
| `LearningExtractor.getStatus()` | `src/services/sync/LearningExtractor.ts` | Expose last run metadata |
| `HealthChecker` | `src/services/admin/HealthChecker.ts` | Pings Chroma + Supabase, reads uptime |
| `ErrorStore` | `src/services/admin/ErrorStore.ts` | In-memory ring buffer, wired into logger |

### New frontend pieces

| Piece | Location |
|---|---|
| `AdminTab.tsx` | `src/ui/viewer/components/AdminTab.tsx` |
| Tab entry in `App.tsx` | Alongside Sessions, Search tabs |

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
    "supabase": "ok",
    "workerVersion": "12.1.0"
  },
  "errors": [
    { "ts": "2026-04-20T20:01:00Z", "level": "error", "msg": "Chroma connection lost", "ctx": "ChromaSync" }
  ],
  "fetchedAt": "2026-04-20T20:12:00Z"
}
```

**Constraints**:
- `failedItems` capped at 10
- `errors` ring buffer capped at 50, `warn`+`error` level only
- `chroma` / `supabase` values: `"ok" | "error" | "unavailable"`
- Sections with fetch failures return `null` (partial data still returned)

## UI Layout

New "Admin" tab alongside existing tabs. Auto-polls every 10s. Visible "last updated X seconds ago" counter.

```
┌─────────────────────────────────────────────────┐
│ Sessions | Search | Admin                        │
├─────────────────────────────────────────────────┤
│ SYSTEM HEALTH              last updated 3s ago  │
│ Worker 1h 2m up  Chroma ✓  Supabase ✓  v12.1.0  │
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

## Error Handling & Edge Cases

| Scenario | Behavior |
|---|---|
| Worker not running | Tab shows "Worker unavailable — retrying", poll continues |
| Chroma/Supabase ping fails | Red badge + error message, endpoint still returns partial data |
| ErrorStore on cold start | Empty (in-memory only, not persisted). Pre-restart errors in log file |
| SyncQueue DB failure | `syncQueue: null`, UI shows "unavailable" for that section |
| Extraction never run | `lastRunAt: null`, `lastRunStats: null`, UI shows "no runs yet" |
| Admin tab not active | Poll pauses (Visibility API), resumes on tab focus |

## Out of Scope (Phase 1)

- Vercel dashboard observability (separate design)
- Controls in admin tab (toggle extraction, retry failed items) — read-only for now
- Persisting error history across worker restarts
- Prometheus/metrics export
