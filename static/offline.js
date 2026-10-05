/* オフラインでボットと遊ぶ（2026-10-05 ユーザーの指定「Cにし、ランキングのレートも動かしたい。動かしたレートで次に接続した際のランキングも更新してほしい」）。
   - 通信がないとき（navigator.onLine が false）に「部屋を作る」と、サーバーの代わりに端末の中で部屋を動かす（Room）。
     画面（app.js）は WebSocket の代わりに OFFLINE.socket() とやり取りし、サーバーと同じ形の state を受け取るので、ロビー・選ぶ・答え合わせ・結果発表はそのまま
   - 遊び方は server.py の Room と同じ（配る・お題・ボットは手札からでたらめに出す・時間切れ・答え合わせ・バトルの減り方・パーティーの点・決着・最後の順位）
   - バトルが終わると、仮のレートを端末で計算して結果発表に出し（ボットは 1,000 の相手。rating.py の apply_game と同じ式）、結果を「送るもの」にためる。
     次につながったとき（ページを開いた・通信が戻った・オフラインの部屋から出た）に /api/rating/offline へ送り、サーバーのレートとランキングに入れる
     （端末の結果をそのまま受け取る。ユーザーの選択）。送れたら、サーバーの控えに置き換える
   - 国のデータは common.js の META（通信がないときは、前に覚えた分）。国旗は sw.js が覚えた分（ウェブ版） */
