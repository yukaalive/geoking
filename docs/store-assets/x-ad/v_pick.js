// 0.0-2.8 お題と国名のない手札 → ブラジルを2回タップ
const sleep = AD.sleep;
const hand = ['jp', 'br', 'mt', 'ke', 'fr', 'mn', 'sg', 'it'];
const players = [P(ME, 'はなこ'), P('p2', 'たろう', { picked: true }), P('p3', 'ゆうと', { picked: true }), P('p4', 'さくら', { picked: true })];
SHOW(BASE({ phase: 'pick', prompt: PR('area_max'), hand, players, deadline: Date.now() / 1000 + 28.9, host: ME, title: 'はなこの部屋', title_raw: 'はなこ' }));
window.scrollTo(0, 0);
let go; window.__go = () => go(); window.__ready = Promise.resolve(true); await new Promise(r => go = r);
await sleep(1150);
const cards = () => [...document.querySelectorAll('#hand .flagcard')];
await AD.moveTo(cards()[0], 260); await sleep(120);
await AD.tap(cards()[1], 'select'); await sleep(330);
await AD.tap(cards()[1], 'confirm');
SHOW({ ...state, my_pick: 'br', players: players.map(p => ({ ...p, picked: true })) });
await sleep(330);
