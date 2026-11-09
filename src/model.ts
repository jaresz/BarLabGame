import { centeredMember, fromCentered, toCentered } from './coordinates';

export type Point = [number, number];
export type Member = [number, number, number, number];
export type BeamProfile = 'l' | 's' | 'h';
export interface Beam { endpoints: Member; profile: BeamProfile }
export const PROFILES = {
  l: { name: 'Light', mass: 0.5, bending: 0.25, axial: 0.5, curvature: 1.4, price: 4, width: 0.10, color: '#83969a' },
  s: { name: 'Standard', mass: 1, bending: 1, axial: 1, curvature: 1, price: 8, width: 0.15, color: '#345a60' },
  h: { name: 'Heavy', mass: 2, bending: 4, axial: 2, curvature: 0.7, price: 16, width: 0.24, color: '#253c50' },
} as const;
export const ROPE_PRICE = 2;
export type JointType = 'x' | 'o';
export type Material = 'beam' | 'rope';
export interface Project { size: Point; beams: Beam[]; ropes: Member[]; joints: Record<string, JointType>; anchors: Record<string, JointType> }
// Bump this after every application change; the status bar and exported project metadata use it.
export const GAME_VERSION = '0.4.75';
export const MAX_LENGTH: Readonly<Record<Material, number>> = { beam: 6, rope: 10 };

