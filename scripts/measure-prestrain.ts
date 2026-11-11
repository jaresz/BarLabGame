import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { example } from '../src/examples';
import { exportProject, GAME_VERSION, importProject, length, ROPE_PROFILES, type Project } from '../src/model';
import { DT, type PhysicsOptions } from '../src/physics';
import { measureProject } from './measure-landmarks';

export const experimentNames = ['seriWawasan', 'goldenGate', 'fork-standard-front', 'fork-heavy-front', 'wide-lattice'] as const;
export type ExperimentName = typeof experimentNames[number];
export const prestrainLevels = [0, .001, .0025, .005, .01] as const;
const schedules = [
  { solver: 'original', serpentineFromRight: false },
  { solver: 'serpentine', serpentineFromRight: false },
  { solver: 'serpentine', serpentineFromRight: true },
] as const;
const reportDirectory = new URL('../docs/solvers/rope-prestrain/', import.meta.url);

export function experimentProject(name: ExperimentName): Project {
  if (name === 'seriWawasan' || name === 'goldenGate') return example(name);
  return importProject(readFileSync(new URL(`../docs/examples/seri-wawasan-large/${name}.json`, import.meta.url), 'utf8'));
}

/** Group IDs describe the geometry experiment, never name-specific physics. */
export function ropeGroups(name: ExperimentName, project: Project): { labels: string[]; indices: number[] } {
  if (name === 'goldenGate') return {
    labels: ['main cable', 'hangers'],
    indices: project.ropes.map(r => r.endpoints[0] === r.endpoints[2] ? 1 : 0),
  };
  // Canonical endpoints start at the smaller X. The existing small bridge's
  // backstay starts at X=3; the large fixtures' rear chains all start left of
  // X=24. Applying one setting to the entire group includes every segmented guy.
  const frontStart = name === 'seriWawasan' ? 10 : 24;
  return { labels: ['front stays', 'rear guys'], indices: project.ropes.map(r => r.endpoints[0] < frontStart ? 1 : 0) };
}

/** Mounted, unperturbed straight-cable values; forces use game-model units. */
export function initialRopes(project: Project, ropePrestrain: readonly number[]) {
  return project.ropes.map((rope, index) => {
    const prestrain = ropePrestrain[index], mountedLength = length(rope.endpoints);
    const naturalLength = mountedLength / (1 + prestrain), ea = 80000 * ROPE_PROFILES[rope.profile].axial;
    return { index, endpoints: rope.endpoints, profile: rope.profile, prestrain, mountedLength, naturalLength,
      axialRigidity: ea, force: ea * prestrain, elasticEnergy: .5 * ea * prestrain ** 2 * naturalLength,
      mass: .22 * ROPE_PROFILES[rope.profile].mass * naturalLength };
  });
}

type Run = ReturnType<typeof measureProject>;
export interface Screen {
  groupPrestrain: number[]; ropePrestrain: number[]; runs: Run[];
  initialForces: number[]; initialElasticEnergy: number; initialRopeMass: number;
}

/** Lexicographic scores aggregate all three positive-perturbation schedules. */
export function screeningScore(screen: Screen): number[] {
  return [screen.runs.reduce((n,r) => n+r.brokenMembers, 0), screen.runs.reduce((n,r) => n+r.newBoundaryContacts, 0),
    Math.max(...screen.runs.map(r => r.maximumDisplacement)), screen.groupPrestrain[0]+screen.groupPrestrain[1], ...screen.groupPrestrain];
}
export function rankScreens(a: Screen, b: Screen): number {
  const x = screeningScore(a), y = screeningScore(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]-y[i];
  return 0;
}

export function runExperiment(name: ExperimentName) {
  const project = experimentProject(name), groups = ropeGroups(name, project), screens: Screen[] = [];
  // Complete all 25 four-second combinations in all three schedules. Continue
  // after failures so ranking never compares trajectories of different lengths.
  for (const first of prestrainLevels) for (const second of prestrainLevels) {
    const groupPrestrain = [first, second], ropePrestrain = groups.indices.map(group => groupPrestrain[group]);
    const runs = schedules.map(schedule => measureProject(name, project, { ...schedule, initialPerturbation: .001, ropePrestrain }, 4));
    const ropes = initialRopes(project, ropePrestrain);
    const screen = { groupPrestrain, ropePrestrain, runs, initialForces: ropes.map(r => r.force),
      initialElasticEnergy: ropes.reduce((sum,r) => sum+r.elasticEnergy, 0), initialRopeMass: ropes.reduce((sum,r) => sum+r.mass, 0) };
    screens.push(screen);
    console.log(`${name}: screen ${screens.length}/25, groups ${first}/${second}, score ${JSON.stringify(screeningScore(screen).slice(0,3))}`);
  }
  const baseline = screens.find(s => s.groupPrestrain.every(e => e === 0))!;
  const selected = screens.filter(s => s !== baseline).sort(rankScreens).slice(0,2);
  const fullRuns = [];
  // Each shortlisted setting receives six independent full trajectories, with
  // no settling phase. Failed screens can still be selected if all settings fail.
  for (const [index, setting] of [baseline, ...selected].entries()) {
    const runs: Run[] = [];
    for (const schedule of schedules) for (const initialPerturbation of [.001, -.001]) {
      const options: PhysicsOptions = { ...schedule, initialPerturbation, ropePrestrain: setting.ropePrestrain };
      runs.push(measureProject(name, project, options));
      console.log(`${name}: full setting ${index+1}/3, run ${runs.length}/6`);
    }
    const ropes = initialRopes(project, setting.ropePrestrain);
    fullRuns.push({ phase: index === 0 ? 'baseline' : 'selected', groupPrestrain: setting.groupPrestrain,
      ropePrestrain: setting.ropePrestrain, initialRopes: ropes,
      initialElasticEnergy: ropes.reduce((sum,r) => sum+r.elasticEnergy, 0),
      initialRopeMass: ropes.reduce((sum,r) => sum+r.mass, 0), runs });
  }
  const report = { gameVersion: GAME_VERSION, formatVersion: 4, name, project: JSON.parse(exportProject(project)),
    gravity: 9.81, iterations: 12, damping: .65, dt: DT, startup: 'prestrained at t=0; no settling',
    screeningSeconds: 4, acceptanceSeconds: 20, acceptanceDisplacement: 2.5, prestrainLevels,
    groups, screeningRank: ['total broken members', 'total new boundary samples', 'worst displacement', 'sum of group strains', 'first group strain', 'second group strain'],
    screens, fullRuns };
  mkdirSync(reportDirectory, { recursive: true });
  writeFileSync(new URL(`${name}.json`, reportDirectory), JSON.stringify(report, null, 2)+'\n');
  console.log(`${name}: report saved to ${fileURLToPath(new URL(`${name}.json`, reportDirectory))}`);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--model' || !experimentNames.includes(args[1] as ExperimentName))) {
    throw new Error(`Use no arguments, or --model followed by one of: ${experimentNames.join(', ')}.`);
  }
  for (const name of args.length ? [args[1] as ExperimentName] : experimentNames) runExperiment(name);
}
