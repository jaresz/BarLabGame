import { boundary, canonical, cloneProject, fromKey, key, nodes, normalizeProject, pointOnMember, validateMember, type Beam, type Material, type Member, type Point, type Project } from './model';
import { transformFragment, type Fragment, type FragmentPlacement } from './fragment';

/** Snapshot explicit members and connections between explicitly selected nodes. */
export function copySelection(project: Project, selection: readonly Selection[]): Fragment | null {
  const explicit = new Set(selection.flatMap(s => 'node' in s ? [s.node] : []));
  const include = (material: Material, m: Member) => memberSelected([...selection],material,m)
    || (explicit.has(key([m[0],m[1]])) && explicit.has(key([m[2],m[3]])));
  const beams = project.beams.filter(b => include('beam',b.endpoints)), ropes = project.ropes.filter(m => include('rope',m.endpoints));
  const active = [...nodes({...project,beams,ropes}).values()];
  if (!active.length) return null;
  const left = Math.min(...active.map(p => p[0])), top = Math.min(...active.map(p => p[1]));
  // Local offsets remove the board position, so repeated pastes and reflections
  // never accumulate rounding or depend on later edits to the original geometry.
  const local = (m: Member): Member => [m[0]-left,m[1]-top,m[2]-left,m[3]-top];
  return {size:[Math.max(...active.map(p => p[0]))-left,Math.max(...active.map(p => p[1]))-top],
    beams:beams.map(b => ({endpoints:local(b.endpoints),profile:b.profile})), ropes:ropes.map(r => ({...r,endpoints:local(r.endpoints)})),
    nodes:active.map(p => ({point:[p[0]-left,p[1]-top],joint:project.joints[key(p)] ?? 'x',
      support:boundary(p,project.size) ? project.anchors[key(p)] ?? 'x' : null}))};
}

/** Follow copied spans through normalization without selecting unrelated connections. */
export function pastedSelection(project: Project, fragment: Fragment, placement: FragmentPlacement): Selection[] {
  const transformed = transformFragment(fragment,placement);
  return translatedSelection(project,[...transformed.nodes.map(n => ({node:key(n.point)})),
    ...transformed.beams.map(b => ({material:'beam' as const,endpoints:b.endpoints})),
    ...transformed.ropes.map(r => ({material:'rope' as const,endpoints:r.endpoints}))],[0,0]);
}

export type Selection = { node: string } | { material: Material; endpoints: Member };
export const selectionKey = (s: Selection): string => 'node' in s ? `node:${s.node}` : `${s.material}:${canonical(s.endpoints).join(',')}`;
export const memberSelected = (selection: Selection[], material: Material, endpoints: Member): boolean => selection.some(s => selectionKey(s) === selectionKey({ material, endpoints }));

/** Resolve explicit nodes and both ends of selected members into unique grid points. */
export function selectionNodes(selection: readonly Selection[]): Point[] {
  const points = new Map<string, Point>();
  for (const item of selection) {
    const endpoints: Point[] = 'node' in item ? [fromKey(item.node)]
      : [[item.endpoints[0],item.endpoints[1]],[item.endpoints[2],item.endpoints[3]]];
    for (const point of endpoints) points.set(key(point),point);
  }
  return [...points.values()];
}

/** Member endpoints are handles for their selected group, even without node entries. */
export function selectionContains(selection: readonly Selection[], hit: Selection): boolean {
  return selection.some(item => selectionKey(item) === selectionKey(hit))
    || ('node' in hit && selectionNodes(selection).some(p => key(p) === hit.node));
}

export function translatedSelection(project: Project, selection: readonly Selection[], delta: Point): Selection[] {
  const active = nodes(project), result = new Map<string, Selection>();
  const add = (item: Selection) => result.set(selectionKey(item),item);
  // Rebuild only the original selection, not every member stretched by the move.
  // Normalization may split a translated beam after replacing a stationary span.
  for (const item of selection) {
    if ('node' in item) {
      const p = fromKey(item.node), id = key([p[0]+delta[0],p[1]+delta[1]]);
      if (active.has(id)) add({node:id});
    } else {
      const span = item.endpoints.map((v,i) => v+delta[i%2]) as Member;
      const members = item.material === 'beam' ? project.beams.map(b => b.endpoints) : project.ropes.map(r => r.endpoints);
      for (const endpoints of members) {
        const matches = item.material === 'beam'
          ? pointOnMember([endpoints[0],endpoints[1]],span) && pointOnMember([endpoints[2],endpoints[3]],span)
          : canonical(endpoints).join(',') === canonical(span).join(',');
        if (matches) add({material:item.material,endpoints});
      }
    }
  }
  return [...result.values()];
}

