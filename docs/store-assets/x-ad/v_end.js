// 7.8-10.2 結果発表（はなこ が地理王）
const sleep = AD.sleep;
const players = [P(ME, 'はなこ', { score: 23 }), P('p2', 'たろう', { score: 20 }), P('p3', 'ゆうと', { score: 18 }), P('p4', 'さくら', { score: 13 })];
SHOW(BASE({ phase: 'pick', round: 7, prompt: PR('pop_max'), hand: ['jp'], players, deadline: Date.now() / 1000 + 30 }));
let go; window.__go = () => go(); window.__ready = Promise.resolve(true); await new Promise(r => go = r);
AD.mark('champion');
SHOW({ ...state, phase: 'end', final: players.map(p => ({ pid: p.pid, name: p.name, name_en: null, score: p.score, is_bot: false })), history: [], leftover: {} });
window.scrollTo(0, 0);
await sleep(5200);
