import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { STATUS, compareFolders } from '../src/compare.js';
import { defaultConfigFile } from '../src/config.js';
import { loadSampleManifest } from '../src/data.js';
import { createSamples, samplesReady } from '../src/samples.js';
import { readJson, statusOf, tempDir } from './helpers.js';

const defaults = await readJson(defaultConfigFile);
const sampleOptions = { previewMaxBytes: defaults.preview.maxBytes };
const compareOptions = { exclude: defaults.compare.exclude, hashAlgorithm: defaults.compare.hashAlgorithm };

describe('createSamples', () => {
  test('creates samples that give the counts documented in the README', async (t) => {
    const dir = path.join(await tempDir(t), 'samples');
    const samples = await createSamples(dir, sampleOptions);
    assert.equal(await samplesReady(dir), true);

    const result = await compareFolders(samples.left, samples.right, compareOptions);
    const links = samples.symlinksSkipped ? 0 : 1;
    assert.deepEqual(result.totals, { identical: 3 + links, modified: 5 + links, onlyLeft: 1, onlyRight: 3, typeChanged: 1 });

    const expected = {
      'README.txt': STATUS.IDENTICAL,
      'docs/faq.md': STATUS.IDENTICAL,
      'config.json': STATUS.MODIFIED,
      'notes.md': STATUS.MODIFIED,
      'docs/guide/setup.md': STATUS.MODIFIED,
      'legacy.txt': STATUS.ONLY_LEFT,
      'new-feature.js': STATUS.ONLY_RIGHT,
      assets: STATUS.ONLY_RIGHT,
      docs: STATUS.MODIFIED,
      'generated/big.log': STATUS.MODIFIED,
      'generated/data.bin': STATUS.MODIFIED,
      'generated/output': STATUS.TYPE_CHANGED,
      'generated/output/index.html': STATUS.ONLY_RIGHT,
    };
    for (const [relative, status] of Object.entries(expected)) assert.equal(statusOf(result, relative), status, relative);
    if (!samples.symlinksSkipped) {
      assert.equal(statusOf(result, 'generated/same-link'), STATUS.IDENTICAL);
      assert.equal(statusOf(result, 'generated/latest'), STATUS.MODIFIED);
    }
    assert.equal(result.items.some((item) => item.path.includes('node_modules')), false);

    const withHidden = await compareFolders(samples.left, samples.right, { ...compareOptions, includeHidden: true });
    assert.equal(withHidden.totals.modified, result.totals.modified + 1);
    assert.equal(statusOf(withHidden, '.env.example'), STATUS.MODIFIED);
  });

  test('writes every case from data/samples.json', async (t) => {
    const { cases, generatedDir } = loadSampleManifest();
    const samples = await createSamples(path.join(await tempDir(t), 's'), sampleOptions);
    for (const sample of cases) {
      for (const side of ['left', 'right']) {
        const file = path.join(samples[side], generatedDir, ...sample.path.split('/'));
        if (sample[side] === undefined || (sample.kind === 'symlink' && samples.symlinksSkipped)) continue;
        await assert.doesNotReject(fs.lstat(file), `${side}/${sample.path}`);
      }
    }
  });

  test('sizes the large file from preview.maxBytes', async (t) => {
    const small = await createSamples(path.join(await tempDir(t), 's'), { previewMaxBytes: 1000 });
    const size = (await fs.stat(path.join(small.left, 'generated', 'big.log'))).size;
    assert.ok(size > 1000 && size < 2000, `size ${size}`);

    const normal = await createSamples(path.join(await tempDir(t), 'n'), sampleOptions);
    assert.ok((await fs.stat(path.join(normal.left, 'generated', 'big.log'))).size > sampleOptions.previewMaxBytes);
  });

  test('config.json samples have the same size, so only the hash can tell them apart', async (t) => {
    const samples = await createSamples(path.join(await tempDir(t), 's'), sampleOptions);
    const [left, right] = await Promise.all([samples.left, samples.right].map((dir) => fs.stat(path.join(dir, 'config.json'))));
    assert.equal(left.size, right.size);
  });

  test('can be re-run on its own folder', async (t) => {
    const dir = path.join(await tempDir(t), 's');
    await createSamples(dir, sampleOptions);
    await fs.writeFile(path.join(dir, 'left', 'extra.txt'), 'x');
    await createSamples(dir, sampleOptions);
    await assert.rejects(fs.access(path.join(dir, 'left', 'extra.txt')));
  });

  test('refuses a non-empty folder it did not create', async (t) => {
    const dir = await tempDir(t);
    await fs.writeFile(path.join(dir, 'important.txt'), 'keep me');
    await assert.rejects(createSamples(dir, sampleOptions), /not empty/);
    assert.equal(await fs.readFile(path.join(dir, 'important.txt'), 'utf8'), 'keep me');
  });
});
