import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyProject, exportProject, importProject, MAX_LENGTH, length } from '../src/model';
import { example } from '../src/examples';
import { DT, World, type PhysicsOptions, type SoundEvent } from '../src/physics';
import { BackwardTree, serpentineMemberOrder } from '../src/solver-strategies';

const suspendedBeam = () => importProject(JSON.stringify({
 metadata: { size: [32, 18], gameVersion: '0.4.0', formatVersion: 3 },
 objects: { b: [[-14, 5, -10, 5, 's']], r: [[-14, 9, -14, 5], [-10, 9, -10, 5]], j: [[-14, 5, 'o'], [-10, 5, 'o']] },
}));

// Measure bending relative to the moving endpoints, excluding rope extension
// and rigid translation or rotation of the suspended beam.
function deflection(world: World): number {
  const m = world.members[0], a = m.start, b = a + m.count - 1;
  const dx = world.x[b] - world.x[a], dy = world.y[b] - world.y[a], length = Math.hypot(dx, dy);
  let maximum = 0;
  for (let i = a; i <= b; i++) {
    maximum = Math.max(maximum, Math.abs(dx * (world.y[i] - world.y[a]) - dy * (world.x[i] - world.x[a])) / length);
  }
  return maximum;
}

test('Four-unit beam hanging from two ropes stays nearly straight under its own weight', () => {
  const world = new World(suspendedBeam());
  let peak = 0;
  for (let i = 0; i < 2400; i++) { world.step(); peak = Math.max(peak, deflection(world)); }
  assert.ok(peak < 0.04, `Peak bending exceeded 0.04 grid units: ${peak}`);
  assert.ok(deflection(world) < 0.025, `Settled bending exceeded 0.025 grid units: ${deflection(world)}`);
  assert.ok(world.members.every(m => !m.broken), 'Its own weight must not break the supported beam or ropes');
  assert.ok([...world.x, ...world.y, ...world.vx, ...world.vy].every(Number.isFinite));
  for (const m of world.members.filter(m => m.material === 'rope')) assert.equal(world.y[m.start], 0, 'Ceiling anchors must remain fixed');
});

test('A six-unit cantilever still bends visibly and elastically returns when gravity is removed', () => {
  const p = emptyProject(); p.beams = [{ endpoints: [0, 5, 6, 5], profile: 's' }];
  const world = new World(p);
  for (let i = 0; i < 1200; i++) world.step();
  assert.ok(world.y.at(-1)! > 5.15, 'Longer cantilevers must retain visible elasticity');
  assert.ok(world.members.every(m => !m.broken));
  world.options.gravity = 0;
  for (let i = 0; i < 2400; i++) world.step();
  assert.ok(Math.abs(world.y.at(-1)! - 5) < 0.02, 'An undamaged beam must return to its original shape');
});

test('Profiles carry different mass and bend less as stiffness increases under the same tip force', () => {
  const results = [];
  for (const profile of ['l','s','h'] as const) {
    const p=emptyProject();p.beams=[{endpoints:[0,5,4,5],profile}];
    const w=new World(p,{gravity:0,damage:false}),end=w.x.length-1;
    for(let i=0;i<2400;i++){w.vy[end]+=10*w.invMass[end]/120;w.step();}
    results.push({mass:w.mass.reduce((a,b)=>a+b,0),sag:w.y[end]-5,stress:w.members[0].stress});
  }
  assert.ok(results[0].sag>results[1].sag && results[1].sag>results[2].sag);
  assert.ok(results[0].stress>results[1].stress && results[1].stress>results[2].stress);
  assert.ok(Math.abs(results[0].mass/results[1].mass-0.5)<1e-10);
  assert.ok(Math.abs(results[2].mass/results[1].mass-2)<1e-10);
});

