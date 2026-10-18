import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { STATUS, compareFolders, isCounted, safeResolve } from '../src/compare.js';
import { folderPair, statusOf, writeTree } from './helpers.js';

describe('compareFolders', () => {
  test('detects identical, modified and unique files', async (t) => {
    const { left, right } = await folderPair(t);
    await writeTree(left, { same: 'abc', modified: 'old', left: 'x' });
    await writeTree(right, { same: 'abc', modified: 'new', right: 'y' });

    const result = await compareFolders(left, right);
    assert.equal(result.totals.identical, 1);
    assert.equal(result.totals.modified, 1);
    assert.equal(result.totals.onlyLeft, 1);
    assert.equal(result.totals.onlyRight, 1);
  });

  test('hashes content, not just file size', async (t) => {
    const { left, right } = await folderPair(t);
    await writeTree(left, { file: 'ab' });
    await writeTree(right, { file: 'cd' });

    assert.equal((await compareFolders(left, right)).totals.modified, 1);
  });

  test('uses the configured hash algorithm', async (t) => {
    const { left, right } = await folderPair(t);
    await writeTree(left, { file: 'ab' });
    await writeTree(right, { file: 'ab' });

    assert.equal((await compareFolders(left, right, { hashAlgorithm: 'sha512' })).totals.identical, 1);
    await assert.rejects(compareFolders(left, right, { hashAlgorithm: 'not-a-hash' }));
  });

  test('folders take their status from their contents and are not counted', async (t) => {
    const { left, right } = await folderPair(t);
    await writeTree(left, { 'same/x.txt': '1', 'changed/deep/y.txt': 'old' });
    await writeTree(right, { 'same/x.txt': '1', 'changed/deep/y.txt': 'new!' });

    const result = await compareFolders(left, right);
    assert.equal(statusOf(result, 'same'), STATUS.IDENTICAL);
    assert.equal(statusOf(result, 'changed'), STATUS.MODIFIED);
    assert.equal(statusOf(result, 'changed/deep'), STATUS.MODIFIED);
    assert.deepEqual(result.totals, { identical: 1, modified: 1, onlyLeft: 0, onlyRight: 0, typeChanged: 0 });
  });

  test('counts a file that became a folder as typeChanged', async (t) => {
    const { left, right } = await folderPair(t);
    await writeTree(left, { out: 'file' });
    await writeTree(right, { 'out/index.html': 'x' });

    const result = await compareFolders(left, right);
    assert.equal(statusOf(result, 'out'), STATUS.TYPE_CHANGED);
    assert.equal(result.totals.typeChanged, 1);
    assert.equal(result.totals.onlyRight, 1);
  });

  test('skips excluded names at any depth and hidden files by default', async (t) => {
    const { left, right } = await folderPair(t);
    for (const dir of [left, right]) {
      await writeTree(dir, { 'node_modules/p/i.js': 'x', 'sub/node_modules/q.js': 'x', '.env': dir });
    }

    const result = await compareFolders(left, right, { exclude: ['node_modules'] });
    assert.deepEqual(result.items.map((item) => item.path), ['sub']);

    const withHidden = await compareFolders(left, right, { exclude: ['node_modules'], includeHidden: true });
    assert.equal(statusOf(withHidden, '.env'), STATUS.MODIFIED);
  });

  test('compares symlink targets', { skip: process.platform === 'win32' && 'symlinks need extra rights on Windows' }, async (t) => {
    const { left, right } = await folderPair(t);
    await fs.symlink('one', path.join(left, 'same'));
    await fs.symlink('one', path.join(right, 'same'));
    await fs.symlink('one', path.join(left, 'diff'));
    await fs.symlink('two', path.join(right, 'diff'));

    const result = await compareFolders(left, right);
    assert.equal(statusOf(result, 'same'), STATUS.IDENTICAL);
    assert.equal(statusOf(result, 'diff'), STATUS.MODIFIED);
  });

  test('isCounted skips folders but counts type changes', () => {
    assert.equal(isCounted({ typeLeft: 'directory', typeRight: 'directory' }), false);
    assert.equal(isCounted({ typeLeft: 'directory', typeRight: null }), false);
    assert.equal(isCounted({ typeLeft: 'file', typeRight: 'directory' }), true);
    assert.equal(isCounted({ typeLeft: 'file', typeRight: null }), true);
  });
});

describe('safeResolve', () => {
  test('rejects traversal', () => {
    assert.throws(() => safeResolve('/tmp/alpha', '../secret'));
    assert.throws(() => safeResolve('/tmp/alpha', '/etc/passwd'));
  });

  test('rejects backslashes, null bytes and empty paths', () => {
    assert.throws(() => safeResolve('/tmp/alpha', 'a\\b'));
    assert.throws(() => safeResolve('/tmp/alpha', 'a\0b'));
    assert.throws(() => safeResolve('/tmp/alpha', ''));
  });

  test('resolves paths inside the folder', () => {
    assert.equal(safeResolve('/tmp/alpha', 'docs/a.md'), path.resolve('/tmp/alpha', 'docs/a.md'));
  });
});
