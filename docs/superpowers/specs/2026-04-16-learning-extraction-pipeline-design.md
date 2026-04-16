# Learning Extraction Pipeline — Design Spec

**Date:** 2026-04-16
**Status:** Draft (pending implementation)
**Owner:** Thiago Santana

## Problem

Current engram sync pipeline pushes every local observation to the shared Supabase backend. This pollutes the team brain with low-signal noise: raw tool-use events, transient debugging steps, and narrow single-agent context that other agents cannot act on.

The team brain should instead carry **durable, generalizable learnings** — distilled facts that help any agent or engineer reason about the system. Raw session activity stays local.

## Goals

- Replace per-observation sync with a session-level LLM extraction step that emits structured learnings with a confidence score.
- Auto-push high-confidence learnings to the canonical team corpus.
- Quarantine low-confidence learnings into a human-review queue surfaced via a shared web dashboard.
- Preserve the existing ConflictDetector dedupe behavior, applied only at the canonical-insertion boundary.
- Ship as a POC simple enough that the company infra team can later absorb or replace it.

## Non-Goals

- Human identity / SSO auth on the dashboard (POC reuses agent bearer keys).
- Learning-level edit history / audit log beyond a single `edit_diff` column.
- Replacing the existing summary sync path.
- Bulk review workflows, assignment, notifications, or RBAC.
- Syncing raw observations or sessions to the server.

## Architecture Overview

```
Session ends
  │
  ├─ SessionEnd hook marks sessions.extraction_status = 'pending' (eager)
  └─ Worker sweep picks up any missed sessions (recovery)
        │
        ▼
LearningExtractor (LLM)
        │ reads: session observations + summary
        │ emits: Learning[] { claim, evidence, scope, confidence }
        ▼
Confidence split (threshold default 0.8)
  │
  ├─ conf ≥ 0.8 ──▶ SyncQueue (entity_type=learning, target=approved)
  │                   │
  │                   ▼
  │            POST /api/sync/learnings
  │                   │
  │                   ▼
  │            Server ConflictDetector
  │                   │ (ADD / UPDATE / INVALIDATE / NOOP)
  │                   ▼
  │            Insert learnings (status=approved)
  │
  └─ conf < 0.8 ──▶ SyncQueue (entity_type=learning, target=pending)
                       │
                       ▼
                POST /api/sync/learnings
                       │
                       ▼
                Insert learnings (status=pending, no detector)
                       │
                       ▼
                Web dashboard (Vercel)
                       │
                       ▼
              Engineer: approve / reject / edit
                       │
                       ▼
        Approve → ConflictDetector → status=approved
        Reject  → status=rejected
        Edit    → edit_diff persisted, then approve path
```

Raw observations and session rows stay **local only**. Server persists: `learnings`, `summaries`, plus existing `agents` and sync metadata.

## Decisions

| Area | Decision | Rationale |
|---|---|---|
| Granularity | Session-end aggregate extraction | Fewer items, higher signal, delayed but durable. |
| Learning shape | Structured `{claim, evidence, scope, confidence}` | Dedupable, testable, fits existing ConflictDetector. |
| Dashboard location | Server-side shared (Vercel + Supabase) | Learnings are team knowledge; local-only review fragments attention. |
| Confidence scale | Float 0.0–1.0, threshold tunable (default 0.8) | Continuous, lets threshold be dialed with data. |
| What syncs | Learnings + summaries only | Stated goal: don't pollute brain. Observations + sessions stay local. |
| Trigger | SessionEnd hook + periodic worker sweep | Eager + self-healing. |
| Review actions | Approve / Reject / Edit | Edit handles "mostly right" LLM output without a merge feature. |
| Storage model | Single `learnings` table with `status` column | Simpler than two tables; search filters by status. |
| Detector placement | Only on approval paths | Low-conf pending stays raw; detector only mutates canonical. |
| LLM provider | Reuse injectable `llm: (prompt) => Promise<string>` abstraction | Same pattern as ConflictDetector. Testable. |
| Auth | Agent bearer keys (POC) | Will move to company infra when POC graduates. |

## Components

### 1. `LearningExtractor` — new

Location: `src/services/sync/LearningExtractor.ts`

```ts
export interface ExtractedLearning {
  claim: string;
  evidence: string | null;
  scope: string | null;
  confidence: number;
}

export interface LearningExtractorConfig {
  enabled: boolean;
  llm: (prompt: string) => Promise<string>;
  maxLearningsPerSession?: number;  // default 10
}

export interface SessionInput {
  sessionId: string;
  project: string;
  observations: Array<{ title: string; narrative: string | null; facts: string[] }>;
  summary: { request: string; investigated: string; learned: string; next_steps: string } | null;
}

export class LearningExtractor {
  constructor(config: LearningExtractorConfig);
  async extract(session: SessionInput): Promise<ExtractedLearning[]>;
}
```

- Prompt instructs model to emit a JSON array of 0–N learnings.
- Parses first JSON array from response (tolerant of surrounding prose).
- Returns `[]` on any failure (malformed JSON, LLM error, disabled).

