import { selectionNodes, selectionContains, translatedSelection, deletionTargets, memberSelected, rectangleSelection, removeSelection, selectionKey, type Selection } from '../src/selection';
import assert from 'node:assert/strict';
import test from 'node:test';
import { translateNodes, translateNodesPreview, moveBeam, moveNode, nodes, drawingEndpoint, addMember, emptyProject, exportProject, History, importProject, MAX_LENGTH, normalizeProject, projectCost, toggleNode, validateMember, type Member } from '../src/model';
import { fromCentered } from '../src/coordinates';
import { fragmentPreview, pasteFragment, transformFragment } from '../src/fragment';
import { copySelection, pastedSelection } from '../src/selection';
const document = (objects: object = {}, size = [32, 18]) => JSON.stringify({ metadata: { size, gameVersion: '0.4.0', formatVersion: 3 }, objects });

// Check which selected geometry enters the clipboard by mixing explicit members, connected
// selected nodes and an isolated selection; mutate the source afterward to prove snapshot independence.
test('Clipboard snapshots include explicit members and connections between selected nodes only', () => {
 const p=addMember(addMember(addMember(emptyProject(),'beam',[0,4,4,4],'o','h'),'rope',[4,4,6,6]),'beam',[6,6,10,6]);
 p.anchors['0,4']='x';
 const fragment=copySelection(p,[{node:'0,4'},{node:'4,4'},{material:'rope',endpoints:[4,4,6,6]},{node:'10,6'}])!;
 assert.deepEqual(fragment.size,[6,2]);
 assert.deepEqual(fragment.beams,[{endpoints:[0,0,4,0],profile:'h'}]);
 assert.deepEqual(fragment.ropes.map(r=>r.endpoints),[[4,0,6,2]]); assert.equal(fragment.nodes.length,3);
 assert.deepEqual(fragment.nodes[0],{point:[0,0],joint:'o',support:'x'});
 const snapshot=structuredClone(fragment); p.beams[0].profile='l';p.ropes[0].endpoints[0]=5;p.joints['0,4']='x';
 assert.deepEqual(fragment,snapshot,'Clipboard owns geometry and metadata, not project references');
 assert.equal(copySelection(p,[{node:'10,6'}]),null);
});

// Paste an asymmetric beam-and-rope fragment with all four reflection combinations, then compare
// exact endpoints, profiles, selection and export round trips; place it twice and exercise Undo/Redo.
test('Clipboard reflections preserve integer geometry, profiles and immutable repeated placements', () => {
 const source=addMember(addMember(emptyProject(),'beam',[2,2,6,2],'o','h'),'rope',[6,2,6,5]);
 const fragment=copySelection(source,[{material:'beam',endpoints:[2,2,6,2]},{material:'rope',endpoints:[6,2,6,5]}])!;
 const before=structuredClone(fragment);
 for (const [flipX,flipY,beam,rope] of [
  [false,false,[8,6,12,6],[12,6,12,9]], [true,false,[8,6,12,6],[8,6,8,9]],
  [false,true,[8,9,12,9],[12,6,12,9]], [true,true,[8,9,12,9],[8,6,8,9]],
 ] as const) {
  const placement={origin:[8,6] as [number,number],flipX,flipY};
  const result=pasteFragment(source,fragment,placement);
  assert.equal(result.changed,true);assert.ok(result.project.beams.some(b=>b.profile==='h' && b.endpoints.join()===beam.join()));
  assert.ok(result.project.ropes.some(r=>r.endpoints.join()===rope.join()));
  assert.equal(pastedSelection(result.project,fragment,placement).length,5);
  assert.deepEqual(fragment,before);
  assert.deepEqual(importProject(exportProject(result.project)),result.project);
 }
 const a=pasteFragment(source,fragment,{origin:[8,6],flipX:false,flipY:false}).project;
 const b=pasteFragment(a,fragment,{origin:[1,6],flipX:false,flipY:false}).project;
 assert.equal(b.beams.length,3);assert.equal(b.ropes.length,3);
 const history=new History(source);history.commit(a);history.undo();assert.deepEqual(history.project,source);history.redo();assert.deepEqual(history.project,a);
});

// Paste over an existing beam to verify no-op deduplication and stationary profile precedence,
// then paste across a rope endpoint and check that selection follows only the resulting beam segments.
test('Pasting keeps stationary metadata, deduplicates, and follows normalized beam splits', () => {
 const source=addMember(emptyProject(),'beam',[0,2,4,2],'o','h');
 const fragment=copySelection(source,[{material:'beam',endpoints:[0,2,4,2]}])!;
 const target=addMember(addMember(emptyProject(),'beam',[2,6,6,6],'x','l'),'rope',[4,6,4,8]);
 // Use a fresh unsplit duplicate to verify stationary profile precedence.
 const duplicate=addMember(emptyProject(),'beam',[2,6,6,6],'x','l');
 const placement={origin:[2,6] as [number,number],flipX:false,flipY:false};
 const noChange=pasteFragment(duplicate,fragment,placement);
 assert.equal(noChange.changed,false);assert.deepEqual(noChange.project,duplicate);
 assert.equal(pastedSelection(noChange.project,fragment,placement).length,3);
 const ropeOnly={...target,beams:[]};
 const split=pasteFragment(ropeOnly,fragment,placement).project;
 const selected=pastedSelection(split,fragment,placement);
 assert.equal(selected.filter(s=>'material' in s && s.material==='beam').length,2);
 assert.equal(selected.some(s=>'material' in s && s.material==='rope'),false);
 assert.equal(split.joints['4,6'],undefined,'Stationary midpoint retains its connection');
 assert.equal(split.joints['2,6'],'o');
});

