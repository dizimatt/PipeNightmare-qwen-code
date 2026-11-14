import test from 'node:test';
import assert from 'node:assert/strict';
import { openings, nextRotation, shapeKey, otherOpening, acceptsEntry, PIECE_TYPES } from '../src/logic/pieces.js';
import { N, E, S, W } from '../src/logic/directions.js';

test('straight has two openings and alternates horizontal/vertical', () => {
  assert.deepEqual(openings('straight', 0), [E, W]);
  assert.deepEqual(openings('straight', 1), [N, S]);
  assert.deepEqual(openings('straight', 2), [E, W]);
  assert.deepEqual(openings('straight', 3), [N, S]);
});

test('elbow has two adjacent openings and cycles through 4 orientations', () => {
  assert.deepEqual(openings('elbow', 0), [N, E]);
  assert.deepEqual(openings('elbow', 1), [E, S]);
  assert.deepEqual(openings('elbow', 2), [S, W]);
  assert.deepEqual(openings('elbow', 3), [N, W]);
  const distinct = new Set([0, 1, 2, 3].map((r) => shapeKey('elbow', r)));
  assert.equal(distinct.size, 4, 'elbow must have 4 visually distinct orientations');
});

test('rotation is always clockwise by 90 degrees', () => {
  assert.equal(nextRotation('straight', 0), 1);
  assert.equal(nextRotation('straight', 3), 0);
  assert.equal(nextRotation('elbow', 3), 0);
});

test('rotation normalises out-of-range values', () => {
  assert.deepEqual(openings('elbow', -1), openings('elbow', 3));
  assert.deepEqual(openings('elbow', 5), openings('elbow', 1));
  assert.deepEqual(openings('elbow', 4), openings('elbow', 0));
});

test('the two identical straight rotations share one shape key', () => {
  assert.equal(shapeKey('straight', 0), shapeKey('straight', 2));
  assert.notEqual(shapeKey('straight', 0), shapeKey('straight', 1));
});

test('water exits through the opening opposite its entry', () => {
  assert.equal(otherOpening('straight', 0, W), E);
  assert.equal(otherOpening('straight', 0, E), W);
  assert.equal(otherOpening('elbow', 0, N), E);
  assert.equal(otherOpening('elbow', 0, E), N);
});

test('a tile refuses water on a closed side', () => {
  assert.equal(acceptsEntry('straight', 0, W), true);
  assert.equal(acceptsEntry('straight', 0, N), false);
  assert.throws(() => otherOpening('straight', 0, N), /no opening/);
});

test('only straight and elbow pieces exist', () => {
  assert.deepEqual(PIECE_TYPES, ['straight', 'elbow']);
});

test('unknown piece types are rejected loudly', () => {
  assert.throws(() => openings('cross', 0), /Unknown piece type/);
});
