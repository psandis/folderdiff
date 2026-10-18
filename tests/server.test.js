import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createServer } from '../src/server.js';
import { writeTree } from './helpers.js';
import os from 'node:os';

let root;
let left;
let right;
let server;
let base;
const logged = [];

const config = (dir) => ({
  server: { host: '127.0.0.1', port: 0, maxRequestBytes: 1000, maxComparisons: 2 },
  compare: { exclude: [], includeHidden: false, hashAlgorithm: 'sha256' },
  preview: { maxBytes: 20 },
  samples: { dir: path.join(dir, 'samples') },
});

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'folderdiff-server-'));
  left = path.join(root, 'a');
  right = path.join(root, 'b');
  await writeTree(left, { 'text.txt': 'left', bin: Buffer.from([0, 1]), big: 'x'.repeat(50), 'only-left': 'x' });
  await writeTree(right, { 'text.txt': 'right', bin: Buffer.from([0, 2]), big: 'y'.repeat(50) });
  server = createServer(config(root), { log: (message) => logged.push(message) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(root, { recursive: true, force: true });
});

/** A raw request, so the Host header can be set to anything. */
function rawStatus(headers, urlPath = '/api/settings') {
  return new Promise((resolve, reject) => {
    const req = http.request(base + urlPath, { headers }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
}

function post(urlPath, body, headers = {}) {
  return fetch(base + urlPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function compare(l = left, r = right) {
  const response = await post('/api/compare', { left: l, right: r });
  assert.equal(response.status, 200);
  return response.json();
}

const preview = async (id, relative) => fetch(`${base}/api/text?${new URLSearchParams({ id, path: relative })}`);

describe('security', () => {
  test('rejects requests for a foreign Host (DNS rebinding)', async () => {
    assert.equal(await rawStatus({ Host: 'evil.example:80' }), 403);
    assert.equal(await rawStatus({ Host: `localhost:${server.address().port}` }), 200);
  });

  test('rejects cross-site posts with 403 and non-JSON posts with 415', async () => {
    assert.equal((await post('/api/compare', { left, right }, { Origin: 'http://evil.example' })).status, 403);
    assert.equal((await post('/api/compare', { left, right }, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await post('/api/samples', {}, { Origin: 'http://evil.example' })).status, 403);
  });

  test('rejects bodies over server.maxRequestBytes with 413 and invalid JSON with 400', async () => {
    assert.equal((await post('/api/compare', { left: 'x'.repeat(2000) })).status, 413);
    assert.equal((await post('/api/compare', '{not json')).status, 400);
  });

  test('sends security headers', async () => {
    const response = await fetch(`${base}/`);
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  });
});

describe('GUI files', () => {
  test('serves index.html, app.js and styles.css from public/', async () => {
    for (const [urlPath, type] of [['/', 'text/html'], ['/app.js', 'text/javascript'], ['/styles.css', 'text/css']]) {
      const response = await fetch(base + urlPath);
      assert.equal(response.status, 200, urlPath);
      assert.match(response.headers.get('content-type'), new RegExp(type));
    }
    assert.equal((await fetch(`${base}/package.json`)).status, 404);
  });
});

describe('API', () => {
  test('settings come from config and data files', async () => {
    const settings = await (await fetch(`${base}/api/settings`)).json();
    assert.equal(settings.previewMaxBytes, 20);
    assert.deepEqual(settings.exclude, []);
    assert.equal(settings.includeHidden, false);
    assert.match(settings.version, /^\d+\.\d+\.\d+/);
    assert.equal(settings.statuses.length, 5);
    assert.equal(typeof settings.previewReasons.tooLarge, 'string');
    assert.deepEqual(settings.samples, {
      dir: path.join(root, 'samples'),
      left: path.join(root, 'samples', 'left'),
      right: path.join(root, 'samples', 'right'),
      ready: false,
    });
  });

  test('compare returns an id, totals, items and folder names', async () => {
    const result = await compare();
    assert.match(result.id, /^[0-9a-f-]{36}$/);
    assert.equal(result.totals.modified, 3);
    assert.equal(result.totals.onlyLeft, 1);
    assert.equal(result.left, 'a');
    assert.equal(result.right, 'b');
    assert.equal(result.leftPath, await fs.realpath(left));
  });

  test('compare rejects relative, missing and identical folders with 400', async () => {
    for (const body of [{ left: 'rel', right }, { left: path.join(root, 'nope'), right }, { left, right: left }]) {
      const response = await post('/api/compare', body);
      assert.equal(response.status, 400, JSON.stringify(body));
      assert.ok((await response.json()).error);
    }
  });

  test('preview explains each side', async () => {
    const { id } = await compare();
    assert.deepEqual((await (await preview(id, 'text.txt')).json()).left, { text: 'left', reason: null });
    assert.equal((await (await preview(id, 'bin')).json()).right.reason, 'binary');
    assert.equal((await (await preview(id, 'big')).json()).left.reason, 'tooLarge');
    assert.equal((await (await preview(id, 'only-left')).json()).right.reason, 'missing');
    assert.equal((await preview(id, '../secret')).status, 400);
    assert.equal((await preview(id, '')).status, 400);
  });

  test('previews belong to their own comparison, and old ones expire after server.maxComparisons', async () => {
    const first = await compare();
    const second = await compare(right, left);
    assert.equal((await (await preview(first.id, 'only-left')).json()).right.reason, 'missing');
    assert.equal((await (await preview(second.id, 'only-left')).json()).left.reason, 'missing');

    await compare();
    assert.equal((await preview(first.id, 'text.txt')).status, 404);
    assert.equal((await preview('unknown', 'text.txt')).status, 404);
  });

  test('creates samples on request', async () => {
    const response = await post('/api/samples', {});
    assert.equal(response.status, 200);
    const samples = await response.json();
    assert.equal(samples.ready, true);
    assert.equal((await (await fetch(`${base}/api/settings`)).json()).samples.ready, true);
    await compare(samples.left, samples.right);
  });

  test('unknown routes return 404', async () => {
    assert.equal((await fetch(`${base}/api/nope`)).status, 404);
    assert.equal((await fetch(`${base}/api/compare`)).status, 404);
  });

  test('internal errors return 500 and are logged, not shown', async () => {
    const before = logged.length;
    // A folder the scan cannot read makes compareFolders fail inside the server.
    const locked = path.join(root, 'locked');
    await fs.mkdir(path.join(locked, 'inner'), { recursive: true });
    await fs.chmod(path.join(locked, 'inner'), 0o000);
    try {
      if (process.platform === 'win32' || process.getuid?.() === 0) return;
      const response = await post('/api/compare', { left: locked, right });
      assert.equal(response.status, 500);
      assert.doesNotMatch((await response.json()).error, /EACCES/);
      assert.ok(logged.length > before);
    } finally {
      await fs.chmod(path.join(locked, 'inner'), 0o755);
    }
  });
});