// Copy a hinged boundary node with an independently fixed support, then paste inside, on an edge
// and onto an existing support; inspect joint and anchor maps to verify each precedence rule.
test('Copied supports become interior joints and respect stationary boundary supports', () => {
 const source=addMember(emptyProject(),'beam',[0,2,4,2],'o');source.anchors['0,2']='x';
 const fragment=copySelection(source,[{material:'beam',endpoints:[0,2,4,2]}])!;
 const inside=pasteFragment(emptyProject(),fragment,{origin:[2,4],flipX:false,flipY:false}).project;
 assert.deepEqual(inside.anchors,{});assert.equal(inside.joints['2,4'],'o');
 const edge=pasteFragment(emptyProject(),fragment,{origin:[0,4],flipX:false,flipY:false}).project;
 assert.equal(edge.anchors['0,4'],undefined,'A fixed support stays fixed despite its hinged connection');
 const flipped=pasteFragment(emptyProject(),fragment,{origin:[12,4],flipX:true,flipY:false}).project;
 assert.equal(flipped.anchors['16,4'],undefined);
 const target=addMember(emptyProject(),'rope',[0,4,0,6]);target.anchors['0,4']='o';
 const merged=pasteFragment(target,fragment,{origin:[0,4],flipX:false,flipY:false}).project;
 assert.equal(merged.anchors['0,4'],'o');assert.equal(merged.joints['0,4'],undefined);
});

// Attempt out-of-bounds, fractional, overlapping and overlength pastes; assert rejection and an
// unchanged source export, while checking that the raw preview still contains invalid geometry.
test('Invalid pastes reject atomically while raw previews retain the offending geometry', () => {
 const source=addMember(emptyProject(),'beam',[2,2,6,2]);
 const fragment=copySelection(source,[{material:'beam',endpoints:[2,2,6,2]}])!;
 const before=exportProject(source);
 assert.throws(()=>pasteFragment(source,fragment,{origin:[14,3],flipX:false,flipY:false}),/inside/);
 assert.throws(()=>pasteFragment(source,fragment,{origin:[2.5,3],flipX:false,flipY:false}),/whole grid/);
 assert.throws(()=>pasteFragment(source,fragment,{origin:[4,2],flipX:false,flipY:false}),/overlaps/);
 assert.equal(fragmentPreview(source,fragment,{origin:[14,3],flipX:false,flipY:false}).beams.length,2);
 const invalid={...fragment,beams:[{endpoints:[0,0,7,0] as Member,profile:'s' as const}]};
 assert.throws(()=>pasteFragment(source,invalid,{origin:[1,6],flipX:false,flipY:false}),/Maximum beam/);
 assert.throws(()=>pasteFragment({...source,size:[32,18]},{...fragment,beams:[],ropes:[{endpoints:[0,0,21,0],profile:'s'}]},{origin:[1,6],flipX:false,flipY:false}),/Maximum rope/);
 assert.deepEqual(transformFragment(fragment,{origin:[8,6],flipX:true,flipY:true}).nodes.map(n=>n.point),[[12,6],[8,6]]);
 assert.equal(exportProject(source),before);
});

// Resolve a selection containing explicit nodes and shared beam/rope endpoints; compare the unique
// node set and hit membership to distinguish implicit node handles from unselected members.
test('Mixed selections resolve shared nodes once and recognize implicit endpoint handles', () => {
 const selection: Selection[]=[{node:'4,4'},{material:'beam',endpoints:[2,4,4,4]},{material:'rope',endpoints:[4,4,6,4]}];
 assert.deepEqual(selectionNodes(selection).sort(),[[2,4],[4,4],[6,4]]);
 assert.equal(selectionContains(selection,{node:'2,4'}),true);
 assert.equal(selectionContains(selection,{material:'beam',endpoints:[4,4,2,4]}),true);
 assert.equal(selectionContains(selection,{material:'beam',endpoints:[4,4,6,4]}),false);
 assert.equal(selectionContains(selection,{node:'8,4'}),false);
});

// Translate a mixed selection with repeated source coordinates and compare exact member endpoints,
// metadata and costs; reverse source order and exercise export, selection rebuilding and history.
test('A mixed group translates once per node and stretches only its external connections', () => {
 let p=addMember(addMember(emptyProject(),'beam',[2,4,4,4],'o','h'),'rope',[4,4,6,4]);
 p=addMember(p,'beam',[6,4,10,4],'x','l');
 const selection: Selection[]=[{node:'4,4'},{material:'beam',endpoints:[2,4,4,4]},{material:'rope',endpoints:[4,4,6,4]}];
 const sources=selectionNodes(selection), before=exportProject(p);
 const q=translateNodes(p,[...sources,[4,4]],[1,1]);
 assert.deepEqual(q.beams,[{endpoints:[3,5,5,5],profile:'h'},{endpoints:[7,5,10,4],profile:'l'}]);
 assert.deepEqual(q.ropes.map(r=>r.endpoints),[[5,5,7,5]]); assert.deepEqual(q.joints,{'3,5':'o','5,5':'o'});
 assert.deepEqual(translateNodes(p,[...sources].reverse(),[1,1]),q,'Moving order cannot change the result');
 assert.notEqual(projectCost(q).total,projectCost(p).total); assert.equal(exportProject(p),before);
 const result=translatedSelection(q,selection,[1,1]);
 assert.equal(result.length,3); assert.equal(memberSelected(result,'beam',[7,5,10,4]),false);
 assert.deepEqual(importProject(exportProject(q)),q);
 const history=new History(p);history.commit(q);history.undo();assert.deepEqual(history.project,p);history.redo();assert.deepEqual(history.project,q);
});