### 2. `SyncWorker` — modified

- Drops per-observation push branch from `buildPayload`.
- Adds `extractSessionLearnings(sessionId)`:
  1. Loads session + observations + summary from local DB.
  2. Marks `sessions.extraction_status = 'in_progress'`.
  3. Calls `LearningExtractor.extract()`.
  4. For each learning: computes `content_hash = sha256(claim + (scope ?? ''))`, enqueues with `entity_type='learning'` and `target_status` set from threshold split.
  5. Marks `sessions.extraction_status = 'done'` on success, `'failed'` on throw (up to N retries).
- `tick()` now:
  - Picks sessions where `extraction_status IN ('pending', 'failed')` (bounded retries).
  - After extraction, drains sync queue (learning entries → push).
- Summaries sync path unchanged.

### 3. `SessionEnd` hook

- Sets `sessions.extraction_status = 'pending'` for the closing session.
- Does not block shutdown.
- Worker sweep is the recovery mechanism if the hook is lost.

### 4. Server — new table + API

Table: `learnings` (schema in Data Model section).

New endpoints:

- `POST /api/sync/learnings` — authenticated (agent key). Accepts `{ learnings: LearningPayload[], target_status: 'approved' | 'pending' }`. If `approved`, runs ConflictDetector per row. Returns per-row result.
- `GET /api/learnings?status=pending&project=<p>&limit=&offset=` — dashboard list.
- `GET /api/learnings/:id` — detail view.
- `POST /api/learnings/:id/review` — body: `{ action: 'approve' | 'reject' | 'edit_approve', edited?: Partial<LearningPayload>, rejection_reason?: string }`. `approve` / `edit_approve` runs ConflictDetector and promotes to `approved`.

### 5. Dashboard — minimal web UI

Location: `web/dashboard/` (new), served by Vercel as static + API.

Views:
- **Pending queue** — table of `status='pending'` learnings. Columns: project, confidence, claim, scope, source_agent, extracted_at.
- **Detail / edit** — inline editable fields + evidence expansion + approve/reject/edit-approve buttons.

Auth:
- Bearer token in `Authorization` header. POC reuses an agent key. Humans paste the key once; browser stores it in `localStorage`.
- No user identity tracked — `reviewed_by` records the agent key id.

### 6. Settings additions

In `~/.claude-mem/settings.json`:

```json
{
  "CLAUDE_MEM_LEARNING_EXTRACTION_ENABLED": true,
  "CLAUDE_MEM_LEARNING_CONFIDENCE_THRESHOLD": 0.8,
  "CLAUDE_MEM_LEARNING_LLM_MODEL": "claude-sonnet-4-6",
  "CLAUDE_MEM_LEARNING_MAX_PER_SESSION": 10
}
```

When `CLAUDE_MEM_LEARNING_EXTRACTION_ENABLED = false`, pipeline falls back to legacy observation sync (for emergency rollback during POC).

## Data Model

### Server — Supabase

```sql
CREATE TABLE learnings (
  id               bigserial PRIMARY KEY,
  claim            text NOT NULL,
  evidence         text,
  scope            text,                                   -- 'project' | 'area' | 'global' (free-form)
  confidence       real NOT NULL,                          -- 0.0–1.0
  status           text NOT NULL DEFAULT 'pending',        -- 'pending' | 'approved' | 'rejected'
  project          text,
  source_agent_id  uuid REFERENCES agents(id),
  source_session   text,                                   -- local session id (opaque string)
  content_hash     text NOT NULL,
  invalidated      boolean NOT NULL DEFAULT false,
  invalidated_by   bigint REFERENCES learnings(id),
  extracted_at     timestamptz NOT NULL DEFAULT now(),
  reviewed_at      timestamptz,
  reviewed_by      text,                                   -- POC: agent key id; later: user id
  edit_diff        jsonb,                                  -- original vs edited snapshot
  rejection_reason text,

  UNIQUE (source_session, content_hash)                    -- idempotency under race
);

CREATE INDEX idx_learnings_status   ON learnings (status);
CREATE INDEX idx_learnings_project  ON learnings (project);
CREATE INDEX idx_learnings_hash     ON learnings (content_hash);
CREATE INDEX idx_learnings_agent    ON learnings (source_agent_id);
```

Team search filters `WHERE status = 'approved' AND invalidated = false`.

### Local SQLite

```sql
ALTER TABLE sessions ADD COLUMN extraction_status TEXT NOT NULL DEFAULT 'pending';
-- values: 'pending' | 'in_progress' | 'done' | 'failed' | 'permanently_failed'
ALTER TABLE sessions ADD COLUMN extraction_attempts INTEGER NOT NULL DEFAULT 0;
```

`sync_queue.entity_type` gains `'learning'`. No new local table.

### Payload types

