/* アプリ版（Capacitor）のときだけ動く連携。ブラウザ版では読み込まれない。
   - 振動: Capacitor Haptics（iPhone でも動く）
   - 招待リンク: OS の共有シート
   - Android の戻るボタン: 部屋にいる時は誤って閉じない */
(async () => {
  const Cap = window.Capacitor;
  if (!Cap || !Cap.isNativePlatform || !Cap.isNativePlatform()) return;
  const { Haptics, Share, App, StatusBar } = Cap.Plugins;
  document.body.classList.add('native');
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
    if (btn) btn.onclick = () => Share.share({ title: '地理王で対戦しよう', text: `部屋コード ${state ? state.room : ''}`, url: `${window.GEOKING_SERVER}/static/index.html?room=${state ? state.room : ''}` }).catch(() => {});
  }
  if (App) App.addListener('backButton', () => { if (!state) App.exitApp(); });
  if (StatusBar) StatusBar.setStyle({ style: 'LIGHT' }).catch(() => {});
})();
