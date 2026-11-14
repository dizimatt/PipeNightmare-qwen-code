import { Grid } from './grid.js';
import { N, E, S, W, opposite } from './directions.js';

const STEPS = [
  { dir: N, dr: -1, dc: 0 },
  { dir: E, dr: 0, dc: 1 },
  { dir: S, dr: 1, dc: 0 },
  { dir: W, dr: 0, dc: -1 }
];

// Any two adjacent open cells can always be joined: entry and exit on
// opposite sides is a straight, anything else is an elbow, and the queue
// (R-003) offers both without limit. So reachability of the drain reduces
// to a flood fill over non-blocked cells, and the shortest such path is the
// fewest tiles the level can be beaten with.
export function findRoute(level) {
  const { width, height, sourceRow, drainRow, blocked } = level;
  const grid = new Grid({ width, height, blocked });
  const start = { row: sourceRow, col: 0 };
  const goal = { row: drainRow, col: width - 1 };

  if (grid.isBlocked(start.row, start.col) || grid.isBlocked(goal.row, goal.col)) return null;

  const prev = new Map();
  const seen = new Set([`${start.row},${start.col}`]);
  const pending = [start];
  let head = 0;

  while (head < pending.length) {
    const cur = pending[head++];
    if (cur.row === goal.row && cur.col === goal.col) return untrace(prev, cur);
    for (const { dr, dc } of STEPS) {
      const row = cur.row + dr;
      const col = cur.col + dc;
      const key = `${row},${col}`;
      if (!grid.inBounds(row, col) || grid.isBlocked(row, col) || seen.has(key)) continue;
      seen.add(key);
      prev.set(key, { row: cur.row, col: cur.col });
      pending.push({ row, col });
    }
  }
  return null;
}

function untrace(prev, end) {
  const path = [];
  let cur = end;
  while (cur) {
    path.unshift({ row: cur.row, col: cur.col });
    const p = prev.get(`${cur.row},${cur.col}`);
    cur = p ? { row: p.row, col: p.col } : null;
  }
  return path;
}

function dirFromTo(a, b) {
  const step = STEPS.find((s) => a.row + s.dr === b.row && a.col + s.dc === b.col);
  if (!step) throw new Error(`Cells ${JSON.stringify(a)} and ${JSON.stringify(b)} are not adjacent`);
  return step.dir;
}

export function pieceFor(entry, exit) {
  if (entry === exit) throw new Error(`A tile cannot both admit and emit on side ${entry}`);
  if (opposite(entry) === exit) {
    return { type: 'straight', rotation: (entry === E || entry === W) ? 0 : 1 };
  }
  for (let r = 0; r < 4; r += 1) {
    const open = [r % 4, (r + 1) % 4];
    if (open.includes(entry) && open.includes(exit)) return { type: 'elbow', rotation: r };
  }
  throw new Error(`No elbow connects side ${entry} and side ${exit}`);
}

// Turns a route into the exact pieces that must be placed to flow it, ready
// to feed through the real water simulation. Travelling in direction d means
// the tile admits water on the opposite side, which is R-005's rule.
export function piecesForRoute(level, route) {
  if (!route) return null;
  return route.map((cell, i) => {
    const entry = i === 0 ? W : opposite(dirFromTo(route[i - 1], cell));
    const exit = i === route.length - 1 ? E : dirFromTo(cell, route[i + 1]);
    return { row: cell.row, col: cell.col, ...pieceFor(entry, exit) };
  });
}

export function isWinnable(level) {
  return findRoute(level) !== null;
}

export { N, E, S, W };
