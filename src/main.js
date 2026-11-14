import { BootScene } from './scenes/BootScene.js';
import { MenuScene } from './scenes/MenuScene.js';
import { GameScene } from './scenes/GameScene.js';
import { ErrorScene } from './scenes/ErrorScene.js';

const config = {
  type: Phaser.AUTO,
  parent: 'game',
  width: 1280,
  height: 720,
  backgroundColor: '#080e1a',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  scene: [BootScene, MenuScene, GameScene, ErrorScene]
};

const game = new Phaser.Game(config);

// Phaser 3.90 keeps no global instance registry, so hand the game to anything
// that needs to inspect it: the browser console, and tools/headless.mjs.
window.__pipeNightmareGame = game;
window.__pipeNightmareBooted = true;
const booting = document.getElementById('booting');
if (booting) booting.remove();