// Shift a connected node group onto some of its own old coordinates; compare endpoints and joint
// maps to prove simultaneous relocation, and verify that a zero displacement leaves it unchanged.
test('Group nodes can occupy each other\'s old coordinates without accidental merges or lost settings', () => {
 const p=addMember(addMember(emptyProject(),'beam',[2,4,4,4]),'beam',[4,4,6,4]);
 p.joints['2,4']='o';p.joints['6,4']='o';
 const q=translateNodes(p,[[2,4],[4,4],[6,4]],[2,0]);
 assert.deepEqual(q.beams,[{endpoints:[4,4,6,4],profile:'s'},{endpoints:[6,4,8,4],profile:'s'}]);
 assert.deepEqual(q.joints,{'4,4':'o','8,4':'o'});
 assert.deepEqual(translateNodes(p,[[2,4],[4,4],[6,4]],[0,0]),p);
});

// Move a group attached to limit-length external members into invalid positions; assert material,
// grid, bounds and overlap errors without mutation, and inspect an out-of-bounds raw preview.
test('Group movement validates every external element and all bounds atomically', () => {
 let p=addMember(addMember({...emptyProject(),size:[32,18]},'beam',[2,4,4,4]),'rope',[4,4,24,4]);
 const ropeLimited=p;
 p=addMember(p,'beam',[2,4,2,10]);
 const sources: [number,number][]=[[2,4],[4,4]], before=exportProject(p);
 assert.throws(()=>translateNodes(p,sources,[0,-1]),/Maximum beam/);
 assert.throws(()=>translateNodes(ropeLimited,sources,[-1,0]),/Maximum rope/);
 assert.throws(()=>translateNodes(p,sources,[-3,0]),/inside/);
 assert.throws(()=>translateNodes(p,sources,[0.5,0]),/grid/);
 assert.throws(()=>translateNodes(p,[[3,3]],[1,0]),/not exist/);
 assert.equal(exportProject(p),before);
 const preview=translateNodesPreview(p,sources,[-3,0]);
 assert.ok(preview.beams.some(b=>b.endpoints[0]<0),'Invalid preview remains renderable without committing');
 const crossing=addMember(addMember(emptyProject(),'beam',[2,2,6,2]),'beam',[4,4,8,4]);
 assert.throws(()=>translateNodes(crossing,[[2,2],[6,2]],[0,2]),/overlaps/);
});

// Move a selected beam onto an existing midpoint and onto a duplicate beam; rebuild selection
// and verify that split pieces remain selected, stationary profiles win and neighbors stay excluded.
test('Translated selection follows beam splits and stationary duplicates without selecting stretched neighbors', () => {
 let p=addMember(addMember(emptyProject(),'beam',[2,2,6,2],'x','h'),'rope',[4,4,4,8]);
 const selected: Selection[]=[{material:'beam',endpoints:[2,2,6,2]}];
 const split=translateNodes(p,selectionNodes(selected),[0,2]);
 const result=translatedSelection(split,selected,[0,2]);
 assert.equal(result.length,2);assert.equal(memberSelected(result,'rope',[4,4,4,8]),false);
 assert.equal(result.every(item=>'material' in item && item.material==='beam'),true);
 p=addMember(addMember(emptyProject(),'beam',[2,2,6,2],'x','h'),'beam',[2,4,6,4],'x','l');
 const merged=translateNodes(p,selectionNodes(selected),[0,2]);
 assert.equal(merged.beams.every(b=>b.profile==='l'),true);
 assert.equal(translatedSelection(merged,[...selected,...selected],[0,2]).length,1,'Duplicate selection entries remain unique after merging');
});

// Move an explicitly selected pair of boundary nodes into the interior and back, comparing supports
// and joints; collapse a separate beam to verify that vanished nodes disappear from selection.
test('Node-only groups keep boundary support rules and drop vanished selection entries', () => {
 const p=addMember(emptyProject(),'beam',[0,2,0,6],'o');
 const selected: Selection[]=[{node:'0,2'},{node:'0,6'}];
 const q=translateNodes(p,selectionNodes(selected),[1,0]);
 assert.deepEqual(q.anchors,{});assert.deepEqual(q.joints,{'1,2':'o','1,6':'o'});
 assert.deepEqual(translateNodes(q,selectionNodes(translatedSelection(q,selected,[1,0])),[-1,0]),p);
 const single=addMember(emptyProject(),'beam',[2,2,3,2]);
 const collapsed=moveNode(single,[2,2],[3,2]);
 assert.deepEqual(translatedSelection(collapsed,[{node:'2,2'}],[1,0]),[]);
});

// Iterate over horizontal, vertical and both diagonal beam slopes with positive, negative and zero
// deltas; compare endpoint vectors, profiles, costs and round trips while preserving the source.
test('Beam translations preserve length, orientation, profile and cost in every direction', () => {
 for (const m of [[2,2,6,2],[2,2,2,6],[2,2,5,6],[2,6,5,2]] as Member[]) {
  const p=addMember(emptyProject(),'beam',m,'x','h'), before=exportProject(p);
  for (const delta of [[1,2],[-1,-1],[0,0]] as [number,number][]) {
   const q=moveBeam(p,m,delta), actual=q.beams[0].endpoints, original=p.beams[0].endpoints;
   assert.deepEqual(actual,original.map((v,i)=>v+delta[i%2]));
   assert.deepEqual([actual[2]-actual[0],actual[3]-actual[1]],[original[2]-original[0],original[3]-original[1]]);
   assert.equal(q.beams[0].profile,'h'); assert.deepEqual(projectCost(q),projectCost(p));
   assert.deepEqual(importProject(exportProject(q)),q);
  }
  assert.equal(exportProject(p),before);
 }
});

