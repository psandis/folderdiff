# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-18

### Added

- Browser GUI at `http://127.0.0.1:4328`: compare two folders, filter by name or status, and preview text side by side.
- `folderdiff compare <left> <right>` compares in the terminal, with `--json`, `--all` and `--hidden`. Exits with 0 when the folders match, 1 when they differ and 2 on errors.
- `folderdiff samples [dir]` creates sample folders that cover every status. The GUI's **Load sample folders** button creates them on first click.
- Settings in `config/default.json`, layered with `~/.folderdiff.json` (or `--config`), the `PORT` environment variable and the `--port` and `--host` flags. Unknown keys and invalid values are rejected with the key name and its source.
- Status labels, preview messages and sample cases in `data/statuses.json` and `data/samples.json`, validated against the code at startup.
- Each GUI comparison gets its own id, so several browser tabs work side by side. `server.maxComparisons` limits how many are kept.
- The server returns proper status codes (400, 403, 404, 413, 415, 500), logs internal errors to the terminal, and sends a strict Content-Security-Policy.
- Statuses: identical, modified, only left, only right and type changed. Files are compared by size, then SHA-256.
- Symlinks are compared by target. Folders are modified when anything inside differs, and are listed but not counted.
- The preview says why a side cannot be shown: missing, binary, too large, symlink or not a regular file.
- The server refuses requests for any other `Host` (blocks DNS rebinding) and cross-site or non-JSON posts.
- CI runs the tests and the CLI on macOS, Linux and Windows with Node.js 22 and 24.
