import { Grid } from '../logic/grid.js';
import { PipeQueue } from '../logic/queue.js';
import { createFlow, stepWater, FlowPhase, formatSpill } from '../logic/water.js';
import { parseLevelJson } from '../logic/level.js';
import { levelUrl } from '../levelUrl.js';
import { shapeKey } from '../logic/pieces.js';
import { scoreFor } from '../logic/scoring.js';
import { dirLetter } from '../logic/directions.js';
import { LEVEL_COUNT, loadProgress, saveProgress, withUnlock, withBest } from '../logic/storage.js';
import { image, slice } from '../assets.js';
import { text, button, iconButton } from './ui.js';

const TILE = 64;
const FILL_STEPS = 10;
const FAST_SPEED = 3;

const BOARD_X = 30;
const BOARD_W = 880;
const BOARD_Y = 104;
const BOARD_H = 600;
const QUEUE_X = 1096;
const SLOT_PITCH = 84;

export class GameScene extends Phaser.Scene {
  constructor() {
    super('game');
  }

  init(data) {
    this.levelIndex = Number.isInteger(data.level) ? data.level : 1;
    this.textKey = `level-text-${this.levelIndex}`;
    this.fetchFailed = null;
  }

  preload() {
    // Re-read the file every attempt so editing it changes the level with no
    // code change (R-002), and a Retry starts from the data on disk.
    this.load.on('loaderror', (file) => {
      if (file && String(file.url).includes(`level-${this.levelIndex}`)) this.fetchFailed = file.url;
    });
    this.cache.text.remove(this.textKey);
    this.load.text(this.textKey, levelUrl(this.levelIndex));
  }

  create() {
    const label = `level-${this.levelIndex}.json`;
    if (this.fetchFailed) {
      this.scene.start('error', {
        title: `Level ${this.levelIndex} could not be fetched`,
        lines: [`Nothing was returned for ${this.fetchFailed}.`, 'Serve the folder with python3 -m http.server and reload.'],
        backLabel: 'Back to levels',
        backScene: 'menu'
      });
      return;
    }
    const body = this.cache.text.get(this.textKey);
    const parsed = parseLevelJson(body, label);
    if (!parsed.ok) {
      this.scene.start('error', {
        title: `Level ${this.levelIndex} is not valid`,
        lines: parsed.errors,
        backLabel: 'Back to levels',
        backScene: 'menu'
      });
      return;
    }

    this.level = parsed.level;
    this.grid = new Grid(this.level);
    this.queue = new PipeQueue({ size: this.level.queueSize });
    // No flow object yet: the water has not left the source, so there is
    // nothing to step and nothing to report as "flowing" during the delay.
    this.flow = null;
    this.phase = 'countdown';
    this.countdown = this.level.startDelayMs;
    this.fillT = 0;
    this.fast = false;
    this.over = false;

    image(this, 640, 360, 'bg').setDepth(0);
    this.layout();
    this.buildBoard();
    this.buildQueuePanel();
    this.buildHud();
    this.buildControls();

    this.input.on('pointermove', (p) => this.onHover(p));
    this.input.on('pointerdown', (p) => this.onClick(p));
    this.events.once('shutdown', () => {
      this.input.off('pointermove');
      this.input.off('pointerdown');
    });

    this.refreshCells();
    this.refreshQueue();
    this.refreshWater();
    this.refreshStatus();
  }

  layout() {
    const { width, height } = this.level;
    const gridW = width * TILE;
    const gridH = height * TILE;
    const boardW = gridW + TILE * 2;
    this.originX = BOARD_X + (BOARD_W - boardW) / 2 + TILE;
    this.originY = BOARD_Y + (BOARD_H - gridH) / 2;
    this.cellCenter = (row, col) => ({
      x: this.originX + col * TILE + TILE / 2,
      y: this.originY + row * TILE + TILE / 2
    });
  }

  buildBoard() {
    const { width, height, blocked, sourceRow, drainRow } = this.level;
    const blockedSet = new Set(blocked.map((b) => `${b.row},${b.col}`));

    slice(this, this.originX + width * TILE / 2, this.originY + height * TILE / 2,
      'atlas', 'panel', width * TILE + 24, height * TILE + 24, 20)
      .setTint(0x0d1728).setDepth(0);

    this.art = [];
    for (let row = 0; row < height; row += 1) {
      const line = [];
      for (let col = 0; col < width; col += 1) {
        const { x, y } = this.cellCenter(row, col);
        const isBlocked = blockedSet.has(`${row},${col}`);
        const base = image(this, x, y, 'atlas', isBlocked ? 'tile_blocked' : 'tile_empty').setDepth(1);
        const pipe = image(this, x, y, 'atlas', 'pipe_ew').setVisible(false).setDepth(2);
        const water = image(this, x, y, 'atlas', 'water_ew_w_1').setVisible(false).setDepth(3);
        line.push({ base, pipe, water });
      }
      this.art.push(line);
    }

    const src = this.cellCenter(sourceRow, -1);
    this.sourceArt = image(this, src.x, src.y, 'atlas', 'source').setDepth(2);
    const drn = this.cellCenter(drainRow, width);
    this.drainArt = image(this, drn.x, drn.y, 'atlas', 'drain').setDepth(2);

    this.hover = image(this, 0, 0, 'atlas', 'cell_hover').setVisible(false).setDepth(4);
    this.ghost = image(this, 0, 0, 'atlas', 'pipe_ew').setVisible(false).setAlpha(0.45).setDepth(4);
    this.spillArt = image(this, 0, 0, 'atlas', 'spill').setVisible(false).setDepth(6);
  }

