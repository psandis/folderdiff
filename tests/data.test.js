import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { STATUS } from '../src/compare.js';
import { PREVIEW_REASON, SAMPLE_KINDS, loadSampleManifest, loadStatuses } from '../src/data.js';

describe('data/statuses.json', () => {
  test('has a label for exactly the statuses the code produces', () => {
    const { statuses } = loadStatuses();
    assert.deepEqual(statuses.map((s) => s.key).sort(), Object.values(STATUS).sort());
    for (const status of statuses) {
      assert.ok(status.label.length > 0);
      assert.ok(status.short.length > 0);
    }
  });

  test('has a message for exactly the preview reasons the server produces', () => {
    const { previewReasons } = loadStatuses();
    assert.deepEqual(Object.keys(previewReasons).sort(), Object.values(PREVIEW_REASON).sort());
    assert.match(previewReasons.tooLarge, /\{limit\}/);
    assert.match(previewReasons.symlink, /\{target\}/);
  });
});

describe('data/samples.json', () => {
  test('every case is valid', () => {
    const manifest = loadSampleManifest();
    assert.ok(manifest.cases.length > 0);
    for (const sample of manifest.cases) {
      assert.ok(SAMPLE_KINDS.includes(sample.kind), sample.path);
      assert.ok(sample.left !== undefined || sample.right !== undefined, sample.path);
      assert.equal(typeof sample.purpose, 'string', sample.path);
    }
  });
});
