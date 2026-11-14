import { N, E, S, W, DIRS, dirLetter } from './directions.js';

export const STRAIGHT = 'straight';
export const ELBOW = 'elbow';
export const PIECE_TYPES = [STRAIGHT, ELBOW];

// Rotation 0 of each piece. A clockwise rotation adds 1 to every opening,
// mod 4, so both piece types follow one rule.
const BASE_OPENINGS = {
  [STRAIGHT]: [W, E],
  [ELBOW]: [N, E],
};

export function isPieceType(type) {
  return PIECE_TYPES.includes(type);
}

export function normalizeRotation(rotation) {
  return ((Math.trunc(rotation) % 4) + 4) % 4;
}

export function openings(type, rotation) {
  const base = BASE_OPENINGS[type];
  if (!base) throw new Error(`Unknown piece type: ${type}`);
  const r = normalizeRotation(rotation);
  return DIRS.filter((d) => base.some((b) => (b + r) % 4 === d));
}

// R-004: click rotates 90 degrees clockwise. A straight cycles h/v/h/v under
// mod 4, which is the same alternation the requirement asks for.
export function nextRotation(type, rotation) {
  return (normalizeRotation(rotation) + 1) % 4;
}

export function previousRotation(type, rotation) {
  return (normalizeRotation(rotation) + 3) % 4;
}

// The asset key is derived from the openings rather than the rotation index,
// so the two visually identical rotations of a straight share one frame.
export function shapeKey(type, rotation) {
  const open = openings(type, rotation);
  return open.map(dirLetter).join('');
}

export function isStraightKey(key) {
  return key === 'ew' || key === 'ns';
}

export function otherOpening(type, rotation, entry) {
  const open = openings(type, rotation);
  if (!open.includes(entry)) {
    throw new Error(`Piece ${type}/${rotation} has no opening at ${dirLetter(entry)}`);
  }
  return open.find((d) => d !== entry);
}

export function acceptsEntry(type, rotation, entry) {
  return openings(type, rotation).includes(entry);
}

export { N, E, S, W };
