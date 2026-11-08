import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// These mono PCM assets are deliberately small. Stereo placement and material
// response happen in Web Audio, where the same decoded sample can be reused.
const SAMPLE_RATE = 22050;
const OUTPUT = resolve('public/sounds');
const sounds = {
  beamPlace: { seed: 11, seconds: .62, modes: [[175, .32, 9], [303, .26, 11], [517, .19, 15], [911, .12, 20]], hiss: .32, knocks: 3 },
  nodeCreate: { seed: 19, seconds: .28, modes: [[410, .27, 25], [690, .19, 28], [1170, .1, 34]], hiss: .22, knocks: 1 },
  copy: { seed: 23, seconds: .21, modes: [[470, .2, 22], [770, .15, 29]], hiss: .13, knocks: 1 },
  paste: { seed: 29, seconds: .44, modes: [[275, .27, 11], [461, .2, 17], [836, .12, 22]], hiss: .22, knocks: 2 },
  beamStress: { seed: 31, seconds: .52, modes: [[98, .21, 5], [167, .17, 7], [291, .16, 9], [603, .09, 15]], hiss: .38, knocks: 8 },
  ropeStress: { seed: 37, seconds: .43, modes: [[258, .18, 7], [443, .17, 9], [784, .12, 12], [1277, .07, 16]], hiss: .34, knocks: 5 },
  ropeBreak: { seed: 41, seconds: .72, modes: [[148, .17, 6], [392, .23, 7], [726, .19, 10], [1381, .09, 16]], hiss: .61, knocks: 12 },
  beamWall: { seed: 43, seconds: .56, modes: [[156, .32, 8], [269, .26, 10], [473, .17, 15], [829, .09, 19]], hiss: .34, knocks: 4 },
  beamGround: { seed: 47, seconds: .68, modes: [[112, .37, 6], [198, .27, 8], [352, .17, 11], [632, .09, 15]], hiss: .42, knocks: 5 },
  ropeGround: { seed: 53, seconds: .39, modes: [[236, .12, 11], [417, .12, 13], [792, .07, 17]], hiss: .31, knocks: 7 },
};

function random(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000; };
}

function wav(samples) {
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(SAMPLE_RATE, 24); bytes.writeUInt32LE(SAMPLE_RATE * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return bytes;
}

function normalize(samples) {
  const peak = samples.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
  const scale = peak > 0 ? .78 / peak : 1;
  return samples.map(sample => sample * scale);
}

function oneShot({ seed, seconds, modes, hiss, knocks }) {
  const rand = random(seed), count = Math.round(seconds * SAMPLE_RATE);
  const output = new Float32Array(count);
  let low = 0, previous = 0;
  const taps = Array.from({ length: knocks }, (_, i) => ({
    at: i === 0 ? 0 : Math.floor((.025 + rand() * Math.min(.32, seconds * .7)) * SAMPLE_RATE),
    strength: i === 0 ? 1 : .12 + rand() * .28,
    pitch: 300 + rand() * 1500,
  }));
  for (let i = 0; i < count; i++) {
    const t = i / SAMPLE_RATE;
    const attack = Math.min(1, t * 180);
    const ring = modes.reduce((sum, [frequency, amount, decay]) => sum + amount * Math.sin(2 * Math.PI * frequency * t) * Math.exp(-decay * t), 0);
    const white = rand() * 2 - 1;
    low += .16 * (white - low);
    // A gritty band of friction masks the clean modal tones, while sparse
    // delayed contacts make the tail behave like loose metal rather than a beep.
    const friction = (low - previous) * hiss * Math.exp(-11 * t);
    previous = low;
    let contacts = 0;
    for (const tap of taps) {
      const age = (i - tap.at) / SAMPLE_RATE;
      if (age >= 0 && age < .07) contacts += tap.strength * Math.exp(-85 * age) * (Math.sin(2 * Math.PI * tap.pitch * age) + white * .6);
    }
    output[i] = attack * (ring + friction + contacts) * .55;
  }
  return output;
}

function tensionLoop(material) {
  const beam = material === 'beam', rand = random(beam ? 101 : 103);
  const count = SAMPLE_RATE * 3, white = new Float32Array(count), filtered = new Float32Array(count);
  for (let i = 0; i < count; i++) white[i] = rand() * 2 - 1;
  // Revisit the periodic noise several times so the low-pass state converges at
  // the wrap point; the saved three-second buffer then loops without a click.
  let low = 0;
  for (let pass = 0; pass < 8; pass++) for (let i = 0; i < count; i++) {
    low += (beam ? .035 : .065) * (white[i] - low);
    if (pass === 7) filtered[i] = low;
  }
  const contacts = Array.from({ length: beam ? 24 : 38 }, () => ({ at: Math.floor(rand() * count), level: .08 + rand() * .17, cycles: 23 + Math.floor(rand() * 75) }));
  const output = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const phase = i / count, swell = .63 + .22 * Math.sin(2 * Math.PI * (beam ? 3 : 5) * phase);
    // Integer cycle counts form inharmonic, periodic steel resonances. Filtered
    // noise and irregular tiny slips add the sustained scrape of loaded metal.
    const modes = beam
      ? .16 * Math.sin(2 * Math.PI * 31 * phase) + .11 * Math.sin(2 * Math.PI * 53 * phase) + .07 * Math.sin(2 * Math.PI * 97 * phase)
      : .11 * Math.sin(2 * Math.PI * 71 * phase) + .09 * Math.sin(2 * Math.PI * 119 * phase) + .06 * Math.sin(2 * Math.PI * 187 * phase);
    let slips = 0;
    for (const contact of contacts) {
      const distance = (i - contact.at + count) % count;
      if (distance < SAMPLE_RATE * .024) slips += contact.level * Math.exp(-distance / (SAMPLE_RATE * .004)) * Math.sin(2 * Math.PI * contact.cycles * distance / SAMPLE_RATE);
    }
    output[i] = (modes * swell + filtered[i] * (beam ? .65 : .9) + slips) * .56;
  }
  // Adjacent PCM samples at the seam must agree even after quantization.
  output[count - 1] = output[0];
  return output;
}

const check = process.argv.includes('--check');
if (!check) await mkdir(OUTPUT, { recursive: true });
async function output(name, samples) {
  const file = resolve(OUTPUT, `${name}.wav`), expected = wav(normalize(samples));
  if (check) {
    const actual = await readFile(file);
    if (!actual.equals(expected)) throw new Error(`${name}.wav differs from its deterministic source`);
  } else await writeFile(file, expected);
}
for (const [name, design] of Object.entries(sounds)) await output(name, oneShot(design));
for (const material of ['beam', 'rope']) await output(`${material}TensionLoop`, tensionLoop(material));
console.log(check ? 'All 12 WAV assets match their deterministic source.' : 'Generated 12 deterministic steel and cable WAV assets.');
