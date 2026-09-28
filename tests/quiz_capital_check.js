/* クイズの「首都モード」の確認: 開発サーバーのホーム画面をブラウザで開き、コンソールで実行する（30秒ほど）。
   枠（幅320px）の中にクイズを開き、次を見る:
   - 出題に使う国の首都を全部、4つずつボタンに入れて、日本語・英語とも首都と国名がボタンからはみ出さない。答える前と後でボタンの高さが変わらない
   - ふつう: 10問・答えが重ならない・4つの首都がちがう・出さない国（CAPITAL_SKIP）は答えにもはずれにも出ない・似すぎた組（CAPITAL_TWINS）は並ばない
   - 激ムズ: 4つがどれも同じ「似ている首都のグループ」（SIMILAR_CAPITALS）から出る
   - 答えたあと、どのボタンにも国名が出る。まちがえた国の結果に首都が出る。?mode=capital で首都モードが始まる
   2026-09-28: 首都モードを追加 */
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const results = {};
  const open = async (src) => {
    const fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;left:0;top:0;border:0;width:320px;height:700px;opacity:0;pointer-events:none';
    fr.src = src; document.body.appendChild(fr);
    await new Promise(r => fr.onload = r);
    const w = fr.contentWindow;
    for (let i = 0; i < 50 && !w.eval('typeof META !== "undefined" && META'); i++) await sleep(100);
    await Promise.race([w.document.fonts.ready, sleep(3000)]);
    return fr;
  };
  let fr = await open('/static/quiz.html');
  let w = fr.contentWindow, d = w.document;
  const st = d.createElement('style'); st.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}'; d.head.appendChild(st);
  const M = w.eval('META'), ok = w.eval('capitalOk'), skip = w.eval('CAPITAL_SKIP'), groups = w.eval('SIMILAR_CAPITALS'), twins = w.eval('CAPITAL_TWINS');
  const usable = Object.values(M.countries).filter(ok);
  results['出題に使う国'] = `${usable.length}か国（出さない国 ${skip.size}）`;
  const bad = groups.flatMap(g => g.filter(id => !M.countries[id]));
  const small = groups.filter(g => g.filter(id => ok(M.countries[id])).length < 4);
  results['似ている首都のグループ'] = bad.length || small.length ? `NG: データにない ${bad.join(',')} / 4か国に足りない ${small.length}` : `OK（${groups.length}グループ）`;
  const caps = usable.map(c => c.capital_ja); const dup = caps.filter((x, i) => caps.indexOf(x) !== i);
  results['首都（日本語）が重ならない'] = dup.length ? 'NG: ' + dup.join(',') : 'OK';

  // 全部の首都を4つずつ入れて、はみ出しと高さを見る（320px）
  const inside = (btn) => {   // ボタンの内側（余白と枠線の内側）から、文字が横にはみ出していないか
    const b = btn.getBoundingClientRect(), cs = w.getComputedStyle(btn);
    const l = b.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft) - 0.5, r = b.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight) + 0.5;
    const tw = d.createTreeWalker(btn, NodeFilter.SHOW_TEXT);
    for (let n; (n = tw.nextNode());) { if (!n.textContent.trim()) continue; const rg = d.createRange(); rg.selectNodeContents(n); if ([...rg.getClientRects()].some(x => x.width && (x.left < l - 6 || x.right > r + 6))) return n.textContent.trim(); }   // 国名は左右6pxの余白まで使える
    return '';
  };
  w.eval('window.__st = window.setTimeout; window.setTimeout = () => 0');   // 答えたあとに次の問題へ進む時計を止める（測っている間に描き直されないように）
  for (const lang of ['ja', 'en']) {
    w.setLang(lang); await sleep(150);
    d.querySelector('.qlevel[data-mode="capital"][data-level="normal"]').click(); await sleep(100);
    const over = [], grew = [];
    for (let i = 0; i < usable.length; i += 4) {
      const opts = usable.slice(i, i + 4); while (opts.length < 4) opts.push(usable[opts.length]);
      w.eval('qList')[0] = { answer: opts[0], options: opts }; w.eval('qIdx = 0; renderQuestion()'); await sleep(30);
      const btns = [...d.querySelectorAll('.qopt')], h0 = btns.map(b => Math.round(b.getBoundingClientRect().height));
      btns.forEach(b => { const o = inside(b); if (o) over.push(o); });
      w.eval('qLocked = false'); btns[1].click(); await sleep(30);   // 答えたあと（国名が出る）
      btns.forEach((b, k) => { const o = inside(b); if (o) over.push(o); if (Math.round(b.getBoundingClientRect().height) !== h0[k]) grew.push(b.innerText.replace(/\n/g, '/')); });
    }
    results[`${lang}: 全部の首都と国名が320pxのボタンに収まる`] = over.length ? `NG: ${[...new Set(over)].slice(0, 12).join(', ')}` : 'OK';
    results[`${lang}: 答えたあともボタンの高さが変わらない`] = grew.length ? `NG: ${grew.slice(0, 8).join(', ')}` : 'OK';
    results[`${lang}: ページが横にはみ出さない`] = d.documentElement.scrollWidth <= 320 ? 'OK' : `NG: ${d.documentElement.scrollWidth}px`;
    w.eval('renderMenu()'); await sleep(100);
  }
  w.eval('window.setTimeout = window.__st');
  fr.remove();

  // ふつう・激ムズの問題の作り方（答えたあとの画面が進む時計と混ざらないよう、作り方だけを直接見る）
  fr = await open('/static/quiz.html'); w = fr.contentWindow; d = w.document;
  const inGroup = (ids) => groups.some(g => ids.every(id => g.includes(id)));
  const isTwin = (a, b) => twins.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
  for (const hard of [false, true]) {
    let ng = '';
    for (let n = 0; n < 60 && !ng; n++) {
      const qs = w.eval(`makeQuestions(${hard}, 'capital')`);
      if (qs.length !== 10) ng = `${qs.length}問しかない`;
      else if (new Set(qs.map(q => q.answer.id)).size !== 10) ng = '答えが重なっている';
      for (const q of qs) {
        const ids = q.options.map(o => o.id);
        if (ids.length !== 4 || new Set(ids).size !== 4 || !ids.includes(q.answer.id)) ng = '4択になっていない: ' + ids.join(',');
        else if (new Set(q.options.map(o => o.capital_ja)).size !== 4) ng = '同じ首都が並んでいる: ' + ids.join(',');
        else if (ids.some(id => skip.has(id))) ng = '出さない国が入っている: ' + ids.join(',');
        else if (hard && !inGroup(ids)) ng = '同じグループでない: ' + ids.join(',');
        else if (!hard && ids.some(a => ids.some(b => isTwin(a, b)))) ng = '似すぎた組が並んでいる: ' + ids.join(',');
      }
    }
    results[`${hard ? '激ムズ' : 'ふつう'}: 10問・4つの首都がちがう・出さない国なし${hard ? '・同じグループ' : '・似すぎた組なし'}（60回）`] = ng ? 'NG: ' + ng : 'OK';
  }
  // 国旗モード・国名モードは今までどおり（首都の「出さない国」に縛られない）
  let flagSkip = 0;
  for (let n = 0; n < 30; n++) flagSkip += w.eval("makeQuestions(false, 'flag')").flatMap(q => q.options).filter(c => skip.has(c.id)).length;
  results['国旗モード: 今までどおり（シンガポールなども出る）'] = flagSkip > 0 ? 'OK' : 'NG: 首都モードの決まりが国旗モードにも効いている';
  // 結果: まちがえた国に首都が出る
  w.setLang('ja'); await sleep(100);
  d.querySelector('.qlevel[data-mode="capital"][data-level="hard"]').click(); await sleep(100);
  const hardOk = w.eval('qMode') === 'capital' && w.eval('qHard') === true;
  w.eval('qWrong = [qList[0].answer]; finish()'); await sleep(100);
  const cap = d.querySelector('#qWrong .qw .qw-cap');
  results['結果: まちがえた国に首都が出る'] = cap && cap.textContent === w.eval('capName(qList[0].answer)') ? 'OK' : 'NG';
  d.getElementById('qReplay').click(); await sleep(100);
  results['同じ問題でもう一度も首都モード・激ムズのまま'] = hardOk && w.eval('qMode') === 'capital' && w.eval('qHard') === true ? 'OK' : 'NG';
  fr.remove();
  fr = await open('/static/quiz.html?mode=capital&level=hard'); w = fr.contentWindow;
  await sleep(200);
  results['?mode=capital&level=hard で首都モード・激ムズが始まる'] = w.eval('qMode') === 'capital' && w.eval('qHard') === true && !w.document.getElementById('qplay').classList.contains('hidden') ? 'OK' : 'NG';
  fr.remove();
  console.table(results);
  return results;
})();
