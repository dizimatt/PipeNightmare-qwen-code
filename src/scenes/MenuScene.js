import { LEVEL_COUNT, loadProgress, bestScore, isUnlocked } from '../logic/storage.js';
import { parseLevelJson } from '../logic/level.js';
import { levelUrl } from '../levelUrl.js';
import { image, slice } from '../assets.js';
import { text } from './ui.js';

const LEVEL_NAMES = Array.from({ length: LEVEL_COUNT }, (_, i) => i + 1);

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('menu');
  }

  preload() {
    // Drop the cache entries first so re-visiting the menu re-reads the files:
    // editing a level JSON must change the level with no code change (R-002).
    this.broken = {};
    this.load.on('loaderror', (file) => {
      const m = /level-(\d+)\.json/.exec(file?.url || '');
      if (m) this.broken[Number(m[1])] = `Could not fetch ${file.url}`;
    });
    for (const n of LEVEL_NAMES) {
      // Loaded as text, not json: Phaser's json loader throws an uncaught
      // SyntaxError on a malformed file, which would break R-001's clean
      // console. Parsing here turns it into the readable message R-002 wants.
      this.cache.text.remove(`menu-level-${n}`);
      this.load.text(`menu-level-${n}`, levelUrl(n));
    }
  }

  create() {
    image(this, 640, 360, 'bg').setDepth(0);
    image(this, 640, 132, 'title').setDepth(5);

    text(this, 640, 240, 'Click a cell to lay the pipe at the front of the queue. Click a pipe to turn it.', 16, '#8ea6c4');
    text(this, 640, 266, 'Get the water to the drain before it spills out.', 16, '#8ea6c4');

    const progress = loadProgress();
    this.levels = {};
    for (const n of LEVEL_NAMES) {
      this.levels[n] = this.readLevel(n);
    }

    const cardW = 214;
    const cardH = 250;
    const pitch = cardW + 18;
    const startX = 640 - (LEVEL_COUNT * pitch - 18) / 2 + cardW / 2;

    for (const n of LEVEL_NAMES) {
      this.makeCard(n, startX + (n - 1) * pitch, 470, cardW, cardH, isUnlocked(progress, n), bestScore(progress, n));
    }

    text(this, 640, 662, 'Progress and best scores are saved in this browser.', 14, '#5f7796');
  }

  readLevel(n) {
    const label = `level-${n}.json`;
    if (this.broken[n]) return { ok: false, errors: [`${label}: ${this.broken[n]}`], level: null };
    const raw = this.cache.text.get(`menu-level-${n}`);
    if (raw === undefined || raw === null) return { ok: false, errors: [`${label}: nothing was returned`], level: null };
    return parseLevelJson(raw, label);
  }

  makeCard(level, x, y, w, h, unlocked, best) {
    const data = this.levels[level];
    const faulty = !data.ok;
    const frame = unlocked && !faulty ? 'btn_normal' : 'btn_disabled';

    const bg = slice(this, x, y, 'atlas', frame, w, h, 16).setDepth(10);
    if (!unlocked || faulty) bg.setAlpha(0.8);

    const ink = unlocked && !faulty ? '#dce8f6' : '#5c6b7e';
    text(this, x, y - h / 2 + 52, `LEVEL ${level}`, 22, ink).setDepth(12);

    const name = faulty ? 'broken data' : (data.level.name || `level-${level}`);
    text(this, x, y - h / 2 + 84, name, 15, unlocked && !faulty ? '#8ea6c4' : '#4d5c70').setDepth(12);

    image(this, x, y + 10, 'atlas', unlocked ? (faulty ? 'tile_blocked' : 'icon_play') : 'icon_locked')
      .setDepth(12)
      .setAlpha(unlocked ? 1 : 0.5);

    const scoreLabel = faulty
      ? 'cannot load'
      : (!unlocked ? 'locked' : (best === null ? 'no score yet' : `best ${best}`));
    const scoreColor = faulty ? '#f08a97' : (best === null || !unlocked ? '#5f7796' : '#4fd39a');
    text(this, x, y + h / 2 - 40, scoreLabel, 15, scoreColor).setDepth(12);

    if (!unlocked) return;

    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerover', () => bg.setFrame(faulty ? 'btn_danger' : 'btn_hover'));
    bg.on('pointerout', () => bg.setFrame(frame));
    bg.on('pointerdown', () => {
      if (faulty) {
        this.scene.start('error', {
          title: `Level ${level} will not load`,
          lines: data.errors,
          backLabel: 'Back to levels',
          backScene: 'menu'
        });
        return;
      }
      this.scene.start('game', { level });
    });
  }
}
