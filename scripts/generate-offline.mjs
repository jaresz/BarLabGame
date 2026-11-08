import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative, join, sep } from 'node:path';

const root = resolve('public_html');
const files = [];
async function collect(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) await collect(file);
    else if (entry.isFile() && entry.name !== 'sw.js') files.push(relative(root, file).split(sep).join('/'));
  }
}
await collect(root);
files.sort();
if (!files.includes('index.html') || !files.some(file => file.startsWith('assets/') && file.endsWith('.js'))) {
  throw new Error('Offline build is missing its page or application code.');
}
const digest = createHash('sha256');
for (const file of files) {
  digest.update(file);
  digest.update(await readFile(join(root, file)));
}
const cacheName = `bar-lab-static-${digest.digest('hex').slice(0, 16)}`;
const template = await readFile(resolve('scripts/offline-worker.js'), 'utf8');
const worker = template
  .replace('__CACHE_NAME__', JSON.stringify(cacheName))
  .replace('__PRECACHE_FILES__', JSON.stringify(files));
await writeFile(join(root, 'sw.js'), worker);
console.log(`Offline cache ${cacheName}: ${files.length} files.`);
