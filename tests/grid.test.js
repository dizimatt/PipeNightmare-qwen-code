import test from 'node:test';
import assert from 'node:assert/strict';
import { Grid, PlaceBlockReason, RotateBlockReason } from '../src/logic/grid.js';
import { openings } from '../src/logic/pieces.js';
import { N, E, S, W } from '../src/logic/directions.js';

const LEVEL = { width: 4, height: 3, blocked: [{ row: 1, col: 1 }] };

test('placing works on any empty, in-bounds, unblocked cell', () => {
  const grid = new Grid(LEVEL);
  assert.deepEqual(grid.canPlace(0, 0), { ok: true, reason: null });
  assert.equal(grid.place(0, 0, 'elbow').ok, true);
  assert.equal(grid.at(0, 0).type, 'elbow');
  assert.equal(grid.at(0, 0).rotation, 0, 'a placed piece starts in its default orientation');
});

test('placement is refused with a readable reason', () => {
  const grid = new Grid(LEVEL);
  assert.equal(grid.canPlace(0, 9).reason, PlaceBlockReason.OUT_OF_BOUNDS);
  assert.equal(grid.canPlace(-1, 0).reason, PlaceBlockReason.OUT_OF_BOUNDS);
  assert.equal(grid.canPlace(1, 1).reason, PlaceBlockReason.BLOCKED);
  grid.place(2, 2, 'straight');
  assert.equal(grid.canPlace(2, 2).reason, PlaceBlockReason.OCCUPIED);
});

test('a placed piece cannot be replaced or removed, only rotated', () => {
  const grid = new Grid(LEVEL);
  grid.place(0, 0, 'straight');
  assert.equal(grid.place(0, 0, 'elbow').ok, false);
  assert.equal(grid.at(0, 0).type, 'straight');
  assert.equal(typeof grid.remove, 'undefined');
  assert.equal(grid.tilesPlaced, 1);
});

test('tilesPlaced counts placements, not rotations', () => {
  const grid = new Grid(LEVEL);
  grid.place(0, 0, 'straight');
  grid.rotate(0, 0);
  grid.rotate(0, 0);
  grid.place(0, 1, 'elbow');
  assert.equal(grid.tilesPlaced, 2);
});

test('rotating an unlocked tile turns it 90 degrees clockwise', () => {
  const grid = new Grid(LEVEL);
  grid.place(0, 0, 'elbow');
  assert.deepEqual(openings('elbow', 0), [N, E]);
  grid.rotate(0, 0);
  assert.equal(grid.at(0, 0).rotation, 1);
  grid.rotate(0, 0);
  grid.rotate(0, 0);
  grid.rotate(0, 0);
  assert.equal(grid.at(0, 0).rotation, 0, 'four clockwise turns come back around');
});

test('rotating an empty or blocked cell does nothing', () => {
  const grid = new Grid(LEVEL);
  assert.equal(grid.rotate(0, 0).ok, false);
  assert.equal(grid.canRotate(0, 0).reason, RotateBlockReason.EMPTY);
  assert.equal(grid.canRotate(1, 1).reason, RotateBlockReason.EMPTY);
  assert.equal(grid.canRotate(0, 9).reason, PlaceBlockReason.OUT_OF_BOUNDS);
});

test('a locked tile cannot be rotated', () => {
  const grid = new Grid(LEVEL);
  grid.place(0, 0, 'straight');
  assert.equal(grid.canRotate(0, 0).ok, true);
  grid.lock(0, 0);
  assert.equal(grid.isLocked(0, 0), true);
  assert.equal(grid.canRotate(0, 0).reason, RotateBlockReason.LOCKED);
  const before = grid.at(0, 0).rotation;
  assert.equal(grid.rotate(0, 0).ok, false);
  assert.equal(grid.at(0, 0).rotation, before);
});

test('blocking keeps the source and drain cells reachable as data', () => {
  const grid = new Grid({ width: 3, height: 1, blocked: [{ row: 0, col: 1 }] });
  assert.equal(grid.isBlocked(0, 1), true);
  assert.equal(grid.isBlocked(0, 0), false);
  assert.equal(grid.isBlocked(0, 2), false);
});

test('hasOpening answers for the tile actually there', () => {
  const grid = new Grid(LEVEL);
  grid.place(0, 0, 'straight', 0);
  assert.equal(grid.hasOpening(0, 0, W), true);
  assert.equal(grid.hasOpening(0, 0, N), false);
  assert.equal(grid.hasOpening(3, 3, W), false);
});