// Translate one beam in a straight chain with ropes attached to both ends; compare moved endpoints
// and stretched neighbors, then verify that one Undo/Redo restores or reapplies the whole operation.
test('Beam movement carries both endpoints and all their incident elements, not the whole straight chain', () => {
 let p=addMember(addMember(emptyProject(),'beam',[2,5,6,5]),'beam',[6,5,10,5],'x','h');
 p=addMember(addMember(p,'rope',[2,5,2,8]),'rope',[6,5,6,9]);
 const q=moveBeam(p,[2,5,6,5],[0,-1]);
 assert.deepEqual(q.beams,[{endpoints:[2,4,6,4],profile:'s'},{endpoints:[6,4,10,5],profile:'h'}]);
 assert.deepEqual(q.ropes.map(r=>r.endpoints),[[2,4,2,8],[6,4,6,9]]);
 assert.notEqual(projectCost(q).total,projectCost(p).total);
 const history=new History(p); history.commit(q); history.undo(); assert.deepEqual(history.project,p);
 history.redo(); assert.deepEqual(history.project,q);
});

// Translate a beam by its own endpoint spacing in both directions; inspect exact joint locations
// and boundary anchors to ensure its other moving endpoint is not treated as a stationary merge.
test('A translated beam can occupy its other endpoint without merging or losing joint types', () => {
 const p=addMember(emptyProject(),'beam',[2,4,4,4]); p.joints['2,4']='o';
 const q=moveBeam(p,[2,4,4,4],[2,0]);
 assert.deepEqual(q.beams,[{endpoints:[4,4,6,4],profile:'s'}]);
 assert.deepEqual(q.joints,{'4,4':'o'});
 const reverse=moveBeam(p,[4,4,2,4],[-2,0]);
 assert.deepEqual(reverse.beams,[{endpoints:[0,4,2,4],profile:'s'}]);
 assert.deepEqual(reverse.joints,{'0,4':'o'}); assert.deepEqual(reverse.anchors,{'0,4':'o'});
});

// Try moving a beam beyond its neighbors' length limits, outside the grid, by a fractional delta,
// from a nonexistent span and onto a partial overlap; assert errors and preserve the original export.
test('Beam movement rejects invalid endpoints, limits of adjacent members and partial overlaps atomically', () => {
 const beam: Member=[2,4,6,4];
 const p=addMember(addMember(emptyProject(),'beam',beam),'beam',[6,4,12,4]);
 const before=exportProject(p);
 assert.throws(()=>moveBeam(p,beam,[0,1]),/Maximum beam/);
 assert.throws(()=>moveBeam(p,beam,[-3,0]),/inside/);
 assert.throws(()=>moveBeam(p,beam,[0.5,0]),/inside/);
 assert.throws(()=>moveBeam(p,[2,4,5,4],[0,1]),/not exist/);
 assert.equal(exportProject(p),before);
 const ropes=addMember(addMember({...emptyProject(),size:[32,18]},'beam',beam),'rope',[6,4,26,4]);
 assert.throws(()=>moveBeam(ropes,beam,[0,1]),/Maximum rope/);
 const overlapping=addMember(addMember(emptyProject(),'beam',beam),'beam',[4,6,8,6]);
 assert.throws(()=>moveBeam(overlapping,beam,[0,2]),/overlaps/);
});

// Move a beam onto a stationary beam connected by two ropes; compare the collapsed/deduplicated
// result, then move a boundary beam inside and back to verify joint and support preservation.
test('Both translated endpoints merge with stationary targets and preserve their profiles and settings', () => {
 const beam: Member=[2,4,6,4];
 let p=addMember(addMember(emptyProject(),'beam',beam,'o','h'),'beam',[2,6,6,6],'x','l');
 p=addMember(addMember(p,'rope',[2,4,2,6]),'rope',[6,4,6,6]);
 const q=moveBeam(p,beam,[0,2]);
 assert.deepEqual(q.beams,[{endpoints:[2,6,6,6],profile:'l'}]);
 assert.deepEqual(q.ropes,[]); assert.deepEqual(q.joints,{});
 const source=addMember(emptyProject(),'beam',[0,2,0,6],'o');
 const interior=moveBeam(source,[0,2,0,6],[1,0]);
 assert.deepEqual(interior.anchors,{}); assert.deepEqual(interior.joints,{'1,2':'o','1,6':'o'});
 assert.deepEqual(moveBeam(interior,[1,2,1,6],[-1,0]),source);
});

// Translate a heavy beam across a stationary rope endpoint; compare the two expected beam segments
// and their profiles, and verify that the rope itself remains unchanged.
test('A translated beam is normalized into segments at stationary interior nodes', () => {
 const p=addMember(addMember(emptyProject(),'beam',[2,3,6,3],'x','h'),'rope',[4,5,4,8]);
 const q=moveBeam(p,[2,3,6,3],[0,2]);
 assert.deepEqual(q.beams,[{endpoints:[2,5,4,5],profile:'h'},{endpoints:[4,5,6,5],profile:'h'}]);
 assert.deepEqual(q.ropes,p.ropes);
});

// Move one end of a hinged beam onto a boundary rope node with a pinned support but a rigid joint;
// inspect the resulting maps to verify that the stationary support and joint win independently.
test('A single translated endpoint merges while preserving a stationary support independently of joint type', () => {
 let p=addMember(emptyProject(),'beam',[2,4,6,4],'o');
 p=addMember(p,'rope',[0,6,0,9]); p.anchors['0,6']='o';
 const q=moveBeam(p,[2,4,6,4],[-2,2]);
 assert.deepEqual(q.beams,[{endpoints:[0,6,4,6],profile:'s'}]);
 assert.deepEqual(q.joints,{'4,6':'o'}); assert.deepEqual(q.anchors,{'0,6':'o'});
 assert.deepEqual(q.ropes,p.ropes);
});