```ts
interface LearningPayload {
  claim: string;
  evidence: string | null;
  scope: string | null;
  confidence: number;       // 0.0–1.0
  project: string;
  source_session: string;
  content_hash: string;
}

interface LearningPushRequest {
  learnings: LearningPayload[];
  target_status: 'approved' | 'pending';
}

interface LearningPushResponse {
  results: Array<{ content_hash: string; id?: number; action: 'inserted' | 'dedupe_noop' | 'invalidated_target' | 'updated_target'; error?: string }>;
}
```

## Data Flow

### Happy path — high confidence
1. Session closes. Hook sets `extraction_status = 'pending'`.
2. Worker tick picks session, runs `LearningExtractor`.
3. Learnings with `confidence >= threshold` queued as `(entity_type='learning', target_status='approved')`.
4. Worker pushes batch to `POST /api/sync/learnings`.
5. Server runs ConflictDetector per learning; inserts as `approved` (or applies UPDATE/INVALIDATE/NOOP).
6. `extraction_status = 'done'`.

### Happy path — low confidence
1–4. Same, but `target_status='pending'`.
5. Server inserts as `pending` directly; detector **not** invoked.
6. Engineer opens dashboard, reviews, edits (optional), approves.
7. Approve endpoint runs detector and promotes to `approved`.

### Reject
- Engineer rejects with reason. `status = 'rejected'`, `rejection_reason` set. Row retained for audit.

### Error handling

| Failure | Handling |
|---|---|
| Extractor LLM throws / returns malformed JSON | Log; bump `extraction_attempts`; set `extraction_status='failed'`. Sweep retries up to 3 times; then `'permanently_failed'`. Raw obs remain local — no data loss. |
| Extractor emits 0 learnings | Normal. `extraction_status='done'`. |
| `/api/sync/learnings` returns 4xx | `markFailedPermanently`. Session stuck at `failed`; manual inspection. |
| `/api/sync/learnings` returns 5xx / network | `markFailed`, retry next tick. |
| Server ConflictDetector fails on approval | Default to ADD (existing behavior). Still insert as approved. Log error. |
| Dashboard approve → detector fails | Return 500 to client, row stays `pending`, engineer retries. |
| Two agents extract overlapping content | `UNIQUE (source_session, content_hash)` — second insert becomes `dedupe_noop`. |
| Settings flip to disabled mid-session | In-flight extraction completes; subsequent sessions fall back to legacy observation sync. |

### Idempotency

`content_hash = sha256(claim + '\n' + (scope ?? ''))`.
Same `(source_session, content_hash)` → unique constraint blocks duplicate insert, server returns `dedupe_noop`.

## Testing

### Unit

- `LearningExtractor.extract()`
  - Parses valid JSON array output.
  - Returns `[]` on malformed JSON, thrown LLM, or disabled config.
  - Empty session input → `[]`.
  - Honors `maxLearningsPerSession` cap.
- `SyncWorker` threshold split: mock extractor + client, assert high-conf rows enqueued with `target_status='approved'`, low-conf with `'pending'`.
- `SyncWorker.tick()`: extractor throws → `extraction_status='failed'`, `extraction_attempts` incremented; after 3 retries → `'permanently_failed'`.
- Content hash idempotency: re-enqueue same `(session_id, content_hash)` is a no-op.

### Integration — server

- `POST /api/sync/learnings` with `target_status='approved'` batch → rows inserted with `status='approved'`, ConflictDetector invoked per row.
- `POST /api/sync/learnings` with `target_status='pending'` batch → rows inserted with `status='pending'`, detector **not** invoked.
- `GET /api/learnings?status=pending` — filtering by project, pagination.
- `POST /api/learnings/:id/review` with `action='approve'` → detector runs, status flips, `reviewed_at`/`reviewed_by` populated.
- `action='edit_approve'` → `edit_diff` persisted; final content matches edited version.
- `action='reject'` → `status='rejected'`, row retained, `rejection_reason` stored.
- Unique constraint: duplicate `(source_session, content_hash)` returns `dedupe_noop`.

### End-to-end (manual POC verification)

- Run a full session in dev with extraction enabled; confirm pending learnings appear in dashboard.
- Approve one; confirm team search returns it from another agent.
- Reject one; confirm it's hidden from team search but still queryable with `status='rejected'`.
- Disable extraction via settings; confirm legacy observation sync resumes.
- Concurrent extraction from two agents on overlapping content → no duplicate rows, second becomes `dedupe_noop`.

### Out of scope for tests

- LLM prompt quality (evaluated manually while tuning).
- Dashboard UI styling / visual regression (POC).
- Load testing the dashboard (POC volumes are small).

## Open Items

- Prompt text for `LearningExtractor` — will be iterated during implementation against real session data.
- Exact scope taxonomy — kept free-form for POC; may formalize after reviewing real learnings.
- Migration of already-synced observations — **not migrating**. POC starts fresh; legacy observations remain searchable via existing path until cutover.

## Rollback Plan

- Single feature flag: `CLAUDE_MEM_LEARNING_EXTRACTION_ENABLED = false`.
- When disabled: worker resumes pushing observations via legacy path.
- Supabase `learnings` table is additive; no destructive migrations.
- Dashboard is isolated to new routes; can be taken offline without affecting sync.
