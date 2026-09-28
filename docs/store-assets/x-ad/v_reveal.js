// 2.8-6.2 答え合わせ（ブラジル 世界5位・金・+4点）→ ゆっくり下へ
const sleep = AD.sleep;
const C = META.countries, all = Object.values(C).filter(c => c.area != null);
const wr = id => 1 + all.filter(c => c.area > C[id].area).length;
const players = [P(ME, 'はなこ'), P('p2', 'たろう'), P('p3', 'ゆうと'), P('p4', 'さくら')].map(p => ({ ...p, picked: true }));
const rows = [['br', 'はなこ', ME], ['mn', 'たろう', 'p2'], ['ke', 'ゆうと', 'p3'], ['jp', 'さくら', 'p4']]
  .map(([card, name, pid], i) => ({ pid, name, name_en: null, card, value: C[card].area, missing: false, world_rank: wr(card), world_total: 197, rank: i + 1, winner: i === 0, points: 4 - i }));
SHOW(BASE({ phase: 'pick', prompt: PR('area_max'), hand: ['jp', 'br', 'mt', 'ke', 'fr', 'mn', 'sg', 'it'], my_pick: 'br', players, deadline: Date.now() / 1000 + 26 }));
let go; window.__go = () => go(); window.__ready = Promise.resolve(true); await new Promise(r => go = r);
try { sessionStorage.removeItem('geoking_revealed'); } catch {}
AD.mark('reveal');
SHOW({ ...state, phase: 'reveal', reveal: { prompt: PR('area_max'), rows }, next_at: Date.now() / 1000 + 8 });
await sleep(40); const ra = document.getElementById('revealArea'); window.scrollTo(0, ra.getBoundingClientRect().top + scrollY - 70);
await sleep(300); AD.mark('win');
await sleep(1300);
const y0 = scrollY, cards = document.querySelectorAll('#revealRows .rev'), y1 = cards[2].getBoundingClientRect().top + scrollY - innerHeight * 0.42;
const t0 = performance.now(), D = 1700;
while (performance.now() - t0 < D) { const k = (performance.now() - t0) / D, e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; window.scrollTo(0, y0 + (y1 - y0) * e); await sleep(16); }
await sleep(100);
