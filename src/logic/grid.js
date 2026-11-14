import { openings, isPieceType, nextRotation, normalizeRotation } from './pieces.js';

export const PlaceBlockReason = {
  OUT_OF_BOUNDS: 'out_of_bounds',
  BLOCKED: 'blocked',
  OCCUPIED: 'occupied'
};

export const RotateBlockReason = {
  EMPTY: 'empty',
  LOCKED: 'locked'
};

export function cellKey(row, col) {
  return `${row},${col}`;
}

export class Grid {
  constructor({ width, height, blocked = [] }) {
    this.width = width;
    this.height = height;
    this.cells = new Map();
    this.locked = new Set();
    this.tilesPlaced = 0;
    this.blocked = new Set(
      blocked.map(({ row, col }) => cellKey(row, col))
    );
  }

  inBounds(row, col) {
    return row >= 0 && row < this.height && col >= 0 && col < this.width;
  }

  isBlocked(row, col) {
    return this.blocked.has(cellKey(row, col));
  }

  at(row, col) {
    return this.cells.get(cellKey(row, col)) || null;
  }

  isLocked(row, col) {
    return this.locked.has(cellKey(row, col));
  }

  // R-004: a piece may go on any empty, in-bounds, non-blocked cell.
  canPlace(row, col) {
    if (!this.inBounds(row, col)) return { ok: false, reason: PlaceBlockReason.OUT_OF_BOUNDS };
    if (this.isBlocked(row, col)) return { ok: false, reason: PlaceBlockReason.BLOCKED };
    if (this.cells.has(cellKey(row, col))) return { ok: false, reason: PlaceBlockReason.OCCUPIED };
    return { ok: true, reason: null };
  }

  place(row, col, type, rotation = 0) {
    const check = this.canPlace(row, col);
    if (!check.ok) return { ok: false, reason: check.reason };
    if (!isPieceType(type)) return { ok: false, reason: 'bad_type' };
    this.cells.set(cellKey(row, col), { type, rotation: normalizeRotation(rotation) });
    this.tilesPlaced += 1;
    return { ok: true, reason: null, cell: this.at(row, col) };
  }

  // R-004: only a placed tile the water has not entered may rotate. A tile
  // that is not there at all also fails, which is what "does nothing" means.
  canRotate(row, col) {
    if (!this.inBounds(row, col)) return { ok: false, reason: PlaceBlockReason.OUT_OF_BOUNDS };
    if (!this.cells.has(cellKey(row, col))) return { ok: false, reason: RotateBlockReason.EMPTY };
    if (this.isLocked(row, col)) return { ok: false, reason: RotateBlockReason.LOCKED };
    return { ok: true, reason: null };
  }

  rotate(row, col) {
    const check = this.canRotate(row, col);
    if (!check.ok) return { ok: false, reason: check.reason };
    const cell = this.cells.get(cellKey(row, col));
    cell.rotation = nextRotation(cell.type, cell.rotation);
    return { ok: true, reason: null, cell };
  }

  // R-005: a tile is locked from the moment water enters it.
  lock(row, col) {
    this.locked.add(cellKey(row, col));
  }

  hasOpening(row, col, dir) {
    const cell = this.at(row, col);
    if (!cell) return false;
    return openings(cell.type, cell.rotation).includes(dir);
  }

  snapshot() {
    return {
      cells: new Map(this.cells),
      locked: new Set(this.locked),
      tilesPlaced: this.tilesPlaced
    };
  }
}
