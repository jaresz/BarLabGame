import { boundary, canonical, cloneProject, key, nodes, normalizeProject, validateMember, replaceMembers, assertUniqueMembers, type Beam, type Rope, type JointType, type Member, type Point, type Project } from './model';

/** A clipboard snapshot in local grid coordinates: x points right, y points down. */
export interface Fragment {
  size: Point;
  beams: Beam[];
  ropes: Rope[];
  nodes: { point: Point; joint: JointType; support: JointType | null }[];
}
export interface FragmentPlacement { origin: Point; flipX: boolean; flipY: boolean }

/** Reflect inside the local bounding box, then translate its top-left corner. */
export function transformFragment(fragment: Fragment, placement: FragmentPlacement): Fragment {
  const point = ([x,y]: Point): Point => [placement.origin[0] + (placement.flipX ? fragment.size[0]-x : x),
    placement.origin[1] + (placement.flipY ? fragment.size[1]-y : y)];
  const member = (m: Member): Member => canonical([...point([m[0],m[1]]),...point([m[2],m[3]])]);
  return { size: [...fragment.size], beams: fragment.beams.map(b => ({ endpoints: member(b.endpoints), profile: b.profile })),
    ropes: fragment.ropes.map(r => ({ ...r, endpoints: member(r.endpoints) })), nodes: fragment.nodes.map(n => ({...n,point:point(n.point)})) };
}

/** Build preview geometry without normalizing: invalid spans must remain visible. */
export function fragmentPreview(project: Project, fragment: Fragment, placement: FragmentPlacement): Project {
  const next = cloneProject(project), transformed = transformFragment(fragment,placement), stationary = nodes(project);
  // Resolve exact spans before drawing the preview, including cross-material
  // replacements. Invalid incoming duplicates remain visible until commit validation.
  replaceMembers(next,transformed);
  for (const node of transformed.nodes) {
    const id = key(node.point);
    if (stationary.has(id)) continue;
    if (node.joint === 'o') next.joints[id] = 'o';
    // A copied boundary support becomes an ordinary joint in the interior.
    // Interior nodes reaching the edge use the same support rule as node moves.
    if (boundary(node.point,next.size) && (node.support ?? node.joint) === 'o') next.anchors[id] = 'o';
  }
  return next;
}

/** Validate every added span before normalization splits beams at existing nodes. */
export function pasteFragment(project: Project, fragment: Fragment, placement: FragmentPlacement): { project: Project; changed: boolean } {
  if (!placement.origin.every(Number.isSafeInteger)) throw new Error('Stay inside the build area on whole grid points.');
  const transformed = transformFragment(fragment,placement);
  assertUniqueMembers(transformed);
  const checked = fragmentPreview(project,fragment,placement);
  // Validate the complete replacement result, so other incoming spans are not
  // mistaken for stationary elements that could be silently overwritten.
  for (const [material,list] of [['beam',transformed.beams],['rope',transformed.ropes]] as const) {
    for (const member of list) {
      const error = validateMember(checked,material,member.endpoints);
      if (error) throw new Error(error);
    }
  }
  const result = normalizeProject(checked);
  return { project: result, changed: JSON.stringify(result) !== JSON.stringify(normalizeProject(project)) };
}
