/* バトルのレート（強さの目安の数字）と全国ランキング（2026-10-03、ユーザーが選んだ案B）。サーバーは rating.py。
   - 端末の合言葉（localStorage の geoking_rk。はじめて使うときに作るランダムな文字）を、つないだ直後の hello で送る（app.js の connect）。
     サーバーの署名つきの控え（geoking_rc・geoking_rs）も持っておき、サーバーが忘れていたら、つないだときに戻してもらう
   - 称号は rating.py の title_index と同じ区切り（1000・1100・1200・1350・1500）
   - 見せる所（どれもレートの持ち主の「プレイヤー」のそば）: ロビーの名前の下（バトルの部屋だけ）、バトルの結果発表の名前の下と「あなたのレート」、
     ホームの「あなたのバトルのレート」（名前の欄の下。一度でもバトルした端末だけ）、全国ランキング（小窓）
   - 国旗クイズのレート（2026-10-12、ユーザーが選んだ案C「ランキングは2つ（国旗とバトル）」）: ひとりでクイズの国旗モード・国名モードを10問解き終えるたびに動く
     （「国旗クイズでも国名クイズでも、同じ一つのレートに」。首都モードは入れない）。
     ホームのランキングの枠の「バトル｜国旗クイズ」で切り替え、クイズの結果に、バトルと同じ演出でレートの動き。クイズのモードのカードには出さない
     （ユーザーの指定「トップだけでいい。バトルと国旗のところ」）。同じ合言葉・同じ控え・同じ「名前を出さない」を使う */
