# Engram Developer Talk — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-contained HTML slide deck (`docs/presentations/engram-developer-talk.html`) for a 30-minute live developer talk about engram — covering architecture, ConflictDetector, demo walkthrough, and dev workflow.

**Architecture:** Single HTML file with inline CSS/JS. Keyboard-navigable slide engine (left/right arrows, each `<section>` toggled via `display`). Visual design matches `multi-agent-sync-team.html` (dark theme, same CSS variables). No external dependencies.

**Tech Stack:** Vanilla HTML/CSS/JS. No frameworks, no CDN links, no build step.

---

## File Structure

| File | Action | Notes |
|------|--------|-------|
| `docs/presentations/engram-developer-talk.html` | **Create** | The full deck — all slides, CSS, JS in one file |

Reference for visual style: `docs/presentations/multi-agent-sync-team.html`
Spec: `docs/superpowers/specs/2026-04-15-engram-developer-presentation-design.md`

---

## Task 1: HTML shell — CSS design system + slide engine

**Files:**
- Create: `docs/presentations/engram-developer-talk.html`

**What this task builds:**
The empty skeleton: all CSS variables (copied from reference), the slide JS engine (arrow key nav, slide counter), and a fixed nav bar. No slide content yet — just infrastructure. Verify by opening in browser: nav visible, arrow keys log to console, no errors.

- [ ] **Step 1.1: Create the file with DOCTYPE, head, CSS variables**

