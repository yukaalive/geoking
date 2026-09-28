/* ひとりでクイズ（サーバー不要。国データは /api/meta）
   - 国旗モード: 国名 → 国旗を4枚から選ぶ
   - 国名モード: 国旗 → 国名を4つから選ぶ
   - 首都モード: 国（国旗＋国名）→ 首都を4つから選ぶ（2026-09-28。激ムズは SIMILAR_CAPITALS）
   10問・4択。むずかしさ「ふつう」はまちがい選択肢を同じ地域の国から優先して選ぶ。
   「激ムズ」は、似ている国旗のグループ（SIMILAR_FLAGS）と名前が似ている国のグループ（SIMILAR_NAMES）をまぜて、1問ごとに別のグループから4つを選択肢にする。どちらのモードも同じ */
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

// 名前が似ている国のグループ（激ムズ用。国旗のグループとまぜて使う）。1グループ4か国以上。2026-09-27 に作った一覧（197か国の日本語・英語の名前の見直し）
const SIMILAR_NAMES = [
  ['kn', 'lc', 'vc', 'st', 'sm'],   // セント・サンで始まる
  ['cd', 'cg', 'dm', 'do'],   // 同じ名前で「共和国」だけ違う（コンゴ・ドミニカ）
  ['gn', 'gq', 'gw', 'pg'],   // ギニアが入る
  ['at', 'au', 'al', 'am'],   // オーストリア／オーストラリア、アルバニア／アルメニア
  ['mr', 'mu', 'mv', 'md'],   // モーリタニア／モーリシャス、モルディブ／モルドバ
  ['sd', 'ss', 'za', 'cf'],   // スーダン／南スーダン、南アフリカ／中央アフリカ
  ['sk', 'si', 'lv', 'lt'],   // スロバキア／スロベニア、ラトビア／リトアニア
  ['is', 'ie', 'fi', 'pl', 'nz'],   // 〜ランドで終わる
  ['ir', 'iq', 'il', 'ye'],   // イラン／イラク
  ['ne', 'ng', 'dz', 'tn'],   // ニジェール／ナイジェリア／アルジェリア
  ['gm', 'zm', 'na', 'co'],   // 〜ビアで終わる（ガンビア／ザンビア）
  ['py', 'uy', 'ni', 'gt'],   // グアが入る（パラグアイ／ウルグアイ）
  ['af', 'kz', 'pk', 'tj', 'tm', 'uz'],   // 〜スタンで終わる
  ['tg', 'to', 'ad', 'ao'],   // トーゴ／トンガ、アンドラ／アンゴラ
  ['bn', 'bi', 'bg', 'bf'],   // ブルで始まる（ブルネイ／ブルンジ）
  ['ly', 'lr', 'bo', 'lb'],   // リビア／リベリア／ボリビア
  ['mc', 'ma', 'km', 'xk'],   // モナコ／モロッコ、コモロ／コソボ
  ['ml', 'mt', 'mw', 'my'],   // マ＋ラ行で始まる（マリ・マルタ・マラウイ・マレーシア）
  ['ki', 'kg', 'cu', 'cy'],   // キで始まる（キリバス／キルギス）
  ['ag', 'tt', 'ba', 'kn', 'vc', 'st'],   // 「・」でつないだ長い名前
  ['tv', 'vu', 'nr', 'nu', 'pw'],   // 太平洋の島国の短い名前（ツバル／バヌアツ）
  ['rw', 'ug', 'ca', 'gd'],   // 〜ダで終わる（ルワンダ／ウガンダ、カナダ／グレナダ）
  ['et', 'er', 'ec', 'sv'],   // エチオピア／エリトリア、エクアドル／エルサルバドル
  ['gh', 'gy', 'ga', 'gm'],   // ガで始まる（ガーナ／ガイアナ）
  ['ck', 'mh', 'sb', 'fm'],   // 〜諸島（太平洋）
];

