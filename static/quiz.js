/* ひとりで国旗クイズ（サーバー不要。国データは /api/meta）
   - 国旗モード: 国名 → 国旗を4枚から選ぶ
   - 国名モード: 国旗 → 国名を4つから選ぶ
   10問・4択。むずかしさ「ふつう」はまちがい選択肢を同じ地域の国から優先して選ぶ。
   「激ムズ」は、似ている国旗のグループ（SIMILAR_FLAGS）から4つを選択肢にする（1問ごとに別のグループ） */
const Q_TOTAL = 10;
let qMode = 'flag', qHard = false, qList = [], qIdx = 0, qScore = 0, qWrong = [], qLocked = false;

// 似ている国旗のグループ（激ムズ用）。1グループ4か国以上。2026-09-26 に作った一覧（参考: geoguessrtips.com の「似ている国旗」と、197か国の見直し）
const SIMILAR_FLAGS = [
  ['td', 'ro', 'md', 'ad'],   // 青・黄・赤の縦3色
  ['id', 'mc', 'pl', 'sg', 'mt'],   // 赤と白の2色
  ['nl', 'lu', 'py', 'hr'],   // 赤・白・青の横3色
  ['ar', 'hn', 'ni', 'sv', 'gt'],   // 水色・白・水色の横3本（中南米）
  ['co', 'ec', 've', 'am'],   // 黄・青・赤の横じま
  ['au', 'nz', 'ck', 'tv', 'fj', 'nu'],   // 左上にイギリスの旗
  ['so', 'fm', 'nr', 'mh'],   // 水色・紺色の地に白い星
  ['bh', 'qa', 'mt', 'lv'],   // 白と赤のギザギザ
  ['ie', 'ci', 'it', 'mx', 'fr', 'ng'],   // 縦3色で真ん中が白
  ['ml', 'gn', 'sn', 'cm'],   // 緑・黄・赤の縦3色
  ['eg', 'ye', 'iq', 'sy'],   // 赤・白・黒の横3色
  ['ru', 'si', 'sk', 'rs'],   // 白・青・赤の横3色
  ['in', 'ne', 'hu', 'bg', 'tj', 'ir'],   // オレンジ・赤／白／緑の横3色
  ['dk', 'no', 'is', 'se', 'fi'],   // 北欧の十字
  ['tr', 'tn', 'az', 'ly', 'uz'],   // 白い三日月と星
  ['al', 'me', 'kg', 'mk', 'vn', 'ma', 'cn'],   // 赤一色の地に印ひとつ
  ['bo', 'gh', 'lt', 'mm', 'et'],   // 赤・黄・緑の横じま
  ['gr', 'uy', 'ar', 'il'],   // 青と白のしま
  ['cz', 'ph', 'cu', 'bs', 'dj'],   // 左に三角＋横じま（チェコ型）
  ['sl', 'ga', 'rw', 'ls', 'gm'],   // 緑・白（黄）・青の横じま
  ['tz', 'kn', 'na', 'sb', 'cd'],   // ななめの帯で2色に分ける
  ['ht', 'li', 'do', 'pa'],   // 上が青・下が赤（青と赤で分ける）
  ['ae', 'kw', 'jo', 'sd'],   // 赤・緑・白・黒の4色（アラブ）
  ['ke', 'ss', 'mw', 'ly'],   // 黒・赤・緑の横じま
  ['th', 'cr', 'kp', 'la', 'kh', 'sr'],   // 太い帯を細い帯ではさむ（タイ型）
  ['us', 'lr', 'my', 'cl', 'ws'],   // 左上に青い四角と星
  ['jp', 'bd', 'pw', 'kr'],   // 真ん中に丸ひとつ
  ['at', 'lv', 'lb', 'es', 'ca', 'pe'],   // 赤・白・赤の3本
  ['pk', 'dz', 'mr', 'tm', 'mv', 'sa'],   // 緑の地に三日月や文字
  ['bj', 'gw', 'mg', 'by', 'om'],   // 左に縦の帯＋右に横じま
  ['gw', 'st', 'bf', 'tg'],   // 赤・黄・緑に星
  ['de', 'be', 'ug', 'ao'],   // 黒・赤・黄の3色
  ['za', 'vu', 'gy', 'er', 'tl'],   // 横向きのY字・大きな三角
  ['bb', 'vc', 'lc', 'bs'],   // カリブの青（水色）と黄色
  ['gq', 'ss', 'mz', 'zw', 'km'],   // 左に三角＋横じま（アフリカ）
  ['ch', 'dk', 'to', 'ge'],   // 赤と白の十字
  ['jm', 'bi', 'gd', 'dm'],   // X字や十字と真ん中の印
  ['tt', 'pg', 'cg', 'bn', 'bt'],   // ななめに分けた旗
  ['xk', 'ba', 'cy', 'cv'],   // 国の形や星（青地・白地）
];