Copy the CSS variable block from `multi-agent-sync-team.html` lines 9–22 exactly (same dark theme: `--bg`, `--surface`, `--surface2`, `--border`, `--accent`, `--accent2`, `--accent3`, `--accent4`, `--text`, `--text-muted`, `--red`, `--gradient`).

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Engram — Developer Talk</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --bg: #0d1117;
    --surface: #161b22;
    --surface2: #21262d;
    --border: #30363d;
    --accent: #58a6ff;
    --accent2: #bc8cff;
    --accent3: #3fb950;
    --accent4: #d29922;
    --text: #e6edf3;
    --text-muted: #8b949e;
    --red: #f85149;
    --gradient: linear-gradient(135deg, #58a6ff, #bc8cff);
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.6;
    overflow: hidden; /* slides fill viewport */
  }

  /* ── NAV ── */
  nav {
    position: fixed; top: 0; left: 0; right: 0; z-index: 100;
    background: rgba(13,17,23,0.95); backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--border);
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 2rem; height: 54px;
  }
  .nav-logo { font-size: 1rem; font-weight: 700; font-family: monospace; color: var(--accent3); }
  .nav-counter { color: var(--text-muted); font-size: 0.83rem; font-family: monospace; }
  .nav-title { color: var(--text-muted); font-size: 0.83rem; }

  /* ── SLIDES ── */
  .slide {
    display: none;
    height: 100vh;
    padding: 80px 2rem 2rem;
    overflow-y: auto;
    max-width: 1060px;
    margin: 0 auto;
  }
  .slide.active { display: flex; flex-direction: column; justify-content: center; }

  /* ── TYPOGRAPHY ── */
  .eyebrow {
    font-size: 0.75rem; font-weight: 600; letter-spacing: .12em;
    text-transform: uppercase; color: var(--text-muted); margin-bottom: .75rem;
  }
  h1 { font-size: clamp(2rem, 4vw, 3rem); font-weight: 800; line-height: 1.1; margin-bottom: 1rem; }
  h2 { font-size: clamp(1.5rem, 3vw, 2.2rem); font-weight: 700; margin-bottom: 1rem; }
  h3 { font-size: 1.1rem; font-weight: 600; color: var(--accent); margin-bottom: .5rem; }
  .lead { font-size: 1.1rem; color: var(--text-muted); max-width: 680px; margin-bottom: 2rem; }
  .gradient { background: var(--gradient); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }

  /* ── CARDS / TABLES ── */
  .card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 10px; padding: 1.25rem 1.5rem; margin-bottom: 1rem;
  }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }

  table { width: 100%; border-collapse: collapse; margin-bottom: 1.5rem; font-size: .9rem; }
  th { text-align: left; padding: .5rem .75rem; border-bottom: 1px solid var(--border); color: var(--text-muted); font-weight: 600; font-size: .78rem; text-transform: uppercase; letter-spacing: .08em; }
  td { padding: .5rem .75rem; border-bottom: 1px solid var(--border); }
  tr:last-child td { border-bottom: none; }
  .check { color: var(--accent3); font-weight: 700; }
  .dash { color: var(--text-muted); }

  /* ── CODE BLOCKS ── */
  .codeblock { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; margin-bottom: 1.25rem; }
  .codeblock-header { background: var(--surface2); border-bottom: 1px solid var(--border); padding: .4rem 1rem; font-size: .75rem; color: var(--text-muted); font-family: monospace; display: flex; justify-content: space-between; }
  .codeblock pre { padding: 1rem 1.25rem; font-family: 'SF Mono', 'Fira Code', monospace; font-size: .82rem; line-height: 1.65; overflow-x: auto; white-space: pre; }
  .c-comment { color: var(--text-muted); }
  .c-green { color: var(--accent3); }
  .c-blue { color: var(--accent); }
  .c-purple { color: var(--accent2); }
  .c-yellow { color: var(--accent4); }
  .c-red { color: var(--red); }
  .c-str { color: var(--accent4); }

  /* ── CALLOUTS ── */
  .callout { display: flex; gap: 1rem; padding: 1rem 1.25rem; border-radius: 8px; margin-bottom: 1rem; }
  .callout.info { background: rgba(88,166,255,.08); border: 1px solid rgba(88,166,255,.25); }
  .callout.warn { background: rgba(210,153,34,.08); border: 1px solid rgba(210,153,34,.25); }
  .callout.success { background: rgba(63,185,80,.08); border: 1px solid rgba(63,185,80,.25); }
  .callout-icon { font-size: 1.1rem; flex-shrink: 0; }

  /* ── DATA FLOW (animated) ── */
  .flow-row {
    display: flex; align-items: center; gap: .75rem;
    padding: .5rem 0;
    opacity: 0; transform: translateY(6px);
    transition: opacity .3s ease, transform .3s ease;
    font-family: monospace; font-size: .88rem;
  }
  .flow-row.visible { opacity: 1; transform: translateY(0); }
  .flow-arrow { color: var(--text-muted); }
  .flow-node { background: var(--surface2); border: 1px solid var(--border); border-radius: 6px; padding: .25rem .75rem; }
  .flow-node.highlight { border-color: var(--accent); color: var(--accent); }
  .flow-note { color: var(--text-muted); font-size: .78rem; }

  /* ── BADGES ── */
  .badge { display: inline-block; font-size: .72rem; padding: .15rem .55rem; border-radius: 4px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; }
  .badge-green { background: rgba(63,185,80,.15); color: var(--accent3); border: 1px solid rgba(63,185,80,.3); }
  .badge-purple { background: rgba(188,140,255,.12); color: var(--accent2); border: 1px solid rgba(188,140,255,.3); }
  .badge-red { background: rgba(248,81,73,.1); color: var(--red); border: 1px solid rgba(248,81,73,.25); }
  .badge-yellow { background: rgba(210,153,34,.1); color: var(--accent4); border: 1px solid rgba(210,153,34,.25); }

  /* ── FAQ OVERLAY ── */
  #faq-overlay {
    display: none; position: fixed; inset: 0; z-index: 200;
    background: rgba(13,17,23,.96); backdrop-filter: blur(8px);
    padding: 6rem 2rem 2rem; overflow-y: auto;
  }
  #faq-overlay.visible { display: block; }
  #faq-overlay h2 { margin-bottom: 1.5rem; }
  .faq-item { margin-bottom: 1.25rem; }
  .faq-q { font-weight: 600; color: var(--accent); margin-bottom: .25rem; }
  .faq-a { color: var(--text-muted); }
  .faq-close { position: fixed; top: 1rem; right: 2rem; background: none; border: 1px solid var(--border); color: var(--text-muted); padding: .3rem .75rem; border-radius: 6px; cursor: pointer; font-size: .83rem; }
  .faq-close:hover { color: var(--text); }
