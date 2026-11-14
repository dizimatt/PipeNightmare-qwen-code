import { E, opposite, deltaRow, deltaCol, dirLetter } from './directions.js';
import { openings, otherOpening } from './pieces.js';

export const FlowPhase = {
  FLOWING: 'flowing',
  WON: 'won',
  SPILLED: 'spilled'
};

// R-006 names exactly these four ways to lose.
export const SpillReason = {
  GAP: 'gap',
  BLOCKED: 'blocked',
  EDGE: 'edge',
  DEAD_END: 'dead_end'
};

export const SPILL_MESSAGE = {
  [SpillReason.GAP]: 'Water reached an empty cell.',
  [SpillReason.BLOCKED]: 'Water hit a blocked cell.',
  [SpillReason.EDGE]: 'Water escaped the grid.',
  [SpillReason.DEAD_END]: 'Water reached a dead end.'
};

export function createFlow(level) {
  return {
    level,
    phase: FlowPhase.FLOWING,
    cursor: null,
    path: [],
    spill: null
  };
}

function spill(state, reason, from, exitDir, to) {
  return {
    ...state,
    phase: FlowPhase.SPILLED,
    spill: { reason, fromRow: from.row, fromCol: from.col, dir: exitDir, toRow: to.row, toCol: to.col }
  };
}

// One call moves the water out of the tile it occupies and into the next.
// The scene owns timing and calls this once per filled tile, which is what
// makes the flow rate constant within a level (R-005).
export function stepWater(state, grid) {
  if (state.phase !== FlowPhase.FLOWING) return state;
  const level = state.level;

  let exitDir;
  let from;
  if (state.cursor === null) {
    exitDir = E;
    from = { row: level.sourceRow, col: -1 };
  } else {
    const cell = grid.at(state.cursor.row, state.cursor.col);
    if (!cell) return spill(state, SpillReason.GAP, state.cursor, E, state.cursor);
    exitDir = otherOpening(cell.type, cell.rotation, state.cursor.entry);
    from = { row: state.cursor.row, col: state.cursor.col };
  }

  const to = { row: from.row + deltaRow(exitDir), col: from.col + deltaCol(exitDir) };

  // The drain sits just outside the right edge on its own row.
  if (exitDir === E && from.col === level.width - 1 && from.row === level.drainRow) {
    return { ...state, phase: FlowPhase.WON };
  }

  if (!grid.inBounds(to.row, to.col)) return spill(state, SpillReason.EDGE, from, exitDir, to);
  if (grid.isBlocked(to.row, to.col)) return spill(state, SpillReason.BLOCKED, from, exitDir, to);

  const target = grid.at(to.row, to.col);
  if (!target) return spill(state, SpillReason.GAP, from, exitDir, to);

  const entry = opposite(exitDir);
  if (!openings(target.type, target.rotation).includes(entry)) {
    return spill(state, SpillReason.DEAD_END, from, exitDir, to);
  }

  grid.lock(to.row, to.col);
  const cursor = { row: to.row, col: to.col, entry };
  return { ...state, cursor, path: [...state.path, cursor] };
}

export function isOver(state) {
  return state.phase === FlowPhase.WON || state.phase === FlowPhase.SPILLED;
}

export function formatSpill(spillInfo) {
  if (!spillInfo) return '';
  const base = SPILL_MESSAGE[spillInfo.reason] || 'Water spilled.';
  if (spillInfo.fromCol < 0) return `${base} (at the source)`;
  return `${base} Leaving row ${spillInfo.fromRow + 1}, col ${spillInfo.fromCol + 1} heading ${dirLetter(spillInfo.dir).toUpperCase()}.`;
}
