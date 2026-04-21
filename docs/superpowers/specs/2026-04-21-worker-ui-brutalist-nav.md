# Worker UI — Brutalist Nav Shell Design Spec

## Goal

Apply a consistent brutalist navigation shell to all local worker pages at `localhost:37777`. Phase 1: global nav on all existing pages + new static `/admin` page. Sessions (React viewer) stays intact.

## Scope

| Route | Change |
|-------|--------|
| `/` | Inject global nav above React app via `viewer-template.html` (outside `#root` div) |
| `/admin` | New static `admin.html` — same data as AdminTab React component, brutalist layout |
| `/ticks` | Add global nav at top (currently missing) |

## Global Nav

Shared HTML block appearing at the top of every page. Identical markup on all three pages — active tab set per-page via hardcoded CSS class.

```
┌─────────────────────────────────────────────────────┐
│ ⬡ ENGRAM WORKER │ Sessions │ Admin │ Ticks │  [OK]  │
└─────────────────────────────────────────────────────┘
```

- Black background, 3px solid black bottom border
- Brand: `⬡ ENGRAM WORKER` in Arial Black, white, uppercase, yellow hex
- Nav links: `Sessions` → `/`, `Admin` → `/admin`, `Ticks` → `/ticks`
- Active link: yellow text, subtle black highlight, yellow bottom border
- Inactive: `#aaa` text
- Worker status badge (top-right): fetched from `/health` on page load, green `OK` or red `DOWN`
- Plain `<a href>` links — no JS routing

### CSS tokens (same as `ticks.html`)

```css
--black: #000; --white: #fff; --yellow: #f5e400;
--red: #ff2400; --green: #00b300;
--border: 3px solid #000;
--mono: 'Courier New', Courier, monospace;
--sans: 'Arial Black', Arial, sans-serif;
```

## `/admin` Page

New static file `plugin/ui/admin.html`. Served by a new `GET /admin` route in `ViewerRoutes` (same pattern as `GET /ticks`). Fetches `GET /api/admin` every 10 seconds.

### Layout — 2-column grid

```
┌────────────────────┬────────────────────┐
│  System Health     │  Sync Queue        │
│  uptime + badges   │  pending/failed    │
│                    │  failed item list  │
├────────────────────┼────────────────────┤
│  Learning Extrac.  │                    │
│  enabled + stats   │                    │
├────────────────────┴────────────────────┤
│  Recent Errors (full width)             │
│  time │ LEVEL │ CTX │ message           │
└─────────────────────────────────────────┘
```

### System Health panel

- Uptime formatted as `Xh Ym up`
- Status badges: Chroma (ok/error/unavailable), Sync Server (ok/error/unavailable)
- Version string

### Sync Queue panel

- Large numbers: `pending` count, `failed` + `permanently_failed` combined (red if > 0)
- Failed items list (if any): `TYPE | error message | N retries` — red left border per item
- API fields: `{ pending, synced, failed, permanently_failed, failedItems: [{ id, type, retries, lastError }] }`

### Learning Extraction panel

- Only rendered if `data.extraction` is non-null
- Enabled/disabled badge + threshold + last run time
- 4-cell stat grid: Processed / Extracted / Skipped / Failed (Failed in red if > 0)
- API fields: `{ enabled, threshold, lastRunAt, lastRunStats: { observationsProcessed, extracted, skipped, failed } }`

### Errors panel (full-width)

- Grid columns: time | LEVEL badge | CTX | message
- `ERROR` badge: red. `WARN` badge: yellow. Others: gray.
- Empty state: "no errors"

### Behavior

- Auto-refresh: `setInterval(fetchData, 10_000)`
- Page-load timer shows "Updated Xs ago"
- DOM-safe: `createTextNode` / `textContent` for all data strings — no `innerHTML` with API data
- On worker down: full-page "Worker unavailable — retrying" message

## `/ticks` Update

Add the global nav HTML block at the top of `plugin/ui/ticks.html`, above `<header>`. The existing `<header>` becomes the page-level header (below the nav). Update the `<title>` to `ENGRAM — TICKS` (already correct).

## `viewer-template.html` Update

The React viewer is built into `plugin/ui/viewer.html` from `src/ui/viewer-template.html`. The template has a `<body>` with `<div id="root">` where React mounts.

Inject the global nav HTML directly into `viewer-template.html` above `<div id="root">`. React renders inside `#root` — the nav sits above it in the DOM and is not controlled by React. No React changes required.

**Build step required:** After editing `viewer-template.html`, run `npm run build-and-sync` — the build script copies the template into `plugin/ui/viewer.html`.

Active tab: `Sessions` is active on this page (hardcoded class).

## Files Changed

| File | Change |
|------|--------|
| `src/ui/viewer-template.html` | Inject global nav above `#root` div |
| `plugin/ui/ticks.html` | Add global nav block at top |
| `plugin/ui/admin.html` | New static admin page |
| `src/services/worker/http/routes/ViewerRoutes.ts` | Add `GET /admin` route (same pattern as `/ticks`) |

## Out of Scope

- No changes to React viewer internals
- No new API endpoints
- No Sessions page replacement
- No mobile/responsive layout
