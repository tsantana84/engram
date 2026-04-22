# Sessions Brutalist Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the React SPA sessions viewer with a static HTML + vanilla JS page using the existing brutalist design system, and apply the same design to Vercel dashboard pages.

**Architecture:** Single self-contained `plugin/ui/sessions.html` file (no build step) served at `GET /`. Vanilla JS connects to existing SSE and REST API endpoints. Vercel dashboard pages get their CSS rewritten to match the brutalist token set from `ticks.html`/`admin.html`.

**Tech Stack:** HTML, vanilla JS (ES5-compatible, no modules), Courier New / Arial Black, SSE EventSource API, fetch + AbortController. No innerHTML with user data — all dynamic content uses `createElement` + `textContent`.

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `plugin/ui/sessions.html` | New sessions page — all CSS + JS inline |
| Modify | `src/services/worker/http/routes/ViewerRoutes.ts` | Serve `sessions.html` instead of `viewer.html` at `GET /` |
| Delete | `plugin/ui/viewer.html` | No longer served — replaced by sessions.html |
| Delete | `plugin/ui/viewer-bundle.js` | React bundle no longer needed |
| Modify | `public/dashboard/styles.css` | Brutalist restyle for Vercel learnings page |
| Modify | `public/dashboard/admin/styles.css` | Brutalist restyle for Vercel admin page |
| Modify | `public/dashboard/admin/index.html` | Update markup to match brutalist structure |

---

## Phase 1: sessions.html

### Task 1: Scaffold — HTML structure, CSS, global nav

**Files:**
- Create: `plugin/ui/sessions.html`

Reference: copy global nav CSS + HTML verbatim from `plugin/ui/ticks.html` lines 339–403 (`.g-nav` block). Brutalist design tokens:
```css
--black: #000; --white: #fff; --yellow: #f5e400;
--red: #ff2400; --green: #00b300; --dim: #666;
--bg: #f4f4f4; --border: 3px solid #000;
font-family: 'Courier New', Courier, monospace;
```

