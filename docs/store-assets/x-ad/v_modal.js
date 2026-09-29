// 出した国のデータ: 答え合わせのメキシコのカードをタップ → 国データの小窓（首都・人口・宗教など）→ 小窓をゆっくり下へ（60秒の版だけ）
const sleep = AD.sleep;
const C = META.countries, all = Object.values(C).filter(c => c.population != null);
const wr = id => 1 + all.filter(c => c.population > C[id].population).length;
const players = [P(ME, 'はなこ', { score: 3 }), P('p2', 'たろう', { score: 4 }), P('p3', 'ゆうと', { score: 2 }), P('p4', 'さくら', { score: 1 })].map(p => ({ ...p, picked: true }));
const rows = [['mx', 'たろう', 'p2'], ['jp', 'はなこ', ME], ['fr', 'ゆうと', 'p3'], ['kr', 'さくら', 'p4']]
  .map(([card, name, pid], i) => ({ pid, name, name_en: null, card, value: C[card].population, missing: false, world_rank: wr(card), world_total: all.length, rank: i + 1, winner: i === 0, points: 4 - i }));
const st = BASE({ phase: 'reveal', prompt: PR('pop_max'), hand: ['fr', 'it', 'kr', 'ca', 'au', 'nl', 'se'], my_pick: 'jp', players, reveal: { prompt: PR('pop_max'), rows }, next_at: Date.now() / 1000 + 30 });
try { sessionStorage.setItem('geoking_revealed', revealKeyOf(st)); } catch {}   // 見せ済みにして、めくる動きなしで出す
SHOW(st);
await Promise.all([...document.images].map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; })));
const ra = document.getElementById('revealArea'); window.scrollTo(0, ra.getBoundingClientRect().top + scrollY - 70);
let go; window.__go = () => go(); window.__ready = Promise.resolve(true); await new Promise(r => go = r);
await sleep(800);
await AD.tap(document.querySelector('#revealRows .rev'), 'open');   // メキシコのカード → 小窓（アプリも開くときに音）
await sleep(500); AD.hideTap();
await sleep(1300);
const box = document.querySelector('#modal .modalbox'), t0 = performance.now(), D = 1800;
while (performance.now() - t0 < D) { const k = (performance.now() - t0) / D, e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; box.scrollTop = 300 * e; await sleep(16); }
await sleep(1800);
