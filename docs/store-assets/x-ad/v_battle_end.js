// バトルの結果発表（はなこ が最後の1人。ほかの人は「Nラウンドで脱落」）
const sleep = AD.sleep;
const settings = { ...BASE().settings, rule: 'survival' };
const players = [P(ME, 'はなこ', { hp: 40 }), P('p2', 'たろう', { hp: 0, out_round: 9 }), P('p3', 'ゆうと', { hp: 0, out_round: 7 }), P('p4', 'さくら', { hp: 0, out_round: 4 })];
SHOW(BASE({ phase: 'pick', round: 9, total_rounds: 20, settings, surv: { hp: 100, max_damage: 30 }, prompt: PR('pop_max'), hand: ['jp'], players, deadline: Date.now() / 1000 + 30 }));
let go; window.__go = () => go(); window.__ready = Promise.resolve(true); await new Promise(r => go = r);
AD.mark('champion');
const final = [[ME, 'はなこ', 1, 40, null], ['p2', 'たろう', 2, 0, 9], ['p3', 'ゆうと', 3, 0, 7], ['p4', 'さくら', 4, 0, 4]]
  .map(([pid, name, place, hp, out_round]) => ({ pid, name, name_en: null, is_bot: false, place, score: out_round ? 0 : hp, hp, out_round }));
SHOW({ ...state, phase: 'end', final, history: [], leftover: {} });
window.scrollTo(0, 0);
await sleep(3300);