// 首都モードで出さない国（はずれの選択肢にも使わない）: 首都が国名と同じ・国名＋シティ・国名の一部で答えが見える国、首都の考え方が国によって分かれる国（イスラエル）、法律で決めた首都がない国（ナウル）
const CAPITAL_SKIP = new Set(['sg', 'kw', 'dj', 'mc', 'lu', 'sm', 'va', 'mx', 'gt', 'pa', 'ad', 'st', 'gw', 'dz', 'il', 'nr']);
// 首都が似ていて、ふつうでは同じ問題に並べない組（激ムズの「〜タウン」「カリブの島」のグループには入れる）
const CAPITAL_TWINS = [['jm', 'vc'], ['ag', 'gd']];
// 似ている首都のグループ（首都モードの激ムズ用。国旗・国名のグループとはまぜない）。1グループ4か国以上。2026-09-28 に作った一覧
const SIMILAR_CAPITALS = [
  ['jm', 'vc', 'gy', 'bb', 'sl'],   // 〜トン・〜タウン（キングストン・キングスタウン・ジョージタウン…）
  ['ag', 'gd', 'kn', 'lc', 'dm'],   // カリブの島（セントジョンズ・セントジョージズ…）
  ['mu', 'pg', 'vu', 'tt', 'ht', 'bj'],   // ポート〜・ポルト〜
  ['cl', 'cr', 'do', 'sv', 'ba', 'ye'],   // サン〜・サント〜
  ['hu', 'ro', 'sk', 'be'],   // ブダペスト・ブカレスト・ブラチスラバ・ブリュッセル
  ['de', 'ch', 'bz', 'rs', 'lb'],   // ベルリン・ベルン・ベルモパン・ベオグラード・ベイルート
  ['bd', 'sn', 'sy', 'ie'],   // ダッカ・ダカール・ダマスカス・ダブリン
  ['ae', 'ng', 'jo', 'tr'],   // アブダビ・アブジャ・アンマン・アンカラ
  ['ni', 'bh', 'ph', 'mh', 'mz'],   // マナグア・マナーマ・マニラ・マジュロ・マプト
  ['uy', 'lr', 'km', 'ru', 'so', 'me'],   // モンテビデオ・モンロビア・モロニ・モスクワ・モガディシュ・ポドゴリツァ
  ['pe', 'lv', 'tg', 'fj', 'ec', 'mv'],   // 2文字の首都（リマ・リガ・ロメ・スバ・キト・マレ）
  ['mv', 'ml', 'my', 'mt'],   // マレ ≒ マリ・マレーシア・マルタ
  ['ao', 'zm', 'mw', 'rw'],   // ルアンダ ≒ ルワンダ
  ['lr', 'sl', 'ga', 'gn', 'ci', 'cm'],   // ギニア湾ぞい（モンロビア・フリータウン・リーブルビル…）
  ['br', 'cg', 'sk', 'bb'],   // ブラジリア・ブラザビル・ブラチスラバ・ブリッジタウン
  ['ly', 'ge', 'al', 'ir'],   // トリポリ・トビリシ・ティラナ・テヘラン
  ['kz', 'er', 'py', 'tm'],   // アスタナ・アスマラ・アスンシオン・アシガバット
  ['ne', 'td', 'mr', 'ng', 'bf'],   // ニアメ・ンジャメナ・ヌアクショット・アブジャ・ワガドゥグ
  ['cz', 'cv', 'xk', 'za', 'kh'],   // プラハ・プライア・プリシュティナ・プレトリア・プノンペン
  ['ws', 'nu', 'ck', 'to', 'tv'],   // 太平洋（アピア・アロフィ・アバルア・ヌクアロファ・フナフティ）
  ['th', 'bn', 'cf', 'gm', 'ml'],   // バン〜（バンコク・バンダルスリブガワン・バンギ・バンジュール・バマコ）
  ['cd', 'cg', 'cf', 'cm', 'ao'],   // 2つのコンゴ（キンシャサ・ブラザビル…）
  ['sk', 'si', 'lv', 'lt'],   // スロバキア／スロベニア・ラトビア／リトアニア
  ['at', 'au', 'al', 'am'],   // オーストリア／オーストラリア
  ['py', 'uy', 'ar', 'cl', 'pe'],   // 南アメリカ
  ['dm', 'do', 'cu', 'ht', 'bs', 'jm'],   // 2つのドミニカとカリブ
  ['kz', 'uz', 'kg', 'tj', 'tm', 'af', 'pk'],   // 〜スタン
  ['lv', 'ee', 'lt', 'fi', 'by'],   // バルト三国とまわり
  ['au', 'ca', 'nz', 'za'],   // 大都市が首都ではない国
  ['ir', 'iq', 'sy', 'sa'],   // イラン／イラクとまわり
  ['sd', 'ss', 'et', 'er', 'so'],   // スーダン／南スーダンとまわり
  ['vn', 'cu', 'zw', 'fi', 'sb'],   // ハノイ・ハバナ・ハラレ・ヘルシンキ・ホニアラ
  ['md', 'ua', 'rw', 'ec', 'cd'],   // キ〜（キシナウ・キーウ・キガリ・キト・キンシャサ）
  ['af', 'np', 've', 'lc', 'eg'],   // カブール・カトマンズ・カラカス・カストリーズ・カイロ
  ['ke', 'ug', 'tz', 'rw', 'bi'],   // 東アフリカ
];
const capName = (c) => (LANG === 'en' ? c.capital : (c.capital_ja || c.capital)) || '';
const capitalOk = (c) => !!c && !CAPITAL_SKIP.has(c.id) && !!c.capital && !!c.capital_ja;

