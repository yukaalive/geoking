/* バトルのレート（強さの目安の数字）と全国ランキング（2026-10-03、ユーザーが選んだ案B）。サーバーは rating.py。
   - 端末の合言葉（localStorage の geoking_rk。はじめて使うときに作るランダムな文字）を、つないだ直後の hello で送る（app.js の connect）。
     サーバーの署名つきの控え（geoking_rc・geoking_rs）も持っておき、サーバーが忘れていたら、つないだときに戻してもらう
   - 称号は rating.py の title_index と同じ区切り（1000・1100・1200・1350・1500）
   - 見せる所（どれもレートの持ち主の「プレイヤー」のそば）: ロビーの名前の下（バトルの部屋だけ）、バトルの結果発表の名前の下と「あなたのレート」、
     ホームの「あなたのバトルのレート」（名前の欄の下。一度でもバトルした端末だけ）、全国ランキング（小窓） */
const RATE = (() => {
  const STEPS = [1000, 1100, 1200, 1350, 1500];
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  };
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
    return { name: t('r_t' + (i + 1)), left: hi - r, frac: Math.max(0, Math.min(1, (r - lo) / (hi - lo))) };
  }
  const fmt = (n) => Number(n).toLocaleString(LANG === 'en' ? 'en-US' : 'ja-JP');
  const chip = (r) => `<span class="rtitle t${tier(r)}">${escapeHtml(titleName(r))}</span>`;
  const delta = (d) => `<em class="rdelta ${d > 0 ? 'up' : d < 0 ? 'down' : 'even'}">${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)}</em>`;

  async function post(path, body) {
    const r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('status ' + r.status);
    return r.json();
  }

  // ---------- ホーム: 名前の欄の下の「あなたのバトルのレート」（押すと全国ランキング）。一度もバトルしていない端末には出さない
  let homeMe = null;
  async function refreshHome() {
    const card = $('#rateCard'); if (!card) return;
    if (!hasRating()) { card.classList.add('hidden'); return; }
    try {
      const d = await post('/api/rating', creds());
      saveCopy(d.copy); homeMe = d.me;
    } catch { homeMe = null; }
    drawHome();
  }
  function drawHome() {
    const card = $('#rateCard'); if (!card) return;
    const me = homeMe;
    if (!me || !me.n) { card.classList.add('hidden'); return; }
    const sub = me.rank ? t('r_rank', { rank: fmt(me.rank), total: fmt(me.total) }) : t('r_need', { n: me.need });
    card.innerHTML = `<span class="rc-label">${t('r_my')}</span><span class="rc-main"><b class="rc-num">${fmt(me.rate)}</b>${chip(me.rate)}</span>`
      + `<span class="rc-sub">${escapeHtml(sub)}</span><span class="rc-go">${ico('trophy', 'sm')} ${t('r_see')}</span>`;
    card.classList.remove('hidden');
  }

  // ---------- 全国ランキング（小窓）
  async function showRanking() {
    $('#modalBody').classList.remove('wide');
    $('#modalBody').innerHTML = `<h2 class="rk-h">${ico('trophy')} ${t('r_title')}</h2><p class="muted">${t('loading')}</p>`;
    $('#modal').classList.remove('hidden');
    $('#modal .modalbox').scrollTop = 0;
    let d;
    try { d = await post('/api/ranking', hasRating() ? creds() : {}); } catch { $('#modalBody').innerHTML = `<h2 class="rk-h">${ico('trophy')} ${t('r_title')}</h2><p class="muted">${t('r_fail')}</p>`; return; }
    drawRanking(d);
  }
  function drawRanking(d) {
    const me = d.me && d.me.n ? d.me : null;
    let html = `<h2 class="rk-h">${ico('trophy')} ${t('r_title')}</h2>`;
    if (me) {
      html += `<div class="rk-me"><div class="rk-me-top"><span class="muted small">${t('r_my_short')}</span> <b class="rk-me-num">${fmt(me.rate)}</b> ${chip(me.rate)}</div>`
        + `<div class="rk-me-sub">${escapeHtml(me.rank ? t('r_rank', { rank: fmt(me.rank), total: fmt(me.total) }) : t('r_need', { n: me.need }))}</div>`
        + `<label class="chk rk-hide"><input type="checkbox" id="rkHide"${me.hide ? ' checked' : ''}> ${t('r_hide')}</label></div>`;
    }
    const row = (x) => `<li class="rk-row${x.me ? ' me' : ''}${x.rank <= 3 ? ' top' + x.rank : ''}"><b class="rk-no">${x.rank}</b>`
      + `<span class="rk-name">${x.me ? `<span class="tag you">${t('r_you')}</span> ` : ''}${x.name ? escapeHtml(x.name) : `<span class="muted">${t('r_anon')}</span>`}</span>`
      + `${chip(x.rate)}<span class="rk-rate">${fmt(x.rate)}</span></li>`;
    html += '<ol class="rk-list">' + (d.top.length ? d.top.map(row).join('') : `<li class="rk-empty muted">${t('r_empty')}</li>`);
    if (me && me.rank && !d.top.some((x) => x.me)) html += `<li class="rk-gap" aria-hidden="true">…</li>` + row({ rank: me.rank, name: null, rate: me.rate, me: true }).replace(`<span class="muted">${t('r_anon')}</span>`, '');
    html += '</ol>' + `<p class="muted small rk-rule">${t('r_rule', { n: d.need_games })}</p>`;
    $('#modalBody').innerHTML = html;
    const hide = $('#rkHide');
    if (hide) hide.onchange = async () => {
      try { const r = await post('/api/rating/hide', { ...creds(), hide: hide.checked }); saveCopy(r.copy); d.me = r.me; } catch { hide.checked = !hide.checked; return; }
      try { drawRanking(await post('/api/ranking', creds())); } catch {}
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
  // 結果発表（バトル）の「あなたのレート」: 前 → 後、上がった数、称号（昇格）、次の称号までのゲージ、全国の順位の動き
  function panel(m) {
    const d = m.after - m.before, nx = next(m.after), promo = tier(m.after) > tier(m.before);
    const rank = m.rank_after ? (m.rank_before ? t('r_rank_move', { from: fmt(m.rank_before), to: fmt(m.rank_after) }) : t('r_rank_new', { to: fmt(m.rank_after) })) : t('r_need', { n: m.need });
    return `<div class="rp-label">${m.first ? t('r_first') : t('r_my_short')}</div>`
      + `<div class="rp-nums"><span class="rp-from">${fmt(m.before)}</span><span class="rp-arrow">→</span><b class="rp-to">${fmt(m.after)}</b>${delta(d)}</div>`
      + `<div class="rp-title">${chip(m.after)}${promo ? `<span class="rp-promo">${escapeHtml(t('r_promo', { title: titleName(m.after) }))}</span>` : ''}</div>`
      + (nx ? `<div class="rp-gauge"><i style="width:${Math.round(nx.frac * 100)}%"></i></div><div class="rp-next muted small">${escapeHtml(t('r_next', { title: nx.name, n: fmt(nx.left) }))}</div>` : `<div class="rp-next muted small">${t('r_top')}</div>`)
      + `<div class="rp-rank">${escapeHtml(rank)}</div>`
      + (m.cap ? `<div class="rp-cap muted small">${t('r_capped')}</div>` : '')
      + `<button type="button" class="mini rp-see">${ico('trophy', 'sm')} ${t('r_see')}</button>`;
  }
  function renderPanel(box) {   // 結果発表で、自分のレートが動いたときだけ出す
    const m = state && state.rate_me;
    if (!box) return;
    if (!m || !SV.on()) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    box.innerHTML = panel(m);
    box.classList.remove('hidden');
    box.querySelector('.rp-see').onclick = () => showRanking();
  }

  return { creds, saveCopy, hasRating, refreshHome, drawHome, showRanking, lobbyLine, finalLine, renderPanel, chip, fmt, tier, next, titleName };
})();
