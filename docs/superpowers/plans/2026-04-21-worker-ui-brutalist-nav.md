# Worker UI Brutalist Nav Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a consistent brutalist navigation bar to all local worker pages at localhost:37777, plus a new static `/admin` page matching the design of `ticks.html`.

**Architecture:** Four independent changes: (1) add nav to `ticks.html`, (2) create `admin.html`, (3) add `GET /admin` route to ViewerRoutes, (4) inject nav into `viewer-template.html` above `#root`. No new API endpoints — `/api/admin` already exists. All CSS prefixed `g-` to avoid conflicts with the React viewer's existing styles.

**Tech Stack:** Vanilla HTML/CSS/JS (static pages), TypeScript/Express (route), Bun build pipeline.

---

## Shared Nav Snippet

**Every page that needs the nav includes this exact HTML and CSS.** Only the `g-nav-link--active` class changes per page.

### CSS (add to each page's `<style>` block)

```css
/* ── GLOBAL NAV ── */
.g-nav {
  display: flex;
  align-items: stretch;
  background: #000;
  border-bottom: 3px solid #000;
  font-family: 'Arial Black', Arial, sans-serif;
}
.g-nav-brand {
  font-size: 1rem;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: #fff;
  padding: 0.9rem 1.5rem;
  border-right: 3px solid #222;
  white-space: nowrap;
}
.g-nav-brand span { color: #f5e400; }
.g-nav-links { display: flex; }
.g-nav-link {
  font-size: 11px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  padding: 0 1.25rem;
  display: flex;
  align-items: center;
  color: #aaa;
  text-decoration: none;
  border-right: 2px solid #222;
  border-bottom: 3px solid transparent;
}
.g-nav-link:hover { color: #fff; background: #111; }
.g-nav-link--active { color: #f5e400; background: #111; border-bottom-color: #f5e400; }
.g-nav-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  padding: 0 1rem;
  border-left: 2px solid #222;
}
.g-nav-status {
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 3px 9px;
}
.g-nav-status--ok  { background: #00b300; color: #fff; }
.g-nav-status--err { background: #ff2400; color: #fff; }
.g-nav-status--loading { background: #666; color: #fff; }
```

### HTML (Sessions active — for `viewer-template.html`)

```html
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
<script>
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
```

### HTML (Admin active — for `admin.html`)

Same as above but `<a class="g-nav-link" href="/">Sessions</a>` and `<a class="g-nav-link g-nav-link--active" href="/admin">Admin</a>`.

### HTML (Ticks active — for `ticks.html`)

Same as above but `<a class="g-nav-link g-nav-link--active" href="/ticks">Ticks</a>`.

---

## File Map

| File | Change |
|------|--------|
| `plugin/ui/ticks.html` | Add nav CSS + HTML above existing `<header>` |
| `plugin/ui/admin.html` | New static admin page |
| `src/services/worker/http/routes/ViewerRoutes.ts` | Add `GET /admin` route |
| `src/ui/viewer-template.html` | Inject nav CSS + HTML between `<body>` and `<div id="root">` |

---

## Task 1: Add global nav to `ticks.html`

**Files:**
- Modify: `plugin/ui/ticks.html`

No tests needed — manual verification after build-and-sync.

- [ ] **Step 1: Add nav CSS to the `<style>` block in `ticks.html`**

Open `plugin/ui/ticks.html`. Find the closing `</style>` tag (end of the `<style>` block in `<head>`). Insert the nav CSS block from the shared snippet above **before** `</style>`.

- [ ] **Step 2: Add nav HTML as first child of `<body>`**

Find the opening `<body>` tag. Insert the nav HTML (Ticks active version) immediately after `<body>`, before the existing `<header>`.

The result:
```html
<body>
<nav class="g-nav">
  <div class="g-nav-brand">⬡ Engram <span>Worker</span></div>
  <div class="g-nav-links">
    <a class="g-nav-link" href="/">Sessions</a>
    <a class="g-nav-link" href="/admin">Admin</a>
    <a class="g-nav-link g-nav-link--active" href="/ticks">Ticks</a>
  </div>
  <div class="g-nav-right">
    <span class="g-nav-status g-nav-status--loading" id="g-nav-status">…</span>
  </div>
</nav>
<script>
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
<header>
  <!-- existing header continues unchanged -->
```

