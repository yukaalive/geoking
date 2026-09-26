/* 文字の見やすさ（文字色と背景色のコントラスト）の確認: 開発サーバーのホーム画面をブラウザで開き、コンソールで実行する。
   ダークモードで見るときは、ブラウザ側をダークモードにしてから流す（Claude は resize_window の colorScheme:'dark'）。
   幅 375px の枠の中で、ホーム・ロビー・対戦（選ぶ・結果・結果発表）・図鑑（国データの小窓も）・クイズ・プライバシーポリシーを開き、
   見えている文字とアイコンごとに、背景（重なった半透明の色も合成）とのコントラスト比を測る。
   3.0 未満（大きな文字でも読みにくい）を NG、4.5 未満（小さな文字には足りない）を注意として返す。対戦は枠の中でボットと3ラウンド遊ぶので1分ほどかかる。 */
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const parse = (s) => { const m = (s || '').match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bgOf = (w, el) => {   // 自分から上へたどって背景色を合成する（背景画像やグラデーションは色の近い代表として最初の色を使う）
    const layers = [];
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = w.getComputedStyle(e);
      let c = parse(cs.backgroundColor);
      if ((!c || c.a === 0) && cs.backgroundImage.includes('gradient')) c = parse((cs.backgroundImage.match(/rgba?\([^)]+\)/) || [])[0]);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let out = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) out = over(layers[i], out);
    return out;
  };
  const visible = (w, el) => { const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false; for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const cs = w.getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; } return true; };
  const audit = (w, label, out) => {
    const d = w.document;
    for (const el of d.querySelectorAll('body *')) {
      if (['SCRIPT', 'STYLE', 'OPTION'].includes(el.tagName) || !visible(w, el)) continue;
      const isIcon = el.classList && el.classList.contains('ico');
      const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      if (!hasText && !isIcon) continue;
      const cs = w.getComputedStyle(el);
      const bg = bgOf(w, el), fgRaw = parse(cs.color); if (!fgRaw) continue;
      const fg = over(fgRaw, bg), cr = ratio(fg, bg);
      if (cr >= 4.5) continue;
      const text = isIcon ? '（アイコン）' : [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').slice(0, 24);
      const who = (el.id ? '#' + el.id : el.tagName.toLowerCase()) + (el.classList.length ? '.' + [...el.classList].join('.') : '');
      out.push({ 画面: label, 判定: cr < 3 ? 'NG' : '注意', 比: +cr.toFixed(2), 文字: text, 場所: who, 文字色: cs.color, 背景: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})` });
    }
  };
  const open = async (path) => {
    const fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;left:0;top:0;border:0;width:375px;height:900px;opacity:0;pointer-events:none';
    fr.src = path; document.body.appendChild(fr);
    await new Promise(r => fr.onload = r);
    const w = fr.contentWindow;
    const st = w.document.createElement('style'); st.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}'; w.document.head.appendChild(st);
    await Promise.race([w.document.fonts.ready, sleep(3000)]); await sleep(500);
    return fr;
  };
  const until = async (fn, ms = 25000) => { const s = Date.now(); while (!fn()) { if (Date.now() - s > ms) throw new Error('timeout'); await sleep(100); } };
  const out = [];
  const mode = matchMedia('(prefers-color-scheme: dark)').matches ? 'ダーク' : 'ライト';
  ['geoking_room', 'geoking_token', 'geoking_pid', 'geoking_revealed'].forEach(k => sessionStorage.removeItem(k));
  // ホーム → ロビー → 対戦（選ぶ・結果）→ 結果発表
  {
    const fr = await open('/static/index.html'); const w = fr.contentWindow, S = () => w.eval('state');
    audit(w, 'ホーム', out);
    w.document.getElementById('nameInput').value = 'contrast'; w.document.getElementById('createBtn').click();
    await until(() => S() && S().phase === 'lobby'); await sleep(400);
    w.send({ type: 'chat', text: 'こんにちは' }); await sleep(900);
    w.floatChat({ name: 'システム', key: 'joined', params: { name: 'ゲスト' }, ts: 1 }); await sleep(900);   // 流れるチャット（自分・システム）。動きは止めてあるので画面の下で測る
    audit(w, 'ロビー（流れるチャットも）', out);
    w.send({ type: 'settings', settings: { rounds: 3, hand_size: 4, timer: 30 } }); await until(() => S().settings.rounds === 3);
    w.send({ type: 'start', with_bot: true });
    for (let rnd = 1; rnd <= 3; rnd++) {
      await until(() => S().phase === 'pick' && S().round === rnd); await sleep(500);
      if (rnd === 1) { w.document.querySelector('#hand > *').click(); await sleep(300); audit(w, '対戦（選ぶ・1枚選んだところ）', out); }
      w.send({ type: 'pick', card: S().hand[0] });
      await until(() => S().phase === 'reveal'); await sleep(700);
      if (rnd === 1) audit(w, '対戦（結果）', out);
    }
    await until(() => S().phase === 'end', 30000); await sleep(800);
    audit(w, '結果発表', out);
    w.send({ type: 'leave' }); await sleep(300); fr.remove();
  }
  // 図鑑（一覧・ランキング・国データの小窓）
  {
    const fr = await open('/static/zukan.html'); const w = fr.contentWindow;
    audit(w, '図鑑（国旗一覧）', out);
    w.document.getElementById('soundBtn').click(); await sleep(200); audit(w, '図鑑（効果音を切ったところ）', out); w.document.getElementById('soundBtn').click(); await sleep(200);
    w.document.getElementById('tabRank').click(); await sleep(500); audit(w, '図鑑（ランキング）', out);
    w.showCountry('jp'); await sleep(800); audit(w, '図鑑（国データの小窓）', out);
    fr.remove();
  }
  // クイズ（メニュー・問題）
  {
    const fr = await open('/static/quiz.html'); const w = fr.contentWindow;
    audit(w, 'クイズ（メニュー）', out);
    for (const [sel, name] of [['[data-mode="flag"][data-level="normal"]', '国旗モード'], ['[data-mode="name"][data-level="normal"]', '国名モード'],
                               ['[data-mode="flag"][data-level="hard"]', '国旗モード・激ムズ'], ['[data-mode="name"][data-level="hard"]', '国名モード・激ムズ']]) {
      w.document.querySelector('.qlevel' + sel).click(); await sleep(800); audit(w, `クイズ（${name}の問題）`, out);
      const ans = w.eval('qList[qIdx].answer.id');
      [...w.document.querySelectorAll('.qopt')].find(b => b.dataset.id !== ans).click(); await sleep(250);   // わざと間違えて、正解・不正解の両方を出す
      audit(w, `クイズ（${name}で答えた直後）`, out);
      await sleep(1800); w.eval('renderMenu()'); await sleep(300);
    }
    for (const [score, name] of [[10, '金'], [8, '銀'], [5, '銅']]) { w.eval(`qScore = ${score}; finish()`); await sleep(400); audit(w, `クイズ（結果・${name}）`, out); }
    fr.remove();
  }
  { const fr = await open('/static/privacy.html'); audit(fr.contentWindow, 'プライバシーポリシー', out); fr.remove(); }
  ['geoking_room', 'geoking_token', 'geoking_pid', 'geoking_revealed'].forEach(k => sessionStorage.removeItem(k));
  // 同じ画面・同じ場所・同じ色の組み合わせはまとめる（色が違えば別に出す。同じ部品でも読みにくさが違うことがある）
  const seen = new Map();
  for (const r of out) { const k = [r.画面, r.場所, r.文字色, r.背景].join('|'); if (!seen.has(k) || seen.get(k).比 > r.比) seen.set(k, r); }
  const list = [...seen.values()].sort((a, b) => a.比 - b.比);
  console.log(`${mode}モード: NG ${list.filter(r => r.判定 === 'NG').length} 件、注意 ${list.filter(r => r.判定 === '注意').length} 件`);
  console.table(list);
  return { mode, NG: list.filter(r => r.判定 === 'NG'), 注意: list.filter(r => r.判定 === '注意') };
})();