  buildQueuePanel() {
    const n = this.level.queueSize;
    const h = n * SLOT_PITCH + 100;
    const y = BOARD_Y + BOARD_H / 2;
    const top = y - h / 2;

    slice(this, QUEUE_X, y, 'atlas', 'panel', 190, h, 20).setTint(0x101c31).setDepth(5);
    text(this, QUEUE_X, top + 24, 'QUEUE', 17, '#8ea6c4').setDepth(6);

    this.slots = [];
    for (let i = 0; i < n; i += 1) {
      const sy = top + 76 + i * SLOT_PITCH;
      const frame = slice(this, QUEUE_X, sy, 'atlas', i === 0 ? 'slot_active' : 'slot', 76, 76, 12).setDepth(6);
      const art = image(this, QUEUE_X, sy, 'atlas', 'pipe_ew').setDepth(7);
      this.slots.push({ frame, art });
    }
    text(this, QUEUE_X, top + h - 26, 'next up', 13, '#5f7796').setDepth(6);
  }

  buildHud() {
    text(this, 30, 34, 'PIPE NIGHTMARE', 19, '#dce8f6').setOrigin(0, 0.5).setDepth(20);
    const name = this.level.name && this.level.name !== `level-${this.levelIndex}.json`
      ? `${this.levelIndex}. ${this.level.name}`
      : `Level ${this.levelIndex}`;
    text(this, 30, 66, name, 15, '#8ea6c4').setOrigin(0, 0.5).setDepth(20);

    this.statusArt = text(this, 640, 50, '', 20, '#6ce2f5').setDepth(20);
    this.tilesArt = text(this, QUEUE_X, BOARD_Y + BOARD_H - 8, '', 15, '#8ea6c4').setDepth(20);
  }

  buildControls() {
    this.homeBtn = iconButton(this, 1140, 44, 'icon_home', () => this.scene.start('menu'), { tooltip: 'Level select' });
    this.retryBtn = iconButton(this, 1200, 44, 'icon_restart', () => this.scene.restart(), { tooltip: 'Restart' });
    this.fastBtn = iconButton(this, 1080, 44, 'icon_fast_off', () => this.toggleFast(), { tooltip: 'Fast forward 3x' });
  }

  toggleFast() {
    this.fast = !this.fast;
    this.fastBtn.setFrame(this.fast ? 'icon_fast_on' : 'icon_fast_off');
    this.fastBtn.bg.setFrame(this.fast ? 'btn_hover' : 'btn_normal');
    this.refreshStatus();
  }

  cellFromPointer(p) {
    const col = Math.floor((p.x - this.originX) / TILE);
    const row = Math.floor((p.y - this.originY) / TILE);
    if (row < 0 || row >= this.level.height || col < 0 || col >= this.level.width) return null;
    return { row, col };
  }

  onClick(p) {
    if (this.over) return;
    const hit = this.cellFromPointer(p);
    if (!hit) return;
    const { row, col } = hit;

    if (this.grid.canPlace(row, col).ok) {
      const type = this.queue.take();
      const placed = this.grid.place(row, col, type, 0);
      if (!placed.ok) return;
      this.refreshCells();
      this.refreshQueue();
      this.refreshStatus();
      this.onHover(p);
      return;
    }
    if (this.grid.canRotate(row, col).ok) {
      this.grid.rotate(row, col);
      this.refreshCells();
      this.refreshWater();
    }
  }

  onHover(p) {
    const hit = this.cellFromPointer(p);
    if (!hit || this.over) {
      this.hover.setVisible(false);
      this.ghost.setVisible(false);
      return;
    }
    const { row, col } = hit;
    const { x, y } = this.cellCenter(row, col);
    const placeable = this.grid.canPlace(row, col).ok;
    const rotatable = this.grid.canRotate(row, col).ok;

    if (!placeable && !rotatable) {
      this.hover.setVisible(false);
      this.ghost.setVisible(false);
      return;
    }
    this.hover.setPosition(x, y).setVisible(true);
    if (placeable) {
      this.ghost
        .setFrame(`pipe_${shapeKey(this.queue.peek(0), 0)}`)
        .setPosition(x, y)
        .setVisible(true);
    } else {
      this.ghost.setVisible(false);
    }
  }

  refreshCells() {
    for (let row = 0; row < this.level.height; row += 1) {
      for (let col = 0; col < this.level.width; col += 1) {
        const cell = this.grid.at(row, col);
        const art = this.art[row][col];
        art.pipe.setVisible(!!cell);
        if (cell) art.pipe.setFrame(`pipe_${shapeKey(cell.type, cell.rotation)}`);
      }
    }
  }

