// ロビー: 部屋の設定の「ゲーム」でバトルを選ぶ（パーティー → バトル。開始ボタンが「バトル開始」に）
const sleep = AD.sleep;
const ps = [P(ME, 'はなこ'), P('p2', 'たろう'), P('p3', 'ゆうと'), P('p4', 'さくら')];
SHOW(BASE({ phase: 'lobby', players: ps, chat: [], host: ME, title: 'はなこの部屋', title_raw: 'はなこ' }));
const card = document.querySelector('#lobby .settings').closest('.card');
window.scrollTo(0, card.getBoundingClientRect().top + scrollY - AD.BAND - 76);
let go; window.__go = () => go(); window.__ready = Promise.resolve(true); await new Promise(r => go = r);
await sleep(1000);
await AD.tap('.modebtn[data-rule=survival]', 'select');
SHOW({ ...state, settings: { ...state.settings, rule: 'survival' } });   // サーバーにはつながないので、選んだあとの状態をこちらで描く
await sleep(450); AD.hideTap();   // 指の印を消して、選んだ「バトル」を見せる
await sleep(3600);