/** Resolve a snapped drawing target without changing import/member validation. */
export function drawingEndpoint(start: Point, target: Point, material: Material, size: Point): Point {
  const limit = MAX_LENGTH[material];
  const distance = Math.hypot(target[0] - start[0], target[1] - start[1]);
  if (distance <= limit + 1e-8) return [...target];
  const ideal: Point = [start[0] + (target[0] - start[0]) * limit / distance, start[1] + (target[1] - start[1]) * limit / distance];
  let best: Point = [...start], bestError = Infinity, bestLength = 0;
  for (let x = Math.max(0, start[0] - limit); x <= Math.min(size[0], start[0] + limit); x++) {
    for (let y = Math.max(0, start[1] - limit); y <= Math.min(size[1], start[1] + limit); y++) {
      const length = (x - start[0]) ** 2 + (y - start[1]) ** 2;
      if (!length || length > limit ** 2) continue;
      const error = (x - ideal[0]) ** 2 + (y - ideal[1]) ** 2;
      if (error < bestError - 1e-8 || (Math.abs(error - bestError) <= 1e-8 && length > bestLength)) {
        best = [x, y]; bestError = error; bestLength = length;
      }
    }
  }
  return best;
}
export const key = (p: Point): string => `${p[0]},${p[1]}`;
export const fromKey = (s: string): Point => s.split(',').map(Number) as Point;
export const length = (m: Member): number => Math.hypot(m[2] - m[0], m[3] - m[1]);
export const boundary = (p: Point, size: Point): boolean => p[0] === 0 || p[1] === 0 || p[0] === size[0] || p[1] === size[1];
export const inside = (p: Point, size: Point): boolean => p[0] >= 0 && p[1] >= 0 && p[0] <= size[0] && p[1] <= size[1];
export const emptyProject = (): Project => ({ size: [16, 10], beams: [], ropes: [], joints: {}, anchors: {} });
export function resizeProject(project: Project, size: Point): Project {
  if (!Number.isSafeInteger(size[0]) || !Number.isSafeInteger(size[1]) || size[0] < 12 || size[0] > 64 || size[1] < 8 || size[1] > 40 || size.some(v => v % 2)) {
    throw new Error('Board size must be even: width 12–64, height 8–40.');
  }
  const next = cloneProject(project);
  if ([...next.beams.map(b => b.endpoints), ...next.ropes].some(m => m[0] > size[0] || m[2] > size[0] || m[1] > size[1] || m[3] > size[1])) {
    throw new Error('The new size would cut off existing elements. Increase the canvas or move the elements first.');
  }
  next.size = [...size];
  for (const id of Object.keys(next.anchors)) if (!boundary(fromKey(id), next.size)) delete next.anchors[id];
  return normalizeProject(next);
}
export const cloneProject = (p: Project): Project => structuredClone(p);
export function canonical(m: Member): Member { return m[0] < m[2] || (m[0] === m[2] && m[1] <= m[3]) ? [...m] : [m[2], m[3], m[0], m[1]]; }
const compare = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
export function nodes(p: Project): Map<string, Point> { const out = new Map<string, Point>(); for (const m of [...p.beams.map(b => b.endpoints), ...p.ropes]) { const a: Point = [m[0], m[1]], b: Point = [m[2], m[3]]; out.set(key(a), a); out.set(key(b), b); } return out; }
export function pointOnMember(p: Point, m: Member, interior = false): boolean {
  const dx = m[2] - m[0], dy = m[3] - m[1], px = p[0] - m[0], py = p[1] - m[1];
  if (Math.abs(dx * py - dy * px) > 1e-8) return false;
  const t = px * dx + py * dy, d = dx * dx + dy * dy;
  return interior ? t > 0 && t < d : t >= 0 && t <= d;
}
function gcd(a: number, b: number): number { while (b) [a, b] = [b, a % b]; return Math.abs(a); }
function membersOverlap(a: Member, b: Member): boolean {
  const dx = a[2] - a[0], dy = a[3] - a[1];
  if (Math.abs(dx * (b[1] - a[1]) - dy * (b[0] - a[0])) > 1e-8 ||
      Math.abs(dx * (b[3] - a[1]) - dy * (b[2] - a[0])) > 1e-8) return false;
  const axis = Math.abs(dx) >= Math.abs(dy) ? 0 : 1;
  // A shared endpoint is allowed; a shared interval is not.
  return Math.max(Math.min(a[axis], a[axis + 2]), Math.min(b[axis], b[axis + 2])) <
    Math.min(Math.max(a[axis], a[axis + 2]), Math.max(b[axis], b[axis + 2]));
}
export function normalizeProject(source: Project): Project {
  const p = cloneProject(source), endpoints = nodes(p);
  const split: Beam[] = [];
  for (const beam of p.beams) {
    const m = beam.endpoints;
    const count = gcd(Math.abs(m[2] - m[0]), Math.abs(m[3] - m[1]));
    let prev: Point = [m[0], m[1]];
    for (let i = 1; i <= count; i++) {
      const next: Point = [m[0] + (m[2] - m[0]) * i / count, m[1] + (m[3] - m[1]) * i / count];
      if (i === count || endpoints.has(key(next))) { split.push({ endpoints: canonical([...prev, ...next] as Member), profile: beam.profile }); prev = next; }
    }
  }
  p.beams = split.sort((a, b) => compare(a.endpoints, b.endpoints)); p.ropes = p.ropes.map(canonical).sort(compare);
  for (const list of [p.beams.map(b => b.endpoints), p.ropes]) { const seen = new Set<string>(); for (const m of list) { const id = m.join(','); if (seen.has(id)) throw new Error('Duplicate or overlapping elements are not allowed.'); seen.add(id); } }
  const active = nodes(p);
  for (const id of Object.keys(p.joints)) if (!active.has(id) || p.joints[id] === 'x') delete p.joints[id];
  for (const id of Object.keys(p.anchors)) if (!active.has(id) || !boundary(fromKey(id), p.size) || p.anchors[id] === 'x') delete p.anchors[id];
  return p;
}
export function validateMember(p: Project, material: Material, m: Member): string | null {
  if (!inside([m[0], m[1]], p.size) || !inside([m[2], m[3]], p.size)) return 'Stay inside the build area.';
  const l = length(m);
  if (l < 1e-8) return 'Choose a different endpoint.';
  if (l > MAX_LENGTH[material] + 1e-8) return `Maximum ${material} length is ${MAX_LENGTH[material]} grid units.`;
  const list = material === 'beam' ? p.beams.map(b => b.endpoints) : p.ropes;
  const id = canonical(m).join(',');
  if (list.some(e => canonical(e).join(',') === id)) return 'This element already exists.';
  if (material === 'beam' && list.some(e => membersOverlap(m, e))) return 'This beam overlaps an existing beam.';
  return null;
}
export function addMember(p: Project, material: Material, m: Member, type: JointType = 'x', profile: BeamProfile = 's'): Project {
  const error = validateMember(p, material, m); if (error) throw new Error(error);
  const next = cloneProject(p), before = nodes(p);
  if (material === 'beam') next.beams.push({ endpoints: m, profile }); else next.ropes.push(m);
  for (const pt of [[m[0], m[1]], [m[2], m[3]]] as Point[]) if (!before.has(key(pt)) && type === 'o') {
    next.joints[key(pt)] = 'o'; if (boundary(pt, next.size)) next.anchors[key(pt)] = 'o';
  }
  return normalizeProject(next);
}
export function toggleNode(project: Project, id: string): Project {
  if (!nodes(project).has(id)) throw new Error('This node does not exist.');
  const next = cloneProject(project), type: JointType = project.joints[id] === 'o' ? 'x' : 'o';
  if (type === 'x') delete next.joints[id]; else next.joints[id] = type;
  if (boundary(fromKey(id), next.size)) {
    if (type === 'x') delete next.anchors[id]; else next.anchors[id] = type;
  }
  return next;
}

