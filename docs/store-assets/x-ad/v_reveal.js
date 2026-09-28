// 答え合わせ「人口が多い国は？」: 1位はたろうのメキシコ（1.32億人・世界11位）、2位がはなこの日本（1.23億人・世界12位）→「日本じゃないの！？」→ ゆっくり下へ
const sleep = AD.sleep;
const C = META.countries, all = Object.values(C).filter(c => c.population != null);
const wr = id => 1 + all.filter(c => c.population > C[id].population).length;
const players = [P(ME, 'はなこ'), P('p2', 'たろう'), P('p3', 'ゆうと'), P('p4', 'さくら')].map(p => ({ ...p, picked: true }));
const rows = [['mx', 'たろう', 'p2'], ['jp', 'はなこ', ME], ['fr', 'ゆうと', 'p3'], ['kr', 'さくら', 'p4']]
  .map(([card, name, pid], i) => ({ pid, name, name_en: null, card, value: C[card].population, missing: false, world_rank: wr(card), world_total: all.length, rank: i + 1, winner: i === 0, points: 4 - i }));
SHOW(BASE({ phase: 'pick', prompt: PR('pop_max'), hand: ['fr', 'jp', 'it', 'kr', 'ca', 'au', 'nl', 'se'], my_pick: 'jp', players, deadline: Date.now() / 1000 + 26 }));
let go; window.__go = () => go(); window.__ready = Promise.resolve(true); await new Promise(r => go = r);
try { sessionStorage.removeItem('geoking_revealed'); } catch {}
AD.mark('reveal');
SHOW({ ...state, phase: 'reveal', reveal: { prompt: PR('pop_max'), rows }, next_at: Date.now() / 1000 + 8 });
await sleep(40); const ra = document.getElementById('revealArea'); window.scrollTo(0, ra.getBoundingClientRect().top + scrollY - 70);
await sleep(300); AD.mark('lose');   // はなこは2位なので、アプリと同じ負けの音（ため息）
await sleep(2600);   // メキシコと日本の2枚をしっかり見せてから下へ
const y0 = scrollY, cards = document.querySelectorAll('#revealRows .rev'), y1 = cards[2].getBoundingClientRect().top + scrollY - innerHeight * 0.42;
const t0 = performance.now(), D = 2000;
while (performance.now() - t0 < D) { const k = (performance.now() - t0) / D, e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; window.scrollTo(0, y0 + (y1 - y0) * e); await sleep(16); }
await sleep(1500);