  refreshQueue() {
    const view = this.queue.view();
    this.slots.forEach((slot, i) => {
      const type = view[i];
      slot.art.setVisible(!!type).setFrame(type ? `pipe_${shapeKey(type, 0)}` : 'pipe_ew');
      slot.frame.setFrame(i === 0 ? 'slot_active' : 'slot');
    });
  }

  refreshWater() {
    for (const line of this.art) for (const cell of line) cell.water.setVisible(false);
    if (!this.flow) return;

    const path = this.flow.path;
    path.forEach((p, i) => {
      const cell = this.grid.at(p.row, p.col);
      if (!cell) return;
      const last = i === path.length - 1;
      const step = last && this.phase === 'flowing'
        ? Math.min(FILL_STEPS, Math.max(1, Math.round(this.fillT * FILL_STEPS)))
        : FILL_STEPS;
      this.art[p.row][p.col].water
        .setFrame(`water_${shapeKey(cell.type, cell.rotation)}_${dirLetter(p.entry)}_${step}`)
        .setVisible(true);
    });
  }

  refreshStatus() {
    if (this.over) return;
    const speed = this.fast ? ' · 3×' : '';
    let label;
    if (this.phase === 'countdown') {
      label = `Water in ${(this.countdown / 1000).toFixed(1)}s${speed}`;
    } else if (!this.flow || !this.flow.cursor) {
      label = `Water leaving the source${speed}`;
    } else {
      label = `Water in the pipe${speed}`;
    }
    this.statusArt.setText(label);
    this.tilesArt.setText(`tiles placed  ${this.grid.tilesPlaced}`);
  }

  update(_time, delta) {
    if (this.over) return;
    const speed = this.fast ? FAST_SPEED : 1;

    if (this.phase === 'countdown') {
      this.countdown -= delta * speed;
      if (this.countdown <= 0) {
        this.countdown = 0;
        this.phase = 'flowing';
        this.flow = createFlow(this.level);
        this.fillT = 0;
      }
      this.refreshStatus();
      return;
    }

    this.fillT += (delta * speed) / this.level.waterMsPerTile;
    let guard = 0;
    while (this.fillT >= 1 && !this.over && guard < 400) {
      this.fillT -= 1;
      guard += 1;
      this.advance();
    }
    this.refreshWater();
    this.refreshStatus();
  }

  advance() {
    this.flow = stepWater(this.flow, this.grid);
    if (this.flow.phase === FlowPhase.WON) this.win();
    else if (this.flow.phase === FlowPhase.SPILLED) this.lose();
  }

  win() {
    this.over = true;
    this.drainArt.setTint(0x6ce2f5);
    const score = scoreFor(this.grid.tilesPlaced);

    let progress = loadProgress();
    progress = withUnlock(progress, this.levelIndex);
    const before = progress.best[this.levelIndex];
    progress = withBest(progress, this.levelIndex, score);
    saveProgress(progress);
    const improved = before === undefined || score > before;

    this.showOverlay({
      title: 'Water delivered',
      accent: '#4fd39a',
      lines: [`score ${score}`, `tiles used ${this.grid.tilesPlaced}`, improved ? 'new best!' : `best ${progress.best[this.levelIndex]}`],
      next: this.levelIndex < LEVEL_COUNT
    });
  }

  lose() {
    this.over = true;
    const s = this.flow.spill;
    const at = s.fromCol < 0 ? this.cellCenter(this.level.sourceRow, -1) : this.cellCenter(s.fromRow, s.fromCol);
    this.spillArt.setPosition(at.x, at.y).setVisible(true);
    this.hover.setVisible(false);
    this.ghost.setVisible(false);

    this.showOverlay({
      title: 'Water spilled',
      accent: '#f08a97',
      lines: [formatSpill(s), `tiles placed ${this.grid.tilesPlaced}`, 'no score'],
      next: false
    });
  }

  showOverlay({ title, accent, lines, next }) {
    slice(this, 640, 360, 'atlas', 'panel', 1280, 720, 20)
      .setTint(0x060c17).setAlpha(0.74).setDepth(40);
    const p = slice(this, 640, 340, 'atlas', 'panel', 520, 300, 20)
      .setTint(0x14243f).setDepth(41);
    p.on('pointerdown', () => {});

    text(this, 640, 260, title, 34, accent).setDepth(42);
    text(this, 640, 320, lines.join('\n'), 18, '#b9cbe2', { align: 'center', lineSpacing: 8 }).setDepth(42);

    button(this, 520, 400, 'Retry', () => this.scene.restart(), { width: 170, depth: 43 });
    button(this, 700, 400, 'Level select', () => this.scene.start('menu'), { width: 170, depth: 43 });
    if (next) {
      button(this, 640, 470, `Level ${this.levelIndex + 1}`, () => {
        this.scene.start('game', { level: this.levelIndex + 1 });
      }, { width: 220, frame: 'btn_success', depth: 43 });
    }
  }
}
