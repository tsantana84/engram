# Vercel Dashboard Admin Page — Design Spec

**Date**: 2026-04-20  
**Status**: Approved  
**Scope**: Phase 1 of Vercel-side observability — agent activity, sync health, learning quality

## Problem

The existing Vercel dashboard (`/dashboard/`) is learning review only. There is no cross-agent visibility: which agents are active, whether their sync queues are healthy, or how well the learning extraction pipeline is performing. A separate `/dashboard/admin` page gives admin-level insight across all agents without touching the review workflow.

## Architecture

```
/dashboard/admin.html (new static page)
  └── admin.js (new, same pattern as app.js)
        └── on load + manual refresh: GET /api/admin/overview
              └── api/admin/overview.ts (new Vercel function)
                    └── SupabaseManager
                          ├── getAgentActivity()     → all agents, last seen, obs/session/learning counts
                          ├── getSyncHealth()        → per-agent queue pending/failed/last sync
                          └── getLearningQuality()   → approval ratios, confidence distribution
```

### New pieces

| Piece | Notes |
|---|---|
| `public/dashboard/admin.html` | Static page, same bearer token auth pattern as existing dashboard |
| `public/dashboard/admin.js` | Fetch + render; reuses `tryConnect()` / `showError()` pattern from `app.js` |
| `api/admin/overview.ts` | Single Vercel function; aggregates all 3 data groups; partial failure returns null sections |
| `SupabaseManager.getAgentActivity()` | Queries `agents` + `observations` + `sessions` + `learnings` |
| `SupabaseManager.getSyncHealth()` | Queries `sync_queue` grouped by agent |
| `SupabaseManager.getLearningQuality()` | Queries `learnings` grouped by status + confidence buckets |

Navigation: both `/dashboard/` and `/dashboard/admin` link to each other.

## API Contract

`GET /api/admin/overview` — bearer token auth (same agent key as dashboard)

```json
{
  "agents": [
    {
      "id": "agent-abc",
      "name": "thiago-macbook",
      "lastSeenAt": "2026-04-20T20:10:00Z",
      "observationCount": 1240,
      "sessionCount": 52,
      "learningCount": 18
    }
  ],
  "syncHealth": [
    {
      "agentId": "agent-abc",
      "queuePending": 2,
      "queueFailed": 0,
      "lastSyncAt": "2026-04-20T20:09:00Z"
    }
  ],
  "learningQuality": {
    "total": 85,
    "pending": 12,
    "approved": 61,
    "rejected": 12,
    "approvalRate": 0.84,
    "confidenceDistribution": {
      "high": 54,
      "medium": 21,
      "low": 10
    }
  },
  "fetchedAt": "2026-04-20T20:12:00Z"
}
```

**Field notes:**
- `confidenceDistribution`: high ≥ 0.9, medium 0.7–0.9, low < 0.7
- `approvalRate`: approved / (approved + rejected); excludes pending; null when no reviewed items
- `lastSeenAt`: max `created_at` across agent's observations
- Sections with query failures return `null`; partial data still returned

## UI Layout

`/dashboard/admin` — manual refresh button, "fetched X ago" timestamp.

```
┌─────────────────────────────────────────────────┐
│ Engram Admin        [← Review] [Refresh]        │
├─────────────────────────────────────────────────┤
│ LEARNING QUALITY             fetched 2 min ago  │
│ 85 total  61 approved  12 rejected  12 pending  │
│ Approval rate: 84%                               │
│ Confidence: ████ high(54)  ██ med(21)  █ low(10) │
├─────────────────────────────────────────────────┤
│ AGENTS                                           │
│ thiago-macbook   last seen 2m ago                │
│   1,240 obs  52 sessions  18 learnings           │
│ thiago-work      last seen 3h ago                │
│   890 obs   41 sessions  12 learnings            │
├─────────────────────────────────────────────────┤
│ SYNC HEALTH                                      │
│ thiago-macbook   ✓ synced  2 pending  0 failed   │
│ thiago-work      ✓ synced  0 pending  0 failed   │
└─────────────────────────────────────────────────┘
```

- Agent "last seen" badge: green <1h, yellow 1–24h, red >24h
- Red badge on agent sync row if `queueFailed > 0`
- Sync Health section hidden when all agents have 0 pending + 0 failed
- `approvalRate` shows "—" when no reviewed items yet

## Error Handling & Edge Cases

| Scenario | Behavior |
|---|---|
| Token missing/invalid | Inline token form via `tryConnect()` (same as existing dashboard) |
| Supabase query fails | Affected section returns `null`, UI shows "unavailable" for that section |
| Agent has no observations | Listed with counts = 0 |
| No agents registered | "No agents found" empty state |
| `approvalRate` with 0 reviewed | Shows "—" not 0% |
| Fetch in flight | Refresh button disabled + spinner, prevents double-fetch |

## Out of Scope (Phase 1)

- Real-time / auto-poll (manual refresh only)
- Per-agent drilldown pages
- Historical trends / time-series charts
- Controls (delete agent, force sync, etc.) — read-only
