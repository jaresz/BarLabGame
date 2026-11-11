import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { example, type Example } from '../src/examples';
import { exportProject, importProject, GAME_VERSION, validateMember, type Project } from '../src/model';
import { DT, World, type PhysicsOptions } from '../src/physics';

export const landmarks = ['ponteLuisI', 'rtcnKolowo', 'seriWawasan', 'goldenGate'] as const;

/** Measure the entire trajectory, not just the final frame or intact endpoints. */
export function measureLandmark(name: Example, options: PhysicsOptions) {
  const project = example(name);
  return measureProject(name, project, options);
}

/** Apply the gallery acceptance criteria to an experimental, unshipped design. */
export function measureProject(name: string, project: Project, options: PhysicsOptions) {
  const restored = importProject(exportProject(project));
  if (JSON.stringify(project) !== JSON.stringify(restored)) throw new Error(`${name}: round trip changed geometry`);
  // Validate each member against the rest of the project to catch overlapping
  // intervals too; checking only its length would miss invalid lattice panels.
  for (const [index,b] of project.beams.entries()) {
    const other = { ...project, beams: project.beams.filter((_,i) => i !== index) };
    const error = validateMember(other,'beam',b.endpoints);
    if (error) throw new Error(`${name}: beam ${index}: ${error}`);
  }
  for (const [index,r] of project.ropes.entries()) {
    const other = { ...project, ropes: project.ropes.filter((_,i) => i !== index) };
    const error = validateMember(other,'rope',r.endpoints);
    if (error) throw new Error(`${name}: rope ${index}: ${error}`);
  }
  const aligned = new World(project,{...options,initialPerturbation:0});
  const world = new World(project,options);
  let maximumDisplacement = 0, newBoundaryContacts = 0, maximumSupportMotion = 0, firstBreak: number | null = null;
  const initialEdge = (i: number) => aligned.x[i] === 0 || aligned.x[i] === project.size[0] || aligned.y[i] === 0 || aligned.y[i] === project.size[1];
  // Sample every particle on every 1/120-second step. Initial boundary contacts
  // (foundations and abutments) are allowed; new interior-to-edge contacts are not.
  for (let step = 0; step <= 2400; step++) {
    for (let i = 0; i < world.x.length; i++) {
      const x=world.x[i],y=world.y[i];
      if (!Number.isFinite(x+y+world.vx[i]+world.vy[i])) throw new Error(`${name}: nonfinite state`);
      const displacement = Math.hypot(x-aligned.x[i],y-aligned.y[i]);
      maximumDisplacement = Math.max(maximumDisplacement,displacement);
      if (world.invMass[i] === 0) maximumSupportMotion = Math.max(maximumSupportMotion,displacement);
      if (!initialEdge(i) && (x <= 0 || x >= project.size[0] || y <= 0 || y >= project.size[1])) newBoundaryContacts++;
    }
    if (firstBreak === null && world.members.some(m=>m.broken)) firstBreak=step*DT;
    if (step < 2400) world.step();
  }
  return {name,options,size:project.size,beams:project.beams.length,ropes:project.ropes.length,maximumDisplacement,newBoundaryContacts,maximumSupportMotion,firstBreak,
    brokenMembers:world.members.filter(m=>m.broken).length,
    stable:firstBreak===null && maximumDisplacement<=2.5 && newBoundaryContacts===0 && maximumSupportMotion===0};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const runs=[];
  // Original and both fixed Serpentine scan directions each receive the same
  // positive and negative initial imperfection; no accuracy overrides are used.
  for (const name of landmarks) for (const [solver,serpentineFromRight] of [['original',false],['serpentine',false],['serpentine',true]] as const) {
    for (const initialPerturbation of [0.001,-0.001]) {
      const result=measureLandmark(name,{solver,serpentineFromRight,initialPerturbation});
      runs.push(result); console.log(JSON.stringify(result));
    }
  }
  mkdirSync('docs/examples',{recursive:true});
  writeFileSync('docs/examples/measurements.json',JSON.stringify({gameVersion:GAME_VERSION,seconds:20,dt:DT,gravity:9.81,iterations:12,runs},null,2)+'\n');
}
