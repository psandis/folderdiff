// FolderDiff GUI. Labels, messages and limits come from the server (/api/settings),
// which reads them from config/default.json and data/statuses.json.

const PLACEHOLDER = '-';
const $ = (id) => document.getElementById(id);

const state = {
  settings: null,
  comparisonId: null,
  items: [],
};

const formatKb = (bytes) => `${Math.round(bytes / 1000)} KB`;

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error);
  return body;
}

function postJson(url, body) {
  return api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

/** Text for one preview side: the file content, or the reason from data/statuses.json. */
function describeSide(side) {
  if (side.text !== null) return side.text;
  const template = state.settings.previewReasons[side.reason];
  const message = template.replace('{limit}', formatKb(state.settings.previewMaxBytes)).replace('{target}', side.target ?? '');
  return `(${message})`;
}

function isFolder(item) {
  return item.typeLeft === 'directory' || item.typeRight === 'directory';
}

function resetPreview(title, message) {
  $('detail-title').textContent = title;
  $('detail-message').textContent = message;
  $('text-left').textContent = PLACEHOLDER;
  $('text-right').textContent = PLACEHOLDER;
}

function buildStatusControls(statuses) {
  const stats = $('stats');
  stats.replaceChildren();
  for (const status of statuses) {
    const box = document.createElement('div');
    box.className = 'stat';
    const count = document.createElement('strong');
    count.dataset.status = status.key;
    count.textContent = PLACEHOLDER;
    const label = document.createElement('small');
    label.textContent = status.label;
    box.append(count, label);
    stats.append(box);
  }

  const filter = $('filter');
  for (const status of statuses) {
    const option = document.createElement('option');
    option.value = status.key;
    option.textContent = status.label;
    filter.append(option);
  }
}

function renderTotals(totals) {
  for (const count of $('stats').querySelectorAll('strong[data-status]')) {
    count.textContent = totals[count.dataset.status];
  }
}

function renderItems() {
  const search = $('search').value.toLowerCase();
  const filter = $('filter').value;
  const list = state.items.filter((item) => item.path.toLowerCase().includes(search) && (filter === 'all' || item.status === filter));
  const shortLabels = Object.fromEntries(state.settings.statuses.map((s) => [s.key, s.short]));
  const container = $('items');
  container.replaceChildren();

  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No matching files.';
    container.append(empty);
    return;
  }

  for (const item of list) {
    const row = document.createElement('div');
    row.className = 'item';
    const name = document.createElement('span');
    name.className = 'path';
    name.textContent = (isFolder(item) ? '📁 ' : '') + item.path;
    const badge = document.createElement('span');
    badge.className = `pill ${item.status}`;
    badge.textContent = shortLabels[item.status];
    row.append(name, badge);
    row.addEventListener('click', () => {
      for (const active of document.querySelectorAll('.item.active')) active.classList.remove('active');
      row.classList.add('active');
      showPreview(item);
    });
    container.append(row);
  }
}

async function showPreview(item) {
  resetPreview(item.path, 'Loading preview…');
  if (isFolder(item)) {
    $('detail-message').textContent = 'Folder (no text preview).';
    return;
  }
  try {
    const query = new URLSearchParams({ id: state.comparisonId, path: item.path });
    const preview = await api(`/api/text?${query}`);
    $('text-left').textContent = describeSide(preview.left);
    $('text-right').textContent = describeSide(preview.right);
    $('detail-message').textContent = 'Side-by-side text preview';
  } catch (error) {
    $('detail-message').textContent = error.message;
  }
}

async function compare(event) {
  event.preventDefault();
  $('compare-button').disabled = true;
  $('error').textContent = '';
  try {
    const result = await postJson('/api/compare', {
      left: $('left-input').value,
      right: $('right-input').value,
      includeHidden: $('hidden').checked,
    });
    state.comparisonId = result.id;
    state.items = result.items;
    renderItems();
    renderTotals(result.totals);
    resetPreview('File preview', 'Choose a file from the list.');
  } catch (error) {
    $('error').textContent = error.message;
  } finally {
    $('compare-button').disabled = false;
  }
}

/** Fills in the sample folders and compares them. Creates them first if they do not exist yet. */
async function loadSamples() {
  const button = $('sample-button');
  $('error').textContent = '';
  try {
    let samples = state.settings.samples;
    if (!samples.ready) {
      button.textContent = 'Creating samples…';
      samples = await postJson('/api/samples', {});
      state.settings.samples = samples;
    }
    $('left-input').value = samples.left;
    $('right-input').value = samples.right;
    $('form').requestSubmit();
  } catch (error) {
    $('error').textContent = error.message;
  } finally {
    button.textContent = 'Load sample folders';
  }
}

async function init() {
  $('form').addEventListener('submit', compare);
  $('search').addEventListener('input', renderItems);
  $('filter').addEventListener('change', renderItems);
  $('sample-button').addEventListener('click', loadSamples);

  try {
    state.settings = await api('/api/settings');
  } catch (error) {
    $('error').textContent = `Cannot load settings: ${error.message}`;
    return;
  }
  const { settings } = state;
  buildStatusControls(settings.statuses);
  $('version').textContent = `v${settings.version}`;
  $('hidden').checked = settings.includeHidden;
  $('excluded').textContent = settings.exclude.length > 0 ? `Always skipped: ${settings.exclude.join(', ')}` : '';
  $('detail-message').textContent = `Click a file to compare its text content (up to ${formatKb(settings.previewMaxBytes)} per side).`;
  $('sample-button').hidden = false;
}

init();
