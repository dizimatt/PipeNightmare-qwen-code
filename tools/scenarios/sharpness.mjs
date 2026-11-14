// Diagnostic: does the canvas backing store actually match the pixels the
// display wants? Run with DEVICE_SCALE=1 and DEVICE_SCALE=2 and compare.

export async function run(t) {
  await t.goto();
  await t.click(176, 470);
  await t.wait(900);

  const m = await t.eval(`
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    const g = window.__pipeNightmareGame;
    const s = g.scale || {};
    const cam = (g.cameras && g.cameras.main) || (g.camera && g.camera.main) || null;
    return {
      dpr: window.devicePixelRatio,
      canvasBuffer: [c.width, c.height],
      canvasCss: [Math.round(r.width * 100) / 100, Math.round(r.height * 100) / 100],
      gameSize: s.gameSize ? [s.gameSize.width, s.gameSize.height] : null,
      renderer: g.renderer ? (g.renderer.name || g.renderer.constructor.name) : null,
      cameraResolution: cam ? cam.resolution : 'no camera handle',
      zoom: cam ? cam.zoom : null,
      cssPerCanvasPx: r.width / c.width,
      gameKeys: Object.keys(g).filter(k => /cam|scale|render/i.test(k))
    };
  `);

  console.log(JSON.stringify(m, null, 2));
  // What matters is physical pixels per canvas pixel: css px is already
  // multiplied by dpr, so comparing to css alone hides HiDPI stretching.
  const physicalPerCanvasPx = Math.round((m.canvasCss[0] * m.dpr / m.canvasBuffer[0]) * 100) / 100;
  console.log(`\ncanvas buffer ${m.canvasBuffer.join('x')} shown at ${m.canvasCss.join('x')} css px `
    + `on a dpr-${m.dpr} display = ${physicalPerCanvasPx} physical px per canvas px.`);
  console.log(physicalPerCanvasPx > 1.01
    ? 'STRETCHED: the backing store is smaller than the physical pixels available.'
    : 'backing store fills the physical pixels.');

  await t.shot(`sharp-dpr${m.dpr}`);
}
