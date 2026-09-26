/* クイズの「激ムズ」の確認: 開発サーバーのホーム画面をブラウザで開き、コンソールで実行する（10秒ほど）。
   枠の中にクイズを開き、国旗モード・国名モードの「激ムズ」を何回か始めて、次を見る:
   - 10問あり、答えが重ならない
   - どの問題も4つの選択肢が、同じ「似ている国旗のグループ」（quiz.js の SIMILAR_FLAGS）から出ている
   - 「同じ問題でもう一度」で、問題と選択肢の並びが同じ。「新しい問題に挑戦」も激ムズのまま
   - 「ふつう」は今までどおり（激ムズのグループに縛られない）
   2026-09-26: 似ている国旗4つから選ぶ「激ムズ」を追加 */
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const fr = document.createElement('iframe');
  fr.style.cssText = 'position:fixed;left:0;top:0;border:0;width:375px;height:800px;opacity:0;pointer-events:none';
  fr.src = '/static/quiz.html'; document.body.appendChild(fr);
  await new Promise(r => fr.onload = r);
  const w = fr.contentWindow, d = w.document;
  for (let i = 0; i < 50 && !(w.eval('typeof META !== "undefined" && META')); i++) await sleep(100);
  const results = {};
  const groups = w.eval('SIMILAR_FLAGS');
  const bad = groups.flatMap(g => g.filter(id => !w.eval('META').countries[id]));
  results['グループの国がすべてデータにある'] = bad.length ? 'NG: ' + bad.join(',') : `OK（${groups.length}グループ）`;
  const inOneGroup = (ids) => groups.some(g => ids.every(id => g.includes(id)));
  const sig = () => JSON.stringify(w.eval('qList').map(q => [q.answer.id, q.options.map(o => o.id)]));
  for (const mode of ['flag', 'name']) {
    let ng = '';
    for (let n = 0; n < 30 && !ng; n++) {
      d.querySelector(`.qlevel[data-mode="${mode}"][data-level="hard"]`).click(); await sleep(30);
      const qs = w.eval('qList');
      if (qs.length !== 10) ng = `${qs.length}問しかない`;
      else if (new Set(qs.map(q => q.answer.id)).size !== 10) ng = '答えが重なっている';
      for (const q of qs) {
        const ids = q.options.map(o => o.id);
        if (ids.length !== 4 || new Set(ids).size !== 4) ng = '選択肢が4つでない'; else if (!ids.includes(q.answer.id)) ng = '答えが選択肢にない';
        else if (!inOneGroup(ids)) ng = '同じグループでない選択肢: ' + ids.join(',');
      }
      w.eval('renderMenu()');
    }
    results[`${mode === 'flag' ? '国旗' : '国名'}モード・激ムズ: 10問、答えが重ならず、4択がどれも同じグループ（30回）`] = ng ? 'NG: ' + ng : 'OK';
    d.querySelector(`.qlevel[data-mode="${mode}"][data-level="hard"]`).click(); await sleep(50);
    const s1 = sig(); w.eval('finish()'); d.getElementById('qReplay').click(); await sleep(50);
    const same = sig() === s1 && w.eval('qHard') === true && w.eval('qMode') === mode;
    w.eval('finish()'); d.getElementById('qAgain').click(); await sleep(50);
    const again = w.eval('qHard') === true && w.eval('qMode') === mode && w.eval('qList').every(q => inOneGroup(q.options.map(o => o.id)));
    results[`${mode === 'flag' ? '国旗' : '国名'}モード・激ムズ: 同じ問題でもう一度／新しい問題に挑戦も激ムズのまま`] = same && again ? 'OK' : `NG: same=${same} again=${again}`;
    w.eval('renderMenu()');
  }
  // ふつうは今までどおり（グループに縛られない問題が出る）
  let loose = 0;
  for (let n = 0; n < 5; n++) { d.querySelector('.qlevel[data-mode="flag"][data-level="normal"]').click(); await sleep(30); loose += w.eval('qList').filter(q => !inOneGroup(q.options.map(o => o.id))).length; w.eval('renderMenu()'); }
  results['ふつう: 今までどおり（同じ地域などから選ぶ）'] = loose > 0 && w.eval('qHard') === false ? 'OK' : 'NG: ふつうなのに激ムズの問題になっている';
  fr.remove();
  console.table(results);
  return results;
})();