const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function makeQuestions(hard, mode) {
  const cap = mode === 'capital';
  const all = Object.values(META.countries).filter(c => !cap || capitalOk(c));   // 首都モードは、出さない国をはずれにも使わない
  if (hard) {   // グループをまぜて10個選び、それぞれから答え1つと、同じグループのほかの3つ（首都モードは似ている首都のグループだけ）
    const groups = shuffle((cap ? SIMILAR_CAPITALS : [...SIMILAR_FLAGS, ...SIMILAR_NAMES]).map(g => g.filter(id => META.countries[id] && (!cap || capitalOk(META.countries[id])))).filter(g => g.length >= 4));
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
  const twin = (a, b) => cap && CAPITAL_TWINS.some(([x, y]) => (a === x && b === y) || (a === y && b === x));   // 首都モードのふつう: キングストンとキングスタウンのような組は並べない
  const picked = shuffle([...all]).slice(0, Q_TOTAL);
  return picked.map(c => {
    const same = all.filter(x => x.id !== c.id && x.region === c.region && !twin(x.id, c.id));
    const pool = same.length >= 3 ? same : all.filter(x => x.id !== c.id && !twin(x.id, c.id));
    const wrong = [];
    for (const x of shuffle([...pool])) { if (wrong.length >= 3) break; if (!wrong.some(w => twin(w.id, x.id))) wrong.push(x); }
    return { answer: c, options: shuffle([c, ...wrong]) };
  });
}

function showScreen(id) { document.querySelectorAll('.qscreen').forEach(s => s.classList.add('hidden')); $('#' + id).classList.remove('hidden'); }

function renderMenu() {
  showScreen('qmenu');
}

function startQuiz(mode, same = false, hard = false) {   // same: 直前と全く同じ問題（問題の順番・4つの選択肢と並びも同じ）でもう一度。hard: 激ムズ
  qMode = mode; qHard = hard; if (!same || !qList.length) qList = makeQuestions(hard, mode); qIdx = 0; qScore = 0; qWrong = [];
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
  } else if (qMode === 'capital') {   // 国（小さめの国旗＋国名）を見て首都を選ぶ。どの首都の国かは、答えたあとにボタンの中に出す（はじめから場所を取っておき、形が変わらないように）
    pr.innerHTML = `<div class="qp-label">${t('which_capital')}</div><img class="qp-flag qp-small" src="${flagUrl(q.answer.id, 640)}" alt=""><div class="qp-name qp-country">${escapeHtml(cname(q.answer))}</div>`;
    box.className = 'qoptions names capitals';
    for (const c of q.options) {
      const b = el('button', 'qopt name capital', `${escapeHtml(capName(c))}<span class="qopt-nm later">${escapeHtml(cname(c))}</span>`); b.dataset.id = c.id;
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
    const later = b.querySelector('.qopt-nm.later'); if (later) later.classList.remove('later');   // 首都モード: どの国の首都かを出す
  });
  const fb = $('#qFeedback');
  if (ok) { qScore++; fb.textContent = t('correct'); fb.className = 'qfeedback ok'; sfx.win(); }
  else { qWrong.push(q.answer); fb.textContent = t('wrong_answer', { name: qMode === 'capital' ? capName(q.answer) : cname(q.answer) }); fb.className = 'qfeedback ng'; sfx.error(); }
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
    const d = el('div', 'qw'); d.innerHTML = `<img src="${flagUrl(c.id, 160)}" alt=""><div>${escapeHtml(cname(c))}</div>${qMode === 'capital' ? `<div class="qw-cap">${escapeHtml(capName(c))}</div>` : ''}`;
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
  if (['flag', 'name', 'capital'].includes(q.get('mode'))) startQuiz(q.get('mode'), false, q.get('level') === 'hard'); else renderMenu();
  frameReady();
})();
