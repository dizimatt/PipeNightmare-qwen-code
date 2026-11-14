import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlow, stepWater, FlowPhase, SpillReason, formatSpill } from '../src/logic/water.js';
import { Grid } from '../src/logic/grid.js';
import { findRoute, piecesForRoute } from '../src/logic/route.js';
import { E, N, S, W } from '../src/logic/directions.js';

function run(level, placements, steps = 200) {
  const grid = new Grid(level);
  for (const p of placements) grid.place(p.row, p.col, p.type, p.rotation);
  let state = createFlow(level);
  const trace = [];
  for (let i = 0; i < steps && state.phase === FlowPhase.FLOWING; i += 1) {
    state = stepWater(state, grid);
    trace.push(state.phase === FlowPhase.FLOWING ? { ...state.cursor } : state.phase);
  }
  return { state, grid, trace };
}

const OPEN_4 = { width: 4, height: 1, sourceRow: 0, drainRow: 0, blocked: [] };
const H = (row, col) => ({ row, col, type: 'straight', rotation: 0 });

test('water crossing a straight run reaches the drain and wins', () => {
  const { state, trace } = run(OPEN_4, [H(0, 0), H(0, 1), H(0, 2), H(0, 3)]);
  assert.equal(state.phase, FlowPhase.WON);
  assert.deepEqual(trace.map((t) => (typeof t === 'string' ? t : [t.row, t.col])), [
    [0, 0], [0, 1], [0, 2], [0, 3], 'won'
  ]);
});

test('water enters the first cell from the source side only', () => {
  const { state } = run(OPEN_4, []);
  assert.equal(state.phase, FlowPhase.SPILLED);
  assert.equal(state.spill.reason, SpillReason.GAP);
  assert.equal(state.spill.fromCol, -1, 'nothing had been entered yet');
  assert.match(formatSpill(state.spill), /at the source/);
});

test('a tile facing the wrong way stops the water at the entrance', () => {
  const { state } = run(OPEN_4, [{ row: 0, col: 0, type: 'straight', rotation: 1 }]);
  assert.equal(state.spill.reason, SpillReason.DEAD_END);
});

test('an empty cell mid-route spills', () => {
  const { state } = run(OPEN_4, [H(0, 0), H(0, 1), H(0, 3)]);
  assert.equal(state.phase, FlowPhase.SPILLED);
  assert.equal(state.spill.reason, SpillReason.GAP);
  assert.deepEqual([state.spill.fromCol, state.spill.toCol], [1, 2]);
});

test('water meeting a blocked cell spills', () => {
  const level = { ...OPEN_4, blocked: [{ row: 0, col: 2 }] };
  const { state } = run(level, [H(0, 0), H(0, 1)]);
  assert.equal(state.spill.reason, SpillReason.BLOCKED);
  assert.match(formatSpill(state.spill), /blocked cell/);
});

test('water leaving the grid edge spills instead of winning', () => {
  const level = { width: 4, height: 2, sourceRow: 0, drainRow: 1, blocked: [] };
  // rot 3 elbow = {W, N}: admits from the source then dumps out the top edge.
  const { state } = run(level, [{ row: 0, col: 0, type: 'elbow', rotation: 3 }]);
  assert.equal(state.spill.reason, SpillReason.EDGE);
  assert.equal(state.spill.dir, N);
});

test('running past the drain row on the right edge is a spill, not a win', () => {
  const level = { width: 4, height: 2, sourceRow: 0, drainRow: 1, blocked: [] };
  const { state } = run(level, [H(0, 0), H(0, 1), H(0, 2), H(0, 3)]);
  assert.equal(state.phase, FlowPhase.SPILLED);
  assert.equal(state.spill.reason, SpillReason.EDGE);
});

test('a dead end spills when the next tile has no facing opening', () => {
  const { state } = run(OPEN_4, [H(0, 0), { row: 0, col: 1, type: 'straight', rotation: 1 }, H(0, 2), H(0, 3)]);
  assert.equal(state.spill.reason, SpillReason.DEAD_END);
  assert.match(formatSpill(state.spill), /dead end/);
});

