import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyProject, exportProject, importProject, MAX_LENGTH, length } from '../src/model';
import { example } from '../src/examples';
import { DT, World, type PhysicsOptions, type SoundEvent } from '../src/physics';
import { serpentineMemberOrder } from '../src/solver-strategies';

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
    for (const rope of project.ropes) assert.ok(length(rope.endpoints) <= MAX_LENGTH.rope, `${name}: rope length`);

    // Serpentine randomly chooses its starting side in the app, so both directions
    // need independent runs. The other solvers have a single deterministic order.
    for (const [solver, serpentineFromRight] of [['original', false], ['serpentine', false], ['serpentine', true]] as const) {
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
  // Keep the historical solver-bias fixtures exactly aligned; startup
  // imperfections are exercised independently below rather than changing them.
  const world = new World(project, { initialPerturbation: 0, ...options });
  const top: number[] = [], support: number[] = [];
  // The solver uses top-left coordinates (Y down). Exported (0,5) is (6,1),
  // and the bottom clamp at exported (0,-6) is (6,12). A joint has multiple rendering
  // samples of one physical particle; track all samples to verify their layout.
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

// Exact translations remove joint opening, but angular XPBD corrections still
// have finite-iteration order sensitivity. Keep reproducibility and convergence
// checks without requiring the historical 0.4.53 direction or collapse time.
test('Shared-particle tower trajectories are repeatable and JSON row order is normalized', () => {
  const reordered = JSON.parse(symmetricTowerText);
  reordered.objects.b.reverse(); delete reordered.checksum;
  const first = runSymmetricTower(), repeat = runSymmetricTower({}, false, JSON.stringify(reordered));
  assert.deepEqual(first.world.project, repeat.world.project);
  assert.deepEqual(first.world.x, repeat.world.x);
  assert.deepEqual(first.world.y, repeat.world.y);
});

test('Higher iteration count still reduces angular solver drift with exact translational joints', () => {
  const standard = runSymmetricTower(), accurate = runSymmetricTower({ iterations: 192 });
  assert.ok(Math.abs(accurate.offsetAtTenSeconds) < 0.05);
  assert.ok(Math.abs(accurate.offsetAtTenSeconds) < Math.abs(standard.offsetAtTenSeconds));
  assert.ok(standard.world.members.every(m => !m.broken));
});

test('Explicit Basic XPBD matches the default with shared particles', () => {
  const implicit = runSymmetricTower(), explicit = runSymmetricTower({ solver: 'original' });
  assert.deepEqual(implicit.world.x, explicit.world.x);
  assert.deepEqual(implicit.world.y, explicit.world.y);
  assert.deepEqual(implicit.world.frame().stresses, explicit.world.frame().stresses);
});

test('Startup imperfection preserves supports, coincident particles, design and repeatability', () => {
  const project = importProject(JSON.stringify({
    metadata: { size: [16,20], gameVersion: '0.4.75', formatVersion: 3 },
    objects: { b: [[-4,-10,0,-6,'l'],[0,6,0,0,'l'],[0,0,0,-6,'l'],[0,-6,0,-10,'l'],[0,-6,4,-10,'l']] },
  }));
  const before = exportProject(project), aligned = new World(project, { initialPerturbation: 0 });
  const first = new World(project), repeat = new World(project);
  const opposite = new World(project, { initialPerturbation: -0.001 });
  const copies = new Map<string, number>();
  // Compare copies by their unperturbed coordinates, including multi-beam joints
  // and the two particles of each midpoint weld. Offsets must never open a gap.
  for (let i = 0; i < first.x.length; i++) {
    const id = `${aligned.x[i]},${aligned.y[i]}`, offset = first.x[i] - aligned.x[i];
    assert.ok(Math.abs(offset) <= 0.001 + 1e-14);
    assert.ok(Math.abs(opposite.x[i] - aligned.x[i] + offset) < 1e-14);
    if (copies.has(id)) assert.equal(first.x[i], copies.get(id));
    copies.set(id, first.x[i]);
    if (aligned.invMass[i] === 0) assert.equal(first.x[i], aligned.x[i]);
    assert.equal(first.y[i], aligned.y[i]);
    assert.equal(first.vx[i], 0);
    assert.equal(first.vy[i], 0);
  }
  assert.notDeepEqual(first.x, aligned.x);
  assert.deepEqual(first.x, repeat.x);
  assert.equal(exportProject(project), before, 'Simulation offsets must not modify exported geometry');
  assert.equal(first.options.iterations, 12);
  for (let step = 0; step < 120; step++) { first.step(); repeat.step(); }
  assert.deepEqual(first.x, repeat.x);
  assert.deepEqual(first.y, repeat.y);
  for (let i = 0; i < first.x.length; i++) if (aligned.invMass[i] === 0) {
    assert.equal(first.x[i], aligned.x[i]);
    assert.equal(first.y[i], aligned.y[i]);
  }
});

test('A perfectly vertical slender column responds to either sign of startup imperfection', () => {
  const project = importProject(JSON.stringify({
    metadata: { size: [16,20], gameVersion: '0.4.75', formatVersion: 3 },
    objects: { b: [[0,6,0,0,'l'],[0,0,0,-6,'l'],[0,-6,0,-10,'l']] },
  }));
  // Include both scan directions and Basic XPBD so the imperfection is independent
  // of Serpentine's randomly selected correction order.
  for (const solver of ['original', 'serpentine'] as const) for (const right of [false,true]) {
    const worlds = [0,0.001,-0.001].map(initialPerturbation => new World(project, { solver, serpentineFromRight:right, initialPerturbation }));
    for (let step = 0; step < 3600; step++) for (const world of worlds) world.step();
    const displacement = (world: World) => Math.max(...world.x.map(x => Math.abs(x - 8)));
    assert.equal(displacement(worlds[0]), 0, 'The control reproduces exact vertical symmetry');
    for (const world of worlds.slice(1)) {
      assert.ok(displacement(world) > 1, 'A tiny imperfection must expose growing lateral motion');
      assert.ok([...world.x,...world.y].every(Number.isFinite));
    }
  }
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
  for (const world of [left.world, right.world]) for (let i = 0; i < world.x.length; i++) {
    assert.equal(world.x[i], world.x[world.particleIds[i]], 'Every joint sample must use its common particle');
    assert.equal(world.y[i], world.y[world.particleIds[i]]);
  }
});

test('Impact sounds identify material and surface, then stop at rest', () => {
  for (const material of ['beam', 'rope'] as const) {
    const project = emptyProject();
    if (material === 'beam') project.beams.push({ endpoints: [3, 6, 5, 6], profile: 's' });
    else project.ropes.push({endpoints:[3, 6, 5, 6],profile:'s'});
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
    else project.ropes.push({endpoints:[3, 4, 5, 4],profile:'s'});
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

test('Stress beds summarize count, length and load by material and stereo zone', () => {
  const project = emptyProject(); project.size = [12, 8];
  project.beams.push({ endpoints: [1, 2, 2, 2], profile: 's' }, { endpoints: [1, 3, 5, 3], profile: 's' });
  project.ropes.push({endpoints:[8, 2, 12, 2],profile:'s'});
  const world = new World(project);
  world.members[0].stress = .5; world.members[1].stress = .9; world.members[2].stress = .7;
  const beds = world.stressBeds();
  const beams = beds.find(bed => bed.material === 'beam' && bed.zone === 0)!;
  const rope = beds.find(bed => bed.material === 'rope' && bed.zone === 2)!;
  assert.equal(beds.length, 2);
  assert.equal(beams.count, 2); assert.ok(beams.load > 0 && beams.length > 1 && beams.length < 4);
  assert.ok(beams.stress > .5 && beams.stress < .9 && beams.x > 1 && beams.x < 5);
  assert.equal(rope.count, 1); assert.equal(rope.length, 4);
  world.members[1].broken = true;
  assert.equal(world.stressBeds().find(bed => bed.material === 'beam')?.count, 1, 'Broken steel leaves the load bed');
});

test('Dense stressed structures still produce at most six bed controls', () => {
  const project = emptyProject();
  for (let index = 0; index < 120; index++) {
    const x = 1 + index % 12;
    if (index % 2) project.beams.push({ endpoints: [x, 3, x + 1, 3], profile: 's' });
    else project.ropes.push({endpoints:[x, 5, x + 1, 5],profile:'s'});
  }
  const world = new World(project);
  for (const member of world.members) member.stress = .8;
  assert.ok(world.stressBeds().length <= 6);
  assert.equal(world.stressBeds().reduce((sum, bed) => sum + bed.count, 0), 120);
});

test('Ordinary supported steel and cable loads reach the quiet tension bed', () => {
  const project = emptyProject();
  project.beams.push({ endpoints: [4, 6, 8, 6], profile: 's' });
  project.ropes.push({endpoints:[4, 0, 4, 6],profile:'s'}, {endpoints:[8, 0, 8, 6],profile:'s'});
  const world = new World(project);
  for (let step = 0; step < 240; step++) world.step();
  const beds = world.stressBeds();
  assert.ok(beds.some(bed => bed.material === 'rope'), 'A hanging cable is audible below failure-level stress');
  const beam = new World({ ...emptyProject(), beams: [{ endpoints: [0, 2, 6, 2], profile: 'l' }] });
  for (let step = 0; step < 120; step++) beam.step();
  assert.ok(beam.stressBeds().some(bed => bed.material === 'beam'), 'A flexing cantilever has a quiet bed');
});

// Compare equal geometry so only cross-sectional area changes; compression must
// remain slack for both profiles, with no added bending constraints.
test('Heavy rope scales density and axial rigidity without changing failure strain or tension-only behavior', () => {
 const worlds=(['s','h'] as const).map(profile => {
  const p=emptyProject();p.ropes=[{endpoints:[4,4,8,4],profile}];
  return new World(p,{gravity:0,initialPerturbation:0});
 });
 const [standard,heavy]=worlds;
 assert.ok(Math.abs([...standard.mass].reduce((a,b)=>a+b,0)-4*.22)<1e-12);
 for(const c of standard.distances)if(c.rest>0)assert.equal(c.compliance,c.rest/80000);
 assert.equal(heavy.angles.length,0);
 for(let i=0;i<standard.mass.length;i++) assert.equal(heavy.mass[i],4*standard.mass[i]);
 const a=standard.distances.filter(c=>c.rest>0),b=heavy.distances.filter(c=>c.rest>0);
 for(let i=0;i<a.length;i++){assert.equal(b[i].compliance,a[i].compliance/4);assert.equal(b[i].tension,true);}
 for(const w of worlds){
  const original=[...w.x];for(let i=0;i<w.x.length;i++)w.x[i]=4+(w.x[i]-4)*.8;
  w.step();assert.equal(w.members[0].stress,0);
  for(let i=0;i<w.x.length;i++)assert.ok(Math.abs(w.x[i]-(4+(original[i]-4)*.8))<1e-12);
  for(let i=0;i<w.x.length;i++)w.x[i]=4+(original[i]-4)*1.12;
  // Damage measures elastic strain independently of EA and ignores compression.
  (w as unknown as {measureDamage():void}).measureDamage();
  assert.ok(Math.abs(w.members[0].stress-1.2)<1e-10);
 }
});

// Unequal incident profiles make accidental averaging or repeated integration
// observable: a joint must sum masses and receive gravity exactly once.
function sharedJointProject() {
  const p = emptyProject();
  p.beams = [{ endpoints: [2,4,6,4], profile: 'l' }, { endpoints: [6,4,9,6], profile: 'h' }];
  p.ropes = [{ endpoints: [6,4,6,7], profile: 'h' }];
  return p;
}

test('Mixed beam/rope joints sum masses and integrate once, including at hinges', () => {
  for (const hinge of [false, true]) {
    const p = sharedJointProject(); if (hinge) p.joints['6,4'] = 'o';
    const w = new World(p, { initialPerturbation: 0, iterations: 0 });
    const samples = [w.members[0].start + w.members[0].count - 1, w.members[1].start, w.members[2].start];
    const id = w.particleIds[samples[0]], mass = samples.reduce((sum, i) => sum + w.mass[i], 0);
    for (const i of samples) {
      assert.equal(w.particleIds[i], id);
      assert.ok(Math.abs(w.invMass[i] - 1 / mass) < 1e-12);
    }
    assert.equal(w.angles.filter(c => c.owner === -1).length, hinge ? 0 : 1);
    assert.ok(w.distances.every(c => c.rest > 0), 'No iterative translational welds remain');
    w.step();
    for (const i of samples) {
      assert.equal(w.vy[i], w.vy[id]);
      assert.ok(Math.abs(w.vy[i] - 9.81 * DT) < 1e-12);
      assert.equal(w.y[i], w.y[id]);
    }
    const constrained = new World(p);
    for (let step = 0; step < 120; step++) {
      constrained.step();
      for (const i of samples) {
        assert.equal(constrained.x[i], constrained.x[id]);
        assert.equal(constrained.y[i], constrained.y[id]);
      }
    }
  }
});

test('Angular correction sums gradients for the common endpoint before squaring them', () => {
  const w = new World(sharedJointProject(), { gravity: 0, initialPerturbation: 0 });
  const c = w.angles.find(c => c.owner === -1)!;
  const ids = [...new Set([c.a,c.b,c.c,c.d].map(i => w.particleIds[i]))];
  w.y[w.particleIds[c.b]] += .1;
  const angle = () => Math.atan2(w.y[w.particleIds[c.d]] - w.y[w.particleIds[c.c]], w.x[w.particleIds[c.d]] - w.x[w.particleIds[c.c]])
    - Math.atan2(w.y[w.particleIds[c.b]] - w.y[w.particleIds[c.a]], w.x[w.particleIds[c.b]] - w.x[w.particleIds[c.a]]) - c.rest;
  const wrapAngle = (v: number) => Math.atan2(Math.sin(v), Math.cos(v));
  const value = wrapAngle(angle()), epsilon = 1e-6;
  const gradients = ids.map(id => {
    const result = [];
    for (const axis of [w.x,w.y]) {
      const before = axis[id]; axis[id] = before + epsilon; const plus = angle();
      axis[id] = before - epsilon; const minus = angle(); axis[id] = before;
      result.push(wrapAngle(plus - minus) / (2 * epsilon));
    }
    return result;
  });
  const weight = ids.reduce((sum,id,i) => sum + w.invMass[id] * (gradients[i][0] ** 2 + gradients[i][1] ** 2), 0);
  const expected = ids.map((id,i) => [w.x[id] - value / weight * w.invMass[id] * gradients[i][0], w.y[id] - value / weight * w.invMass[id] * gradients[i][1]]);
  (w as unknown as { solveAngle(c: unknown): void }).solveAngle(c);
  for (const [i,id] of ids.entries()) {
    assert.ok(Math.abs(w.x[id] - expected[i][0]) < 1e-9);
    assert.ok(Math.abs(w.y[id] - expected[i][1]) < 1e-9);
  }
});

test('Cable crossings and coincident interiors do not acquire unintended joints', () => {
  const p = emptyProject();
  p.ropes = [{endpoints:[2,4,10,4],profile:'s'}, {endpoints:[6,2,6,6],profile:'s'}];
  const w = new World(p, {initialPerturbation:0});
  const midpoints = w.members.map(m => m.start + m.half - 1);
  assert.equal(w.x[midpoints[0]], w.x[midpoints[1]]);
  assert.equal(w.y[midpoints[0]], w.y[midpoints[1]]);
  assert.notEqual(w.particleIds[midpoints[0]], w.particleIds[midpoints[1]]);
});

test('Fracture splits only the midpoint and preserves mass, velocity and endpoint attachments', () => {
  for (const material of ['beam', 'rope'] as const) {
    const p = emptyProject();
    if (material === 'beam') p.beams = [{endpoints:[2,4,6,4],profile:'s'}];
    else p.ropes = [{endpoints:[2,4,6,4],profile:'s'}];
    // A second incident member verifies that breaking does not release endpoints.
    p.ropes.push({endpoints:[6,4,8,4],profile:'s'});
    const w = new World(p, {gravity:0, damping:0, iterations:0, initialPerturbation:0});
    const m = w.members[0], left = m.start + m.half - 1, right = left + 1;
    const end = m.start + m.count - 1, attached = w.members[1].start;
    const mass = w.mass.reduce((sum,m) => sum + m, 0), points = w.frame().points;
    w.x[1] += 1; w.vx.fill(.3); w.vy.fill(.4);
    for (let step = 0; step < 6; step++) w.step();
    assert.equal(m.broken, true);
    assert.notEqual(w.particleIds[left], w.particleIds[right]);
    assert.equal(w.particleIds[end], w.particleIds[attached]);
    assert.equal(w.frame().points, points + 1);
    assert.equal(w.x[left], w.x[right]); assert.equal(w.y[left], w.y[right]);
    assert.equal(w.vx[left], w.vx[right]); assert.equal(w.vy[left], w.vy[right]);
    assert.equal(w.invMass[left], 1 / w.mass[left]); assert.equal(w.invMass[right], 1 / w.mass[right]);
    assert.equal(w.mass.reduce((sum,m) => sum + m, 0), mass);
    const momentum = () => w.mass.reduce((sum,m,i) => sum + m * w.vx[i], 0);
    const before = momentum(); w.vx[right] += 1;
    const delta = w.mass[right];
    w.step();
    assert.ok(w.x[right] > w.x[left], 'Broken halves must move independently');
    assert.ok(Math.abs(momentum() - before - delta) < 1e-10);
    const frame = w.frame();
    assert.notEqual(frame.positions[2*left], frame.positions[2*right]);
    assert.equal(frame.broken[0], 1);
  }
});
