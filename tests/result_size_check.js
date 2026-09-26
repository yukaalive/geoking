/* 結果（答え合わせ）画面のカードと国旗の大きさを、画面の幅ごとに測る: 開発サーバーのホーム画面をブラウザで開き、コンソールで実行する。
   iPhone（WebKit）では iOS シミュレーターの Safari で /dev/tests/result_size.html を開くと、同じ測定を流して結果を画面に出す。
   枠の中で部屋を作り、ボットと1ラウンドだけ遊んで結果画面を出し、枠の幅を変えながら、列の数・カードの幅・国旗の幅と高さを測る。
   続けて、いちばん長い国名・読み・数値・長い名前・金銀銅のバッジを入れた結果を日本語と英語で描いて、カードから文字がはみ出さないかを見る。
   2026-09-25: 結果のカードの並びは画面の幅で1列か2列かが変わり、幅 402px の iPhone は1列（国旗が大きい）、幅 412px の Android は2列になっていた。 */
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 25000) => { const s = Date.now(); while (!fn()) { if (Date.now() - s > ms) throw new Error('timeout'); await sleep(100); } };
  const WIDTHS = [320, 360, 375, 384, 390, 393, 402, 412, 414, 430, 440, 768];
  const KEYS = ['geoking_room', 'geoking_token', 'geoking_pid', 'geoking_revealed'];   // 枠の中はこのタブと同じ保存を使うので、前の部屋に入り直さないよう消しておく
  KEYS.forEach(k => sessionStorage.removeItem(k));
  let savedLang = null; try { savedLang = localStorage.getItem('geoking_lang'); } catch {}
  const fr = document.createElement('iframe');
  fr.style.cssText = 'position:fixed;left:0;top:0;border:0;width:402px;height:800px;opacity:0;pointer-events:none';
  fr.src = '/static/index.html'; document.body.appendChild(fr);
  const sizes = [], worst = [];
  try {
    await new Promise(r => fr.onload = r);
    const w = fr.contentWindow, d = w.document, S = () => w.eval('state');
    await Promise.race([d.fonts.ready, sleep(3000)]);
    d.getElementById('nameInput').value = 'size'; d.getElementById('createBtn').click();
    await until(() => S() && S().phase === 'lobby');
    w.send({ type: 'settings', settings: { rounds: 3, hand_size: 4, timer: 30 } }); await until(() => S().settings.rounds === 3);
    w.send({ type: 'start', with_bot: true });
    await until(() => S().phase === 'pick'); await sleep(300);
    w.send({ type: 'pick', card: S().hand[0] });
    await until(() => S().phase === 'reveal'); await sleep(1500);
    w.setLang('ja'); await sleep(200);   // 最初の表はいつも日本語で測る
    w.eval('render = () => {}');   // 測っている間に次のラウンドの状態が届いても描き直さない
    // 動きを止め、スクロールバーの幅もなくす（スマホのスクロールバーは幅を取らない。パソコンのブラウザで測っても同じ幅になるように）
    const st = d.createElement('style'); st.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}html{scrollbar-width:none}::-webkit-scrollbar{display:none}.confetti{display:none!important}'; d.head.appendChild(st);
    const overflowOf = () => {   // カードの中の文字・国旗・バッジが、カードの内側（余白と枠線の内側）から横にはみ出していないか
      const over = [];
      for (const c of d.querySelectorAll('#revealRows .rev')) {
        const b = c.getBoundingClientRect(), cs = w.getComputedStyle(c);
        const cr = { left: b.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft), right: b.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight) };
        const out = (r) => r.width && (r.right > cr.right + 0.5 || r.left < cr.left - 0.5);
        const tw = d.createTreeWalker(c, NodeFilter.SHOW_TEXT);
        for (let n; (n = tw.nextNode());) { if (!n.textContent.trim()) continue; const rg = d.createRange(); rg.selectNodeContents(n); if ([...rg.getClientRects()].some(out)) over.push(n.textContent.trim().slice(0, 14)); }
        for (const e of c.querySelectorAll('img,.wrank,.crown')) if (out(e.getBoundingClientRect())) over.push(e.className || e.tagName.toLowerCase());
      }
      return over.join(', ') || 'なし';
    };
    const widest = (W) => {   // ページが画面より広いとき、原因の部品: 1つずつ隠して、ページが画面の幅に戻るものを探す（いちばん内側のものを出す）
      if (d.documentElement.scrollWidth <= W) return '';
      const name = (e) => (e.id ? '#' + e.id : e.tagName.toLowerCase() + (e.classList.length ? '.' + [...e.classList].join('.') : '')) + (e.children.length ? '' : '「' + (e.textContent || '').trim().slice(0, 10) + '」');
      const hit = [];
      for (const e of d.querySelectorAll('header *, main *')) {
        if (e.closest('.confetti') || w.getComputedStyle(e).display === 'none') continue;
        const old = e.style.display; e.style.display = 'none';
        const ok = d.documentElement.scrollWidth <= W; e.style.display = old;
        if (ok) hit.push(e);
      }
      const inner = hit.filter(e => !hit.some(o => o !== e && e.contains(o)));
      return inner.slice(0, 4).map(name).join(' ') || '（1つ隠しただけでは直らない）';
    };
    for (const W of WIDTHS) {
      fr.style.width = W + 'px'; await sleep(250);
      const cards = [...d.querySelectorAll('#revealRows .rev')];
      const img = cards[0].querySelector('img').getBoundingClientRect(), card = cards[0].getBoundingClientRect();
      sizes.push({ 幅: W, 列: new Set(cards.map(c => Math.round(c.getBoundingClientRect().left))).size, カード幅: Math.round(card.width), 国旗の幅: Math.round(img.width), 国旗の高さ: Math.round(img.height), ページ幅: d.documentElement.scrollWidth, 広い要素: widest(W), はみ出し: overflowOf() });
    }
    // いちばん長い文字を入れた結果（4人分: 金・銀・銅・順位なし。名前は16文字の日本語と、空白のない英字 W×16）
    const orig = S().reveal;
    for (const lang of ['ja', 'en']) {
      w.setLang(lang); await sleep(200);
      const M = w.eval('META'), C = Object.values(M.countries), F = M.fields, coff = w.eval('coff'), len = (s) => String(s).length;
      const longName = C.reduce((a, c) => len(coff(c)) > len(coff(a)) ? c : a);
      const longKana = C.reduce((a, c) => len(c.official_kana || '') > len(a.official_kana || '') ? c : a);
      let longVal = null, longTok = null;   // いちばん長い数値の文字と、途中で折り返せない（空白のない）いちばん長いかたまり
      const tok = (s) => Math.max(...String(s).split(/\s+/).map(len));
      for (const k of Object.keys(F)) for (const c of C) {
        if (c[k] == null) continue;
        const s = w.fmtValue(c[k], F[k].fmt);
        if (!longVal || len(s) > len(longVal.s)) longVal = { k, c, s };
        if (!longTok || tok(s) > tok(longTok.s)) longTok = { k, c, s };
      }
      const most = (k) => C.filter(c => c[k] != null).reduce((a, c) => c[k] > a[k] ? c : a);   // 桁のいちばん多い数値（面積・排他的経済水域）
      const scenes = [{ key: longVal.k, star: longVal.c }, { key: longTok.k, star: longTok.c }, { key: 'area', star: most('area') }, { key: 'eez', star: most('eez') }, { key: 'name_len', star: longName }, { key: 'kana_rank', star: longKana }];
      for (const { key, star } of scenes) {
        const rows = [[star, 1, true], [longName, 7, false], [longKana, 25, false], [C[0], 150, false]].map(([c, rank, win], i) => ({ pid: 'x' + i, name: i % 2 ? 'ながいなまえのプレイヤーさんです'.slice(0, 16) : 'W'.repeat(16), name_en: 'W'.repeat(16),   /* 名前は最大16文字。空白のない幅の広い英字も */ card: c.id, value: c[key], world_rank: rank, world_total: 197, winner: win, missing: false, points: 4 - i }));   // そのラウンドの点（+4点など）の行も入れて測る
        w.eval('state').reveal = { ...orig, prompt: { ...orig.prompt, key }, rows };
        w.renderReveal(); await sleep(100);
        for (const W of [320, 346, 360, 375, 384, 387, 388, 390, 393, 402, 405, 406, 412]) {   // 2列・18px に切り替わる境目の前後も
          fr.style.width = W + 'px'; await sleep(300);   // iPhone（WebKit）は枠の幅を変えてから中の配置が追いつくまで少しかかる（短いと前の幅の配置のまま測ってしまう）
          if (d.documentElement.scrollWidth > W) await sleep(700);   // 描き直した直後の1回目は古い配置のことがあるので、待ってから測り直す
          worst.push({ 言語: lang, お題: key, 幅: W, 列: new Set([...d.querySelectorAll('#revealRows .rev')].map(c => Math.round(c.getBoundingClientRect().left))).size, カードの高さ: Math.round(Math.max(...[...d.querySelectorAll('#revealRows .rev')].map(c => c.getBoundingClientRect().height))), ページ幅: d.documentElement.scrollWidth, 広い要素: widest(W), はみ出し: overflowOf() });
        }
      }
    }
  } finally {   // 途中で失敗しても、部屋から抜けて枠を消し、このタブの保存（部屋・言語）を元に戻す
    const fw = fr.contentWindow;
    try { if (fw && fw.send) fw.send({ type: 'leave' }); } catch {}
    await sleep(300); fr.remove();
    KEYS.forEach(k => sessionStorage.removeItem(k));
    try { if (savedLang == null) localStorage.removeItem('geoking_lang'); else localStorage.setItem('geoking_lang', savedLang); } catch {}
  }
  console.table(sizes); console.table(worst);
  return { sizes, worst };
})();
