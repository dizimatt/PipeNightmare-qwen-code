import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateLevel } from '../src/logic/level.js';
import { findRoute, piecesForRoute, isWinnable } from '../src/logic/route.js';
import { Grid } from '../src/logic/grid.js';
import { createFlow, stepWater, FlowPhase, formatSpill } from '../src/logic/water.js';
import { scoreFor } from '../src/logic/scoring.js';
import { PipeQueue } from '../src/logic/queue.js';

const LEVEL_COUNT = 5;

function load(n) {
  const label = `level-${n}.json`;
  const raw = readFileSync(new URL(`../levels/${label}`, import.meta.url), 'utf8');
  const res = validateLevel(JSON.parse(raw), label);
  assert.equal(res.ok, true, `${label} is invalid: ${res.errors.join('; ')}`);
  return { label, level: res.level };
}

// Replays the level with the real rules: place the route's pieces, then step
// the water until it resolves. A route that only works in theory is not a
// winnable level.
function playOut(level) {
  const route = findRoute(level);
  if (!route) return { route: null, phase: 'unroutable', spill: null, tiles: null };
  const grid = new Grid(level);
  piecesForRoute(level, route).forEach((p) => {
    const r = grid.place(p.row, p.col, p.type, p.rotation);
    assert.equal(r.ok, true, `route wanted a piece at ${p.row},${p.col} that placement refuses`);
  });
  let state = createFlow(level);
  for (let i = 0; i < level.width * level.height * 4 && state.phase === FlowPhase.FLOWING; i += 1) {
    state = stepWater(state, grid);
  }
  return { route, phase: state.phase, spill: state.spill, tiles: grid.tilesPlaced, grid };
}

test('exactly five level files exist and all load without error', () => {
  const names = [];
  for (let n = 1; n <= LEVEL_COUNT; n += 1) {
    const { label } = load(n);
    names.push(label);
  }
  assert.deepEqual(names, ['level-1.json', 'level-2.json', 'level-3.json', 'level-4.json', 'level-5.json']);
});

test('every level is winnable by its shortest route, replayed through the water sim', () => {
  for (let n = 1; n <= LEVEL_COUNT; n += 1) {
    const { label, level } = load(n);
    const { phase, spill, tiles } = playOut(level);
    assert.equal(phase, FlowPhase.WON, `${label} did not win: ${formatSpill(spill)}`);
    assert.ok(tiles <= 40, `${label} needs ${tiles} tiles, which is more than the grid can sensibly hold`);
  }
});

test('no level routes through a blocked cell or off the grid', () => {
  for (let n = 1; n <= LEVEL_COUNT; n += 1) {
    const { label, level } = load(n);
    const blocked = new Set(level.blocked.map((b) => `${b.row},${b.col}`));
    const route = findRoute(level);
    assert.ok(route, `${label} has no route`);
    route.forEach((c) => {
      assert.ok(!blocked.has(`${c.row},${c.col}`), `${label} routes through a blocked cell`);
      assert.ok(c.row >= 0 && c.row < level.height && c.col >= 0 && c.col < level.width, `${label} route leaves the grid`);
    });
    assert.equal(route[0].col, 0, `${label} route must start at the source column`);
    assert.equal(route.at(-1).col, level.width - 1, `${label} route must end at the drain column`);
  }
});

test('difficulty rises across the five levels', () => {
  const levels = Array.from({ length: LEVEL_COUNT }, (_, i) => load(i + 1).level);
  const cells = levels.map((l) => l.width * l.height);
  const delays = levels.map((l) => l.startDelayMs);
  const speeds = levels.map((l) => l.waterMsPerTile);
  const walls = levels.map((l) => l.blocked.length);

  // R-007 lists the levers with an "or", so grid size is allowed to go down
  // on any one level; the three levers that must move every step are the
  // delay, the water speed and the wall count.
  assert.ok(delays.every((d, i) => i === 0 || d < delays[i - 1]), 'start delay must strictly shrink');
  assert.ok(speeds.every((s, i) => i === 0 || s < speeds[i - 1]), 'water must strictly get faster');
  assert.ok(walls.every((n, i) => i === 0 || n >= walls[i - 1]), 'blocked cells must not decrease');
  assert.ok(walls.at(-1) > walls[0], 'the last level must have more blocked cells than the first');
  assert.ok(cells.at(-1) > cells[0], 'the last grid must be bigger than the first');
});

test('a perfect run of each level still leaves something to aim at', () => {
  for (let n = 1; n <= LEVEL_COUNT; n += 1) {
    const { label, level } = load(n);
    const { tiles } = playOut(level);
    const best = scoreFor(tiles);
    assert.ok(best > 0, `${label} cannot be scored above 0 even on its shortest route (${tiles} tiles)`);
    assert.ok(tiles >= level.width, `${label} route is shorter than the grid is wide`);
  }
});

test('the front piece can always be placed somewhere on a fresh level', () => {
  for (let n = 1; n <= LEVEL_COUNT; n += 1) {
    const { label, level } = load(n);
    const grid = new Grid(level);
    const queue = new PipeQueue({ size: level.queueSize, rng: () => 0 });
    const open = [];
    for (let row = 0; row < level.height; row += 1) {
      for (let col = 0; col < level.width; col += 1) {
        if (grid.canPlace(row, col).ok) open.push([row, col]);
      }
    }
    assert.ok(open.length >= level.width, `${label} leaves too few cells to work with`);
    assert.ok(grid.canPlace(level.sourceRow, 0).ok, `${label} blocks its own source cell`);
    assert.equal(queue.peek(0), 'straight');
  }
});

test('changing level data alone changes the level, with no code edit', () => {
  const base = {
    name: 'synthetic',
    width: 3,
    height: 1,
    sourceRow: 0,
    drainRow: 0,
    blocked: [],
    queueSize: 5,
    startDelayMs: 1000,
    waterMsPerTile: 1000
  };
  assert.equal(isWinnable(base), true);

  // One wall in a 3x1 grid seals the only corridor.
  assert.equal(findRoute({ ...base, blocked: [{ row: 0, col: 1 }] }), null);

  // The same wall, but the data now allows a way round.
  assert.ok(findRoute({ ...base, height: 3, blocked: [{ row: 0, col: 1 }] }));

  // Timing is data too: the loader must hand the new value to the game.
  assert.equal(validateLevel({ ...base, waterMsPerTile: 250 }, 'x.json').level.waterMsPerTile, 250);
});
