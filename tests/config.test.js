import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { ConfigError, defaultConfigFile, loadConfig, userConfigName } from '../src/config.js';
import { readJson, tempDir } from './helpers.js';

// Every test uses an empty temporary home and an empty environment,
// so the real ~/.folderdiff.json and PORT are never read.
async function setup(t, userConfig) {
  const home = await tempDir(t, 'folderdiff-home-');
  if (userConfig !== undefined) {
    const content = typeof userConfig === 'string' ? userConfig : JSON.stringify(userConfig);
    await fs.writeFile(path.join(home, userConfigName), content);
  }
  return home;
}

describe('loadConfig', () => {
  test('every value comes from config/default.json when nothing overrides it', async (t) => {
    const defaults = await readJson(defaultConfigFile);
    const home = await setup(t);
    const config = loadConfig({ home, env: {} });

    assert.deepEqual(config.server, defaults.server);
    assert.deepEqual(config.compare, defaults.compare);
    assert.deepEqual(config.preview, defaults.preview);
    assert.equal(config.samples.dir, path.join(home, '.folderdiff', 'samples'));
    assert.equal(config.userFile, null);
  });

  test('~/.folderdiff.json overrides only the keys it sets', async (t) => {
    const home = await setup(t, { server: { port: 5000 }, compare: { exclude: ['dist'] } });
    const config = loadConfig({ home, env: {} });

    assert.equal(config.server.port, 5000);
    assert.equal(config.server.host, '127.0.0.1');
    assert.deepEqual(config.compare.exclude, ['dist']);
    assert.equal(config.preview.maxBytes, 200000);
    assert.equal(config.userFile, path.join(home, userConfigName));
  });

  test('PORT overrides the user file, and --port overrides PORT', async (t) => {
    const home = await setup(t, { server: { port: 5000 } });

    assert.equal(loadConfig({ home, env: { PORT: '6000' } }).server.port, 6000);
    assert.equal(loadConfig({ home, env: { PORT: '6000' }, flags: { port: 7000 } }).server.port, 7000);
    assert.equal(loadConfig({ home, env: { PORT: '' } }).server.port, 5000);
    assert.throws(() => loadConfig({ home, env: { PORT: 'abc' } }), /server\.port.*PORT environment variable/);
  });

  test('--host overrides the config', async (t) => {
    const home = await setup(t);
    assert.equal(loadConfig({ home, env: {}, flags: { host: 'localhost' } }).server.host, 'localhost');
  });

  test('--config replaces ~/.folderdiff.json and must exist', async (t) => {
    const home = await setup(t, { server: { port: 5000 } });
    const other = path.join(home, 'other.json');
    await fs.writeFile(other, JSON.stringify({ preview: { maxBytes: 10 } }));

    const config = loadConfig({ home, env: {}, configFile: other });
    assert.equal(config.server.port, 4328);
    assert.equal(config.preview.maxBytes, 10);
    assert.throws(() => loadConfig({ home, env: {}, configFile: path.join(home, 'missing.json') }), /Cannot read config file/);
  });

  test('samples.dir expands ~ and resolves relative paths from home', async (t) => {
    const home = await setup(t, { samples: { dir: '~/my-samples' } });
    assert.equal(loadConfig({ home, env: {} }).samples.dir, path.join(home, 'my-samples'));

    await fs.writeFile(path.join(home, userConfigName), JSON.stringify({ samples: { dir: 'rel/samples' } }));
    assert.equal(loadConfig({ home, env: {} }).samples.dir, path.join(home, 'rel', 'samples'));
  });

  test('rejects invalid values and names the key and where it came from', async (t) => {
    const cases = [
      [{ server: { host: '0.0.0.0' } }, /server\.host/],
      [{ server: { port: 70000 } }, /server\.port/],
      [{ server: { maxRequestBytes: 0 } }, /server\.maxRequestBytes/],
      [{ server: { maxComparisons: 1.5 } }, /server\.maxComparisons/],
      [{ compare: { exclude: 'x' } }, /compare\.exclude/],
      [{ compare: { includeHidden: 'yes' } }, /compare\.includeHidden/],
      [{ compare: { hashAlgorithm: 'nope' } }, /compare\.hashAlgorithm/],
      [{ preview: { maxBytes: -1 } }, /preview\.maxBytes/],
      [{ samples: { dir: '' } }, /samples\.dir/],
    ];
    for (const [userConfig, key] of cases) {
      const home = await setup(t, userConfig);
      assert.throws(() => loadConfig({ home, env: {} }), (error) => error instanceof ConfigError && key.test(error.message) && error.message.includes(home));
    }
  });

  test('rejects unknown sections and keys to catch typos', async (t) => {
    const badSection = await setup(t, { sever: {} });
    assert.throws(() => loadConfig({ home: badSection, env: {} }), /Unknown config section "sever"/);
    const badKey = await setup(t, { server: { prot: 1 } });
    assert.throws(() => loadConfig({ home: badKey, env: {} }), /Unknown config key "server\.prot"/);
  });

  test('reports invalid JSON clearly', async (t) => {
    const home = await setup(t, '{not json');
    assert.throws(() => loadConfig({ home, env: {} }), /not valid JSON/);
  });

  test('returns a frozen object', async (t) => {
    const config = loadConfig({ home: await setup(t), env: {} });
    assert.equal(Object.isFrozen(config.server), true);
    assert.equal(Object.isFrozen(config.compare.exclude), true);
  });
});
