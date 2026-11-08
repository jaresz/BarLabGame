import { DT, World, type Frame, type PhysicsMember, type PhysicsOptions, type SoundEvent, type StressBed } from './physics';
import type { Project } from './model';
type Start = { type: 'start'; project: Project; options?: PhysicsOptions };
type Tick = { type: 'tick'; elapsed: number; recycled?: { positions: ArrayBuffer; stresses: ArrayBuffer; broken: ArrayBuffer } };
const scope = self as unknown as { onmessage: ((event: MessageEvent<Start | Tick>) => void) | null; postMessage: (message: { type: string; frame: Frame; members?: PhysicsMember[]; sounds?: SoundEvent[]; beds?: StressBed[] }, transfer: Transferable[]) => void };
let world: World | null = null, accumulator = 0, lastBedTime = 0;
scope.onmessage = ({ data }) => {
  if (data.type === 'start') { world = new World(data.project, data.options); accumulator = 0; lastBedTime = 0; const frame = world.frame(); scope.postMessage({ type: 'ready', frame, members: world.members }, [frame.positions.buffer, frame.stresses.buffer, frame.broken.buffer]); }
  else if (world) {
    accumulator = Math.min(accumulator + Math.max(0, data.elapsed), 8 * DT);
    let steps = 0; const start = performance.now();
    while (accumulator + 1e-10 >= DT && steps < 8) { world.step(); accumulator -= DT; steps++; }
    world.stepMs = steps ? (performance.now() - start) / steps : world.stepMs;
    const frame = world.frame(data.recycled);
    // A tenth-second control rate is enough for smooth Web Audio ramps and avoids
    // transferring one audio record for every member on every visual frame.
    const beds = world.time - lastBedTime >= .1 - 1e-8 ? world.stressBeds() : undefined;
    if (beds) lastBedTime = world.time;
    scope.postMessage({ type: 'frame', frame, sounds: world.drainSounds(), beds }, [frame.positions.buffer, frame.stresses.buffer, frame.broken.buffer]);
  }
};
