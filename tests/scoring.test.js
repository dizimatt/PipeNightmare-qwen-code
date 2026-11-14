import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreFor, SCORE_START, SCORE_PER_TILE } from '../src/logic/scoring.js';

test('the spec worked examples hold exactly', () => {
  assert.equal(scoreFor(0), SCORE_START);
  assert.equal(scoreFor(10), 500);
  assert.equal(scoreFor(20), 0);
  assert.equal(scoreFor(25), 0);
});

test('placing more pieces never increases the score', () => {
  let previous = scoreFor(0);
  for (let n = 1; n <= 60; n += 1) {
    const next = scoreFor(n);
    assert.ok(next <= previous, `${n} tiles scored ${next}, above ${previous} at ${n - 1}`);
    previous = next;
  }
});

test('the score floors at zero and never goes negative', () => {
  assert.equal(scoreFor(20), 0);
  assert.equal(scoreFor(21), 0);
  assert.equal(scoreFor(1000), 0);
});

test('each tile costs exactly the stated amount', () => {
  for (let n = 0; n < 20; n += 1) {
    assert.equal(scoreFor(n), SCORE_START - SCORE_PER_TILE * n);
  }
});

test('bad tile counts degrade to the safest value instead of NaN', () => {
  assert.equal(scoreFor(-3), SCORE_START);
  assert.equal(scoreFor(undefined), SCORE_START);
  assert.equal(scoreFor(Number.NaN), SCORE_START);
  assert.equal(scoreFor(7.9), SCORE_START - SCORE_PER_TILE * 7);
});
