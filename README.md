# FolderDiff

[![npm](https://img.shields.io/npm/v/folderdiff?style=flat-square)](https://www.npmjs.com/package/folderdiff)
[![CI](https://img.shields.io/github/actions/workflow/status/psandis/folderdiff/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/psandis/folderdiff/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/folderdiff?style=flat-square)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/folderdiff?style=flat-square)](./LICENSE)

Compare two folders and see exactly what changed. Local, read-only, with a browser GUI.

`folderdiff` answers the question you ask after every copy, backup, or release: what is actually different between these two folders?

It walks both folders, compares every file by size and SHA-256, and shows what is identical, modified, only on one side, or changed type. Use the browser GUI for a side-by-side text preview, or `folderdiff compare` in the terminal for scripts and CI. It never uploads, edits, deletes, or syncs anything.

## Why FolderDiff Exists

There are excellent folder comparison tools out there: [Meld](https://meldmerge.org) and [WinMerge](https://winmerge.org) are full visual diff and merge tools, [Beyond Compare](https://www.scootersoftware.com) is the commercial standard, and `diff -rq` is already on every Unix machine.

FolderDiff takes a different angle. It is a small read-only checker that lives in the npm ecosystem:

- **Zero dependencies**: only Node.js built-in modules, nothing to audit
- **Read-only by design**: no merge, no copy, no delete, so it is safe to point at anything
- **GUI and terminal**: a browser GUI for looking, `compare --json` and exit codes for scripts
- **npm-installable**: run `npx folderdiff` and you are up

## 10-Second Proof

```bash
npx folderdiff samples
npx folderdiff compare ~/.folderdiff/samples/left ~/.folderdiff/samples/right
```

```
Left:   /Users/you/.folderdiff/samples/left
Right:  /Users/you/.folderdiff/samples/right

Identical     4
Modified      6
Only left     1
Only right    3
Type changed  1

only right    assets/logo.svg
modified      config.json
modified      docs/guide/setup.md
modified      generated/big.log
modified      generated/data.bin
modified      generated/latest
type changed  generated/output
only right    generated/output/index.html
only left     legacy.txt
only right    new-feature.js
modified      notes.md
```

Then look at it in the browser:

```bash
npx folderdiff --open
```

```
FolderDiff 0.1.0 running at http://127.0.0.1:4328
Press Ctrl+C to stop.
```

Click **Load sample folders**, then click any file to see both sides next to each other.

## Commands

| Command | What it does |
|---------|-------------|
| `folderdiff` | Start the browser GUI at `http://127.0.0.1:4328` |
| `folderdiff compare <left> <right>` | Compare two folders in the terminal |
| `folderdiff samples [dir]` | Create sample folders that cover every status |

## Requirements

- Node.js 22.12+
- macOS, Linux or Windows
- A modern browser for the GUI (Chrome, Firefox, Safari, Edge)

CI runs the tests and the CLI on all three with Node.js 22 and 24 for every push.

## Install

```bash
npm install -g folderdiff
```

Or run without installing:

```bash
npx folderdiff
```

## Usage

### GUI (default)

```bash
folderdiff                  # start at http://127.0.0.1:4328
folderdiff --open           # also open it in your browser
folderdiff --port 5000      # use another port
```

Stop the server with `Ctrl+C`.

| Area | What it does |
|------|-------------|
| Left / Right folder | Absolute paths to compare, for example `/Users/you/project-v1` or `C:\Users\you\project-v1` |
| Include hidden files | Also compare dotfiles such as `.env.example`. Names in `compare.exclude` are always skipped and listed next to the checkbox |
| Load sample folders | Creates the sample folders on first click (in `samples.dir`) and compares them |
| Counters | Identical, Modified, Only left, Only right, Type changed |
| File list | Every entry with its status. Filter by name or by status |
| Preview | Click a file to see the left and right text side by side |

When a side cannot be previewed, the preview says why:

| Message | Meaning |
|---------|---------|
| `(missing on this side)` | The file exists only on the other side |
| `(binary file, no preview)` | The file contains zero bytes, so it is treated as binary |
| `(over 200 KB, no preview)` | The file is larger than `preview.maxBytes` |
| `(symlink to <target>)` | The entry is a symlink. Its target is shown instead of content |
| `(not a regular file)` | For example a socket or device file |

### Compare

```bash
folderdiff compare ./v1 ./v2             # list what differs
folderdiff compare ./v1 ./v2 --all       # also list identical files
folderdiff compare ./v1 ./v2 --hidden    # include dotfiles
folderdiff compare ./v1 ./v2 --json      # full result as JSON
```

Relative paths are resolved from the current folder. When nothing differs:

```
Identical     1
Modified      0
Only left     0
Only right    0
Type changed  0

No differences.
```

| Exit code | Meaning |
|-----------|---------|
| `0` | The folders match |
| `1` | Differences found |
| `2` | Error, for example a missing folder or an invalid option |

So it works in scripts and CI:

```bash
folderdiff compare ./build ./expected-build || echo "Build output changed"
```

### Samples

```bash
folderdiff samples                 # create in ~/.folderdiff/samples
folderdiff samples ./my-samples    # create somewhere else
```

```
Sample folders ready in /Users/you/.folderdiff/samples
  Left:   /Users/you/.folderdiff/samples/left
  Right:  /Users/you/.folderdiff/samples/right

Compare them in the terminal:
  folderdiff compare "/Users/you/.folderdiff/samples/left" "/Users/you/.folderdiff/samples/right"

Or start the GUI with folderdiff and click "Load sample folders".
```

The samples are version 1 (left) and version 2 (right) of a tiny project, built so every status shows up:

| Path | Status | Why |
|------|--------|-----|
| `README.txt` | identical | Same content on both sides |
| `docs/faq.md` | identical | Same content |
| `docs/guide/intro.md` | identical | Same content |
| `generated/same-link` | identical | Symlink with the same target on both sides |
| `config.json` | modified | Same size, different content (`port` 3000 vs 4000), found by the SHA-256 hash |
| `notes.md` | modified | One line added |
| `docs/guide/setup.md` | modified | Text changed |
| `generated/big.log` | modified | Over 200 KB, so the preview shows `(over 200 KB, no preview)` |
| `generated/data.bin` | modified | Binary, so the preview shows `(binary file, no preview)` |
| `generated/latest` | modified | Symlink pointing to `../README.txt` on the left and `../notes.md` on the right |
| `legacy.txt` | only left | Removed in version 2 |
| `new-feature.js` | only right | Added in version 2 |
| `assets/logo.svg` | only right | Inside a folder that exists only on the right |
| `generated/output/index.html` | only right | Inside the folder that replaced a file |
| `generated/output` | type changed | A file on the left, a folder on the right |

Not listed: `generated/node_modules/` (in `compare.exclude`) and `.env.example` (hidden). With `--hidden` or **Include hidden files**, Modified goes from 6 to 7 because `.env.example` differs.

Running `samples` again rebuilds the folder. It refuses to write into a folder that has other content and was not created by `folderdiff samples`, so it never overwrites your files.

On Windows, creating symlinks needs Developer Mode or an administrator prompt. Without it, `samples` prints `Symlinks skipped` and the two symlink rows are missing, so Identical is 3 and Modified is 5.

### How statuses are decided

| Status | Rule |
|--------|------|
| only left / only right | The path exists on one side only |
| type changed | File on one side, folder or symlink on the other |
| identical (file) | Same size and same SHA-256 hash |
| modified (file) | Different size (no hashing needed), or same size with a different hash |
| symlink | Identical if both point to the same target, otherwise modified. Symlinks are never followed |
| folder | Modified if anything inside it differs, otherwise identical |

The counters count files and symlinks. Folders are listed in the GUI but not counted, except in type changed, so one changed file three folders deep adds 1 to Modified, not 4. Every run re-scans and re-hashes both folders, so very large folders take time.

## Flags

| Flag | Available on | What it does |
|------|-------------|-------------|
| `--port <n>` | GUI | Port to listen on (overrides config) |
| `--host <host>` | GUI | `127.0.0.1` or `localhost` (overrides config) |
| `--open` | GUI | Open the GUI in your browser |
| `--json` | compare | Output the full result as JSON |
| `--all` | compare | Also list identical files |
| `--hidden` | compare | Include dotfiles |
| `--config <file>` | all | Use this config file instead of `~/.folderdiff.json` |
| `-v, --version` | | Print the version |
| `-h, --help` | | Print usage and examples |

Invalid options are rejected before anything runs:

```
$ folderdiff --port abc
error: --port must be a whole number, got "abc"
Run folderdiff --help for usage.
```

## Configuration

Defaults ship in `config/default.json`. Settings are loaded in layers, each overriding the one before:

1. `config/default.json`: shipped defaults
2. `~/.folderdiff.json`: your overrides (or the file given with `--config`)
3. `PORT` environment variable: overrides `server.port`
4. Command line flags `--port` and `--host`

Any key you set replaces the default. Unknown keys are rejected so typos are caught, and invalid values stop FolderDiff with a message naming the key and the file it came from:

```
$ PORT=abc folderdiff
error: Invalid config value server.port: expected a whole number from 0 to 65535, got "abc" (from the PORT environment variable)
```

| Key | Default | What it does |
|-----|---------|--------------|
| `server.host` | `127.0.0.1` | GUI address. Only `127.0.0.1` or `localhost` are allowed |
| `server.port` | `4328` | GUI port |
| `server.maxRequestBytes` | `100000` | Largest request body the GUI server accepts |
| `server.maxComparisons` | `20` | Comparisons kept in memory for previews. Each browser tab gets its own, the oldest is dropped first |
| `compare.exclude` | `.git`, `node_modules`, `.DS_Store` | Names always skipped, at any depth |
| `compare.includeHidden` | `false` | Include dotfiles by default (GUI checkbox and `compare`) |
| `compare.hashAlgorithm` | `sha256` | Hash used when two files have the same size. Any algorithm Node.js supports, for example `sha512` |
| `preview.maxBytes` | `200000` | Largest file shown in the GUI preview, per side |
| `samples.dir` | `~/.folderdiff/samples` | Where `samples` and **Load sample folders** create the sample folders |

Example `~/.folderdiff.json`:

```json
{
  "server": { "port": 5000 },
  "compare": { "exclude": [".git", "node_modules", ".DS_Store", "dist", "coverage"] },
  "preview": { "maxBytes": 500000 }
}
```

`compare.exclude` replaces the default list, so include the defaults you want to keep.

## Storage

FolderDiff reads and writes only these, in your home directory:

| Path | What it is |
|------|------------|
| `~/.folderdiff.json` | Your config overrides (optional, you create this) |
| `~/.folderdiff/samples/` | Sample folders, created only when you run `samples` or click **Load sample folders** |

Nothing else is written. There is no database, cache, or log. The last comparison is kept in memory and lost when the server stops. The folders you compare are only read, never written. To reset, delete `~/.folderdiff/`.

`~` is your home folder: `/Users/<you>` on macOS, `/home/<you>` on Linux and `C:\Users\<you>` on Windows. Relative paths in `samples.dir` are relative to your home folder.

## Security

- The GUI server listens on `127.0.0.1` only and makes no outgoing connections.
- Requests are refused unless their `Host` header is `127.0.0.1:<port>` or `localhost:<port>`. This blocks DNS rebinding, where a malicious website points its own domain at your machine to read local files.
- `POST` requests must be JSON and, when the browser sends an `Origin`, come from the FolderDiff page itself. Other websites cannot start comparisons or create samples.
- Previews only read files inside the two chosen folders. Paths like `../secret`, and symlinks that point outside, are refused.

This is a local developer tool. Do not expose the port publicly.

## Project Structure

```
.github/
  workflows/
    ci.yml          # tests and CLI runs on macOS, Linux and Windows
bin/
  folderdiff.js     # CLI entry point
config/
  default.json      # default settings (server, compare, preview, samples)
data/
  statuses.json     # status labels and preview messages, used by the CLI and the GUI
  samples.json      # generated sample cases (binary, large file, symlinks, ...)
public/
  index.html        # GUI page
  app.js            # GUI logic
  styles.css        # GUI styles
samples/
  left/             # version 1 of the sample project
  right/            # version 2 of the sample project
src/
  cli.js            # commands, flags and terminal output
  compare.js        # folder scan, hashing and status rules
  config.js         # loads, layers and validates the settings
  data.js           # loads and validates the data files
  paths.js          # package folder locations and version
  samples.js        # builds the sample folders from samples/ and data/samples.json
  server.js         # GUI server: routes, security checks, previews
tests/
  helpers.js        # temporary folders and shared test helpers
  cli.test.js       # runs the real command line
  *.test.js         # node:test suites
.gitattributes      # LF line endings on every platform
CHANGELOG.md        # release notes
```

Settings live in `config/default.json` and your `~/.folderdiff.json`. Labels, messages and sample cases live in `data/`. To change defaults or wording, edit those files. No code changes needed. `data/` files are checked at startup against the statuses and reasons the code produces, so they cannot drift apart.

## Standing on the Shoulders of Giants

- [Meld](https://meldmerge.org): visual diff and merge for files and folders. If you need to merge, use Meld.
- [WinMerge](https://winmerge.org): the long-standing open source folder diff and merge tool for Windows.
- [Beyond Compare](https://www.scootersoftware.com): the commercial standard for folder and file comparison.
- `diff -rq`: built into every Unix system, the fastest way to list differing files.

These tools do what they do very well. FolderDiff does not try to replace them. It brings a small, read-only, zero-dependency folder check to the npm ecosystem, with a GUI and a scriptable exit code.

## Development

```bash
git clone https://github.com/psandis/folderdiff.git
cd folderdiff
pnpm test     # run all tests
pnpm start    # start the GUI
pnpm dev      # start the GUI and restart on changes in src, public, config and data
```

Pass arguments straight after the script name, for example `pnpm start --port 5000` or `pnpm start compare ./a ./b`. With npm, put `--` first: `npm start -- --port 5000`.

There are no dependencies, so no install step is needed. Tests run with `HOME` pointed at a temporary folder, so they never read your `~/.folderdiff.json` or write to your `~/.folderdiff`.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for release notes.

## Roadmap

- **line diff**: highlight changed lines in the preview
- **file picker**: choose folders without typing paths
- **ignore patterns**: glob patterns in `compare.exclude`, not just exact names

## Related

- 🦀 [Dustclaw](https://github.com/psandis/dustclaw): disk space monitoring, analysis, and cleanup CLI
- 🦀 [Feedclaw](https://github.com/psandis/feedclaw): RSS/Atom feed reader and AI digest CLI
- 🦀 [Driftclaw](https://github.com/psandis/driftclaw): deployment drift detection across environments
- 🦀 [Dietclaw](https://github.com/psandis/dietclaw): codebase health monitor for size, bloat, and dependency weight
- 🦀 [Wirewatch](https://github.com/psandis/wirewatch): network traffic monitoring CLI with AI-assisted anomaly detection
- 🦀 [psclawmcp](https://github.com/psandis/psclawmcp): MCP server exposing all claw tools to AI assistants

## License

See [MIT](./LICENSE)
