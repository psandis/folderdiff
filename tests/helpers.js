import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const binPath = path.join(projectRoot, 'bin', 'folderdiff.js');

/** Creates a temporary folder that is removed when the test `t` finishes. */
export async function tempDir(t, prefix = 'folderdiff-test-') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

/** Writes files from an object of { "relative/path": content }. */
export async function writeTree(root, tree) {
  for (const [relative, content] of Object.entries(tree)) {
    const file = path.join(root, ...relative.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  }
}

/** A temporary root with empty "left" and "right" folders. */
export async function folderPair(t) {
  const root = await tempDir(t);
  const left = path.join(root, 'left');
  const right = path.join(root, 'right');
  await fs.mkdir(left);
  await fs.mkdir(right);
  return { root, left, right };
}

export function statusOf(result, relative) {
  return result.items.find((item) => item.path === relative)?.status;
}

export async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}
