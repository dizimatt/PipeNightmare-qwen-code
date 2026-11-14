import { image } from '../assets.js';
import { panel, button, text } from './ui.js';

export class ErrorScene extends Phaser.Scene {
  constructor() {
    super('error');
  }

  init(data) {
    this.payload = data || {};
  }

  create() {
    const {
      title = 'Something went wrong',
      lines = [],
      backLabel = 'Back to levels',
      backScene = 'menu'
    } = this.payload;

    image(this, 640, 360, 'bg').setDepth(0);
    panel(this, 640, 340, 760, 360, 0x12203a);
    image(this, 640, 150, 'atlas', 'tile_blocked', 1.4).setDepth(16);

    text(this, 640, 226, title, 30, '#f0b6c0').setDepth(16);
    text(this, 640, 300, lines.length ? lines.join('\n') : 'No further detail was reported.', 15, '#b9cbe2', {
      align: 'center',
      lineSpacing: 6,
      wordWrap: { width: 660 }
    }).setOrigin(0.5, 0).setDepth(16);

    button(this, 640, 500, backLabel, () => this.scene.start(backScene), { width: 300, depth: 44 });
  }
}