</style>
</head>
<body>
```

- [ ] **Step 1.2: Add nav + slide placeholders + JS engine**

```html
<nav>
  <div class="nav-logo">$ engram</div>
  <div class="nav-title" id="nav-title">What is engram?</div>
  <div class="nav-counter"><span id="slide-num">1</span> / <span id="slide-total">6</span></div>
</nav>

<!-- Slides injected in Tasks 2–7 -->
<div id="slide-1" class="slide active"></div>
<div id="slide-2" class="slide"></div>
<div id="slide-3" class="slide"></div>
<div id="slide-4" class="slide"></div>
<div id="slide-5" class="slide"></div>
<div id="slide-6" class="slide"></div>

<!-- FAQ overlay (Task 7) -->
<div id="faq-overlay"></div>

<script>
const SLIDE_TITLES = [
  'What is engram?',
  'Full data flow',
  'ConflictDetector',
  'Demo walkthrough',
  'Dev workflow',
  'Q&A'
];

let current = 0;
const slides = document.querySelectorAll('.slide');
const total = slides.length;
document.getElementById('slide-total').textContent = total;

function goTo(n) {
  if (n < 0 || n >= total) return;
  slides[current].classList.remove('active');
  current = n;
  slides[current].classList.add('active');
  document.getElementById('slide-num').textContent = current + 1;
  document.getElementById('nav-title').textContent = SLIDE_TITLES[current];
  // Reset flow animations on slide 2
  if (current === 1) resetFlow();
}

document.addEventListener('keydown', e => {
  const faq = document.getElementById('faq-overlay');
  if (faq.classList.contains('visible')) {
    if (e.key === 'Escape' || e.key === 'f' || e.key === 'F') closeFaq();
    return;
  }
  if (e.key === 'ArrowRight' || e.key === ' ') {
    // On slide 2, right arrow advances flow first
    if (current === 1 && advanceFlow()) return;
    goTo(current + 1);
  }
  if (e.key === 'ArrowLeft') goTo(current - 1);
  if ((e.key === 'f' || e.key === 'F') && current === 5) openFaq();
});

// Flow animation (Slide 2) — populated in Task 3
let flowStep = 0;
let flowRows = [];
function resetFlow() { flowStep = 0; flowRows = Array.from(document.querySelectorAll('.flow-row')); flowRows.forEach(r => r.classList.remove('visible')); const c = document.getElementById('flow-done-callout'); if (c) c.style.opacity = '0'; }
function advanceFlow() { if (!flowRows.length) flowRows = Array.from(document.querySelectorAll('.flow-row')); if (flowStep < flowRows.length) { flowRows[flowStep].classList.add('visible'); flowStep++; return true; } return false; }

function openFaq() { document.getElementById('faq-overlay').classList.add('visible'); }
function closeFaq() { document.getElementById('faq-overlay').classList.remove('visible'); }
</script>
</body>
</html>
```

- [ ] **Step 1.3: Open in browser — verify**

Open `docs/presentations/engram-developer-talk.html` in Chrome/Safari.

Expected:
- Dark background, nav visible at top: "$ engram | What is engram? | 1 / 6"
- Right arrow: counter increments to 2, title changes to "Full data flow"
- Left arrow on slide 1: nothing happens (no underflow)
- Right arrow past slide 6: nothing happens (no overflow)
- No console errors

- [ ] **Step 1.4: Commit**

```bash
git add docs/presentations/engram-developer-talk.html
git commit -m "feat: engram dev talk — HTML shell with slide engine and CSS design system"
```

---

## Task 2: Slide 1 — What is engram?

**Files:**
- Modify: `docs/presentations/engram-developer-talk.html` (fill `#slide-1`)

- [ ] **Step 2.1: Fill Slide 1 content**

Replace `<div id="slide-1" class="slide active"></div>` with:

