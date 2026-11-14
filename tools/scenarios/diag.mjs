export async function run(t) {
  await t.goto();
  const info = await t.eval(`
    const P = window.Phaser;
    const games = P && P.GAMES;
    const g = games && games.length ? games[0] : null;
    return {
      phaserType: typeof P,
      version: P ? P.VERSION : null,
      hasGames: !!games,
      gamesLen: games ? games.length : null,
      bootedFlag: window.__pipeNightmareBooted === true,
      canvas: !!document.querySelector('canvas'),
      bootDiv: document.getElementById('booting') ? document.getElementById('booting').textContent : null,
      textures: g ? Object.keys(g.texture.manager.list) : null,
      scenes: g ? g.scene.scenes.map(s => s.sys.key + ':' + s.sys.isActive()) : null
    };
  `);
  console.log('page diagnostics:', JSON.stringify(info, null, 2));
  console.log('window errors:', JSON.stringify(await t.pageErrors()));
  await t.shot('diag');
}