test('Eiffel and Sydney examples stay intact in every solver for 20 simulated seconds', () => {
  for (const name of ['eiffel', 'sydneyHarbour'] as const) {
    const project = example(name);
    assert.deepEqual(importProject(exportProject(project)), project, `${name}: project text round trip`);
    for (const beam of project.beams) assert.ok(length(beam.endpoints) <= MAX_LENGTH.beam, `${name}: beam length`);
    for (const rope of project.ropes) assert.ok(length(rope) <= MAX_LENGTH.rope, `${name}: rope length`);

    // Serpentine randomly chooses its starting side in the app, so both directions
    // need independent runs. The other solvers have a single deterministic order.
    for (const [solver, serpentineFromRight] of [['original', false], ['serpentine', false], ['serpentine', true], ['backward', false]] as const) {
      const world = new World(project, { solver, serpentineFromRight });
      const initialX = Float64Array.from(world.x), initialY = Float64Array.from(world.y);
      for (let step = 0; step < Math.round(20 / DT); step++) world.step();

      const label = `${name} / ${solver}${serpentineFromRight ? ' from right' : ''}`;
      assert.ok(world.members.every(member => !member.broken), `${label}: no broken members`);
      assert.ok([...world.x, ...world.y, ...world.vx, ...world.vy].every(Number.isFinite), `${label}: finite state`);
      // Track every physics particle, including beam interiors, so a folded span
      // cannot pass just because its endpoint nodes remain near their design positions.
      let maxDisplacement = 0;
      for (let i = 0; i < world.x.length; i++) {
        maxDisplacement = Math.max(maxDisplacement, Math.hypot(world.x[i] - initialX[i], world.y[i] - initialY[i]));
      }
      assert.ok(maxDisplacement <= 2.5, `${label}: maximum displacement ${maxDisplacement} exceeds 2.5 grid units`);
    }
  }
});

const symmetricTowerText = JSON.stringify({
  metadata: { size: [12,12], gameVersion: '0.4.53', formatVersion: 3 },
  objects: { b: [[-3,0,0,5,'l'], [0,5,0,0,'l'], [0,5,3,0,'l'], [0,0,0,-6,'l']] },
  checksum: 'fnv1a32:55d881f8',
});

function runSymmetricTower(options: PhysicsOptions = {}, reverseInternalBeams = false, text = symmetricTowerText) {
  const project = importProject(text);
  // Reverse after import: normalization otherwise sorts the beams back into the same order.
  if (reverseInternalBeams) project.beams.reverse();
  const world = new World(project, options);
  const top: number[] = [], support: number[] = [];
  // The solver uses top-left coordinates (Y down). Exported (0,5) is (6,1),
  // and the bottom clamp at exported (0,-6) is (6,12). A welded node currently
  // has multiple particles; track all original copies instead of one beam's copy.
  for (let i = 0; i < world.x.length; i++) {
    if (world.x[i] === 6 && world.y[i] === 1) top.push(i);
    if (world.x[i] === 6 && world.y[i] === 12) support.push(i);
  }
  assert.ok(top.length > 0 && support.length > 0, 'Fixture must contain the top node and bottom clamp');
  const topOffset = () => top.reduce((sum,i) => sum + world.x[i], 0) / top.length - 6;
  let offsetAtFiveSeconds = 0;
  // Ten simulated seconds expose the collapse without tying measurements to wall-clock speed.
  for (let step = 1; step <= Math.round(10 / DT); step++) {
    world.step();
    if (step === Math.round(5 / DT)) offsetAtFiveSeconds = topOffset();
  }
  assert.ok([...world.x, ...world.y, ...world.vx, ...world.vy].every(Number.isFinite), 'Collapse must remain numerically finite');
  for (const i of support) {
    assert.equal(world.x[i], 6, 'The clamp must not slide horizontally');
    assert.equal(world.y[i], 12, 'The clamp must not slide vertically');
  }
  return { world, offsetAtFiveSeconds, offsetAtTenSeconds: topOffset() };
}

