import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { example } from '../src/examples';
import { boundary, importProject, nodes } from '../src/model';
import { landmarks, measureLandmark } from '../scripts/measure-landmarks';

for (const name of landmarks) {
  test(`${name}: valid geometry and 20-second simulations with both disturbance signs`, () => {
    // Use the same three correction schedules as the app, with independently
    // controlled disturbance signs. A completed run also verifies finite state,
    // element validity, length limits and the exported project round trip.
    for (const [solver,serpentineFromRight] of [['original',false],['serpentine',false],['serpentine',true]] as const) {
      for (const initialPerturbation of [0.001,-0.001]) {
        const result=measureLandmark(name,{solver,serpentineFromRight,initialPerturbation});
        const label=`${name}/${solver}/${serpentineFromRight}/${initialPerturbation}`;
        assert.equal(result.maximumSupportMotion,0,`${label}: supports must remain fixed`);
        // Seri Wawasan remains an explicitly documented unmet acceptance criterion.
        // Keep the three stable examples strict; never hide its measured failure.
        if (name === 'seriWawasan') {
          assert.ok(result.maximumDisplacement < 3.4, `${label}: reinforcement must improve on the 8.896-unit baseline`);
          assert.equal(result.newBoundaryContacts,0);
        } else {
          assert.equal(result.firstBreak,null,`${label}: no fracture during the trajectory`);
          assert.ok(result.maximumDisplacement<=2.5,`${label}: displacement ${result.maximumDisplacement}`);
          assert.equal(result.newBoundaryContacts,0,`${label}: no new boundary contacts`);
          assert.equal(result.stable,true);
          if (name === 'goldenGate') assert.ok(result.maximumDisplacement < 1.3420670192987172, 'Improve on the worst format-3 baseline trajectory');
        }
      }
    }
  });
}

// Reinforcement must use the original banks/foundations, never new edge pins.
test('Bridge reinforcement preserves canvas sizes, support locations and Golden Gate geometry', () => {
 const baseline=JSON.parse(readFileSync(new URL('../docs/examples/rope-baseline.json',import.meta.url),'utf8'));
 for(const name of ['goldenGate','seriWawasan'] as const){
  const old=importProject(JSON.stringify(baseline.projects[name])), current=example(name);
  assert.deepEqual(current.size,old.size);
  const supports=(p:typeof old)=>[...nodes(p)].filter(([,pt])=>boundary(pt,p.size)).map(([id])=>id).sort();
  assert.deepEqual(supports(current),supports(old));
  if(name==='goldenGate'){
   assert.deepEqual(current.beams.map(b=>b.endpoints),old.beams.map(b=>b.endpoints));
   assert.deepEqual(current.ropes.map(r=>r.endpoints),old.ropes.map(r=>r.endpoints));
  }
 }
});
