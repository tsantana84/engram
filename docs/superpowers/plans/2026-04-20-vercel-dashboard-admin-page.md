# Vercel Dashboard Admin Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/dashboard/admin/` page to the Vercel deployment showing cross-agent observability: agent activity, last sync times, and learning quality metrics.

**Architecture:** New `GET /api/admin/overview` Vercel function reads from Supabase via three new `SupabaseManager` methods. A static page at `public/dashboard/admin/index.html` fetches and renders the data with manual refresh, reusing the same bearer token auth pattern as the existing learning dashboard.

**Tech Stack:** TypeScript (Vercel serverless functions), Supabase, vanilla JS + HTML (static dashboard)

**Spec:** `docs/superpowers/specs/2026-04-20-vercel-dashboard-admin-page-design.md`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `api/lib/SupabaseManager.ts` | Add `getAgentActivity()`, `getSyncHealth()`, `getLearningQuality()` |
| Create | `api/admin/overview.ts` | `GET /api/admin/overview` Vercel function |
| Create | `public/dashboard/admin/index.html` | Static admin page |
| Create | `public/dashboard/admin/admin.js` | Fetch + render logic |
| Create | `public/dashboard/admin/styles.css` | Admin page styles |
| Modify | `public/dashboard/index.html` | Add "Admin" nav link |

---

### Task 1: SupabaseManager — getAgentActivity

**Files:**
- Modify: `api/lib/SupabaseManager.ts`
- Test: `api/lib/SupabaseManager.test.ts` (add cases or create)

- [ ] **Step 1.1: Write the failing test**

```typescript
// api/lib/SupabaseManager.test.ts (add)
describe('getAgentActivity', () => {
  it('returns agents with counts', async () => {
    const manager = new SupabaseManager(mockSupabaseClient);
    const result = await manager.getAgentActivity();
    expect(Array.isArray(result)).toBe(true);
    if (result.length > 0) {
      expect(result[0]).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        lastSeenAt: expect.any(String),
        observationCount: expect.any(Number),
        sessionCount: expect.any(Number),
        learningCount: expect.any(Number),
      });
    }
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

```bash
bun test api/lib/SupabaseManager.test.ts
```
Expected: FAIL — `getAgentActivity is not a function`

- [ ] **Step 1.3: Implement getAgentActivity**

Add to `SupabaseManager`:

```typescript
async getAgentActivity(): Promise<Array<{
  id: string;
  name: string;
  lastSeenAt: string | null;
  observationCount: number;
  sessionCount: number;
  learningCount: number;
}>> {
  const { data: agents, error } = await this.supabase
    .from('agents')
    .select('id, name');
  if (error) throw error;

  return Promise.all((agents ?? []).map(async agent => {
    const [obsResult, learningsResult] = await Promise.all([
      this.supabase
        .from('observations')
        .select('created_at, session_id')
        .eq('agent_id', agent.id),
      this.supabase
        .from('learnings')
        .select('id', { count: 'exact', head: true })
        .eq('source_agent_id', agent.id),
    ]);

    const observations = obsResult.data ?? [];
    const lastSeenAt = observations.length > 0
      ? observations.reduce((max, o) => o.created_at > max ? o.created_at : max, observations[0].created_at)
      : null;
    const sessionCount = new Set(observations.map(o => o.session_id)).size;

    return {
      id: agent.id,
      name: agent.name,
      lastSeenAt,
      observationCount: observations.length,
      sessionCount,
      learningCount: learningsResult.count ?? 0,
    };
  }));
}
```

- [ ] **Step 1.4: Run test to verify it passes**

```bash
bun test api/lib/SupabaseManager.test.ts
```
Expected: PASS

- [ ] **Step 1.5: Commit**

```bash
git add api/lib/SupabaseManager.ts api/lib/SupabaseManager.test.ts
git commit -m "feat(admin): SupabaseManager.getAgentActivity"
```

---

### Task 2: SupabaseManager — getSyncHealth + getLearningQuality

**Files:**
- Modify: `api/lib/SupabaseManager.ts`
- Test: `api/lib/SupabaseManager.test.ts`

- [ ] **Step 2.1: Write failing tests**

```typescript
describe('getSyncHealth', () => {
  it('returns lastSyncAt per agent derived from observations.synced_at', async () => {
    const manager = new SupabaseManager(mockSupabaseClient);
    const result = await manager.getSyncHealth();
    expect(Array.isArray(result)).toBe(true);
    if (result.length > 0) {
      expect(result[0]).toMatchObject({
        agentId: expect.any(String),
        lastSyncAt: expect.any(String),
      });
    }
  });
});

