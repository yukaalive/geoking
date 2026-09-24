/* ひとりで国旗クイズ（サーバー不要。国データは /api/meta）
   - 国旗モード: 国名 → 国旗を4枚から選ぶ
   - 国名モード: 国旗 → 国名を4つから選ぶ
   10問・4択。まちがい選択肢は同じ地域の国から優先して選ぶ（似た国旗・国名で難しくなる） */
const Q_TOTAL = 10;
let qMode = 'flag', qList = [], qIdx = 0, qScore = 0, qWrong = [], qLocked = false;

const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const bestKey = () => 'geoking_quiz_best_' + qMode;
const getBest = (mode) => { try { return Number(localStorage.getItem('geoking_quiz_best_' + mode) || 0); } catch { return 0; } };

function makeQuestions() {
  const all = Object.values(META.countries);
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
  const b1 = getBest('flag'), b2 = getBest('name');
  $('#bestFlag').textContent = b1 ? t('best_score', { n: b1, total: Q_TOTAL }) : '';
  $('#bestName').textContent = b2 ? t('best_score', { n: b2, total: Q_TOTAL }) : '';
  showScreen('qmenu');
}

function startQuiz(mode) {
  qMode = mode; qList = makeQuestions(); qIdx = 0; qScore = 0; qWrong = [];
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
  const prevBest = getBest(qMode);
  const isBest = qScore > prevBest;
  if (isBest) { try { localStorage.setItem(bestKey(), String(qScore)); } catch {} }
  const rate = qScore / Q_TOTAL;
  const tier = rate === 1 ? 'g' : rate >= 0.8 ? 's' : rate >= 0.5 ? 'b' : 'n';
  $('#qResDisc').className = 'qres-disc ' + tier;
  $('#qResDisc').innerHTML = rate === 1 ? ico('crown') : rate >= 0.8 ? ico('trophy') : rate >= 0.5 ? ico('star') : ico('flag');
  $('#qResTitle').textContent = rate === 1 ? t('res_perfect') : rate >= 0.8 ? t('res_great') : rate >= 0.5 ? t('res_good') : t('res_tryagain');
  $('#qResScore').textContent = qScore; $('#qResTotal').textContent = Q_TOTAL;
  $('#qResBest').textContent = isBest ? t('new_best') : t('best_score', { n: Math.max(prevBest, qScore), total: Q_TOTAL });
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
  META = await (await fetch(API + '/api/meta')).json();
  document.querySelectorAll('.qmode').forEach(b => b.onclick = () => startQuiz(b.dataset.mode));
  $('#qQuit').onclick = () => { if (confirm(t('confirm_quit'))) { sfx.leave(); renderMenu(); } };
  $('#qAgain').onclick = () => startQuiz(qMode);
  $('#qOther').onclick = () => renderMenu();
  $('#modal').onclick = (e) => { if (e.target.id === 'modal') { $('#modal').classList.add('hidden'); sfx.close(); } };
  window.onLangChange = () => { document.title = t('quiz_title'); if (!$('#qmenu').classList.contains('hidden')) renderMenu(); renderPrefs(); };
  const q = new URLSearchParams(location.search);
  if (q.get('mode') === 'flag' || q.get('mode') === 'name') startQuiz(q.get('mode')); else renderMenu();
})();