const OFFLINE = (() => {
  const BOT_NAMES = ['エミリー', 'マイケル', 'オリビア', 'ジェームズ', 'ソフィア', 'ノア', 'エマ', 'リアム', 'アヴァ', 'イーサン',
    'ミア', 'ジェイコブ', 'イザベラ', 'メイソン', 'シャーロット', 'ルーカス', 'アメリア', 'ベンジャミン', 'ハーパー', 'ローガン',
    'エヴリン', 'アレクサンダー', 'アビゲイル', 'ダニエル', 'エミリア', 'ヘンリー', 'エラ', 'ジャクソン', 'グレース', 'サミュエル'];
  const BOT_NAMES_EN = ['Emily', 'Michael', 'Olivia', 'James', 'Sophia', 'Noah', 'Emma', 'Liam', 'Ava', 'Ethan',
    'Mia', 'Jacob', 'Isabella', 'Mason', 'Charlotte', 'Lucas', 'Amelia', 'Benjamin', 'Harper', 'Logan',
    'Evelyn', 'Alexander', 'Abigail', 'Daniel', 'Emilia', 'Henry', 'Ella', 'Jackson', 'Grace', 'Samuel'];
  const DEFAULTS = { categories: ['basic', 'climate', 'religion', 'society'], rounds: 7, hand_size: 8, show_names: false, timer: 30, max_star: 3, public: false, rule: 'survival' };
  const HP = 100, CLOSE = 10, MID = 40, DMG = { close: 5, mid: 10, far: 25 }, MAX_ROUNDS = 20, REVEAL_S = 8, MAX_PLAYERS = 8;   // server.py と同じ数
  const QKEY = 'geoking_offline_games', PKEY = 'geoking_offline_rate';   // 送るもの（つながったら送る試合）と、仮のレート
  const ls = {
    get: (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del: (k) => { try { localStorage.removeItem(k); } catch {} },
  };
  const now = () => Date.now() / 1000;
  const rnd = (n) => Math.floor(Math.random() * n);
  const any = (a) => a[rnd(a.length)];
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  // 国の値は、その指標の表示桁で丸めて比べる（server の round_value と同じ）。世界順位は、データのある国の中で自分より良い国の数 + 1
  const rv = (key, v) => (v == null ? null : +(+v).toFixed(META.fields[key].dec));
  const world = {};
  const worldValues = (key) => world[key] || (world[key] = Object.values(META.countries).map((c) => rv(key, c[key])).filter((v) => v != null));

  let active = false, room = null, sock = null;

  class Room {
    constructor(name) {
      this.code = 'OFFLINE'; this.host = 'me';
      this.players = {}; this.order = [];
      this.settings = { ...DEFAULTS, categories: [...DEFAULTS.categories] };
      this.phase = 'lobby'; this.round = 0; this.prompts = []; this.reveal = null; this.chat = [];
      this.deck = []; this.history = []; this.final = null; this.rateMe = null; this.rated = false;
      this.deadline = null; this.nextAt = null; this.timers = [];
      this.add('me', name, false);
    }
    add(pid, name, isBot, nameEn = null) {
      this.players[pid] = { pid, name, name_en: nameEn, isBot, hand: [], score: 0, won: [], pick: null, selecting: null, hp: null, outRound: null, newCard: null };
      this.order.push(pid);
    }
    addBot() {
      const used = new Set(Object.values(this.players).map((p) => p.name)), free = BOT_NAMES.filter((x) => !used.has(x));
      const name = any(free.length ? free : BOT_NAMES);
      this.add('bot_' + uid().slice(0, 6), name, true, BOT_NAMES_EN[BOT_NAMES.indexOf(name)]);
    }
    survival() { return this.settings.rule === 'survival'; }
    alive() { return this.order.map((x) => this.players[x]).filter((p) => !p.outRound); }
    later(ms, fn) { this.timers.push(setTimeout(fn, ms)); }
    stop() { this.timers.forEach(clearTimeout); this.timers = []; }
    currentPrompt() { return this.round > 0 && this.round <= this.prompts.length ? this.prompts[this.round - 1] : null; }

    start() {
      const s = this.settings, rounds = this.survival() ? MAX_ROUNDS : s.rounds;
      let pool = META.prompts.filter((p) => s.categories.includes(p.cat) && p.star <= s.max_star);
      if (!pool.length) pool = META.prompts.filter((p) => s.categories.includes(p.cat));
      if (!pool.length) pool = [...META.prompts];
      while (pool.length < rounds) pool = pool.concat(pool);
      this.prompts = shuffle([...pool]).slice(0, rounds);
      const deck = shuffle(Object.keys(META.countries));
      for (const pid of this.order) {
        const p = this.players[pid];
        p.hand = deck.splice(-s.hand_size);
        Object.assign(p, { score: 0, won: [], pick: null, selecting: null, hp: this.survival() ? HP : null, outRound: null, newCard: null });
      }
      this.deck = deck;
      Object.assign(this, { history: [], final: null, rateMe: null, rated: false, round: 0 });
      this.beginRound();
    }
    beginRound() {
      this.round++; this.phase = 'pick'; this.reveal = null; this.nextAt = null;
      for (const p of Object.values(this.players)) { p.pick = null; p.selecting = null; }
      this.deadline = this.settings.timer ? now() + this.settings.timer : null;
      const r = this.round;
      if (this.deadline) this.later(this.settings.timer * 1000, () => {   // 時間切れ: 出していない人は手札からでたらめに（server と同じ）
        if (this.phase !== 'pick' || this.round !== r) return;
        for (const p of Object.values(this.players)) if (p.pick == null && p.hand.length && !p.outRound) p.pick = any(p.hand);
        this.doReveal(); emit();
      });
      let wait = 0;   // ボットは 0.6〜1.8 秒ずつ考えてから、手札からでたらめに出す（server の bots_play と同じ）
      for (const p of Object.values(this.players)) {
        if (!p.isBot || p.outRound || !p.hand.length) continue;
        wait += 600 + rnd(1200);
        this.later(wait, () => {
          if (this.phase !== 'pick' || this.round !== r || p.pick != null) return;
          p.pick = any(p.hand);
          if (this.allPicked()) { this.doReveal(); } emit();
        });
      }
    }
    allPicked() { return Object.values(this.players).every((p) => p.pick != null || p.outRound || !p.hand.length); }

    doReveal() {
      const pr = this.currentPrompt(), key = pr.key, dir = pr.dir, surv = this.survival();
      if (surv) for (const p of this.alive()) if (p.pick == null && p.hand.length) p.pick = any(p.hand);
      const rows = [];
      for (const pid of this.order) {
        const p = this.players[pid];
        if (p.pick == null) continue;
        const v = rv(key, META.countries[p.pick][key]);
        const wr = v == null ? null : 1 + worldValues(key).filter((x) => (dir === 'max' ? x > v : x < v)).length;
        rows.push({ pid, name: p.name, name_en: p.name_en, card: p.pick, value: v == null ? 0 : v, missing: v == null, world_rank: wr, world_total: worldValues(key).length });
      }
      const valid = rows.filter((r) => !r.missing).sort((a, b) => (dir === 'max' ? b.value - a.value : a.value - b.value));
      const n = rows.length;
      let rank = 0, prev = {};
      valid.forEach((r, i) => { if (r.value !== prev) { rank = i + 1; prev = r.value; } r.rank = rank; });
      const anyone = rows.some((r) => !r.missing), best = (rows.find((r) => r.rank === 1) || {}).world_rank;
      for (const r of rows) {
        if (r.rank === undefined) r.rank = null;
        r.winner = r.rank === 1;
        const p = this.players[r.pid];
        if (surv) {   // バトル: 1位は減らない。ほかは1位の国旗との世界順位の差で3段階（server と同じ）
          const gap = r.world_rank == null || best == null ? null : r.world_rank - best;
          let dmg = 0, tier = null;
          if (anyone && n >= 2 && r.rank !== 1) {
            tier = gap == null || gap > MID ? 'far' : gap > CLOSE ? 'mid' : 'close';
            dmg = DMG[tier];
          }
          Object.assign(r, { gap, close: tier === 'close', points: null, damage: dmg, hp_before: p.hp || 0 });
          p.hp = Math.max(0, (p.hp || 0) - dmg);
          r.hp = p.hp; r.out = p.hp === 0;
          if (r.out) p.outRound = this.round;
        } else {
          r.points = r.rank == null ? 1 : n - r.rank + 1;
          p.score += r.points;
        }
        if (r.winner) p.won.push(pr.id);
      }
      for (const p of Object.values(this.players)) {
        const i = p.hand.indexOf(p.pick);
        if (i >= 0) p.hand.splice(i, 1);
        if (surv && p.outRound) p.hand = [];
      }
      this.reveal = { prompt: pr, rows: rows.sort((a, b) => (a.rank == null) - (b.rank == null) || (a.rank || 0) - (b.rank || 0)) };
      if (surv) { this.reveal.alive = this.alive().length; this.reveal.last = this.reveal.alive <= 1 || this.round >= this.prompts.length; }
      this.history.push({ round: this.round, ...this.reveal });
      this.phase = 'reveal'; this.deadline = null; this.nextAt = now() + REVEAL_S;
      const r = this.round;
      this.later(REVEAL_S * 1000, () => { if (this.phase === 'reveal' && this.round === r) { this.nextRound(); emit(); } });
    }
    nextRound() {
      if (this.survival()) {
        if (this.alive().length <= 1 || this.round >= this.prompts.length) return this.finish();
        for (const p of Object.values(this.players)) p.newCard = null;
        for (const p of this.alive()) p.newCard = this.draw(p);
        return this.beginRound();
      }
      if (this.round >= this.prompts.length) this.finish(); else this.beginRound();
    }
    draw(p) {   // 山札から1枚。なくなったら、誰の手札にもない国で作り直す
      if (!this.deck.length) {
        const held = new Set(Object.values(this.players).flatMap((x) => x.hand));
        this.deck = shuffle(Object.keys(META.countries).filter((c) => !held.has(c)));
      }
      const c = this.deck.pop();
      if (c) p.hand.push(c);
      return c || null;
    }
    finish() {
      this.phase = 'end'; this.deadline = null; this.nextAt = null;
      if (this.survival()) {
        const es = this.order.map((x) => this.players[x]).map((p) => ({ pid: p.pid, name: p.name, name_en: p.name_en, is_bot: p.isBot, hp: p.hp || 0, out_round: p.outRound }));
        const key = (e) => (e.out_round ? [1, -e.out_round] : [0, -e.hp]);
        es.sort((a, b) => key(a)[0] - key(b)[0] || key(a)[1] - key(b)[1]);
        let place = 0, prev = '';
        es.forEach((e, i) => { const k = key(e).join(); if (k !== prev) { place = i + 1; prev = k; } e.place = place; e.score = e.out_round ? 0 : e.hp; });
        this.final = es;
        this.rateMe = rate(this);
      } else {
        this.final = this.order.map((x) => this.players[x]).map((p) => ({ pid: p.pid, name: p.name, name_en: p.name_en, score: p.score, is_bot: p.isBot })).sort((a, b) => b.score - a.score);
      }
    }
    toLobby() {
      this.stop();
      Object.assign(this, { phase: 'lobby', round: 0, reveal: null, nextAt: null, deadline: null, history: [], prompts: [], final: null, rateMe: null, rated: false });
      for (const p of Object.values(this.players)) Object.assign(p, { hand: [], pick: null, selecting: null, score: 0, won: [], hp: null, outRound: null, newCard: null });
    }
    state() {   // server の state_for と同じ形（自分は 'me'）
      const me = this.players.me, ph = this.phase;
      return {
        type: 'state', room: this.code, title: t('off_room'), title_raw: t('off_room'), host: this.host, you: 'me', token: null, offline: true,
        phase: ph, round: this.round, total_rounds: this.prompts.length || this.settings.rounds, settings: { ...this.settings },
        players: this.order.map((x) => this.players[x]).map((p) => ({ pid: p.pid, name: p.name, name_en: p.name_en, score: p.score, is_bot: p.isBot, connected: true,
          picked: p.pick != null, won: p.won, spectator: false, hand_count: p.hand.length, hp: p.hp, out_round: p.outRound, rate: null })),
        prompt: ph === 'pick' || ph === 'reveal' ? this.currentPrompt() : null,
        hand: [...me.hand], hands: Object.fromEntries(this.order.map((x) => [x, [...this.players[x].hand]])),
        live: me.outRound && ph === 'pick' ? Object.fromEntries(this.alive().map((p) => [p.pid, { selecting: p.selecting, pick: p.pick }])) : null,
        new_card: ph === 'pick' ? me.newCard : null,
        surv: this.survival() ? { hp: HP, max_damage: DMG.far } : null,
        history: ph === 'end' ? this.history : null, final: ph === 'end' ? this.final : null,
        rate_me: ph === 'end' ? this.rateMe : null, rate_copy: null,
        leftover: ph === 'end' ? Object.fromEntries(this.order.filter((x) => this.players[x].hand.length).map((x) => [x, [...this.players[x].hand]])) : null,
        my_pick: me.pick, reveal: this.reveal, deadline: this.deadline, next_at: ph === 'reveal' ? this.nextAt : null,
        chat: this.chat.slice(-30), muted: [],
      };
    }
    handle(m) {   // 画面から届いた指示（server の ws の処理と同じ。ホストはいつも自分）
      const me = this.players.me;
      switch (m.type) {
        case 'ping': return reply({ type: 'pong' });
        case 'settings':
          if (this.phase !== 'lobby' || !m.settings) return;
          for (const k of ['rule', 'timer', 'hand_size', 'rounds', 'max_star', 'show_names', 'categories']) if (k in m.settings) this.settings[k] = m.settings[k];
          if (!['points', 'survival'].includes(this.settings.rule)) this.settings.rule = 'survival';
          if (this.settings.hand_size < this.settings.rounds) this.settings.hand_size = this.settings.rounds + 1;
          return emit();
        case 'add_bot':
          if (this.phase === 'lobby' && this.order.length < MAX_PLAYERS) { this.addBot(); emit(); }
          return;
        case 'kick':
          if (m.pid && m.pid !== 'me' && this.players[m.pid]) { delete this.players[m.pid]; this.order = this.order.filter((x) => x !== m.pid); emit(); }
          return;
        case 'start':
          if (this.phase !== 'lobby' && this.phase !== 'end') return;
          this.stop();
          if (this.order.length < 2) this.addBot();   // ひとりなら、ボットを1体入れて始める
          this.start(); return emit();
        case 'selecting':
          if (this.phase === 'pick') me.selecting = me.hand.includes(m.card) ? m.card : null;
          return;
        case 'pick':
          if (this.phase !== 'pick' || me.outRound || !me.hand.includes(m.card)) return;
          me.pick = m.card;
          if (this.allPicked()) this.doReveal();
          return emit();
        case 'chat':
          if (m.text) { this.chat.push({ name: me.name, pid: 'me', text: String(m.text).slice(0, 80), ts: now() }); emit(); }
          return;
        case 'to_lobby': this.toLobby(); return emit();
        case 'leave': this.stop(); room = null; return reply({ type: 'left', code: 'left', message: '部屋から退出しました' });
      }
    }
  }

  // 仮のレート（端末の控え ＋ まだ送っていないオフラインの試合）と、バトルが終わったときの動き。rating.py の apply_game と同じ式（ボットは 1,000）
  function base() {
    const p = ls.get(PKEY);
    if (p) return p;
    let c = null;
    try { c = JSON.parse(localStorage.getItem('geoking_rc') || 'null'); } catch {}
    return c ? { r: +c.r, n: +c.n, h: +c.h || 0, best: +c.best || +c.r } : { r: 1000, n: 0, h: 0, best: 1000 };
  }
  function rate(R) {
    if (R.rated) return R.rateMe;
    R.rated = true;
    const mine = R.final.find((e) => e.pid === 'me'), bots = R.final.filter((e) => e.pid !== 'me');
    if (!mine || !bots.length) return null;
    const b = base(), k = b.n < 10 ? 48 : 32, e = 1 / (1 + 10 ** ((1000 - b.r) / 400));
    const after = b.r + k * bots.reduce((s, o) => s + (mine.place < o.place ? 1 : mine.place === o.place ? 0.5 : 0) - e, 0) / bots.length;
    ls.set(PKEY, { r: after, n: b.n + 1, h: b.h, best: Math.max(b.best, after) });
    const q = ls.get(QKEY) || [];
    q.push({ id: 'o' + uid(), t: Math.round(now()), place: mine.place, bots: bots.map((o) => o.place) });
    ls.set(QKEY, q.slice(-500));
    mine.rate_before = Math.round(b.r); mine.rate_after = Math.round(after);
    return { before: Math.round(b.r), after: Math.round(after), rank_before: null, rank_after: null, total: null, h: b.h, need: 0, first: !b.n, offline: true };
  }

  // 画面とのやり取り（WebSocket と同じ形）
  function reply(msg) { setTimeout(() => { if (sock && sock.onmessage) sock.onmessage({ data: JSON.stringify(msg) }); }, 0); }
  function emit() { if (room) reply(room.state()); }
  function socket() {
    sock = { readyState: 1, onopen: null, onmessage: null, onclose: null,
      send(text) {
        let m = null;
        try { m = JSON.parse(text); } catch { return; }
        if (m.type === 'create') { if (room) room.stop(); room = new Room(String(m.name || '').slice(0, 16)); return emit(); }
        if (m.type === 'join') return room ? emit() : reply({ type: 'error', code: 'room_not_found', message: '部屋が見つかりません' });
        if (room) room.handle(m);
      },
      close() { this.readyState = 3; },
    };
    setTimeout(() => sock.onopen && sock.onopen(), 0);
    return sock;
  }

  // つながったら、ためたオフラインの試合を送る（1回に50試合まで。残りは続けて送る）。送れたらサーバーの控えに置き換える
  let syncing = false;
  async function sync() {
    const q = ls.get(QKEY) || [];
    if (!q.length || syncing || navigator.onLine === false) return;
    syncing = true;
    try {
      const r = await fetch(API + '/api/rating/offline', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...RATE.creds(), name: localStorage.getItem('geoking_name') || '', games: q.slice(0, 50) }) });
      if (!r.ok) return;
      const d = await r.json();
      const done = new Set(d.done || []), rest = (ls.get(QKEY) || []).filter((g) => !done.has(g.id));
      if (rest.length) ls.set(QKEY, rest); else { ls.del(QKEY); ls.del(PKEY); }
      RATE.saveCopy(d.copy);
      if (done.size) { RATE.refreshHome(); if (rest.length) setTimeout(sync, 500); }
    } catch {} finally { syncing = false; }
  }
  window.addEventListener('online', () => sync());

  return {
    active: () => active,
    begin() { active = true; },
    end() { active = false; if (room) room.stop(); room = null; sync(); },
    socket, sync,
    pending: () => (ls.get(QKEY) || []).length,
  };
})();
