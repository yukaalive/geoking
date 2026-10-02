/* バトル（体力を減らし合うゲーム。中の名前は survival）の画面。部屋の settings.rule が 'survival' のときだけ app.js から使う（パーティー＝点のルールの画面は変えない）。
   app.js より先に読み込む。中で使う state・pid・t・ico・rowName・spawnConfetti などは app.js / common.js / i18n.js のもので、呼ばれたときに使う。
   - 体力ゲージはどこでも同じ見た目: 上の自分の体力・スコアの欄・みんなの手札・答え合わせのカード・結果発表
   - 外側のカードの枠はなし（国旗の枠だけ。2026-09-28）。体力ゲージは太いゲージの中に数字
   - 答え合わせの演出（初めて見る答え合わせだけ。2026-09-28 ユーザーが選んだ案B「1位の国旗が攻撃する」）:
     めくる → 1位の国旗が跳ねて金色に光る（後ろで後光が回る・星・キラキラ・衝撃波・紙吹雪。自分が1位なら画面ぜんぶが金色に光る）
     → 1位の国旗に力がたまり、ほかの人の国旗へ光の弾が飛ぶ（ダメージの小さい人から。同じダメージの人は同時に。大きいダメージほど大きい弾）
     → 当たると国旗が白く光って一瞬止まり、揺れて赤く光る（切り傷・火花・ギザギザの吹き出しの「−20」・体力ゲージの減った分が割れて落ちる。その回でいちばん大きいダメージは答え合わせ全体が揺れる）
     → 0になったら「脱落」のハンコ（国旗にひびが入って、かけらが落ちる）。自分が当たったら画面のふちが赤く光って振動
   - チャットやつなぎ直しで同じ答え合わせが届いても、カードは作り直さない（演出を途中で切らない）。読み直したときは終わった形で出す */
