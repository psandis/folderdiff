import { readFileSync } from 'node:fs';
import path from 'node:path';
import { STATUS } from './compare.js';
import { dataDir } from './paths.js';

/** Reasons a preview side can be empty. The server decides these, data/statuses.json words them. */
export const PREVIEW_REASON = Object.freeze({
  MISSING: 'missing',
  BINARY: 'binary',
  TOO_LARGE: 'tooLarge',
  SYMLINK: 'symlink',
  NOT_FILE: 'notFile',
});

/** How each generated sample case in data/samples.json is written. */
export const SAMPLE_KINDS = Object.freeze(['text', 'bytes', 'largeText', 'symlink']);

export class DataError extends Error {
  constructor(file, message) {
    super(`Invalid data file ${file}: ${message}`);
    this.name = 'DataError';
  }
}

function readDataFile(name) {
  const file = path.join(dataDir, name);
  return { file, data: JSON.parse(readFileSync(file, 'utf8')) };
}

function sameKeys(actual, expected) {
  return actual.length === expected.length && expected.every((key) => actual.includes(key));
}

let statusesCache;

/**
 * Status labels and preview messages from data/statuses.json.
 * Validated against the statuses and reasons the code produces, so they can never drift apart.
 */
export function loadStatuses() {
  if (statusesCache) return statusesCache;
  const { file, data } = readDataFile('statuses.json');
  const keys = data.statuses?.map((s) => s.key) ?? [];
  if (!sameKeys(keys, Object.values(STATUS))) {
    throw new DataError(file, `statuses must be exactly ${Object.values(STATUS).join(', ')}`);
  }
  for (const status of data.statuses) {
    if (typeof status.label !== 'string' || typeof status.short !== 'string') {
      throw new DataError(file, `status "${status.key}" needs a label and a short label`);
    }
  }
  const reasons = Object.keys(data.previewReasons ?? {});
  if (!sameKeys(reasons, Object.values(PREVIEW_REASON))) {
    throw new DataError(file, `previewReasons must be exactly ${Object.values(PREVIEW_REASON).join(', ')}`);
  }
  statusesCache = Object.freeze({ statuses: data.statuses, previewReasons: data.previewReasons });
  return statusesCache;
}

function validSideValue(kind, value) {
  switch (kind) {
    case 'text':
    case 'symlink':
      return typeof value === 'string';
    case 'bytes':
      return Array.isArray(value) && value.every((b) => Number.isInteger(b) && b >= 0 && b <= 255);
    case 'largeText':
      return Number.isInteger(value?.extraLines) && value.extraLines >= 0;
    default:
      return false;
  }
}

let samplesCache;

/** Generated sample case definitions from data/samples.json. */
export function loadSampleManifest() {
  if (samplesCache) return samplesCache;
  const { file, data } = readDataFile('samples.json');
  for (const key of ['markerFile', 'generatedDir']) {
    if (typeof data[key] !== 'string' || !data[key] || data[key].includes('/') || data[key].includes('\\')) {
      throw new DataError(file, `${key} must be a plain file or folder name`);
    }
  }
  if (!Array.isArray(data.cases)) throw new DataError(file, 'cases must be a list');
  for (const sample of data.cases) {
    const where = `case "${sample.path}"`;
    if (typeof sample.path !== 'string' || !sample.path || path.isAbsolute(sample.path) || sample.path.split('/').includes('..')) {
      throw new DataError(file, `${where}: path must be relative and stay inside the sample folder`);
    }
    if (!SAMPLE_KINDS.includes(sample.kind)) throw new DataError(file, `${where}: kind must be one of ${SAMPLE_KINDS.join(', ')}`);
    if (sample.kind === 'largeText' && (typeof sample.line !== 'string' || !sample.line.includes('{n}'))) {
      throw new DataError(file, `${where}: largeText needs a line containing {n}`);
    }
    if (sample.left === undefined && sample.right === undefined) throw new DataError(file, `${where}: needs a left or right value`);
    for (const side of ['left', 'right']) {
      if (sample[side] !== undefined && !validSideValue(sample.kind, sample[side])) {
        throw new DataError(file, `${where}: invalid ${side} value for kind ${sample.kind}`);
      }
    }
  }
  samplesCache = Object.freeze(data);
  return samplesCache;
}
