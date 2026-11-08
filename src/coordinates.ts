import type { Member, Point } from './model';

/** Display and format-2 coordinates: origin at board center, positive Y upward. */
export function toCentered(point: Point, size: Point): Point {
  return [point[0] - size[0] / 2, size[1] / 2 - point[1]];
}

/** Internal editor/physics coordinates remain measured from the top-left corner. */
export function fromCentered(point: Point, size: Point): Point {
  return [point[0] + size[0] / 2, size[1] / 2 - point[1]];
}

export function centeredMember(member: Member, size: Point): Member {
  return [...toCentered([member[0], member[1]], size), ...toCentered([member[2], member[3]], size)];
}
