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
  const closeFrame = () => { if (frameWrap) { frameWrap.remove(); frameWrap = null; document.body.classList.remove('framed'); if (typeof sfx !== 'undefined') sfx.leave(); } };
  if (!inFrame) window.navigateTo = (u) => {
    const url = new URL(u, location.href);
    if (url.origin !== location.origin) { window.open(url.href, '_blank'); return; }
    if (url.pathname === '/' || url.pathname.endsWith('/index.html')) { closeFrame(); return; }
    closeFrame();
    frameWrap = document.createElement('div'); frameWrap.className = 'appframe';
    const f = document.createElement('iframe'); f.src = url.href; f.setAttribute('allow', 'autoplay'); frameWrap.appendChild(f);
    document.body.appendChild(frameWrap); document.body.classList.add('framed');
  };
  if (!inFrame) { window.addEventListener('message', (e) => { if (e.data === 'geoking:close') closeFrame(); }); window.closeAppFrame = closeFrame; }
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
