/* アプリ内フレームの「戻る」確認: ホーム画面（/static/index.html）を開いたブラウザのコンソールで実行する。
   アプリ版と同じように Capacitor（の代わり）を外側とフレーム内の両方に入れて native.js を動かし、
   図鑑・クイズ・プライバシーポリシーを開いて「対戦へ戻る」「地理王へ戻る」で枠が閉じるかを確かめる。
   ホームのボタンから開くときは、準備の合図まで枠が透明なこと・合図ですぐ出ること・出た時点で中身があり訳されていること・国データを取り直さないこと、
   読み込み中に別のボタンを押したときの動きも見る。
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
  const waitShown = async () => { const t0 = performance.now(); while (performance.now() - t0 < 1500) { const wrap = document.querySelector('.appframe'); if (wrap && !wrap.classList.contains('loading')) return; await sleep(20); } throw new Error('1.5秒たっても枠が表示されない（透明のまま）'); };
  const closed = async () => { for (let i = 0; i < 20; i++) { if (!document.querySelector('.appframe') && !document.body.classList.contains('framed')) return true; await sleep(100); } return false; };
  const withNative = (path) => !path.includes('privacy');   // プライバシーポリシーは native.js を読まない
  for (let i = 0; i < 100 && !(typeof META !== 'undefined' && META); i++) await sleep(100);   // ホームの国データの読み込みを待つ
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
  // ホームのボタンを実際に押して開く（日本語・英語）: 準備の合図が来るまで枠は透明、合図で1.5秒以内に表示（3秒の保険で出たのはNG）、
  // 出た時点で中身が描かれて文言も訳されている、国データを取り直していない
  let readyAt = null;
  window.addEventListener('message', (e) => { const f = document.querySelector('.appframe iframe'); if (e.data === 'geoking:ready' && f && e.source === f.contentWindow) readyAt = performance.now(); });
  const hasJa = (s) => /[\u3040-\u30ff\u4e00-\u9fff]/.test(s);
  for (const lang of ['ja', 'en']) {
    setLang(lang); await sleep(200);
    for (const [name, sel, path, hasContent] of [
      ['「図鑑で学ぶ」で開く', 'a.zukanlink[href="/static/zukan.html"]', '/static/zukan.html', (d) => d.querySelectorAll('img').length > 100],
      ['「ひとりで国旗クイズ」で開く', 'a.zukanlink[href="/static/quiz.html"]', '/static/quiz.html', (d) => d.querySelectorAll('.qmode').length === 2],
    ]) {
      const label = `ホーム（${lang}）${name}`;
      try {
        readyAt = null;
        const t0 = performance.now();
        document.querySelector(sel).click();
        let seenOpaqueWhileLoading = false, shown = null, shownAt = null;
        while (!shown && performance.now() - t0 < 1500) {
          const wrap = document.querySelector('.appframe');
          if (wrap && wrap.classList.contains('loading') && getComputedStyle(wrap).opacity !== '0') seenOpaqueWhileLoading = true;
          if (wrap && !wrap.classList.contains('loading')) { shown = wrap; shownAt = performance.now(); }
          else await sleep(2);
        }
        if (!shown) throw new Error('1.5秒たっても枠が表示されない（準備の合図が届いていない？）');
        const w = shown.querySelector('iframe').contentWindow;
        const ng = [];
        if (w.location.pathname !== path) ng.push('開いたページが違う: ' + w.location.pathname);
        if (seenOpaqueWhileLoading) ng.push('読み込み中の枠が見えていた');
        if (readyAt == null || readyAt > shownAt + 1) ng.push('準備の合図より前に表示された');
        if (!hasContent(w.document)) ng.push('表示された時点で中身がまだ描かれていない');
        const back = w.document.querySelector('[data-i18n="back_to_game"]');
        if (lang === 'en' && back && hasJa(back.textContent)) ng.push('表示された時点で英語に訳されていない: ' + back.textContent);
        if (w.performance.getEntriesByType('resource').some(e => e.name.includes('/api/meta'))) ng.push('国データを取り直している');
        results[label] = ng.length ? 'NG: ' + ng.join(' / ') : `OK（${Math.round(shownAt - t0)}ms で表示）`;
      } catch (e) { results[label] = 'NG: ' + e.message; }
      if (typeof closeAppFrame === 'function') closeAppFrame();
      await sleep(200);
    }
  }
  setLang('ja'); await sleep(200);
  // 読み込み中に別のボタンを押す: 後から押したほうだけが開き、見えなかった枠を閉じる音（退出音）は鳴らない
  {
    let leaves = 0; const origLeave = sfx.leave; sfx.leave = () => { leaves++; };
    try {
      document.querySelector('a.zukanlink[href="/static/zukan.html"]').click();
      await sleep(1);
      document.querySelector('a.zukanlink[href="/static/quiz.html"]').click();
      await waitFrame('/static/quiz.html'); await waitShown();
      const ng = [];
      if (document.querySelectorAll('.appframe').length !== 1) ng.push('枠が' + document.querySelectorAll('.appframe').length + '個ある');
      if (leaves) ng.push('見えていない枠を閉じたのに退出音が鳴った');
      results['読み込み中に別のボタン'] = ng.length ? 'NG: ' + ng.join(' / ') : 'OK';
    } catch (e) { results['読み込み中に別のボタン'] = 'NG: ' + e.message; }
    sfx.leave = origLeave;
    if (typeof closeAppFrame === 'function') closeAppFrame();
    await sleep(200);
  }
  for (const [name, start, hops, back] of cases) {
    try {
      navigateTo(start);
      let w = await waitFrame(start); await waitShown(); if (withNative(start)) await runNative(w);
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
