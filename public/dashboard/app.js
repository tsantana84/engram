// public/dashboard/app.js
// IMPORTANT: never use innerHTML with server data. Always createElement + textContent.

const selected = new Set();

function updateBulkBar() {
  let bar = document.getElementById('bulk-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'bulk-bar';
    bar.className = 'bulk-bar';

    const count = el('span', { className: 'bulk-count' });
    const selectAll = el('button', { text: 'Select All' });
    const clearAll = el('button', { text: 'Clear' });
    const approveAll = el('button', { text: '✓ Approve All' });
    approveAll.className = 'bulk-approve';
    const rejectAll = el('button', { text: '✗ Reject All' });
    rejectAll.className = 'bulk-reject';

    selectAll.addEventListener('click', () => {
      document.querySelectorAll('.card-checkbox').forEach(cb => {
        cb.checked = true;
        selected.add(Number(cb.dataset.id));
      });
      updateBulkBar();
    });

    clearAll.addEventListener('click', () => {
      selected.clear();
      document.querySelectorAll('.card-checkbox').forEach(cb => cb.checked = false);
      updateBulkBar();
    });

    async function bulkAction(action) {
      if (!selected.size) return;
      const ids = [...selected];
      approveAll.disabled = true;
      rejectAll.disabled = true;
      countEl.textContent = `Processing 0 / ${ids.length}…`;

      let done = 0;
      await Promise.all(ids.map(async id => {
        const card = document.querySelector(`[data-id="${id}"]`);
        if (card) card.style.opacity = '0.4';
        try { await authedFetch(`/api/learnings/${id}/review`, { method: 'POST', body: JSON.stringify({ action }) }); }
        catch {}
        done++;
        countEl.textContent = `Processing ${done} / ${ids.length}…`;
      }));

      selected.clear();
      renderList();
      renderCounts();
    }

    approveAll.addEventListener('click', () => bulkAction('approve'));
    rejectAll.addEventListener('click', () => bulkAction('reject'));

    bar.append(count, selectAll, clearAll, approveAll, rejectAll);
    document.body.appendChild(bar);
  }

  const countEl = bar.querySelector('.bulk-count');
  if (selected.size > 0) {
    countEl.textContent = `${selected.size} selected`;
    bar.style.display = 'flex';
  } else {
    bar.style.display = 'none';
  }
}

const API = location.origin;
const KEY = 'engram_dashboard_token';

