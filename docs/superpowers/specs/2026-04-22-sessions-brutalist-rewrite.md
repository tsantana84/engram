# Sessions Page Brutalist Rewrite

**Date**: 2026-04-22
**Status**: Approved
**Scope**: Local worker UI + Vercel dashboard pages

## Goal

Replace the React SPA sessions viewer with a static HTML + vanilla JS page matching the brutalist design system already applied to `ticks.html` and `admin.html`. Also apply same brutalist CSS to Vercel dashboard pages.

## Pages in Scope

| Page | File | Route | Status |
|------|------|--------|--------|
| Sessions | `plugin/ui/sessions.html` (new) | `GET /` | rewrite |
| Ticks | `plugin/ui/ticks.html` | `GET /ticks` | ✅ done |
| Admin | `plugin/ui/admin.html` | `GET /admin` | ✅ done |
| Vercel Learnings | `public/dashboard/index.html` | `/dashboard/` | restyle |
| Vercel Admin | `public/dashboard/admin/index.html` | `/dashboard/admin/` | restyle |

## Design System

Inherits from `ticks.html` / `admin.html`:

```css
--black: #000;
--white: #fff;
--yellow: #f5e400;
--red: #ff2400;
--green: #00b300;
--dim: #666;
--bg: #f4f4f4;
--border: 3px solid #000;
font-family: 'Courier New', Courier, monospace;
```

Global nav: sticky black header, `⬡ ENGRAM WORKER` brand, nav links (Sessions | Admin | Ticks), worker status badge.

## Sessions Page Architecture

### File
`plugin/ui/sessions.html` — single self-contained file, no build step. Served by `ViewerRoutes.ts` at `GET /` (replaces `viewer.html`).

### Data Layer (vanilla JS)

| Source | Endpoint | Usage |
|--------|----------|-------|
| Live stream | `GET /stream` (SSE) | Prepend new items to feed |
| Observations | `GET /api/observations?offset=&limit=&project=&platformSource=` | Paginated load |
| Summaries | `GET /api/summaries?offset=&limit=&project=&platformSource=` | Paginated load |
| Prompts | `GET /api/prompts?offset=&limit=&project=&platformSource=` | Paginated load |
| Projects | `GET /api/projects` | Populate filter dropdown |

### SSE Event Handling

Connect to `/stream` on page load. Handle:
- `initial_load` → **overwrite** (not append) project/source filter options. Server broadcasts this to ALL connected clients, not just the new connection — so duplicate `initial_load` events are normal and must be idempotent.
- `new_observation` → prepend observation card to feed
- `new_summary` → prepend summary card to feed
- `new_prompt` → prepend prompt card to feed
- `processing_status` → update processing indicator in nav
- Unknown event types (`session_started`, `observation_queued`, `session_completed`) → ignore silently

On disconnect: display reconnecting indicator, retry with exponential backoff (1s → 2s → 4s → max 30s). Items created during disconnect gap will not backfill — user must refresh for complete history. If server returns 503 on connect (worker still initializing), treat as disconnect and retry.

### Feed

Mixed timeline sorted by `created_at_epoch` desc. Observations, summaries, and prompts interleaved. Initial load fetches page 1 of each (limit=50). "LOAD MORE" button at bottom triggers next page fetch for all three, merges and re-sorts.

State tracked per type: `{ offset, hasMore }`.

**Note**: Pagination is independent per type (observations/summaries/prompts each have their own offset). This means the merged timeline is approximately sorted but not globally correct at page boundaries — items from different types may appear slightly out of order across page loads. This is an acceptable trade-off for implementation simplicity.

**Filter changes**: Use `AbortController` to cancel any in-flight fetch requests before issuing new ones. Without this, a slow response from a previous filter state can arrive after the new filter's results and corrupt the feed.

### Cards

**Observation card**:
```
┌─ border-left 4px (color by type) ──────────────┐
│ [TYPE] [SOURCE] [PROJECT]        [FACTS] [NAR]  │
│ TITLE                                           │
│ subtitle text...                                │
│─────────────────────────────────────────────── │
│ #123 • Apr 22 2026 3:14pm                      │
└────────────────────────────────────────────────┘
```

