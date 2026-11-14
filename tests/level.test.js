import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLevel, parseLevelJson } from '../src/logic/level.js';

const GOOD = {
  width: 6,
  height: 4,
  sourceRow: 1,
  drainRow: 2,
  blocked: [{ row: 2, col: 2 }, { row: 0, col: 4 }],
  queueSize: 5,
  startDelayMs: 8000,
  waterMsPerTile: 650
};

test('a well-formed level validates and normalises', () => {
  const res = validateLevel(GOOD, 'level-1.json');
  assert.equal(res.ok, true, res.errors.join('; '));
  assert.equal(res.level.width, 6);
  assert.equal(res.level.queueSize, 5);
  assert.equal(res.level.name, 'level-1.json');
  assert.deepEqual(res.level.blocked, GOOD.blocked);
  assert.notEqual(res.level.blocked, GOOD.blocked, 'the copy must not alias the input');
});

test('a missing field names itself instead of crashing', () => {
  for (const field of ['width', 'height', 'sourceRow', 'drainRow', 'blocked', 'queueSize', 'startDelayMs', 'waterMsPerTile']) {
    const broken = { ...GOOD };
    delete broken[field];
    const res = validateLevel(broken, 'x.json');
    assert.equal(res.ok, false, `${field} should be required`);
    assert.match(res.errors.join(' '), new RegExp(field));
  }
});

test('out-of-range cells and rows are reported readably', () => {
  const res = validateLevel({ ...GOOD, blocked: [{ row: 9, col: 1 }] }, 'x.json');
  assert.equal(res.ok, false);
  assert.match(res.errors.join(' '), /outside the 6x4 grid/);

  assert.match(validateLevel({ ...GOOD, sourceRow: 4 }, 'x.json').errors.join(' '), /sourceRow/);
  assert.match(validateLevel({ ...GOOD, drainRow: -1 }, 'x.json').errors.join(' '), /drainRow/);
  assert.match(validateLevel({ ...GOOD, blocked: [{ row: 0 }] }, 'x.json').errors.join(' '), /integer "row" and "col"/);
  assert.match(validateLevel({ ...GOOD, blocked: 'nope' }, 'x.json').errors.join(' '), /must be an array/);
});

test('a level cannot seal its own source or drain', () => {
  assert.match(validateLevel({ ...GOOD, blocked: [{ row: 1, col: 0 }] }, 'x.json').errors.join(' '), /seals the cell the source/);
  assert.match(validateLevel({ ...GOOD, blocked: [{ row: 2, col: 5 }] }, 'x.json').errors.join(' '), /seals the cell the drain/);
});

test('duplicate blocked cells are caught', () => {
  const res = validateLevel({ ...GOOD, blocked: [{ row: 2, col: 2 }, { row: 2, col: 2 }] }, 'x.json');
  assert.equal(res.ok, false);
  assert.match(res.errors.join(' '), /listed twice/);
});

test('degenerate grids and timings are refused', () => {
  assert.match(validateLevel({ ...GOOD, width: 1 }, 'x.json').errors.join(' '), /at least 2/);
  assert.match(validateLevel({ ...GOOD, height: 0 }, 'x.json').errors.join(' '), /at least 1/);
  assert.match(validateLevel({ ...GOOD, waterMsPerTile: 0 }, 'x.json').errors.join(' '), /positive number/);
  assert.match(validateLevel({ ...GOOD, startDelayMs: '8s' }, 'x.json').errors.join(' '), /positive number/);
  assert.match(validateLevel({ ...GOOD, queueSize: 0 }, 'x.json').errors.join(' '), /positive integer/);
  assert.match(validateLevel({ ...GOOD, waterMsPerTile: Infinity }, 'x.json').errors.join(' '), /positive number/);
});

test('non-object JSON and bad syntax are reported, not thrown', () => {
  assert.match(validateLevel(null, 'x.json').errors.join(' '), /expected a JSON object/);
  assert.match(validateLevel([], 'x.json').errors.join(' '), /expected a JSON object, got an array/);
  assert.match(parseLevelJson('{oops', 'x.json').errors.join(' '), /not valid JSON/);
});

test('parseLevelJson accepts a valid document', () => {
  const res = parseLevelJson(JSON.stringify(GOOD), 'x.json');
  assert.equal(res.ok, true);
  assert.equal(res.level.height, 4);
});
