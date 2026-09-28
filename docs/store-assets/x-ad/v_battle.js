// バトルの答え合わせ（4人・4ラウンド目、面積が大きい国は？）: めくる → 1位（はなこのブラジル）が金色に光る → 力がたまって、−10・−20・−30 の順に弾が当たり、最下位が脱落
const sleep = AD.sleep;
const C = META.countries, all = Object.values(C).filter(c => c.area != null);
const wr = id => 1 + all.filter(c => c.area > C[id].area).length;
const plan = [['br', 'はなこ', ME, 60, 60], ['in', 'たろう', 'p2', 50, 40], ['ke', 'ゆうと', 'p3', 40, 20], ['no', 'さくら', 'p4', 30, 0]];   // 国, 名前, pid, 前の体力, 後の体力
const players = plan.map(([card, name, pid, before]) => P(pid, name, { picked: true, hp: before, out_round: null }));
const rows = plan.map(([card, name, pid, before, after], i) => ({ pid, name, name_en: null, card, value: C[card].area, missing: false, world_rank: wr(card), world_total: all.length,
  rank: i + 1, winner: i === 0, points: null, damage: before - after, hp_before: before, hp: after, out: after === 0 }));
const settings = { ...BASE().settings, rule: 'survival' };
await Promise.all(plan.map(([id]) => new Promise(r => { const i = new Image(); i.onload = i.onerror = r; i.src = flagUrl(id); })));   // 国旗を先に読み込む
SHOW(BASE({ phase: 'pick', round: 4, total_rounds: 20, settings, surv: { hp: 100, max_damage: 30 }, prompt: PR('area_max'), hand: ['br', 'in', 'mt', 'ke', 'fr', 'mn', 'sg', 'it'], my_pick: 'br', players, deadline: Date.now() / 1000 + 26 }));
let go; window.__go = () => go(); window.__ready = Promise.resolve(true); await new Promise(r => go = r);
try { sessionStorage.removeItem('geoking_revealed'); } catch {}
AD.mark('reveal');
const after = players.map(p => { const r = rows.find(x => x.pid === p.pid); return { ...p, hp: r.hp, out_round: r.out ? 4 : null }; });   // サーバーと同じく、答え合わせのときは減ったあとの体力
SHOW({ ...state, phase: 'reveal', players: after, reveal: { prompt: PR('area_max'), rows, alive: 3, last: false }, next_at: Date.now() / 1000 + 8 });
// 1位が光る・力がたまる・弾・当たる・脱落の音は、アプリ（survival.js）が鳴らした時刻のまま記録される（common_state.js）
await sleep(40); const ra = document.getElementById('revealArea'); window.scrollTo(0, ra.getBoundingClientRect().top + scrollY - 64);
await sleep(6600);