// Characterization of a known defect, not desired physical behavior. These tests
// deliberately pass for the current solver. Replace the bias assertions with
// symmetry/order-invariance and convergence checks when the solver is corrected.
test('Known solver bias: the symmetric tower repeatedly collapses left', () => {
  const first = runSymmetricTower(), repeat = runSymmetricTower();
  assert.ok(first.offsetAtFiveSeconds < -0.4, `Expected visible left drift at 5 s, got ${first.offsetAtFiveSeconds}`);
  assert.ok(first.offsetAtTenSeconds < -5.5, `Expected collapse toward the left boundary at 10 s, got ${first.offsetAtTenSeconds}`);
  assert.deepEqual(first.world.x, repeat.world.x, 'Identical starts reproduce every horizontal position');
  assert.deepEqual(first.world.y, repeat.world.y, 'Identical starts reproduce every vertical position');
});

test('Known solver bias: reordering JSON rows does not change the imported collapse', () => {
  const reordered = JSON.parse(symmetricTowerText);
  reordered.objects.b.reverse();
  // The checksum covers row order; omit the stale checksum for this deliberate permutation.
  delete reordered.checksum;
  const original = runSymmetricTower(), permuted = runSymmetricTower({}, false, JSON.stringify(reordered));
  assert.deepEqual(original.world.project, permuted.world.project, 'Import canonicalizes the row permutation');
  assert.deepEqual(original.world.x, permuted.world.x);
  assert.deepEqual(original.world.y, permuted.world.y);
});

test('Known solver bias: reversing internal beam order changes collapse from left to right', () => {
  const original = runSymmetricTower(), reversed = runSymmetricTower({}, true);
  // Compare unordered geometry to ensure only solver ordering changed, not the structure.
  const geometry = (world: World) => world.project.beams.map(b => JSON.stringify(b)).sort();
  assert.deepEqual(geometry(original.world), geometry(reversed.world));
  assert.ok(original.offsetAtTenSeconds < -5.5, `Original top offset: ${original.offsetAtTenSeconds}`);
  assert.ok(reversed.offsetAtFiveSeconds > 0.2, `Expected right drift at 5 s, got ${reversed.offsetAtFiveSeconds}`);
  assert.ok(reversed.offsetAtTenSeconds > 5.5, `Expected right collapse at 10 s, got ${reversed.offsetAtTenSeconds}`);
});

test('Known solver bias: increasing iterations from 12 to 192 strongly delays collapse', () => {
  const standard = runSymmetricTower(), accurate = runSymmetricTower({ iterations: 192 });
  assert.ok(Math.abs(standard.offsetAtTenSeconds) > 5.5, `Basic XPBD Solver offset: ${standard.offsetAtTenSeconds}`);
  // Broad bounds document the large sensitivity without freezing floating-point snapshots.
  assert.ok(Math.abs(accurate.offsetAtTenSeconds) < 0.05, `192-iteration offset: ${accurate.offsetAtTenSeconds}`);
});

test('Known solver bias: the symmetric tower collapses without any member breaking', () => {
  const standard = runSymmetricTower(), damageDisabled = runSymmetricTower({ damage: false });
  assert.ok(standard.world.members.every(m => !m.broken), 'The Basic XPBD Solver collapse is deformation, not fracture');
  assert.ok(standard.offsetAtTenSeconds < -5.5);
  assert.deepEqual(standard.world.x, damageDisabled.world.x, 'Disabling fracture does not change horizontal deformation');
  assert.deepEqual(standard.world.y, damageDisabled.world.y, 'Disabling fracture does not change vertical deformation');
});

test('Explicit Basic XPBD Solver matches the implicit original trajectory', () => {
  const implicit = runSymmetricTower(), explicit = runSymmetricTower({ solver: 'original' });
  // Recorded with 0.4.53 before introducing solver selection. A small coordinate
  // tolerance accommodates platform math while preserving the legacy trajectory.
  assert.ok(Math.abs(implicit.offsetAtFiveSeconds - (-0.5197413384369831)) < 1e-6);
  assert.ok(Math.abs(implicit.offsetAtTenSeconds - (-5.995179457282439)) < 1e-6);
  assert.deepEqual(implicit.world.x, explicit.world.x);
  assert.deepEqual(implicit.world.y, explicit.world.y);
  assert.deepEqual(implicit.world.frame().stresses, explicit.world.frame().stresses);
});

