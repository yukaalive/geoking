/* 地理王 効果音・振動（Web Audio で合成、音声ファイル不要）。対戦画面と図鑑で共用。common.js の後に読み込む */
// ---------- 効果音と振動
const sfx = (() => {
  let ctx = null;
  const prefs = { sound: localStorage.getItem('geoking_sound') !== 'off' };   // 音オン＝振動もオン（設定は1つ）
  const ensure = () => { if (!prefs.sound) return null; try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); return ctx; } catch { return null; } };
  // 1音: type=波形, f=周波数(Hz), t=開始遅延, d=長さ, v=音量, slide=終了周波数
  const tone = (type, f, t, d, v = .18, slide = null) => {
    const c = ensure(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, c.currentTime + t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, c.currentTime + t + d);
    g.gain.setValueAtTime(0.0001, c.currentTime + t); g.gain.exponentialRampToValueAtTime(v, c.currentTime + t + .01); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + t + d);
    o.connect(g).connect(c.destination); o.start(c.currentTime + t); o.stop(c.currentTime + t + d + .02);
  };
  // ノイズ: めくり音・ため息用。freq→slideTo でフィルタを動かせる
  const noise = (t, d, v = .12, freq = 1800, q = .8, slideTo = null) => {
    const c = ensure(); if (!c) return;
    const buf = c.createBuffer(1, c.sampleRate * d, c.sampleRate); const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = c.createBufferSource(); src.buffer = buf; const g = c.createGain(); g.gain.value = v;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(freq, c.currentTime + t);
    if (slideTo) bp.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + t + d); bp.Q.value = q;
    src.connect(bp).connect(g).connect(c.destination); src.start(c.currentTime + t);
  };
  const vibrate = (pattern) => { if (prefs.sound && navigator.vibrate) { try { navigator.vibrate(pattern); } catch {} } };
  return {
    prefs,
    unlock() { ensure(); },
    setSound(on) { prefs.sound = on; localStorage.setItem('geoking_sound', on ? 'on' : 'off'); if (on) { this.confirm(); } },   // 音＋振動のオン/オフ
    select()  { tone('square', 880, 0, .05, .08); vibrate(10); },                                   // カードを選ぶ（カチッ）
    confirm() { tone('triangle', 520, 0, .08, .2); tone('triangle', 780, .07, .12, .2); vibrate(25); }, // 決定（ポン）
    round()   { tone('sine', 660, 0, .1, .15); tone('sine', 990, .1, .16, .15); vibrate(15); },        // 新しいお題
    reveal()  { noise(0, .18); tone('triangle', 300, .05, .12, .12, 600); vibrate(20); },              // めくる
    win()     { [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, i * .09, .22, .2)); vibrate([30, 40, 30, 40, 80]); }, // 勝ち
    lose()    { noise(0, .6, .16, 1400, .6, 300); tone('sine', 330, 0, .5, .06, 220); vibrate(40); },   // 負け: 「ふぃ〜」ため息
    tick()    { tone('square', 1000, 0, .06, .12); vibrate(10); },                                        // 残り10秒〜: カチッ
    tickFast(){ tone('square', 1500, 0, .07, .16); tone('square', 1500, .1, .05, .1); vibrate([15, 40, 15]); }, // 残り3秒: ピピッ
    chat()    { tone('sine', 1400, 0, .05, .05); },                                                      // チャット受信
    champion(){ [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone('triangle', f, i * .12, .3, .2)); vibrate([60, 60, 60, 60, 200]); },
    // ---- 画面操作の音
    tap()     { tone('square', 660, 0, .04, .05); },                                                     // ボタン全般（軽いカチ）
    enter()   { tone('triangle', 523, 0, .1, .14); tone('triangle', 784, .1, .18, .14); vibrate(15); },   // 部屋に入った
    leave()   { tone('triangle', 784, 0, .1, .12); tone('triangle', 523, .1, .18, .12); },               // 部屋を出た
    joined()  { tone('triangle', 988, 0, .18, .2); tone('triangle', 784, .2, .32, .2); vibrate(20); },   // 誰かが入室（ピンポーン）
    left()    { tone('sine', 660, 0, .08, .08, 440); },                                                    // 誰かが退室
    start()   { [392, 523, 659, 784].forEach((f, i) => tone('square', f, i * .07, .1, .1)); tone('triangle', 1047, .3, .3, .18); vibrate([20, 30, 40]); }, // ゲーム開始
    send()    { tone('sine', 1100, 0, .05, .06); },                                                        // 自分がチャット送信
    error()   { tone('square', 200, 0, .12, .08); tone('square', 160, .12, .16, .08); vibrate([30, 30, 30]); }, // エラー・拒否
    open()    { tone('sine', 700, 0, .06, .07, 900); },                                                    // 小窓を開く
    close()   { tone('sine', 900, 0, .06, .06, 600); },                                                    // 小窓を閉じる
    switch()  { tone('square', 990, 0, .05, .07); },                                                       // 設定の切り替え
  };
})();
document.addEventListener('pointerdown', () => sfx.unlock(), { once: true });   // 最初のタップで音を許可
document.addEventListener('click', (e) => {
  // 画面移動のリンク（図鑑・クイズ・対戦へ戻る など）: 音を鳴らしてから移動する（すぐ移動すると音が途切れる）
  const a = e.target.closest('a.zukanlink, a.ztab-link, a.mini, .foot a[href]');
  if (a && a.href && !a.target && !e.metaKey && !e.ctrlKey && !e.shiftKey && a.getAttribute('href') !== '#') {
    e.preventDefault(); sfx.confirm();
    setTimeout(() => { (window.navigateTo || ((u) => { location.href = u; }))(a.href); }, 160);
    return;
  }
  const b = e.target.closest('button, .who, a.muted');
  if (!b || b.closest('.flagcard') || b.id === 'soundBtn') return;
  sfx.tap();
});
document.addEventListener('change', (e) => { if (e.target.matches('input[type=checkbox], select')) sfx.switch(); });
// 小窓（国データなど）を開いたら音
if ($('#modal')) new MutationObserver(() => { if (!$('#modal').classList.contains('hidden')) sfx.open(); }).observe($('#modal'), { attributes: true, attributeFilter: ['class'] });
// ヘッダーの効果音ボタン（オン＝黄色、オフ＝グレーに斜線アイコン）。振動は音と一緒にオン/オフ
function renderPrefs() {
  const b = $('#soundBtn'); if (!b) return;
  b.innerHTML = ico(sfx.prefs.sound ? 'sound' : 'mute');
  b.classList.toggle('on', sfx.prefs.sound); b.classList.toggle('off', !sfx.prefs.sound);
  b.title = sfx.prefs.sound ? t('sound_on') : t('sound_off');
}
if ($('#soundBtn')) $('#soundBtn').onclick = () => { sfx.setSound(!sfx.prefs.sound); renderPrefs(); toast(sfx.prefs.sound ? t('sound_on') : t('sound_off')); };
renderPrefs();

// アプリ内フレーム（native.js が図鑑・クイズを重ねて表示している）の中: 対戦画面へのリンクはフレームを閉じる
if (window.top !== window) {
  window.navigateTo = (u) => {
    const path = new URL(u, location.href).pathname;
    if (path === '/' || path.endsWith('/index.html')) window.parent.postMessage('geoking:close', '*');
    else location.href = u;
  };
}