```html
<div id="slide-1" class="slide active">
  <div class="eyebrow">Engram · Developer Talk</div>
  <h1>Fork of <span class="gradient">claude-mem</span><br>with multi-agent sync</h1>
  <p class="lead">Everything claude-mem does locally — observations, summaries, FTS5 search — plus a sync pipeline that shares memory across machines.</p>

  <table>
    <thead>
      <tr><th>Feature</th><th>claude-mem</th><th>engram</th></tr>
    </thead>
    <tbody>
      <tr><td>Local memory (SQLite)</td><td class="check">✓</td><td class="check">✓</td></tr>
      <tr><td>Chroma vector search</td><td class="check">✓</td><td class="check">✓</td></tr>
      <tr><td>MCP search tools + skills</td><td class="check">✓</td><td class="check">✓</td></tr>
      <tr><td>Multi-agent sync</td><td class="dash">—</td><td class="check">✓</td></tr>
      <tr><td>Shared team memory</td><td class="dash">—</td><td class="check">✓</td></tr>
      <tr><td>Data directory</td><td><code>~/.claude-mem/</code></td><td><code>~/.engram/</code></td></tr>
    </tbody>
  </table>

  <div class="callout info">
    <div class="callout-icon">ℹ️</div>
    <div>Plugin identity: <code>engram@thedotmack</code> — installs alongside claude-mem without conflicts. All hooks, worker, and MCP tools are inherited from upstream.</div>
  </div>
</div>
```

- [ ] **Step 2.2: Verify in browser**

Open file. Slide 1 shows:
- Heading with gradient on "claude-mem"
- Feature diff table, all rows visible
- Info callout at bottom
- Nothing overflows the viewport

- [ ] **Step 2.3: Commit**

```bash
git add docs/presentations/engram-developer-talk.html
git commit -m "feat: engram dev talk — slide 1: what is engram"
```

---

## Task 3: Slide 2 — Full data flow (animated)

**Files:**
- Modify: `docs/presentations/engram-developer-talk.html` (fill `#slide-2`)

**How the animation works:** Each `.flow-row` starts `opacity:0`. Each right-arrow keypress on Slide 2 calls `advanceFlow()` which adds `.visible` to the next row. After all rows are revealed, right arrow advances to Slide 3. Navigating back to Slide 2 resets the animation.

- [ ] **Step 3.1: Fill Slide 2 content**

Replace `<div id="slide-2" class="slide"></div>` with:

```html
<div id="slide-2" class="slide">
  <div class="eyebrow">Architecture</div>
  <h2>Full data flow</h2>
  <p class="lead">Every observation travels this pipeline. Press → to step through each stage.</p>

  <div style="margin: 1.5rem 0;">
    <div class="flow-row">
      <div class="flow-node highlight">PostToolUse hook</div>
      <div class="flow-note">fires after every tool execution in Claude Code</div>
    </div>
    <div class="flow-row">
      <div class="flow-arrow">↓</div>
      <div class="flow-node highlight">Worker (port 37777)</div>
      <div class="flow-note"><code>SessionStore.ts</code> — <code>storeObservations()</code></div>
    </div>
    <div class="flow-row">
      <div class="flow-arrow">↓</div>
      <div class="flow-node">SQLite <code>~/.engram/claude-mem.db</code></div>
      <div class="flow-note">git_branch · invalidated_at · validation_status captured here</div>
    </div>
    <div class="flow-row">
      <div class="flow-arrow">↓ enqueue</div>
      <div class="flow-node">sync_queue</div>
      <div class="flow-note">non-blocking — retries up to 5×, then marks failed</div>
    </div>
    <div class="flow-row">
      <div class="flow-arrow">↓ every 30s</div>
      <div class="flow-node highlight">SyncWorker</div>
      <div class="flow-note"><code>SyncWorker.ts</code></div>
    </div>
    <div class="flow-row">
      <div class="flow-arrow">↓</div>
      <div class="flow-node highlight">ConflictDetector</div>
      <div class="flow-note"><code>ConflictDetector.ts</code> — opt-in (disabled if no LLM provider set)</div>
    </div>
    <div class="flow-row">
      <div class="flow-arrow">↓ ADD / UPDATE / INVALIDATE / NOOP</div>
      <div class="flow-node">SyncClient.push()</div>
      <div class="flow-note"><code>SyncClient.ts</code></div>
    </div>
    <div class="flow-row">
      <div class="flow-arrow">↓</div>
      <div class="flow-node">Vercel API</div>
      <div class="flow-note"><code>api/sync.ts</code> at engram-ashy.vercel.app</div>
    </div>
    <div class="flow-row">
      <div class="flow-arrow">↓</div>
      <div class="flow-node">Supabase</div>
      <div class="flow-note">shared team DB — scoped per API key, no cross-team access</div>
    </div>
  </div>

  <div class="callout info" style="opacity:0;transition:opacity .3s" id="flow-done-callout">
    <div class="callout-icon">→</div>
    <div>Full pipeline visible. Press → again to continue to ConflictDetector deep-dive.</div>
  </div>
</div>
```

