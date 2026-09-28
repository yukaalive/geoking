// 6.2-7.8 お題が次々に（ラウンド 2/7 → 3/7 → 4/7）
const sleep = AD.sleep;
const players = [P(ME, 'はなこ', { score: 4 }), P('p2', 'たろう', { score: 3 }), P('p3', 'ゆうと', { score: 2 }), P('p4', 'さくら', { score: 1 })];
const hands = [['cn', 'fi', 'ar', 'eg', 'no', 'pe', 'th', 'de'], ['it', 'ng', 'ca', 'vn', 'se', 'cl', 'ma', 'au'], ['is', 'id', 'tr', 'gr', 'za', 'nz', 'in', 'ch']];
const pr = [PR('pop_max'), PR('life_max'), { id: 'north', cat: 'basic', text: '最も北にある国は？', key: 'lat', dir: 'max', star: 1, hint: '', text_en: 'Which country is the northernmost?' }];
await Promise.all(hands.flat().map(id => new Promise(r => { const i = new Image(); i.onload = i.onerror = r; i.src = flagUrl(id); })));   // 国旗を先に読み込む（出たときに白い枠が見えないように）
document.documentElement.style.zoom = 1.18;
SHOW(BASE({ phase: 'pick', round: 2, prompt: pr[0], hand: hands[0], players, deadline: Date.now() / 1000 + 30 }));
window.scrollTo(0, 0);
let go; window.__go = () => go(); window.__ready = Promise.resolve(true); await new Promise(r => go = r);
AD.mark('round'); await sleep(540);
SHOW({ ...state, round: 3, prompt: pr[1], hand: hands[1], deadline: Date.now() / 1000 + 30 }); window.scrollTo(0, 0); AD.mark('round'); await sleep(540);
SHOW({ ...state, round: 4, prompt: pr[2], hand: hands[2], deadline: Date.now() / 1000 + 30 }); window.scrollTo(0, 0); AD.mark('round'); await sleep(540);
await sleep(300);   // 切り出しの余裕（最後のお題のまま）