type NodeMove = readonly [Point, Point];

/** Move endpoints simultaneously, so destinations can occupy other sources. */
function movedNodesPreview(project: Project, moves: readonly NodeMove[]): Project {
  const next = cloneProject(project);
  const destinations = new Map(moves.filter(([a,b]) => key(a) !== key(b)).map(([a,b]) => [key(a),b]));
  if (!destinations.size) return next;
  const stationary = nodes(project);
  for (const id of destinations.keys()) {
    stationary.delete(id); delete next.joints[id]; delete next.anchors[id];
  }
  const relocate = (m: Member): Member => canonical([
    ...(destinations.get(key([m[0],m[1]])) ?? [m[0],m[1]]),
    ...(destinations.get(key([m[2],m[3]])) ?? [m[2],m[3]]),
  ] as Member);
  // Stationary members retain their profiles when a move produces duplicates.
  const touchesSource = (m: Member) => destinations.has(key([m[0],m[1]])) || destinations.has(key([m[2],m[3]]));
  const seenBeams = new Set<string>(), seenRopes = new Set<string>();
  next.beams = [...project.beams].sort((a,b) => Number(touchesSource(a.endpoints)) - Number(touchesSource(b.endpoints)))
    .flatMap(b => {
      const endpoints = relocate(b.endpoints), id = endpoints.join(',');
      if (!length(endpoints) || seenBeams.has(id)) return [];
      seenBeams.add(id); return [{ endpoints, profile: b.profile }];
    });
  next.ropes = project.ropes.flatMap(m => {
    const moved = relocate(m), id = moved.join(',');
    if (!length(moved) || seenRopes.has(id)) return [];
    seenRopes.add(id); return [moved];
  });
  for (const [sourceId,target] of destinations) {
    const targetId = key(target);
    if (stationary.has(targetId)) continue;
    if (project.joints[sourceId] === 'o') next.joints[targetId] = 'o';
    if (boundary(target, project.size) && project.joints[sourceId] === 'o') next.anchors[targetId] = 'o';
  }
  return next;
}

/** Raw geometry for a drag preview, including invalid destinations. */
export function nodeMovePreview(project: Project, source: Point, target: Point): Project {
  return translateNodesPreview(project, [source], [target[0]-source[0],target[1]-source[1]]);
}

function translationMoves(sources: readonly Point[], delta: Point): NodeMove[] {
  // A node may be selected explicitly and through several members. Apply the
  // common grid-space displacement once per coordinate, never once per entry.
  return [...new Map(sources.map(p => [key(p),p])).values()]
    .map(p => [p,[p[0]+delta[0],p[1]+delta[1]]] as NodeMove);
}

/** Preview the shared grid displacement, including geometry that cannot be committed. */
export function translateNodesPreview(project: Project, sources: readonly Point[], delta: Point): Project {
  return movedNodesPreview(project, translationMoves(sources,delta));
}

/** Commit-ready translation: validate the entire group and its incident members together. */
export function translateNodes(project: Project, sources: readonly Point[], delta: Point): Project {
  if (!delta.every(Number.isSafeInteger)) throw new Error('Stay inside the build area on whole grid points.');
  return moveNodes(project, translationMoves(sources,delta));
}

export function beamMovePreview(project: Project, endpoints: Member, delta: Point): Project {
  return translateNodesPreview(project, [[endpoints[0],endpoints[1]],[endpoints[2],endpoints[3]]],delta);
}

