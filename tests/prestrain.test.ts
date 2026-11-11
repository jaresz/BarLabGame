import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyProject, exportProject, ROPE_PROFILES, type RopeProfile } from '../src/model';
import { DT, World } from '../src/physics';
import { experimentNames, experimentProject, initialRopes, rankScreens, ropeGroups, type Screen } from '../scripts/measure-prestrain';
import { measureProject } from '../scripts/measure-landmarks';

function cable(profile: RopeProfile = 's', mountedLength = 4) {
  const project = emptyProject(); project.size = [32, 18];
  project.ropes = [{ endpoints: [4, 4, 4 + mountedLength, 4], profile }];
  return project;
}

test('Prestrain validates every rope entry, including sparse arrays, and owns its settings', () => {
  const p = cable();
  for (const value of [[], [0, 0], [-.001], [.010001], [NaN], [Infinity], new Array(1), ['0'], null, .005, new Float64Array([0])]) {
    assert.throws(() => new World(p, { ropePrestrain: value as readonly number[] }));
  }
  const strains = [.005], w = new World(p, { ropePrestrain: strains }); strains[0] = .01;
  assert.deepEqual(w.options.ropePrestrain, [.005]);
  assert.doesNotThrow(() => new World(p, { ropePrestrain: [0] }));
  assert.doesNotThrow(() => new World(p, { ropePrestrain: [.01] }));
  assert.doesNotThrow(() => new World(emptyProject(), { ropePrestrain: [] }));
});

test('Natural length determines mass, compliance, mounted force and elastic energy', () => {
  const epsilon = .005, length = 20, natural = length / (1 + epsilon);
  for (const profile of ['s', 'h'] as const) {
    const p = cable(profile, length), design = exportProject(p);
    const w = new World(p, { ropePrestrain: [epsilon], initialPerturbation: 0 });
    const ea = 80000 * ROPE_PROFILES[profile].axial;
    let rest = 0, energy = 0;
    // Each axial segment stores its share of natural length and energy; a
    // discretized cable must not multiply the prescribed whole-member strain.
    for (const c of w.distances) {
      const extension = Math.hypot(w.x[c.b] - w.x[c.a], w.y[c.b] - w.y[c.a]) - c.rest;
      rest += c.rest; energy += .5 * extension ** 2 / c.compliance;
      assert.equal(c.compliance, c.rest / ea);
      assert.ok(Math.abs(extension / c.compliance - ea * epsilon) < 1e-8);
      assert.equal(c.tension, true);
    }
    assert.ok(Math.abs(rest - natural) < 1e-12);
    assert.ok(Math.abs(w.mass.reduce((a,b) => a+b, 0) - .22 * ROPE_PROFILES[profile].mass * natural) < 1e-12);
    assert.ok(Math.abs(energy - .5 * ea * epsilon ** 2 * natural) < 1e-10);
    assert.ok(Math.abs(w.members[0].stress - epsilon / .10) < 1e-12);
    assert.equal(w.members[0].overload, 0, 't=0 must not advance the damage clock');
    assert.ok(w.vx.every(v => v === 0) && w.vy.every(v => v === 0));
    assert.equal(w.angles.length, 0);
    assert.equal(exportProject(p), design, 'Diagnostic prestrain must not enter project data');
  }
});

test('Rest lengths precede perturbation, and shared nodes sum the new mass contributions', () => {
  const p = cable();
  p.beams = [{ endpoints: [8,4,10,6], profile: 'h' }];
  const plain = new World(p, { initialPerturbation: 0, ropePrestrain: [.005] });
  const perturbed = new World(p, { initialPerturbation: -.001, ropePrestrain: [.005] });
  assert.deepEqual(plain.distances, perturbed.distances);
  assert.deepEqual(plain.mass, perturbed.mass);
  assert.notDeepEqual(plain.x, perturbed.x);
  const end = plain.members[1].start + plain.members[1].count - 1, beam = plain.members[0].start;
  assert.equal(plain.particleIds[end], plain.particleIds[beam]);
  assert.equal(plain.invMass[end], 1 / (plain.mass[end] + plain.mass[beam]));
});

test('A prestrained cable can go slack and never supplies compression', () => {
  const p = cable(), w = new World(p, { gravity: 0, initialPerturbation: 0, ropePrestrain: [.005] });
  // Shorten every sample enough to unload even the shorter natural segments.
  for (let i = 0; i < w.x.length; i++) w.x[i] = 4 + (w.x[i] - 4) * .9;
  const x = w.x.slice(); w.step();
  assert.deepEqual(w.x, x);
  assert.equal(w.members[0].stress, 0);
  assert.ok(w.distances.every(c => c.lambda === 0));
});

test('Prestrain pulls movable attachments immediately and conserves free-cable momentum', () => {
  const w = new World(cable(), { gravity: 0, damping: 0, initialPerturbation: 0, ropePrestrain: [.01] });
  const end = w.x.length - 1;
  w.step();
  assert.ok(w.x[0] > 4 && w.x[end] < 8, 'The first step must transmit a real pulling force');
  for (let step = 0; step < 119; step++) w.step();
  const momentum = w.mass.reduce((sum,m,i) => sum + m * w.vx[i], 0);
  assert.ok(Math.abs(momentum) < 1e-9);
});

