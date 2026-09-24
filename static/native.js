/* アプリ版（Capacitor）のときだけ動く連携。ブラウザ版では読み込まれない。
   - 振動: Capacitor Haptics（iPhone でも動く）
   - 招待リンク: OS の共有シート
   - Android の戻るボタン: 部屋にいる時は誤って閉じない */
(async () => {
  const Cap = window.Capacitor;
  if (!Cap || !Cap.isNativePlatform || !Cap.isNativePlatform()) return;
  const { Haptics, Share, App, StatusBar, SplashScreen } = Cap.Plugins;
  document.body.classList.add('native');
  // 図鑑・クイズなど同じサイト内の別ページは、アプリ内にフレームを重ねて表示する
  // （Capacitor は起点 URL 以外への画面移動を Safari で開いてしまうため。フレーム内の「対戦へ戻る」で閉じる）
  // このファイルはフレーム内のページでも読み込まれる。フレーム内では sfx.js の navigateTo（フレームを閉じる合図を送る）を残すため、以下の差し替えはしない
  const inFrame = window.top !== window;
  let frameWrap = null;
  const closeFrame = () => {
    if (!frameWrap) return;
    const shown = !frameWrap.classList.contains('loading');   // まだ見えていない枠（読み込み中に別のボタンや戻るを押した）なら音は鳴らさない
    frameWrap.remove(); frameWrap = null; document.body.classList.remove('framed');
    if (shown && typeof sfx !== 'undefined') sfx.leave();
  };
  // 枠は中のページの準備ができるまで透明のまま（その間は今の画面が見えて押せる）。できたら一度に切り替える＝ふつうの画面移動と同じ見え方
  const showFrame = (wrap) => { if (wrap === frameWrap && wrap.classList.contains('loading')) { wrap.classList.remove('loading'); document.body.classList.add('framed'); } };
  if (!inFrame) window.navigateTo = (u) => {
    const url = new URL(u, location.href);
    if (url.origin !== location.origin) { window.open(url.href, '_blank'); return; }
    if (url.pathname === '/' || url.pathname.endsWith('/index.html')) { closeFrame(); return; }
    if (frameWrap && frameWrap.classList.contains('loading') && frameWrap.dataset.url === url.href) return;   // 読み込み中に同じボタンをもう一度押した
    closeFrame();
    const wrap = frameWrap = document.createElement('div'); wrap.className = 'appframe loading'; wrap.dataset.url = url.href;
    const f = document.createElement('iframe'); f.src = url.href; f.setAttribute('allow', 'autoplay'); wrap.appendChild(f);
    f.addEventListener('load', () => { try { wrap.classList.toggle('noheader', !f.contentDocument.querySelector('header.top')); } catch {} });   // 上の余白の色をヘッダーに合わせる（枠の中でページを移ったときも）
    f.addEventListener('load', () => showFrame(wrap));   // 準備の合図を送らないページ（プライバシーポリシー）や、合図の前に読み込みが終わったとき
    setTimeout(() => showFrame(wrap), 3000);   // 念のため: 通信が遅くても3秒で表示する
    document.body.appendChild(wrap);
  };
  if (!inFrame) {
    window.addEventListener('message', (e) => {
      if (e.data === 'geoking:close') closeFrame();
      else if (e.data === 'geoking:ready' && frameWrap && e.source === frameWrap.querySelector('iframe').contentWindow) showFrame(frameWrap);
    });
    window.closeAppFrame = closeFrame;
    window.navigateKeepsPage = true;   // sfx.js へ: 枠を重ねるだけでこのページは残るので、音を待たずにすぐ開いてよい
  }
  // アプリ内では画面の拡大を禁止（ダブルタップやピンチで表示が大きくなるのを防ぐ）
  const vp = document.querySelector('meta[name=viewport]');
  if (vp) vp.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
  document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
  if (SplashScreen) SplashScreen.hide({ fadeOutDuration: 250 }).catch(() => {});   // 本番ページが表示できた時点でスプラッシュを消す
  if (Haptics) {
    navigator.vibrate = (pattern) => {   // 既存の sfx.vibrate がそのまま使える
      const total = Array.isArray(pattern) ? pattern.reduce((a, b) => a + b, 0) : pattern;
      Haptics.impact({ style: total >= 80 ? 'HEAVY' : total >= 25 ? 'MEDIUM' : 'LIGHT' }).catch(() => {});
      return true;
    };
    if (typeof renderPrefs === 'function') renderPrefs();
  }
  if (Share) {
    const btn = document.getElementById('copyLink');
    if (btn) btn.onclick = () => Share.share({ title: t('share_title'), text: t('share_text', { code: state ? state.room : '' }), url: `${window.GEOKING_SERVER || location.origin}/static/index.html?room=${state ? state.room : ''}` }).catch(() => {});
  }
  if (App && !inFrame) {   // 戻るボタンなどは外側のページだけで受ける
    App.addListener('backButton', () => { if (frameWrap) closeFrame(); else if (!state) App.exitApp(); });
    App.addListener('appStateChange', ({ isActive }) => { if (isActive && typeof ensureConnection === 'function') ensureConnection(); });   // 他アプリから戻ったら接続を確認
    App.addListener('resume', () => { if (typeof ensureConnection === 'function') ensureConnection(); });
  }
  if (StatusBar) StatusBar.setStyle({ style: 'LIGHT' }).catch(() => {});
})();
