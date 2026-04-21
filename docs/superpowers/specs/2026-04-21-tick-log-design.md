# Tick Log — Design Spec

## Goal

Show detailed per-tick sync activity in a local brutalist UI at `localhost:37777/ticks`. Zero Vercel involvement. Pure HTML/CSS/JS, same design language as the learnings approval page.

## Architecture

### 1. `tick_log` SQLite table (local DB) — migration 33

Added to `SessionStore` via migration version 33. Written by `SyncWorker` after each tick, including IDLE ticks.

```sql
CREATE TABLE IF NOT EXISTS tick_log (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  ticked_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  agent_name         TEXT    NOT NULL DEFAULT '',
  duration_ms        INTEGER NOT NULL,
  sessions_extracted INTEGER NOT NULL DEFAULT 0,
  learnings_enqueued INTEGER NOT NULL DEFAULT 0,
  items_pushed       INTEGER NOT NULL DEFAULT 0,
  items_failed       INTEGER NOT NULL DEFAULT 0,
  queue_depth_after  INTEGER NOT NULL DEFAULT 0,
  errors             TEXT    -- JSON array of error strings, null if none
);
```

**`sessions_extracted`**: count of sessions for which `extractSessionLearnings()` completed without throwing (success or no learnings found both count — it means the session was processed).

Retention: on every insert, delete rows where `id < (SELECT MAX(id) - 999 FROM tick_log)`. Keeps last 1000 rows.

### 2. `SyncWorker` — tick instrumentation

`tick()` currently has an early return when the queue is empty:

```ts
const pending = this.queue.getPending(this.batchSize);
if (pending.length === 0) return;  // ← must be removed
```

This must be removed. The full tick body (extraction loop + push loops) is wrapped in `try/finally` so IDLE ticks are always recorded.

```ts
async tick(): Promise<void> {
  if (!this.enabled || this.paused) return;
  const startMs = Date.now();
  const record: TickRecord = {
    agent_name: this.agentName,
    duration_ms: 0,
    sessions_extracted: 0,
    learnings_enqueued: 0,
    items_pushed: 0,
    items_failed: 0,
    queue_depth_after: 0,
    errors: [],
  };
  try {
    // 1. Extract
    if (this.extractionEnabled && this.extractor) {
      const sessions = this.sessionStore.getPendingExtractionSessions(5);
      for (const s of sessions) {
        try {
          await this.extractSessionLearnings(s.id);
          record.sessions_extracted++;
        } catch { /* error already handled inside */ }
      }
    }
    // 2. Drain queue
    const pending = this.queue.getPending(this.batchSize);
    // ... existing push logic, increment record.items_pushed / items_failed / errors
    record.queue_depth_after = this.queue.countPending();
  } finally {
    record.duration_ms = Date.now() - startMs;
    this.sessionStore.insertTickLog(record);
  }
}
```

`TickRecord` interface:

```ts
interface TickRecord {
  agent_name: string;
  duration_ms: number;
  sessions_extracted: number;
  learnings_enqueued: number;  // net new rows enqueued this tick
  items_pushed: number;
  items_failed: number;
  queue_depth_after: number;
  errors: string[];
}
```

**`this.agentName`**: Add `private agentName: string` to `SyncWorker` and set `this.agentName = config.agentName` in the constructor. Add to Files Changed table.

**`learnings_enqueued`**: Change `extractSessionLearnings()` signature from `Promise<void>` to `Promise<number>` — returns count of learnings enqueued this call. Accumulate in the extraction loop: `record.learnings_enqueued += await this.extractSessionLearnings(s.id)`.

```ts
// Updated pseudocode (extraction loop):
for (const s of sessions) {
  try {
    const enqueued = await this.extractSessionLearnings(s.id);
    record.sessions_extracted++;
    record.learnings_enqueued += enqueued;
  } catch { /* already handled inside */ }
}
```

### 3. `SyncQueue` — new `countPending()` method

```ts
countPending(): number {
  const row = this.db.prepare(
    `SELECT COUNT(*) as n FROM sync_queue WHERE status = 'pending'`
  ).get() as { n: number };
  return row.n;
}
```

### 4. `GET /api/ticks` endpoint

New route in `ViewerRoutes`. Returns last N ticks ordered by `ticked_at DESC`.

```
GET /api/ticks?limit=100
→ { ticks: TickRow[], fetchedAt: string }
```

`TickRow` is the raw DB row with `ticked_at` as Unix epoch integer.

No auth required (local-only, same as all localhost:37777 routes).

### 5. `/ticks` HTML page

New route returns `plugin/ui/ticks.html`.
Installed path: `~/.claude/plugins/marketplaces/thedotmack/ui/ticks.html`.

Self-contained HTML with inline `<style>` matching `public/dashboard/styles.css` design tokens exactly:

- `--black #000`, `--white #fff`, `--yellow #f5e400`, `--red #ff2400`, `--green #00b300`
- `'Courier New'` monospace body, `'Arial Black'` for headers/badges
- `3px solid #000` borders, uppercase labels

**UI layout:**

```
┌─────────────────────────────────────┐
│ ⬡ ENGRAM / TICKS          ↻ Refresh │  black header
├──────────────────────────────────────┤
│ [All] [thiago] [macbook-work] ...   │  agent filter (client-side, from tick data)
├──────────────────────────────────────┤
│ TIME      STATUS   DUR   EXT PUSHED FAILED QUEUE │
├──────────────────────────────────────┤
│ 21:42:20  ■ OK     142ms  2    7     0      0    │  green left border
│ 21:41:20  ■ IDLE   3ms    0    0     0      0    │
│ 21:40:20  ■ PARTIAL 2.3s  1    4     2      2    │  yellow left border
│   ✗ learning #382: pushLearnings failed (500)    │  inline error row
│ 21:39:20  ■ FAIL   5s     0    0     5    182    │  red left border
│   ✗ RLS policy violation (5 items)               │
└──────────────────────────────────────┘
```

**Row status rules:**
- `IDLE` — `items_pushed === 0 && items_failed === 0 && sessions_extracted === 0`
- `OK` — `items_failed === 0 && (items_pushed > 0 || sessions_extracted > 0)`
- `PARTIAL` — `items_failed > 0 && items_pushed > 0`
- `FAIL` — `items_failed > 0 && items_pushed === 0`

Error rows render inline below the tick row (always visible, no click needed).

Auto-refresh: fetches `/api/ticks` every 60 seconds. Manual refresh button in header.

## Files Changed

| File | Change |
|------|--------|
| `src/services/sqlite/SessionStore.ts` | Migration 33 + `insertTickLog(record)` + `getTickLog(limit)` |
| `src/services/sync/SyncQueue.ts` | Add `countPending(): number` |
| `src/services/sync/SyncWorker.ts` | Add `private agentName: string`, remove early-return, wrap tick in try/finally, change `extractSessionLearnings` to return `Promise<number>`, collect TickRecord |
| `src/services/worker/http/routes/ViewerRoutes.ts` | Add `GET /api/ticks` + `GET /ticks` |
| `plugin/ui/ticks.html` | New static brutalist page (inline CSS/JS, no build step) |

## Out of Scope

- No Supabase storage
- No Vercel admin changes
- No server-side agent filtering (client-side only)
- No pagination (DB keeps last 1000, UI shows last 100)