- [ ] **Step 3.2: Update `advanceFlow()` to show the callout when done**

In the `<script>` block, find and replace the exact string:

```
function advanceFlow() { if (!flowRows.length) flowRows = Array.from(document.querySelectorAll('.flow-row')); if (flowStep < flowRows.length) { flowRows[flowStep].classList.add('visible'); flowStep++; return true; } return false; }
```

Replace with:

```js
function advanceFlow() {
  if (!flowRows.length) flowRows = Array.from(document.querySelectorAll('.flow-row'));
  if (flowStep < flowRows.length) {
    flowRows[flowStep].classList.add('visible');
    flowStep++;
    if (flowStep === flowRows.length) {
      const callout = document.getElementById('flow-done-callout');
      if (callout) callout.style.opacity = '1';
    }
    return true;
  }
  return false;
}
```

- [ ] **Step 3.3: Verify in browser**

Navigate to Slide 2. Press right arrow repeatedly:
- Each press reveals one flow row (fade in from below)
- After all 9 rows: callout appears ("Full pipeline visible. Press → again…")
- One more right arrow: advances to Slide 3
- Navigate back to Slide 2: rows reset to hidden

- [ ] **Step 3.4: Commit**

```bash
git add docs/presentations/engram-developer-talk.html
git commit -m "feat: engram dev talk — slide 2: animated data flow diagram"
```

---

## Task 4: Slide 3 — ConflictDetector deep-dive

**Files:**
- Modify: `docs/presentations/engram-developer-talk.html` (fill `#slide-3`)

- [ ] **Step 4.1: Fill Slide 3 content**

Replace `<div id="slide-3" class="slide"></div>` with:

```html
<div id="slide-3" class="slide">
  <div class="eyebrow">Memory Quality</div>
  <h2>ConflictDetector</h2>
  <p class="lead">Stale observations pollute the shared brain. ConflictDetector classifies every outgoing observation before it reaches Supabase.</p>

  <div class="callout warn" style="margin-bottom:1.5rem">
    <div class="callout-icon">⚠️</div>
    <div><strong>The problem:</strong> An observation written while debugging a wrong hypothesis can mislead every agent on the team. Unmerged-branch observations are even worse — they may contradict main.</div>
  </div>

  <div class="grid-2" style="margin-bottom:1.5rem">
    <div>
      <h3>Pipeline (when CLAUDE_MEM_PROVIDER is set)</h3>
      <ol style="padding-left:1.2rem;line-height:2;color:var(--text-muted);font-size:.9rem">
        <li>Fetch top-5 similar obs from Supabase</li>
        <li>Pass to LLM with structured classification prompt</li>
        <li>Receive action → execute</li>
      </ol>
    </div>
    <div>
      <h3>Four actions</h3>
      <div style="display:flex;flex-direction:column;gap:.5rem">
        <div><span class="badge badge-green">ADD</span> <span style="font-size:.88rem;color:var(--text-muted)">New info — store normally</span></div>
        <div><span class="badge badge-yellow">UPDATE</span> <span style="font-size:.88rem;color:var(--text-muted)">Supersedes existing — invalidate old</span></div>
        <div><span class="badge badge-red">INVALIDATE</span> <span style="font-size:.88rem;color:var(--text-muted)">Old obs appears wrong — remove it</span></div>
        <div><span class="badge badge-purple">NOOP</span> <span style="font-size:.88rem;color:var(--text-muted)">Duplicate — drop silently</span></div>
      </div>
    </div>
  </div>

  <h3 style="margin-bottom:.75rem">Provenance columns</h3>
  <table>
    <thead><tr><th>Column</th><th>Type</th><th>Purpose</th></tr></thead>
    <tbody>
      <tr><td><code>git_branch</code></td><td>TEXT</td><td>Branch at write time — flags unmerged observations</td></tr>
      <tr><td><code>invalidated_at</code></td><td>INTEGER</td><td>Epoch when superseded (NULL = still valid)</td></tr>
      <tr><td><code>validation_status</code></td><td>TEXT</td><td><code>unvalidated</code> / <code>validated</code> / <code>invalidated</code></td></tr>
    </tbody>
  </table>

  <div class="callout success">
    <div class="callout-icon">✓</div>
    <div><strong>Safe default:</strong> <code>CLAUDE_MEM_PROVIDER</code> not set → ConflictDetector disabled, all observations pass as ADD. Set it in <code>~/.engram/settings.json</code> to enable classification.</div>
  </div>
</div>
```

