import type { Project } from './model';

export type Solver = 'original' | 'serpentine';
export const SOLVERS: Record<Solver, string> = { original: 'Basic XPBD Solver', serpentine: 'Serpentine' };

/** First intersection of each member with a top-to-bottom, integer-row scan. */
export function serpentineMemberOrder(project: Project, fromRight = false): number[] {
  const geometry = [...project.beams.map(b => b.endpoints), ...project.ropes];
  const top = Math.min(...geometry.map(m => Math.min(m[1],m[3])));
  const scan = geometry.map(([ax,ay,bx,by], index) => {
    // Internal Y grows downward. Each board row reverses the horizontal scan;
    // the independently chosen starting side mirrors the horizontal scan only.
    const y = Math.min(ay,by), right = fromRight !== ((y-top) % 2 === 1);
    const x = ay < by ? ax : by < ay ? bx : right ? Math.max(ax,bx) : Math.min(ax,bx);
    // Beams sharing the first scanned node are distinguished by their other end,
    // so a symmetric fan at the top also reverses its incident-member order.
    const otherX = ay < by ? bx : by < ay ? ax : right ? Math.min(ax,bx) : Math.max(ax,bx);
    return { index, y, x: right ? -x : x, otherX: right ? -otherX : otherX };
  });
  return scan.sort((a,b) => a.y-b.y || a.x-b.x || a.otherX-b.otherX || a.index-b.index).map(m => m.index);
}
