// 図鑑のランキング（人口が多い国は？）: 上から、メキシコ・日本（11位・12位）のあたりまでゆっくり下へ（60秒の版だけ）
const sleep = AD.sleep;
setLang('ja');
let go; window.__go = () => go();
window.__ready = (async () => {
  for (let i = 0; i < 60 && !window.META; i++) await sleep(100);
  document.getElementById('tabRank').click(); await sleep(400);
  const sel = document.getElementById('promptSel'); sel.value = 'pop_max'; sel.dispatchEvent(new Event('change')); await sleep(700);
  for (const im of document.images) im.loading = 'eager';
  await Promise.race([Promise.all([...document.images].map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; }))), sleep(4000)]);
  window.scrollTo(0, 0); return true;
})();
await new Promise(r => go = r);
await sleep(1300);
const mx = [...document.querySelectorAll('#rank *')].find(e => !e.children.length && e.textContent.trim() === 'メキシコ');
const y1 = mx ? Math.max(0, mx.getBoundingClientRect().top + scrollY - innerHeight * 0.45) : 480, y0 = scrollY, t0 = performance.now(), D = 2400;
while (performance.now() - t0 < D) { const k = (performance.now() - t0) / D, e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; window.scrollTo(0, y0 + (y1 - y0) * e); await sleep(16); }
await sleep(2000);
