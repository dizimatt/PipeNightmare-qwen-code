import test from 'node:test';
import assert from 'node:assert/strict';
import { PipeQueue, DEFAULT_QUEUE_SIZE } from '../src/logic/queue.js';

// Deterministic injected source, as R-003 requires.
function cycling(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

test('the queue starts full and shows the front first', () => {
  const q = new PipeQueue({ rng: () => 0 });
  assert.equal(q.size, DEFAULT_QUEUE_SIZE);
  assert.equal(q.items.length, DEFAULT_QUEUE_SIZE);
  assert.equal(q.peek(0), 'straight');
  assert.deepEqual(q.view(), ['straight', 'straight', 'straight', 'straight', 'straight']);
});

test('queue length is configurable per level', () => {
  assert.equal(new PipeQueue({ size: 3, rng: () => 0 }).items.length, 3);
  assert.throws(() => new PipeQueue({ size: 0 }), /positive integer/);
  assert.throws(() => new PipeQueue({ size: 2.5 }), /positive integer/);
});

test('taking the front shifts the window up and refills the back', () => {
  const q = new PipeQueue({ size: 3, rng: cycling([0, 1, 0, 1, 0, 1]) });
  assert.deepEqual(q.view(), ['straight', 'elbow', 'straight']);
  assert.equal(q.take(), 'straight');
  assert.deepEqual(q.view(), ['elbow', 'straight', 'elbow']);
  assert.equal(q.take(), 'elbow');
  assert.deepEqual(q.view(), ['straight', 'elbow', 'straight']);
});

test('the queue never runs out, however long the level is', () => {
  const q = new PipeQueue({ size: 5, rng: Math.random });
  for (let i = 0; i < 500; i += 1) {
    assert.ok(q.peek(0) === 'straight' || q.peek(0) === 'elbow');
    q.take();
    assert.equal(q.items.length, 5);
  }
});

test('both piece types show up over a normal level', () => {
  const seen = new Set();
  const q = new PipeQueue({ size: 5, rng: Math.random });
  for (let i = 0; i < 200; i += 1) {
    q.view().forEach((t) => seen.add(t));
    q.take();
  }
  assert.deepEqual([...seen].sort(), ['elbow', 'straight']);
});

test('an injected source makes draws reproducible', () => {
  const mk = () => new PipeQueue({ size: 4, rng: cycling([0.1, 0.9, 0.1, 0.9, 0.1, 0.9]) });
  assert.deepEqual(mk().view(), mk().view());
});

test('there is no skip or discard control', () => {
  const q = new PipeQueue({ rng: () => 0 });
  for (const name of ['skip', 'discard', 'drop', 'remove', 'clear']) {
    assert.equal(typeof q[name], 'undefined', `queue must not expose ${name}()`);
  }
  assert.deepEqual(Object.getPrototypeOf(q).take.name, 'take');
});

test('the front piece keeps its default orientation', () => {
  const q = new PipeQueue({ rng: () => 1 });
  assert.equal(q.peek(0), 'elbow', 'queue hands out a type; rotation is applied at placement');
});