Border-left color by `type`:
- `discovery` → `--yellow`
- `bugfix` → `--red`
- `feature` → `--green`
- default → `#333`

Type/source/project: uppercase monospace badges with `3px solid #000` borders.

Facts toggle: only render if `facts` parses to a non-empty array OR concepts/files_read/files_modified are non-empty. Shows `facts[]` list + concepts + files_read + files_modified.
Narrative toggle: only render if `narrative` is non-null and non-empty string. Shows narrative text. Mutually exclusive with facts — activating one deactivates the other.

**Summary card**:
```
┌─ border-left 4px green ────────────────────────┐
│ SUMMARY  [PROJECT]                  date        │
│ ▸ REQUEST: ...                                  │
│ ▸ INVESTIGATED: ...                             │
│ ▸ LEARNED: ...                                  │
│ ▸ COMPLETED: ...                                │
│ ▸ NEXT STEPS: ...                               │
└────────────────────────────────────────────────┘
```

Only render sections that are non-empty. Section labels uppercase bold.

**Prompt card**:
```
┌─ border-left 4px #333 ─────────────────────────┐
│ PROMPT  [PROJECT]  [SOURCE]          date        │
│ prompt text in monospace block                  │
└────────────────────────────────────────────────┘
```

### Controls

Rendered in a control bar below the global nav:

- **Project filter**: `<select>` populated from SSE `initial_load.projects`. "ALL PROJECTS" default option.
- **Source filter**: `<select>` populated from SSE `initial_load.sources`. "ALL SOURCES" default.
- **Live indicator**: green/red dot + "LIVE" / "OFFLINE" text.
- **Processing indicator**: yellow pill "PROCESSING (N)" when `queueDepth > 0`.

Filter changes: clear feed, reset offsets to 0, reload page 1.

### What's Dropped from React Version

| React feature | Disposition |
|--------------|-------------|
| Settings modal | Removed — settings via Admin page |
| Logs drawer | Removed — logs via Admin page |
| Theme toggle | Removed — no themes in brutalist |
| Social links (GitHub, X, Discord, Docs) | Already removed |
| Tab bar (Sessions / Admin) | Removed — Admin is its own page now |

## Vercel Dashboard Pages

### public/dashboard/index.html (Learnings Review)

Apply brutalist CSS:
- Replace existing `styles.css` content with brutalist vars + layout
- Black header, monospace font, 3px borders
- Keep all existing JS functionality (approve/reject/edit learnings)
- Cards get border-left coloring by confidence level

### public/dashboard/admin/index.html

Apply brutalist CSS same way — keep JS, replace visual design.

## Implementation Phases

### Phase 1: sessions.html
1. Create `plugin/ui/sessions.html` with brutalist CSS + global nav
2. Implement SSE connection + reconnect logic
3. Implement feed rendering (all 3 card types)
4. Implement project/source filters
5. Implement pagination / Load More
6. Update `ViewerRoutes.ts` `handleViewerUI` method — both candidate paths must change from `viewer.html` to `sessions.html`: `path.join(packageRoot, 'ui', 'sessions.html')` and `path.join(packageRoot, 'plugin', 'ui', 'sessions.html')`
7. Delete `plugin/ui/viewer-bundle.js` (263 KB, no longer referenced) and remove `viewer.html` from `plugin/ui/` to avoid dead files being served by `express.static`
8. Build and sync, smoke test

### Phase 2: Vercel dashboard pages
1. Restyle `public/dashboard/index.html`
2. Restyle `public/dashboard/admin/index.html`

## Success Criteria

- `localhost:37777/` shows brutalist sessions feed, live updates via SSE
- Project and source filters work correctly
- Load More fetches next page for all three data types
- SSE disconnect triggers reconnect with visual indicator
- Observation cards show facts/narrative toggles
- Summary sections render only non-empty fields
- Visual design matches `ticks.html` / `admin.html` exactly
- Global nav present with correct active state on Sessions link
- Vercel dashboard pages match brutalist design
- All existing data APIs unchanged