// Move a shared beam/rope node and compare all incident endpoints, joint metadata and cost;
// verify source immutability, export/import, a zero move and a single history commit with Undo/Redo.
test('Node moves carry every incident member, settings, costs and history atomically', () => {
 const p = addMember(addMember(emptyProject(), 'beam', [4,5,8,5], 'o', 'h'), 'rope', [4,5,4,9]);
 const before = exportProject(p), h = new History(p);
 const q = moveNode(p, [4,5], [5,4]);
 assert.deepEqual(q.beams, [{ endpoints:[5,4,8,5], profile:'h' }]);
 assert.deepEqual(q.ropes.map(r=>r.endpoints),[[4,9,5,4]]);
 assert.equal(q.joints['5,4'], 'o'); assert.equal(q.joints['4,5'], undefined);
 assert.notEqual(projectCost(q).total, projectCost(p).total);
 assert.equal(exportProject(p), before);
 assert.deepEqual(importProject(exportProject(q)), q);
 h.commit(q); h.undo(); assert.deepEqual(h.project,p); h.redo(); assert.deepEqual(h.project,q);
 assert.deepEqual(moveNode(p,[4,5],[4,5]),p);
});

// Move shared nodes against beam/rope length, grid, bounds and overlap constraints, including a
// beam that normalization could split; check exact-limit success and rejection before splitting.
test('Moves enforce all material limits before splitting, bounds and beam overlap', () => {
 const p=addMember(addMember({...emptyProject(),size:[32,24]},'beam',[0,5,6,5]),'rope',[6,5,26,5]);
 assert.doesNotThrow(()=>moveNode(p,[6,5],[6,5]));
 assert.throws(()=>moveNode(p,[6,5],[6,6]),/Maximum beam/);
 assert.throws(()=>moveNode(p,[6,5],[5,5]),/Maximum rope/);
 assert.throws(()=>moveNode(p,[6,5],[-1,5]),/inside/);
 assert.throws(()=>moveNode(p,[6,5],[5.5,5]),/inside/);
 assert.throws(()=>moveNode(p,[3,3],[4,4]),/not exist/);
 const diagonal=addMember({...emptyProject(),size:[32,24]},'rope',[0,0,12,15]);
 assert.doesNotThrow(()=>moveNode(diagonal,[12,15],[12,16]));
 assert.throws(()=>moveNode(diagonal,[12,15],[13,16]),/Maximum rope/);
 const split=addMember(addMember(emptyProject(),'beam',[0,5,4,5]),'rope',[6,5,6,8]);
 assert.throws(()=>moveNode(split,[4,5],[7,5]),/Maximum beam/);
 const overlap=addMember(addMember(emptyProject(),'beam',[2,3,4,3]),'beam',[3,2,5,3]);
 assert.throws(()=>moveNode(overlap,[3,2],[3,3]),/overlaps/);
});

// Merge two connected nodes in either direction and inspect beams, ropes and metadata to verify
// collapsed-member removal, duplicate elimination and stationary precedence; also collapse the last beam.
test('Merge removes collapsed members and duplicates while stationary profiles and types win', () => {
 let p=addMember(addMember(addMember(emptyProject(),'beam',[4,4,8,4],'o','h'),'beam',[4,6,8,4],'x','l'),'rope',[4,4,4,6]);
 p=addMember(addMember(p,'rope',[4,4,8,4]),'rope',[4,6,8,4]);
 const q=moveNode(p,[4,4],[4,6]);
 assert.deepEqual(q.beams,[{endpoints:[4,6,8,4],profile:'l'}]);
 assert.deepEqual(q.ropes.map(r=>r.endpoints),[[4,6,8,4]]);
 assert.equal(q.joints['4,6'],undefined);
 assert.equal(nodes(q).has('4,4'),false);
 const reverse=moveNode(p,[4,6],[4,4]);
 assert.equal(reverse.beams[0].profile,'h'); assert.equal(reverse.joints['4,4'],'o');
 assert.deepEqual(moveNode(addMember(emptyProject(),'beam',[2,2,3,2]),[2,2],[3,2]),emptyProject());
});

// Move a hinged boundary node inward and back to an edge, then onto another supported node;
// inspect anchors and joints to verify position-dependent supports and independent target precedence.
test('Boundary supports follow position; a merge preserves the target support independently of its joint', () => {
 const p=addMember(emptyProject(),'beam',[0,5,4,5],'o');
 const interior=moveNode(p,[0,5],[1,5]);
 assert.equal(interior.joints['1,5'],'o'); assert.deepEqual(interior.anchors,{});
 const edge=moveNode(interior,[1,5],[0,4]);
 assert.equal(edge.anchors['0,4'],'o'); assert.equal(edge.joints['0,4'],'o');
 const target=addMember(p,'rope',[0,3,0,5]); target.anchors['0,3']='o';
 const merged=moveNode(target,[0,5],[0,3]);
 assert.equal(merged.anchors['0,3'],'o'); assert.equal(merged.joints['0,3'],undefined);
 assert.equal(merged.anchors['0,5'],undefined);
});

