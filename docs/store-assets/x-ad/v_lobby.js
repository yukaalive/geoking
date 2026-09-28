// 10.2-12.6 ロビー（はなこ・ボット2人、たろうが入ってくる）
const sleep = AD.sleep;
const ps = [P(ME, 'はなこ'), P('b1', 'エミリア', { is_bot: true }), P('b2', 'サミュエル', { is_bot: true })];
SHOW(BASE({ phase: 'lobby', players: [...ps], chat: [], host: ME, title: 'はなこの部屋', title_raw: 'はなこ' }));
window.scrollTo(0, 0);
let go; window.__go = () => go(); window.__ready = Promise.resolve(true); await new Promise(r => go = r);
await sleep(650);
ps.splice(1, 0, P('p2', 'たろう'));
AD.mark('joined');
SHOW({ ...state, players: [...ps], chat: [{ name: 'システム', key: 'joined', params: { name: 'たろう' }, text: 'たろうさんが入室しました', ts: Date.now() / 1000 }] });
await sleep(2200);
