import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { STATUS, compareFolders, isCounted } from './compare.js';
import { loadConfig } from './config.js';
import { loadStatuses } from './data.js';
import { packageInfo } from './paths.js';
import { createSamples } from './samples.js';
import { createServer } from './server.js';

const HELP = `folderdiff ${packageInfo.version}
Local, read-only folder comparison with a browser GUI.

Usage:
  folderdiff [--port <n>] [--host <host>] [--open]   Start the GUI
  folderdiff compare <left> <right> [--json] [--all] [--hidden]
                                                     Compare two folders in the terminal
  folderdiff samples [dir]                           Create sample folders to try it on

Options:
  --port <n>       GUI port (overrides config and PORT)
  --host <host>    GUI host, 127.0.0.1 or localhost (overrides config)
  --open           Open the GUI in your browser
  --json           Print the comparison as JSON
  --all            Also list identical files
  --hidden         Include hidden files (dotfiles)
  --config <file>  Use this config file instead of ~/.folderdiff.json
  -v, --version    Print the version
  -h, --help       Print this help

compare exits with 0 when the folders match, 1 when they differ, 2 on errors.

Examples:
  folderdiff samples
  folderdiff compare ~/.folderdiff/samples/left ~/.folderdiff/samples/right
  folderdiff compare ./v1 ./v2 --json
  folderdiff --port 5000 --open
`;

const OPTIONS = {
  port: { type: 'string' },
  host: { type: 'string' },
  open: { type: 'boolean' },
  config: { type: 'string' },
  json: { type: 'boolean' },
  all: { type: 'boolean' },
  hidden: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
};

const COMMAND_FLAGS = {
  serve: ['port', 'host', 'open', 'config'],
  compare: ['json', 'all', 'hidden', 'config'],
  samples: ['config'],
};

const EXIT = Object.freeze({ OK: 0, DIFFERENCES: 1, ERROR: 2 });

class UsageError extends Error {}

/**
 * Runs the command line.
 *
 * @param {string[]} argv Arguments after the program name.
 * @param {{stdout?: NodeJS.WritableStream, stderr?: NodeJS.WritableStream}} [io]
 * @returns {Promise<number | null>} The exit code, or null while the GUI server keeps running.
 */
export async function main(argv, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    return await run(argv, stdout, stderr);
  } catch (error) {
    stderr.write(`error: ${error.message}\n`);
    if (error instanceof UsageError) stderr.write('Run folderdiff --help for usage.\n');
    return EXIT.ERROR;
  }
}

async function run(argv, stdout, stderr) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS });
  } catch (error) {
    throw new UsageError(error.message);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    stdout.write(HELP);
    return EXIT.OK;
  }
  if (values.version) {
    stdout.write(`${packageInfo.version}\n`);
    return EXIT.OK;
  }

  const command = ['compare', 'samples'].includes(positionals[0]) ? positionals[0] : 'serve';
  const args = command === 'serve' ? positionals : positionals.slice(1);
  for (const flag of Object.keys(values)) {
    if (!COMMAND_FLAGS[command].includes(flag)) {
      throw new UsageError(`--${flag} cannot be used with ${command === 'serve' ? 'the GUI server' : command}`);
    }
  }
  if (values.port !== undefined && !/^\d+$/.test(values.port)) {
    throw new UsageError(`--port must be a whole number, got "${values.port}"`);
  }

  const config = loadConfig({
    configFile: values.config,
    flags: { host: values.host, port: values.port === undefined ? undefined : Number(values.port) },
  });

  if (command === 'compare') return compareCommand(args, values, config, stdout);
  if (command === 'samples') return samplesCommand(args, config, stdout);
  if (args.length > 0) throw new UsageError(`unknown command "${args[0]}"`);
  return serveCommand(values, config, stdout, stderr);
}

async function resolveFolder(input) {
  const absolute = path.resolve(input);
  let stats;
  try {
    stats = await fs.stat(absolute);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Folder not found: ${absolute}`);
    throw error;
  }
  if (!stats.isDirectory()) throw new Error(`Not a folder: ${absolute}`);
  return fs.realpath(absolute);
}

function formatText(result, { all }) {
  const { statuses } = loadStatuses();
  const short = Object.fromEntries(statuses.map((s) => [s.key, s.short]));
  const width = Math.max(...statuses.flatMap((s) => [s.label.length, s.short.length])) + 2;

  const lines = [`Left:   ${result.left}`, `Right:  ${result.right}`, ''];
  for (const status of statuses) lines.push(`${status.label.padEnd(width)}${result.totals[status.key]}`);
  lines.push('');
  if (countDifferences(result) === 0) lines.push('No differences.');
  for (const item of result.items) {
    if (!isCounted(item)) continue;
    if (!all && item.status === STATUS.IDENTICAL) continue;
    lines.push(`${short[item.status].padEnd(width)}${item.path}`);
  }
  return `${lines.join('\n')}\n`;
}

function countDifferences(result) {
  return Object.entries(result.totals)
    .filter(([status]) => status !== STATUS.IDENTICAL)
    .reduce((sum, [, count]) => sum + count, 0);
}

async function compareCommand(args, values, config, stdout) {
  if (args.length !== 2) throw new UsageError('compare needs two folders: folderdiff compare <left> <right>');
  const [left, right] = await Promise.all(args.map(resolveFolder));
  if (left === right) throw new Error('Choose two different folders');

  const result = await compareFolders(left, right, {
    includeHidden: values.hidden ?? config.compare.includeHidden,
    exclude: config.compare.exclude,
    hashAlgorithm: config.compare.hashAlgorithm,
  });
  stdout.write(values.json ? `${JSON.stringify(result, null, 2)}\n` : formatText(result, { all: Boolean(values.all) }));
  return countDifferences(result) > 0 ? EXIT.DIFFERENCES : EXIT.OK;
}

async function samplesCommand(args, config, stdout) {
  if (args.length > 1) throw new UsageError('samples takes at most one folder: folderdiff samples [dir]');
  const dir = args[0] ? path.resolve(args[0]) : config.samples.dir;
  const created = await createSamples(dir, { previewMaxBytes: config.preview.maxBytes });

  const lines = [`Sample folders ready in ${created.dir}`, `  Left:   ${created.left}`, `  Right:  ${created.right}`];
  if (created.symlinksSkipped) {
    lines.push('', 'Symlinks skipped: this system does not allow creating them (on Windows, enable Developer Mode).');
  }
  lines.push('', 'Compare them in the terminal:', `  folderdiff compare "${created.left}" "${created.right}"`);
  if (dir === config.samples.dir) lines.push('', 'Or start the GUI with folderdiff and click "Load sample folders".');
  stdout.write(`${lines.join('\n')}\n`);
  return EXIT.OK;
}

async function serveCommand(values, config, stdout, stderr) {
  const { host, port } = config.server;
  const server = createServer(config);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, resolve);
    });
  } catch (error) {
    if (error.code === 'EADDRINUSE') throw new Error(`Port ${port} is already in use. Try folderdiff --port ${port + 1}`);
    throw error;
  }
  const url = `http://${host}:${server.address().port}`;
  stdout.write(`FolderDiff ${packageInfo.version} running at ${url}\nPress Ctrl+C to stop.\n`);
  if (values.open) openBrowser(url, stderr);
  return null;
}

function openBrowser(url, stderr) {
  const [command, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  spawn(command, args, { stdio: 'ignore', detached: true })
    .on('error', () => stderr.write(`Could not open a browser. Open ${url} yourself.\n`))
    .unref();
}