- [ ] **Step 4.2: Verify in browser**

Navigate to Slide 3:
- Warning callout visible
- Two-column layout: pipeline steps left, four actions right
- Badges display in correct colors (green/yellow/red/purple)
- Provenance table renders correctly
- Success callout at bottom

- [ ] **Step 4.3: Commit**

```bash
git add docs/presentations/engram-developer-talk.html
git commit -m "feat: engram dev talk — slide 3: ConflictDetector deep-dive"
```

---

## Task 5: Slide 4 — Demo walkthrough

**Files:**
- Modify: `docs/presentations/engram-developer-talk.html` (fill `#slide-4`)

- [ ] **Step 5.1: Fill Slide 4 content**

Replace `<div id="slide-4" class="slide"></div>` with:

```html
<div id="slide-4" class="slide">
  <div class="eyebrow">Live demo</div>
  <h2>Demo walkthrough</h2>
  <p class="lead">Plugin pre-staged. We're narrating a running system.</p>

  <div class="grid-2">
    <div>
      <h3>Install (pre-staged)</h3>
      <div class="codeblock">
        <div class="codeblock-header"><span>Terminal</span></div>
        <pre>claude plugin marketplace add tsantana84/engram
claude plugin install engram
<span class="c-comment"># Restart Claude Code, then:</span>
/login
<span class="c-comment"># → enter agent name (e.g. "macbook-thiago")</span>
<span class="c-comment"># → machine registered, sync configured</span></pre>
      </div>

      <h3>Verify worker running</h3>
      <div class="codeblock">
        <div class="codeblock-header"><span>Health check</span></div>
        <pre>npm run worker:status
<span class="c-comment"># → { status: "ok", version: "..." }</span></pre>
      </div>
    </div>

    <div>
      <h3>What to show live</h3>
      <div class="card" style="margin-bottom:.75rem">
        <div style="font-size:.83rem;font-weight:600;color:var(--accent);margin-bottom:.25rem">1. Worker logs</div>
        <code style="font-size:.8rem">npm run worker:tail</code>
        <div style="font-size:.8rem;color:var(--text-muted);margin-top:.25rem">Observations flow in during a real prompt</div>
      </div>
      <div class="card" style="margin-bottom:.75rem">
        <div style="font-size:.83rem;font-weight:600;color:var(--accent);margin-bottom:.25rem">2. Viewer UI</div>
        <code style="font-size:.8rem">http://127.0.0.1:37777</code>
        <div style="font-size:.8rem;color:var(--text-muted);margin-top:.25rem">Real-time memory stream</div>
      </div>
      <div class="card" style="margin-bottom:.75rem">
        <div style="font-size:.83rem;font-weight:600;color:var(--accent);margin-bottom:.25rem">3. Sync queue</div>
        <code style="font-size:.78rem">sqlite3 ~/.engram/claude-mem.db<br>"SELECT * FROM sync_queue LIMIT 10"</code>
      </div>
      <div class="card">
        <div style="font-size:.83rem;font-weight:600;color:var(--accent);margin-bottom:.25rem">4. ConflictDetector (optional)</div>
        <div style="font-size:.8rem;color:var(--text-muted)">Point to a log line showing INVALIDATE action</div>
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 5.2: Verify in browser**

Navigate to Slide 4:
- Two-column layout: install code blocks left, live show steps right
- Code blocks readable with comment coloring
- Cards stack cleanly on the right

- [ ] **Step 5.3: Commit**

```bash
git add docs/presentations/engram-developer-talk.html
git commit -m "feat: engram dev talk — slide 4: demo walkthrough"
```

---

## Task 6: Slide 5 — Dev workflow + contributing

**Files:**
- Modify: `docs/presentations/engram-developer-talk.html` (fill `#slide-5`)

