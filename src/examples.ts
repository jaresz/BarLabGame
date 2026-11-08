import { emptyProject, normalizeProject, type Project, type Member } from './model';
export type Example = 'bridge' | 'suspension' | 'cantilever' | 'blank';
export const exampleNames: Record<Example, string> = { bridge: 'Warren bridge', suspension: 'Suspension study', cantilever: 'The cantilever', blank: 'Blank canvas' };
export function starterProject(): Project {
  const p = emptyProject();
  const beam = (...m: Member) => p.beams.push({ endpoints: m, profile: 's' });
  for (let x = 0; x < 16; x += 2) {
    beam(x, 7, x + 2, 7);
    beam(x, 7, x + 1, 4);
    beam(x + 1, 4, x + 2, 7);
    if (x < 14) beam(x + 1, 4, x + 3, 4);
  }
  return normalizeProject(p);
}
export function example(name: Example): Project {
  const p = emptyProject();
  if (name !== 'blank') p.size = [32, 18];
  const beam = (...m: Member) => p.beams.push({ endpoints: m, profile: 's' }); const rope = (...m: Member) => p.ropes.push(m);
  if (name === 'bridge') {
    for (let x = 0; x < 32; x += 4) { beam(x, 11, x + 4, 11); beam(x, 11, x + 2, 8); beam(x + 2, 8, x + 4, 11); if (x < 28) beam(x + 2, 8, x + 6, 8); }
  } else if (name === 'suspension') {
    const height = (x: number) => 4 + Math.round(4 * Math.sin(x / 32 * Math.PI));
    for (let x = 0; x < 32; x += 2) {
      beam(x, 11, x + 2, 11);
      rope(x, height(x), x + 2, height(x + 2));
    }
    for (let x = 2; x < 32; x += 2) {
      for (let y = height(x); y < 11; y += 3) rope(x, y, x, Math.min(11, y + 3));
    }
    for (const x of [8, 24]) for (let y = 0; y < height(x); y += 3) rope(x, y, x, Math.min(height(x), y + 3));
  } else if (name === 'cantilever') { for (let x = 0; x < 12; x += 3) beam(x, 7, x + 3, 7); beam(12, 7, 12, 10); }
  return normalizeProject(p);
}