- [ ] Create `plugin/ui/sessions.html` with this full structure:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ENGRAM — SESSIONS</title>
  <style>
    /* === DESIGN TOKENS === */
    :root {
      --black: #000; --white: #fff; --yellow: #f5e400;
      --red: #ff2400; --green: #00b300; --dim: #666;
      --bg: #f4f4f4; --border: 3px solid #000;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Courier New', Courier, monospace;
      background: var(--bg); color: var(--black);
      font-size: 13px; line-height: 1.4;
    }

    /* === GLOBAL NAV === */
    .g-nav { display: flex; align-items: stretch; background: #000; border-bottom: 3px solid #000; font-family: 'Arial Black', Arial, sans-serif; }
    .g-nav-brand { font-size: 1rem; font-weight: 900; text-transform: uppercase; letter-spacing: 0.15em; color: #fff; padding: 0.9rem 1.5rem; border-right: 3px solid #222; white-space: nowrap; }
    .g-nav-brand span { color: #f5e400; }
    .g-nav-links { display: flex; }
    .g-nav-link { font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.12em; padding: 0 1.25rem; display: flex; align-items: center; color: #aaa; text-decoration: none; border-right: 2px solid #222; border-bottom: 3px solid transparent; }
    .g-nav-link:hover { color: #fff; background: #111; }
    .g-nav-link--active { color: #f5e400; background: #111; border-bottom-color: #f5e400; }
    .g-nav-right { margin-left: auto; display: flex; align-items: center; padding: 0 1rem; border-left: 2px solid #222; }
    .g-nav-status { font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.08em; padding: 3px 9px; }
    .g-nav-status--ok  { background: #00b300; color: #fff; }
    .g-nav-status--err { background: #ff2400; color: #fff; }
    .g-nav-status--loading { background: #666; color: #fff; }

    /* === CONTROL BAR === */
    .control-bar {
      background: var(--white);
      border-bottom: var(--border);
      padding: 8px 20px;
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      position: sticky;
      top: 52px;
      z-index: 90;
    }
    .control-label {
      font-family: 'Arial Black', Arial, sans-serif;
      font-size: 10px; font-weight: 900;
      text-transform: uppercase; letter-spacing: 0.1em;
    }
    .control-select {
      font-family: 'Courier New', Courier, monospace;
      font-size: 12px;
      border: 2px solid var(--black);
      background: var(--white);
      padding: 3px 6px;
      cursor: pointer;
    }
    .live-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--dim); margin-right: 4px; vertical-align: middle; }
    .live-dot--on  { background: var(--green); }
    .live-dot--off { background: var(--red); }
    .processing-pill {
      font-family: 'Arial Black', Arial, sans-serif;
      font-size: 10px; font-weight: 900; text-transform: uppercase;
      background: var(--yellow); color: var(--black);
      border: 2px solid var(--black); padding: 2px 8px;
      display: none;
    }
    .processing-pill--visible { display: inline-block; }

    /* === FEED === */
    .feed { max-width: 900px; margin: 0 auto; padding: 16px 20px; }

    /* === CARDS === */
    .card {
      background: var(--white); border: var(--border);
      border-left-width: 5px; margin-bottom: 12px; padding: 12px 14px;
    }
    .card--discovery { border-left-color: var(--yellow); }
    .card--bugfix    { border-left-color: var(--red); }
    .card--feature   { border-left-color: var(--green); }
    .card--default   { border-left-color: #333; }
    .card--summary   { border-left-color: var(--green); }
    .card--prompt    { border-left-color: #333; }

    .card-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 6px; gap: 8px; }
    .card-badges { display: flex; gap: 4px; flex-wrap: wrap; }
    .badge {
      font-family: 'Arial Black', Arial, sans-serif;
      font-size: 9px; font-weight: 900; text-transform: uppercase;
      letter-spacing: 0.08em; border: 2px solid var(--black);
      padding: 1px 5px; white-space: nowrap;
    }
    .badge--type-discovery { background: var(--yellow); }
    .badge--type-bugfix    { background: var(--red); color: var(--white); }
    .badge--type-feature   { background: var(--green); color: var(--white); }
    .badge--type-default   { background: #eee; }
    .badge--source  { background: #eee; }
    .badge--project { background: var(--black); color: var(--white); }

    .card-toggles { display: flex; gap: 4px; flex-shrink: 0; }
    .toggle-btn {
      font-family: 'Arial Black', Arial, sans-serif;
      font-size: 9px; font-weight: 900; text-transform: uppercase;
      letter-spacing: 0.06em; border: 2px solid var(--black);
      background: var(--white); padding: 2px 6px; cursor: pointer;
    }
    .toggle-btn--active { background: var(--black); color: var(--white); }

    .card-title { font-family: 'Arial Black', Arial, sans-serif; font-size: 13px; font-weight: 900; margin-bottom: 4px; line-height: 1.3; }
    .card-subtitle { color: #333; margin-bottom: 6px; font-size: 12px; }
    .card-narrative { color: #333; font-size: 12px; line-height: 1.5; white-space: pre-wrap; }

    .facts-list { margin: 6px 0 6px 14px; }
    .facts-list li { font-size: 12px; margin-bottom: 2px; }
    .concepts-row, .files-row { margin-top: 4px; font-size: 11px; color: var(--dim); }
    .files-label { font-weight: bold; }

    .summary-section { margin-bottom: 4px; font-size: 12px; }
    .summary-section-label { font-family: 'Arial Black', Arial, sans-serif; font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.06em; margin-right: 4px; }

    .prompt-text {
      font-family: 'Courier New', Courier, monospace; font-size: 12px;
      background: #f0f0f0; border: 1px solid #ccc; padding: 8px;
      margin-top: 6px; white-space: pre-wrap; word-break: break-word;
    }

    .card-meta { border-top: 1px solid #ddd; margin-top: 8px; padding-top: 6px; font-size: 11px; color: var(--dim); }

    /* === LOAD MORE === */
    .load-more-row { text-align: center; padding: 16px 0; }
    .load-more-btn {
      font-family: 'Arial Black', Arial, sans-serif; font-size: 11px;
      font-weight: 900; text-transform: uppercase; letter-spacing: 0.1em;
      background: var(--black); color: var(--white);
      border: var(--border); padding: 8px 24px; cursor: pointer;
    }
    .load-more-btn:hover { background: #333; }
    .load-more-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    /* === EMPTY / STATUS === */
    .empty-state {
      text-align: center; padding: 48px 20px; color: var(--dim);
      font-family: 'Arial Black', Arial, sans-serif;
      font-size: 12px; font-weight: 900;
      text-transform: uppercase; letter-spacing: 0.1em;
    }
  </style>
</head>
<body>
  <nav class="g-nav">
    <div class="g-nav-brand">⬡ Engram <span>Worker</span></div>
    <div class="g-nav-links">
      <a class="g-nav-link g-nav-link--active" href="/">Sessions</a>
      <a class="g-nav-link" href="/admin">Admin</a>
      <a class="g-nav-link" href="/ticks">Ticks</a>
    </div>
    <div class="g-nav-right">
      <span class="g-nav-status g-nav-status--loading" id="g-nav-status">…</span>
    </div>
  </nav>

  <div class="control-bar">
    <span class="control-label">Project</span>
    <select class="control-select" id="project-filter">
      <option value="">ALL PROJECTS</option>
    </select>
    <span class="control-label">Source</span>
    <select class="control-select" id="source-filter">
      <option value="">ALL SOURCES</option>
    </select>
    <span id="live-indicator">
      <span class="live-dot" id="live-dot"></span>
      <span id="live-text">CONNECTING</span>
    </span>
    <span class="processing-pill" id="processing-pill">PROCESSING</span>
  </div>

  <main class="feed" id="feed">
    <div class="empty-state" id="loading-state">Connecting…</div>
  </main>

  <script>
    /* ALL JS — added in Tasks 2–4 */
  </script>
  <script>
    /* Nav health check */
    (function(){
      fetch('/health').then(function(r){ return r.ok ? r.json() : null; }).then(function(d){
        var el = document.getElementById('g-nav-status');
        if(d){ el.textContent='OK'; el.className='g-nav-status g-nav-status--ok'; }
        else { el.textContent='DOWN'; el.className='g-nav-status g-nav-status--err'; }
      }).catch(function(){
        var el=document.getElementById('g-nav-status');
        el.textContent='DOWN'; el.className='g-nav-status g-nav-status--err';
      });
    })();
  </script>
</body>
</html>
```

- [ ] Open browser at `http://localhost:37777/sessions.html` (served by express.static from `plugin/ui/` — testing static file directly, not the `GET /` route yet)

- [ ] Verify: global nav renders, Sessions link is active (yellow), control bar visible, empty state shows "Connecting…"

- [ ] Commit:

```bash
git add plugin/ui/sessions.html
git commit -m "feat(ui): scaffold sessions.html brutalist shell"
```

---

### Task 2: SSE connection — live feed, reconnect, processing indicator

**Files:**
- Modify: `plugin/ui/sessions.html` (replace `/* ALL JS */` script block)

SSE events from `/stream`:
- `initial_load` → `{ projects, sources }` — **overwrite** filter selects (idempotent; server broadcasts to ALL clients, so duplicates are normal)
- `new_observation` → prepend card
- `new_summary` → prepend card
- `new_prompt` → prepend card
- `processing_status` → `{ isProcessing, queueDepth }` — update pill
- Other types (`session_started`, `observation_queued`, `session_completed`) → ignore

On SSE error: set indicator to OFFLINE, retry with exponential backoff (1000ms → 2000ms → … → 30000ms cap).

- [ ] Replace `/* ALL JS */` script block with:

```js
(function () {
  'use strict';

  /* ── State ── */
  var state = {
    project: '',
    source:  '',
    obs: { offset: 0, hasMore: true },
    sum: { offset: 0, hasMore: true },
    prm: { offset: 0, hasMore: true },
    items:   [],
    loading: false,
    abortCtrl: null,
  };
  var sseRetryDelay = 1000;
  var sseTimer = null;
  var es = null;

  /* ── DOM refs ── */
  var feed           = document.getElementById('feed');
  var loadingState   = document.getElementById('loading-state');
  var projectSel     = document.getElementById('project-filter');
  var sourceSel      = document.getElementById('source-filter');
  var liveDot        = document.getElementById('live-dot');
  var liveText       = document.getElementById('live-text');
  var processingPill = document.getElementById('processing-pill');

  /* ── SSE ── */
  function connectSSE() {
    if (es) { es.close(); }
    es = new EventSource('/stream');

    es.onopen = function () {
      sseRetryDelay = 1000;
      setLive(true);
    };

    es.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      handleSSEMessage(msg);
    };

    es.onerror = function () {
      es.close();
      es = null;
      setLive(false);
      sseTimer = setTimeout(connectSSE, sseRetryDelay);
      sseRetryDelay = Math.min(sseRetryDelay * 2, 30000);
    };
  }

  function handleSSEMessage(msg) {
    switch (msg.type) {
      case 'initial_load':
        populateFilters(msg.projects || [], msg.sources || []);
        break;
      case 'new_observation':
        if (msg.observation) prependItem(msg.observation, 'observation');
        break;
      case 'new_summary':
        if (msg.summary) prependItem(msg.summary, 'summary');
        break;
      case 'new_prompt':
        if (msg.prompt) prependItem(msg.prompt, 'prompt');
        break;
      case 'processing_status':
        updateProcessing(msg.isProcessing, msg.queueDepth);
        break;
      default:
        break;
    }
  }

  function setLive(on) {
    liveDot.className = 'live-dot ' + (on ? 'live-dot--on' : 'live-dot--off');
    liveText.textContent = on ? 'LIVE' : 'OFFLINE';
  }

  function updateProcessing(isProcessing, queueDepth) {
    if (isProcessing || queueDepth > 0) {
      processingPill.textContent = 'PROCESSING' + (queueDepth > 0 ? ' (' + queueDepth + ')' : '');
      processingPill.className = 'processing-pill processing-pill--visible';
    } else {
      processingPill.className = 'processing-pill';
    }
  }

  /* ── Filter population — overwrite, never append ── */
  function populateFilters(projects, sources) {
    var curProject = projectSel.value;
    var curSource  = sourceSel.value;

    while (projectSel.firstChild) projectSel.removeChild(projectSel.firstChild);
    var defaultProj = document.createElement('option');
    defaultProj.value = ''; defaultProj.textContent = 'ALL PROJECTS';
    projectSel.appendChild(defaultProj);
    projects.forEach(function (p) {
      var o = document.createElement('option');
      o.value = p; o.textContent = p;
      if (p === curProject) o.selected = true;
      projectSel.appendChild(o);
    });

    while (sourceSel.firstChild) sourceSel.removeChild(sourceSel.firstChild);
    var defaultSrc = document.createElement('option');
    defaultSrc.value = ''; defaultSrc.textContent = 'ALL SOURCES';
    sourceSel.appendChild(defaultSrc);
    sources.forEach(function (s) {
      var o = document.createElement('option');
      o.value = s; o.textContent = s;
      if (s === curSource) o.selected = true;
      sourceSel.appendChild(o);
    });
  }

  /* ── Prepend live SSE item to top of feed ── */
  function prependItem(data, type) {
    if (state.project && data.project !== state.project) return;
    if (state.source  && (data.platform_source || 'claude') !== state.source) return;

    var card = renderCard(data, type);
    if (!card) return;

    if (loadingState && loadingState.parentNode === feed) {
      feed.removeChild(loadingState);
    }

    var firstCard = feed.querySelector('.card');
    if (firstCard) {
      feed.insertBefore(card, firstCard);
    } else {
      var loadMoreRow = feed.querySelector('.load-more-row');
      feed.insertBefore(card, loadMoreRow || null);
    }
  }

  /* ── Filter change ── */
  projectSel.addEventListener('change', function () {
    state.project = projectSel.value;
    resetAndReload();
  });
  sourceSel.addEventListener('change', function () {
    state.source = sourceSel.value;
    resetAndReload();
  });

  function resetAndReload() {
    if (state.abortCtrl) state.abortCtrl.abort();
    state.obs = { offset: 0, hasMore: true };
    state.sum = { offset: 0, hasMore: true };
    state.prm = { offset: 0, hasMore: true };
    state.items = [];
    while (feed.firstChild) feed.removeChild(feed.firstChild);
    loadingState.textContent = 'Loading…';
    feed.appendChild(loadingState);
    loadPage();
  }

  /* ── Stubs — filled in Tasks 3 & 4 ── */
  function renderCard(data, type) { return null; /* Task 3 */ }
  function loadPage() { /* Task 4 */ }

  /* ── Boot ── */
  /* Note: filter population comes exclusively from SSE initial_load event.
     GET /api/projects is NOT called — initial_load delivers the same data
     and handles reconnect refreshes automatically. */
  connectSSE();
  loadPage();

})();
```

- [ ] Open browser, open DevTools → Network tab. Reload page. Confirm `/stream` EventSource connection established and stays open.

- [ ] Verify live indicator shows green dot + "LIVE" text after connection.

- [ ] Verify processing pill hidden when queue idle.

- [ ] Commit:

```bash
git add plugin/ui/sessions.html
git commit -m "feat(ui): SSE connection, live indicator, filter population"
```

---

### Task 3: Card renderers — observation, summary, prompt

**Files:**
- Modify: `plugin/ui/sessions.html` — replace `renderCard` stub

**Security rule**: Never use innerHTML with data from the server. All card content uses `createElement` + `textContent`.

- [ ] Replace the `renderCard` stub (and the two helper stubs before it) with:

```js
  /* ── DOM helpers ── */
  function mkEl(tag, className) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    return e;
  }
  function mkText(tag, className, text) {
    var e = mkEl(tag, className);
    e.textContent = text;
    return e;
  }

  /* ── Formatters ── */
  function formatEpoch(epochMs) {
    return new Date(epochMs).toLocaleString([], {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
  }

  function safeJSON(str) {
    if (!str) return [];
    try { var v = JSON.parse(str); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }

  function stripRoot(fp) {
    var markers = ['/Scripts/', '/src/', '/plugin/', '/docs/'];
    for (var i = 0; i < markers.length; i++) {
      var idx = fp.indexOf(markers[i]);
      if (idx !== -1) return fp.substring(idx + 1);
    }
    var parts = fp.split('/');
    return parts.length > 3 ? parts.slice(-3).join('/') : fp;
  }

  /* ── renderCard dispatcher ── */
  function renderCard(data, type) {
    if (type === 'observation') return renderObservation(data);
    if (type === 'summary')     return renderSummary(data);
    if (type === 'prompt')      return renderPrompt(data);
    return null;
  }

  /* ── Observation card ── */
  function renderObservation(obs) {
    var typeMap = { discovery: 'card--discovery', bugfix: 'card--bugfix', feature: 'card--feature' };
    var card = mkEl('div', 'card ' + (typeMap[obs.type] || 'card--default'));

    /* Header row */
    var header = mkEl('div', 'card-header');
    var badges = mkEl('div', 'card-badges');

    var typeCls = 'badge badge--type-' + (obs.type || 'default');
    badges.appendChild(mkText('span', typeCls, (obs.type || 'obs').toUpperCase()));
    badges.appendChild(mkText('span', 'badge badge--source', (obs.platform_source || 'claude').toUpperCase()));
    badges.appendChild(mkText('span', 'badge badge--project', obs.project || '—'));
    header.appendChild(badges);

    /* Toggle buttons — only if content exists */
    var facts    = safeJSON(obs.facts);
    var concepts = safeJSON(obs.concepts);
    var filesR   = safeJSON(obs.files_read).map(stripRoot);
    var filesM   = safeJSON(obs.files_modified).map(stripRoot);
    var hasFacts = facts.length > 0 || concepts.length > 0 || filesR.length > 0 || filesM.length > 0;
    var hasNarr  = obs.narrative && obs.narrative.trim().length > 0;

    var toggles  = mkEl('div', 'card-toggles');
    var factsBtn = null;
    var narrBtn  = null;

    if (hasFacts) {
      factsBtn = mkText('button', 'toggle-btn', 'FACTS');
      factsBtn.type = 'button';
      toggles.appendChild(factsBtn);
    }
    if (hasNarr) {
      narrBtn = mkText('button', 'toggle-btn', 'NARRATIVE');
      narrBtn.type = 'button';
      toggles.appendChild(narrBtn);
    }
    header.appendChild(toggles);
    card.appendChild(header);

    /* Title */
    card.appendChild(mkText('div', 'card-title', obs.title || 'Untitled'));

    /* Content panels */
    var subtitleEl  = mkText('div', 'card-subtitle', obs.subtitle || '');
    var factsPanel  = mkEl('div', 'facts-panel');
    var narrPanel   = mkEl('div', 'narrative-panel');
    factsPanel.style.display = 'none';
    narrPanel.style.display  = 'none';

    /* Build facts panel */
    if (hasFacts) {
      if (facts.length > 0) {
        var ul = mkEl('ul', 'facts-list');
        facts.forEach(function (f) { ul.appendChild(mkText('li', null, String(f))); });
        factsPanel.appendChild(ul);
      }
      if (concepts.length > 0) {
        factsPanel.appendChild(mkText('div', 'concepts-row', 'Concepts: ' + concepts.join(', ')));
      }
      if (filesR.length > 0) {
        var fr = mkEl('div', 'files-row');
        fr.appendChild(mkText('span', 'files-label', 'Read: '));
        fr.appendChild(document.createTextNode(filesR.join(', ')));
        factsPanel.appendChild(fr);
      }
      if (filesM.length > 0) {
        var fm = mkEl('div', 'files-row');
        fm.appendChild(mkText('span', 'files-label', 'Modified: '));
        fm.appendChild(document.createTextNode(filesM.join(', ')));
        factsPanel.appendChild(fm);
      }
    }

    /* Build narrative panel */
    if (hasNarr) {
      narrPanel.appendChild(mkText('div', 'card-narrative', obs.narrative));
    }

    card.appendChild(subtitleEl);
    card.appendChild(factsPanel);
    card.appendChild(narrPanel);

    /* Toggle interaction — mutually exclusive */
    if (factsBtn) {
      factsBtn.addEventListener('click', function () {
        var on = factsPanel.style.display !== 'none';
        factsPanel.style.display  = on ? 'none' : 'block';
        subtitleEl.style.display  = on ? ''     : 'none';
        narrPanel.style.display   = 'none';
        if (narrBtn) narrBtn.className = 'toggle-btn';
        factsBtn.className = 'toggle-btn' + (on ? '' : ' toggle-btn--active');
      });
    }
    if (narrBtn) {
      narrBtn.addEventListener('click', function () {
        var on = narrPanel.style.display !== 'none';
        narrPanel.style.display  = on ? 'none' : 'block';
        subtitleEl.style.display = on ? ''     : 'none';
        factsPanel.style.display = 'none';
        if (factsBtn) factsBtn.className = 'toggle-btn';
        narrBtn.className = 'toggle-btn' + (on ? '' : ' toggle-btn--active');
      });
    }

    /* Meta footer */
    card.appendChild(mkText('div', 'card-meta', '#' + obs.id + ' • ' + formatEpoch(obs.created_at_epoch)));
    return card;
  }

  /* ── Summary card ── */
  function renderSummary(sum) {
    var card = mkEl('div', 'card card--summary');

    var header = mkEl('div', 'card-header');
    var badges = mkEl('div', 'card-badges');
    badges.appendChild(mkText('span', 'badge badge--type-feature', 'SUMMARY'));
    badges.appendChild(mkText('span', 'badge badge--project', sum.project || '—'));
    header.appendChild(badges);
    header.appendChild(mkText('span', 'card-meta', formatEpoch(sum.created_at_epoch)));
    card.appendChild(header);

    var sections = [
      { key: 'request',      label: 'Request' },
      { key: 'investigated', label: 'Investigated' },
      { key: 'learned',      label: 'Learned' },
      { key: 'completed',    label: 'Completed' },
      { key: 'next_steps',   label: 'Next Steps' },
    ];
    sections.forEach(function (s) {
      var val = sum[s.key];
      if (!val || !String(val).trim()) return;
      var row = mkEl('div', 'summary-section');
      row.appendChild(mkText('span', 'summary-section-label', '▸ ' + s.label + ':'));
      row.appendChild(document.createTextNode(' ' + val));
      card.appendChild(row);
    });

    return card;
  }

  /* ── Prompt card ── */
  function renderPrompt(prm) {
    var card = mkEl('div', 'card card--prompt');

    var header = mkEl('div', 'card-header');
    var badges = mkEl('div', 'card-badges');
    badges.appendChild(mkText('span', 'badge badge--type-default', 'PROMPT'));
    badges.appendChild(mkText('span', 'badge badge--project', prm.project || '—'));
    badges.appendChild(mkText('span', 'badge badge--source', (prm.platform_source || 'claude').toUpperCase()));
    header.appendChild(badges);
    header.appendChild(mkText('span', 'card-meta', formatEpoch(prm.created_at_epoch)));
    card.appendChild(header);
    card.appendChild(mkText('div', 'prompt-text', prm.prompt_text || ''));
    return card;
  }
```

- [ ] Open browser console and test observation card:
  ```js
  prependItem({id:1,type:'discovery',project:'test',title:'Hello World',subtitle:'Sub text',created_at_epoch:Date.now(),platform_source:'claude',facts:'["fact one","fact two"]',narrative:'This is narrative.',concepts:'[]',files_read:'[]',files_modified:'[]'},'observation');
  ```

- [ ] Verify: yellow left border, DISCOVERY badge, title, subtitle visible. FACTS and NARRATIVE toggle buttons present.

- [ ] Click FACTS: subtitle hides, facts list shows. Click FACTS again: facts hide, subtitle returns.

- [ ] Click NARRATIVE: narrative text shows. Click FACTS: narrative hides, facts show (mutually exclusive).

- [ ] Test with null facts (no toggles should appear):
  ```js
  prependItem({id:2,type:'bugfix',project:'test',title:'Fixed Bug',subtitle:'fix',created_at_epoch:Date.now()-1000,platform_source:'claude',facts:null,narrative:null},'observation');
  ```
  Verify: no toggle buttons, red left border.

- [ ] Test summary card:
  ```js
  prependItem({project:'test',created_at_epoch:Date.now()-2000,request:'Build X',learned:'Y works',completed:'',next_steps:'',investigated:''},'summary');
  ```
  Verify: only "Request" and "Learned" sections visible.

- [ ] Test prompt card:
  ```js
  prependItem({project:'test',created_at_epoch:Date.now()-3000,prompt_text:'What is the plan?',platform_source:'claude'},'prompt');
  ```

- [ ] Commit:

```bash
git add plugin/ui/sessions.html
git commit -m "feat(ui): observation, summary, prompt card renderers"
```

---

### Task 4: Data load — fetch, merge/sort, Load More, AbortController

**Files:**
- Modify: `plugin/ui/sessions.html` — replace `loadPage` stub

API: `GET /api/observations?offset=N&limit=50&project=P&platformSource=S`
Response: `{ observations: [...] }` / `{ summaries: [...] }` / `{ prompts: [...] }`
`limit` is capped at 100 server-side; use 50.

- [ ] Replace `function loadPage() { /* Task 4 */ }` with:

```js
  var LIMIT = 50;

  function buildQuery(offset) {
    var q = '?offset=' + offset + '&limit=' + LIMIT;
    if (state.project) q += '&project='       + encodeURIComponent(state.project);
    if (state.source)  q += '&platformSource=' + encodeURIComponent(state.source);
    return q;
  }

  function loadPage() {
    if (state.loading) return;
    state.loading = true;

    if (state.abortCtrl) state.abortCtrl.abort();
    state.abortCtrl = new AbortController();
    var signal = state.abortCtrl.signal;

    var fetches = [];

    if (state.obs.hasMore) fetches.push(
      fetch('/api/observations' + buildQuery(state.obs.offset), { signal })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var items = d.observations || [];
          if (items.length < LIMIT) state.obs.hasMore = false;
          state.obs.offset += items.length;
          return items.map(function (o) { return Object.assign({}, o, { _type: 'observation' }); });
        })
    );

    if (state.sum.hasMore) fetches.push(
      fetch('/api/summaries' + buildQuery(state.sum.offset), { signal })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var items = d.summaries || [];
          if (items.length < LIMIT) state.sum.hasMore = false;
          state.sum.offset += items.length;
          return items.map(function (s) { return Object.assign({}, s, { _type: 'summary' }); });
        })
    );

    if (state.prm.hasMore) fetches.push(
      fetch('/api/prompts' + buildQuery(state.prm.offset), { signal })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var items = d.prompts || [];
          if (items.length < LIMIT) state.prm.hasMore = false;
          state.prm.offset += items.length;
          return items.map(function (p) { return Object.assign({}, p, { _type: 'prompt' }); });
        })
    );

    if (!fetches.length) {
      state.loading = false;
      renderFeed();
      return;
    }

    Promise.all(fetches)
      .then(function (results) {
        var newItems = [];
        results.forEach(function (r) { newItems = newItems.concat(r); });
        state.items = state.items.concat(newItems);
        state.items.sort(function (a, b) { return b.created_at_epoch - a.created_at_epoch; });
        state.loading = false;
        renderFeed();
      })
      .catch(function (err) {
        if (err.name === 'AbortError') return;
        state.loading = false;
        renderFeed();
      });
  }

  function clearFeed() {
    while (feed.firstChild) feed.removeChild(feed.firstChild);
  }

  function renderFeed() {
    if (loadingState && loadingState.parentNode === feed) {
      feed.removeChild(loadingState);
    }
    clearFeed();

    if (state.items.length === 0) {
      feed.appendChild(mkText('div', 'empty-state', 'No items found.'));
      return;
    }

    state.items.forEach(function (item) {
      var card = renderCard(item, item._type);
      if (card) feed.appendChild(card);
    });

    var hasMore = state.obs.hasMore || state.sum.hasMore || state.prm.hasMore;
    if (hasMore) {
      var row = mkEl('div', 'load-more-row');
      var btn = mkText('button', 'load-more-btn', 'LOAD MORE');
      btn.type = 'button';
      btn.addEventListener('click', function () {
        btn.disabled = true;
        btn.textContent = 'LOADING…';
        loadPage();
      });
      row.appendChild(btn);
      feed.appendChild(row);
    } else {
      var endRow = mkEl('div', 'load-more-row');
      endRow.appendChild(mkText('span', null, '— END —'));
      feed.appendChild(endRow);
    }
  }
```

- [ ] Reload page. Confirm three API calls in DevTools Network (`/api/observations`, `/api/summaries`, `/api/prompts`).

- [ ] Verify feed renders cards sorted newest-first.

- [ ] If >50 total items: "LOAD MORE" button appears. Click it → next batch appends, feed re-renders.

- [ ] Change project filter → verify feed clears, reloads with filtered results only.

- [ ] Change filter rapidly (3× in quick succession) → only last filter result populates feed (AbortController cancels stale requests).

- [ ] Commit:

```bash
git add plugin/ui/sessions.html
git commit -m "feat(ui): paginated data load, load more, AbortController filter guard"
```

---

### Task 5: Wire ViewerRoutes.ts + cleanup

**Files:**
- Modify: `src/services/worker/http/routes/ViewerRoutes.ts`
- Delete: `plugin/ui/viewer.html`
- Delete: `plugin/ui/viewer-bundle.js`

- [ ] Open `src/services/worker/http/routes/ViewerRoutes.ts`. In `handleViewerUI`, update both candidate paths:

```ts
// Before:
const viewerPaths = [
  path.join(packageRoot, 'ui', 'viewer.html'),
  path.join(packageRoot, 'plugin', 'ui', 'viewer.html')
];

// After:
const viewerPaths = [
  path.join(packageRoot, 'ui', 'sessions.html'),
  path.join(packageRoot, 'plugin', 'ui', 'sessions.html')
];
```

- [ ] Update the error message in the throw to reference `sessions.html`:

```ts
throw new Error('Sessions UI not found at any expected location');
```

- [ ] Delete dead files:

```bash
rm plugin/ui/viewer.html plugin/ui/viewer-bundle.js
```

- [ ] Check if `package.json` build scripts reference `viewer.html` or `viewer-bundle`:

```bash
grep -n "viewer" package.json
```

  If a build script outputs `viewer.html`, note it is now unused. Do not remove React source from `src/ui/viewer/` — leave it in place (reference / future use), just stop building it if the build step is separable.

- [ ] Run build and sync:

```bash
npm run build-and-sync
```

- [ ] Open `http://localhost:37777/`. Verify sessions page loads (not React app).

- [ ] Verify global nav present, SSE connects (green dot), feed loads.

- [ ] Navigate to `/admin` and `/ticks` — verify those pages still work.

- [ ] Commit:

```bash
git add src/services/worker/http/routes/ViewerRoutes.ts
git rm plugin/ui/viewer.html plugin/ui/viewer-bundle.js
git add plugin/ui/sessions.html
git commit -m "feat(ui): serve sessions.html at GET /, remove React viewer bundle"
```

---

### Task 6: Final smoke test (local)

No code changes. Verification gate.

- [ ] `http://localhost:37777/` → brutalist sessions feed loads.

- [ ] SSE live indicator → green "LIVE".

- [ ] Feed contains cards, sorted newest-first.

- [ ] Trigger live update: run any Claude Code command in a tracked project. New observation card prepends without page refresh.

- [ ] Project filter → works, feed resets.

- [ ] Source filter → works, feed resets.

- [ ] Observation with facts → FACTS toggle shows/hides correctly.

- [ ] Observation with null facts → no toggle button.

- [ ] Summary card → only non-empty sections visible.

- [ ] Global nav active: Sessions=yellow, Admin=grey, Ticks=grey.

- [ ] `/admin` link → admin page loads with brutalist design.

- [ ] `/ticks` link → ticks page loads with brutalist design.

- [ ] Run test suite — all API/worker tests pass:

```bash
npm test
```

Expected: same pass count as before (1504 tests, 0 failures). UI changes don't affect test suite.

---

## Phase 2: Vercel dashboard pages

### Task 7: Restyle public/dashboard/styles.css

**Files:**
- Modify: `public/dashboard/styles.css`

The existing file already has brutalist vars. Goal: align gaps — `--bg: #f4f4f4`, 3px borders on cards, brutalist button style. Keep all existing class names (JS in `app.js` references them).

- [ ] Read `public/dashboard/styles.css` and `public/dashboard/app.js` in full to confirm class names used in JS before touching CSS.

- [ ] Apply these targeted changes to `public/dashboard/styles.css`:

1. `body` background: change `var(--white)` → `#f4f4f4`
2. Find `.card` selector — update `border` to `3px solid var(--black)`, add `border-radius: 0`
3. Find confidence-based border-left colors — keep high=green, medium=yellow, low=red
4. `button` selectors — add `font-family: var(--font-sans)`, `font-weight: 900`, `border-radius: 0`, `border: 2px solid var(--black)`
5. `select`, `input` — `font-family: var(--font-mono)`, `border: 2px solid var(--black)`, `border-radius: 0`
6. `header h1` — `font-family: var(--font-sans)`, `text-transform: uppercase`

- [ ] Open the dashboard page in browser. Verify: background is off-white, cards have 3px black borders, buttons match brutalist style.

- [ ] Verify all learnings actions (approve/reject/edit) still function (JS unchanged).

- [ ] Commit:

```bash
git add public/dashboard/styles.css
git commit -m "feat(ui): brutalist CSS alignment for Vercel learnings dashboard"
```

---

### Task 8: Restyle Vercel admin page

**Files:**
- Modify: `public/dashboard/admin/styles.css` (full replacement)
- Modify: `public/dashboard/admin/index.html` (header only)

Current admin CSS uses dark mode (`#0f0f0f` background). Replace with brutalist light style. Keep all class names used by `admin.js`.

- [ ] Read `public/dashboard/admin/admin.js` to confirm class names before editing CSS.

- [ ] Replace `public/dashboard/admin/styles.css` entirely with:

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --black: #000; --white: #fff; --yellow: #f5e400;
  --red: #ff2400; --green: #00b300; --dim: #666;
  --bg: #f4f4f4; --border: 3px solid #000;
  --font-mono: 'Courier New', Courier, monospace;
  --font-sans: 'Arial Black', Arial, sans-serif;
}
body { font-family: var(--font-mono); background: var(--bg); color: var(--black); font-size: 13px; line-height: 1.4; }
header { background: var(--black); color: var(--white); padding: 12px 20px; display: flex; align-items: center; justify-content: space-between; border-bottom: var(--border); }
header h1 { font-family: var(--font-sans); font-size: 16px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.1em; }
nav { display: flex; gap: 12px; align-items: center; }
nav a { color: #aaa; text-decoration: none; font-size: 11px; font-family: var(--font-sans); font-weight: 900; text-transform: uppercase; }
nav a:hover { color: var(--white); }
button { font-family: var(--font-sans); font-size: 11px; font-weight: 900; text-transform: uppercase; background: var(--white); color: var(--black); border: 2px solid var(--black); padding: 4px 12px; cursor: pointer; }
button:hover { background: var(--yellow); }
button:disabled { opacity: 0.4; cursor: not-allowed; }
section { background: var(--white); border: var(--border); margin: 12px 20px; padding: 12px 16px; }
h2 { font-family: var(--font-sans); font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px; border-bottom: 2px solid var(--black); padding-bottom: 4px; }
.fetched-at { font-size: 11px; color: var(--dim); padding: 8px 20px; }
.stat-row { display: flex; gap: 16px; flex-wrap: wrap; font-size: 12px; margin-bottom: 6px; }
.approved { color: var(--green); font-weight: bold; }
.rejected { color: var(--red); font-weight: bold; }
.pending  { color: #c88000; font-weight: bold; }
.confidence-bar { display: flex; gap: 12px; font-size: 11px; margin-top: 4px; }
.high   { color: var(--green); font-weight: bold; }
.medium { color: #c88000; }
.low    { color: var(--red); }
.agent-row { padding: 6px 0; border-bottom: 2px solid #ddd; font-size: 12px; }
.agent-row:last-child { border-bottom: none; }
.agent-name { font-family: var(--font-sans); font-weight: 900; font-size: 11px; text-transform: uppercase; }
.agent-meta, .agent-counts { color: var(--dim); font-size: 11px; margin-top: 2px; }
.sync-row { display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 2px solid #ddd; font-size: 12px; }
.sync-row:last-child { border-bottom: none; }
.green  { color: var(--green); font-weight: bold; }
.yellow { color: #c88000; font-weight: bold; }
.red    { color: var(--red); font-weight: bold; }
.unavailable, .empty { color: var(--dim); font-size: 11px; }
.error { color: var(--red); font-size: 12px; margin-top: 6px; }
#tokenForm { max-width: 400px; background: var(--white); border: var(--border); padding: 20px; margin: 20px; }
#tokenForm label { display: block; margin-bottom: 6px; font-size: 11px; font-family: var(--font-sans); font-weight: 900; text-transform: uppercase; }
#tokenInput { width: 100%; padding: 6px; border: 2px solid var(--black); font-family: var(--font-mono); font-size: 12px; margin-bottom: 10px; background: var(--bg); }
#content { padding: 4px 0; }
#globalError { color: var(--red); font-size: 12px; padding: 12px 20px; }
```

- [ ] Update `public/dashboard/admin/index.html` header only:

```html
<header>
  <h1>⬡ ENGRAM / ADMIN</h1>
  <nav>
    <a href="/dashboard/" id="reviewLink">← Learnings</a>
    <button id="refreshBtn">↻ Refresh</button>
  </nav>
</header>
```

- [ ] Open Vercel admin page in browser. Verify: light background, black header, brutalist sections.

- [ ] Verify Learning Quality, Agents, and Sync Health sections still render (admin.js unchanged).

- [ ] Commit:

```bash
git add public/dashboard/admin/styles.css public/dashboard/admin/index.html
git commit -m "feat(ui): brutalist CSS + header for Vercel admin dashboard"
```

---

## Final Checklist

- [ ] `localhost:37777/` → brutalist sessions page, SSE live, cards render, filters work
- [ ] `localhost:37777/admin` → admin page unchanged
- [ ] `localhost:37777/ticks` → ticks page unchanged
- [ ] Global nav active state correct on all three local pages
- [ ] Vercel `/dashboard/` → brutalist learnings page, existing JS works
- [ ] Vercel `/dashboard/admin/` → brutalist admin page, existing JS works
- [ ] `npm test` → same pass count as before
