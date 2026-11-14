export const N = 0;
export const E = 1;
export const S = 2;
export const W = 3;

export const DIRS = [N, E, S, W];
const LETTER = ['n', 'e', 's', 'w'];
const DELTA_ROW = [-1, 0, 1, 0];
const DELTA_COL = [0, 1, 0, -1];

export function opposite(dir) {
  return (dir + 2) % 4;
}

export function dirLetter(dir) {
  return LETTER[dir];
}

export function deltaRow(dir) {
  return DELTA_ROW[dir];
}

export function deltaCol(dir) {
  return DELTA_COL[dir];
}

export function turnClockwise(dir) {
  return (dir + 1) % 4;
}
