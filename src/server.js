import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { compareFolders, safeResolve } from './compare.js';
import { PREVIEW_REASON, loadStatuses } from './data.js';
import { packageInfo, publicDir } from './paths.js';
import { createSamples, samplePaths, samplesReady } from './samples.js';

/** An error with an HTTP status. Its message is safe to show to the user. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

const STATIC_FILES = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' },
};

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

async function readJsonBody(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, `Request body is larger than ${maxBytes} bytes`);
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON');
  }
}

async function validateFolder(dir) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new HttpError(400, 'Use absolute folder paths');
  let stats;
  try {
    stats = await fs.stat(dir);
  } catch (error) {
    if (error.code === 'ENOENT') throw new HttpError(400, `Folder not found: ${dir}`);
    throw error;
  }
  if (!stats.isDirectory()) throw new HttpError(400, `Not a directory: ${dir}`);
  return fs.realpath(dir);
}

function resolveInside(base, relative) {
  try {
    return safeResolve(base, relative);
  } catch (error) {
    throw new HttpError(400, error.message);
  }
}

/** One side of a preview: the text, or null with a reason from PREVIEW_REASON. */
async function previewSide(base, relative, maxBytes) {
  const absolute = resolveInside(base, relative);
  let stats;
  try {
    stats = await fs.lstat(absolute);
  } catch (error) {
    if (error.code === 'ENOENT') return { text: null, reason: PREVIEW_REASON.MISSING };
    throw error;
  }
  if (stats.isSymbolicLink()) return { text: null, reason: PREVIEW_REASON.SYMLINK, target: await fs.readlink(absolute) };
  if (!stats.isFile()) return { text: null, reason: PREVIEW_REASON.NOT_FILE };
  if (stats.size > maxBytes) return { text: null, reason: PREVIEW_REASON.TOO_LARGE };

  // A parent folder could be a symlink pointing elsewhere. Read only what really is inside base.
  const canonical = await fs.realpath(absolute);
  if (!canonical.startsWith(base + path.sep)) throw new HttpError(400, 'Preview path escapes selected folder');
  const buffer = await fs.readFile(canonical);
  if (buffer.includes(0)) return { text: null, reason: PREVIEW_REASON.BINARY };
  return { text: buffer.toString('utf8'), reason: null };
}

/**
 * Creates the GUI server. Call `.listen()` on the result.
 *
 * @param {object} config Settings from loadConfig().
 * @param {{log?: (message: string) => void}} [options] Where internal errors are reported.
 * @returns {http.Server}
 */
export function createServer(config, { log = (message) => console.error(message) } = {}) {
  // Results kept for previews, keyed by comparison id. The oldest is dropped beyond maxComparisons.
  const comparisons = new Map();

  function remember(result) {
    const id = crypto.randomUUID();
    comparisons.set(id, result);
    while (comparisons.size > config.server.maxComparisons) comparisons.delete(comparisons.keys().next().value);
    return id;
  }

  const routes = {
    'GET /api/settings': async () => {
      const { statuses, previewReasons } = loadStatuses();
      const dir = config.samples.dir;
      return {
        version: packageInfo.version,
        previewMaxBytes: config.preview.maxBytes,
        includeHidden: config.compare.includeHidden,
        exclude: config.compare.exclude,
        statuses,
        previewReasons,
        samples: { dir, ...samplePaths(dir), ready: await samplesReady(dir) },
      };
    },

    'POST /api/compare': async (req) => {
      const body = await readJsonBody(req, config.server.maxRequestBytes);
      const left = await validateFolder(body.left);
      const right = await validateFolder(body.right);
      if (left === right) throw new HttpError(400, 'Choose different folders');
      const result = await compareFolders(left, right, {
        includeHidden: typeof body.includeHidden === 'boolean' ? body.includeHidden : config.compare.includeHidden,
        exclude: config.compare.exclude,
        hashAlgorithm: config.compare.hashAlgorithm,
      });
      return {
        id: remember(result),
        ...result,
        left: path.basename(left),
        right: path.basename(right),
        leftPath: left,
        rightPath: right,
      };
    },

    'GET /api/text': async (_req, url) => {
      const comparison = comparisons.get(url.searchParams.get('id'));
      if (!comparison) throw new HttpError(404, 'Compare folders first');
      const relative = url.searchParams.get('path');
      const max = config.preview.maxBytes;
      const [left, right] = await Promise.all([previewSide(comparison.left, relative, max), previewSide(comparison.right, relative, max)]);
      return { left, right, maxBytes: max };
    },

    'POST /api/samples': async (req) => {
      await readJsonBody(req, config.server.maxRequestBytes);
      const created = await createSamples(config.samples.dir, { previewMaxBytes: config.preview.maxBytes });
      return { ...created, ready: true };
    },
  };

  const server = http.createServer(async (req, res) => {
    try {
      // Answer only requests addressed to this server. Blocks DNS rebinding.
      const port = server.address().port;
      const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
      if (!allowedHosts.includes(req.headers.host)) throw new HttpError(403, 'Forbidden host');

      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === 'POST') {
        // Only the FolderDiff page may post, and only JSON. Blocks cross-site requests.
        const origin = req.headers.origin;
        if (origin && !allowedHosts.some((host) => origin === `http://${host}`)) throw new HttpError(403, 'Forbidden origin');
        if (!String(req.headers['content-type']).startsWith('application/json')) {
          throw new HttpError(415, 'Content-Type must be application/json');
        }
      }

      const staticFile = req.method === 'GET' ? STATIC_FILES[url.pathname] : undefined;
      if (staticFile) {
        const content = await fs.readFile(path.join(publicDir, staticFile.file), 'utf8');
        return send(res, 200, content, staticFile.type);
      }
      const route = routes[`${req.method} ${url.pathname}`];
      if (!route) throw new HttpError(404, 'Not found');
      return send(res, 200, await route(req, url));
    } catch (error) {
      if (error instanceof HttpError) return send(res, error.status, { error: error.message });
      log(`folderdiff: internal error on ${req.method} ${req.url}: ${error.stack ?? error}`);
      return send(res, 500, { error: 'Internal error. See the terminal running folderdiff.' });
    }
  });
  return server;
}