export function rectangleSelection(project: Project, a: Point, b: Point): Selection[] {
  const contains = (p: Point) => p[0] >= Math.min(a[0], b[0]) - 1e-8 && p[0] <= Math.max(a[0], b[0]) + 1e-8 && p[1] >= Math.min(a[1], b[1]) - 1e-8 && p[1] <= Math.max(a[1], b[1]) + 1e-8;
  const result: Selection[] = [...nodes(project)].filter(([, p]) => contains(p)).map(([node]) => ({ node }));
  for (const [material, list] of [['beam', project.beams.map(b => b.endpoints)], ['rope', project.ropes.map(r => r.endpoints)]] as const) {
    for (const endpoints of list) if (contains([endpoints[0], endpoints[1]]) && contains([endpoints[2], endpoints[3]])) result.push({ material, endpoints });
  }
  return result;
}
export function deletionTargets(project: Project, selection: Selection[]): Selection[] {
  const selectedNodes = new Set(selection.filter(s => 'node' in s).map(s => s.node));
  const result: Selection[] = [];
  for (const [material, list] of [['beam', project.beams.map(b => b.endpoints)], ['rope', project.ropes.map(r => r.endpoints)]] as const) {
    for (const endpoints of list) if (memberSelected(selection, material, endpoints) || selectedNodes.has(key([endpoints[0], endpoints[1]])) || selectedNodes.has(key([endpoints[2], endpoints[3]]))) result.push({ material, endpoints });
  }
  return result;
}
export function removeSelection(project: Project, selection: Selection[]): Project {
  const p = cloneProject(project), targets = deletionTargets(p, selection);
  p.beams = p.beams.filter(b => !memberSelected(targets, 'beam', b.endpoints));
  p.ropes = p.ropes.filter(m => !memberSelected(targets, 'rope', m.endpoints));

  const selectedNodes = new Map<string, Beam[]>();
  for (const item of selection) if ('node' in item) selectedNodes.set(item.node, []);
  if (!selectedNodes.size) return normalizeProject(p);

  const endpointKeys = ([ax, ay, bx, by]: Member) => [key([ax, ay]), key([bx, by])];
  const ropeNodes = new Set(project.ropes.flatMap(r => endpointKeys(r.endpoints)));
  for (const beam of project.beams) {
    for (const id of endpointKeys(beam.endpoints)) selectedNodes.get(id)?.push(beam);
  }

  const visited = new Set<string>();
  for (const start of selectedNodes.keys()) {
    if (visited.has(start)) continue;
    const pending = [start], beams = new Set<Beam>(), ends: Point[] = [];
    let mergeable = true;
    visited.add(start);
    while (pending.length) {
      const id = pending.pop()!;
      const incident = selectedNodes.get(id)!;
      const point = fromKey(id);
      if (incident.length !== 2 || ropeNodes.has(id) || boundary(point, project.size)) {
        mergeable = false;
      } else {
        const [a, b] = incident.map(beam => fromKey(endpointKeys(beam.endpoints).find(end => end !== id)!));
        if (!pointOnMember(point, [...a, ...b], true)) mergeable = false;
      }
      for (const beam of incident) {
        if (beams.has(beam)) continue;
        beams.add(beam);
        const other = endpointKeys(beam.endpoints).find(end => end !== id)!;
        if (!selectedNodes.has(other)) ends.push(fromKey(other));
        else if (!visited.has(other)) {
          visited.add(other);
          pending.push(other);
        }
      }
    }

    if (!mergeable || ends.length !== 2) continue;
    const profile = beams.values().next().value!.profile;
    if ([...beams].some(beam => beam.profile !== profile || memberSelected(selection, 'beam', beam.endpoints))) continue;
    const endpoints: Member = [...ends[0], ...ends[1]];
    if (!validateMember(p, 'beam', endpoints)) p.beams.push({ endpoints, profile });
  }
  return normalizeProject(p);
}
