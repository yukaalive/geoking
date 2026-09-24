/* 観戦中の「みんなの手札」の確認: 開発サーバーのホーム画面をブラウザで開き、コンソールで実行する。
   iPhone（WebKit）では iOS シミュレーターの Safari で /dev/tests/spectator.html を開くと、同じ確認を流して結果を画面に出す。
   枠Aで部屋を作ってボットと始め（ホスト）、枠Bで途中から入って観戦する。ホストが1枚選んだところ（選択中）と出したところ（勝負）を、
   幅ごとに測る: 国旗が名前と状態（考え中・選択中・勝負）の下の行から左端そろえで始まるか、状態の札に吹き出しの三角がないか、ページが画面からはみ出していないか。
   2026-09-25: 国旗が名前と同じ行に入り、幅 412px の Android で途中から変に改行されていた。 */
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const until = async (fn, what, ms = 25000) => { const s = Date.now(); while (!fn()) { if (Date.now() - s > ms) throw new Error('待ちきれない: ' + what); await sleep(100); } };
  const WIDTHS = [320, 360, 375, 390, 393, 402, 412, 430, 768, 1024];
  const KEYS = ['geoking_room', 'geoking_token', 'geoking_pid', 'geoking_revealed'];   // 枠の中はこのタブと同じ保存を使う
  KEYS.forEach(k => sessionStorage.removeItem(k));
  let savedLang = null; try { savedLang = localStorage.getItem('geoking_lang'); } catch {}
  const frame = async (W) => {
    const f = document.createElement('iframe');
    f.style.cssText = `position:fixed;left:0;top:0;border:0;width:${W}px;height:800px;opacity:0;pointer-events:none`;
    f.src = '/static/index.html'; document.body.appendChild(f);
    await new Promise(r => f.onload = r);
    await Promise.race([f.contentWindow.document.fonts.ready, sleep(3000)]);
    return f;
  };
  const rows = [];
  let A = null, B = null;
  try {
    // ホスト（枠A）: 部屋を作ってボットと始める。選ぶ時間は長めにして、測っている間に次へ進まないように
    A = await frame(412); const wa = A.contentWindow, SA = () => wa.eval('state');
    wa.setLang('ja');
    wa.document.getElementById('nameInput').value = 'ホスト'; wa.document.getElementById('createBtn').click();
    await until(() => SA() && SA().phase === 'lobby', 'ロビー');
    wa.send({ type: 'settings', settings: { rounds: 3, hand_size: 8, timer: 90 } }); await until(() => SA().settings.hand_size === 8 && SA().settings.timer === 90, '設定');
    wa.send({ type: 'start', with_bot: true });
    await until(() => SA().phase === 'pick', '対戦の開始');
    // 観戦者（枠B）: 始まったあとから入る。枠Aの保存を消しておかないと、枠Bが同じプレイヤーとして入り直してしまう
    KEYS.forEach(k => sessionStorage.removeItem(k));
    B = await frame(412); const wb = B.contentWindow, db = wb.document, SB = () => wb.eval('state');
    db.getElementById('nameInput').value = 'みるひと'; db.getElementById('codeInput').value = SA().room; db.getElementById('joinBtn').click();
    await until(() => SB() && SB().phase === 'pick' && SB().live, '観戦に入る');
    const st = db.createElement('style'); st.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}html{scrollbar-width:none}::-webkit-scrollbar{display:none}'; db.head.appendChild(st);
    const measure = async (label) => {
      for (const lang of ['ja', 'en']) {
        wb.setLang(lang); await sleep(300);
        for (const W of WIDTHS) {
          B.style.width = W + 'px'; await sleep(300);
          if (db.documentElement.scrollWidth > W) await sleep(700);   // iPhone は枠の幅を変えてから配置が追いつくまで少しかかる
          const ng = [];
          const h4 = db.querySelector('#othersHands h4');
          const orows = [...db.querySelectorAll('#othersHands .orow.live')];
          if (!orows.length) ng.push('観戦の行がない');
          for (const row of orows) {
            // 位置は offsetTop/offsetLeft で測る（選択中・勝負の国旗は少し浮かせて大きくしてあるので、見た目の枠だと位置がずれて見える）
            const pos = (e) => ({ left: e.offsetLeft, top: e.offsetTop, bottom: e.offsetTop + e.offsetHeight });
            const nm = row.querySelector('.oname'), name = pos(nm), flags = [...row.querySelectorAll('.oflag')].map(pos);
            const who = nm.textContent.trim().slice(0, 12);
            if (flags.some(f => f.top < name.bottom - 1)) ng.push(`${who}: 国旗が名前と同じ行にある`);
            if (flags.length && Math.abs(Math.min(...flags.map(f => f.left)) - pos(row).left) > 1) ng.push(`${who}: 国旗の行が左端から始まっていない`);
            const bub = row.querySelector('.bubble');
            if (bub && wb.getComputedStyle(bub, '::before').content !== 'none') ng.push(`${who}: 状態の札に吹き出しの三角がある`);
          }
          if (db.documentElement.scrollWidth > W) ng.push(`ページ幅 ${db.documentElement.scrollWidth}px（画面からはみ出している）`);
          rows.push({ 場面: label, 言語: lang, 幅: W, 見出し: h4 ? h4.textContent : '（なし）', 状態: orows.map(r => (r.querySelector('.bubble') || {}).textContent || '').join(' / '), 結果: ng.join('、') || 'OK' });
        }
      }
      wb.setLang('ja'); await sleep(200);
    };
    const hostPid = SA().players.find(p => p.name === 'ホスト').pid;
    wa.send({ type: 'selecting', card: SA().hand[0] });
    await until(() => SB().live[hostPid] && SB().live[hostPid].selecting, 'ホストの選択中');
    await measure('ホストが1枚選んだところ');
    wa.send({ type: 'pick', card: SA().hand[0] });
    await until(() => SB().phase !== 'pick' || (SB().live[hostPid] && SB().live[hostPid].pick), 'ホストの勝負');
    if (SB().phase === 'pick') await measure('ホストが出したところ');
  } finally {   // 途中で失敗しても、両方の枠を部屋から抜けさせて消し、このタブの保存（部屋・言語）を元に戻す
    for (const f of [B, A]) { if (!f) continue; try { f.contentWindow.send({ type: 'leave' }); } catch {} }
    await sleep(400); for (const f of [A, B]) if (f) f.remove();
    KEYS.forEach(k => sessionStorage.removeItem(k));
    try { if (savedLang == null) localStorage.removeItem('geoking_lang'); else localStorage.setItem('geoking_lang', savedLang); } catch {}
  }
  console.table(rows);
  return rows;
})();
