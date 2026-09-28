// お題「人口が多い国は？」→ 手札の中でいちばん人口が多そうな日本を、自信満々で2回タップ（このあとメキシコにちょっとだけ負ける）
const sleep = AD.sleep;
const hand = ['fr', 'jp', 'it', 'kr', 'ca', 'au', 'nl', 'se'];   // 日本より人口の少ない国だけ（日本が勝ちそうに見える）
const players = [P(ME, 'はなこ'), P('p2', 'たろう', { picked: true }), P('p3', 'ゆうと', { picked: true }), P('p4', 'さくら', { picked: true })];
SHOW(BASE({ phase: 'pick', prompt: PR('pop_max'), hand, players, deadline: Date.now() / 1000 + 28.9, host: ME, title: 'はなこの部屋', title_raw: 'はなこ' }));
window.scrollTo(0, 0);
let go; window.__go = () => go(); window.__ready = Promise.resolve(true); await new Promise(r => go = r);
await sleep(1400);   // お題を読む間
const cards = () => [...document.querySelectorAll('#hand .flagcard')];
await AD.moveTo(cards()[0], 380); await sleep(350);   // ちょっと迷ってから
await AD.tap(cards()[1], 'select'); await sleep(800);
await AD.tap(cards()[1], 'confirm');
SHOW({ ...state, my_pick: 'jp', players: players.map(p => ({ ...p, picked: true })) });
await sleep(2600);
