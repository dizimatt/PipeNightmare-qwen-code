import { PIECE_TYPES } from './pieces.js';

export const DEFAULT_QUEUE_SIZE = 5;

// R-003: a bounded-window FIFO. Taking the front removes it, shifts the
// window up and draws a fresh piece at the back, so it never runs out.
// The rng is injected so tests can make the stream deterministic.
export class PipeQueue {
  constructor({ size = DEFAULT_QUEUE_SIZE, rng = Math.random, types = PIECE_TYPES } = {}) {
    if (!Number.isInteger(size) || size < 1) throw new Error(`Queue size must be a positive integer, got ${size}`);
    if (typeof rng !== 'function') throw new Error('Queue rng must be a function');
    if (!Array.isArray(types) || types.length === 0) throw new Error('Queue types must be a non-empty array');
    this.size = size;
    this.rng = rng;
    this.types = types;
    this.items = [];
    for (let i = 0; i < size; i += 1) this.items.push(this.draw());
  }

  draw() {
    const i = Math.min(this.types.length - 1, Math.floor(this.rng() * this.types.length));
    return this.types[i];
  }

  // R-004: pieces are placed in their default orientation, so the queue
  // carries a type only and rotation is always 0 until the player turns it.
  peek(offset = 0) {
    return this.items[offset] ?? null;
  }

  view(count = this.size) {
    return this.items.slice(0, Math.min(count, this.size));
  }

  take() {
    const type = this.items.shift();
    this.items.push(this.draw());
    return type;
  }
}

// R-003: "There is no skip or discard control" — deliberately no other method.