- [ ] **Step 3: Verify manually**

```bash
npm run build-and-sync
```

Open `http://localhost:37777/ticks`. The black nav bar should appear at the very top with `⬡ Engram Worker | Sessions | Admin | Ticks` — Ticks highlighted yellow. Worker status badge shows OK (green) after a moment.

- [ ] **Step 4: Commit**

```bash
git add plugin/ui/ticks.html
git commit -m "feat(ui): add global nav to ticks page"
```

---

## Task 2: Create `plugin/ui/admin.html`

**Files:**
- Create: `plugin/ui/admin.html`

The `/api/admin` endpoint already exists and returns:

```json
{
  "syncQueue": {
    "pending": 0, "synced": 2924, "failed": 0, "permanently_failed": 0,
    "failedItems": [{ "id": 1, "type": "learning", "retries": 5, "lastError": "..." }]
  },
  "extraction": {
    "enabled": true, "threshold": 0.8, "lastRunAt": "2026-...",
    "lastRunStats": { "observationsProcessed": 24, "extracted": 7, "skipped": 14, "failed": 0 }
  },
  "health": { "uptimeSeconds": 3600, "chroma": "ok", "syncServer": "ok", "workerVersion": "12.1.0" },
  "errors": [{ "ts": "2026-...", "level": "error", "ctx": "SYNC", "msg": "..." }],
  "fetchedAt": "2026-..."
}
```

- [ ] **Step 1: Create `plugin/ui/admin.html`**

Create the file with this complete content:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ENGRAM — ADMIN</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --black: #000; --white: #fff; --yellow: #f5e400;
  --red: #ff2400; --green: #00b300;
  --border: 3px solid #000;
  --mono: 'Courier New', Courier, monospace;
  --sans: 'Arial Black', Arial, sans-serif;
}
body { font-family: var(--mono); font-size: 14px; background: var(--white); color: var(--black); min-height: 100vh; }

