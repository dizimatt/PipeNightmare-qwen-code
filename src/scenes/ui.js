// Shared Phaser view helpers. Everything here positions pre-generated
// artwork from the atlas; none of it draws shapes (R-008). Sprites and
// nine-slice insets go through ../assets.js so the 2x source detail is
// drawn at the right world size everywhere.

import { image, slice } from '../assets.js';

export const FONT = 'Trebuchet MS, Verdana, sans-serif';
export const TEXT = '#dce8f6';
export const DIM = '#8ea6c4';
export const ACCENT = '#6ce2f5';
export const GOOD = '#4fd39a';
export const BAD = '#f08a97';

export function style(size, color = TEXT, extra = {}) {
  return { fontFamily: FONT, fontSize: `${size}px`, color, ...extra };
}

export function text(scene, x, y, content, size, color, extra) {
  return scene.add.text(x, y, content, style(size, color, extra)).setOrigin(0.5).setDepth(20);
}

export function panel(scene, x, y, width, height, tint = 0x12203a, alpha = 1) {
  return slice(scene, x, y, 'atlas', 'panel', width, height, 20)
    .setTint(tint)
    .setAlpha(alpha)
    .setDepth(15);
}

export function button(scene, x, y, label, onClick, opts = {}) {
  const {
    width = 220,
    height = 54,
    frame = 'btn_normal',
    hoverFrame = 'btn_hover',
    disabled = false,
    fontSize = 17,
    color = TEXT,
    depth = 30
  } = opts;

  const c = scene.add.container(x, y).setDepth(depth);
  const bg = slice(scene, 0, 0, 'atlas', disabled ? 'btn_disabled' : frame, width, height, 14);
  const caption = scene.add.text(0, 0, label, style(fontSize, disabled ? '#5c6b7e' : color)).setOrigin(0.5);
  c.add([bg, caption]);

  if (!disabled) {
    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerover', () => bg.setFrame(hoverFrame));
    bg.on('pointerout', () => bg.setFrame(frame));
    bg.on('pointerdown', onClick);
  }
  c.bg = bg;
  c.caption = caption;
  return c;
}

export function iconButton(scene, x, y, frame, onClick, opts = {}) {
  const { size = 56, tooltip = '' } = opts;
  const c = scene.add.container(x, y).setDepth(31);
  const bg = slice(scene, 0, 0, 'atlas', 'btn_normal', size, size, 14);
  const art = image(scene, 0, 0, 'atlas', frame);
  c.add([bg, art]);
  bg.setInteractive({ useHandCursor: true });
  bg.on('pointerover', () => bg.setFrame('btn_hover'));
  bg.on('pointerout', () => bg.setFrame(opts.frameBase || 'btn_normal'));
  bg.on('pointerdown', onClick);
  c.bg = bg;
  c.art = art;
  c.tip = tooltip;
  c.setFrame = (f) => art.setFrame(f);
  return c;
}