// Move a rope endpoint first onto a beam and then across it; compare beam segments and node keys
// to distinguish a real endpoint connection from a crossing that must not create a joint.
test('Moving onto a beam splits it at the new node without making crossing-only joints', () => {
 const p=addMember(addMember(emptyProject(),'beam',[2,5,6,5],'x','h'),'rope',[4,2,4,4]);
 const q=moveNode(p,[4,4],[4,5]);
 assert.deepEqual(q.beams,[{endpoints:[2,5,4,5],profile:'h'},{endpoints:[4,5,6,5],profile:'h'}]);
 const crossing=moveNode(p,[4,4],[4,7]);
 assert.equal(crossing.beams.length,1); assert.equal(nodes(crossing).has('4,5'),false);
});
// Import a mixed-profile project with signed coordinates and joint/support settings, export and
// reimport it, then compare deterministic text, the format version and the exact category cost breakdown.
test('Profiles, signed coordinates, settings and cost survive deterministic round trips', () => {
 const p = importProject(document({ b: [[-6,0,0,0,'h'],[0,0,6,0,'s'],[0,0,0,4,'l']], r:[[0,4,0,9]], j:[[0,0,'o']], a:[[0,9,'o']] }));
 const text = exportProject(p); assert.deepEqual(importProject(text), p); assert.equal(exportProject(importProject(text)), text);
 assert.deepEqual(projectCost(p), { total:170, breakdown:{l:16,s:48,h:96,r:10,rh:0} });
 assert.equal(JSON.parse(text).metadata.formatVersion,4);
});
// Add a rope at the midpoint of a diagonal heavy beam; inspect split profiles and rounded beam
// cost, then attempt an identical beam with another profile to verify duplicate rejection.
test('Splitting a diagonal preserves its profile, mass length and rounded category cost', () => {
 const p = addMember(emptyProject(),'beam',[10,5,14,9],'x','h');
 const q = addMember(p,'rope',[12,7,12,10]);
 assert.deepEqual(q.beams.map(b=>b.profile), ['h','h']);
 assert.equal(projectCost(p).breakdown.h,projectCost(q).breakdown.h);
 assert.throws(()=>addMember(p,'beam',[10,5,14,9],'x','l'),/exists/);
});
// For each material, validate a span exactly at its length limit and a slightly longer diagonal;
// also check a 12-16-20 rope to confirm Euclidean rather than axis-wise validation.
test('Material length limits are 6 and 20 including diagonals and imported projects', () => {
 const p=emptyProject(); p.size=[32,24];
 for(const [material,limit] of [['beam',6],['rope',20]] as const){
  assert.equal(validateMember(p,material,[0,5,limit,5]),null);
  assert.match(validateMember(p,material,[0,5,limit,6])!,new RegExp(String(limit)));
 }
 const long=addMember(p,'rope',[0,0,12,16]);
 assert.deepEqual(importProject(exportProject(long)),long);
 assert.equal(projectCost(long).breakdown.r,40);
 assert.deepEqual(drawingEndpoint([1,5],[31,5],'rope',p.size),[21,5]);
 const overlength=JSON.parse(exportProject(long));
 delete overlength.checksum;
 overlength.objects.r=[[-10,0,10,1,'s']];
 assert.throws(()=>importProject(JSON.stringify(overlength)),/at most 20/);
 const legacy=importProject(JSON.stringify({metadata:{size:[32,24],gameVersion:'0.4.77',formatVersion:3},objects:{r:[[0,0,6,8]]}}));
 assert.deepEqual(importProject(exportProject(legacy)),legacy,'Older ten-unit ropes still round trip');
});

// Iterate over partial and contained horizontal, vertical and diagonal overlaps, reversing both
// spans and varying profiles; check validation errors, rejected additions and unchanged source exports.
test('Beam overlap is rejected before normalization in every orientation and direction', () => {
 const cases: [Member, Member][] = [
  [[10,5,14,5],[12,5,16,5]], // partial overlap
  [[10,5,14,5],[8,5,12,5]],
  [[10,5,14,5],[9,5,15,5]], // new beam contains the existing beam
  [[10,5,14,5],[11,5,13,5]], // new beam is contained in the existing beam
  [[10,5,10,9],[10,7,10,11]],
  [[10,5,10,9],[10,4,10,10]],
  [[10,5,13,8],[11,6,14,9]],
  [[10,5,12,7],[9,4,13,8]],
  [[10,9,13,6],[11,8,14,5]],
 ];
 const reverse = (m: Member): Member => [m[2],m[3],m[0],m[1]];
 for (const [existing, candidate] of cases) for (const beam of [existing, reverse(existing)]) {
  const board = emptyProject(); board.size = [32,18];
  const p = addMember(board,'beam',beam);
  const before = exportProject(p);
  for (const m of [candidate, reverse(candidate)]) {
   assert.match(validateMember(p,'beam',m)!,/overlaps/);
   for (const profile of ['l','s','h'] as const) assert.throws(()=>addMember(p,'beam',m,'o',profile),/overlaps/);
  }
  assert.equal(exportProject(p),before,'Rejected additions leave the project untouched');
 }
});

// Split a beam using a rope endpoint, then try spans covering some or all resulting segments;
// verify that both direct validation and addition still reject the shared beam intervals.
test('A beam cannot cover existing segments after splitting at a rope endpoint', () => {
 const p = addMember(addMember(emptyProject(),'beam',[10,5,14,5]),'rope',[12,5,12,8]);
 assert.equal(p.beams.length,2);
 for (const m of [[10,5,14,5],[11,5,15,5],[9,5,15,5]] as Member[]) {
  assert.match(validateMember(p,'beam',m)!,/overlaps/);
  assert.throws(()=>addMember(p,'beam',m),/overlaps/);
 }
});

