import { PROFILES, ROPE_PROFILES, boundary, key, type Project, type Point, type Material, type BeamProfile } from './model';
import { serpentineMemberOrder, type Solver } from './solver-strategies';
export const DT = 1 / 120;
const TAU = 2 * Math.PI;
const wrap = (v: number) => ((v + Math.PI) % TAU + TAU) % TAU - Math.PI;
interface Distance { a: number; b: number; rest: number; compliance: number; lambda: number; tension: boolean; owner: number; cut: boolean }
interface Angle { a: number; b: number; c: number; d: number; rest: number; compliance: number; lambda: number; owner: number; cut: boolean; internal: boolean; scale: number }
export interface PhysicsMember { start: number; count: number; half: number; material: Material; profile: BeamProfile; broken: boolean; stress: number; overload: number }
export interface PhysicsOptions { gravity?: number; damage?: boolean; bending?: number; axial?: number; iterations?: number; damping?: number; solver?: Solver; serpentineFromRight?: boolean; initialPerturbation?: number; ropePrestrain?: readonly number[] }
export interface Frame { positions: Float32Array; stresses: Float32Array; broken: Uint8Array; time: number; stepMs: number; points: number; constraints: number }
export type SoundKind = 'beamStress' | 'ropeStress' | 'ropeBreak' | 'beamWall' | 'beamGround' | 'ropeGround';
export interface SoundEvent { kind: SoundKind; x: number; intensity: number; length: number }
export interface StressBed { material: Material; zone: number; count: number; load: number; stress: number; length: number; x: number }
const SOUND_INTERVAL: Record<SoundKind, number> = { beamStress: 0.36, ropeStress: 0.28, ropeBreak: 0.09, beamWall: 0.12, beamGround: 0.12, ropeGround: 0.16 };
const STRESS_AUDIO_THRESHOLD = .05;
interface Endpoint { p: number; neighbor: number; material: Material; direction: number; owner: number }
export class World {
  readonly x: Float64Array; readonly y: Float64Array; readonly vx: Float64Array; readonly vy: Float64Array;
  // mass stores each member sample's material contribution. invMass addresses
  // the effective mass of its common particle, summing all incident samples.
  readonly invMass: Float64Array; readonly mass: Float64Array;
  // Member samples retain their contiguous rendering indices. Samples in one
  // intact joint address a single physical particle through this map; aliases
  // are read-only snapshots between steps, never independent solver unknowns.
  readonly particleIds: Int32Array;
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
  private activeParticles: number[] = [];
  time = 0; stepMs = 0;
  constructor(readonly project: Project, options: PhysicsOptions = {}) {
    // Diagnostic strains address ropes in the supplied normalized project order.
    // Copy the array so later caller edits cannot change the recorded settings;
    // iterating values also rejects holes in an otherwise correctly sized array.
    const ropePrestrain = options.ropePrestrain === undefined ? project.ropes.map(() => 0) : options.ropePrestrain;
    if (!Array.isArray(ropePrestrain) || ropePrestrain.length !== project.ropes.length) throw new Error('ropePrestrain must contain one strain per project rope.');
    for (const strain of ropePrestrain) if (typeof strain !== 'number' || !Number.isFinite(strain) || strain < 0 || strain > 0.01) throw new Error('Rope prestrain must be finite and between 0 and 0.01 (0–1%).');
    // Short steel beams should appear straight under their own weight. A modest
    // increase in solver sweeps prevents numerical compliance dominating bending.
    this.options = { gravity: 9.81, damage: true, bending: 10000, axial: 2e6, iterations: 12, damping: 0.65, solver: 'original', serpentineFromRight: false, initialPerturbation: 0.001, ...options, ropePrestrain: [...ropePrestrain] };
    const scanRank = new Int32Array(project.beams.length+project.ropes.length);
    if (this.options.solver === 'serpentine') serpentineMemberOrder(project,this.options.serpentineFromRight).forEach((owner,index) => { scanRank[owner] = index; });
    const positions: Point[] = [], masses: number[] = [], endpoints = new Map<string, Endpoint[]>();
    const addPoint = (x: number, y: number, owner: number) => { const id = positions.length; positions.push([x, y]); masses.push(0); this.particleOwner.push(owner); return id; };
    for (const [material, list] of [['beam', project.beams.map(b => b.endpoints)], ['rope', project.ropes.map(r => r.endpoints)]] as const) for (const [index, m] of list.entries()) {
      const profile = material === 'beam' ? project.beams[index].profile : project.ropes[index].profile, properties = PROFILES[profile], ropeProperties = ROPE_PROFILES[profile as 's' | 'h'];
      const len = Math.hypot(m[2] - m[0], m[3] - m[1]);
      this.memberLengths.push(len);
      let n = Math.max(4, Math.ceil(len / 0.5)); if (n % 2) n++;
      const half = n / 2 + 1, start = positions.length, owner = this.members.length, h = len / n;
      // Keep the drawn geometry and discretization. A mounted rope is stretched
      // relative to its shorter stress-free length; both mass and axial
      // compliance use that natural length. Zero strain reproduces h exactly.
      const rest = material === 'rope' ? h / (1 + this.options.ropePrestrain[index]) : h;
      const member: PhysicsMember = { start, count: n + 2, half, material, profile, broken: false, stress: 0, overload: 0 };
      this.members.push(member);
      // Keep separate rendering slots for the two halves. Their midpoint slots
      // address one physical particle until fracture releases that connection.
      for (let side = 0; side < 2; side++) {
        const sideStart = positions.length;
        for (let j = 0; j < half; j++) { const t = (side * (n / 2) + j) / n; addPoint(m[0] + (m[2] - m[0]) * t, m[1] + (m[3] - m[1]) * t, owner); }
        for (let j = 0; j < half - 1; j++) {
          // Rope area scales both line density and EA; the steel failure strain
          // stays at ten percent, so Heavy carries four times the axial force.
          const a = sideStart + j, b = a + 1, density = material === 'beam' ? 1.8 * properties.mass : 0.22 * ropeProperties.mass;
          masses[a] += density * rest / 2; masses[b] += density * rest / 2;
          this.distances.push({ a, b, rest, compliance: rest / (material === 'beam' ? this.options.axial * properties.axial : 80000 * ropeProperties.axial), lambda: 0, tension: material === 'rope', owner, cut: false });
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
      // The first incident beam defines a rigid joint's angular reference.
      // Serpentine chooses it in scan order as well as reordering sweeps.
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
    this.particleIds = Int32Array.from(positions, (_, i) => i);
    // Eliminate translational weld constraints exactly. Union only explicit
    // endpoints and intact member midpoints, never incidental cable crossings.
    const root = (id: number): number => {
      while (this.particleIds[id] !== id) id = this.particleIds[id];
      return id;
    };
    for (const c of this.distances) if (c.rest === 0) {
      const a = root(c.a), b = root(c.b);
      this.particleIds[Math.max(a, b)] = Math.min(a, b);
    }
    const jointMass = new Float64Array(positions.length), fixed = new Uint8Array(positions.length);
    // Sum material mass contributions, including both halves at an intact
    // midpoint. A fixed incident endpoint fixes the common translation only;
    // the existing angular constraints still distinguish a pin from a clamp.
    for (let i = 0; i < positions.length; i++) {
      const id = this.particleIds[i] = root(i);
      jointMass[id] += this.mass[i];
      if (this.invMass[i] === 0) fixed[id] = 1;
      if (id === i) this.activeParticles.push(i);
    }
    for (let i = 0; i < positions.length; i++) {
      const id = this.particleIds[i];
      this.invMass[i] = fixed[id] ? 0 : 1 / Math.max(jointMass[id], 1e-9);
    }
    // All zero-length welds are represented by topology now, not XPBD sweeps.
    const elasticDistances = this.distances.filter(c => c.rest > 0);
    this.distances.length = 0;
    this.distances.push(...elasticDistances);
    this.sweepDistances = this.distances; this.sweepAngles = this.angles;
    this.previousStress = this.members.map(() => 0);
    if (this.options.solver === 'serpentine') {
      const rank = scanRank, particleRank = new Int32Array(this.x.length);
      // Keep member/particle IDs stable for rendering; only the constraint visit
      // order changes. Joint angles use the earliest incident member's scan position.
      for (const [owner,m] of this.members.entries()) particleRank.fill(rank[owner], m.start, m.start+m.count);
      const priority = (c: Distance | Angle) => c.owner >= 0 ? rank[c.owner] : Math.min(particleRank[c.a],particleRank[c.b],...('c' in c && c.c >= 0 ? [particleRank[c.c],particleRank[c.d]] : []));
      this.sweepDistances = [...this.distances].sort((a,b) => priority(a)-priority(b));
      this.sweepAngles = [...this.angles].sort((a,b) => priority(a)-priority(b));
    }
    this.applyInitialPerturbation();
    this.syncParticleSamples();
    // Report the mounted elastic strain at t=0 without advancing an overload
    // timer or playing a sound. Normal zero-prestrain startup stays unchanged.
    if (this.options.ropePrestrain.some(strain => strain > 0)) this.measureStress();
  }
  private syncParticleSamples(): void {
    // Expand the common particle state into the stable per-member layout used
    // by rendering, damage measurements and worker frame buffers.
    for (let i = 0; i < this.x.length; i++) {
      const id = this.particleIds[i];
      if (id === i) continue;
      this.x[i] = this.x[id]; this.y[i] = this.y[id];
      this.vx[i] = this.vx[id]; this.vy[i] = this.vy[id];
    }
  }
  private releaseMidpoint(member: PhysicsMember): void {
    const left = member.start + member.half - 1, right = left + 1;
    // Only this member's two midpoint samples were merged. Reuse the reserved
    // right-hand slot on fracture, retaining position and velocity on both sides
    // so splitting conserves mass and linear momentum without an impulse.
    this.particleIds[right] = right;
    this.invMass[left] = 1 / this.mass[left];
    this.invMass[right] = 1 / this.mass[right];
    this.activeParticles.push(right);
  }
  private applyInitialPerturbation(): void {
    const [width, height] = this.project.size, amplitude = this.options.initialPerturbation;
    if (amplitude === 0) return;
    // Apply a one-time horizontal imperfection after computing all rest lengths
    // and angles from the design. The signed amplitude is in board units; zero
    // disables the disturbance, and either sign supports controlled comparisons.
    // Visit each common particle once using its original position; rendering
    // samples receive that state after all startup offsets have been applied.
    for (const i of this.activeParticles) {
      const x = this.x[i], y = this.y[i];
      // The smooth field vanishes on every board edge. Skip those points exactly
      // to keep supports and boundary contacts unchanged despite sine roundoff.
      if (this.invMass[i] === 0 || x <= 0 || x >= width || y <= 0 || y >= height) continue;
      const offset = amplitude * Math.sin(Math.PI * x / width) * Math.sin(Math.PI * y / height);
      // Bound extreme diagnostic amplitudes too, so the ready frame stays inside
      // the board. No velocity or repeated forcing is introduced by this offset.
      this.x[i] = Math.max(0, Math.min(width, x + offset));
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
    const a = this.particleIds[c.a], b = this.particleIds[c.b], dx = this.x[b] - this.x[a], dy = this.y[b] - this.y[a], len = Math.hypot(dx, dy);
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
    const a = this.particleIds[c.a], b = this.particleIds[c.b];
    const dx = this.x[b] - this.x[a], dy = this.y[b] - this.y[a], l1 = dx * dx + dy * dy;
    if (l1 < 1e-12) return;
    let value: number, count: number;
    if (c.c < 0) {
      value = wrap(Math.atan2(dy, dx) - c.rest); count = 2;
      this.ids[0] = a; this.ids[1] = b;
      this.gx[0] = dy / l1; this.gy[0] = -dx / l1; this.gx[1] = -dy / l1; this.gy[1] = dx / l1;
    } else {
      const third = this.particleIds[c.c], fourth = this.particleIds[c.d];
      const ex = this.x[fourth] - this.x[third], ey = this.y[fourth] - this.y[third], l2 = ex * ex + ey * ey; if (l2 < 1e-12) return;
      value = wrap(Math.atan2(ey, ex) - Math.atan2(dy, dx) - c.rest); count = 4;
      this.ids[0] = a; this.ids[1] = b; this.ids[2] = third; this.ids[3] = fourth;
      this.gx[0] = -dy / l1; this.gy[0] = dx / l1; this.gx[1] = dy / l1; this.gy[1] = -dx / l1;
      this.gx[2] = ey / l2; this.gy[2] = -ex / l2; this.gx[3] = -ey / l2; this.gy[3] = ex / l2;
      // A midpoint shares b/c; a multi-member joint shares a/c instead. Sum
      // derivatives for every repeated physical ID before forming the XPBD
      // denominator, including cross terms for that common degree of freedom.
      for (let i = 0; i < count; i++) for (let j = i + 1; j < count;) {
        if (this.ids[i] !== this.ids[j]) { j++; continue; }
        this.gx[i] += this.gx[j]; this.gy[i] += this.gy[j];
        count--;
        this.ids[j] = this.ids[count]; this.gx[j] = this.gx[count]; this.gy[j] = this.gy[count];
      }
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
    for (const i of this.activeParticles) if (this.invMass[i] > 0) {
      this.vx[i] *= damping; this.vy[i] = this.vy[i] * damping + this.options.gravity * DT;
      this.x[i] += this.vx[i] * DT; this.y[i] += this.vy[i] * DT;
    }
    for (const c of this.distances) c.lambda = 0;
    for (const c of this.angles) c.lambda = 0;
    for (let iteration = 0; iteration < this.options.iterations; iteration++) {
      // Alternate sweeps to reduce directional bias on long structures.
      if (iteration % 2) { for (let i = this.sweepDistances.length - 1; i >= 0; i--) this.solveDistance(this.sweepDistances[i]); for (let i = this.sweepAngles.length - 1; i >= 0; i--) this.solveAngle(this.sweepAngles[i]); }
      else { for (const c of this.sweepDistances) this.solveDistance(c); for (const c of this.sweepAngles) this.solveAngle(c); }
      for (const i of this.activeParticles) {
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
    for (const i of this.activeParticles) {
      this.vx[i] = (this.x[i] - this.oldX[i]) / DT; this.vy[i] = (this.y[i] - this.oldY[i]) / DT;
      if (this.x[i] === 0 && this.vx[i] < 0 || this.x[i] === this.project.size[0] && this.vx[i] > 0) this.vx[i] *= -0.08;
      if (this.y[i] === 0 && this.vy[i] < 0 || this.y[i] === this.project.size[1] && this.vy[i] > 0) this.vy[i] *= -0.08;
    }
    this.syncParticleSamples();
    this.measureDamage(); this.time += DT;
  }
  private measureStress(): void {
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
  }
  private measureDamage(): void {
    this.measureStress();
    for (const [index, m] of this.members.entries()) if (!m.broken) {
      m.overload = m.stress > 1 ? m.overload + DT : 0;
      if (m.stress > (m.material === 'beam' ? .48 : .35) && m.stress > this.previousStress[index] + .035)
        this.queueSound(m.material === 'beam' ? 'beamStress' : 'ropeStress', this.x[m.start + m.half - 1], m.stress / 1.5, this.memberLengths[index]);
      if (this.options.damage && m.overload + 1e-9 >= 0.05) {
        m.broken = true;
        this.releaseMidpoint(m);
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
    return { positions, stresses, broken, time: this.time, stepMs: this.stepMs, points: this.activeParticles.length, constraints: this.distances.length + this.angles.length };
  }
}
