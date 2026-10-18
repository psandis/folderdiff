import fs from 'node:fs/promises';
import path from 'node:path';
import { loadSampleManifest } from './data.js';
import { samplesSourceDir } from './paths.js';

const SIDES = ['left', 'right'];

/** The left and right sample folders inside `dir`. */
export function samplePaths(dir) {
  return { left: path.join(dir, 'left'), right: path.join(dir, 'right') };
}

/** Whether `dir` holds sample folders created by createSamples(). */
export async function samplesReady(dir) {
  const { markerFile } = loadSampleManifest();
  try {
    await fs.access(path.join(dir, markerFile));
    return true;
  } catch {
    return false;
  }
}

async function writeFile(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

/** Text made of numbered lines, just over `minBytes`, plus `extraLines` more. */
function largeText(lineTemplate, minBytes, extraLines) {
  const lines = [];
  let size = 0;
  for (let n = 1; size <= minBytes; n++) {
    const line = `${lineTemplate.replace('{n}', String(n))}\n`;
    lines.push(line);
    size += Buffer.byteLength(line);
  }
  for (let i = 0; i < extraLines; i++) lines.push(`${lineTemplate.replace('{n}', String(lines.length + 1))}\n`);
  return lines.join('');
}

/** Writes one case from data/samples.json. Returns false when a symlink is not allowed on this system. */
async function writeCase(sample, value, target, previewMaxBytes) {
  switch (sample.kind) {
    case 'text':
      await writeFile(target, value);
      return true;
    case 'bytes':
      await writeFile(target, Buffer.from(value));
      return true;
    case 'largeText':
      await writeFile(target, largeText(sample.line, previewMaxBytes, value.extraLines));
      return true;
    case 'symlink':
      await fs.mkdir(path.dirname(target), { recursive: true });
      try {
        await fs.symlink(value, target);
        return true;
      } catch (error) {
        if (error.code === 'EPERM') return false;
        throw error;
      }
    default:
      throw new Error(`Unknown sample kind ${sample.kind}`);
  }
}

/**
 * Creates the sample folders in `dir`: copies the committed files from samples/ and adds the
 * generated cases from data/samples.json. Safe to re-run on a folder it created before. Refuses
 * a non-empty folder it did not create, so it never overwrites other files.
 *
 * @param {string} dir Absolute target folder.
 * @param {{previewMaxBytes: number}} options From config.preview.maxBytes, sizes the large file.
 * @returns {Promise<{dir: string, left: string, right: string, symlinksSkipped: boolean}>}
 */
export async function createSamples(dir, { previewMaxBytes }) {
  const manifest = loadSampleManifest();
  const existing = await fs.readdir(dir).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  if (existing.length > 0 && !existing.includes(manifest.markerFile)) {
    throw new Error(`${dir} is not empty and was not created by folderdiff. Choose an empty or new folder.`);
  }

  const paths = samplePaths(dir);
  let symlinksSkipped = false;
  for (const side of SIDES) {
    await fs.rm(paths[side], { recursive: true, force: true });
    await fs.cp(path.join(samplesSourceDir, side), paths[side], { recursive: true });
    for (const sample of manifest.cases) {
      if (sample[side] === undefined) continue;
      const target = path.join(paths[side], manifest.generatedDir, ...sample.path.split('/'));
      const written = await writeCase(sample, sample[side], target, previewMaxBytes);
      if (!written) symlinksSkipped = true;
    }
  }
  await fs.writeFile(path.join(dir, manifest.markerFile), 'Created by folderdiff samples. Safe to delete.\n');
  return { dir, ...paths, symlinksSkipped };
}