describe('getLearningQuality', () => {
  it('returns counts and approvalRate', async () => {
    const manager = new SupabaseManager(mockSupabaseClient);
    const result = await manager.getLearningQuality();
    expect(result).toMatchObject({
      total: expect.any(Number),
      pending: expect.any(Number),
      approved: expect.any(Number),
      rejected: expect.any(Number),
    });
    expect(result.approvalRate === null || typeof result.approvalRate === 'number').toBe(true);
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
bun test api/lib/SupabaseManager.test.ts
```
Expected: FAIL

- [ ] **Step 2.3: Implement getSyncHealth**

```typescript
async getSyncHealth(): Promise<Array<{ agentId: string; lastSyncAt: string | null }>> {
  const { data, error } = await this.supabase
    .from('observations')
    .select('agent_id, synced_at')
    .not('synced_at', 'is', null);
  if (error) throw error;

  const byAgent = new Map<string, string>();
  for (const row of data ?? []) {
    const current = byAgent.get(row.agent_id);
    if (!current || row.synced_at > current) {
      byAgent.set(row.agent_id, row.synced_at);
    }
  }

  return Array.from(byAgent.entries()).map(([agentId, lastSyncAt]) => ({ agentId, lastSyncAt }));
}
```

- [ ] **Step 2.4: Implement getLearningQuality**

```typescript
async getLearningQuality(): Promise<{
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  approvalRate: number | null;
  confidenceDistribution: { high: number; medium: number; low: number };
}> {
  const { data, error } = await this.supabase
    .from('learnings')
    .select('status, confidence');
  if (error) throw error;

  const rows = data ?? [];
  const counts = { pending: 0, approved: 0, rejected: 0 };
  const dist = { high: 0, medium: 0, low: 0 };

  for (const row of rows) {
    counts[row.status as keyof typeof counts]++;
    const c = row.confidence ?? 0;
    if (c >= 0.9) dist.high++;
    else if (c >= 0.7) dist.medium++;
    else dist.low++;
  }

  const reviewed = counts.approved + counts.rejected;
  return {
    total: rows.length,
    ...counts,
    approvalRate: reviewed > 0 ? counts.approved / reviewed : null,
    confidenceDistribution: dist,
  };
}
```

- [ ] **Step 2.5: Run tests to verify they pass**

```bash
bun test api/lib/SupabaseManager.test.ts
```
Expected: PASS

- [ ] **Step 2.6: Commit**

```bash
git add api/lib/SupabaseManager.ts api/lib/SupabaseManager.test.ts
git commit -m "feat(admin): SupabaseManager.getSyncHealth + getLearningQuality"
```

---

### Task 3: api/admin/overview.ts Vercel function

**Files:**
- Create: `api/admin/overview.ts`

- [ ] **Step 3.1: Create the Vercel function**

Use the existing `authenticateRequest` from `api/auth.ts` — it handles bcrypt hash comparison correctly. Do NOT write a new validateAgentKey method (keys are stored as bcrypt hashes, plain equality check will always fail).

```typescript
// api/admin/overview.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateRequest } from '../auth';
import { getSupabaseInstance } from '../lib/SupabaseManager';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const agent = await authenticateRequest(req);
  if (!agent) return res.status(401).json({ error: 'Invalid or missing token' });

  const db = getSupabaseInstance(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);

  const [agents, syncHealth, learningQuality] = await Promise.allSettled([
    db.getAgentActivity(),
    db.getSyncHealth(),
    db.getLearningQuality(),
  ]);

  res.json({
    agents: agents.status === 'fulfilled' ? agents.value : null,
    syncHealth: syncHealth.status === 'fulfilled' ? syncHealth.value : null,
    learningQuality: learningQuality.status === 'fulfilled' ? learningQuality.value : null,
    fetchedAt: new Date().toISOString(),
  });
}
```

Note: `getAgentActivity()` fetches all observation rows per agent with no LIMIT. At large scale this may timeout the Vercel function (10s default). Acceptable for current scale; add pagination if it becomes slow.

- [ ] **Step 3.2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 3.3: Commit**

```bash
git add api/admin/overview.ts
git commit -m "feat(admin): add GET /api/admin/overview Vercel function"
```

---

### Task 4: Static admin page

**Files:**
- Create: `public/dashboard/admin/index.html`
- Create: `public/dashboard/admin/admin.js`
- Create: `public/dashboard/admin/styles.css`
- Modify: `public/dashboard/index.html`

- [ ] **Step 4.1: Create index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Engram Admin</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div id="app">
    <header>
      <h1>Engram Admin</h1>
      <nav>
        <a href="/dashboard/" id="reviewLink">← Review</a>
        <button id="refreshBtn">Refresh</button>
      </nav>
    </header>

    <div id="tokenForm" style="display:none">
      <form id="tokenFormEl">
        <label for="tokenInput">API Key</label>
        <input type="password" id="tokenInput" placeholder="Enter agent API key" />
        <button type="submit">Connect</button>
      </form>
      <p id="tokenError" class="error" style="display:none"></p>
    </div>

    <div id="content" style="display:none">
      <p id="fetchedAt" class="fetched-at"></p>
      <section id="learningQuality"><h2>Learning Quality</h2><div id="qualityContent"></div></section>
      <section id="agentsSection"><h2>Agents</h2><div id="agentsContent"></div></section>
      <section id="syncSection"><h2>Sync Health</h2><div id="syncContent"></div></section>
    </div>

    <p id="globalError" class="error" style="display:none"></p>
  </div>
  <script src="admin.js"></script>
</body>
</html>
```

- [ ] **Step 4.2: Create admin.js**

All DOM manipulation uses `textContent` or `createElement` — no `innerHTML` with untrusted data.

```javascript
// public/dashboard/admin/admin.js
const TOKEN_KEY = 'engram_dashboard_token';
let fetching = false;

function el(id) { return document.getElementById(id); }

function text(parent, tag, content, className) {
  const node = document.createElement(tag);
  node.textContent = content;
  if (className) node.className = className;
  parent.appendChild(node);
  return node;
}

async function tryConnect() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) { showTokenForm(); return; }
  await refresh();
}

async function refresh() {
  if (fetching) return;
  fetching = true;
  const btn = el('refreshBtn');
  btn.disabled = true;
  btn.textContent = 'Loading…';

  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const res = await fetch('/api/admin/overview', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.status === 401) { localStorage.removeItem(TOKEN_KEY); showTokenForm(); return; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    render(data);
    el('content').style.display = '';
    el('tokenForm').style.display = 'none';
    el('globalError').style.display = 'none';
  } catch (err) {
    showError(err.message);
  } finally {
    fetching = false;
    btn.disabled = false;
    btn.textContent = 'Refresh';
  }
}

function render(data) {
  el('fetchedAt').textContent = `Fetched ${new Date(data.fetchedAt).toLocaleTimeString()}`;
  renderQuality(data.learningQuality);
  renderAgents(data.agents, data.syncHealth);
}

function renderQuality(q) {
  const container = el('qualityContent');
  container.textContent = '';
  if (!q) { text(container, 'p', 'unavailable', 'unavailable'); return; }

  const row = document.createElement('div');
  row.className = 'stat-row';
  text(row, 'span', `${q.total} total`);
  text(row, 'span', `${q.approved} approved`, 'approved');
  text(row, 'span', `${q.rejected} rejected`, 'rejected');
  text(row, 'span', `${q.pending} pending`, 'pending');
  container.appendChild(row);

  const rate = q.approvalRate !== null ? `${(q.approvalRate * 100).toFixed(0)}%` : '—';
  const rateP = document.createElement('p');
  rateP.textContent = 'Approval rate: ';
  const strong = document.createElement('strong');
  strong.textContent = rate;
  rateP.appendChild(strong);
  container.appendChild(rateP);

  const confBar = document.createElement('div');
  confBar.className = 'confidence-bar';
  text(confBar, 'span', `high(${q.confidenceDistribution.high})`, 'high');
  text(confBar, 'span', `med(${q.confidenceDistribution.medium})`, 'medium');
  text(confBar, 'span', `low(${q.confidenceDistribution.low})`, 'low');
  container.appendChild(confBar);
}

function renderAgents(agents, syncHealth) {
  const agentsEl = el('agentsContent');
  const syncEl = el('syncContent');
  agentsEl.textContent = '';
  syncEl.textContent = '';

  if (!agents) {
    text(agentsEl, 'p', 'unavailable', 'unavailable');
    text(syncEl, 'p', 'unavailable', 'unavailable');
    return;
  }
  if (agents.length === 0) {
    text(agentsEl, 'p', 'No agents found', 'empty');
    return;
  }

  const syncMap = new Map((syncHealth ?? []).map(s => [s.agentId, s.lastSyncAt]));

  for (const agent of agents) {
    const row = document.createElement('div');
    row.className = 'agent-row';

    const nameEl = document.createElement('div');
    nameEl.className = `agent-name ${ageClass(agent.lastSeenAt)}`;
    nameEl.textContent = agent.name;
    row.appendChild(nameEl);

    const metaEl = document.createElement('div');
    metaEl.className = 'agent-meta';
    metaEl.textContent = `last seen ${agent.lastSeenAt ? relativeTime(agent.lastSeenAt) : 'never'}`;
    row.appendChild(metaEl);

    const countsEl = document.createElement('div');
    countsEl.className = 'agent-counts';
    countsEl.textContent = `${agent.observationCount.toLocaleString()} obs · ${agent.sessionCount} sessions · ${agent.learningCount} learnings`;
    row.appendChild(countsEl);
    agentsEl.appendChild(row);

    // Sync row
    const syncRow = document.createElement('div');
    syncRow.className = 'sync-row';
    const syncName = document.createElement('span');
    syncName.className = 'agent-name';
    syncName.textContent = agent.name;
    const lastSync = syncMap.get(agent.id);
    const syncTime = document.createElement('span');
    syncTime.className = `sync-time ${lastSync ? ageClass(lastSync) : 'red'}`;
    syncTime.textContent = lastSync ? `last sync ${relativeTime(lastSync)}` : 'never synced';
    syncRow.appendChild(syncName);
    syncRow.appendChild(syncTime);
    syncEl.appendChild(syncRow);
  }
}

function ageClass(iso) {
  if (!iso) return 'red';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 3_600_000) return 'green';
  if (diff < 86_400_000) return 'yellow';
  return 'red';
}

function relativeTime(iso) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function showTokenForm() {
  el('tokenForm').style.display = '';
  el('content').style.display = 'none';
}

function showError(msg) {
  const errEl = el('globalError');
  errEl.textContent = msg;
  errEl.style.display = '';
}

el('refreshBtn').addEventListener('click', refresh);
el('tokenFormEl').addEventListener('submit', async e => {
  e.preventDefault();
  const token = el('tokenInput').value.trim();
  if (!token) return;
  localStorage.setItem(TOKEN_KEY, token);
  el('tokenForm').style.display = 'none';
  await refresh();
});

window.addEventListener('load', tryConnect);
```

- [ ] **Step 4.3: Create styles.css**

```css
/* public/dashboard/admin/styles.css */
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; background: #0f0f0f; color: #e0e0e0; padding: 1rem; }
header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; }
h1 { font-size: 1.25rem; }
nav { display: flex; gap: 0.75rem; align-items: center; }
nav a { color: #888; text-decoration: none; font-size: 0.875rem; }
nav a:hover { color: #e0e0e0; }
button { background: #2a2a2a; color: #e0e0e0; border: 1px solid #444; padding: 0.4rem 0.8rem; border-radius: 4px; cursor: pointer; font-size: 0.875rem; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
section { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; }
h2 { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em; color: #888; margin-bottom: 0.75rem; }
.fetched-at { font-size: 0.75rem; color: #555; margin-bottom: 1rem; }
.stat-row { display: flex; gap: 1rem; flex-wrap: wrap; font-size: 0.875rem; margin-bottom: 0.5rem; }
.approved { color: #4ade80; }
.rejected { color: #f87171; }
.pending { color: #facc15; }
.confidence-bar { display: flex; gap: 0.75rem; font-size: 0.75rem; margin-top: 0.5rem; }
.high { color: #4ade80; }
.medium { color: #facc15; }
.low { color: #f87171; }
.agent-row { padding: 0.5rem 0; border-bottom: 1px solid #2a2a2a; }
.agent-row:last-child { border-bottom: none; }
.agent-name { font-weight: 500; font-size: 0.875rem; }
.agent-meta, .agent-counts { color: #888; font-size: 0.75rem; margin-top: 0.2rem; }
.sync-row { display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0; border-bottom: 1px solid #2a2a2a; font-size: 0.875rem; }
.sync-row:last-child { border-bottom: none; }
.green { color: #4ade80; }
.yellow { color: #facc15; }
.red { color: #f87171; }
.unavailable, .empty { color: #555; font-size: 0.875rem; }
.error { color: #f87171; font-size: 0.875rem; margin-top: 0.5rem; }
#tokenForm { max-width: 400px; background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 1.5rem; }
#tokenForm label { display: block; margin-bottom: 0.5rem; font-size: 0.875rem; color: #888; }
#tokenInput { width: 100%; padding: 0.5rem; background: #0f0f0f; border: 1px solid #444; color: #e0e0e0; border-radius: 4px; margin-bottom: 0.75rem; font-size: 0.875rem; }
```

- [ ] **Step 4.4: Add "Admin" link to existing dashboard**

In `public/dashboard/index.html`, add to the header/nav:

```html
<a href="/dashboard/admin/">Admin →</a>
```

- [ ] **Step 4.5: Commit**

```bash
git add public/dashboard/admin/ public/dashboard/index.html
git commit -m "feat(admin): add /dashboard/admin/ static page with agent/sync/quality views"
```

---

### Task 5: Deploy and verify

- [ ] **Step 5.1: Deploy to Vercel preview**

```bash
vercel
```

- [ ] **Step 5.2: Verify endpoint**

```bash
curl -H "Authorization: Bearer <your-api-key>" https://<preview-url>/api/admin/overview | jq .
```

Expected: JSON with `agents`, `syncHealth`, `learningQuality`, `fetchedAt`.

- [ ] **Step 5.3: Verify admin page**

Open `https://<preview-url>/dashboard/admin/` in browser. Verify:
- Token prompt appears on first load
- After token entry, all 3 sections render
- Refresh button reloads data
- "← Review" link navigates back to dashboard
- Agent last-seen badges color correctly (green <1h, yellow 1–24h, red >24h)

- [ ] **Step 5.4: Verify nav link**

Open `https://<preview-url>/dashboard/` — confirm "Admin →" link appears and navigates correctly.

- [ ] **Step 5.5: Deploy to production**

```bash
vercel --prod
```

- [ ] **Step 5.6: Final commit if fixes needed**

```bash
git add -p
git commit -m "fix(admin): vercel dashboard admin page fixes after deploy"
```