test('Prestrain reduces transverse sag under gravity without adding bending stiffness', () => {
  const peaks = [];
  for (const epsilon of [0, .005, .01]) {
    const p = emptyProject(); p.size = [20,10];
    p.ropes = [{ endpoints: [0,4,20,4], profile: 's' }];
    const w = new World(p, { ropePrestrain: [epsilon] });
    let peak = 0;
    // Compare the entire four-second transient under identical gravity and
    // damping, rather than selecting a favorable frame of an oscillating rope.
    for (let step = 0; step < 480; step++) {
      w.step();
      for (const y of w.y) peak = Math.max(peak, y - 4);
    }
    peaks.push(peak);
    assert.equal(w.angles.length, 0); assert.equal(w.members[0].broken, false);
    assert.equal(w.x[0], 0); assert.equal(w.y[0], 4);
    assert.equal(w.x.at(-1), 20); assert.equal(w.y.at(-1), 4);
  }
  assert.ok(peaks[0] > peaks[1] && peaks[1] > peaks[2]);
  assert.ok(peaks[0] - peaks[2] > .25, 'Tension must produce a visible transverse-stiffening effect');
});

test('Initial tensile strain consumes the existing failure margin', () => {
  for (const epsilon of [0, .005]) {
    const w = new World(cable(), { gravity: 0, iterations: 0, initialPerturbation: 0, ropePrestrain: [epsilon] });
    // A 9.8% installation-relative stretch is below the ten-percent threshold
    // without preload, but exceeds it when measured from the shortened rope.
    for (let i = 0; i < w.x.length; i++) w.x[i] = 4 + (w.x[i] - 4) * 1.098;
    for (let step = 0; step < 6; step++) w.step();
    assert.equal(w.members[0].broken, epsilon > 0);
    assert.ok(Math.abs(w.members[0].overload - (epsilon > 0 ? 6 * DT : 0)) < 1e-14);
  }
});

test('Explicit zero prestrain exactly matches omitted settings in every correction schedule', () => {
  const p = cable(); p.beams = [{ endpoints: [8,4,10,6], profile: 's' }];
  for (const [solver, serpentineFromRight] of [['original',false], ['serpentine',false], ['serpentine',true]] as const) {
    for (const initialPerturbation of [.001,-.001]) {
      const options = { solver, serpentineFromRight, initialPerturbation };
      const omitted = new World(p, options), zero = new World(p, { ...options, ropePrestrain: [0] });
      for (let step = 0; step < 240; step++) { omitted.step(); zero.step(); }
      assert.deepEqual(zero.mass, omitted.mass); assert.deepEqual(zero.invMass, omitted.invMass);
      assert.deepEqual(zero.x, omitted.x); assert.deepEqual(zero.y, omitted.y);
      assert.deepEqual(zero.frame(), omitted.frame());
      assert.deepEqual(zero.vx, omitted.vx); assert.deepEqual(zero.vy, omitted.vy);
      assert.deepEqual(zero.drainSounds(), omitted.drainSounds());
    }
  }
});

test('Experiment groups cover every segmented stay independently of its profile', () => {
  const expected = [[4,1], [8,7], [10,9], [10,9], [12,6]];
  for (const [index,name] of experimentNames.entries()) {
    const project = experimentProject(name), groups = ropeGroups(name, project);
    assert.deepEqual([0,1].map(group => groups.indices.filter(i => i === group).length), expected[index]);
    const strains = groups.indices.map(group => [.001,.005][group]);
    const w = new World(project, { initialPerturbation: 0, ropePrestrain: strains });
    for (const rope of initialRopes(project, strains)) {
      const constraints = w.distances.filter(c => c.owner === project.beams.length + rope.index);
      assert.ok(Math.abs(constraints.reduce((sum,c) => sum+c.rest, 0) - rope.naturalLength) < 1e-12);
      const energy = constraints.reduce((sum,c) => {
        const extension = Math.hypot(w.x[c.b]-w.x[c.a], w.y[c.b]-w.y[c.a])-c.rest;
        return sum + .5 * extension ** 2 / c.compliance;
      }, 0);
      assert.ok(Math.abs(energy - rope.elasticEnergy) < 1e-8);
    }
  }
});

test('Screen ranking prioritizes fractures, contacts, displacement and then total prestrain', () => {
  const run = measureProject('empty', emptyProject(), {}, DT);
  const screen = (broken: number, contacts: number, displacement: number, strain = .001): Screen => ({
    groupPrestrain: [strain,0], ropePrestrain: [],
    initialForces: [], initialElasticEnergy: 0, initialRopeMass: 0,
    runs: [{...run, brokenMembers:broken, newBoundaryContacts:contacts, maximumDisplacement:displacement}],
  });
  assert.ok(rankScreens(screen(0,100,20), screen(1,0,1)) < 0);
  assert.ok(rankScreens(screen(0,0,20), screen(0,1,1)) < 0);
  assert.ok(rankScreens(screen(0,0,1), screen(0,0,2)) < 0);
  assert.ok(rankScreens(screen(0,0,1,.001), screen(0,0,1,.005)) < 0);
  assert.equal(rankScreens(screen(0,0,1), screen(0,0,1)), 0);
  for (const seconds of [0, -1, NaN, Infinity, DT/2]) assert.throws(() => measureProject('empty', emptyProject(), {}, seconds));
});
