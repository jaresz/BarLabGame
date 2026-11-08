import { emptyProject, normalizeProject, type Project, type Member, type BeamProfile } from './model';
import { fromCentered } from './coordinates';

export type Example = 'bridge' | 'eiffel' | 'goldenGate' | 'sydneyHarbour' | 'blank';
export const exampleNames: Record<Example, string> = {
  bridge: 'Warren bridge',
  eiffel: 'Eiffel Tower',
  goldenGate: 'Golden Gate Bridge',
  sydneyHarbour: 'Sydney Harbour Bridge',
  blank: 'Blank canvas',
};

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
  if (name === 'eiffel') p.size = [18, 32];
  else if (name !== 'blank') p.size = [32, 18];
  const beam = (...m: Member) => p.beams.push({ endpoints: m, profile: 's' });
  const rope = (...m: Member) => p.ropes.push(m);

  if (name === 'bridge') {
    for (let x = 0; x < 32; x += 4) { beam(x, 11, x + 4, 11); beam(x, 11, x + 2, 8); beam(x + 2, 8, x + 4, 11); if (x < 28) beam(x + 2, 8, x + 6, 8); }
  } else if (name === 'eiffel') {
    // Each side follows a narrowing outline from the boundary supports to the spire.
    // The shared top point joins the two legs without overlapping beam segments.
    const left: [number, number][] = [[2, 32], [4, 27], [6, 22], [7, 17], [8, 12], [8, 8], [9, 4]];
    const right = left.map(([x, y]) => [18 - x, y] as [number, number]);
    for (const side of [left, right]) {
      for (let i = 0; i < side.length - 1; i++) beam(...side[i], ...side[i + 1]);
    }
    beam(9, 4, 9, 1);
    // Horizontal platforms and paired inner braces suggest the tower's lattice.
    for (const [y, start, end] of [[27, 4, 14], [22, 6, 12], [17, 7, 11], [12, 8, 10], [8, 8, 10]] as const) {
      for (let x: number = start; x < end; x = Math.min(x + 5, end)) beam(x, y, Math.min(x + 5, end), y);
    }
    for (const [lowerY, lowerX, upperY, upperX] of [[27, 9, 22, 6], [22, 9, 17, 7], [17, 9, 12, 8], [12, 9, 8, 8]] as const) {
      beam(lowerX, lowerY, upperX, upperY);
      beam(lowerX, lowerY, 18 - upperX, upperY);
    }
    // A central spine carries the platforms and spire into the bottom boundary.
    // Its segments end at platform levels so the existing lattice joins the spine.
    for (const [lowerY, upperY] of [[32, 27], [27, 22], [22, 17], [17, 12], [12, 8], [8, 4]] as const) {
      beam(9, lowerY, 9, upperY);
    }
  } else if (name === 'goldenGate') {
    // These coordinates match the exported project format: the origin is at the
    // board center and positive Y points upward. Convert them to editor space.
    const beams: [number, number, number, number, BeamProfile][] = [
      [-16,-3,-12,-3,'s'], [-12,-3,-9,-3,'s'], [-9,6,-9,3,'s'], [-9,6,-8,6,'s'],
      [-9,3,-9,0,'s'], [-9,3,-7,3,'s'], [-9,0,-9,-3,'s'], [-9,0,-7,0,'s'],
      [-9,-3,-9,-9,'h'], [-9,-3,-8,-3,'s'], [-8,6,-7,6,'s'], [-8,-3,-7,-3,'s'],
      [-7,6,-7,3,'s'], [-7,3,-7,0,'s'], [-7,0,-7,-3,'s'], [-7,-3,-7,-9,'h'],
      [-7,-3,-4,-3,'s'], [-4,-3,0,-3,'s'], [0,-3,4,-3,'s'], [4,-3,7,-3,'s'],
      [7,6,7,3,'s'], [7,6,8,6,'s'], [7,3,7,0,'s'], [7,3,9,3,'s'],
      [7,0,7,-3,'s'], [7,0,9,0,'s'], [7,-3,7,-9,'h'], [7,-3,8,-3,'s'],
      [8,6,9,6,'s'], [8,-3,9,-3,'s'], [9,6,9,3,'s'], [9,3,9,0,'s'],
      [9,0,9,-3,'s'], [9,-3,9,-9,'h'], [9,-3,12,-3,'s'], [12,-3,16,-3,'s'],
    ];
    const ropes: Member[] = [
      [-16,2,-16,-3], [-16,2,-12,4], [-12,4,-12,-3], [-12,4,-8,6],
      [-8,6,-4,4], [-4,4,-4,-3], [-4,4,0,2], [0,2,0,-3],
      [0,2,4,4], [4,4,4,-3], [4,4,8,6], [8,6,12,4],
      [12,4,12,-3], [12,4,16,2], [16,2,16,-3],
    ];
    for (const [x1, y1, x2, y2, profile] of beams) {
      p.beams.push({ endpoints: [...fromCentered([x1, y1], p.size), ...fromCentered([x2, y2], p.size)], profile });
    }
    for (const [x1, y1, x2, y2] of ropes) {
      rope(...fromCentered([x1, y1], p.size), ...fromCentered([x2, y2], p.size));
    }
  } else if (name === 'sydneyHarbour') {
    for (let x = 0; x < 32; x += 4) beam(x, 12, x + 4, 12);
    // Two chords and their verticals outline the arch above the roadway.
    const upper: [number, number][] = [[0, 13], [4, 10], [8, 7], [12, 5], [16, 4], [20, 5], [24, 7], [28, 10], [32, 13]];
    const lower: [number, number][] = [[0, 13], [4, 12], [8, 10], [12, 8], [16, 7], [20, 8], [24, 10], [28, 12], [32, 13]];
    for (let i = 0; i < upper.length - 1; i++) {
      beam(...upper[i], ...upper[i + 1]);
      beam(...lower[i], ...lower[i + 1]);
      // Mirror brace direction after the arch crest to keep spans within six grid units.
      if (i > 0 && i < upper.length - 2) {
        if (i < 4) beam(...upper[i], ...lower[i + 1]);
        else beam(...lower[i], ...upper[i + 1]);
      }
    }
    for (let i = 1; i < upper.length - 1; i++) {
      beam(...upper[i], ...lower[i]);
      if (lower[i][1] < 12) beam(...lower[i], lower[i][0], 12);
    }
    beam(0, 12, 0, 13);
    beam(32, 12, 32, 13);
    // Paired piers support the roadway while leaving the center of the arch open.
    // Both meet the bottom boundary, which provides fixed supports in simulation.
    for (const x of [8, 24]) beam(x, 12, x, 18);
  }
  return normalizeProject(p);
}
