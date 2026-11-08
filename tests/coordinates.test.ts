import assert from 'node:assert/strict';
import test from 'node:test';
import { fromCentered, toCentered } from '../src/coordinates';
import { emptyProject, exportProject, importProject, type Point } from '../src/model';
test('Allowed board sizes have a grid point at zero and round trip at all corners',()=>{
 for(const size of [[12,8],[32,18],[64,40]] as Point[]) {
  for(const p of [[0,0],[size[0],size[1]],[size[0]/2,size[1]/2]] as Point[]) assert.deepEqual(fromCentered(toCentered(p,size),size),p);
  assert.deepEqual(toCentered([size[0]/2,size[1]/2],size),[0,0]);
  const p=emptyProject();p.size=size;p.beams=[{endpoints:[0,0,4,0],profile:'s'}];assert.deepEqual(importProject(exportProject(p)),p);
 }
});
