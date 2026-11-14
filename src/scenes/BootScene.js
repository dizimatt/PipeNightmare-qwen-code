export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload() {
    this.failed = null;
    // The atlas holds every tile and UI frame; the background and wordmark are
    // large enough that they live in their own files instead.
    this.load.atlas('atlas', 'assets/atlas.png', 'assets/atlas.json');
    this.load.image('title', 'assets/title.png');
    this.load.image('bg', 'assets/bg.png');
    this.load.on('loaderror', (file) => {
      this.failed = file?.url || file?.key || 'an unknown file';
    });

    const caption = this.add.text(640, 360, 'pressurising…', {
      fontFamily: 'Trebuchet MS, Verdana, sans-serif',
      fontSize: '16px',
      color: '#7e9cbe'
    }).setOrigin(0.5);

    this.load.on('progress', (v) => {
      caption.setText(`pressurising… ${Math.round(v * 100)}%`);
    });
    this.load.on('complete', () => caption.destroy());
  }

  create() {
    if (this.failed) {
      this.scene.start('error', {
        title: 'Assets failed to load',
        lines: [
          `Could not load ${this.failed}.`,
          'The game needs to be served over HTTP. From this folder run:',
          'python3 -m http.server',
          'then open http://localhost:8000/'
        ],
        backLabel: 'Retry',
        backScene: 'boot'
      });
      return;
    }
    this.scene.start('menu');
  }
}
