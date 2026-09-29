/* 国の小窓とロビーの確認。iPhone（WebKit）は iOS シミュレーターの Safari で /dev/tests/window_check.html を開く（対戦画面をそのまま読み込み、最後にこのファイルを入れる）。
   ① 答え合わせ（パーティー）で世界順位の札の紙吹雪が飛んでいる間に国の小窓を開いても、ページの幅が画面より広がらず、小窓が画面の真ん中に収まるか
      （2026-09-29: スマホでは粒が画面の外まで飛ぶとページの幅が広がり、小窓が右へずれて切れていた）
   ② 小窓の項目名の列: 気候の文が長いメキシコでも「一人当たりGDP」などが1行（幅 360px 未満は2行まで）で、右の数字と「〇位 ／ 197」が1行か
   ③ ?step=lobby: ロビーの説明の文の中の部屋の名前の札が2つに割れないか、「プレイヤー」「部屋の設定」「チャット」の枠の右の端がそろうか（2026-09-29: 320px で2つの枠だけ右にはみ出していた）
   ?fix=off で①の直し（#app の overflow-x: clip）を外して、直す前と比べる。?lang=en で英語。結果は画面の下に出す（小窓は開いたまま残す） */
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const out = document.createElement('div');
  out.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;background:rgba(0,0,0,.85);color:#fff;font:12px/1.45 -apple-system,system-ui,sans-serif;padding:6px 10px calc(6px + env(safe-area-inset-bottom));white-space:pre-wrap;pointer-events:none';
  document.body.appendChild(out);
  const say = (s) => { out.textContent += (out.textContent ? '\n' : '') + s; };
  try {
    const meta = () => (typeof META !== 'undefined' && META) || null;   // META は common.js の let（window の上にはない）
    for (let i = 0; i < 100 && !meta(); i++) await sleep(100);
    if (!meta()) throw new Error('国のデータが読めない');
    await Promise.race([document.fonts.ready, sleep(3000)]);
    const q = new URLSearchParams(location.search), step = q.get('step') || 'window', fixOff = q.get('fix') === 'off';
    if (fixOff) for (const sh of document.styleSheets) { try { for (let i = sh.cssRules.length - 1; i >= 0; i--) if (sh.cssRules[i].cssText.includes('overflow-x: clip')) sh.deleteRule(i); } catch {} }
    // サーバーにはつながず、ニセの状態で本物の画面を描く（docs/store-assets/x-ad/common_state.js と同じやり方）
    window.ensureConnection = () => {}; window.reconnectNow = () => {};
    setLang(q.get('lang') === 'en' ? 'en' : 'ja');
    const ME = 'me0001';
    const P = (id, name, extra = {}) => ({ pid: id, name, name_en: null, score: 0, is_bot: false, connected: true, picked: true, won: [], spectator: false, hand_count: 8, ...extra });
    const BASE = (over) => ({ type: 'state', room: 'AB12', title: 'はなこの部屋', title_raw: 'はなこ', host: ME, you: ME, token: null, phase: 'lobby', round: 1, total_rounds: 7,
      settings: { categories: ['basic', 'climate', 'religion', 'society'], rounds: 7, hand_size: 8, show_names: false, timer: 30, max_star: 3, public: false, rule: 'points' },
      players: [], prompt: null, hand: [], hands: {}, live: null, history: [], final: null, leftover: null, my_pick: null, reveal: null, deadline: null, next_at: null, chat: [], muted: [], ...over });
    const SHOW = (s) => { state = s; pid = ME; render(); };
    const W = document.documentElement.clientWidth;
    const who = /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android' : 'そのほか';
    say(`幅 ${W}px（${who}・${LANG === 'en' ? '英語' : '日本語'}）${fixOff ? '・紙吹雪の直しを外した（直す前と同じ）' : ''}`);

    if (step === 'lobby') {
      const lobby = (name) => SHOW(BASE({ phase: 'lobby', title: name, title_raw: name, players: [P(ME, 'はなこ'), P('p2', 'たろう'), P('p3', 'ゆうと'), P('p4', 'さくら')].map(p => ({ ...p, picked: false })) }));
      // 説明の文の中の部屋の名前の札が2つに割れないか（2026-09-30: 行の終わりで「はな／こ」と割れていた）。20文字の名前は札の中で折り返し、文からはみ出さない
      const tags = [];
      for (const name of ['ゆかと友だちのたのしい地理王の部屋です', 'たろう', 'はなこ']) {
        lobby(name); window.scrollTo(0, 0); await sleep(400);
        const b = document.getElementById('lobbyCode'), pr = b.closest('p').getBoundingClientRect(), rs = [...b.getClientRects()];
        tags.push({ name, n: rs.length, over: Math.max(...rs.map(x => x.right)) > pr.right + 0.5 });
      }
      say(`③ 部屋の名前の札: ${tags.map(t => `「${t.name.length > 6 ? t.name.slice(0, 6) + '…' : t.name}」${t.n}つ${t.over ? '・はみ出し' : ''}`).join('・')} → ${tags.every(t => t.n === 1 && !t.over) ? 'OK（割れない）' : 'NG'}`);
      await sleep(200);
      const cards = [...document.querySelectorAll('#lobby .card')].filter(e => e.offsetParent);
      const rights = cards.map(c => Math.round(c.getBoundingClientRect().right));
      const ok = new Set(rights).size === 1 && rights[0] <= W - 8 && document.documentElement.scrollWidth <= W;
      say(`   ロビーの枠の右の端: ${rights.join('・')}px → ${ok ? 'OK（そろっている）' : 'NG'}`);
      say('終わり');
      return;
    }

    // ① 答え合わせ（初めて見る結果として出す → 世界順位の札から紙吹雪。そのあとも 1.3 秒ごと）
    try { sessionStorage.removeItem('geoking_revealed'); } catch {}
    const C = META.countries, all = Object.values(C).filter(c => c.population != null), wr = (id) => 1 + all.filter(c => c.population > C[id].population).length;
    const pr = META.prompts.find(p => p.id === 'pop_max');
    const players = [P(ME, 'はなこ', { score: 3 }), P('p2', 'たろう', { score: 4 }), P('p3', 'ゆうと', { score: 2 }), P('p4', 'さくら', { score: 1 })];
    const rows = [['mx', 'たろう', 'p2'], ['jp', 'はなこ', ME], ['fr', 'ゆうと', 'p3'], ['kr', 'さくら', 'p4']]
      .map(([card, name, id], i) => ({ pid: id, name, name_en: null, card, value: C[card].population, missing: false, world_rank: wr(card), world_total: all.length, rank: i + 1, winner: i === 0, points: 4 - i }));
    SHOW(BASE({ phase: 'reveal', prompt: pr, hand: ['fr', 'it', 'kr', 'ca', 'au', 'nl', 'se'], my_pick: 'jp', players, reveal: { prompt: pr, rows }, next_at: Date.now() / 1000 + 600 }));
    const ra = document.getElementById('revealArea'); window.scrollTo(0, ra.getBoundingClientRect().top + scrollY - 70);
    let maxW = 0;
    const t0 = Date.now(); while (Date.now() - t0 < 1400) { maxW = Math.max(maxW, document.documentElement.scrollWidth); await sleep(50); }
    document.querySelector('#revealRows .rev').click();   // 紙吹雪が飛んでいる間に、1位のメキシコのカードをタップ → 小窓
    await sleep(300);
    let worst = null;
    const t1 = Date.now();
    while (Date.now() - t1 < 2600) {   // 紙吹雪は 1.3 秒ごとに出るので、2回分見て、小窓がいちばんずれたときを残す
      const b = document.querySelector('#modal .modalbox').getBoundingClientRect(), vv = window.visualViewport;
      const vl = vv ? vv.offsetLeft : 0, vw = vv ? vv.width : innerWidth;
      const cut = Math.max(0, b.right - (vl + vw)) + Math.max(0, vl - b.left), lm = b.left - vl, rm = vl + vw - b.right;
      maxW = Math.max(maxW, document.documentElement.scrollWidth);
      if (!worst || cut > worst.cut || Math.abs(lm - rm) > Math.abs(worst.lm - worst.rm)) worst = { cut, lm, rm };
      await sleep(50);
    }
    say(`① 紙吹雪の最中のページの幅: いちばん広くて ${maxW}px → ${maxW <= W ? 'OK（広がらない）' : 'NG（画面より広がった）'}`);
    say(`   小窓の左右の余白: ${Math.round(worst.lm)}px・${Math.round(worst.rm)}px、切れた幅 ${Math.round(worst.cut)}px → ${worst.cut < 1 && Math.abs(worst.lm - worst.rm) <= 2 ? 'OK（真ん中）' : 'NG（ずれた）'}`);

    // ② 開いた小窓（メキシコ）の項目名と値が何行か
    const lines = (el) => {   // 文字の行の数（同じ行の小さい字「〇位 ／ 197」は上下が少しずれるので、行の高さの半分より近いものは同じ行）
      const r = document.createRange(); r.selectNodeContents(el);
      const tops = [...r.getClientRects()].filter(x => x.width > 0.5).map(x => x.top).sort((a, b) => a - b);
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 20; let n = 0, last = -1e9;
      for (const t of tops) { if (t - last > lh / 2) { n++; last = t; } }
      return n;
    };
    const ks = [...document.querySelectorAll('#modal .dl .k')], vs = [...document.querySelectorAll('#modal .dl .v')];
    const row = (label) => { const i = ks.findIndex(k => k.textContent.trim() === label); return i < 0 ? null : { k: lines(ks[i]), v: lines(vs[i]) }; };
    const names = LANG === 'en' ? ['GDP per capita', 'Population density', 'Area'] : ['一人当たりGDP', '正式名称の文字数', '人口密度', '面積'];
    const got = names.map(n => [n, row(n)]).filter(([, r]) => r);
    const maxK = W >= 360 ? 1 : 2;
    const kOk = LANG === 'en' || got.every(([, r]) => r.k <= maxK), vOk = got.every(([, r]) => r.v === 1);
    say(`② 小窓の項目名: ${got.map(([n, r]) => `${n} ${r.k}行`).join('・')} → ${kOk ? 'OK' : 'NG'}（${maxK}行まで）`);
    say(`   右の値: ${got.map(([n, r]) => `${n} ${r.v}行`).join('・')} → ${vOk ? 'OK（1行）' : 'NG'}`);
    say('終わり（小窓は開いたまま）');
  } catch (e) { say('エラー: ' + (e && e.message || e)); }
})();
