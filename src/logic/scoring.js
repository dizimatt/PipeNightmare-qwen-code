export const SCORE_START = 1000;
export const SCORE_PER_TILE = 50;

// R-011: every piece placed counts, including ones off the final route.
// Rotations do not count. 10 -> 500, 20 -> 0, 25 -> 0.
export function scoreFor(tilesPlaced) {
  const n = Number.isFinite(tilesPlaced) ? Math.max(0, Math.trunc(tilesPlaced)) : 0;
  return Math.max(0, SCORE_START - SCORE_PER_TILE * n);
}