test('Serpentine visits the highest occupied row first and reverses each subsequent row', () => {
  const p = emptyProject();
  p.beams = [[2,2,3,2], [8,2,9,2], [2,3,3,3], [8,3,9,3]].map(endpoints => ({ endpoints: endpoints as [number,number,number,number], profile: 's' }));
  assert.deepEqual(serpentineMemberOrder(p), [0,1,3,2]);
  assert.deepEqual(serpentineMemberOrder(p,true), [1,0,2,3]);
  const tower = importProject(symmetricTowerText);
  assert.deepEqual(serpentineMemberOrder(tower), [0,1,2,3], 'Shared apex ties follow the other beam endpoint');
  assert.deepEqual(serpentineMemberOrder(tower,true), [2,1,0,3]);
});

test('Both Serpentine starting sides run with stable member IDs and fixed supports', () => {
  const left = runSymmetricTower({ solver: 'serpentine' });
  const right = runSymmetricTower({ solver: 'serpentine', serpentineFromRight: true });
  assert.deepEqual(left.world.project, right.world.project, 'Sweep order must not change export or rendering IDs');
  assert.notDeepEqual(left.world.x,right.world.x, 'The starting side must change actual solving, not just its label');
  assert.ok(left.offsetAtTenSeconds < -5.5, 'Left-first scan reproduces the left collapse');
  assert.ok(right.offsetAtTenSeconds > 5.5, 'Right-first scan must also change joint references and reverse this fixture collapse');
});

test('Backward propagation accumulates cantilever weight and lever-arm moment at the clamp', () => {
  const p = emptyProject(); p.beams = [{ endpoints: [0,5,4,5], profile: 's' }, { endpoints: [4,5,4,2], profile: 's' }];
  const w = new World(p,{solver:'backward'}), tree = new BackwardTree(w);
  tree.update();
  const root = w.members[0].start;
  const weight = w.mass.reduce((sum,m) => sum + m*w.options.gravity,0);
  const moment = w.mass.reduce((sum,m,i) => sum + m*w.options.gravity*w.x[i],0);
  assert.ok(Math.abs(tree.forces[root]-weight) < 1e-10, 'Every downstream particle contributes its weight once');
  assert.ok(Math.abs(tree.moments[root]-moment) < 1e-10, 'Moment includes each downstream horizontal lever arm');
  assert.ok(tree.stresses[0] > 0, 'Carried moment contributes to relative stress');
  w.step();
  assert.ok(w.members[0].stress > 0, 'The backward estimate reaches the simulation stress output');
});

test('Backward propagation releases hinge moments and never gives ropes compression', () => {
  const p = emptyProject(); p.beams = [{ endpoints: [0,5,4,5], profile:'s' },{ endpoints:[4,5,8,5], profile:'s' }];
  const rigid = new World(p), rigidTree = new BackwardTree(rigid); rigidTree.update();
  p.joints['4,5'] = 'o';
  const hinged = new World(p), hingedTree = new BackwardTree(hinged); hingedTree.update();
  assert.ok(hingedTree.moments[0] < rigidTree.moments[0], 'A hinge releases the outer branch bending moment');
  assert.equal(hingedTree.forces[0],rigidTree.forces[0], 'A hinge still transfers branch weight');
  // A rope rising from a floor support would require compression to carry itself.
  const ropeProject = emptyProject(); ropeProject.ropes = [[4,10,4,6]];
  const ropeWorld = new World(ropeProject), ropeTree = new BackwardTree(ropeWorld); ropeTree.update();
  assert.equal(ropeTree.stresses[0],0);
  assert.equal(ropeTree.forces[0],ropeWorld.mass[0]*ropeWorld.options.gravity, 'The floor receives no compressive rope load');
});

