/* バトル（体力を減らし合うゲーム。中の名前は survival）の画面の確認: 開発サーバー（GEOKING_DEV=1。launch.json の geoking-check、8090 番など）の
   ホーム画面を開いたブラウザのコンソールで実行する。部屋を作ったら、部屋の設定の「ゲーム」をバトルにしてから遊ぶ。1分半〜2分ほどかかる（javascript_tool は45秒で切れるので、下のように裏で走らせて window.__r を待つ）。
     window.__r = null; eval(await (await fetch('/dev/tests/survival_check.js', { cache: 'no-store' })).text()).then(r => window.__r = r);
   幅 320/375/414px の枠の中でそれぞれ部屋を作り、ボット3体と最後まで遊ぶ（3つの枠は同時に進む）。ラウンドごとに日本語と英語を入れ替える。
   - 選ぶ画面・答え合わせ（演出の途中も 0.25 秒ごと）・結果発表で、ページが枠の幅より広くならないか（後光・弾・火花・ダメージの数字・揺れ・紙吹雪ではみ出さないか）
   - 体力ゲージ: 上の自分の体力・スコアの欄・答え合わせのカードの数字が、演出のあとサーバーの体力と同じか
   - 答え合わせ: 減った人のカードにサーバーの減った体力「−N」、1位（減らなかった人）のカードには出さない。脱落した人のカードにハンコ
   - 結果発表: 最後まで残った人が1位で体力つき、ほかは「Nラウンドで脱落」 */
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const WIDTHS = [320, 375, 414];
  const run = async (W) => {
    const ng = [];
    const fr = document.createElement('iframe');
    fr.style.cssText = `position:fixed;left:0;top:0;border:0;width:${W}px;height:800px;opacity:0;pointer-events:none`;
    fr.src = '/static/index.html'; document.body.appendChild(fr);
    await new Promise(r => fr.onload = r); await sleep(800);
    const w = fr.contentWindow, d = w.document;
    const st = () => w.eval('state'), me = () => st().players.find(p => p.pid === w.eval('pid')), lang = () => w.eval('LANG');
    const over = (tag) => {
      const pw = d.documentElement.scrollWidth; if (pw <= W) return;
      const bad = [];   // はみ出している部品（いちばん右まで出ているもの）。横にスクロールする枠（出された国の一覧）の中身は、ページを広げないので数えない
      const inScroller = (el) => { for (let e = el.parentElement; e && e !== d.body; e = e.parentElement) if (w.getComputedStyle(e).overflowX !== 'visible') return true; return false; };
      for (const el of d.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width && r.right > W + 1 && w.getComputedStyle(el).position !== 'fixed' && !inScroller(el)) bad.push([Math.round(r.right), (el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + [...el.classList].join('.')) + (el.textContent ? `「${el.textContent.trim().slice(0, 12)}」` : '')]);
      }
      bad.sort((a, b) => b[0] - a[0]);
      ng.push(`${tag}: ページ幅 ${pw}px（はみ出し: ${bad.slice(0, 3).map(b => b[1] + ' → ' + b[0]).join(', ')}）`);
    };
    d.getElementById('nameInput').value = 'check' + W;
    d.getElementById('createBtn').click();
    for (let i = 0; i < 60 && !(st() && st().phase === 'lobby'); i++) await sleep(100);
    w.send({ type: 'settings', settings: { rule: 'survival' } });   // 部屋の設定の「ゲーム」をバトルに
    for (let i = 0; i < 40 && !(st() && st().settings.rule === 'survival'); i++) await sleep(100);
    if (!st() || st().settings.rule !== 'survival') { fr.remove(); return { W, ng: ['部屋のゲームをバトルにできなかった'] }; }
    for (let i = 0; i < 3; i++) { w.send({ type: 'add_bot' }); await sleep(250); }
    await sleep(400); over('ロビー');
    w.send({ type: 'start' });
    let last = 0, rounds = 0, kos = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 240000 && st() && st().phase !== 'end') {
      const s = st();
      if (s.phase !== 'pick' || s.round === last) { await sleep(100); continue; }
      last = s.round; rounds++;
      w.setLang(rounds % 2 ? 'ja' : 'en'); await sleep(300);
      const tag = (x) => `R${last} ${x} ${lang()}`;
      over(tag('選ぶ'));
      const m = me();
      if (m && !m.out_round) {
        const n = d.querySelector('#svStatus .sv-hpnum');
        if (!n || +n.textContent !== m.hp) ng.push(`${tag('選ぶ')}: 上の自分の体力 ${n && n.textContent} ≠ ${m.hp}`);
        if (st().hand.length) w.send({ type: 'pick', card: st().hand[0] });
      } else if (!d.querySelector('#svStatus .sv-outtag')) ng.push(`${tag('選ぶ')}: 脱落したのに上に「脱落」がない`);
      for (let i = 0; i < 300 && st().phase === 'pick'; i++) await sleep(100);
      if (st().phase !== 'reveal') continue;
      for (let k = 0; k < 24; k++) { over(tag(`答え合わせ +${k * 250}ms`)); await sleep(250); }   // 演出の途中（1位が光る・弾が飛ぶ・当たる・ハンコ）も。4人で約4.5秒かかるので6秒見る
      const rv = st().reveal, cards = [...d.querySelectorAll('#revealRows .sv-card')];
      if (cards.length !== rv.rows.length) ng.push(`${tag('答え合わせ')}: カード ${cards.length} 枚 ≠ ${rv.rows.length}`);
      rv.rows.forEach((row, i) => {
        const c = cards[i]; if (!c) return;
        const num = c.querySelector('.sv-hpnum');
        if (!num || +num.textContent !== row.hp) ng.push(`${tag('答え合わせ')} ${row.name}: カードの体力 ${num && num.textContent} ≠ ${row.hp}`);
        const dl = c.querySelector('.sv-dmgline');
        const safe = row.winner || !row.damage;
        if (safe ? !!dl : (!dl || !dl.classList.contains('show') || dl.textContent !== '−' + row.damage)) ng.push(`${tag('答え合わせ')} ${row.name}: 減った体力の表示「${dl ? dl.textContent : 'なし'}」（サーバーは ${row.damage}${row.winner ? '・1位' : ''}）`);
        if (row.out) { kos++; if (!c.classList.contains('sv-ko')) ng.push(`${tag('答え合わせ')} ${row.name}: 脱落のハンコがない`); }
        else if (c.classList.contains('sv-ko')) ng.push(`${tag('答え合わせ')} ${row.name}: 脱落していないのにハンコ`);
      });
      for (const p of st().players) {   // スコアの欄: 残っている人は体力の数字、脱落した人は「脱落」
        const num = d.querySelector(`#scoreList .sv-hpnum[data-pid="${p.pid}"]`);
        if (p.out_round ? !!num : (!num || +num.textContent !== p.hp)) ng.push(`${tag('答え合わせ')} スコアの欄 ${p.name}: ${num ? num.textContent : 'なし'}（体力 ${p.hp}${p.out_round ? '・脱落' : ''}）`);
      }
      const FX = '.sv-pop, .fx-wave, .sv-flash, .sv-shot, .sv-chunk, .fx-gold, .fx-bigrays';   // 一度だけ出て消える演出の部品
      if (d.querySelector(FX)) { await sleep(1500); if (d.querySelector(FX)) ng.push(`${tag('答え合わせ')}: 演出の部品が消えずに残っている（${[...new Set([...d.querySelectorAll(FX)].map(e => e.className))].join(', ')}）`); }
    }
    if (!st() || st().phase !== 'end') ng.push('最後まで終わらなかった');
    else {
      await sleep(1200);
      for (const lg of ['ja', 'en']) { w.setLang(lg); await sleep(400); over('結果発表 ' + lg); }
      const lis = [...d.querySelectorAll('#finalList li')], fin = st().final;
      if (lis.length !== fin.length) ng.push(`結果発表: ${lis.length} 行 ≠ ${fin.length}`);
      if (!lis[0] || !lis[0].querySelector('.sv-hpbox')) ng.push('結果発表: 1位の行に体力がない');
      fin.forEach((e, i) => { if (e.out_round && !(lis[i] && lis[i].querySelector('.sv-outnote') && lis[i].textContent.includes(String(e.out_round)))) ng.push(`結果発表 ${e.name}: 「${e.out_round}ラウンドで脱落」がない`); });
      w.setLang('ja');
    }
    w.send({ type: 'leave' }); await sleep(400); fr.remove();
    return { W, rounds, kos, ng };
  };
  const res = await Promise.all(WIDTHS.map(run));
  const bad = res.flatMap(r => r.ng.map(x => `${r.W}px ${x}`));
  return (bad.length ? 'NG\n' + bad.slice(0, 40).join('\n') : 'ALL OK') + '\n' + res.map(r => `${r.W}px: ${r.rounds} ラウンド・脱落 ${r.kos} 回`).join(' ／ ');
})();
