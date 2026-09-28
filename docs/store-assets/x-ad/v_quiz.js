// ひとりでクイズ（国旗モード・ふつう）: モードを選んで、1問目に正解する
const sleep = AD.sleep;
setLang('ja');
window.scrollTo(0, 0);
let go; window.__go = () => go();
window.__ready = (async () => { for (let i = 0; i < 60 && !window.META; i++) await sleep(100); return true; })();
await new Promise(r => go = r);
await sleep(450);
await AD.tap('.qlevel[data-mode=flag][data-level=normal]', 'select');
await sleep(250);
await Promise.all([...document.images].map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; })));
await sleep(500);
const _st = window.setTimeout; window.setTimeout = (fn, ms, ...a) => (ms === 1000 ? 0 : _st(fn, ms, ...a));   // 撮る間は次の問題へ進めない（正解のあと1秒で進むのを止めて「正解！」のまま）
await AD.tap(`.qopt[data-id="${qList[qIdx].answer.id}"]`, 'win');   // 正解の音（アプリも正解で sfx.win）
await sleep(450); AD.hideTap();
await sleep(1750);