- [ ] **Step 6.1: Fill Slide 5 content**

Replace `<div id="slide-5" class="slide"></div>` with:

```html
<div id="slide-5" class="slide">
  <div class="eyebrow">Contributing</div>
  <h2>Dev workflow</h2>

  <div class="grid-2" style="margin-bottom:1.5rem">
    <div>
      <h3>Edit cycle</h3>
      <div class="codeblock">
        <div class="codeblock-header"><span>After editing src/</span></div>
        <pre>npm run build-and-sync
<span class="c-comment"># compile → sync to installed plugin → restart worker</span>

npm test
<span class="c-comment"># run test suite</span></pre>
      </div>

      <h3 style="margin-top:1rem">Backend deploy</h3>
      <div class="codeblock">
        <div class="codeblock-header"><span>Vercel</span></div>
        <pre>vercel --prod</pre>
      </div>
    </div>

    <div>
      <h3>Key files</h3>
      <table style="font-size:.82rem">
        <thead><tr><th>File</th><th>Role</th></tr></thead>
        <tbody>
          <tr><td><code>SessionStore.ts</code></td><td>SQLite layer, sync_queue enqueue</td></tr>
          <tr><td><code>SyncWorker.ts</code></td><td>30s sync loop</td></tr>
          <tr><td><code>ConflictDetector.ts</code></td><td>LLM-based classification</td></tr>
          <tr><td><code>SyncClient.ts</code></td><td>Vercel API client</td></tr>
          <tr><td><code>api/sync.ts</code></td><td>Vercel serverless function</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <h3>Upstream merge — divergence points</h3>
  <div class="callout warn">
    <div class="callout-icon">⚠️</div>
    <div style="font-size:.88rem">
      Any upstream claude-mem commit touching these files requires manual conflict resolution:<br><br>
      <code>src/shared/EnvManager.ts</code> · <code>src/services/sqlite/SessionStore.ts</code> ·
      <code>src/services/worker-service.ts</code> · <code>plugin/scripts/bun-runner.js</code>
      <br><br>
      Cherry-picks are safe on any other file.
    </div>
  </div>

  <div class="callout info" style="margin-top:.75rem">
    <div class="callout-icon">🔑</div>
    <div>API keys and team access: contact Thiago (@thedotmack)</div>
  </div>
</div>
```

- [ ] **Step 6.2: Verify in browser**

Navigate to Slide 5:
- Two-column: edit cycle code blocks left, key files table right
- Warning callout lists the 4 divergence files
- Info callout with API key contact at bottom

- [ ] **Step 6.3: Commit**

```bash
git add docs/presentations/engram-developer-talk.html
git commit -m "feat: engram dev talk — slide 5: dev workflow and contributing"
```

---

## Task 7: Slide 6 + FAQ overlay

**Files:**
- Modify: `docs/presentations/engram-developer-talk.html` (fill `#slide-6` and `#faq-overlay`)

- [ ] **Step 7.1: Fill Slide 6**

Replace `<div id="slide-6" class="slide"></div>` with:

```html
<div id="slide-6" class="slide">
  <div class="eyebrow">Discussion</div>
  <h2>Q&A</h2>
  <p class="lead">Questions? Press <kbd style="background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:.1rem .4rem;font-family:monospace">F</kbd> to open the FAQ panel.</p>

  <div class="grid-3">
    <div class="card">
      <h3>Privacy</h3>
      <p style="font-size:.88rem;color:var(--text-muted)">Wrap content in <code>&lt;private&gt;</code> tags — stripped before storage, never reaches SQLite or Supabase.</p>
    </div>
    <div class="card">
      <h3>Offline / outage</h3>
      <p style="font-size:.88rem;color:var(--text-muted)">Sync queue retries 5×. Local memory is unaffected. Works fully offline; syncs when Supabase is reachable.</p>
    </div>
    <div class="card">
      <h3>Data isolation</h3>
      <p style="font-size:.88rem;color:var(--text-muted)">Scoped per API key. Your key = your team's data only. No cross-team reads.</p>
    </div>
  </div>

  <div class="callout success" style="margin-top:1.5rem">
    <div class="callout-icon">✓</div>
    <div>Repo: <strong>github.com/tsantana84/engram</strong> · Backend: <strong>engram-ashy.vercel.app</strong></div>
  </div>
</div>
```

