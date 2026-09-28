// バトルの答え合わせ（4人・4ラウンド目、人口が多い国は？）: めくる → 1位ノーダメージ → −10・−20・−30 と順に当たり、最下位が脱落
const sleep = AD.sleep;
const C = META.countries, all = Object.values(C).filter(c => c.population != null);
const wr = id => 1 + all.filter(c => c.population > C[id].population).length;
const plan = [['in', 'はなこ', ME, 60, 60], ['jp', 'たろう', 'p2', 50, 40], ['ke', 'ゆうと', 'p3', 40, 20], ['no', 'さくら', 'p4', 30, 0]];   // 国, 名前, pid, 前の体力, 後の体力
const players = plan.map(([card, name, pid, before]) => P(pid, name, { picked: true, hp: before, out_round: null }));
const rows = plan.map(([card, name, pid, before, after], i) => ({ pid, name, name_en: null, card, value: C[card].population, missing: false, world_rank: wr(card), world_total: all.length,
  rank: i + 1, winner: i === 0, points: null, damage: before - after, hp_before: before, hp: after, out: after === 0 }));
const settings = { ...BASE().settings, rule: 'survival' };
await Promise.all(plan.map(([id]) => new Promise(r => { const i = new Image(); i.onload = i.onerror = r; i.src = flagUrl(id); })));   // 国旗を先に読み込む
document.documentElement.style.zoom = 0.86;   // 4人分のカードが1画面に入るように
SHOW(BASE({ phase: 'pick', round: 4, total_rounds: 20, settings, surv: { hp: 100, max_damage: 30 }, prompt: PR('pop_max'), hand: ['in', 'br', 'mt', 'ke', 'fr', 'mn', 'sg', 'it'], my_pick: 'in', players, deadline: Date.now() / 1000 + 26 }));
let go; window.__go = () => go(); window.__ready = Promise.resolve(true); await new Promise(r => go = r);
try { sessionStorage.removeItem('geoking_revealed'); } catch {}
AD.mark('reveal');
const after = players.map(p => { const r = rows.find(x => x.pid === p.pid); return { ...p, hp: r.hp, out_round: r.out ? 4 : null }; });   // サーバーと同じく、答え合わせのときは減ったあとの体力
SHOW({ ...state, phase: 'reveal', players: after, reveal: { prompt: PR('pop_max'), rows, alive: 3, last: false }, next_at: Date.now() / 1000 + 8 });
// 効果音の時刻（survival.js の演出と同じ: めくり終わり 1.04 秒 → 1位が光る +0.15 → 当たる +0.65 から 0.3 秒おき → 脱落はその 0.45 秒後）。
// 音の名前は compose.py の SFX（hit2・hit4・hit6 は sfx.hit(n) の強さ。−10・−20・−30 が 2・4・6）
[[1190, 'power'], [1690, 'hit2'], [1990, 'hit4'], [2290, 'hit6'], [2740, 'ko']].forEach(([ms, n]) => setTimeout(() => AD.mark(n), ms));
await sleep(40); const ra = document.getElementById('revealArea'); window.scrollTo(0, ra.getBoundingClientRect().top + scrollY - 64);
await sleep(4300);