// Add beams sharing only an endpoint, crossing, or running parallel to an existing beam, plus a
// rope on the same span; assert that valid contacts are accepted rather than classified as overlaps.
test('Shared endpoints, crossings, parallel beams and beam-rope overlap remain allowed', () => {
 const p = addMember(emptyProject(),'beam',[10,5,14,5]);
 for (const m of [[14,5,16,5],[8,5,10,5],[12,3,12,7],[10,6,14,6],[14,5,16,7]] as Member[]) {
  assert.equal(validateMember(p,'beam',m),null);
  assert.doesNotThrow(()=>addMember(p,'beam',m));
 }
 assert.doesNotThrow(()=>addMember(p,'rope',[10,5,14,5]));
});
// Import documents at board-size boundaries and with invalid dimensions or schema entries;
// assert accepted sizes and specific errors for legacy data, profiles, coordinates, duplicates and orphan joints.
test('Only reasonable even board sizes and the new JSON schema are accepted', () => {
 for(const size of [[12,8],[64,40],[32,18]]) assert.deepEqual(importProject(document({},size)).size,size);
 for(const size of [[11,8],[12,7],[66,40],[64,42],[31,18],[32,17]]) assert.throws(()=>importProject(document({},size)),/size/);
 assert.throws(()=>importProject('{"size":[32,18],"formatVersion":2}'),/Older formats/);
 assert.throws(()=>importProject(document({b:[[0,0,4,0]]})),/profile/);
 assert.throws(()=>importProject(document({b:[[0,0,4,0,'z']]})),/profile/);
 assert.throws(()=>importProject(document({b:[[15,0,17,0,'s']]})),/outside/);
 assert.throws(()=>importProject(document({b:[[0.5,0,4,0,'s']]})),/integers/);
 assert.throws(()=>importProject(document({b:[[0,0,4,0,'s'],[4,0,0,0,'h']]})),/Duplicate/);
 assert.throws(()=>importProject(document({j:[[0,0,'o']]})),/does not exist/);
});
// Commit profile changes, a boundary-node toggle and a clear operation to History; step through
// Undo/Redo while comparing costs and supports, and verify that normalization leaves the export stable.
test('Clear, profile change and node changes are undoable and update costs', () => {
 const p=addMember(emptyProject(),'beam',[0,5,6,5]); const h=new History(p);
 const q=structuredClone(p);q.beams[0].profile='h';h.commit(q);assert.equal(projectCost(h.project).total,96);
 h.commit(toggleNode(h.project,'0,5'));assert.equal(h.project.anchors['0,5'],'o');
 h.commit(emptyProject());assert.equal(projectCost(h.project).total,0);h.undo();assert.equal(projectCost(h.project).total,96);
 h.undo();h.undo();assert.equal(projectCost(h.project).total,48);h.redo();assert.equal(projectCost(h.project).total,96);
 assert.equal(exportProject(normalizeProject(p)),exportProject(p));
});

// Select a rectangle whose edges pass through nodes and a complete beam, then reverse its corners;
// compare selected keys and verify that merely crossing the middle of a member selects nothing.
test('Rectangle selection includes boundaries and whole members in either direction', () => {
 const p = importProject(document({ b:[[-6,0,-2,0,'s'],[-2,0,2,0,'h']], r:[[2,0,6,0]] }));
 const selected = rectangleSelection(p,[10,8],[14,9]);
 assert.equal(selected.length,3);
 assert.equal(selected.filter(s=>'material' in s).length,1);
 assert.ok(memberSelected(selected,'beam',[14,9,10,9]));
 assert.deepEqual(rectangleSelection(p,[14,9],[10,8]).map(selectionKey), selected.map(selectionKey));
 assert.equal(rectangleSelection(p,[11,8],[13,10]).length,0,'Crossing a member is insufficient');
});
// Match a reversed beam selection against reordered geometry with another profile and a coincident
// rope; verify identity by span/material and confirm that beam deletion preserves the rope.
test('Selection uses geometry and kind, independent of ordering and beam profile', () => {
 const selected: Selection[] = [{material:'beam',endpoints:[14,9,10,9]}];
 const p = importProject(document({ b:[[-6,0,-2,0,'h'],[-10,0,-8,0,'s']], r:[[-6,0,-2,0]] }));
 assert.ok(memberSelected(selected,'beam',p.beams[1].endpoints));
 assert.ok(!memberSelected(selected,'beam',p.beams[0].endpoints));
 assert.ok(!memberSelected(selected,'rope',p.ropes[0].endpoints));
 assert.equal(removeSelection(p,selected).ropes.length,1);
});
// Delete a node and an explicitly selected incident beam together; inspect deduplicated deletion
// targets, unrelated remaining geometry and cleaned metadata, then verify Undo/Redo of the whole result.
test('Deleting a mixed selection deduplicates incident members and preserves unrelated geometry', () => {
 const p = importProject(document({ b:[[-6,0,-2,0,'s'],[-2,0,2,0,'h']], r:[[-2,0,-2,4],[2,0,6,0]], j:[[-2,0,'o']] }));
 const selection: Selection[] = [{node:'14,9'},{material:'beam',endpoints:[10,9,14,9]}];
 assert.equal(deletionTargets(p,selection).length,3);
 const h = new History(p); h.commit(removeSelection(p,selection));
 assert.equal(h.project.beams.length,0); assert.equal(h.project.ropes.length,1);
 assert.deepEqual(h.project.joints,{}); h.undo(); assert.deepEqual(h.project,p);
 h.redo(); assert.equal(h.project.beams.length,0);
});

// Delete the shared node of two straight equal-profile beams; compare the merged exported span,
// remaining joint settings and unchanged cost, then verify that Undo/Redo restores both designs.
test('Deleting a node joins its two beams and is undoable', () => {
 const p = importProject(document({ b:[[-2,0,0,0,'s'],[0,0,2,0,'s']], j:[[0,0,'o'],[2,0,'o']] }, [12,8]));
 const h = new History(p);
 h.commit(removeSelection(p, [{node:'6,4'}]));
 const merged = h.project;
 assert.deepEqual(JSON.parse(exportProject(merged)).objects, { b:[[-2,0,2,0,'s']], j:[[2,0,'o']] });
 assert.equal(projectCost(merged).total, projectCost(p).total);
 assert.ok(h.undo());
 assert.deepEqual(h.project, p);
 assert.ok(h.redo());
 assert.deepEqual(h.project, merged);
});

// Delete several nodes across independent straight chains and compare merged spans in either
// selection order; repeat with an overlength chain to verify it is removed instead of joined.
test('Deleting several nodes joins independent straight chains within the current beam limit', () => {
 const limit = MAX_LENGTH.beam;
 const p = importProject(document({
  b:[[0,0,1,0,'s'],[1,0,2,0,'s'],[2,0,limit,0,'s'],[-2,-2,-1,-1,'h'],[-1,-1,0,0,'h']],
 }));
 const selection = [{node:'17,9'},{node:'18,9'},{node:'15,10'}];
 const result = removeSelection(p, selection);
 assert.deepEqual(JSON.parse(exportProject(result)).objects.b, [[-2,-2,0,0,'h'],[0,0,limit,0,'s']]);
 assert.deepEqual(removeSelection(p, selection.reverse()), result);

 const tooLong = importProject(document({ b:[[0,0,1,0,'s'],[1,0,2,0,'s'],[2,0,limit+1,0,'s']] }));
 assert.deepEqual(removeSelection(tooLong, selection).beams, []);
});

