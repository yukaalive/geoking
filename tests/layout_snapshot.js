/* 変更前後の見た目の比較: 頼まれた所以外の画面が変わっていないかを確かめる。
   開発サーバーのホーム画面（/static/index.html）を開いたブラウザのコンソールで実行する。
   1. 変更する前に: layoutSnapshot('before') … 各画面・各幅・日本語/英語で、全要素の位置と大きさを記録（localStorage に保存）
   2. 変更したあとに: layoutCompare('before') … もう一度記録して比べ、変わった要素を一覧にする
   画面: ホーム・ロビー（枠の中で部屋を作る）・図鑑・クイズ・プライバシーポリシー。幅: 320 / 375 / 1024px。
   アニメーションは止め、公開部屋の一覧など通信で中身が変わる所は比べない。
   変わった要素は「大きさ・横位置が変わった」（本当に変わった所）と「縦にずれただけ」（上の要素が変わった影響）に分けて出す。
   頼んだ変更で説明がつかない行が1つでもあれば、意図しない変更が混ざっている。 */
(() => {
  const PAGES = ['home', 'lobby', 'zukan', 'quiz', 'privacy'];
  const WIDTHS = [320, 375, 1024];
  const SKIP = '#publicRoomList, #toast, .toast, #chatLog, .chatslot, #modal';   // 通信や時刻で中身が変わる所
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const pathOf = (el) => {   // 要素の住所（id があれば id から）
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && e.tagName !== 'BODY'; e = e.parentElement) {
      if (e.id) { parts.unshift('#' + e.id); break; }
      const sib = [...e.parentElement.children].filter(x => x.tagName === e.tagName);
      parts.unshift(e.tagName.toLowerCase() + (e.classList[0] ? '.' + e.classList[0] : '') + (sib.length > 1 ? `:nth(${sib.indexOf(e) + 1})` : ''));
    }
    return parts.join(' > ');
  };
  const record = (w) => {
    const out = {};
    for (const e of w.document.querySelectorAll('#roomTitle, #lobbyCode')) e.textContent = 'ROOM';   // 部屋名は作るたびに変わる（同名があると「2」が付く）ので固定してから測る
    const skipRoots = [...w.document.querySelectorAll(SKIP)];
    for (const el of w.document.querySelectorAll('body *')) {
      if (skipRoots.some(s => s.contains(el)) || ['SCRIPT', 'STYLE', 'use', 'path', 'rect', 'circle', 'g'].includes(el.tagName)) continue;
      const cs = w.getComputedStyle(el);
      if (cs.display === 'none') continue;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      out[pathOf(el)] = [Math.round(r.left), Math.round(r.top + w.scrollY), Math.round(r.width), Math.round(r.height), cs.fontSize, cs.visibility === 'hidden' ? 'hidden' : ''].join(',');
    }
    out.__pageWidth = String(w.document.documentElement.scrollWidth);
    return out;
  };
  const openPage = async (page, W) => {
    const fr = document.createElement('iframe');
    fr.style.cssText = `position:fixed;left:0;top:0;border:0;width:${W}px;height:900px;opacity:0;pointer-events:none`;
    fr.src = page === 'home' || page === 'lobby' ? '/static/index.html' : `/static/${page}.html`;
    document.body.appendChild(fr);
    await new Promise(r => fr.onload = r);
    const w = fr.contentWindow;
    const st = w.document.createElement('style'); st.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}'; w.document.head.appendChild(st);
    await Promise.race([Promise.all([...w.document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))), sleep(4000)]);
    await sleep(300);
    if (page === 'lobby') {
      w.sessionStorage.removeItem('geoking_room');
      w.document.getElementById('nameInput').value = 'snapshot';
      w.document.getElementById('createBtn').click();
      for (let i = 0; i < 50 && w.document.getElementById('lobby').classList.contains('hidden'); i++) await sleep(100);
      await sleep(300);
    }
    return fr;
  };
  const take = async () => {
    const snap = {};
    for (const W of WIDTHS) for (const page of PAGES) {
      const fr = await openPage(page, W); const w = fr.contentWindow;
      for (const lang of (typeof w.setLang === 'function' ? ['ja', 'en'] : ['ja'])) {
        if (w.setLang) { w.setLang(lang); await sleep(250); }
        snap[`${page}@${W}px/${lang}`] = record(w);
      }
      if (w.setLang) w.setLang('ja');
      if (page === 'lobby' && typeof w.send === 'function') { w.send({ type: 'leave' }); await sleep(300); }
      fr.remove();
    }
    ['geoking_room', 'geoking_token', 'geoking_pid'].forEach(k => sessionStorage.removeItem(k));   // 枠の中で作った部屋が、このタブの保存に残らないように（枠とタブは同じ保存を使う）
    snap.__env = envOf();
    return snap;
  };
  // 測る条件（スクロールバーの幅など）。記録したときと比べたときで違うと、変えていない所まで「変わった」と出る
  const envOf = () => { const d = document.createElement('div'); d.style.cssText = 'position:absolute;top:-999px;width:100px;height:100px;overflow:scroll'; document.body.appendChild(d); const sb = 100 - d.clientWidth; d.remove(); return `スクロールバー${sb}px・画面の幅${innerWidth}px`; };
  window.layoutSnapshot = async (name = 'before') => {
    const snap = await take();
    localStorage.setItem('__layout_' + name, JSON.stringify(snap));
    const screens = Object.keys(snap).filter(k => k !== '__env'); const n = screens.reduce((a, k) => a + Object.keys(snap[k]).length, 0);
    const msg = `記録しました: ${name}（${screens.length} 画面, ${n} 要素。${snap.__env}）`;
    console.log(msg);
    return msg;
  };
  window.layoutCompare = async (name = 'before') => {
    const before = JSON.parse(localStorage.getItem('__layout_' + name) || 'null');
    if (!before) return `先に layoutSnapshot('${name}') で記録してください`;
    const after = await take();
    const report = {};
    if (before.__env !== after.__env) report['注意'] = [`測った条件が記録したときと違います（記録: ${before.__env || '不明'} / 今: ${after.__env}）。変えていない所まで変化として出ることがあるので、同じ条件（ブラウザの表示の大きさを戻す等）で測り直してください`];
    for (const key of Object.keys(after)) {
      if (key === '__env') continue;
      const a = after[key], b = before[key] || {};
      const changed = [], movedY = [], added = [], removed = [];
      for (const p of Object.keys(a)) {
        if (p === '__pageWidth') continue;
        if (!(p in b)) { added.push(p); continue; }
        if (a[p] === b[p]) continue;
        const [x1, y1, w1, h1, f1, v1] = b[p].split(','), [x2, y2, w2, h2, f2, v2] = a[p].split(',');
        if (x1 === x2 && w1 === w2 && h1 === h2 && f1 === f2 && v1 === v2) movedY.push(p);
        else changed.push(`${p}: 横${x1}→${x2} 幅${w1}→${w2} 高さ${h1}→${h2}${f1 !== f2 ? ` 文字${f1}→${f2}` : ''}${v1 !== v2 ? ` 表示${v1 || 'visible'}→${v2 || 'visible'}` : ''}`);
      }
      for (const p of Object.keys(b)) if (p !== '__pageWidth' && !(p in a)) removed.push(p);
      const lines = [];
      if (a.__pageWidth !== b.__pageWidth) lines.push(`ページ幅 ${b.__pageWidth}→${a.__pageWidth}px${+a.__pageWidth > parseInt(key.split('@')[1]) ? '（画面からはみ出している）' : ''}`);
      if (changed.length) lines.push(`大きさ・横位置が変わった ${changed.length} 件:`, ...changed.slice(0, 15), ...(changed.length > 15 ? [`…ほか ${changed.length - 15} 件`] : []));
      if (added.length) lines.push(`増えた ${added.length} 件: ` + added.slice(0, 8).join(' | '));
      if (removed.length) lines.push(`なくなった ${removed.length} 件: ` + removed.slice(0, 8).join(' | '));
      if (movedY.length) lines.push(`縦にずれただけ ${movedY.length} 件（上の要素が変わった影響）`);
      if (lines.length) report[key] = lines;
    }
    const changed = Object.keys(report).filter(k => k !== '注意').length;
    const summary = (report['注意'] ? '【条件が違う】' : '') + (changed ? `${changed} 画面で変化あり` : '変化なし（すべての画面が変更前と同じ）');
    console.log(summary, report);
    return { summary, report };
  };
  return 'layoutSnapshot(名前) / layoutCompare(名前) が使えます';
})();