- [ ] **Step 7.2: Fill FAQ overlay**

Replace `<div id="faq-overlay"></div>` with:

```html
<div id="faq-overlay">
  <button class="faq-close" onclick="closeFaq()">✕ close (Esc)</button>
  <h2>FAQ</h2>

  <div class="faq-item">
    <div class="faq-q">What about private/sensitive content?</div>
    <div class="faq-a">Wrap content in <code>&lt;private&gt;&lt;/private&gt;</code> tags. The hook strips these before the observation reaches the worker — nothing sensitive enters SQLite or Supabase.</div>
  </div>

  <div class="faq-item">
    <div class="faq-q">What if Supabase is down?</div>
    <div class="faq-a">The sync_queue retries up to 5 times with backoff, then marks the entry as failed. Local memory in SQLite is completely unaffected. Engram continues working fully offline.</div>
  </div>

  <div class="faq-item">
    <div class="faq-q">Migrating from claude-mem?</div>
    <div class="faq-a">The setup wizard offers to migrate on first run. Or manually: <code>cp -r ~/.claude-mem ~/.engram</code>, then update <code>CLAUDE_MEM_DATA_DIR</code> in <code>~/.engram/settings.json</code>.</div>
  </div>

  <div class="faq-item">
    <div class="faq-q">How do I disable sync?</div>
    <div class="faq-a">Set <code>"CLAUDE_MEM_SYNC_ENABLED": "false"</code> in <code>~/.engram/settings.json</code>, then run <code>npm run worker:force-restart</code>.</div>
  </div>

  <div class="faq-item">
    <div class="faq-q">Who can see my observations?</div>
    <div class="faq-a">Only agents using the same API key. Keys are per-team. Supabase Row-Level Security enforces this at the database level.</div>
  </div>
</div>
```

- [ ] **Step 7.3: Verify in browser**

Navigate to Slide 6:
- Three-card grid visible (Privacy, Offline, Data isolation)
- Press `F`: FAQ overlay appears over slide, all 5 items visible
- Press `Esc` or `F` again: overlay closes
- Arrow keys do nothing while FAQ is open

- [ ] **Step 7.4: Commit**

```bash
git add docs/presentations/engram-developer-talk.html
git commit -m "feat: engram dev talk — slide 6: Q&A and FAQ overlay"
```

---

## Task 8: Final polish + cross-slide review

**Files:**
- Modify: `docs/presentations/engram-developer-talk.html`

- [ ] **Step 8.1: Full run-through in browser**

Start on Slide 1. Step through every slide with right arrow (advance flow animation on Slide 2 fully before moving on). Check:

| Slide | Check |
|-------|-------|
| 1 | Table renders, gradient on heading, callout visible |
| 2 | Each flow row animates in individually, callout appears after last row |
| 3 | Two-column layout, badges colored correctly, all three callouts visible |
| 4 | Two-column layout, code blocks readable |
| 5 | Two-column layout, key files table, two callouts |
| 6 | Three-card grid, FAQ overlay opens/closes with F/Esc |
| Nav | Title and counter update on every slide change |

- [ ] **Step 8.2: Check overflow on smaller viewport**

Resize browser to 1280×800. Verify no slide overflows vertically (content clips rather than overflows into next slide). If any slide overflows: reduce font sizes or padding on that slide.

- [ ] **Step 8.3: Verify no external dependencies**

```bash
grep -n "http\|https\|cdn\|//fonts\|src=" docs/presentations/engram-developer-talk.html | grep -v "engram-ashy\|tsantana84\|127.0.0.1\|localhost\|c-comment\|c-green\|c-blue"
```

Expected: no results (no CDN or external resource URLs).

- [ ] **Step 8.4: Final commit**

```bash
git add docs/presentations/engram-developer-talk.html
git commit -m "feat: engram dev talk — final polish and cross-slide verification"
```
