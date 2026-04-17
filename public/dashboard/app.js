// public/dashboard/app.js
// IMPORTANT: never use innerHTML with server data. Always createElement + textContent.

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

function requestToken() {
  const t = prompt('Enter engram agent key:');
  if (t) localStorage.setItem(KEY, t.trim());
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

  const meta = el('div', { className: 'meta' });
  const conf = el('span', { className: 'conf', text: `${(l.confidence * 100).toFixed(0)}%` });
  const proj = el('span', { className: 'proj', text: l.project ?? '' });
  meta.append(conf, proj);

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
    alert(`Error: ${e.message}`);
  }
}

async function doReject(id) {
  const reason = prompt('Rejection reason?') ?? '';
  await doReview(id, { action: 'reject', rejection_reason: reason });
}

async function doEdit(l) {
  const claim = prompt('Edit claim:', l.claim);
  if (claim == null) return;
  const evidence = prompt('Edit evidence:', l.evidence ?? '');
  const scope = prompt('Scope:', l.scope ?? '') || null;
  await doReview(l.id, { action: 'edit_approve', edited: { claim, evidence, scope } });
}

async function renderList() {
  const list = document.getElementById('list');
  try {
    const status = document.getElementById('statusFilter').value;
    const project = document.getElementById('projectFilter').value.trim();
    const params = new URLSearchParams({ status, ...(project ? { project } : {}) });
    const { learnings } = await authedFetch(`/api/learnings?${params}`);
    list.textContent = '';
    if (!learnings.length) { renderEmpty(list); return; }
    for (const l of learnings) renderCard(list, l);
  } catch (e) {
    list.textContent = '';
    const err = el('p', { text: `Load failed: ${e.message}` });
    err.style.color = 'red';
    list.appendChild(err);
  }
}

document.getElementById('refresh').addEventListener('click', renderList);
document.getElementById('logout').addEventListener('click', () => {
  localStorage.removeItem(KEY);
  location.reload();
});
document.getElementById('statusFilter').addEventListener('change', renderList);
document.getElementById('projectFilter').addEventListener('change', renderList);

if (localStorage.getItem(KEY)) {
  renderList();
} else {
  requestToken();
  if (localStorage.getItem(KEY)) renderList();
}
