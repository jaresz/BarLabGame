import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

test('Generated WAV assets are deterministic, compact and valid mono PCM', async () => {
  execFileSync(process.execPath, ['scripts/generate-sounds.mjs', '--check'], { cwd: resolve('.') });
  const root = resolve('public/sounds'), files = (await readdir(root)).filter(file => file.endsWith('.wav'));
  assert.equal(files.length, 12);
  let total = 0;
  for (const file of files) {
    const bytes = await readFile(resolve(root, file)); total += bytes.length;
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
    assert.equal(bytes.readUInt16LE(20), 1, 'PCM format');
    assert.equal(bytes.readUInt16LE(22), 1, 'One channel leaves stereo positioning to the game');
    assert.equal(bytes.readUInt32LE(24), 22050);
    assert.equal(bytes.readUInt16LE(34), 16);
    assert.equal(bytes.readUInt32LE(40), bytes.length - 44);
    if (file.includes('Loop')) {
      const first = bytes.readInt16LE(44), last = bytes.readInt16LE(bytes.length - 2);
      assert.ok(Math.abs(first - last) <= 2, `${file}: loop seam has no sample jump`);
    }
  }
  assert.ok(total < 600_000, `The complete sound bank should remain small (${total} bytes)`);
});
