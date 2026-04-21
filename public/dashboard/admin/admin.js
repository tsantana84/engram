const TOKEN_KEY = 'engram_dashboard_token';
let fetching = false;

function el(id) { return document.getElementById(id); }

function makeEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
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
  if (!q) { container.appendChild(makeEl('p', 'unavailable', 'unavailable')); return; }

  const row = makeEl('div', 'stat-row');
  row.appendChild(makeEl('span', null, `${q.total} total`));
  row.appendChild(makeEl('span', 'approved', `${q.approved} approved`));
  row.appendChild(makeEl('span', 'rejected', `${q.rejected} rejected`));
  row.appendChild(makeEl('span', 'pending', `${q.pending} pending`));
  container.appendChild(row);

  const rate = q.approvalRate !== null ? `${(q.approvalRate * 100).toFixed(0)}%` : '—';
  const rateP = makeEl('p');
  rateP.textContent = 'Approval rate: ';
  const strong = makeEl('strong', null, rate);
  rateP.appendChild(strong);
  container.appendChild(rateP);

  const confBar = makeEl('div', 'confidence-bar');
  confBar.appendChild(makeEl('span', 'high', `high(${q.confidenceDistribution.high})`));
  confBar.appendChild(makeEl('span', 'medium', `med(${q.confidenceDistribution.medium})`));
  confBar.appendChild(makeEl('span', 'low', `low(${q.confidenceDistribution.low})`));
  container.appendChild(confBar);
}

function renderAgents(agents, syncHealth) {
  const agentsEl = el('agentsContent');
  const syncEl = el('syncContent');
  agentsEl.textContent = '';
  syncEl.textContent = '';

  if (!agents) {
    agentsEl.appendChild(makeEl('p', 'unavailable', 'unavailable'));
    syncEl.appendChild(makeEl('p', 'unavailable', 'unavailable'));
    return;
  }
  if (agents.length === 0) {
    agentsEl.appendChild(makeEl('p', 'empty', 'No agents found'));
    return;
  }

  const syncMap = new Map((syncHealth ?? []).map(s => [s.agentId, s.lastSyncAt]));

  for (const agent of agents) {
    const row = makeEl('div', 'agent-row');

    const nameEl = makeEl('div', `agent-name ${ageClass(agent.lastSeenAt)}`, agent.name);
    row.appendChild(nameEl);

    const metaEl = makeEl('div', 'agent-meta',
      `last seen ${agent.lastSeenAt ? relativeTime(agent.lastSeenAt) : 'never'}`);
    row.appendChild(metaEl);

    const countsEl = makeEl('div', 'agent-counts',
      `${agent.observationCount.toLocaleString()} obs · ${agent.sessionCount} sessions · ${agent.learningCount} learnings`);
    row.appendChild(countsEl);
    agentsEl.appendChild(row);

    const syncRow = makeEl('div', 'sync-row');
    syncRow.appendChild(makeEl('span', 'agent-name', agent.name));
    const lastSync = syncMap.get(agent.id);
    const syncTime = makeEl('span', `sync-time ${lastSync ? ageClass(lastSync) : 'red'}`,
      lastSync ? `last sync ${relativeTime(lastSync)}` : 'never synced');
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