/** Validate the complete move before normalization can split long beams. */
function moveNodes(project: Project, moves: readonly NodeMove[]): Project {
  const active = nodes(project);
  for (const [source,target] of moves) {
    if (!active.has(key(source))) throw new Error('This node does not exist.');
    if (!target.every(Number.isSafeInteger) || !inside(target,project.size)) throw new Error('Stay inside the build area.');
  }
  const next = movedNodesPreview(project,moves);
  for (const [material,list] of [['beam',next.beams.map(b => b.endpoints)],['rope',next.ropes]] as const) {
    for (let i=0;i<list.length;i++) {
      if (length(list[i]) > MAX_LENGTH[material]+1e-8) throw new Error(`Maximum ${material} length is ${MAX_LENGTH[material]} grid units.`);
      if (material === 'beam' && list.slice(i+1).some(m => membersOverlap(list[i],m))) throw new Error('This beam overlaps an existing beam.');
    }
  }
  return normalizeProject(next);
}

export function moveNode(project: Project, source: Point, target: Point): Project {
  return translateNodes(project,[source],[target[0]-source[0],target[1]-source[1]]);
}

export function moveBeam(project: Project, endpoints: Member, delta: Point): Project {
  const id = canonical(endpoints).join(',');
  if (!project.beams.some(b => canonical(b.endpoints).join(',') === id)) throw new Error('This beam does not exist.');
  return translateNodes(project,[[endpoints[0],endpoints[1]],[endpoints[2],endpoints[3]]],delta);
}
export function projectCost(p: Project): { total: number; breakdown: Record<BeamProfile | 'r', number> } {
  const raw = { l: 0, s: 0, h: 0, r: 0 };
  for (const b of p.beams) raw[b.profile] += length(b.endpoints) * PROFILES[b.profile].price;
  for (const r of p.ropes) raw.r += length(r) * ROPE_PRICE;
  const breakdown = { l: 0, s: 0, h: 0, r: 0 };
  for (const type of ['l', 's', 'h', 'r'] as const) breakdown[type] = Math.max(0, Math.ceil(raw[type] - 1e-9));
  return { total: Object.values(breakdown).reduce((a, b) => a + b, 0), breakdown };
}
export function exportProject(project: Project): string {
  const p = normalizeProject(project);
  const objects: Record<string, unknown[]> = {};
  if (p.beams.length) objects.b = p.beams.map(b => [...centeredMember(b.endpoints, p.size), b.profile]);
  if (p.ropes.length) objects.r = p.ropes.map(m => centeredMember(m, p.size));
  for (const [name, settings] of [['j', p.joints], ['a', p.anchors]] as const) {
    const rows = Object.entries(settings).filter(([, t]) => t !== 'x').map(([id, type]) => [...toCentered(fromKey(id), p.size), type]).sort((a, b) => compare(a.slice(0, 2) as number[], b.slice(0, 2) as number[]));
    if (rows.length) objects[name] = rows;
  }
  const lines = Object.entries(objects).map(([k, rows]) => `    "${k}": [${rows.map(r => JSON.stringify(r)).join(', ')}]`);
  const checksum = checksumObjects(objects);
  return `{\n  "metadata": {\n    "size": ${JSON.stringify(p.size)},\n    "gameVersion": "${GAME_VERSION}",\n    "formatVersion": 3\n  },\n  "objects": {${lines.length ? '\n' + lines.join(',\n') + '\n  ' : ''}},\n  "checksum": "${checksum}"\n}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function checksumObjects(objects: unknown): string {
  const bytes = new TextEncoder().encode(canonicalJson(objects));
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}

/** Returns a warning for incorrect checksum data without rejecting the project. */
export function projectChecksumWarning(text: string): string | null {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return null; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  if (!Object.hasOwn(record, 'checksum')) return null; // Legacy projects remain supported.
  if (!Object.hasOwn(record, 'objects')) return 'Checksum could not be verified because the objects section is missing.';
  if (typeof record.checksum !== 'string' || !/^fnv1a32:[0-9a-f]{8}$/.test(record.checksum) || record.checksum !== checksumObjects(record.objects)) {
    return 'Project checksum does not match its objects. The project may have been changed or damaged; it can still be opened.';
  }
  return null;
}

export function importProject(text: string): Project {
  if (new TextEncoder().encode(text).length > 1024 * 1024) throw new Error('Project text must be smaller than 1 MiB.');
  let data: unknown; try { data = JSON.parse(text); } catch { throw new Error('Invalid JSON. Check commas, brackets, and quotation marks.'); }
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  if (!object(data) || !object(data.metadata) || !object(data.objects)) throw new Error('Use the new project format: metadata and objects sections are required. Older formats are not supported.');
  const meta = data.metadata, objects = data.objects;
  for (const [obj, allowed] of [[data, ['metadata', 'objects', 'checksum']], [meta, ['size', 'gameVersion', 'formatVersion']], [objects, ['b', 'r', 'j', 'a']]] as [Record<string, unknown>, string[]][]) {
    for (const k of Object.keys(obj)) if (!allowed.includes(k)) throw new Error(`Unknown project field: ${k}.`);
  }
  if (meta.formatVersion !== 3) throw new Error('Unsupported formatVersion. This game supports version 3.');
  if (typeof meta.gameVersion !== 'string' || !meta.gameVersion.length) throw new Error('gameVersion must be a nonempty string.');
  const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
  if (!Array.isArray(meta.size) || meta.size.length !== 2 || !meta.size.every(integer) || meta.size[0] < 12 || meta.size[0] > 64 || meta.size[1] < 8 || meta.size[1] > 40 || meta.size.some(v => v % 2)) throw new Error('Board size must be even: width 12–64, height 8–40.');
  const p = emptyProject(); p.size = meta.size as Point;
  const readPoint = (x: unknown, y: unknown): Point => {
    if (!integer(x) || !integer(y)) throw new Error('Coordinates must be integers on the centered grid.');
    return fromCentered([x, y], p.size);
  };
  const rows = (name: string): unknown[][] => { if (objects[name] === undefined) return []; if (!Array.isArray(objects[name]) || !(objects[name] as unknown[]).every(Array.isArray)) throw new Error(`${name} must be an array of rows.`); return objects[name] as unknown[][]; };
  for (const name of ['b', 'r'] as const) for (const row of rows(name)) {
    if (row.length !== (name === 'b' ? 5 : 4)) throw new Error(name === 'b' ? 'Beams must be [x1, y1, x2, y2, profile].' : 'Ropes need four coordinates.');
    if (name === 'b' && !['l', 's', 'h'].includes(row[4] as string)) throw new Error('Beam profile must be l, s, or h.');
    const m: Member = [...readPoint(row[0], row[1]), ...readPoint(row[2], row[3])];
    if (!inside([m[0], m[1]], p.size) || !inside([m[2], m[3]], p.size)) throw new Error('An element is outside the build area.');
    const material = name === 'b' ? 'beam' : 'rope';
    if (length(m) <= 0 || length(m) > MAX_LENGTH[material] + 1e-8) throw new Error(`${material} length must be greater than 0 and at most ${MAX_LENGTH[material]} grid units.`);
    if (name === 'b') p.beams.push({ endpoints: m, profile: row[4] as BeamProfile }); else p.ropes.push(m);
  }
  for (const list of [p.beams.map(b => b.endpoints), p.ropes]) if (new Set(list.map(m => canonical(m).join(','))).size !== list.length) throw new Error('Duplicate elements are not allowed.');
  const active = nodes(normalizeProject(p));
  for (const name of ['j', 'a'] as const) {
    const settings = name === 'j' ? p.joints : p.anchors;
    for (const row of rows(name)) {
      if (row.length !== 3 || !['o', 'x'].includes(row[2] as string)) throw new Error(`${name} rows must be [x, y, "o" or "x"].`);
      const pt = readPoint(row[0], row[1]), id = key(pt);
      if (!active.has(id)) throw new Error(`${name} refers to a node that does not exist.`);
      if (name === 'a' && !boundary(pt, p.size)) throw new Error('Anchors must be on the boundary.');
      if (Object.hasOwn(settings, id)) throw new Error('Duplicate node settings are not allowed.');
      settings[id] = row[2] as JointType;
    }
  }
  return normalizeProject(p);
}
export class History {
  private past: Project[] = []; private future: Project[] = [];
  constructor(public project: Project) {}
  commit(next: Project): void { if (exportProject(this.project) === exportProject(next)) return; this.past.push(cloneProject(this.project)); if (this.past.length > 100) this.past.shift(); this.future = []; this.project = cloneProject(next); }
  undo(): boolean { const p = this.past.pop(); if (!p) return false; this.future.push(this.project); this.project = p; return true; }
  redo(): boolean { const p = this.future.pop(); if (!p) return false; this.past.push(this.project); this.project = p; return true; }
  get canUndo(): boolean { return !!this.past.length; } get canRedo(): boolean { return !!this.future.length; }
}

