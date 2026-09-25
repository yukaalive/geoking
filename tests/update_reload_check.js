/* 更新の自動読み直しの確認: 開発サーバーのホーム画面をブラウザで開き、コンソールで実行する（40秒ほど）。
   枠の中にホーム画面を開き、「新しい版が見つかった」ことにして（画面の版の取り寄せを差し替える）、読み直すかどうかを見る。
   読み直してよいのは: ホーム画面で部屋に入っていない・図鑑やクイズの枠も小窓も開いていない・入力中でない・操作の直後（5秒）でない とき。
   それ以外のときは待ち、読み直してよくなったら読み直す。同じ版なら読み直さない。
   2026-09-25: Android のアプリが裏に回したあとも更新前の画面のままで、新しい画面（部屋の人数など）が出なかった。 */
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const KEYS = ['geoking_room', 'geoking_token', 'geoking_pid', 'geoking_revealed', 'geoking_reloaded_for'];
  KEYS.forEach(k => sessionStorage.removeItem(k));
  const results = {};
  let n = 0;
  const open = async () => {
    const fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;left:0;top:0;border:0;width:375px;height:800px;opacity:0;pointer-events:none';
    fr.src = '/static/index.html'; document.body.appendChild(fr);
    await new Promise(r => fr.onload = r);
    const w = fr.contentWindow;
    for (let i = 0; i < 50 && !(w.eval('pageVersion') && w.eval('typeof META !== "undefined" && META')); i++) await sleep(100);   // 開いた時の版を覚え、国データを読み込むまで
    return fr;
  };
  // 新しい版が見つかったことにする。reloaded: 読み直したら true になる
  const fakeUpdate = (fr) => {
    const w = fr.contentWindow, v = 'NEW' + (++n);
    w.__marker = true; fr.__reloaded = false;
    fr.onload = () => { fr.__reloaded = true; };
    w.fetchVersion = async () => v;
    return w;
  };
  const waitReload = async (fr, ms) => { const s = Date.now(); while (!fr.__reloaded && Date.now() - s < ms) await sleep(100); return fr.__reloaded; };
  const run = async (name, fn) => {
    const fr = await open();
    try { results[name] = await fn(fr, fr.contentWindow) || 'OK'; } catch (e) { results[name] = 'NG: ' + e.message; }
    try { fr.contentWindow.send && fr.contentWindow.send({ type: 'leave' }); } catch {}
    await sleep(200); fr.remove();
  };
  await run('ホーム画面で何もしていない → 読み直す', async (fr) => {
    const w = fakeUpdate(fr); await w.checkForUpdate();
    if (!await waitReload(fr, 2000)) return 'NG: 読み直さない';
  });
  await run('同じ版 → 読み直さない', async (fr) => {
    const w = fr.contentWindow; const v = w.eval('pageVersion'); fr.onload = () => { fr.__reloaded = true; }; fr.__reloaded = false;
    w.fetchVersion = async () => v; await w.checkForUpdate();
    if (await waitReload(fr, 1500)) return 'NG: 同じ版なのに読み直した';
  });
  await run('版が取れない（通信の失敗） → 読み直さない', async (fr) => {
    const w = fr.contentWindow; fr.onload = () => { fr.__reloaded = true; }; fr.__reloaded = false;
    w.fetchVersion = async () => null; await w.checkForUpdate();
    if (await waitReload(fr, 1500)) return 'NG: 読み直した';
  });
  await run('名前を入力中 → 待つ → 入力をやめたら読み直す', async (fr) => {
    const w = fakeUpdate(fr); w.document.getElementById('nameInput').focus(); await w.checkForUpdate();
    if (await waitReload(fr, 3500)) return 'NG: 入力中に読み直した';
    w.document.getElementById('nameInput').blur();
    if (!await waitReload(fr, 5000)) return 'NG: 入力をやめても読み直さない';
  });
  await run('画面を触った直後 → 5秒待ってから読み直す', async (fr) => {
    const w = fakeUpdate(fr); w.document.dispatchEvent(new w.PointerEvent('pointerdown', { bubbles: true })); await w.checkForUpdate();
    if (await waitReload(fr, 3000)) return 'NG: 触った直後に読み直した';
    if (!await waitReload(fr, 6000)) return 'NG: 待っても読み直さない';
  });
  await run('国データの小窓を開いている → 閉じたら読み直す', async (fr) => {
    const w = fakeUpdate(fr); w.showCountry('jp'); await w.checkForUpdate();
    if (await waitReload(fr, 3500)) return 'NG: 小窓を開いているのに読み直した';
    w.document.getElementById('modal').classList.add('hidden');
    if (!await waitReload(fr, 5000)) return 'NG: 閉じても読み直さない';
  });
  await run('アプリで図鑑・クイズの枠を開いている → 閉じたら読み直す', async (fr) => {
    const w = fakeUpdate(fr); const box = w.document.createElement('div'); box.className = 'appframe'; w.document.body.appendChild(box);
    await w.checkForUpdate();
    if (await waitReload(fr, 3500)) return 'NG: 枠を開いているのに読み直した';
    box.remove();
    if (!await waitReload(fr, 5000)) return 'NG: 枠を閉じても読み直さない';
  });
  await run('部屋にいる（ロビー） → 待つ → 退出してホームに戻ったら読み直す', async (fr, w0) => {
    w0.document.getElementById('nameInput').value = 'reload'; w0.document.getElementById('createBtn').click();
    for (let i = 0; i < 50 && !(w0.eval('state') && w0.eval('state').phase === 'lobby'); i++) await sleep(100);
    if (!w0.eval('state')) return 'NG: 部屋に入れない';
    const w = fakeUpdate(fr); await w.checkForUpdate();
    if (await waitReload(fr, 3500)) return 'NG: 部屋にいるのに読み直した';
    w.send({ type: 'leave' });
    if (!await waitReload(fr, 12000)) return 'NG: ホームに戻っても読み直さない';
  });
  KEYS.forEach(k => sessionStorage.removeItem(k));
  console.table(results);
  return results;
})();
