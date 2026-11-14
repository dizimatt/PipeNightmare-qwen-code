// Level URLs get a per-fetch revision so the browser cannot answer from its
// HTTP cache. Without this, editing a level file and reloading can keep
// serving the old JSON, which breaks R-002's "no code change" criterion.
//
// The counter alone is not enough: it resets on reload, so URLs would repeat
// and hit the cache again. The nonce differs per page load and `revision`
// differs per fetch within one load.
const nonce = Date.now().toString(36);
let revision = 0;

export function levelUrl(level) {
  revision += 1;
  return `levels/level-${level}.json?rev=${nonce}-${revision}`;
}