// Delete nodes with mixed profiles, bends, branches, ropes or supports, then test explicit member
// deletion and connected selections; compare remaining geometry to verify when chain joining is forbidden.
test('Ineligible connections retain the existing deletion behavior', () => {
 const cases = [
  { b:[[-2,0,0,0,'s'],[0,0,2,0,'h']] },
  { b:[[-2,0,0,0,'s'],[0,0,2,1,'s']] },
  { b:[[-2,0,0,0,'s'],[0,0,2,0,'s'],[0,0,0,2,'s']] },
  { b:[[-2,0,0,0,'s'],[0,0,2,0,'s']], r:[[0,0,0,2]] },
  { b:[[-2,9,0,9,'s'],[0,9,2,9,'s']], a:[[0,9,'o']] },
 ];
 for (const objects of cases) {
  const p = importProject(document(objects));
  const node = fromCentered([0, objects.a ? 9 : 0], p.size).join(',');
  assert.deepEqual(JSON.parse(exportProject(removeSelection(p, [{node}]))).objects, {});
 }
 const p = importProject(document({ b:[[-2,0,0,0,'s'],[0,0,2,0,'s'],[2,0,4,0,'s']] }));
 assert.deepEqual(removeSelection(p, [
  {node:'16,9'}, {node:'18,9'}, {material:'beam',endpoints:p.beams[0].endpoints},
 ]).beams, []);
 assert.deepEqual(removeSelection(p, [{node:'16,9'}, {node:'14,9'}]).beams, [p.beams[2]]);
});


// Sweep both materials, central/corner starts and targets inside and outside the board; independently
// enumerate eligible integer endpoints and rank them by projection error, length and coordinate tie-breaks.
test('Drawing endpoints shorten to the closest eligible grid point in every direction', () => {
 for (const material of ['beam', 'rope'] as const) {
  const limit = MAX_LENGTH[material];
  for (const start of [[16,9], [0,0], [32,18]] as [number,number][]) {
   for (let x = -5; x <= 37; x++) for (let y = -5; y <= 23; y++) {
    const target: [number,number] = [x,y], distance = Math.hypot(x-start[0],y-start[1]);
    const end = drawingEndpoint(start,target,material,[32,18]);
    if (distance <= limit) { assert.deepEqual(end,target); continue; }
    const ideal = [start[0]+(x-start[0])*limit/distance,start[1]+(y-start[1])*limit/distance];
    const candidates: {point:[number,number]; error:number; length:number}[] = [];
    for(let a=0;a<=32;a++) for(let b=0;b<=18;b++) {
     const length=(a-start[0])**2+(b-start[1])**2;
     if(length && length<=limit**2) candidates.push({point:[a,b],error:(a-ideal[0])**2+(b-ideal[1])**2,length});
    }
    candidates.sort((a,b)=>Math.abs(a.error-b.error)>1e-8 ? a.error-b.error : b.length-a.length || a.point[0]-b.point[0] || a.point[1]-b.point[1]);
    assert.deepEqual(end,candidates[0].point);
   }
  }
  assert.deepEqual(drawingEndpoint([0,9],[32,9],material,[32,18]),[limit,9]);
  assert.deepEqual(drawingEndpoint([16,9],[16,9],material,[32,18]),[16,9]);
 }
 assert.deepEqual(drawingEndpoint([0,0],[20,7],'beam',[32,18]),[5,2]);
 assert.deepEqual(drawingEndpoint([0,0],[6,8],'rope',[32,18]),[6,8]);
});

// Typed ropes must survive every editing path, including duplicate precedence.
test('Rope profiles retain prices, format compatibility, clipboard metadata and history', () => {
 const p=addMember(emptyProject(),'rope',[2,2,6,2],'x','h');
 assert.equal(projectCost(p).total,32); assert.equal(projectCost(p).breakdown.rh,32);
 const text=exportProject(p), data=JSON.parse(text);
 assert.equal(data.metadata.formatVersion,4); assert.equal(data.objects.r[0][4],'h');
 assert.deepEqual(importProject(text),p);
 for(const invalid of ['l','z',null]) {
  data.objects.r[0][4]=invalid;
  assert.throws(()=>importProject(JSON.stringify(data)),/Rope profile/);
 }
 data.objects.r[0]=data.objects.r[0].slice(0,4);
 assert.throws(()=>importProject(JSON.stringify(data)),/coordinates/);
 data.metadata.formatVersion=3;
 assert.equal(importProject(JSON.stringify(data)).ropes[0].profile,'s');
 const moved=translateNodes(p,[[2,2],[6,2]],[1,1]);
 assert.equal(moved.ropes[0].profile,'h');
 const fragment=copySelection(p,[{material:'rope',endpoints:[2,2,6,2]}])!;
 const pasted=pasteFragment(p,fragment,{origin:[2,5],flipX:true,flipY:true}).project;
 assert.ok(pasted.ropes.every(r=>r.profile==='h'));
 const stationary=addMember(p,'rope',[2,5,6,5],'x','s');
 assert.equal(pasteFragment(stationary,fragment,{origin:[2,5],flipX:false,flipY:false}).project.ropes.find(r=>r.endpoints[1]===5)!.profile,'s');
 const merged=translateNodes(stationary,[[2,2],[6,2]],[0,3]);
 assert.deepEqual(merged.ropes,[{endpoints:[2,5,6,5],profile:'s'}]);
 const h=new History(p);h.commit(merged);h.undo();assert.equal(h.project.ropes[0].profile,'h');h.redo();assert.equal(h.project.ropes[0].profile,'s');
});
