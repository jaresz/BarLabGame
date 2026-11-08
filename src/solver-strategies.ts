import { PROFILES, key, type Project } from './model';
import type { World } from './physics';

export type Solver = 'original' | 'serpentine' | 'backward';
export const SOLVERS: Record<Solver, string> = { original: 'Basic XPBD Solver', serpentine: 'Serpentine', backward: 'Backward' };

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

type Link = { a: number; b: number; owner: number; moment: boolean };
type Parent = { point: number; link: Link; share: number };

/** Support-rooted load estimate and leaf-to-support sweep for the backward solver.
 * Trees propagate exactly once per branch. Cyclic frames use a layered DAG:
 * equally short paths toward supports share loads by axial stiffness. Cross-links
 * within one layer remain in the dynamic solver, but are omitted from this static
 * estimate. This is a load-path approximation, not a full frame stiffness solve.
 */
export class BackwardTree {
  readonly depth: Int32Array;
  readonly order: number[] = [];
  readonly parents: Parent[][];
  readonly forces: Float64Array;
  readonly moments: Float64Array;
  readonly stresses: Float64Array;
  private hinge: Uint8Array;
  private pinnedHinge: Uint8Array;
  private topology = '';

  constructor(private world: World) {
    this.depth = new Int32Array(world.x.length);
    this.parents = Array.from(world.x, () => []);
    this.forces = new Float64Array(world.x.length);
    this.moments = new Float64Array(world.x.length);
    this.stresses = new Float64Array(world.members.length);
    this.hinge = Uint8Array.from(world.x, (_,i) => Number(world.project.joints[key([world.x[i],world.y[i]])] === 'o'));
    this.pinnedHinge = Uint8Array.from(world.x, (_,i) => Number(world.invMass[i] === 0 && world.project.anchors[key([world.x[i],world.y[i]])] === 'o'));
    this.rebuild();
  }

  private rebuild(): void {
    const w = this.world, graph: { point: number; link: Link }[][] = Array.from(w.x, () => []);
    this.depth.fill(-1); this.order.length = 0;
    for (const parents of this.parents) parents.length = 0;
    // Distance links include rod segments, midpoint welds and coincident endpoint
    // welds. Removing a fractured midpoint disconnects its two load paths.
    for (const c of w.distances) {
      if (c.cut && w.members[c.owner].broken) continue;
      const material = c.owner >= 0 ? w.members[c.owner].material : 'beam';
      // Coincident endpoint welds at hinges transfer force but release moment.
      // The release flags were captured before the first dynamic deformation.
      const link: Link = { a: c.a, b: c.b, owner: c.owner, moment: material === 'beam' && (c.owner >= 0 || !this.hinge[c.a]) };
      graph[c.a].push({ point: c.b, link }); graph[c.b].push({ point: c.a, link });
    }
    // Breadth-first layers start at every fixed-position support. Components with
    // no support stay at depth -1: free fall must not invent a support reaction.
    for (let i = 0; i < w.x.length; i++) if (w.invMass[i] === 0) { this.depth[i] = 0; this.order.push(i); }
    for (let cursor = 0; cursor < this.order.length; cursor++) {
      const point = this.order[cursor];
      for (const edge of graph[point]) if (this.depth[edge.point] < 0) {
        this.depth[edge.point] = this.depth[point] + 1; this.order.push(edge.point);
      }
    }
    for (const point of this.order) {
      const parents = graph[point].filter(edge => this.depth[edge.point] === this.depth[point] - 1);
      const stiffness = (link: Link) => link.owner < 0 ? 1 : w.members[link.owner].material === 'rope' ? 80000 : w.options.axial * PROFILES[w.members[link.owner].profile].axial;
      const sum = parents.reduce((s,p) => s + stiffness(p.link), 0);
      this.parents[point] = parents.map(p => ({ ...p, share: stiffness(p.link) / sum }));
    }
    this.topology = w.members.map(m => Number(m.broken)).join('');
  }

  update(): void {
    const w = this.world;
    if (this.topology !== w.members.map(m => Number(m.broken)).join('')) this.rebuild();
    this.moments.fill(0); this.stresses.fill(0);
    // Gravity acts along internal +Y. Force is in mass*grid-unit/s², and moment
    // in force*grid-unit; use the same axial/bending stiffness as the XPBD rods.
    for (let i = 0; i < w.mass.length; i++) this.forces[i] = w.mass[i] * w.options.gravity;
    for (let index = this.order.length - 1; index >= 0; index--) {
      const child = this.order[index];
      // A rope cannot carry an upward branch's compressive gravity reaction.
      // Redistribute its share over the remaining support routes, if any.
      const parents = this.parents[child].filter(parent => parent.link.owner < 0 || w.members[parent.link.owner].material !== 'rope' || this.forces[child]*(w.y[child]-w.y[parent.point]) > 0);
      const totalShare = parents.reduce((sum,p) => sum+p.share,0);
      for (const parent of parents) {
        const share = parent.share/totalShare, p = parent.point, force = this.forces[child] * share;
        const moment = this.pinnedHinge[p] ? 0 : this.moments[child] * share + (w.x[child] - w.x[p]) * force;
        this.forces[p] += force;
        if (parent.link.moment) this.moments[p] += moment;
        const owner = parent.link.owner;
        if (owner < 0) continue;
        const m = w.members[owner], profile = PROFILES[m.profile];
        const dx = w.x[child]-w.x[p], dy = w.y[child]-w.y[p], length = Math.hypot(dx,dy);
        const axial = length > 1e-12 ? force * dy / length : 0;
        const axialStress = m.material === 'rope' ? Math.max(0,axial) / (80000 * 0.10) : Math.abs(axial) / (w.options.axial * profile.axial * 0.10);
        const bendingStress = parent.link.moment ? Math.abs(moment) / (w.options.bending * profile.bending * 0.95 * profile.curvature) : 0;
        this.stresses[owner] = Math.max(this.stresses[owner], axialStress, bendingStress);
      }
    }
  }
}