test('an elbow turns the water and it keeps flowing correctly', () => {
  const level = { width: 3, height: 3, sourceRow: 0, drainRow: 2, blocked: [] };
  const route = [
    { row: 0, col: 0, type: 'straight', rotation: 0 }, // {W,E} admits the source
    { row: 0, col: 1, type: 'elbow', rotation: 2 }, // {S,W} turns it downward
    { row: 1, col: 1, type: 'straight', rotation: 1 }, // {N,S}
    { row: 2, col: 1, type: 'elbow', rotation: 0 }, // {N,E} turns it right
    { row: 2, col: 2, type: 'straight', rotation: 0 } // {W,E} into the drain
  ];
  const { state } = run(level, route);
  assert.equal(state.phase, FlowPhase.WON, formatSpill(state.spill));
});

test('a tile locks the moment water enters it', () => {
  const { state, grid } = run(OPEN_4, [H(0, 0), H(0, 1), H(0, 2), H(0, 3)], 2);
  assert.equal(grid.isLocked(0, 0), true);
  assert.equal(grid.isLocked(0, 1), true);
  assert.equal(grid.isLocked(0, 2), false, 'water has not reached it yet');
  assert.equal(grid.canRotate(0, 0).ok, false);
  assert.equal(grid.canRotate(0, 1).ok, false);
  assert.equal(grid.canRotate(0, 2).ok, true, 'ahead of the water, the player may still turn it');
  assert.equal(grid.canRotate(0, 2).reason, null);
});

test('every tile the water passed through stays locked', () => {
  const level = { width: 3, height: 3, sourceRow: 0, drainRow: 2, blocked: [] };
  const { state, grid } = run(level, [
    { row: 0, col: 0, type: 'straight', rotation: 0 },
    { row: 0, col: 1, type: 'elbow', rotation: 2 },
    { row: 1, col: 1, type: 'straight', rotation: 1 },
    { row: 2, col: 1, type: 'elbow', rotation: 0 },
    { row: 2, col: 2, type: 'straight', rotation: 0 }
  ]);
  assert.equal(state.phase, FlowPhase.WON);
  state.path.forEach(({ row, col }) => assert.equal(grid.isLocked(row, col), true));
});

test('the step is inert once the level is over', () => {
  const { state, grid } = run(OPEN_4, [H(0, 0), H(0, 1), H(0, 2), H(0, 3)]);
  const again = stepWater(state, grid);
  assert.equal(again.phase, FlowPhase.WON);
  const lost = run(OPEN_4, [H(0, 0)]);
  assert.equal(stepWater(lost.state, lost.grid).phase, FlowPhase.SPILLED);
});

test('the path records entry sides so the fill can be drawn per tile', () => {
  const level = { width: 3, height: 3, sourceRow: 0, drainRow: 2, blocked: [] };
  const { state } = run(level, [
    { row: 0, col: 0, type: 'straight', rotation: 0 },
    { row: 0, col: 1, type: 'elbow', rotation: 2 },
    { row: 1, col: 1, type: 'straight', rotation: 1 },
    { row: 2, col: 1, type: 'elbow', rotation: 0 },
    { row: 2, col: 2, type: 'straight', rotation: 0 }
  ]);
  assert.deepEqual(state.path.map((p) => [p.row, p.col, p.entry]), [
    [0, 0, W], [0, 1, W], [1, 1, N], [2, 1, N], [2, 2, W]
  ]);
});

test('a routed level replays as a real win through the simulation', () => {
  const level = {
    width: 5,
    height: 4,
    sourceRow: 0,
    drainRow: 3,
    blocked: [{ row: 1, col: 1 }, { row: 1, col: 2 }, { row: 2, col: 3 }, { row: 0, col: 3 }]
  };
  const route = findRoute(level);
  assert.ok(route, 'the test level must be routable');
  const pieces = piecesForRoute(level, route);
  const { state } = run(level, pieces);
  assert.equal(state.phase, FlowPhase.WON, formatSpill(state.spill));
  assert.equal(state.cursor.col, level.width - 1);
  assert.equal(state.cursor.row, level.drainRow);
});

test('blocking the only corridor makes a level unwinnable', () => {
  const level = { width: 3, height: 1, sourceRow: 0, drainRow: 0, blocked: [{ row: 0, col: 1 }] };
  assert.equal(findRoute(level), null);
});
