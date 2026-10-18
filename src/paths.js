import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Folder that contains package.json, both in a git checkout and an npm install. */
export const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Settings: default values that users can override. */
export const configDir = path.join(projectRoot, 'config');

/** Reference data the app is built on: status labels, sample definitions. */
export const dataDir = path.join(projectRoot, 'data');

/** Static files served to the browser GUI. */
export const publicDir = path.join(projectRoot, 'public');

/** Committed sample files that `folderdiff samples` copies. */
export const samplesSourceDir = path.join(projectRoot, 'samples');

/** Parsed package.json, used for the version number. */
export const packageInfo = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
