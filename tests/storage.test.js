import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEVEL_COUNT, defaultProgress, loadProgress, saveProgress,
  isUnlocked, withUnlock, withBest, bestScore
} from '../src/logic/storage.js';

function memStore(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k)
  };
}

const KEY = 'pipe-nightmare.v1';

test('a first-ever visit offers only level 1', () => {
  const p = loadProgress(memStore());
  assert.deepEqual(p, defaultProgress());
  assert.equal(isUnlocked(p, 1), true);
  assert.equal(isUnlocked(p, 2), false);
  assert.equal(bestScore(p, 1), null);
});

test('winning level N unlocks N+1 and never skips ahead', () => {
  let p = defaultProgress();
  p = withUnlock(p, 1);
  assert.equal(p.unlocked, 2);
  assert.equal(isUnlocked(p, 2), true);
  assert.equal(isUnlocked(p, 3), false);
  p = withUnlock(p, 2);
  assert.equal(p.unlocked, 3);
  p = withUnlock(p, LEVEL_COUNT);
  assert.equal(p.unlocked, LEVEL_COUNT, 'the last level cannot unlock a sixth');
});

test('unlocking never locks anything again', () => {
  const p = withUnlock({ unlocked: 4, best: {} }, 1);
  assert.equal(p.unlocked, 4);
});

test('the best score survives a reload and a worse replay does not overwrite it', () => {
  const store = memStore();
  let p = withBest(withUnlock(defaultProgress(), 1), 1, 750);
  assert.equal(saveProgress(p, store), true);

  const reloaded = loadProgress(store);
  assert.equal(bestScore(reloaded, 1), 750);

  const worse = withBest(reloaded, 1, 500);
  assert.equal(bestScore(worse, 1), 750, 'a lower score must not replace the best');
  const equal = withBest(reloaded, 1, 750);
  assert.equal(bestScore(equal, 1), 750);
  const better = withBest(reloaded, 1, 800);
  assert.equal(bestScore(better, 1), 800);
});

test('a lost level records no score', () => {
  const p = defaultProgress();
  assert.equal(bestScore(p, 1), null);
  assert.equal(saveProgress(p, memStore()), true);
});

test('missing storage is tolerated, not thrown', () => {
  assert.deepEqual(loadProgress(undefined), defaultProgress());
  assert.equal(saveProgress(defaultProgress(), undefined), false);
});

test('storage that throws is tolerated, not thrown', () => {
  const hostile = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); } };
  assert.deepEqual(loadProgress(hostile), defaultProgress());
  assert.equal(saveProgress(defaultProgress(), hostile), false);
});

test('garbage in the store degrades to defaults instead of crashing', () => {
  const cases = [
    'not json at all',
    'null',
    '[]',
    '"a string"',
    '42',
    '{}',
    JSON.stringify({ unlocked: 'two' }),
    JSON.stringify({ unlocked: 99 }),
    JSON.stringify({ unlocked: 0 }),
    JSON.stringify({ unlocked: -3 }),
    JSON.stringify({ unlocked: 2.5 }),
    JSON.stringify({ best: 'nope' }),
    JSON.stringify({ best: [] }),
    JSON.stringify({ best: { 1: 'high' } }),
    JSON.stringify({ best: { 1: -5 } }),
    JSON.stringify({ best: { 1: 9999 } }),
    JSON.stringify({ best: { 99: 500 } }),
    JSON.stringify({ best: { 1: null } })
  ];
  for (const raw of cases) {
    const p = loadProgress(memStore({ [KEY]: raw }));
    assert.equal(Number.isInteger(p.unlocked), true, `unlocked survived ${raw}`);
    assert.ok(p.unlocked >= 1 && p.unlocked <= LEVEL_COUNT, `unlocked out of range for ${raw}`);
    for (const v of Object.values(p.best)) {
      assert.equal(Number.isInteger(v) && v >= 0 && v <= 1000, true, `bad score kept from ${raw}`);
    }
  }
});

test('valid parts of a partly corrupt store are kept', () => {
  const p = loadProgress(memStore({ [KEY]: JSON.stringify({ unlocked: 3, best: { 1: 750, 2: 'oops', 7: 500 } }) }));
  assert.equal(p.unlocked, 3);
  assert.equal(bestScore(p, 1), 750);
  assert.equal(bestScore(p, 2), null);
});

test('withBest refuses nonsense without corrupting the store', () => {
  const p = defaultProgress();
  for (const [level, score] of [[0, 500], [6, 500], [1, -1], [1, 1001], [1, 'x'], [1, null], [1, undefined]]) {
    assert.deepEqual(withBest(p, level, score), p, `${level}/${score} should be ignored`);
  }
  assert.equal(withBest(p, 1, 0).best[1], 0, 'a legitimate zero is still a score');
});
