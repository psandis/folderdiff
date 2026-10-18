import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { binPath, projectRoot, readJson, tempDir, writeTree } from './helpers.js';

const pkg = await readJson(path.join(projectRoot, 'package.json'));

/**
 * Runs the real command line with HOME pointed at `home` and no PORT set.
 * With `waitFor`, the process is stopped as soon as stdout contains that text (for the GUI server).
 */
function cli(home, args, { waitFor, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env, HOME: home, USERPROFILE: home, ...env };
    if (!('PORT' in env)) delete childEnv.PORT;
    const child = spawn(process.execPath, [binPath, ...args], { env: childEnv });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (waitFor && stdout.includes(waitFor)) child.kill();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('folderdiff command line', () => {
  test('--version and --help', async (t) => {
    const home = await tempDir(t);
    assert.equal((await cli(home, ['--version'])).stdout.trim(), pkg.version);

    const help = await cli(home, ['--help']);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /folderdiff compare <left> <right>/);
  });

  test('samples, then compare in text and JSON', async (t) => {
    const home = await tempDir(t);
    const samples = await cli(home, ['samples']);
    assert.equal(samples.code, 0, samples.stderr);
    assert.match(samples.stdout, /Sample folders ready/);

    const left = path.join(home, '.folderdiff', 'samples', 'left');
    const right = path.join(home, '.folderdiff', 'samples', 'right');

    const text = await cli(home, ['compare', left, right]);
    assert.equal(text.code, 1);
    assert.match(text.stdout, /Only left {5}1/);
    assert.match(text.stdout, /only left {5}legacy\.txt/);
    assert.doesNotMatch(text.stdout, /README\.txt/);

    assert.match((await cli(home, ['compare', left, right, '--all'])).stdout, /identical {5}README\.txt/);

    const json = JSON.parse((await cli(home, ['compare', left, right, '--json'])).stdout);
    assert.equal(json.totals.onlyLeft, 1);
    assert.equal(json.totals.onlyRight, 3);
    assert.equal(json.totals.typeChanged, 1);

    const hidden = JSON.parse((await cli(home, ['compare', left, right, '--json', '--hidden'])).stdout);
    assert.equal(hidden.totals.modified, json.totals.modified + 1);
  });

  test('samples into a chosen folder', async (t) => {
    const home = await tempDir(t);
    const target = path.join(home, 'custom');
    const result = await cli(home, ['samples', target]);
    assert.equal(result.code, 0, result.stderr);
    await fs.access(path.join(target, 'left', 'README.txt'));
  });

  test('compare exits 0 for matching folders', async (t) => {
    const home = await tempDir(t);
    const a = path.join(home, 'a');
    const b = path.join(home, 'b');
    await writeTree(a, { 'f.txt': 'same' });
    await writeTree(b, { 'f.txt': 'same' });

    const result = await cli(home, ['compare', a, b]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /No differences\./);
  });

  test('usage errors exit 2 with a hint', async (t) => {
    const home = await tempDir(t);
    for (const args of [['compare', 'only-one'], ['--json'], ['--port', 'abc'], ['--nope'], ['bogus'], ['samples', 'a', 'b']]) {
      const result = await cli(home, args);
      assert.equal(result.code, 2, args.join(' '));
      assert.match(result.stderr, /^error: /);
      assert.match(result.stderr, /folderdiff --help/);
    }

    const missing = await cli(home, ['compare', path.join(home, 'nope1'), path.join(home, 'nope2')]);
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /Folder not found/);
  });

  test('the GUI server reads ~/.folderdiff.json, PORT and --port', async (t) => {
    const home = await tempDir(t);
    await fs.writeFile(path.join(home, '.folderdiff.json'), JSON.stringify({ server: { port: 0 } }));

    const fromFile = await cli(home, [], { waitFor: 'running at' });
    assert.match(fromFile.stdout, /running at http:\/\/127\.0\.0\.1:\d+/);
    assert.doesNotMatch(fromFile.stdout, /:4328\b/);

    const badPort = await cli(home, [], { env: { PORT: 'abc' } });
    assert.equal(badPort.code, 2);
    assert.match(badPort.stderr, /PORT environment variable/);

    // --port overrides PORT, so an invalid PORT does not matter when --port is given.
    const flagWins = await cli(home, ['--port', '0'], { env: { PORT: 'abc' }, waitFor: 'running at' });
    assert.match(flagWins.stdout, /running at http:\/\/127\.0\.0\.1:\d+/);

    await fs.writeFile(path.join(home, '.folderdiff.json'), JSON.stringify({ server: { host: '0.0.0.0' } }));
    const badHost = await cli(home, []);
    assert.equal(badHost.code, 2);
    assert.match(badHost.stderr, /server\.host/);
  });
});
