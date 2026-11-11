import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GAME_VERSION, importProject } from '../src/model';
import { DT } from '../src/physics';
import { measureProject } from './measure-landmarks';

// These format-4 fixtures are intentionally outside the example factory. A failed
// candidate must never replace the gallery's current design merely for its size.
const directory = new URL('../docs/examples/seri-wawasan-large/', import.meta.url);
const candidates = ['fork-standard-front', 'fork-heavy-front', 'wide-lattice'] as const;
const runs = [];
for (const name of candidates) {
  const project = importProject(readFileSync(new URL(`${name}.json`, directory), 'utf8'));
  // Independent signed imperfections and fixed scan directions make failures
  // reproducible; every run continues to twenty seconds after the first fracture.
  for (const [solver, serpentineFromRight] of [['original', false], ['serpentine', false], ['serpentine', true]] as const) {
    for (const initialPerturbation of [0.001, -0.001]) {
      const result = measureProject(name, project, { solver, serpentineFromRight, initialPerturbation });
      runs.push(result);
      console.log(JSON.stringify(result));
    }
  }
}
const report = { gameVersion: GAME_VERSION, formatVersion: 4, seconds: 20, dt: DT,
  gravity: 9.81, iterations: 12, acceptanceDisplacement: 2.5, runs };
writeFileSync(fileURLToPath(new URL('measurements.json', directory)), JSON.stringify(report, null, 2) + '\n');
