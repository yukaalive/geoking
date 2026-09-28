/* サバイバル（体力を減らし合う試作のルール）の画面。部屋の settings.rule が 'survival' のときだけ app.js から使う（点のルールの画面は変えない）。
   app.js より先に読み込む。中で使う state・pid・t・ico・rowName・spawnConfetti などは app.js / common.js / i18n.js のもので、呼ばれたときに使う。
   - 体力ゲージはどこでも同じ見た目: 上の自分の体力・スコアの欄・みんなの手札・答え合わせのカード・結果発表
   - 外側のカードの枠はなし（国旗の枠だけ。2026-09-28）。体力ゲージは太いゲージの中に数字
   - 答え合わせの演出（初めて見る答え合わせだけ）: めくる → 1位の国旗の枠が金色に光る（王冠・衝撃波・紙吹雪・ノーダメージ）→ 下の順位から順に揺れて「−20」が飛び、
     ゲージが減る（今減った分の赤いゲージがあとから消える）→ 0になったら「脱落」のハンコ。自分が当たったら画面のふちが赤く、1位なら金色に光って振動
   - チャットやつなぎ直しで同じ答え合わせが届いても、カードは作り直さない（演出を途中で切らない）。読み直したときは終わった形で出す */
const SV = (() => {
  const on = () => !!(state && state.settings && state.settings.rule === 'survival');
  const maxHp = () => (state && state.surv && state.surv.hp) || 100;
  const maxDmg = () => (state && state.surv && state.surv.max_damage) || 30;
  // ダメージの強さ 0〜6（効果音・振動・揺れ・数字の大きさ用）。最下位（いちばん大きいダメージ）が6。体力100・最下位30でも、20・6のときと同じ強さの音になる
  const power = (dmg) => Math.round(6 * dmg / maxDmg());
  let shown = {};            // 答え合わせの間に画面に出している体力（pid → 体力。まだ当たっていない人は減る前の体力）
  let koShown = new Set();   // このラウンドで「脱落」のハンコを押し終えた人
  let timers = [];
  const later = (ms, fn) => { timers.push(setTimeout(fn, ms)); };
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };

  const inReveal = () => !!(state && state.phase === 'reveal' && state.reveal);
  const hpOf = (p) => (inReveal() && shown[p.pid] != null) ? shown[p.pid] : (p.hp ?? 0);
  // 脱落して見えるか（このラウンドで脱落した人は、ハンコを押すまでは残っているように見せる）
  const isOut = (p) => !!p.out_round && !(inReveal() && p.out_round === state.round && !koShown.has(p.pid));

  // ---------- 体力ゲージ（太いゲージの中に数字。緑 → 半分で黄 → 4分の1で赤）。2026-09-28: 細いゲージの横に小さい数字だと「体力が見えにくい」と言われ、案A に
  const level = (hp) => { const r = hp / maxHp(); return r > 0.5 ? '' : r > 0.25 ? ' mid' : ' low'; };
  function bar(id, hp, small) {
    const r = Math.max(0, Math.min(1, hp / maxHp()));
    return `<span class="sv-hpbox${small ? ' small' : ''}"><span class="sv-hp${level(hp)}" data-pid="${id}" style="--hp:${r}"><i class="sv-ghost"></i><i class="sv-fill"></i><b class="sv-hpnum" data-pid="${id}">${hp}</b></span></span>`;
  }
  function setHp(id, hp) {   // その人のゲージを全部（カード・スコアの欄・上の自分の体力）同時に減らす。数字は数えながら減る
    const from = shown[id] ?? hp;
    shown[id] = hp;
    document.querySelectorAll(`.sv-hp[data-pid="${id}"]`).forEach(b => { b.style.setProperty('--hp', Math.max(0, Math.min(1, hp / maxHp()))); b.className = 'sv-hp' + level(hp); });
    document.querySelectorAll(`.sv-hpnum[data-pid="${id}"]`).forEach(n => countTo(n, from, hp));
  }
  function countTo(node, from, to) {
    const t0 = performance.now(), dur = 450;
    const step = (now) => { const k = Math.min(1, (now - t0) / dur); node.textContent = Math.round(from + (to - from) * k); if (k < 1 && node.isConnected) requestAnimationFrame(step); };
    requestAnimationFrame(step);
    setTimeout(() => { node.textContent = to; }, dur + 60);   // 画面が裏にあると requestAnimationFrame が止まるので、最後の数字は時計でも入れる
  }

  // ---------- 上の「ラウンド 3」の下: 自分の体力と、残りの人数
  function renderStatus() {
    const box = $('#svStatus'), of = $('#roundOf');
    if (!box) return;
    box.classList.toggle('hidden', !on());
    if (of) of.classList.toggle('hidden', on());
    if (!on()) { box.innerHTML = ''; return; }
    const me = state.players.find(p => p.pid === pid);
    const alive = state.players.filter(p => !p.spectator && !isOut(p)).length;
    const mine = !me || me.spectator ? '' : isOut(me) ? `<span class="tag sv-outtag">${t('sv_out')}</span>` : `${ico('heart', 'sm')}${bar(me.pid, hpOf(me))}`;
    box.innerHTML = `${mine}<span class="sv-alive">${t('sv_alive', { n: alive })}</span>`;
  }

  // ---------- スコアの欄: 体力の多い順、脱落した人は下に（あとまで残った人ほど上）
  function renderScores(sl) {
    sl.innerHTML = '';
    const grp = (p) => p.spectator ? 2 : isOut(p) ? 1 : 0;
    const list = [...state.players].sort((a, b) => grp(a) - grp(b) || (grp(a) === 1 ? (b.out_round || 0) - (a.out_round || 0) : hpOf(b) - hpOf(a)));
    for (const p of list) {
      const out = isOut(p);
      const name = p.pid !== pid && !p.is_bot ? `<b class="who" data-pid="${p.pid}" title="${t('report_mute')}">${escapeHtml(pname(p))}</b>` : escapeHtml(pname(p));
      const mark = state.phase === 'pick' && !p.spectator && !out ? (p.picked ? ico('check', 'sm status-ico') : ico('clock', 'sm status-ico')) : '';
      const right = p.spectator ? '—' : out ? `<span class="tag sv-outtag">${t('sv_out')}</span>` : bar(p.pid, hpOf(p), true) + mark;
      sl.appendChild(el('li', 'sv-row' + (out ? ' sv-dead' : ''), `<span>${name}${playerTag(p, false)}</span><b class="sv-right">${right}</b>`));   // 「あなた」の札は付けない（体力ゲージと並ぶと2行になる。2026-09-28）
    }
    sl.querySelectorAll('.who').forEach(b => b.onclick = () => showPlayerMenu(b.dataset.pid));
  }
  function refreshSide() { if (!state || !on()) return; const sl = $('#scoreList'); if (sl) renderScores(sl); renderStatus(); }

  // ---------- 答え合わせ
  const STAGGER = 0.18;   // 秒。カードが1枚ずつめくれる間隔（点のルールは 0.25。当たる演出の時間を空けるため少し速く）
  function renderReveal() {
    const r = state.reveal, F = META.fields[r.prompt.key];
    const box = $('#revealRows');
    clearInterval(revealInterval); clearInterval(confettiTimer);
    const label = r.last ? t('final_label') : t('sv_next_label');
    const tick = () => {
      if (!state || !state.reveal) { stopTimer(); return; }
      const left = state.next_at ? Math.max(0, Math.ceil(state.next_at - Date.now() / 1000)) : 0;
      $('#nextCountdown').textContent = t('next_in', { sec: left, label });
    };
    tick(); revealInterval = setInterval(tick, 250);
    const rkey = revealKeyOf(state), vkey = rkey + '|' + LANG;
    if (box.dataset.svKey === vkey && box.querySelector('.sv-card')) return;   // 同じ答え合わせ（チャット・つなぎ直しで届いた）: カードは作り直さない
    clearTimers();
    const fresh = rkey !== revealShown();
    try { sessionStorage.setItem('geoking_revealed', rkey); } catch {}
    box.dataset.svKey = vkey;
    box.innerHTML = ''; box.classList.add('sv-reveal'); box.classList.toggle('still', !fresh);
    shown = {}; koShown = new Set();
    for (const row of r.rows) { shown[row.pid] = fresh ? row.hp_before : row.hp; if (!fresh && row.out) koShown.add(row.pid); }
    const fx = el('div', 'sv-fx'); box.appendChild(fx);   // 衝撃波を描く層（答え合わせの枠の外にはみ出さない）
    const cards = {};
    // カードは小さめ（4人ならスマホの1画面に全員が入り、当たるところが全部見える）: 上の段に順位と減った体力、国旗のすぐ下に体力ゲージ、世界順位は1行
    r.rows.forEach((row, i) => {
      const c = META.countries[row.card];
      const safe = row.winner || !row.damage;
      const d = el('div', 'rev sv-card' + (row.winner ? ' win' : '') + (!fresh && row.out ? ' sv-ko' : ''));
      d.style.animationDelay = (i * STAGGER) + 's';
      // 国名はふだんは短い名前（正式名称は国旗をタップした小窓に出る）。「正式名称の文字数」「五十音順」のお題では、比べた名前と読みを出す
      const nm = r.prompt.key === 'name_len' ? `${coff(c)}<small>${t('reading')}${c.official_kana}</small>` : r.prompt.key === 'kana_rank' ? `${cname(c)}<small>${t('reading')}${c.name_kana}</small>` : cname(c);
      const tier = row.world_rank ? wrankTier(row.world_rank).cls : '';
      d.innerHTML = `<div class="sv-head"><span class="crown">${row.winner ? ico('crown') : (row.rank ? t('rank_n', { n: row.rank }) : '—')}</span>`
        + `<span class="sv-dmgline${fresh ? '' : ' show'}${safe ? ' safe' : ''}">${safe ? `<span class="sv-nodmg">${t('sv_no_damage')}</span>` : '−' + row.damage}</span></div>`
        + `<div class="sv-flag"><img src="${flagUrl(row.card)}" alt=""><span class="sv-stamp">${t('sv_out')}</span></div>`
        + `<div class="sv-hprow">${bar(row.pid, shown[row.pid])}</div>`
        + `<div class="who">${escapeHtml(rowName(row))}${row.pid === pid ? t('you_paren') : ''}</div>`
        + `<div class="country">${nm}</div>`
        + `<div class="val">${row.missing ? t('no_data') : fmtValue(row.value, F.fmt)}</div>`
        + (row.world_rank ? `<div class="sv-wr${tier}">${t('world_rank_plain', { n: row.world_rank, total: row.world_total })}</div>` : '');
      d.style.cursor = 'pointer'; d.onclick = () => showCountry(row.card);
      box.appendChild(d); cards[row.pid] = d;
    });
    setHeading(!fresh);
    if (fresh) play(r.rows, cards, box, fx);
  }

  function play(rows, cards, box, fx) {
    const flipped = (STAGGER * (rows.length - 1) + 0.5) * 1000;   // ミリ秒。全部のカードがめくれ終わるころ
    const tops = rows.filter(r => r.winner || !r.damage), hits = rows.filter(r => !r.winner && r.damage > 0);
    later(flipped + 150, () => {   // 1位: 光る・王冠が跳ねる・衝撃波・紙吹雪・「ノーダメージ」
      let meTop = false, anyTop = false;
      for (const r of tops) {
        const d = cards[r.pid]; if (!d || !d.isConnected) continue;
        d.querySelector('.sv-dmgline').classList.add('show');
        if (!r.winner) continue;
        anyTop = true;
        d.style.animationDelay = '0s';   // めくる動きの遅れ（i × STAGGER）を引き継がない
        d.classList.add('sv-power');
        wave(box, fx, d);
        spawnConfetti(anchor(box, fx, d.querySelector('.crown')), 'gold', 0.8);
        if (r.pid === pid) meTop = true;
      }
      if (meTop) { sfx.win(); flash('gold'); } else if (anyTop) sfx.power();
    });
    const t0 = flipped + 650, gap = 300;
    hits.forEach((r, k) => later(t0 + k * gap, () => {   // 1位以外: 順位の順に当たる（最下位がいちばん最後で、いちばん大きい）
      const d = cards[r.pid]; if (!d || !d.isConnected) return;
      d.style.animationDelay = '0s';
      d.classList.add('sv-hit'); if (power(r.damage) >= 5) d.classList.add('sv-big');
      d.querySelector('.sv-dmgline').classList.add('show');
      pop(d, r.damage);
      setHp(r.pid, r.hp);
      sfx.hit(power(r.damage));
      if (r.pid === pid) { flash('red'); sfx.hurt(power(r.damage)); }
      if (r.out) later(450, () => {   // 体力0: 「脱落」のハンコ
        if (!d.isConnected) return;
        d.classList.add('sv-ko'); koShown.add(r.pid); sfx.ko();
        if (r.pid === pid) sfx.hurt(6);
        refreshSide();
      });
    }));
    later(t0 + Math.max(0, hits.length - 1) * gap + (hits.some(r => r.out) ? 1000 : 500), () => { setHeading(true); refreshSide(); });
  }
  const FX_PAD = 12;   // .sv-fx は答え合わせの枠より 12px 外まで
  function wave(box, fx, card) {   // 1位のカードから広がる衝撃波
    const b = box.getBoundingClientRect(), c = card.getBoundingClientRect();
    const w = el('i', 'sv-wave');
    w.style.left = (c.left - b.left + c.width / 2 + FX_PAD) + 'px';
    w.style.top = (c.top - b.top + c.height / 2 + FX_PAD) + 'px';
    w.style.setProperty('--s', (Math.hypot(b.width, b.height) / 20).toFixed(1));
    fx.appendChild(w); setTimeout(() => w.remove(), 900);
  }
  function anchor(box, fx, target) {   // 紙吹雪の出どころ（王冠の位置）。紙吹雪は .sv-fx の中に出すので、画面の横にはみ出さない
    const b = box.getBoundingClientRect(), c = target.getBoundingClientRect();
    const a = el('i', 'sv-anchor');
    a.style.left = (c.left - b.left + c.width / 2 + FX_PAD) + 'px';
    a.style.top = (c.top - b.top + c.height / 2 + FX_PAD) + 'px';
    fx.appendChild(a); setTimeout(() => a.remove(), 1900);
    return a;
  }
  function pop(card, dmg) {   // カードから飛び出すダメージの数字
    const p = el('div', 'sv-pop' + (power(dmg) >= 5 ? ' big' : ''), '−' + dmg);
    card.appendChild(p); setTimeout(() => p.remove(), 1300);
  }
  function flash(kind) {   // 画面のふちが光る（自分が当たった: 赤、自分が1位: 金）
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const f = el('div', 'sv-flash ' + kind);
    document.body.appendChild(f); setTimeout(() => f.remove(), 800);
  }
  function setHeading(done) {   // 答え合わせの見出し: はじめは「〇〇が1位！」、当たり終わったら脱落した人・決着
    const r = state.reveal, h = $('#revealArea h3'); if (!h) return;
    const winners = r.rows.filter(x => x.winner).map(x => rowName(x)), kos = r.rows.filter(x => x.out).map(x => rowName(x));
    if (done && r.last) {
      const alive = state.players.filter(p => !p.spectator && !p.out_round);
      h.textContent = alive.length === 1 ? t('sv_decided', { name: pname(alive[0]) }) : t('sv_time_up');
    } else if (done && kos.length) h.textContent = t('sv_knocked', { names: joinNames(kos) });
    else h.textContent = winners.length ? t('won_point', { names: joinNames(winners) }) : t('draw_nodata');
  }

  // ---------- 脱落した人・途中から観戦の人の「観戦中」の札
  function spectateText(me) {
    const box = $('#spectate'); if (!box) return;
    const out = on() && me && me.out_round && !me.spectator;
    box.querySelector('h3').textContent = t(out ? 'sv_you_out_title' : 'spectating');
    box.querySelector('p').textContent = t(out ? 'sv_you_out_note' : 'spectate_note');
  }

  // ---------- 結果発表: 最後まで残った人（体力）→ 脱落した人（何ラウンドで脱落したか）
  function renderFinal(ol) {
    const list = (state.final || []).slice().sort((a, b) => (a.place || 99) - (b.place || 99));
    list.forEach((e, i) => {
      const place = e.place || i + 1;
      const cls = place === 1 ? 'g' : place === 2 ? 's' : place === 3 ? 'b' : 'n';
      const right = e.out_round ? `<span class="sv-outnote">${t('sv_out_round', { n: e.out_round })}</span>` : bar(e.pid, e.hp || 0, true);
      const li = el('li', 'm sv-m' + (place === 1 ? ' champ' : ''), `<div class="disc ${cls}">${place}</div><div class="nm">${place === 1 ? ico('crown') + ' ' : ''}${escapeHtml(pname(e))}</div><div class="sc sv-sc">${right}</div>`);
      li.style.animationDelay = (0.15 * i) + 's';
      ol.appendChild(li);
      if (place === 1) setTimeout(() => spawnConfetti(li.querySelector('.disc'), 'gold'), 400 + 150 * i);
    });
  }
  function endTitle() {
    const list = state.final || [];
    const champs = list.filter(e => e.place === 1);
    const names = escapeHtml(joinNames(champs.map(e => pname(e))));
    return `${ico('trophy', 'big')} ${t(champs.some(e => !e.out_round) ? 'sv_champion' : 'is_champion', { names })}`;
  }
  // 結果発表の「出された国の一覧」のカードに、そのラウンドで減った体力
  function historyDamage(r) {
    if (r.damage == null) return '';
    return `<div class="sv-hdmg${r.damage ? '' : ' safe'}">${r.damage ? '−' + r.damage : '±0'}${r.out ? `<span class="tag sv-outtag">${t('sv_out')}</span>` : ''}</div>`;
  }

  return { on, bar, hpOf, renderStatus, renderScores, renderReveal, spectateText, renderFinal, endTitle, historyDamage };
})();