/* NAV */
.g-nav { display:flex; align-items:stretch; background:#000; border-bottom:3px solid #000; font-family:var(--sans); }
.g-nav-brand { font-size:1rem; font-weight:900; text-transform:uppercase; letter-spacing:.15em; color:#fff; padding:.9rem 1.5rem; border-right:3px solid #222; white-space:nowrap; }
.g-nav-brand span { color:#f5e400; }
.g-nav-links { display:flex; }
.g-nav-link { font-size:11px; font-weight:900; text-transform:uppercase; letter-spacing:.12em; padding:0 1.25rem; display:flex; align-items:center; color:#aaa; text-decoration:none; border-right:2px solid #222; border-bottom:3px solid transparent; }
.g-nav-link:hover { color:#fff; background:#111; }
.g-nav-link--active { color:#f5e400; background:#111; border-bottom-color:#f5e400; }
.g-nav-right { margin-left:auto; display:flex; align-items:center; padding:0 1rem; border-left:2px solid #222; }
.g-nav-status { font-size:10px; font-weight:900; text-transform:uppercase; letter-spacing:.08em; padding:3px 9px; }
.g-nav-status--ok { background:#00b300; color:#fff; }
.g-nav-status--err { background:#ff2400; color:#fff; }
.g-nav-status--loading { background:#666; color:#fff; }

/* PAGE HEADER */
.page-hdr { padding:1.25rem 2rem; border-bottom:var(--border); display:flex; align-items:center; justify-content:space-between; }
.page-hdr-title { font-family:var(--sans); font-size:11px; font-weight:900; text-transform:uppercase; letter-spacing:.15em; color:#555; }
#last-updated { font-size:11px; color:#888; }

/* GRID */
main { padding:2rem; display:grid; grid-template-columns:1fr 1fr; gap:0; }

/* PANEL */
.panel { border:var(--border); margin:-1px 0 0 -1px; padding:1.25rem; }
.panel-full { grid-column:1/-1; }
.panel-title { font-family:var(--sans); font-size:10px; font-weight:900; text-transform:uppercase; letter-spacing:.15em; border-bottom:2px solid var(--black); padding-bottom:.5rem; margin-bottom:1rem; }

/* HEALTH */
.health-row { display:flex; gap:.75rem; align-items:center; flex-wrap:wrap; }
.badge { font-family:var(--sans); font-size:10px; font-weight:900; padding:2px 8px; text-transform:uppercase; letter-spacing:.05em; white-space:nowrap; }
.badge-ok { background:var(--green); color:var(--white); }
.badge-err { background:var(--red); color:var(--white); }
.badge-na { background:#ccc; color:#444; }
.uptime { font-size:13px; font-weight:bold; }
.version { font-size:11px; color:#777; }

/* SYNC QUEUE */
.stat-row { display:flex; gap:2rem; margin-bottom:.75rem; }
.stat { display:flex; flex-direction:column; }
.stat-val { font-family:var(--sans); font-size:1.8rem; font-weight:900; }
.stat-val-zero { color:#ccc; }
.stat-val-err { color:var(--red); }
.stat-label { font-family:var(--sans); font-size:9px; font-weight:900; text-transform:uppercase; letter-spacing:.1em; color:#888; }
.failed-list { margin-top:.75rem; display:flex; flex-direction:column; gap:.25rem; }
.failed-item { border-left:3px solid var(--red); padding:.35rem .6rem; font-size:11px; background:#fff5f5; display:flex; gap:.5rem; align-items:baseline; }
.failed-type { font-family:var(--sans); font-size:9px; font-weight:900; text-transform:uppercase; background:var(--red); color:var(--white); padding:1px 5px; white-space:nowrap; }
.failed-err { color:#555; flex:1; word-break:break-word; }
.failed-retries { color:#aaa; font-size:10px; white-space:nowrap; }

/* EXTRACTION */
.ext-meta { display:flex; gap:.5rem; align-items:center; margin-bottom:.75rem; flex-wrap:wrap; font-size:12px; }
.ext-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:.5rem; }
.ext-cell { border:2px solid var(--black); padding:.5rem; text-align:center; }
.ext-val { font-family:var(--sans); font-size:1.2rem; font-weight:900; }
.ext-val-err { color:var(--red); }
.ext-lbl { font-family:var(--sans); font-size:8px; text-transform:uppercase; letter-spacing:.08em; color:#888; }

/* ERRORS */
.error-log { display:flex; flex-direction:column; gap:0; }
.error-entry { display:grid; grid-template-columns:52px 52px 88px 1fr; gap:.4rem; padding:.35rem 0; border-bottom:1px solid #eee; align-items:baseline; font-size:11px; }
.err-time { color:#888; }
.err-level { font-family:var(--sans); font-size:9px; font-weight:900; padding:1px 5px; text-transform:uppercase; white-space:nowrap; }
.level-error { background:var(--red); color:var(--white); }
.level-warn  { background:var(--yellow); color:var(--black); }
.level-info  { background:#ccc; color:#333; }
.err-ctx { font-weight:bold; font-size:10px; text-transform:uppercase; letter-spacing:.05em; }
.err-msg { color:#333; word-break:break-word; }

/* STATES */
.unavailable { color:#aaa; font-size:12px; font-style:italic; }
.no-items { color:#aaa; font-size:12px; }
.worker-down { padding:4rem 2rem; text-align:center; font-family:var(--sans); font-size:14px; font-weight:900; text-transform:uppercase; letter-spacing:.1em; color:var(--red); }
</style>
</head>
<body>

<nav class="g-nav">
  <div class="g-nav-brand">⬡ Engram <span>Worker</span></div>
  <div class="g-nav-links">
    <a class="g-nav-link" href="/">Sessions</a>
    <a class="g-nav-link g-nav-link--active" href="/admin">Admin</a>
    <a class="g-nav-link" href="/ticks">Ticks</a>
  </div>
  <div class="g-nav-right">
    <span class="g-nav-status g-nav-status--loading" id="g-nav-status">…</span>
  </div>
</nav>

<div class="page-hdr">
  <span class="page-hdr-title">Admin — System Status</span>
  <span id="last-updated"></span>
</div>

<div id="content"></div>

<script>
(function(){
  'use strict';

  /* ── Nav health badge ── */
  fetch('/health').then(function(r){ return r.ok ? r.json() : null; }).then(function(d){
    var el = document.getElementById('g-nav-status');
    if(d){ el.textContent='OK'; el.className='g-nav-status g-nav-status--ok'; }
    else { el.textContent='DOWN'; el.className='g-nav-status g-nav-status--err'; }
  }).catch(function(){
    var el=document.getElementById('g-nav-status');
    el.textContent='DOWN'; el.className='g-nav-status g-nav-status--err';
  });

  var secondsAgo = 0;
  var ticker = null;

  function esc(s){ return String(s == null ? '' : s); }
  function txt(s){ return document.createTextNode(esc(s)); }
  function el(tag, cls){ var e = document.createElement(tag); if(cls) e.className=cls; return e; }

  function formatUptime(s){
    var h = Math.floor(s/3600), m = Math.floor((s%3600)/60);
    return h > 0 ? h+'h '+m+'m up' : m+'m up';
  }
  function formatRelative(iso){
    var diff = Math.floor((Date.now() - new Date(iso).getTime())/1000);
    if(diff<60) return diff+'s ago';
    if(diff<3600) return Math.floor(diff/60)+'m ago';
    return Math.floor(diff/3600)+'h ago';
  }
  function formatTime(iso){
    return new Date(iso).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  }

  function badge(status, label){
    var sp = el('span','badge badge-'+(status==='ok'?'ok':status==='unavailable'?'na':'err'));
    sp.appendChild(txt(label+' '+(status==='ok'?'✓':status==='unavailable'?'—':'✗')));
    return sp;
  }

  function renderHealth(h){
    var div = el('div','panel');
    div.appendChild(Object.assign(el('div','panel-title'), {textContent:'System Health'}));
    if(!h){ div.appendChild(Object.assign(el('p','unavailable'),{textContent:'unavailable'})); return div; }
    var row = el('div','health-row');
    row.appendChild(Object.assign(el('span','uptime'),{textContent:formatUptime(h.uptimeSeconds)}));
    row.appendChild(badge(h.chroma,'Chroma'));
    row.appendChild(badge(h.syncServer,'Sync Server'));
    row.appendChild(Object.assign(el('span','version'),{textContent:'v'+esc(h.workerVersion)}));
    div.appendChild(row);
    return div;
  }

  function renderQueue(q){
    var div = el('div','panel');
    div.appendChild(Object.assign(el('div','panel-title'),{textContent:'Sync Queue'}));
    if(!q){ div.appendChild(Object.assign(el('p','unavailable'),{textContent:'unavailable'})); return div; }
    var failed = (q.failed||0)+(q.permanently_failed||0);
    var row = el('div','stat-row');
    var ps = el('div','stat');
    var pv = el('span','stat-val'+(q.pending===0?' stat-val-zero':''));
    pv.appendChild(txt(q.pending));
    var pl = el('span','stat-label'); pl.appendChild(txt('Pending'));
    ps.appendChild(pv); ps.appendChild(pl);
    var fs = el('div','stat');
    var fv = el('span','stat-val'+(failed>0?' stat-val-err':' stat-val-zero'));
    fv.appendChild(txt(failed));
    var fl = el('span','stat-label'); fl.appendChild(txt('Failed'));
    fs.appendChild(fv); fs.appendChild(fl);
    row.appendChild(ps); row.appendChild(fs);
    div.appendChild(row);
    if(q.failedItems && q.failedItems.length > 0){
      var list = el('div','failed-list');
      q.failedItems.forEach(function(item){
        var fi = el('div','failed-item');
        var typ = el('span','failed-type'); typ.appendChild(txt(item.type)); fi.appendChild(typ);
        var err = el('span','failed-err'); err.appendChild(txt(item.lastError||'unknown')); fi.appendChild(err);
        var ret = el('span','failed-retries'); ret.appendChild(txt(item.retries+' retries')); fi.appendChild(ret);
        list.appendChild(fi);
      });
      div.appendChild(list);
    }
    return div;
  }

  function renderExtraction(e){
    var div = el('div','panel');
    div.appendChild(Object.assign(el('div','panel-title'),{textContent:'Learning Extraction'}));
    if(!e){ div.appendChild(Object.assign(el('p','unavailable'),{textContent:'not configured'})); return div; }
    var meta = el('div','ext-meta');
    var b = el('span','badge badge-'+(e.enabled?'ok':'err')); b.appendChild(txt(e.enabled?'Enabled':'Disabled')); meta.appendChild(b);
    meta.appendChild(txt('threshold '+e.threshold+(e.lastRunAt?' · last run '+formatRelative(e.lastRunAt):'')));
    div.appendChild(meta);
    if(e.lastRunStats){
      var s = e.lastRunStats;
      var grid = el('div','ext-grid');
      [['observationsProcessed','Processed'],['extracted','Extracted'],['skipped','Skipped'],['failed','Failed']].forEach(function(pair){
        var cell = el('div','ext-cell');
        var v = el('div','ext-val'+(pair[0]==='failed'&&s[pair[0]]>0?' ext-val-err':''));
        v.appendChild(txt(s[pair[0]]||0));
        var l = el('div','ext-lbl'); l.appendChild(txt(pair[1]));
        cell.appendChild(v); cell.appendChild(l); grid.appendChild(cell);
      });
      div.appendChild(grid);
    } else {
      div.appendChild(Object.assign(el('p','no-items'),{textContent:'no runs yet'}));
    }
    return div;
  }

  function renderErrors(errors){
    var div = el('div','panel panel-full');
    div.appendChild(Object.assign(el('div','panel-title'),{textContent:'Recent Errors'}));
    if(!errors||errors.length===0){
      div.appendChild(Object.assign(el('p','no-items'),{textContent:'no errors'}));
      return div;
    }
    var log = el('div','error-log');
    errors.forEach(function(e){
      var row = el('div','error-entry');
      var t = el('span','err-time'); t.appendChild(txt(formatTime(e.ts))); row.appendChild(t);
      var lv = el('span','err-level level-'+esc(e.level)); lv.appendChild(txt(e.level.toUpperCase())); row.appendChild(lv);
      var ctx = el('span','err-ctx'); ctx.appendChild(txt(e.ctx)); row.appendChild(ctx);
      var msg = el('span','err-msg'); msg.appendChild(txt(e.msg)); row.appendChild(msg);
      log.appendChild(row);
    });
    div.appendChild(log);
    return div;
  }

  function render(data){
    var content = document.getElementById('content');
    while(content.firstChild) content.removeChild(content.firstChild);
    var main = el('main');
    main.appendChild(renderHealth(data.health));
    main.appendChild(renderQueue(data.syncQueue));
    if(data.extraction !== undefined){
      main.appendChild(renderExtraction(data.extraction));
    }
    main.appendChild(renderErrors(data.errors));
    content.appendChild(main);
    document.getElementById('last-updated').textContent = 'Updated 0s ago';
    secondsAgo = 0;
    if(ticker) clearInterval(ticker);
    ticker = setInterval(function(){ secondsAgo++; document.getElementById('last-updated').textContent='Updated '+secondsAgo+'s ago'; }, 1000);
  }

  function renderDown(){
    var content = document.getElementById('content');
    while(content.firstChild) content.removeChild(content.firstChild);
    var d = el('div','worker-down');
    d.appendChild(txt('Worker unavailable — retrying'));
    content.appendChild(d);
  }

  function fetchData(){
    fetch('/api/admin')
      .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
      .then(render)
      .catch(renderDown);
  }

  fetchData();
  setInterval(fetchData, 10000);
})();
</script>

</body>
</html>
```

- [ ] **Step 2: Verify file created**

```bash
ls -la plugin/ui/admin.html
```

Expected: file present, ~9KB.

- [ ] **Step 3: Commit**

```bash
git add plugin/ui/admin.html
git commit -m "feat(ui): add brutalist admin page"
```

---

## Task 3: Add `GET /admin` route to ViewerRoutes

**Files:**
- Modify: `src/services/worker/http/routes/ViewerRoutes.ts`

No test needed — same pattern as `/ticks` which was already reviewed. Manual verify after build-and-sync.

- [ ] **Step 1: Register route in `setupRoutes()`**

In `setupRoutes()`, after `app.get('/ticks', this.handleTicksUI.bind(this));`, add:

```ts
app.get('/admin', this.handleAdminUI.bind(this));
```

- [ ] **Step 2: Add handler method**

After `handleTicksUI`, add:

```ts
private handleAdminUI = this.wrapHandler((req: Request, res: Response): void => {
  const packageRoot = getPackageRoot();
  const candidates = [
    path.join(packageRoot, 'ui', 'admin.html'),
    path.join(packageRoot, 'plugin', 'ui', 'admin.html'),
  ];
  const adminPath = candidates.find(p => existsSync(p));
  if (!adminPath) {
    throw new Error('Admin UI not found — run npm run build-and-sync');
  }
  const html = readFileSync(adminPath, 'utf-8');
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});
```

Note: no DB access in this handler — no 503 guard needed (unlike `/api/ticks` which reads from DB).

- [ ] **Step 3: Run test suite**

```bash
npm test
```

Expected: 1504 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/services/worker/http/routes/ViewerRoutes.ts
git commit -m "feat(worker): add GET /admin route"
```

---

## Task 4: Inject global nav into `viewer-template.html`

**Files:**
- Modify: `src/ui/viewer-template.html`

`viewer-template.html` is the source for the React viewer. The build script copies it as-is (with the bundled JS) into `plugin/ui/viewer.html`. The nav is injected as raw HTML above `<div id="root">`.

The file is large (~3000 lines). The target injection point is near the end of the file:

```html
<body>
<div id="root"></div>
```

- [ ] **Step 1: Find the injection point**

```bash
grep -n "id=\"root\"" src/ui/viewer-template.html
```

Expected output: something like `3041:<div id="root"></div>`

- [ ] **Step 2: Inject nav between `<body>` and `<div id="root">`**

Edit `src/ui/viewer-template.html`. Replace:

```html
<body>
<div id="root"></div>
```

With:

```html
<body>
<style>
.g-nav{display:flex;align-items:stretch;background:#000;border-bottom:3px solid #000;font-family:'Arial Black',Arial,sans-serif}
.g-nav-brand{font-size:1rem;font-weight:900;text-transform:uppercase;letter-spacing:.15em;color:#fff;padding:.9rem 1.5rem;border-right:3px solid #222;white-space:nowrap}
.g-nav-brand span{color:#f5e400}
.g-nav-links{display:flex}
.g-nav-link{font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.12em;padding:0 1.25rem;display:flex;align-items:center;color:#aaa;text-decoration:none;border-right:2px solid #222;border-bottom:3px solid transparent}
.g-nav-link:hover{color:#fff;background:#111}
.g-nav-link--active{color:#f5e400;background:#111;border-bottom-color:#f5e400}
.g-nav-right{margin-left:auto;display:flex;align-items:center;padding:0 1rem;border-left:2px solid #222}
.g-nav-status{font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;padding:3px 9px}
.g-nav-status--ok{background:#00b300;color:#fff}
.g-nav-status--err{background:#ff2400;color:#fff}
.g-nav-status--loading{background:#666;color:#fff}
</style>
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
<script>
(function(){
  fetch('/health').then(function(r){return r.ok?r.json():null}).then(function(d){
    var e=document.getElementById('g-nav-status');
    if(d){e.textContent='OK';e.className='g-nav-status g-nav-status--ok';}
    else{e.textContent='DOWN';e.className='g-nav-status g-nav-status--err';}
  }).catch(function(){
    var e=document.getElementById('g-nav-status');
    e.textContent='DOWN';e.className='g-nav-status g-nav-status--err';
  });
})();
</script>
<div id="root"></div>
```

- [ ] **Step 3: Build and sync**

```bash
npm run build-and-sync
```

Expected: build succeeds, worker restarts.

- [ ] **Step 4: Verify manually**

Open `http://localhost:37777`. The black nav bar should appear above the React viewer. Sessions tab is highlighted yellow. The React viewer renders below it normally.

Check that clicking Admin → goes to `/admin` page. Clicking Ticks → goes to `/ticks`. Clicking Sessions → back to `/`.

- [ ] **Step 5: Verify `/admin` page**

Open `http://localhost:37777/admin`. The admin page loads with real data from `/api/admin`.

- [ ] **Step 6: Run final test suite**

```bash
npm test
```

Expected: 1504 pass, 0 fail.

- [ ] **Step 7: Commit**

```bash
git add src/ui/viewer-template.html
git commit -m "feat(ui): inject global nav into React viewer template"
```