const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function makeQuestions(hard) {
  const all = Object.values(META.countries);
  if (hard) {   // グループをまぜて10個選び、それぞれから答え1つと、同じグループのほかの3つ
    const groups = shuffle(SIMILAR_FLAGS.map(g => g.filter(id => META.countries[id])).filter(g => g.length >= 4));
    const used = new Set(), qs = [];
    for (const g of groups) {
      if (qs.length >= Q_TOTAL) break;
      const cand = g.filter(id => !used.has(id));   // 2つのグループに入っている国が、2回答えにならないように
      if (!cand.length) continue;
      const ans = cand[Math.floor(Math.random() * cand.length)];
      const others = shuffle(g.filter(id => id !== ans)).slice(0, 3);
      used.add(ans);
      qs.push({ answer: META.countries[ans], options: shuffle([ans, ...others]).map(id => META.countries[id]) });
    }
    return qs;
  }
  const picked = shuffle([...all]).slice(0, Q_TOTAL);
  return picked.map(c => {
    const same = all.filter(x => x.id !== c.id && x.region === c.region);
    const pool = same.length >= 3 ? same : all.filter(x => x.id !== c.id);
    const wrong = shuffle([...pool]).slice(0, 3);
    return { answer: c, options: shuffle([c, ...wrong]) };
  });
}

function showScreen(id) { document.querySelectorAll('.qscreen').forEach(s => s.classList.add('hidden')); $('#' + id).classList.remove('hidden'); }

function renderMenu() {
  showScreen('qmenu');
}

function startQuiz(mode, same = false, hard = false) {   // same: 直前と全く同じ問題（問題の順番・4つの選択肢と並びも同じ）でもう一度。hard: 激ムズ
  qMode = mode; qHard = hard; if (!same || !qList.length) qList = makeQuestions(hard); qIdx = 0; qScore = 0; qWrong = [];
  $('#qTotal').textContent = Q_TOTAL;
  sfx.start();
  showScreen('qplay');
  renderQuestion();
}

function renderQuestion() {
  qLocked = false;
  const q = qList[qIdx];
  $('#qNum').textContent = qIdx + 1; $('#qScore').textContent = qScore;
  $('#qFill').style.width = (qIdx / Q_TOTAL * 100) + '%';
  $('#qFeedback').textContent = ''; $('#qFeedback').className = 'qfeedback';
  const pr = $('#qPrompt'), box = $('#qOptions'); box.innerHTML = '';
  if (qMode === 'flag') {
    pr.innerHTML = `<div class="qp-label">${t('which_flag')}</div><div class="qp-name">${escapeHtml(cname(q.answer))}</div>`;
    box.className = 'qoptions flags';
    for (const c of q.options) {
      const b = el('button', 'qopt flag'); b.dataset.id = c.id;
      b.innerHTML = `<img src="${flagUrl(c.id, 320)}" alt="">`;
      b.onclick = () => answer(c.id, b); box.appendChild(b);
    }
  } else {
    pr.innerHTML = `<div class="qp-label">${t('which_name')}</div><img class="qp-flag" src="${flagUrl(q.answer.id, 640)}" alt="">`;
    box.className = 'qoptions names';
    for (const c of q.options) {
      const b = el('button', 'qopt name', escapeHtml(cname(c))); b.dataset.id = c.id;
      b.onclick = () => answer(c.id, b); box.appendChild(b);
    }
  }
  if (qIdx > 0) sfx.round();
}

function answer(id, btn) {
  if (qLocked) return; qLocked = true;
  const q = qList[qIdx], ok = id === q.answer.id;
  document.querySelectorAll('.qopt').forEach(b => {
    b.disabled = true;
    if (b.dataset.id === q.answer.id) b.classList.add('correct');
    else if (b === btn) b.classList.add('wrong');
    else b.classList.add('dim');
    if (qMode === 'flag') b.insertAdjacentHTML('beforeend', `<span class="qopt-nm">${escapeHtml(cname(META.countries[b.dataset.id]))}</span>`);
  });
  const fb = $('#qFeedback');
  if (ok) { qScore++; fb.textContent = t('correct'); fb.className = 'qfeedback ok'; sfx.win(); }
  else { qWrong.push(q.answer); fb.textContent = t('wrong_answer', { name: cname(q.answer) }); fb.className = 'qfeedback ng'; sfx.error(); }
  $('#qScore').textContent = qScore;
  setTimeout(() => { qIdx++; if (qIdx >= Q_TOTAL) finish(); else renderQuestion(); }, ok ? 1000 : 1700);
}

