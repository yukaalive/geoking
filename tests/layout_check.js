/* 横はみ出しの確認: 開発サーバーのホーム画面（/static/index.html）を開いたブラウザのコンソールで実行する。
   幅 320/375/414/768/1024px の枠の中に各ページを開き、日本語・英語で、ページが画面の幅より広くならないかを見る。
   ロビーは枠の中で部屋を作って確かめる（終わったら退出する）。CSS や文言を変えたら流す。
   2026-09-24: 「部屋の名前」を折り返さないための nowrap が公開部屋の長い説明にも効き、ロビーの枠が画面からはみ出した。 */
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const overflow = (w, W) => {
    const pw = w.document.documentElement.scrollWidth;
    if (pw <= W) return 'OK';
    const bad = [];
    for (const el of w.document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width && r.right > W + 1 && w.getComputedStyle(el).position !== 'fixed' && !el.closest('.herodemo')) bad.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + [...el.classList].join('.')) + ' → ' + Math.round(r.right));
      if (bad.length > 5) break;
    }
    return 'NG ページ幅 ' + pw + 'px: ' + bad.join(', ');
  };
  const open = async (path, W) => {
    const fr = document.createElement('iframe');
    fr.style.cssText = `position:fixed;left:0;top:0;border:0;width:${W}px;height:800px;opacity:0;pointer-events:none`;
    fr.src = path; document.body.appendChild(fr);
    await new Promise(r => fr.onload = r); await sleep(700);
    return fr;
  };
  const bothLangs = async (w, W) => {
    const r = [];
    for (const lg of (typeof w.setLang === 'function' ? ['ja', 'en'] : ['ja'])) {
      if (w.setLang) { w.setLang(lg); await sleep(250); }
      r.push(lg + '=' + overflow(w, W));
    }
    if (w.setLang) w.setLang('ja');
    return r.join(' / ');
  };
  const results = {};
  for (const W of [320, 375, 414, 768, 1024]) {
    for (const path of ['/static/index.html', '/static/zukan.html', '/static/quiz.html', '/static/privacy.html']) {
      const fr = await open(path, W); const w = fr.contentWindow;
      results[`${W}px ${path.split('/').pop()}`] = await bothLangs(w, W);
      if (path === '/static/index.html') {   // ロビー: 枠の中で部屋を作る
        w.sessionStorage.removeItem('geoking_room');
        w.document.getElementById('nameInput').value = 'layout';
        w.document.getElementById('createBtn').click();
        for (let i = 0; i < 50 && w.document.getElementById('lobby').classList.contains('hidden'); i++) await sleep(100);
        results[`${W}px ロビー`] = w.document.getElementById('lobby').classList.contains('hidden') ? 'NG: ロビーが開かない' : await bothLangs(w, W);
        w.send({ type: 'leave' }); await sleep(300);
      }
      fr.remove();
    }
  }
  console.table(results);
  return results;
})();