const RATE = (() => {
  const STEPS = [1000, 1100, 1200, 1350, 1500];
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
    del: (k) => { try { localStorage.removeItem(k); } catch {} },
  };
  const uid = () => { const a = new Uint8Array(8); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); };
  function key() {   // 端末の合言葉（なければ作る）
    let k = store.get('geoking_rk');
    if (!k || !/^[A-Za-z0-9_-]{16,64}$/.test(k)) {
      const a = new Uint8Array(16); crypto.getRandomValues(a);
      k = Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
      store.set('geoking_rk', k);
    }
    return k;
  }
  const creds = () => { const c = { rk: key() }, rc = store.get('geoking_rc'), rs = store.get('geoking_rs'); if (rc && rs) { c.rc = rc; c.rs = rs; } return c; };
  function saveCopy(cp) { if (cp && cp.c && cp.s) { store.set('geoking_rc', cp.c); store.set('geoking_rs', cp.s); } }
  const hasRating = () => !!store.get('geoking_rc');
  const tier = (r) => STEPS.filter((x) => r >= x).length;   // 0 見習い 〜 5 地理王
  const titleName = (r) => t('r_t' + tier(r));
  function next(r) {   // 次の称号まで（ゲージは今の称号の下の端から次の称号まで。見習いは 900 から）
    const i = tier(r);
    if (i >= STEPS.length) return null;
    const lo = i === 0 ? 900 : STEPS[i - 1], hi = STEPS[i];
    return { name: t('r_t' + (i + 1)), hi, left: hi - r, frac: Math.max(0, Math.min(1, (r - lo) / (hi - lo))) };
  }
  const fmt = (n) => Number(n).toLocaleString(LANG === 'en' ? 'en-US' : 'ja-JP');
  const chip = (r) => `<span class="rtitle t${tier(r)}">${escapeHtml(titleName(r))}</span>`;
  const delta = (d) => `<em class="rdelta ${d > 0 ? 'up' : d < 0 ? 'down' : 'even'}">${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)}</em>`;

  async function post(path, body) {
    const r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('status ' + r.status);
    return r.json();
  }

  // ランキングの1行（ホームの枠と小窓で同じ見た目）
  const rowHtml = (x) => `<li class="rk-row${x.me ? ' me' : ''}${x.rank <= 3 ? ' top' + x.rank : ''}"><b class="rk-no">${x.rank}</b>`
    + `<span class="rk-name">${x.me ? `<span class="tag you">${t('r_you')}</span> ` : ''}${x.name ? escapeHtml(x.name) : (x.me ? '' : `<span class="muted">${t('r_anon')}</span>`)}</span>`
    + `${chip(x.rate)}<span class="rk-rate">${fmt(x.rate)}</span></li>`;

  // ---------- ホーム: 名前の欄の下の「あなたのバトルのレート」（一度でもバトルした端末だけ。押すとバトルランキング）と、
  // 公開中の部屋の上のランキングの枠（3位まで。だれでも見える。「すべて見る」で小窓）。開いたとき・部屋から戻ったとき・1分ごとに読み直す。
  // 枠の「バトル｜国旗クイズ」で、出すランキングを切り替える（2026-10-12 ユーザーが選んだ案C。選んだ方は端末に覚えておく）
  const home = { battle: null, flag: null };   // 読んだランキング（null: まだ・false: 読めなかった）
  let homeKind = store.get('geoking_rank_kind') === 'flag' ? 'flag' : 'battle', homeShown = false;
  const titleOf = (kind) => t(kind === 'flag' ? 'rq_title' : 'r_title');
  async function load(kind) {
    const d = await post('/api/ranking', { ...(hasRating() ? creds() : {}), kind });
    saveCopy(d.copy);
    return d;
  }
  async function refreshHome() {
    if (!$('#rankCard')) return;
    if (quizPending()) await quizSync().catch(() => null);   // クイズを通信のないときに解いた回が残っていれば、先に送る
    await Promise.all([...new Set(['battle', homeKind])].map(async (k) => {   // 「あなたのバトルのレート」には、いつもバトルの記録がいる
      try { home[k] = await load(k); } catch { if (!home[k]) home[k] = false; }   // 読めなかったときは前のまま
    }));
    drawHome();
  }
  async function setKind(kind) {   // 枠の「バトル｜国旗クイズ」
    if (kind === homeKind || !(kind in home)) return;
    homeKind = kind; store.set('geoking_rank_kind', kind);
    if (!home[kind]) home[kind] = null;
    drawHome();   // 前に読んだ分があればすぐ出す（なければ「読み込み中…」）
    try { home[kind] = await load(kind); } catch { if (!home[kind]) home[kind] = false; }
    if (kind === homeKind) drawHome();
  }
  document.querySelectorAll('#rankCard .rk-tab').forEach((b) => { b.onclick = () => setKind(b.dataset.kind); });
  function drawHome() {
    const card = $('#rateCard'), rank = $('#rankCard');
    if (!card || !rank) return;
    const b = home.battle, me = b && b.me && b.me.n && hasRating() ? b.me : null;
    if (!me) card.classList.add('hidden');
    else {
      const sub = me.rank ? t('r_rank', { rank: fmt(me.rank), total: fmt(me.total) }) : t('r_need', { n: me.need });
      card.innerHTML = `<span class="rc-label">${t('r_my')}</span><span class="rc-main"><b class="rc-num">${fmt(me.rate)}</b>${chip(me.rate)}</span>`
        + `<span class="rc-sub">${escapeHtml(sub)}</span>`;   // 押すとランキングが開くので「ランキングを見る」は書かない（2026-10-03 ユーザーの指定）
      card.classList.remove('hidden');
    }
    const d = home[homeKind];
    if (!d && !homeShown) { rank.classList.add('hidden'); return; }   // 読めなかったときは出さない（公開中の部屋の邪魔をしない）。切り替えたあとは枠を残す
    homeShown = true;
    $('#rankTitle').textContent = titleOf(homeKind);
    rank.querySelectorAll('.rk-tab').forEach((x) => { const on = x.dataset.kind === homeKind; x.classList.toggle('on', on); x.setAttribute('aria-selected', on ? 'true' : 'false'); });
    const top = d ? d.top.filter((x) => x.rank <= 3).slice(0, 10) : [];   // 3位まで（同じ順位の人はみんな。多すぎるときは10人まで）。4位からは「すべて見る」の小窓で（2026-10-03 ユーザーの指定）
    $('#homeRankList').innerHTML = !d ? `<li class="rk-empty muted">${t(d === false ? 'r_fail' : 'loading')}</li>`
      : top.length ? top.map(rowHtml).join('') : `<li class="rk-empty muted">${t('r_empty')}<small>${escapeHtml(t(homeKind === 'flag' ? 'rq_rule' : 'r_rule', { n: d.need_games }))}</small></li>`;
    $('#rankCard .rk-more').classList.toggle('hidden', !top.length);
    rank.classList.remove('hidden');
  }
  setInterval(() => { if ((typeof state === 'undefined' || !state) && $('#home') && !$('#home').classList.contains('hidden') && document.visibilityState === 'visible') refreshHome(); }, 60000);   // クイズの画面（state がない）では動かない

  // ---------- 全国ランキング（小窓。kind: 'battle' バトル・'flag' 国旗クイズ）
  async function showRanking(kind = 'battle') {
    const head = `<h2 class="rk-h">${ico('trophy')} ${titleOf(kind)}</h2>`;
    $('#modalBody').classList.remove('wide');
    $('#modalBody').innerHTML = head + `<p class="muted">${t('loading')}</p>`;
    $('#modal').classList.remove('hidden');
    $('#modal .modalbox').scrollTop = 0;
    let d;
    try { d = await load(kind); } catch { $('#modalBody').innerHTML = head + `<p class="muted">${t('r_fail')}</p>`; return; }
    drawRanking(d, kind);
  }
  function drawRanking(d, kind) {
    const me = d.me && d.me.n ? d.me : null;
    let html = `<h2 class="rk-h">${ico('trophy')} ${titleOf(kind)}</h2>`;
    if (me) {
      html += `<div class="rk-me"><div class="rk-me-top"><span class="muted small">${t('r_my_short')}</span> <b class="rk-me-num">${fmt(me.rate)}</b> ${chip(me.rate)}</div>`
        + `<div class="rk-me-sub">${escapeHtml(me.rank ? t('r_rank', { rank: fmt(me.rank), total: fmt(me.total) }) : t(kind === 'flag' ? 'rq_need' : 'r_need', { n: me.need }))}</div>`
        + `<label class="chk rk-hide"><input type="checkbox" id="rkHide"${me.hide ? ' checked' : ''}> ${t('r_hide')}</label></div>`;
    }
    html += '<ol class="rk-list">' + (d.top.length ? d.top.map(rowHtml).join('') : `<li class="rk-empty muted">${t('r_empty')}</li>`);
    if (me && me.rank && !d.top.some((x) => x.me)) html += `<li class="rk-gap" aria-hidden="true">…</li>` + rowHtml({ rank: me.rank, name: null, rate: me.rate, me: true });
    html += '</ol>';   // 順位の下の説明文は出さない（2026-10-03 ユーザーの指定「順位の下の説明文は不要です」）
    $('#modalBody').innerHTML = html;
    const hide = $('#rkHide');
    if (hide) hide.onchange = async () => {
      try { const r = await post('/api/rating/hide', { ...creds(), hide: hide.checked }); saveCopy(r.copy); d.me = r.me; } catch { hide.checked = !hide.checked; return; }
      try { const n = await load(kind); drawRanking(n, kind); home[kind] = n; drawHome(); } catch {}   // 名前を出さない設定はバトルと国旗クイズで共通
    };
  }

  // ---------- ロビー: 名前の下に称号とレート（バトルの部屋だけ。一度もバトルしていない人・ボットは出さない）
  function lobbyLine(p) {
    return SV.on() && p.rate != null && !p.is_bot ? `<small class="rate-line">${chip(p.rate)}<span class="rl-num">${fmt(p.rate)}</span></small>` : '';
  }
  // ---------- 結果発表（バトル）: 名前の下にレートの前と後と、上がった・下がった数
  function finalLine(e) {
    if (e.rate_before == null || e.rate_after == null) return '';
    return `<small class="sv-rate">${fmt(e.rate_before)} → <b>${fmt(e.rate_after)}</b> ${delta(e.rate_after - e.rate_before)}</small>`;
  }
  // ---------- 結果発表（バトル）の「あなたのレート」: 前 → 後、上がった数、称号（昇格）、次の称号までのゲージ、全国の順位の動き。
  // はじめて見る結果だけ、案B「レベルアップ」の演出（2026-10-03 ユーザーが選んだ案）: 数字がピピピと上がり、ゲージの先が光って火花。
  // 称号が上がるときは、ゲージがあふれて光の柱と後光が立ち、「昇格！」が落ちてきて（画面が揺れる）、紙吹雪が降り、新しい称号が出てくる。
  // 下がったときは控えめ（数字が下がり、少し揺れて、ふちが赤く光る）。全国の順位が上がったら、はしごを上がる。
  // 演出の部品は画面に固定した層（.rfx。画面の外にはみ出さない）に出し、終わったら消す。チャットなどで描き直しても作り直さない
  const FX_KEY = 'geoking_ratefx';
  const reduce = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  const needText = (m) => t(m.kind === 'flag' ? 'rq_need' : 'r_need', { n: m.need });
  const rankText = (m, rank) => (m.offline ? t('r_offline') : rank ? (m.rank_before && rank !== m.rank_before ? t('r_rank_move', { from: fmt(m.rank_before), to: fmt(rank) }) : (m.rank_before ? t('r_rank', { rank: fmt(rank), total: fmt(m.total) }) : t('r_rank_new', { to: fmt(rank) }))) : needText(m));
  function panelHtml(m, at, done) {   // at: 大きい数字に出す値。done: 終わった形（増減・昇格・全国の順位）まで出す
    const d = m.after - m.before, nx = next(at), promo = done && tier(m.after) > tier(m.before);
    const label = m.kind === 'flag' ? t('rq_label', { level: t(m.level === 'hard' ? 'level_hard' : 'level_normal') }) : m.first ? t('r_first') : t('r_my_short');   // 国旗クイズは、どのむずかしさで動いたか
    return `<div class="rp-label">${escapeHtml(label)}</div>`
      + `<div class="rp-nums"><span class="rp-from">${fmt(m.before)}</span><span class="rp-arrow">→</span><b class="rp-to">${fmt(at)}</b>${done ? delta(d) : `<span class="rp-dslot">${delta(d)}</span>`}</div>`
      + `<div class="rp-title">${chip(at)}${promo ? `<span class="rp-promo">${escapeHtml(t('r_promo', { title: titleName(m.after) }))}</span>` : ''}</div>`
      + `<div class="rp-gauge"><i style="width:${Math.round((nx ? nx.frac : 1) * 100)}%"></i><b class="rp-head" style="left:${Math.round((nx ? nx.frac : 1) * 100)}%"></b></div>`
      + `<div class="rp-next muted small">${nx ? escapeHtml(t('r_next', { title: nx.name, n: fmt(nx.left) })) : t('r_top')}</div>`
      + (done || m.rank_before || !m.rank_after
        ? `<div class="rp-rank">${escapeHtml(done || m.offline ? rankText(m, m.rank_after) : (m.rank_before ? t('r_rank', { rank: fmt(m.rank_before), total: fmt(m.total) }) : needText(m)))}</div>`
        : `<div class="rp-rank pending">${escapeHtml(rankText(m, m.rank_after))}</div>`)   // はじめて載るとき: 場所だけ空けておき、数え終わってから「全国 N 位に登場」がポンと出る
      + (m.offline ? '' : `<button type="button" class="mini rp-see">${ico('trophy', 'sm')} ${t('r_see')}</button>`);   // オフラインではランキングを読めないので出さない
  }
  function renderPanel(box) {   // 結果発表（バトル）で、自分のレートが動いたときだけ出す
    const m = state && state.rate_me;
    if (!box) return;
    if (!m || !SV.on()) { box.classList.add('hidden'); box.innerHTML = ''; delete box.dataset.key; return; }
    const key = `${state.room}:${(state.final || []).map((e) => `${e.pid}:${e.rate_after ?? ''}`).join(',')}|${m.before}>${m.after}|${LANG}`;
    showPanel(box, m, key, () => state && state.phase === 'end');
  }
  function showPanel(box, m, key, alive) {   // alive(): 結果の画面を見ている間 true（部屋を出た・次のゲームや問題に進んだら、演出を止める）
    if (box.dataset.key === key && box.innerHTML) return;   // 描き直し（チャットなど）では作り直さない（演出の途中で消さない）
    let seen = false;
    try { seen = sessionStorage.getItem(FX_KEY) === key.replace(/\|[a-z]+$/, ''); sessionStorage.setItem(FX_KEY, key.replace(/\|[a-z]+$/, '')); } catch {}
    const play = !seen && !reduce();
    box.dataset.key = key;
    box.classList.remove('hidden');
    box.innerHTML = panelHtml(m, play ? m.before : m.after, !play);
    const see = box.querySelector('.rp-see'); if (see) see.onclick = () => showRanking(m.kind || 'battle');
    if (play) levelUp(box, m, key, alive);
    else if (!seen) (m.after >= m.before ? (tier(m.after) > tier(m.before) ? sfx.fanfare() : sfx.rateCoin()) : sfx.rateDown());   // 動きを減らす設定の人も、音だけは
  }

  // 演出の層と部品（画面に固定。はみ出さない）
  function layer() { let L = document.querySelector('.rfx'); if (!L) { L = el('div', 'rfx'); document.body.appendChild(L); } return L; }
  const at = (node) => { const r = node.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, t: r.top, w: r.width, h: r.height }; };
  function part(cls, x, y, frames, opts, style) {
    const e = el('i', cls); e.style.left = x + 'px'; e.style.top = y + 'px'; if (style) Object.assign(e.style, style);
    layer().appendChild(e);
    const a = e.animate(frames, opts); a.onfinish = () => e.remove();
    setTimeout(() => e.remove(), (opts.duration || 1000) + (opts.delay || 0) + 300);   // 画面が裏に回って動きが止まっても消す
    return e;
  }
  function tween(ms, fn, ok) {   // ok() が false になったら止める
    return new Promise((res) => {
      let over = false;
      const end = (v) => { if (!over) { over = true; res(v); } };
      const t0 = performance.now();
      const step = (now) => { if (over) return; if (!ok()) return end(false); const k = Math.min(1, (now - t0) / ms); fn(1 - Math.pow(1 - k, 2)); if (k < 1) requestAnimationFrame(step); else end(true); };
      requestAnimationFrame(step);
      setTimeout(() => { if (!over && ok()) fn(1); end(ok()); }, ms + 1500);   // 裏に回って requestAnimationFrame が止まったとき
    });
  }
  function pulse(node, cls) {   // CSS の動き（class）をもう一度はじめから
    node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls);
    const off = (e) => { if (e.target === node) { node.classList.remove(cls); node.removeEventListener('animationend', off); } };
    node.addEventListener('animationend', off);
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  function sparkles(x, y, n, r) { for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, d = r * (.3 + Math.random()); part('rfx-spark', x, y, [{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${Math.cos(a) * d}px,${Math.sin(a) * d - 20}px) scale(.2)`, opacity: 0 }], { duration: 600 + Math.random() * 400, easing: 'ease-out', delay: Math.random() * 150 }); } }
  function rain(n) {
    const w = innerWidth, h = innerHeight, cols = ['#f4c542', '#e8674a', '#1f6f4a', '#fff', '#ffd25e', '#8a73e0'];
    for (let i = 0; i < n; i++) part('rfx-conf', Math.random() * w, -20, [{ transform: 'translate(0,0) rotate(0)' }, { transform: `translate(${Math.random() * 80 - 40}px,${h + 60}px) rotate(${Math.random() * 900 - 450}deg)` }],
      { duration: 1800 + Math.random() * 1400, delay: Math.random() * 900, easing: 'cubic-bezier(.3,.1,.6,1)' }, { background: cols[i % cols.length] });
  }

  async function levelUp(box, m, key, alive) {
    const ok = () => box.isConnected && box.dataset.key === key && num.isConnected && alive();   // 描き直した・部屋を出た・次のゲームに進んだら止める
    const up = m.after >= m.before, promo = tier(m.after) > tier(m.before), T = promo ? STEPS[tier(m.before)] : m.after;
    const num = box.querySelector('.rp-to'), fill = box.querySelector('.rp-gauge i'), head = box.querySelector('.rp-head'), nextEl = box.querySelector('.rp-next');
    let shown = tier(m.before);   // いま札に出ている称号
    const setAt = (v, cap) => {   // 大きい数字とゲージ（cap: 称号の境目の手前で止める）。ゲージはなめらかに、文字は整数で
      const r = Math.round(v), nx = next(cap != null ? Math.min(v, cap - .001) : v);
      const w = (nx ? nx.frac : 1) * 100;
      num.textContent = fmt(r);
      fill.style.width = w + '%'; head.style.left = w + '%';
      nextEl.textContent = nx ? t('r_next', { title: nx.name, n: fmt(Math.max(0, nx.hi - r)) }) : t('r_top');   // 「1,100」のとき「あと 0」（数字と合わせる）
      if (!up && tier(r) < shown) {   // 下がって称号の境目を割ったら、札を下の称号に（「昇格」の文は出さない）
        shown = tier(r);
        const tt = box.querySelector('.rp-title'); tt.innerHTML = chip(r);
        tt.firstChild.animate([{ transform: 'scale(1.3)', opacity: .3 }, { transform: 'none', opacity: 1 }], { duration: 400, easing: 'ease-out' });
      }
    };
    await wait(900); if (!ok()) return;
    if (up) pulse(box, 'rp-glow');
    else { pulse(box, 'rp-shake'); sfx.rateDown(); part('rfx-red', 0, 0, [{ opacity: 0 }, { opacity: 1, offset: .3 }, { opacity: 0 }], { duration: 700 }); }
    // 数字がピピピと動く（ゲージの先が光って火花）
    let last = Math.round(m.before), pips = 0, lastSpark = 0;
    head.classList.toggle('on', up);
    const run = (from, to, ms, cap) => tween(ms, (k) => {
      const v = from + (to - from) * k, r = Math.round(v);
      if (r !== last) { last = r; pips++; up ? sfx.ratePip(pips) : sfx.rateDownPip(pips); }
      setAt(v, cap);
      const now = performance.now();
      if (up && now - lastSpark > 60) { lastSpark = now; const hp = at(head); part('rfx-spark', hp.x, hp.y, [{ transform: 'translate(0,0)', opacity: 1 }, { transform: `translate(${-10 - Math.random() * 20}px,${-20 - Math.random() * 30}px) scale(.2)`, opacity: 0 }], { duration: 500, easing: 'ease-out' }); }
    }, ok);
    if (!await run(m.before, promo ? T : m.after, promo ? 900 : 1100, promo ? T : null)) return;
    if (promo) {   // ゲージがあふれる → 光の柱・後光・「昇格！」がドン → 新しい称号
      head.classList.remove('on');
      sfx.rateBurst();
      const g = at(box.querySelector('.rp-gauge')), p = at(box);
      part('rfx-flash', 0, 0, [{ opacity: 0 }, { opacity: 1, offset: .15 }, { opacity: 0 }], { duration: 800 });
      for (let i = 0; i < 16; i++) part('rfx-conf', g.l + g.w * (i / 16), g.y, [{ transform: 'translate(0,0) rotate(0)', opacity: 1 }, { transform: `translate(${Math.random() * 60 - 30}px,${-40 - Math.random() * 80}px) rotate(${Math.random() * 400}deg)`, opacity: 0 }], { duration: 700, easing: 'ease-out' }, { background: i % 2 ? '#f4c542' : '#fff6c8', width: '10px', height: '6px' });
      part('rfx-pillar', p.x, 0, [{ transform: 'translateX(-50%) scaleY(0)', opacity: 0 }, { transform: 'translateX(-50%) scaleY(1)', opacity: 1, offset: .25 }, { transform: 'translateX(-50%) scaleY(1)', opacity: .9, offset: .7 }, { transform: 'translateX(-50%) scaleY(1.05)', opacity: 0 }], { duration: 2200, easing: 'ease-out' });
      part('rfx-rays', p.x, p.y, [{ transform: 'translate(-50%,-50%) scale(.2) rotate(0)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1) rotate(30deg)', opacity: 1, offset: .2 }, { transform: 'translate(-50%,-50%) scale(1.05) rotate(140deg)', opacity: .8, offset: .8 }, { transform: 'translate(-50%,-50%) scale(1.1) rotate(180deg)', opacity: 0 }], { duration: 2600 });
      await wait(220); if (!ok()) return;
      sfx.rateSlam(); sfx.fanfare();
      const st = part('rfx-stamp', p.x, p.y - 10, [{ transform: 'translate(-50%,-50%) scale(3.2) rotate(-14deg)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(.92) rotate(-8deg)', opacity: 1, offset: .35 }, { transform: 'translate(-50%,-50%) scale(1) rotate(-8deg)', opacity: 1, offset: .8 }, { transform: 'translate(-50%,-50%) scale(1.06) rotate(-8deg)', opacity: 0 }], { duration: 1900, easing: 'cubic-bezier(.2,1.3,.4,1)' });
      st.textContent = t('r_stamp');
      const room = Math.min(innerWidth - 64, 380);   // 英語（Promoted!）でも、傾けて影をつけても画面に収める
      if (st.offsetWidth > room) st.style.fontSize = Math.floor(64 * room / st.offsetWidth) + 'px';
      const card = box.closest('.card') || box;
      setTimeout(() => { if (!ok()) return; card.animate([{ transform: 'none' }, { transform: 'translate(-5px,4px)' }, { transform: 'translate(4px,-3px)' }, { transform: 'none' }], { duration: 300 }); part('rfx-ring', p.x, p.y - 10, [{ transform: 'translate(-50%,-50%) scale(.5)', opacity: 1 }, { transform: 'translate(-50%,-50%) scale(14)', opacity: 0 }], { duration: 800, easing: 'ease-out' }); }, 600);
      rain(tier(m.after) === STEPS.length ? 120 : 70);
      await wait(700); if (!ok()) return;
      box.querySelector('.rp-title').innerHTML = chip(m.after) + `<span class="rp-promo">${escapeHtml(t('r_promo', { title: titleName(m.after) }))}</span>`;
      const tc = box.querySelector('.rp-title .rtitle'), tp = at(tc);
      tc.animate([{ transform: 'translateY(30px) scale(.4)', opacity: 0 }, { transform: 'translateY(-6px) scale(1.5)', opacity: 1, offset: .6 }, { transform: 'none' }], { duration: 650, easing: 'cubic-bezier(.2,1.5,.4,1)' });
      sparkles(tp.x, tp.y, 18, 70); sfx.shine();
      head.classList.add('on');
      if (!await run(T, m.after, 500, null)) return;
    }
    head.classList.remove('on');
    setAt(m.after, null);
    // 増減（光る）
    const slot = box.querySelector('.rp-dslot');
    if (slot) { slot.classList.add('on'); slot.animate([{ transform: 'scale(0) rotate(-20deg)' }, { transform: 'scale(1.5) rotate(6deg)', offset: .6 }, { transform: 'none' }], { duration: 480, easing: 'cubic-bezier(.2,1.6,.4,1)' }); }
    if (up) { sfx.rateCoin(); const dp = at(slot || num); sparkles(dp.x, dp.y, 10, 50); }
    // 全国の順位: はしごを上がる（初めて載ったときは「登場」）
    const rk = box.querySelector('.rp-rank');
    if (m.rank_after && m.rank_before && m.rank_after < m.rank_before) {   // 抜いた人の段（2段まで）の上へ、自分の段が上がる
      await wait(350); if (!ok()) return;
      const n = Math.min(2, m.rank_before - m.rank_after), no = (r) => t('r_lad', { rank: fmt(r) });
      let html = '';
      for (let i = 0; i < n; i++) html += `<div><span>${no(m.rank_after + i)}</span></div>`;
      rk.insertAdjacentHTML('afterend', `<div class="rp-ladder">${html}<div class="me"><span>${t('r_ladder_me')} ${no(m.rank_before)}</span><span>${fmt(m.before)}</span></div></div>`);
      const rows = [...box.querySelector('.rp-ladder').children], meRow = rows[n], h = rows[0].getBoundingClientRect().height + 4;
      sfx.rateRise();
      meRow.animate([{ transform: 'none' }, { transform: `translateY(${-n * h}px)` }], { duration: 700, easing: 'cubic-bezier(.3,1.4,.5,1)', fill: 'forwards' });
      for (let i = 0; i < n; i++) rows[i].animate([{ transform: 'none' }, { transform: `translateY(${h}px)` }], { duration: 700, easing: 'ease-out', fill: 'forwards' });
      await wait(720); if (!ok()) return;
      meRow.firstChild.textContent = `${t('r_ladder_me')} ${no(m.rank_after)}`; meRow.lastChild.textContent = fmt(m.after);
      for (let i = 0; i < n; i++) rows[i].firstChild.textContent = no(m.rank_after + i + 1);   // 抜かれた人は1つ下の順位に
      const lp = at(meRow); sparkles(lp.x, lp.y, 14, 60); sfx.rateCoin();
      rk.textContent = rankText(m, m.rank_after);
    } else if (m.rank_after && !m.rank_before) {
      await wait(300); if (!ok()) return;
      rk.textContent = rankText(m, m.rank_after); rk.classList.remove('pending');
      rk.animate([{ transform: 'scale(.6)', opacity: 0 }, { transform: 'scale(1.15)', opacity: 1, offset: .6 }, { transform: 'none' }], { duration: 520, easing: 'cubic-bezier(.2,1.5,.4,1)' });
      sfx.rateRise(); const rp = at(rk); sparkles(rp.x, rp.y, 14, 60);
    } else rk.textContent = rankText(m, m.rank_after);
  }

  // ---------- 国旗クイズのレート（2026-10-12、ユーザーが選んだ案C「ランキングは2つ（国旗とバトル）」）。サーバーは rating.py の apply_quiz。
  // ひとりでクイズの国旗モード・国名モード（同じ一つのレート）を10問解き終えるたびに、結果を送る（「同じ問題でもう一度」は送らない。quiz.js）。送れないとき（通信がない）は端末にため、
  // apply_quiz と同じ式で仮のレートを出し、次につながったとき（クイズやホームを開いた・通信が戻った）に送る
  const QUIZ_D = { normal: 1000, hard: 1200 }, QUIZ_K = { normal: 16, hard: 32 };   // rating.py の QUIZ_D・QUIZ_K と同じ
  const QQ = 'geoking_quiz_games', QP = 'geoking_quiz_rate';   // 送るもの（まだ送っていない回）と、その分を入れた仮のレート
  const jget = (k) => { try { return JSON.parse(store.get(k) || 'null'); } catch { return null; } };
  const jset = (k, v) => (v == null ? store.del(k) : store.set(k, JSON.stringify(v)));
  const quizPending = () => (jget(QQ) || []).length > 0;
  let qBusy = Promise.resolve();
  function quizSync() {   // ためた回を送る（1回に50回まで。同時に2つは送らない）。返り値: サーバーの返事（送るものがなければ null）
    const run = qBusy.then(async () => {
      const q = jget(QQ) || [];
      if (!q.length) return null;
      const d = await post('/api/rating/quiz', { ...creds(), name: store.get('geoking_name') || '', games: q.slice(0, 50) });
      saveCopy(d.copy);
      const done = new Set(d.done || []), rest = (jget(QQ) || []).filter((g) => !done.has(g.id));
      jset(QQ, rest.length ? rest : null);
      if (!rest.length) jset(QP, null);
      return d;
    });
    qBusy = run.catch(() => null);
    return run;
  }
  function quizBase() {   // 仮のレートの元: まだ送っていない回を入れた仮のレート、なければ端末の控え（サーバーの記録の写し）
    const p = jget(QP); if (p) return p;
    const c = jget('geoking_rc');
    return c && +c.qn > 0 ? { r: +c.qr, n: +c.qn } : { r: 1000, n: 0 };
  }
  async function quizResult(mode, level, correct, total) {   // 国旗モード・国名モードを10問解き終えた: 結果の画面に出す動き（バトルの rate_me と同じ形）。出さないときは null
    if (!(level in QUIZ_D)) return null;
    const b = quizBase(), g = { id: 'q' + uid(), t: Math.round(Date.now() / 1000), mode, level, correct, total };
    jset(QQ, (jget(QQ) || []).concat([g]).slice(-500));
    try {
      const d = await quizSync();
      if (d && d.res && d.res.id === g.id) return { ...d.res, kind: 'flag', level };
      if (d && (d.done || []).includes(g.id)) return null;   // 受け取ったが数えなかった
    } catch {}
    const after = b.r + QUIZ_K[level] * (correct / total - 1 / (1 + 10 ** ((QUIZ_D[level] - b.r) / 400)));   // 送れなかった: 仮のレート
    jset(QP, { r: after, n: b.n + 1 });
    return { id: g.id, before: Math.round(b.r), after: Math.round(after), rank_before: null, rank_after: null, total: null, need: 0, first: !b.n, offline: true, kind: 'flag', level };
  }
  function quizPanel(box, m, alive) {   // クイズの結果: 点数の下に、国旗クイズのレートの動き（バトルの結果発表と同じ演出）。m がなければ消す
    if (!box) return;
    if (!m) { box.classList.add('hidden'); box.innerHTML = ''; delete box.dataset.key; return; }
    showPanel(box, m, `quiz:${m.id}|${m.before}>${m.after}|${LANG}`, alive);
  }
  window.addEventListener('online', () => { if (quizPending()) quizSync().then(() => { if ($('#rankCard')) refreshHome(); }).catch(() => {}); });   // 通信が戻ったら、ためた回を送る

  return { creds, saveCopy, hasRating, refreshHome, drawHome, showRanking, kind: () => homeKind, lobbyLine, finalLine, renderPanel, chip, fmt, tier, next, titleName,
    quizResult, quizPanel, quizSync };
})();