function finish() {
  $('#qFill').style.width = '100%';
  const rate = qScore / Q_TOTAL;
  const tier = rate === 1 ? 'g' : rate >= 0.8 ? 's' : rate >= 0.5 ? 'b' : 'n';
  $('#qResDisc').className = 'qres-disc ' + tier;
  $('#qResDisc').innerHTML = rate === 1 ? ico('crown') : rate >= 0.8 ? ico('trophy') : rate >= 0.5 ? ico('star') : ico('flag');
  $('#qResTitle').textContent = rate === 1 ? t('res_perfect') : rate >= 0.8 ? t('res_great') : rate >= 0.5 ? t('res_good') : t('res_tryagain');
  $('#qResScore').textContent = qScore; $('#qResTotal').textContent = Q_TOTAL;
  // まちがえた問題があれば「同じ問題でもう一度」、全問正解なら「新しい問題に挑戦」を目立たせる（ボタンの並びは変えない）
  $('#qReplay').classList.toggle('primary', qWrong.length > 0); $('#qAgain').classList.toggle('primary', qWrong.length === 0);
  const wrap = $('#qWrongWrap'), box = $('#qWrong'); box.innerHTML = '';
  wrap.classList.toggle('hidden', qWrong.length === 0);
  for (const c of qWrong) {
    const d = el('div', 'qw'); d.innerHTML = `<img src="${flagUrl(c.id, 160)}" alt=""><div>${escapeHtml(cname(c))}</div>`;
    d.onclick = () => { sfx.select(); showCountry(c.id); }; box.appendChild(d);
  }
  showScreen('qresult');
  setTimeout(() => { if (rate === 1) sfx.champion(); else if (rate >= 0.5) sfx.win(); else sfx.lose(); }, 250);
  if (rate >= 0.8 && typeof spawnConfetti === 'function') setTimeout(() => spawnConfetti($('#qResDisc'), rate === 1 ? 'gold' : 'silver'), 400);
}

// 紙吹雪（対戦画面と同じ見た目）
const CONFETTI = { gold: { n: 60, cols: ['#f4c542', '#e8674a', '#1f6f4a', '#fff', '#ffd25e'] }, silver: { n: 25, cols: ['#d5dae2', '#fff', '#9ca3af', '#f4c542'] } };
function spawnConfetti(target, tier) {
  const cfg = CONFETTI[tier]; if (!cfg || !target) return;
  const box = el('div', 'confetti');
  for (let i = 0; i < cfg.n; i++) {
    const s = document.createElement('i'); const a = Math.random() * Math.PI * 2, r = 80 + Math.random() * 140;
    s.style.setProperty('--dx', (Math.cos(a) * r).toFixed(0) + 'px'); s.style.setProperty('--dy', (Math.sin(a) * r * 0.6 - 60 + Math.random() * 120).toFixed(0) + 'px');
    s.style.setProperty('--rot', (Math.random() * 720 - 360).toFixed(0) + 'deg'); s.style.background = cfg.cols[i % cfg.cols.length]; s.style.animationDelay = (Math.random() * 0.15).toFixed(2) + 's';
    box.appendChild(s);
  }
  target.appendChild(box); setTimeout(() => box.remove(), 1800);
}

(async function init() {
  trackVisit('quiz');
  META = await loadMeta();
  document.querySelectorAll('.qlevel').forEach(b => b.onclick = () => startQuiz(b.dataset.mode, false, b.dataset.level === 'hard'));
  $('#qQuit').onclick = () => { if (confirm(t('confirm_quit'))) { sfx.leave(); renderMenu(); } };
  $('#qReplay').onclick = () => startQuiz(qMode, true, qHard);
  $('#qAgain').onclick = () => startQuiz(qMode, false, qHard);
  $('#qOther').onclick = () => renderMenu();
  $('#modal').onclick = (e) => { if (e.target.id === 'modal') { $('#modal').classList.add('hidden'); sfx.close(); } };
  window.onLangChange = () => { document.title = t('quiz_title'); if (!$('#qmenu').classList.contains('hidden')) renderMenu(); renderPrefs(); };
  const q = new URLSearchParams(location.search);
  if (q.get('mode') === 'flag' || q.get('mode') === 'name') startQuiz(q.get('mode'), false, q.get('level') === 'hard'); else renderMenu();
  frameReady();
})();
