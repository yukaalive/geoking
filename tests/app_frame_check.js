/* アプリ内フレームの「戻る」確認: ホーム画面（/static/index.html）を開いたブラウザのコンソールで実行する。
   アプリ版と同じように Capacitor（の代わり）を外側とフレーム内の両方に入れて native.js を動かし、
   図鑑・クイズ・プライバシーポリシーを開いて「対戦へ戻る」「地理王へ戻る」で枠が閉じるかを確かめる。
   図鑑・クイズの開き方、native.js / sfx.js の画面移動、戻るリンクを変えたら必ず流す。
   注意: X-Frame-Options が SAMEORIGIN になったサーバーで動かすこと（古いサーバーだとフレームが空になる） */
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const runNative = async (w) => {
    w.Capacitor = { isNativePlatform: () => true, Plugins: {} };
    const s = w.document.createElement('script'); s.src = '/static/native.js?t=' + Date.now() + Math.random(); w.document.body.appendChild(s);
    for (let i = 0; i < 30 && !w.document.body.classList.contains('native'); i++) await sleep(100);
  };
  const frameWin = () => document.querySelector('.appframe iframe')?.contentWindow;
  const waitFrame = async (path) => {
    let seen = '';
    // 'interactive' で十分（スクリプトは実行済みで押せる状態）。'complete' まで待つと、図鑑の直後などは国旗画像やフォントの読み込みで数秒かかることがある
    for (let i = 0; i < 50; i++) { const w = frameWin(); seen = w ? w.location.pathname + ' ' + w.document.readyState : '枠なし'; if (w && w.location.pathname === path && w.document.readyState !== 'loading') return w; await sleep(100); }
    throw new Error('フレームが開かない: ' + path + '（そのときの枠: ' + seen + '）');
  };
  const closed = async () => { for (let i = 0; i < 20; i++) { if (!document.querySelector('.appframe') && !document.body.classList.contains('framed')) return true; await sleep(100); } return false; };
  const withNative = (path) => !path.includes('privacy');   // プライバシーポリシーは native.js を読まない
  await runNative(window);
  // [確認名, 最初に開くページ, 途中でたどるリンク [セレクタ, 行き先], 最後に押す戻るリンク]
  const cases = [
    ['図鑑: 上の対戦へ戻る', '/static/zukan.html', [], 'header a.mini'],
    ['図鑑: 下の対戦へ戻る', '/static/zukan.html', [], '.foot a[href="/static/index.html"]'],
    ['クイズ: 上の対戦へ戻る', '/static/quiz.html', [], 'header a.mini'],
    ['クイズ: 下の対戦へ戻る', '/static/quiz.html', [], '.foot a[href="/static/index.html"]'],
    ['クイズ→先に図鑑で覚える→対戦へ戻る', '/static/quiz.html', [['a[href="/static/zukan.html"].muted', '/static/zukan.html']], 'header a.mini'],
    ['図鑑→クイズタブ→対戦へ戻る', '/static/zukan.html', [['a.ztab-link', '/static/quiz.html']], 'header a.mini'],
    ['ホーム→プライバシー→地理王へ戻る', '/static/privacy.html', [], '#backHome'],
    ['クイズ→プライバシー→地理王へ戻る', '/static/quiz.html', [['.foot a[href="/static/privacy.html"]', '/static/privacy.html']], '#backHome'],
    ['図鑑→プライバシー→地理王へ戻る', '/static/zukan.html', [['.foot a[href="/static/privacy.html"]', '/static/privacy.html']], '#backHome'],
  ];
  const results = {};
  for (const [name, start, hops, back] of cases) {
    try {
      navigateTo(start);
      let w = await waitFrame(start); if (withNative(start)) await runNative(w);
      for (const [sel, dest] of hops) { w.document.querySelector(sel).click(); w = await waitFrame(dest); if (withNative(dest)) await runNative(w); }
      if (!w.document.documentElement.classList.contains('inframe')) throw new Error('フレーム内の目印（inframe）がない: ' + w.location.pathname);
      w.document.querySelector(back).click();
      results[name] = (await closed()) ? 'OK' : 'NG: 枠が閉じない（枠の中: ' + frameWin()?.location.pathname + '）';
    } catch (e) { results[name] = 'NG: ' + e.message; }
    if (typeof closeAppFrame === 'function') closeAppFrame();
    await sleep(200);
  }
  console.table(results);
  return results;
})();