const SV = (() => {
  const on = () => !!(state && state.settings && state.settings.rule === 'survival');
  const maxHp = () => (state && state.surv && state.surv.hp) || 100;
  let shown = {};            // 答え合わせの間に画面に出している体力（pid → 体力。まだ当たっていない人は減る前の体力）
  let koShown = new Set();   // このラウンドで「脱落」のハンコを押し終えた人
  let timers = [];
  const later = (ms, fn) => { timers.push(setTimeout(fn, ms)); };
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
  const calm = () => fxCalm();   // 端末の「視差効果を減らす」（app.js）: 揺れ・弾・火花などは出さない（数字とゲージだけ）

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
      sl.appendChild(el('li', 'sv-row' + (out ? ' sv-dead' : ''), `<span>${name}${playerTag(p)}</span><b class="sv-right">${right}</b>`));
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
    box.innerHTML = ''; box.classList.add('sv-reveal'); box.classList.toggle('still', !fresh); box.classList.remove('sv-quake');
    shown = {}; koShown = new Set();
    for (const row of r.rows) { shown[row.pid] = fresh ? row.hp_before : row.hp; if (!fresh && row.out) koShown.add(row.pid); }
    const L = fxLayers(box);   // 演出を描く層（app.js。パーティーと同じ）: L.back は国旗の後ろ（1位の後光）、L.front は前（弾・火花・数字・紙吹雪）。どちらも答え合わせの枠の外にはみ出さない
    const cards = {};
    // カードは小さめ（4人ならスマホの1画面に全員が入り、当たるところが全部見える）: 上の段に順位と減った体力、国旗のすぐ下に体力ゲージ、世界順位は1行
    r.rows.forEach((row, i) => {
      const c = META.countries[row.card];
      const hurt = !row.winner && row.damage > 0;   // 減った人だけ「−20」を出す（1位・減らなかった人は何も出さない。2026-09-28 に「ノーダメージ」の札をなくした）
      const d = el('div', 'rev sv-card' + (row.winner ? ' win' : '') + (!fresh && row.out ? ' sv-ko' : ''));
      d.style.animationDelay = (i * STAGGER) + 's';
      // 国名はふだんは短い名前（正式名称は国旗をタップした小窓に出る）。「正式名称の文字数」「五十音順」のお題では、比べた名前と読みを出す
      const nm = r.prompt.key === 'name_len' ? `${coff(c)}<small>${t('reading')}${c.official_kana}</small>` : r.prompt.key === 'kana_rank' ? `${cname(c)}<small>${t('reading')}${c.name_kana}</small>` : cname(c);
      const tier = row.world_rank ? wrankTier(row.world_rank).cls : '';
      d.innerHTML = `<div class="sv-head"><span class="crown">${row.winner ? ico('crown') : (row.rank ? t('rank_n', { n: row.rank }) : '—')}</span>`
        + (hurt ? `<span class="sv-dmgline${fresh ? '' : ' show'}">−${row.damage}</span>` : '') + '</div>'
        + `<div class="rflag"><div class="sv-flag"><img src="${flagUrl(row.card)}" alt=""></div><span class="sv-stamp">${t('sv_out')}</span></div>`   // rflag: 国旗の置き場（3:2。メインと同じ）。sv-flag は国旗にぴったりの枠（金の光・赤い光）。ハンコは置き場の中央（細い国旗でも切れない）
        + `<div class="sv-hprow">${bar(row.pid, shown[row.pid])}</div>`
        + `<div class="who">${escapeHtml(rowName(row))}</div>`
        + `<div class="country">${nm}</div>`
        + `<div class="val">${row.missing ? t('no_data') : fmtValue(row.value, F.fmt)}</div>`
        + (row.world_rank ? `<div class="sv-wr${tier}">${t('world_rank_plain', { n: row.world_rank, total: row.world_total })}</div>` : '');
      d.style.cursor = 'pointer'; d.onclick = () => showCountry(row.card);
      box.appendChild(d); cards[row.pid] = d;
      if (!fresh && row.out) crack(d.querySelector('.sv-flag'), false);   // 読み直したとき: 脱落した国旗のひびも、終わった形で
    });
    setHeading(!fresh);
    if (fresh) play(r.rows, cards, box, L);
  }

  const FLY = 300;   // ミリ秒。1位の国旗から弾が飛んで当たるまで
  function play(rows, cards, box, L) {
    const fx = L.front;
    const flipped = (STAGGER * (rows.length - 1) + 0.5) * 1000;   // ミリ秒。全部のカードがめくれ終わるころ
    const winners = rows.filter(r => r.winner), hits = rows.filter(r => !r.winner && r.damage > 0);
    const most = Math.max(0, ...hits.map(r => r.damage));
    const kOf = (dmg) => most ? dmg / most : 0;   // 当たる強さ 0〜1（音・振動・切り傷の数・数字の大きさ）。その回でいちばん大きいダメージが1（2人でも、負けた人はいちばん強く）
    const groups = [...new Set(hits.map(r => r.damage))].sort((a, b) => a - b).map(dmg => hits.filter(r => r.damage === dmg));   // 同じダメージの人は同時に当たる（何人でも長さがほぼ同じ）
    const t1 = flipped + 150, times = [];
    later(t1, () => cheerWinners(box, L, winners.filter(r => cards[r.pid]).map(r => ({ card: cards[r.pid], flag: cards[r.pid].querySelector('.sv-flag'), crown: cards[r.pid].querySelector('.crown .ico'), mine: r.pid === pid })), true));   // 1位の演出（app.js。パーティーと同じ）。ほかの人が1位なら「シャキーン」
    if (winners.length && groups.length) later(t1 + 500, () => charge(winners, cards, fx));
    groups.forEach((g, i) => {   // ダメージの小さい人から順に、1位の国旗から弾が飛んで当たる
      const k = kOf(g[0].damage), tf = t1 + 900 + i * 600;
      if (winners.length) later(tf, () => fire(winners, g, k, cards, fx));
      later(tf + FLY, () => strike(g, k, cards, box, fx));
      times.push(tf + FLY);
    });
    later((times.length ? times[times.length - 1] : t1) + (hits.some(r => r.out) ? 1100 : 600), () => { setHeading(true); refreshSide(); });
  }

  // ---------- 当たる演出の部品（どれも答え合わせの枠の前の層 L.front の中か、画面に固定して出し、動き終わったら消す）。1位の演出は app.js の cheerWinners（パーティーと同じ）
  const center = (layer, node) => fxCenter(layer, node), rnd = (a, b) => fxRnd(a, b), part = (...a) => fxPart(...a);   // app.js の部品（このファイルのあとに読み込まれるので、使うときに呼ぶ）
  function burst(rx, ry, ix, iy, n) {   // ギザギザの吹き出しの形（とがった所 n 個）
    let d = '';
    for (let i = 0; i < n * 2; i++) { const a = i / (n * 2) * Math.PI * 2 - Math.PI / 2, o = i % 2 === 0, j = rnd(.88, 1.08); d += (i ? 'L' : 'M') + (Math.cos(a) * (o ? rx : ix) * j).toFixed(1) + ' ' + (Math.sin(a) * (o ? ry : iy) * j).toFixed(1); }
    return d + 'Z';
  }

  // 1位の国旗に光が集まる → 弾が飛ぶ
  function charge(winners, cards, fx) {
    sfx.charge();
    for (const r of winners) {
      const d = cards[r.pid]; if (!d || !d.isConnected) continue;
      d.classList.add('sv-charge'); setTimeout(() => d.classList.remove('sv-charge'), 560);
      if (calm()) continue;
      const p = center(fx, d.querySelector('.sv-flag'));
      for (let i = 0; i < 12; i++) {
        const a = rnd(0, Math.PI * 2), r0 = rnd(55, 95);
        part(fx, 'sv-dot', p.x, p.y, [{ transform: `translate(${Math.cos(a) * r0}px,${Math.sin(a) * r0}px) scale(.6)`, opacity: 0 }, { opacity: 1, offset: .3 }, { transform: 'translate(0,0) scale(1.3)', opacity: 0 }], { duration: rnd(320, 460), delay: rnd(0, 120), easing: 'cubic-bezier(.5,0,.9,.5)', fill: 'both' });
      }
    }
  }
  function fire(winners, g, k, cards, fx) {   // 1位の国旗から弾が飛ぶ（1位が2人なら2人とも撃つ）
    sfx.whoosh(k);
    for (const r of winners) {
      const from = cards[r.pid] && cards[r.pid].querySelector('.sv-flag'); if (!from || !from.isConnected) continue;
      from.animate([{ transform: 'none' }, { transform: 'scale(1.09)', offset: .25 }, { transform: 'none' }], { duration: 260, easing: 'ease-out' });   // 撃った反動
      if (!calm()) for (const x of g) { const to = cards[x.pid] && cards[x.pid].querySelector('.sv-flag'); if (to) shot(fx, from, to, k); }
    }
  }
  function shot(fx, from, to, k) {   // 光の弾（しっぽつき）。少し曲がって飛び、だんだん速くなる。大きいダメージほど大きい
    const a = center(fx, from), b = center(fx, to), size = 16 + 18 * k, s = el('i', 'sv-shot');
    s.style.setProperty('--s', size + 'px'); fx.appendChild(s);
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, bend = rnd(.18, .32) * len * (Math.random() < .5 ? -1 : 1);
    const cx = (a.x + b.x) / 2 - dy / len * bend, cy = (a.y + b.y) / 2 + dx / len * bend - len * .12;
    const t0 = performance.now(); let last = 0;
    const step = (now) => {
      const u = Math.pow(Math.min(1, (now - t0) / FLY), 1.5), v = 1 - u;
      const x = v * v * a.x + 2 * v * u * cx + u * u * b.x, y = v * v * a.y + 2 * v * u * cy + u * u * b.y;
      s.style.transform = `translate(${x}px,${y}px)`;
      if (now - last > 16) { last = now; part(fx, 'sv-trail', 0, 0, [{ transform: `translate(${x}px,${y}px) scale(1)`, opacity: .9 }, { transform: `translate(${x}px,${y}px) scale(.2)`, opacity: 0 }], { duration: 280, easing: 'ease-out', fill: 'forwards' }).style.setProperty('--s', size * .8 + 'px'); }
      if (u < 1 && s.isConnected) requestAnimationFrame(step); else s.remove();
    };
    requestAnimationFrame(step);
    setTimeout(() => s.remove(), FLY + 500);   // 画面が裏にあって requestAnimationFrame が止まったとき
  }

  // 当たる（同じダメージの人は同時に）: 国旗が白く光って一瞬止まる → 揺れて赤く光り、体力が減る
  function strike(g, k, cards, box, fx) {
    sfx.smash(k, g.length);
    if (k > .67 && !calm()) { box.classList.remove('sv-quake'); void box.offsetWidth; box.classList.add('sv-quake'); setTimeout(() => box.classList.remove('sv-quake'), 600); }   // その回でいちばん大きいダメージ: 答え合わせ全体が揺れる
    for (const r of g) {
      const d = cards[r.pid]; if (!d || !d.isConnected) continue;
      const flag = d.querySelector('.sv-flag');
      d.style.animationDelay = '0s';
      d.classList.add('sv-white');
      d.querySelector('.sv-dmgline').classList.add('show');
      if (!calm()) { sparks(fx, flag, k, g.length); slashes(flag, k); pop(fx, flag, r.damage, k); }
      const stop = 60 + 80 * k;   // 止まる時間（ミリ秒）。大きいダメージほど長い
      later(stop, () => {
        d.classList.remove('sv-white'); d.classList.add('sv-hit'); if (k > .67) d.classList.add('sv-big');
        setHp(r.pid, r.hp); chunk(fx, d, r); jolt(r.pid);
        if (r.pid === pid) { flash(k > .67 ? 'red big' : 'red'); sfx.buzz(k); }
      });
      if (r.out) later(stop + 480, () => {   // 体力0: 「脱落」のハンコ。国旗にひびが入り、かけらが落ちる
        if (!d.isConnected) return;
        d.classList.add('sv-ko'); koShown.add(r.pid); sfx.shatter();
        crack(flag, true); if (!calm()) debris(fx, flag);
        if (r.pid === pid) sfx.buzz(1);
        refreshSide();
      });
    }
  }
  function sparks(fx, flag, k, many) {   // 火花（大きいダメージほど多く遠くへ。何人も同時に当たるときは少なめ）
    const p = center(fx, flag), n = Math.round((7 + 13 * k) * (many > 2 ? .6 : 1)), cols = ['#fff', '#ffe066', '#ffb03a', '#ff5a2e'];
    for (let i = 0; i < n; i++) {
      const a = rnd(0, 360), dist = rnd(40, 70 + 60 * k);
      const s = part(fx, 'sv-spark', p.x + rnd(-.15, .15) * p.w, p.y + rnd(-.15, .15) * p.h, [{ transform: `rotate(${a}deg) translateY(0) scaleY(1)`, opacity: 1 }, { transform: `rotate(${a}deg) translateY(${-dist}px) scaleY(.3)`, opacity: 0 }], { duration: rnd(320, 520), easing: 'cubic-bezier(.1,.7,.3,1)', fill: 'forwards' });
      s.style.height = rnd(8, 14 + 8 * k) + 'px'; s.style.background = cols[i % cols.length];
    }
  }
  function slashes(flag, k) {   // 国旗の上の切り傷（小さいダメージ1本・中2本・いちばん大きいダメージ3本）。国旗の枠の中だけ
    const n = k > .67 ? 3 : k > .34 ? 2 : 1, angles = [-24, 22, -8];
    for (let i = 0; i < n; i++) {
      const dy = (i - (n - 1) / 2) * 16, rot = `translateY(${dy}px) rotate(${angles[i]}deg)`, s = el('i', 'sv-slash');
      flag.appendChild(s);
      s.animate([{ transform: rot + ' scaleX(0)', opacity: 1 }, { transform: rot + ' scaleX(1)', opacity: 1, offset: .28 }, { transform: rot + ' scaleX(1.05) scaleY(.15)', opacity: 0 }], { duration: 340, delay: i * 55, easing: 'ease-out', fill: 'both' }).onfinish = () => s.remove();
      setTimeout(() => s.remove(), 1000);   // 画面が裏に回って動きが止まっていても消す
    }
  }
  function pop(fx, flag, dmg, k) {   // ギザギザの吹き出しの大きい「−20」（大きいダメージほど大きく、濃い色）
    const p = center(fx, flag), e = el('div', 'sv-pop ' + (k > .67 ? 'big' : k > .34 ? 'mid' : 'small'),
      `<svg viewBox="-60 -50 120 100" preserveAspectRatio="none" aria-hidden="true"><path class="o" d="${burst(58, 48, 38, 30, 14)}"/><path class="i" d="${burst(42, 34, 30, 22, 11)}"/></svg><b>−${dmg}</b>`);
    e.style.left = p.x + 'px'; e.style.top = (p.y - p.h * .06) + 'px'; fx.appendChild(e);
    setTimeout(() => e.remove(), 1500);
    e.animate([{ transform: 'translate(-50%,-50%) scale(2.3) rotate(-8deg)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(.86) rotate(3deg)', opacity: 1, offset: .1 }, { transform: 'translate(-50%,-50%) scale(1.1) rotate(-2deg)', offset: .18 },
      { transform: 'translate(-50%,-50%) scale(1) rotate(0deg)', offset: .26 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: .72 }, { transform: 'translate(-50%,-115%) scale(.9)', opacity: 0 }], { duration: 1400, easing: 'ease-out', fill: 'forwards' });
    e.querySelector('svg').animate([{ opacity: 1, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1.06)', offset: .22 }, { opacity: 1, transform: 'scale(1)', offset: .4 }, { opacity: 0, transform: 'scale(1.3)' }], { duration: 720, easing: 'ease-out', fill: 'forwards' });   // 吹き出しは先に消える（国旗を長く隠さない）
    if (k > .67) e.querySelector('b').animate([{ transform: 'none' }, { transform: 'translate(-3px,2px)' }, { transform: 'translate(3px,-2px)' }, { transform: 'translate(-2px,-1px)' }, { transform: 'translate(2px,1px)' }, { transform: 'none' }], { duration: 320 });
  }
  function chunk(fx, card, r) {   // 体力ゲージの減った分が割れて落ちる（色は減る前のゲージの色）
    if (calm()) return;
    const b = card.querySelector('.sv-hp'); if (!b) return;
    const L = fx.getBoundingClientRect(), R = b.getBoundingClientRect(), inner = R.width - 4, lost = Math.min(r.damage, r.hp_before);
    const e = el('i', 'sv-chunk');
    Object.assign(e.style, { left: R.left - L.left + 2 + inner * r.hp / maxHp() + 'px', top: R.top - L.top + 2 + 'px', width: Math.max(6, inner * lost / maxHp()) + 'px', height: R.height - 4 + 'px', background: { '': '#56bd79', ' mid': '#f4c542', ' low': '#f0806a' }[level(r.hp_before)] });
    fx.appendChild(e);
    const dir = Math.random() < .5 ? -1 : 1;
    e.animate([{ transform: 'translate(0,0) rotate(0deg)', opacity: 1 }, { transform: `translate(${dir * 6}px,-10px) rotate(${dir * 8}deg)`, opacity: 1, offset: .2 }, { transform: `translate(${dir * 22}px,56px) rotate(${dir * 40}deg)`, opacity: 0 }], { duration: 760, easing: 'cubic-bezier(.45,0,.8,.6)', fill: 'forwards' }).onfinish = () => e.remove();
    setTimeout(() => e.remove(), 1400);
  }
  function jolt(pid) {   // その人の体力ゲージ（カード・スコアの欄・上の自分の体力）が白く光って揺れ、数字が赤くなる
    if (calm()) return;
    document.querySelectorAll(`.sv-hp[data-pid="${pid}"]`).forEach(b => {
      b.classList.remove('sv-jolt'); void b.offsetWidth; b.classList.add('sv-jolt');
      const w = el('span', 'sv-blink'); b.appendChild(w);
      setTimeout(() => { w.remove(); b.classList.remove('sv-jolt'); }, 450);
    });
    document.querySelectorAll(`.sv-hpnum[data-pid="${pid}"]`).forEach(n => { n.classList.add('sv-red'); setTimeout(() => n.classList.remove('sv-red'), 700); });
  }
  function crack(flag, draw) {   // 脱落した国旗のひび（draw: ひびが走るように出す）
    let paths = '';
    for (let i = 0; i < 6; i++) {
      let a = i / 6 * Math.PI * 2 + rnd(-.3, .3), x = 50, y = 50, d = 'M50 50';
      for (let s = 0; s < 4; s++) { a += rnd(-.45, .45); const l = 62 / 4 * rnd(.7, 1.3); x += Math.cos(a) * l; y += Math.sin(a) * l; d += `L${x.toFixed(1)} ${y.toFixed(1)}`; }
      paths += `<path class="k1" pathLength="1" d="${d}"/><path class="k2" pathLength="1" d="${d}"/>`;
    }
    const anim = draw && !calm();
    flag.insertAdjacentHTML('beforeend', `<svg class="sv-crack${anim ? '' : ' done'}" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${paths}</svg>`);
    if (anim) flag.querySelectorAll('.sv-crack path').forEach(p => p.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 200, easing: 'ease-out', fill: 'forwards' }));
  }
  function debris(fx, flag) {   // 脱落: 国旗のかけらが落ちる
    const p = center(fx, flag);
    for (let i = 0; i < 9; i++) {
      part(fx, 'sv-shard', p.x + rnd(-.45, .45) * p.w, p.y + rnd(-.3, .4) * p.h, [{ transform: 'translate(0,0) rotate(0deg)', opacity: 1 }, { transform: `translate(${rnd(-30, 30)}px,${rnd(50, 90)}px) rotate(${rnd(-200, 200)}deg)`, opacity: 0 }], { duration: rnd(600, 900), easing: 'cubic-bezier(.5,0,.9,.6)', fill: 'forwards' })
        .style.setProperty('--s', rnd(6, 12) + 'px');
    }
  }
  function flash(kind) {   // 自分が当たった: 画面のふちが赤く光る（その回でいちばん大きいダメージは強く）
    if (calm()) return;
    const f = el('div', 'sv-flash ' + kind);
    document.body.appendChild(f); setTimeout(() => f.remove(), 900);
  }
  function setHeading(done) {   // 答え合わせの見出し: はじめは「〇〇が1位！」、当たり終わったら脱落した人・決着
    const r = state && state.reveal, h = $('#revealArea h3'); if (!r || !h) return;   // 裏に回したアプリから戻ったときなど、時計が遅れて次のラウンドに入っていたら何もしない
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
      const li = el('li', 'm sv-m' + (place === 1 ? ' champ' : ''), `<div class="disc ${cls}">${place}</div><div class="nm">${place === 1 ? ico('crown') + ' ' : ''}${escapeHtml(pname(e))}${RATE.finalLine(e)}</div><div class="sc sv-sc">${right}</div>`);   // 名前の下にレートの前と後（rating.js）
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
