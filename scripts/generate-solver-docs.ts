import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { DT, World, type PhysicsOptions } from '../src/physics';
import { GAME_VERSION, importProject, type Point } from '../src/model';
import { BackwardTree, serpentineMemberOrder } from '../src/solver-strategies';

// Use the public JSON fixture, not hand-animated geometry. Explicit Serpentine
// sides document both possible random outcomes without rerolling during a run.
const fixture = { metadata:{size:[12,12],gameVersion:GAME_VERSION,formatVersion:3}, objects:{
  b:[[-3,0,0,5,'l'],[0,5,0,0,'l'],[0,5,3,0,'l'],[0,0,0,-6,'l']],
}, checksum:'fnv1a32:55d881f8' };
const project = importProject(JSON.stringify(fixture));
const nodes: Record<string,Point> = { A:[6,12],B:[6,6],C:[6,1],D:[3,6],E:[9,6] };
const variants: {id:string; options:PhysicsOptions}[] = [
  {id:'original',options:{solver:'original'}},
  {id:'serpentine-left',options:{solver:'serpentine',serpentineFromRight:false}},
  {id:'serpentine-right',options:{solver:'serpentine',serpentineFromRight:true}},
  {id:'backward',options:{solver:'backward'}},
];
const runs = variants.map(({id,options}) => {
  const w = new World(project,options);
  const tracked = Object.fromEntries(Object.entries(nodes).map(([name,[x,y]]) => [name,[...w.x.keys()].filter(i => w.x[i]===x && w.y[i]===y)]));
  const frames = [], measurements = [];
  // 12 seconds at 120 physics steps/s, sampled every 12 steps for 10 fps GIFs.
  for (let step=0;step<=1440;step++) {
    if (step%12===0) frames.push({time:w.time,x:[...w.x],y:[...w.y],stress:w.members.map(m=>m.stress),broken:w.members.map(m=>m.broken)});
    if ([0,120,600,1200,1440].includes(step)) {
      const top = tracked.C;
      measurements.push({seconds:step*DT,topOffset:top.reduce((sum,i)=>sum+w.x[i],0)/top.length-6,broken:w.members.filter(m=>m.broken).length});
    }
    if (step<1440) w.step();
  }
  assert.ok([...w.x,...w.y].every(Number.isFinite));
  return {id,options,members:w.members,tracked,frames,measurements};
});

// Audit the worked load example: A--B--D is horizontal, with a B--C branch.
const branch = importProject(JSON.stringify({metadata:fixture.metadata,objects:{b:[[-6,0,-2,0,'s'],[-2,0,-2,3,'s'],[-2,0,2,0,'s']]}}));
const w = new World(branch,{solver:'backward'}), tree = new BackwardTree(w); tree.update();
const root = [...w.invMass.keys()].find(i=>w.invMass[i]===0)!;
const weight = w.mass.reduce((sum,m)=>sum+m*9.81,0);
const moment = w.mass.reduce((sum,m,i)=>sum+m*9.81*w.x[i],0);
assert.ok(Math.abs(weight-194.238)<1e-9);
assert.ok(Math.abs(moment-776.952)<1e-9);
assert.ok(Math.abs(tree.forces[root]-weight)<1e-9);
assert.ok(Math.abs(tree.moments[root]-moment)<1e-9);

// A standard interior particle beside half-unit segments has mass 1.8*0.5=0.9.
const alpha=(0.5/2e6)/(DT*DT), inverseMass=1/0.9;
const deltaLambda=-0.01/(2*inverseMass+alpha), correction=-inverseMass*deltaLambda;
assert.ok(Math.abs(0.51-2*correction-0.5000161737984465)<1e-12);
const report = {
  gameVersion:GAME_VERSION, dt:DT, fixture, project, nodes, runs,
  scan:{left:serpentineMemberOrder(project),right:serpentineMemberOrder(project,true)},
  distanceExample:{alpha,deltaLambda,correction,correctedLength:0.51-2*correction},
  branch:{project:branch,mass:w.mass.reduce((sum,m)=>sum+m,0),weight,moment,stresses:[...tree.stresses],members:w.members,root},
};
mkdirSync('screenshots/solver-docs',{recursive:true});
mkdirSync('docs/solvers',{recursive:true});
writeFileSync('screenshots/solver-docs/frames.json',JSON.stringify(report));
writeFileSync('docs/solvers/tower.json',JSON.stringify(fixture,null,2)+'\n');
writeFileSync('docs/solvers/measurements.json',JSON.stringify({...report,runs:runs.map(({frames, ...rest})=>rest)},null,2)+'\n');
console.log(JSON.stringify({distanceExample:report.distanceExample,branch:report.branch,runs:runs.map(({id,measurements})=>({id,measurements}))},null,2));
