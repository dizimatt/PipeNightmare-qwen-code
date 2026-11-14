export async function run(t) {
  await t.goto();

  // Does a plain Text work in the menu scene at all? It rendered fine in the
  // smoke shot, so confirm, then try the two shapes GameScene actually uses.
  const probe = await t.eval(`
    const g = window.__pipeNightmareGame;
    const menu = g.scene.getScene('menu');
    const out = {};
    const tryIt = (label, fn) => { try { const o = fn(); out[label] = 'ok ' + (o && o.constructor.name); } catch (e) { out[label] = 'THREW ' + e.message; } };
    tryIt('plain', () => menu.add.text(10, 10, 'a', { fontFamily: 'Trebuchet MS, Verdana, sans-serif', fontSize: '17px', color: '#fff' }));
    tryIt('withCharacter', () => menu.add.text(10, 40, 'b', { fontFamily: 'Trebuchet MS, Verdana, sans-serif', fontSize: '17px', color: '#fff', character: 2 }));
    tryIt('withAlign', () => menu.add.text(10, 70, 'c', { fontFamily: 'Trebuchet MS, Verdana, sans-serif', fontSize: '17px', color: '#fff', align: 'center', lineSpacing: 8 }));
    out.canvasCount = document.querySelectorAll('canvas').length;
    return out;
  `);
  console.log('text probe:', JSON.stringify(probe, null, 2));

  // Now start the real game scene and see how far create() gets.
  await t.eval(`window.__pipeNightmareGame.scene.start('game', { level: 1 }); return 1;`);
  await t.wait(1500);
  const st = await t.game();
  console.log('after start:', JSON.stringify(st, null, 2));
  console.log('page errors:', JSON.stringify(await t.pageErrors(), null, 2));
  await t.shot('probe-game-start');
}
