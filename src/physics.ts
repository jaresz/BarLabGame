import { PROFILES, boundary, key, type Project, type Point, type Material, type BeamProfile } from './model';
import { serpentineMemberOrder, type Solver } from './solver-strategies';
export const DT = 1 / 120;
const TAU = 2 * Math.PI;
const wrap = (v: number) => ((v + Math.PI) % TAU + TAU) % TAU - Math.PI;
interface Distance { a: number; b: number; rest: number; compliance: number; lambda: number; tension: boolean; owner: number; cut: boolean }
interface Angle { a: number; b: number; c: number; d: number; rest: number; compliance: number; lambda: number; owner: number; cut: boolean; internal: boolean; scale: number }
export interface PhysicsMember { start: number; count: number; half: number; material: Material; profile: BeamProfile; broken: boolean; stress: number; overload: number }
export interface PhysicsOptions { gravity?: number; damage?: boolean; bending?: number; axial?: number; iterations?: number; damping?: number; solver?: Solver; serpentineFromRight?: boolean }
export interface Frame { positions: Float32Array; stresses: Float32Array; broken: Uint8Array; time: number; stepMs: number; points: number; constraints: number }
export type SoundKind = 'beamStress' | 'ropeStress' | 'ropeBreak' | 'beamWall' | 'beamGround' | 'ropeGround';
export interface SoundEvent { kind: SoundKind; x: number; intensity: number; length: number }
export interface StressBed { material: Material; zone: number; count: number; load: number; stress: number; length: number; x: number }
const SOUND_INTERVAL: Record<SoundKind, number> = { beamStress: 0.36, ropeStress: 0.28, ropeBreak: 0.09, beamWall: 0.12, beamGround: 0.12, ropeGround: 0.16 };
const STRESS_AUDIO_THRESHOLD = .05;
interface Endpoint { p: number; neighbor: number; material: Material; direction: number; owner: number }
export class World {
  readonly x: Float64Array; readonly y: Float64Array; readonly vx: Float64Array; readonly vy: Float64Array;
  readonly invMass: Float64Array; readonly mass: Float64Array;
  readonly members: PhysicsMember[] = [];
  readonly distances: Distance[] = []; readonly angles: Angle[] = [];
  readonly options: Required<PhysicsOptions>;
  private oldX: Float64Array; private oldY: Float64Array;
  private pins: [number, number, number][] = [];
  private ids = new Int32Array(4); private gx = new Float64Array(4); private gy = new Float64Array(4);
  private sweepDistances: Distance[] = []; private sweepAngles: Angle[] = [];
  private particleOwner: number[] = [];
  private lastSound: Record<SoundKind, number> = { beamStress: -1, ropeStress: -1, ropeBreak: -1, beamWall: -1, beamGround: -1, ropeGround: -1 };
  private pendingSounds = new Map<SoundKind, SoundEvent>();
  private previousStress: number[] = [];
  private memberLengths: number[] = [];
  time = 0; stepMs = 0;
  constructor(readonly project: Project, options: PhysicsOptions = {}) {
    // Short steel beams should appear straight under their own weight. A modest
    // increase in solver sweeps prevents numerical compliance dominating bending.
    this.options = { gravity: 9.81, damage: true, bending: 10000, axial: 2e6, iterations: 12, damping: 0.65, solver: 'original', serpentineFromRight: false, ...options };
    const scanRank = new Int32Array(project.beams.length+project.ropes.length);
    if (this.options.solver === 'serpentine') serpentineMemberOrder(project,this.options.serpentineFromRight).forEach((owner,index) => { scanRank[owner] = index; });
    const positions: Point[] = [], masses: number[] = [], endpoints = new Map<string, Endpoint[]>();
    const addPoint = (x: number, y: number, owner: number) => { const id = positions.length; positions.push([x, y]); masses.push(0); this.particleOwner.push(owner); return id; };
    for (const [material, list] of [['beam', project.beams.map(b => b.endpoints)], ['rope', project.ropes]] as const) for (const [index, m] of list.entries()) {
      const profile = material === 'beam' ? project.beams[index].profile : 's', properties = PROFILES[profile];
      const len = Math.hypot(m[2] - m[0], m[3] - m[1]);
      this.memberLengths.push(len);
      let n = Math.max(4, Math.ceil(len / 0.5)); if (n % 2) n++;
      const half = n / 2 + 1, start = positions.length, owner = this.members.length, h = len / n;
      const member: PhysicsMember = { start, count: n + 2, half, material, profile, broken: false, stress: 0, overload: 0 };
      this.members.push(member);
      // Two half-rods share a position, but not a particle. Breaking releases the midpoint weld.
      for (let side = 0; side < 2; side++) {
        const sideStart = positions.length;
        for (let j = 0; j < half; j++) { const t = (side * (n / 2) + j) / n; addPoint(m[0] + (m[2] - m[0]) * t, m[1] + (m[3] - m[1]) * t, owner); }
        for (let j = 0; j < half - 1; j++) {
          const a = sideStart + j, b = a + 1, density = material === 'beam' ? 1.8 * properties.mass : 0.22;
          masses[a] += density * h / 2; masses[b] += density * h / 2;
          this.distances.push({ a, b, rest: h, compliance: h / (material === 'beam' ? this.options.axial * properties.axial : 80000), lambda: 0, tension: material === 'rope', owner, cut: false });
        }
        if (material === 'beam') for (let j = 0; j < half - 2; j++) this.angles.push({ a: sideStart + j, b: sideStart + j + 1, c: sideStart + j + 1, d: sideStart + j + 2, rest: 0, compliance: h / (this.options.bending * properties.bending), lambda: 0, owner, cut: false, internal: true, scale: h });
      }
      const left = start + half - 1, right = left + 1;
      this.distances.push({ a: left, b: right, rest: 0, compliance: 0, lambda: 0, tension: false, owner, cut: true });
      if (material === 'beam') this.angles.push({ a: left - 1, b: left, c: right, d: right + 1, rest: 0, compliance: h / (this.options.bending * properties.bending), lambda: 0, owner, cut: true, internal: true, scale: h });
      for (const [p, neighbor, xy] of [[start, start + 1, [m[0], m[1]]], [start + n + 1, start + n, [m[2], m[3]]]] as [number, number, Point][]) {
        const entry: Endpoint = { p, neighbor, material, owner, direction: Math.atan2(positions[neighbor][1] - positions[p][1], positions[neighbor][0] - positions[p][0]) };
        const id = key(xy); if (!endpoints.has(id)) endpoints.set(id, []); endpoints.get(id)!.push(entry);
      }
    }
    this.x = new Float64Array(positions.map(p => p[0])); this.y = new Float64Array(positions.map(p => p[1]));
    this.mass = new Float64Array(masses); this.invMass = new Float64Array(masses.map(m => 1 / Math.max(m, 1e-9)));
    this.vx = new Float64Array(positions.length); this.vy = new Float64Array(positions.length);
    this.oldX = new Float64Array(positions.length); this.oldY = new Float64Array(positions.length);
    for (const [id, ends] of endpoints) {
      // The first incident member defines a welded joint's reference. Serpentine
      // must choose that reference in scan order too, not just reorder sweeps.
      if (this.options.solver === 'serpentine') ends.sort((a,b) => scanRank[a.owner]-scanRank[b.owner]);
      const first = ends[0], pt: Point = [this.x[first.p], this.y[first.p]], anchored = boundary(pt, project.size);
      for (let i = 1; i < ends.length; i++) this.distances.push({ a: first.p, b: ends[i].p, rest: 0, compliance: 0, lambda: 0, tension: false, owner: -1, cut: false });
      const beams = ends.filter(e => e.material === 'beam');
      if (project.joints[id] !== 'o' && beams.length > 1) for (let i = 1; i < beams.length; i++) {
        const a = beams[0], b = beams[i];
        this.angles.push({ a: a.p, b: a.neighbor, c: b.p, d: b.neighbor, rest: wrap(b.direction - a.direction), compliance: 0, lambda: 0, owner: -1, cut: false, internal: false, scale: 1 });
      }
      if (anchored) for (const e of ends) {
        this.invMass[e.p] = 0; this.pins.push([e.p, pt[0], pt[1]]);
        if (e.material === 'beam' && project.anchors[id] !== 'o') this.angles.push({ a: e.p, b: e.neighbor, c: -1, d: -1, rest: e.direction, compliance: 0, lambda: 0, owner: -1, cut: false, internal: false, scale: 1 });
      }
    }
    this.sweepDistances = this.distances; this.sweepAngles = this.angles;
    this.previousStress = this.members.map(() => 0);
    if (this.options.solver === 'serpentine') {
      const rank = scanRank, particleRank = new Int32Array(this.x.length);
      // Keep member/particle IDs stable for rendering; only the constraint visit
      // order changes. Welds use the earliest incident member's scan position.
      for (const [owner,m] of this.members.entries()) particleRank.fill(rank[owner], m.start, m.start+m.count);
      const priority = (c: Distance | Angle) => c.owner >= 0 ? rank[c.owner] : Math.min(particleRank[c.a],particleRank[c.b],...('c' in c && c.c >= 0 ? [particleRank[c.c],particleRank[c.d]] : []));
      this.sweepDistances = [...this.distances].sort((a,b) => priority(a)-priority(b));
      this.sweepAngles = [...this.angles].sort((a,b) => priority(a)-priority(b));
    }
  }
  private queueSound(kind: SoundKind, x: number, intensity: number, length = 1): void {
    if (this.time - this.lastSound[kind] < SOUND_INTERVAL[kind]) return;
    const event = { kind, x: Math.max(0, Math.min(this.project.size[0], x)), intensity: Math.min(1, intensity), length };
    // Keep only the strongest contact of each material and surface in a physics tick.
    if (event.intensity > (this.pendingSounds.get(kind)?.intensity ?? 0)) this.pendingSounds.set(kind, event);
  }
  drainSounds(): SoundEvent[] {
    const sounds = [...this.pendingSounds.values()];
    for (const sound of sounds) this.lastSound[sound.kind] = this.time;
    this.pendingSounds.clear();
    return sounds;
  }
  stressBeds(): StressBed[] {
    const width = this.project.size[0];
    const beds: StressBed[] = [];
    // Aggregate member load into three horizontal stereo zones per material.
    // Only these six summaries cross the worker boundary, regardless of size.
    for (const material of ['beam', 'rope'] as const) for (let zone = 0; zone < 3; zone++) {
      beds.push({ material, zone, count: 0, load: 0, stress: 0, length: 0, x: 0 });
    }
    for (const [index, member] of this.members.entries()) {
      if (member.broken || member.stress <= STRESS_AUDIO_THRESHOLD) continue;
      const x = this.x[member.start + member.half - 1];
      const zone = Math.max(0, Math.min(2, Math.floor(x / width * 3)));
      const bed = beds[(member.material === 'beam' ? 0 : 3) + zone];
      const weight = Math.min(1.5, (member.stress - STRESS_AUDIO_THRESHOLD) / (1 - STRESS_AUDIO_THRESHOLD));
      bed.count++;
      bed.load += weight;
      bed.stress += weight * Math.min(2, member.stress);
      bed.length += weight * this.memberLengths[index];
      bed.x += weight * x;
    }
    return beds.filter(bed => bed.load > 0).map(bed => ({ ...bed,
      stress: bed.stress / bed.load, length: bed.length / bed.load, x: bed.x / bed.load }));
  }
  private solveDistance(c: Distance): void {
    if (c.cut && this.members[c.owner].broken) return;
    const { a, b } = c, dx = this.x[b] - this.x[a], dy = this.y[b] - this.y[a], len = Math.hypot(dx, dy);
    if (len < 1e-12) return;
    const value = len - c.rest;
    if (c.tension && value <= 0 && c.lambda === 0) return;
    const alpha = c.compliance / (DT * DT), weight = this.invMass[a] + this.invMass[b]; if (weight === 0) return;
    let dl = (-value - alpha * c.lambda) / (weight + alpha);
    if (c.tension) { const next = Math.min(0, c.lambda + dl); dl = next - c.lambda; }
    c.lambda += dl;
    const sx = dl * dx / len, sy = dl * dy / len;
    this.x[a] -= this.invMass[a] * sx; this.y[a] -= this.invMass[a] * sy;
    this.x[b] += this.invMass[b] * sx; this.y[b] += this.invMass[b] * sy;
  }
  private solveAngle(c: Angle): void {
    if (c.cut && this.members[c.owner].broken) return;
    const dx = this.x[c.b] - this.x[c.a], dy = this.y[c.b] - this.y[c.a], l1 = dx * dx + dy * dy;
    if (l1 < 1e-12) return;
    let value: number, count: number;
    if (c.c < 0) {
      value = wrap(Math.atan2(dy, dx) - c.rest); count = 2;
      this.ids[0] = c.a; this.ids[1] = c.b;
      this.gx[0] = dy / l1; this.gy[0] = -dx / l1; this.gx[1] = -dy / l1; this.gy[1] = dx / l1;
    } else {
      const ex = this.x[c.d] - this.x[c.c], ey = this.y[c.d] - this.y[c.c], l2 = ex * ex + ey * ey; if (l2 < 1e-12) return;
      value = wrap(Math.atan2(ey, ex) - Math.atan2(dy, dx) - c.rest); count = 4;
      this.ids[0] = c.a; this.ids[1] = c.b; this.ids[2] = c.c; this.ids[3] = c.d;
      this.gx[0] = -dy / l1; this.gy[0] = dx / l1; this.gx[1] = dy / l1; this.gy[1] = -dx / l1;
      this.gx[2] = ey / l2; this.gy[2] = -ex / l2; this.gx[3] = -ey / l2; this.gy[3] = ex / l2;
      // Adjacent rod segments share a particle; combine its two gradient terms.
      if (c.b === c.c) { this.gx[1] += this.gx[2]; this.gy[1] += this.gy[2]; this.gx[2] = this.gx[3]; this.gy[2] = this.gy[3]; this.ids[2] = this.ids[3]; count = 3; }
    }
    let weight = 0;
    for (let i = 0; i < count; i++) weight += this.invMass[this.ids[i]] * (this.gx[i] ** 2 + this.gy[i] ** 2);
    if (weight < 1e-12) return;
    const alpha = c.compliance / (DT * DT), dl = (-value - alpha * c.lambda) / (weight + alpha); c.lambda += dl;
    for (let i = 0; i < count; i++) { const id = this.ids[i], w = this.invMass[id] * dl; this.x[id] += w * this.gx[i]; this.y[id] += w * this.gy[i]; }
  }
  step(): void {
    this.oldX.set(this.x); this.oldY.set(this.y);
    const damping = Math.exp(-this.options.damping * DT);
    for (let i = 0; i < this.x.length; i++) if (this.invMass[i] > 0) {
      this.vx[i] *= damping; this.vy[i] = this.vy[i] * damping + this.options.gravity * DT;
      this.x[i] += this.vx[i] * DT; this.y[i] += this.vy[i] * DT;
    }
    for (const c of this.distances) c.lambda = 0;
    for (const c of this.angles) c.lambda = 0;
    for (let iteration = 0; iteration < this.options.iterations; iteration++) {
      // Alternate sweeps to reduce directional bias on long structures.
      if (iteration % 2) { for (let i = this.sweepDistances.length - 1; i >= 0; i--) this.solveDistance(this.sweepDistances[i]); for (let i = this.sweepAngles.length - 1; i >= 0; i--) this.solveAngle(this.sweepAngles[i]); }
      else { for (const c of this.sweepDistances) this.solveDistance(c); for (const c of this.sweepAngles) this.solveAngle(c); }
      for (let i = 0; i < this.x.length; i++) {
        if (iteration === 0 && this.invMass[i] > 0) {
          const member = this.members[this.particleOwner[i]];
          // Old positions must lie inside the board: a resting contact should not
          // become a new impact every time gravity pushes it into the boundary.
          const speedX = (this.x[i] - this.oldX[i]) / DT, speedY = (this.y[i] - this.oldY[i]) / DT;
          if (member.material === 'beam' && this.oldX[i] > 1e-6 && this.oldX[i] < this.project.size[0] - 1e-6 && (this.x[i] < 0 || this.x[i] > this.project.size[0]) && Math.abs(speedX) > 1.5)
            this.queueSound('beamWall', this.x[i], Math.abs(speedX) / 12, this.memberLengths[this.particleOwner[i]]);
          if (this.oldY[i] < this.project.size[1] - 1e-6 && this.y[i] > this.project.size[1] && speedY > 1.5)
            this.queueSound(member.material === 'beam' ? 'beamGround' : 'ropeGround', this.x[i], speedY / 12, this.memberLengths[this.particleOwner[i]]);
        }
        this.x[i] = Math.max(0, Math.min(this.project.size[0], this.x[i])); this.y[i] = Math.max(0, Math.min(this.project.size[1], this.y[i]));
      }
      for (const [id, x, y] of this.pins) { this.x[id] = x; this.y[id] = y; }
    }
    for (let i = 0; i < this.x.length; i++) {
      this.vx[i] = (this.x[i] - this.oldX[i]) / DT; this.vy[i] = (this.y[i] - this.oldY[i]) / DT;
      if (this.x[i] === 0 && this.vx[i] < 0 || this.x[i] === this.project.size[0] && this.vx[i] > 0) this.vx[i] *= -0.08;
      if (this.y[i] === 0 && this.vy[i] < 0 || this.y[i] === this.project.size[1] && this.vy[i] > 0) this.vy[i] *= -0.08;
    }
    this.measureDamage(); this.time += DT;
  }
  private measureDamage(): void {
    for (const m of this.members) m.stress = 0;
    for (const c of this.distances) if (c.owner >= 0 && c.rest > 0) {
      const m = this.members[c.owner]; if (m.broken) continue;
      const strain = (Math.hypot(this.x[c.b] - this.x[c.a], this.y[c.b] - this.y[c.a]) - c.rest) / c.rest;
      m.stress = Math.max(m.stress, (c.tension ? Math.max(0, strain) : Math.abs(strain)) / (c.tension ? 0.10 : 0.10));
    }
    for (const c of this.angles) if (c.internal && !this.members[c.owner].broken) {
      const angle = wrap(Math.atan2(this.y[c.d] - this.y[c.c], this.x[c.d] - this.x[c.c]) - Math.atan2(this.y[c.b] - this.y[c.a], this.x[c.b] - this.x[c.a]) - c.rest);
      this.members[c.owner].stress = Math.max(this.members[c.owner].stress, Math.abs(angle) / c.scale / (0.95 * PROFILES[this.members[c.owner].profile].curvature));
    }
    for (const [index, m] of this.members.entries()) if (!m.broken) {
      m.overload = m.stress > 1 ? m.overload + DT : 0;
      if (m.stress > (m.material === 'beam' ? .48 : .35) && m.stress > this.previousStress[index] + .035)
        this.queueSound(m.material === 'beam' ? 'beamStress' : 'ropeStress', this.x[m.start + m.half - 1], m.stress / 1.5, this.memberLengths[index]);
      if (this.options.damage && m.overload + 1e-9 >= 0.05) {
        m.broken = true;
        if (m.material === 'rope') this.queueSound('ropeBreak', this.x[m.start + m.half - 1], Math.max(0.5, m.stress / 1.5), this.memberLengths[index]);
      }
      this.previousStress[index] = m.stress;
    }
  }
  frame(buffers?: { positions: ArrayBuffer; stresses: ArrayBuffer; broken: ArrayBuffer }): Frame {
    const positions = buffers && buffers.positions.byteLength === this.x.length * 8 ? new Float32Array(buffers.positions) : new Float32Array(this.x.length * 2);
    const stresses = buffers && buffers.stresses.byteLength === this.members.length * 4 ? new Float32Array(buffers.stresses) : new Float32Array(this.members.length);
    const broken = buffers && buffers.broken.byteLength === this.members.length ? new Uint8Array(buffers.broken) : new Uint8Array(this.members.length);
    for (let i = 0; i < this.x.length; i++) { positions[i * 2] = this.x[i]; positions[i * 2 + 1] = this.y[i]; }
    this.members.forEach((m, i) => { stresses[i] = m.stress; broken[i] = Number(m.broken); });
    return { positions, stresses, broken, time: this.time, stepMs: this.stepMs, points: this.x.length, constraints: this.distances.length + this.angles.length };
  }
}
