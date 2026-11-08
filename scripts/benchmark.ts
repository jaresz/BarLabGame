import { performance } from 'node:perf_hooks';
import { emptyProject, type BeamProfile } from '../src/model';
import { World } from '../src/physics';
const p=emptyProject();p.size=[64,40];
for(let y=1;y<39 && p.beams.length<1000;y+=2) for(let x=1;x<63 && p.beams.length<1000;x+=2) {
  for(const vertical of [false,true]) if(p.beams.length<1000) p.beams.push({endpoints:[x,y,x+(vertical?0:1),y+(vertical?1:0)],profile:(['l','s','h'] as BeamProfile[])[p.beams.length%3]});
}
const world=new World(p);for(let i=0;i<30;i++)world.step();
const start=performance.now();for(let i=0;i<120;i++)world.step();
console.log(JSON.stringify({elements:p.beams.length,points:world.x.length,constraints:world.distances.length+world.angles.length,msPerStep:(performance.now()-start)/120,finite:[...world.x,...world.y].every(Number.isFinite)},null,2));