test('Backward propagation handles cycles, multiple supports, free components and fracture', () => {
  const p = importProject(JSON.stringify({ metadata:{size:[12,12],gameVersion:'0.4.54',formatVersion:3}, objects:{
    b:[[-6,0,-2,0,'s'],[-2,0,2,0,'s'],[2,0,6,0,'s'],[-2,0,0,3,'s'],[0,3,2,0,'s'],[-1,-3,1,-3,'l']],
  }}));
  const w = new World(p,{solver:'backward',damage:false}), tree = new BackwardTree(w);
  tree.update();
  const free = p.beams.findIndex(b => b.endpoints[1] === 9);
  assert.ok(free >= 0);
  assert.equal(tree.stresses[free],0, 'Unsupported components have no estimated static reaction');
  const reactions = [...w.invMass.keys()].filter(i => w.invMass[i] === 0).reduce((sum,i) => sum+tree.forces[i],0);
  const supportedWeight = [...w.mass.keys()].filter(i => tree.depth[i] >= 0).reduce((sum,i) => sum+w.mass[i]*w.options.gravity,0);
  assert.ok(Math.abs(reactions-supportedWeight)<1e-9, 'Multiple support paths must not duplicate the applied load');
  // Release an internal midpoint weld and rebuild the load graph before stepping.
  w.members[0].broken = true; tree.update();
  assert.ok([...tree.forces,...tree.moments,...tree.stresses].every(Number.isFinite));
  for (let step = 0; step < 240; step++) w.step();
  assert.ok([...w.x,...w.y].every(Number.isFinite), 'Cyclic and fractured structures must simulate without graph recursion or NaNs');
});

test('Impact sounds identify material and surface, then stop at rest', () => {
  for (const material of ['beam', 'rope'] as const) {
    const project = emptyProject();
    if (material === 'beam') project.beams.push({ endpoints: [3, 6, 5, 6], profile: 's' });
    else project.ropes.push([3, 6, 5, 6]);
    const world = new World(project, { gravity: 200, damage: false });
    const heard = [];
    for (let step = 0; step < 100; step++) { world.step(); heard.push(...world.drainSounds()); }
    const expected = material === 'beam' ? 'beamGround' : 'ropeGround';
    assert.ok(heard.some(event => event.kind === expected), `${material} should strike the floor`);
    assert.ok(heard.filter(event => event.kind === expected).length <= 2, 'A resting member should not repeatedly sound');
    assert.ok(heard.every(event => event.x >= 0 && event.x <= project.size[0] && event.intensity <= 1));
  }
  const project = emptyProject(); project.beams.push({ endpoints: [3, 4, 5, 4], profile: 's' });
  const world = new World(project, { gravity: 0, damage: false });
  world.vx.fill(-100);
  const heard = [];
  for (let step = 0; step < 10; step++) { world.step(); heard.push(...world.drainSounds()); }
  assert.ok(heard.some(event => event.kind === 'beamWall'), 'A moving beam should sound at the wall');
});

test('Many simultaneous contacts yield one sound per kind per worker tick', () => {
  const project = emptyProject();
  for (let x = 1; x < 15; x++) project.beams.push({ endpoints: [x, 8, x + 1, 8], profile: 's' });
  const world = new World(project, { gravity: 300, damage: false });
  let sounds: SoundEvent[] = [];
  for (let step = 0; step < 40; step++) { world.step(); sounds = world.drainSounds(); if (sounds.some(event => event.kind === 'beamGround')) break; }
  assert.equal(sounds.filter(event => event.kind === 'beamGround').length, 1);
});

test('Rising beam stress and a rope fracture emit their distinct sounds once', () => {
  for (const material of ['beam', 'rope'] as const) {
    const project = emptyProject();
    if (material === 'beam') project.beams.push({ endpoints: [3, 4, 5, 4], profile: 's' });
    else project.ropes.push([3, 4, 5, 4]);
    const world = new World(project, { gravity: 0, iterations: 0 });
    // With solver iterations disabled, this displacement stays strained long
    // enough to exercise the sound transition and the normal damage threshold.
    world.x[1] += 1;
    const heard: SoundEvent[] = [];
    for (let step = 0; step < 8; step++) { world.step(); heard.push(...world.drainSounds()); }
    const expected = material === 'beam' ? 'beamStress' : 'ropeBreak';
    assert.equal(heard.filter(event => event.kind === expected).length, 1);
  }
});