async function authedFetch(path, opts = {}) {
  const token = localStorage.getItem(KEY);
  if (!token) { requestToken(); throw new Error('no token'); }
  const headers = { ...(opts.headers ?? {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const r = await fetch(`${API}${path}`, { ...opts, headers });
  if (r.status === 401) { localStorage.removeItem(KEY); requestToken(); throw new Error('unauthorized'); }
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

function showError(container, msg) {
  const existing = container.querySelector('.inline-error');
  if (existing) existing.remove();
  const e = el('p', { className: 'inline-error error', text: `Error: ${msg}` });
  container.appendChild(e);
  setTimeout(() => e.remove(), 5000);
}

function requestToken() {
  const list = document.getElementById('list');
  list.textContent = '';

  const form = document.createElement('div');
  form.className = 'token-form';

  const wrap = document.createElement('div');
  wrap.className = 'edit-field';
  const lbl = el('label', { text: 'ENGRAM AGENT KEY' });
  const input = Object.assign(document.createElement('input'), { type: 'password', placeholder: 'cmem_ak_...' });
  wrap.append(lbl, input);

  const submit = el('button', { text: 'Connect' });
  submit.style.cssText = 'background:#000;color:#fff;border-color:#000;margin-top:.5rem;';

  form.append(wrap, submit);
  list.appendChild(form);
  input.focus();

  function tryConnect() {
    const t = input.value.trim();
    if (!t) return;
    localStorage.setItem(KEY, t);
    renderList();
  }

  submit.addEventListener('click', tryConnect);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') tryConnect(); });
}

function el(tag, opts = {}) {
  const n = document.createElement(tag);
  if (opts.className) n.className = opts.className;
  if (opts.text != null) n.textContent = String(opts.text);
  if (opts.onClick) n.addEventListener('click', opts.onClick);
  return n;
}

function renderEmpty(list) {
  list.textContent = '';
  const p = el('p', { text: 'No items.' });
  list.appendChild(p);
}

function renderCard(list, l) {
  const card = el('article', { className: 'card' });
  card.dataset.id = l.id;

  const cb = Object.assign(document.createElement('input'), { type: 'checkbox', className: 'card-checkbox' });
  cb.dataset.id = l.id;
  cb.checked = selected.has(l.id);
  cb.addEventListener('change', () => {
    cb.checked ? selected.add(l.id) : selected.delete(l.id);
    updateBulkBar();
  });

  const meta = el('div', { className: 'meta' });
  const conf = el('span', { className: 'conf', text: `${(l.confidence * 100).toFixed(0)}%` });
  const proj = el('span', { className: 'proj', text: l.project ?? '' });
  const badge = el('span', { className: `status-badge status-${l.status ?? 'pending'}`, text: l.status ?? 'pending' });
  meta.append(conf, proj, badge);

  card.appendChild(cb);

  const h2 = el('h2', { text: l.claim });
  const ev = el('p', { className: 'evidence', text: l.evidence ?? '' });

  const actions = el('div', { className: 'actions' });
  const approve = el('button', { text: 'Approve', onClick: () => doReview(l.id, { action: 'approve' }) });
  const edit = el('button', { text: 'Edit & Approve', onClick: () => doEdit(l) });
  const reject = el('button', { text: 'Reject', onClick: () => doReject(l.id) });
  actions.append(approve, edit, reject);

  card.append(meta, h2, ev, actions);
  list.appendChild(card);
}

async function doReview(id, body) {
  const card = document.querySelector(`[data-id="${id}"]`);
  const buttons = card?.querySelectorAll('button');
  buttons?.forEach(b => b.disabled = true);
  try {
    await authedFetch(`/api/learnings/${id}/review`, { method: 'POST', body: JSON.stringify(body) });
    renderList();
  } catch (e) {
    buttons?.forEach(b => b.disabled = false);
    showError(card, e.message);
  }
}

function doReject(id) {
  const card = document.querySelector(`[data-id="${id}"]`);
  if (!card || card.querySelector('.reject-form')) return;

  card.querySelectorAll('h2, .evidence, .actions').forEach(n => n.style.display = 'none');

  const form = document.createElement('div');
  form.className = 'reject-form edit-form';

  const wrap = document.createElement('div');
  wrap.className = 'edit-field';
  const lbl = el('label', { text: 'REJECTION REASON (optional)' });
  const input = Object.assign(document.createElement('textarea'), { rows: 2 });
  wrap.append(lbl, input);

  const btns = el('div', { className: 'actions' });
  const confirm = el('button', { text: 'Confirm Reject' });
  confirm.style.cssText = 'background:#ff2400;border-color:#ff2400;color:#fff;';
  const cancel = el('button', { text: 'Cancel' });
  btns.append(confirm, cancel);

  form.append(wrap, btns);
  card.appendChild(form);
  input.focus();

  cancel.addEventListener('click', () => {
    form.remove();
    card.querySelectorAll('h2, .evidence, .actions').forEach(n => n.style.display = '');
  });

  confirm.addEventListener('click', async () => {
    confirm.disabled = true;
    cancel.disabled = true;
    try {
      await authedFetch(`/api/learnings/${id}/review`, {
        method: 'POST',
        body: JSON.stringify({ action: 'reject', rejection_reason: input.value.trim() || null }),
      });
      renderList();
    } catch (e) {
      confirm.disabled = false;
      cancel.disabled = false;
      showError(card, e.message);
    }
  });
}

function doEdit(l) {
  const card = document.querySelector(`[data-id="${l.id}"]`);
  if (!card || card.querySelector('.edit-form')) return;

  // Hide normal content, show edit form
  card.querySelectorAll('h2, .evidence, .actions').forEach(n => n.style.display = 'none');

  const form = document.createElement('div');
  form.className = 'edit-form';

  function field(label, value, rows) {
    const wrap = document.createElement('div');
    wrap.className = 'edit-field';
    const lbl = el('label', { text: label });
    const input = rows
      ? Object.assign(document.createElement('textarea'), { rows, value })
      : Object.assign(document.createElement('input'), { type: 'text', value });
    wrap.append(lbl, input);
    return { wrap, input };
  }

  const { wrap: claimWrap, input: claimInput } = field('CLAIM', l.claim ?? '', 2);
  const { wrap: evWrap, input: evInput } = field('EVIDENCE', l.evidence ?? '', 3);
  const { wrap: scopeWrap, input: scopeInput } = field('SCOPE', l.scope ?? '');

  const btns = el('div', { className: 'actions' });
  const save = el('button', { text: 'Save & Approve' });
  const cancel = el('button', { text: 'Cancel' });
  btns.append(save, cancel);

  form.append(claimWrap, evWrap, scopeWrap, btns);
  card.appendChild(form);
  claimInput.focus();

  cancel.addEventListener('click', () => {
    form.remove();
    card.querySelectorAll('h2, .evidence, .actions').forEach(n => n.style.display = '');
  });

  save.addEventListener('click', async () => {
    save.disabled = true;
    cancel.disabled = true;
    const edited = {
      claim: claimInput.value.trim(),
      evidence: evInput.value.trim() || null,
      scope: scopeInput.value.trim() || null,
    };
    try {
      await authedFetch(`/api/learnings/${l.id}/review`, {
        method: 'POST',
        body: JSON.stringify({ action: 'edit_approve', edited }),
      });
      renderList();
    } catch (e) {
      save.disabled = false;
      cancel.disabled = false;
      showError(form, e.message);
    }
  });
}

function renderMockList() {
  const MOCK = [
    { id: 1, claim: 'Bun is significantly faster than Node for test execution', evidence: 'Benchmarks show 3x improvement in cold start times across the test suite.', project: 'engram', confidence: 0.92, status: 'pending' },
    { id: 2, claim: 'Migration version conflicts cause silent schema drift', evidence: 'Two migrations claimed version 26; second was silently skipped, leaving pending_messages with wrong schema.', project: 'engram', confidence: 0.87, status: 'pending' },
    { id: 3, claim: 'mock.module leaks across bun test workers sharing the same process', evidence: 'context-reinjection-guard mocked SettingsDefaultsManager; settings-learning test received empty strings for all keys when run in the same worker.', project: 'engram', confidence: 0.78, status: 'pending' },
    { id: 4, claim: 'ProcessRegistry delegates to supervisor singleton — tests must call resetRegistry() between runs', evidence: 'clearRegistry() via getActiveProcesses() missed entries without runtimeProcess refs; counts were off by 1.', project: 'engram', confidence: 0.95, status: 'approved' },
    { id: 5, claim: 'tool_result_persist silently skips observations when workspaceDir is missing', evidence: 'Handler returns early with a warn log if workspaceDir is falsy — test contexts must include it.', project: 'openclaw', confidence: 0.81, status: 'rejected' },
  ];
  const list = document.getElementById('list');
  list.textContent = '';
  for (const l of MOCK) renderCard(list, l);
}

async function renderList() {
  const list = document.getElementById('list');
  try {
    const status = document.getElementById('statusFilter').value;
    const project = document.getElementById('projectFilter').value.trim();
    const params = new URLSearchParams({ status, ...(project ? { project } : {}) });
    const { learnings } = await authedFetch(`/api/learnings?${params}`);
    list.textContent = '';
    selected.clear();
    updateBulkBar();
    if (!learnings.length) { renderEmpty(list); return; }
    for (const l of learnings) renderCard(list, l);
  } catch (e) {
    list.textContent = '';
    const err = el('p', { text: `Load failed: ${e.message}` });
    err.style.color = 'red';
    list.appendChild(err);
  }
}

async function renderCounts() {
  const el = document.getElementById('counts');
  if (!el) return;
  try {
    const project = document.getElementById('projectFilter').value.trim();
    const params = project ? `?project=${encodeURIComponent(project)}` : '';
    const c = await authedFetch(`/api/learnings/counts${params}`);
    el.textContent = '';
    [['pending', c.pending], ['approved', c.approved], ['rejected', c.rejected]].forEach(([s, n]) => {
      const span = document.createElement('span');
      span.className = `count-badge count-${s}`;
      span.textContent = `${s}: ${n}`;
      el.appendChild(span);
    });
  } catch {}
}

document.getElementById('refresh').addEventListener('click', () => { renderList(); renderCounts(); });
document.getElementById('logout').addEventListener('click', () => {
  localStorage.removeItem(KEY);
  location.reload();
});
document.getElementById('statusFilter').addEventListener('change', renderList);
document.getElementById('projectFilter').addEventListener('change', renderList);

if (localStorage.getItem(KEY)) {
  renderList();
  renderCounts();
} else if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  renderMockList();
} else {
  requestToken();
  if (localStorage.getItem(KEY)) renderList();
}
