import { getHashes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configDir } from './paths.js';

/** Default settings shipped with the package. */
export const defaultConfigFile = path.join(configDir, 'default.json');

/** File name of the optional user overrides in the home folder. */
export const userConfigName = '.folderdiff.json';

// Security invariant, not a setting: the GUI server must never listen beyond this machine.
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost'];

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

const positiveInteger = { check: (v) => Number.isInteger(v) && v > 0, expected: 'a positive whole number' };
const boolean = { check: (v) => typeof v === 'boolean', expected: 'true or false' };

/** Every allowed key, with its validation rule. Unknown keys are rejected to catch typos. */
const SCHEMA = {
  server: {
    host: { check: (v) => LOOPBACK_HOSTS.includes(v), expected: `one of ${LOOPBACK_HOSTS.join(', ')}` },
    port: { check: (v) => Number.isInteger(v) && v >= 0 && v <= 65535, expected: 'a whole number from 0 to 65535' },
    maxRequestBytes: positiveInteger,
    maxComparisons: positiveInteger,
  },
  compare: {
    exclude: {
      check: (v) => Array.isArray(v) && v.every((name) => typeof name === 'string' && name.length > 0),
      expected: 'a list of file or folder names',
    },
    includeHidden: boolean,
    hashAlgorithm: {
      check: (v) => typeof v === 'string' && getHashes().includes(v),
      expected: 'a hash algorithm supported by Node.js, for example sha256',
    },
  },
  preview: {
    maxBytes: positiveInteger,
  },
  samples: {
    dir: { check: (v) => typeof v === 'string' && v.length > 0, expected: 'a folder path' },
  },
};

function readConfigFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new ConfigError(`Cannot read config file ${file}: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`Config file ${file} is not valid JSON: ${error.message}`);
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Copies the values of one config layer over `target`, remembering where each value came from.
 * Throws on unknown sections and keys.
 */
function applyLayer(target, sources, layer, sourceName) {
  if (!isPlainObject(layer)) throw new ConfigError(`${sourceName} must contain a JSON object`);
  for (const [section, values] of Object.entries(layer)) {
    if (!(section in SCHEMA)) throw new ConfigError(`Unknown config section "${section}" in ${sourceName}`);
    if (!isPlainObject(values)) throw new ConfigError(`Config section "${section}" in ${sourceName} must be an object`);
    for (const [key, value] of Object.entries(values)) {
      if (!(key in SCHEMA[section])) throw new ConfigError(`Unknown config key "${section}.${key}" in ${sourceName}`);
      target[section][key] = value;
      sources[`${section}.${key}`] = sourceName;
    }
  }
}

/** Expands a leading "~" to the home folder. Other relative paths are relative to the home folder. */
export function expandHome(p, home) {
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) return path.join(home, p.slice(1));
  return path.resolve(home, p);
}

/**
 * Loads the settings in three layers, each overriding the one before:
 * 1. config/default.json (shipped defaults)
 * 2. ~/.folderdiff.json, or the file given with --config
 * 3. the PORT environment variable
 * 4. command line flags (--host, --port)
 *
 * @param {object} [options]
 * @param {string} [options.home] Home folder, defaults to the current user's.
 * @param {string} [options.configFile] Use this file instead of ~/.folderdiff.json. It must exist.
 * @param {Record<string, string | undefined>} [options.env] Environment, defaults to process.env.
 * @param {{host?: string, port?: number}} [options.flags] Values from the command line.
 * @returns {object} Validated, frozen settings with `samples.dir` as an absolute path.
 */
export function loadConfig({ home = os.homedir(), configFile, env = process.env, flags = {} } = {}) {
  const config = Object.fromEntries(Object.keys(SCHEMA).map((section) => [section, {}]));
  const sources = {};
  applyLayer(config, sources, readConfigFile(defaultConfigFile), defaultConfigFile);

  const userFile = configFile ? path.resolve(configFile) : path.join(home, userConfigName);
  const hasUserFile = Boolean(configFile) || fs.existsSync(userFile);
  if (hasUserFile) applyLayer(config, sources, readConfigFile(userFile), userFile);

  if (env.PORT !== undefined && env.PORT !== '') {
    applyLayer(config, sources, { server: { port: /^\d+$/.test(env.PORT) ? Number(env.PORT) : env.PORT } }, 'the PORT environment variable');
  }

  const flagLayer = { server: {} };
  if (flags.host !== undefined) flagLayer.server.host = flags.host;
  if (flags.port !== undefined) flagLayer.server.port = flags.port;
  applyLayer(config, sources, flagLayer, 'command line flags');

  for (const [section, keys] of Object.entries(SCHEMA)) {
    for (const [key, rule] of Object.entries(keys)) {
      const value = config[section][key];
      const name = `${section}.${key}`;
      if (value === undefined) throw new ConfigError(`Missing config key "${name}" in ${defaultConfigFile}`);
      if (!rule.check(value)) {
        throw new ConfigError(`Invalid config value ${name}: expected ${rule.expected}, got ${JSON.stringify(value)} (from ${sources[name]})`);
      }
    }
  }

  config.samples.dir = expandHome(config.samples.dir, home);
  return deepFreeze({ ...config, userFile: hasUserFile ? userFile : null });
}

function deepFreeze(object) {
  for (const value of Object.values(object)) {
    if (typeof value === 'object' && value !== null) deepFreeze(value);
  }
  return Object.freeze(object);
}
