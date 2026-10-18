import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

/** The comparison result for one path. Labels for these live in data/statuses.json. */
export const STATUS = Object.freeze({
  IDENTICAL: 'identical',
  MODIFIED: 'modified',
  ONLY_LEFT: 'onlyLeft',
  ONLY_RIGHT: 'onlyRight',
  TYPE_CHANGED: 'typeChanged',
});

export const ENTRY_TYPE = Object.freeze({
  FILE: 'file',
  DIRECTORY: 'directory',
  SYMLINK: 'symlink',
});

/**
 * Walks `root` recursively and records every folder, file and symlink by its relative path
 * (always with "/" separators). Symlinks are recorded with their target and never followed.
 *
 * @param {string} root Absolute folder path.
 * @param {{includeHidden: boolean, exclude: string[]}} options
 * @returns {Promise<Map<string, {type: string, size?: number, absolute?: string, target?: string}>>}
 */
export async function collect(root, { includeHidden, exclude }) {
  const entries = new Map();
  const skip = new Set(exclude);

  async function walk(dir, prefix) {
    const items = await fs.readdir(dir, { withFileTypes: true });
    for (const item of items) {
      if (skip.has(item.name)) continue;
      if (!includeHidden && item.name.startsWith('.')) continue;

      const relative = prefix ? `${prefix}/${item.name}` : item.name;
      const absolute = path.join(dir, item.name);
      if (item.isSymbolicLink()) {
        entries.set(relative, { type: ENTRY_TYPE.SYMLINK, target: await fs.readlink(absolute) });
      } else if (item.isDirectory()) {
        entries.set(relative, { type: ENTRY_TYPE.DIRECTORY });
        await walk(absolute, relative);
      } else if (item.isFile()) {
        const stats = await fs.stat(absolute);
        entries.set(relative, { type: ENTRY_TYPE.FILE, size: stats.size, absolute });
      }
    }
  }

  await walk(root, '');
  return entries;
}

function hashFile(file, algorithm) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

async function compareEntries(left, right, hashAlgorithm) {
  if (!left) return STATUS.ONLY_RIGHT;
  if (!right) return STATUS.ONLY_LEFT;
  if (left.type !== right.type) return STATUS.TYPE_CHANGED;
  // Folders are resolved from their contents afterwards, in resolveFolderStatuses.
  if (left.type === ENTRY_TYPE.DIRECTORY) return STATUS.IDENTICAL;
  if (left.type === ENTRY_TYPE.SYMLINK) return left.target === right.target ? STATUS.IDENTICAL : STATUS.MODIFIED;
  if (left.size !== right.size) return STATUS.MODIFIED;
  const [leftHash, rightHash] = await Promise.all([hashFile(left.absolute, hashAlgorithm), hashFile(right.absolute, hashAlgorithm)]);
  return leftHash === rightHash ? STATUS.IDENTICAL : STATUS.MODIFIED;
}

/** A folder that exists on both sides is modified when anything inside it differs. */
function resolveFolderStatuses(items) {
  const changedFolders = new Set();
  for (const item of items) {
    if (item.status === STATUS.IDENTICAL) continue;
    for (let i = item.path.lastIndexOf('/'); i > 0; i = item.path.lastIndexOf('/', i - 1)) {
      changedFolders.add(item.path.slice(0, i));
    }
  }
  for (const item of items) {
    if (item.typeLeft === ENTRY_TYPE.DIRECTORY && item.typeRight === ENTRY_TYPE.DIRECTORY) {
      item.status = changedFolders.has(item.path) ? STATUS.MODIFIED : STATUS.IDENTICAL;
    }
  }
}

const isFolderOrMissing = (type) => type === ENTRY_TYPE.DIRECTORY || type === null;

/**
 * Whether an item counts in the totals. Files and symlinks count. Folders are listed but not
 * counted, except when the type changed, so one changed file deep in a tree adds 1, not one per folder.
 */
export function isCounted(item) {
  return !(isFolderOrMissing(item.typeLeft) && isFolderOrMissing(item.typeRight));
}

/**
 * Compares two folders. Read-only: nothing is written.
 *
 * @param {string} left Absolute path of the left folder.
 * @param {string} right Absolute path of the right folder.
 * @param {{includeHidden?: boolean, exclude?: string[], hashAlgorithm?: string}} [options] Usually config.compare.
 * @returns {Promise<{left: string, right: string, totals: Record<string, number>, items: object[]}>}
 */
export async function compareFolders(left, right, { includeHidden = false, exclude = [], hashAlgorithm = 'sha256' } = {}) {
  const options = { includeHidden, exclude };
  const [leftEntries, rightEntries] = await Promise.all([collect(left, options), collect(right, options)]);
  const paths = [...new Set([...leftEntries.keys(), ...rightEntries.keys()])].sort((a, b) => a.localeCompare(b));

  const items = [];
  for (const relative of paths) {
    const l = leftEntries.get(relative);
    const r = rightEntries.get(relative);
    items.push({
      path: relative,
      status: await compareEntries(l, r, hashAlgorithm),
      typeLeft: l?.type ?? null,
      typeRight: r?.type ?? null,
      sizeLeft: l?.size ?? null,
      sizeRight: r?.size ?? null,
      targetLeft: l?.target ?? null,
      targetRight: r?.target ?? null,
    });
  }
  resolveFolderStatuses(items);

  const totals = Object.fromEntries(Object.values(STATUS).map((status) => [status, 0]));
  for (const item of items) {
    if (isCounted(item)) totals[item.status] += 1;
  }
  return { left, right, totals, items };
}

/**
 * Resolves a relative path inside `base`, refusing anything that would escape it.
 * Relative paths use "/" separators, as produced by collect().
 */
export function safeResolve(base, relative) {
  if (typeof relative !== 'string' || relative === '' || relative.includes('\\') || relative.includes('\0')) {
    throw new Error('Invalid path');
  }
  const resolved = path.resolve(base, relative);
  if (!resolved.startsWith(path.resolve(base) + path.sep)) throw new Error('Path escapes the selected folder');
  return resolved;
}
