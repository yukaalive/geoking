/* GeoKing client */
// サーバーの基点。ブラウザ版は同じサーバー（空文字）。アプリ版は index.html で window.GEOKING_SERVER に本番URLを入れる

// 効果音・振動は sfx.js（図鑑と共用）
trackVisit('game');   // 利用ログ（開始・5分ごと・離脱）


let ws = null, state = null, pendingAction = null;
let selectedCard = null, manualJoin = false;
let timerInterval = null;
let reconnectTries = 0, revealInterval = null, confettiTimer = null;
let pid = null;  // サーバーが発行する。再接続用トークンと共に sessionStorage に保持
const rejoinInfo = () => ({ pid: sessionStorage.getItem('geoking_pid'), token: sessionStorage.getItem('geoking_token') });

// ---------- 表示ユーティリティ
function show(screen) { document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden')); $('#' + screen).classList.remove('hidden'); if (screen !== 'home' && typeof stopRoomsPoll === 'function') stopRoomsPoll(); }

$('#creditsLink').onclick = (e) => {
  e.preventDefault();
  $('#modalBody').innerHTML = t('credits_html');
  $('#modal').classList.remove('hidden'); $('#modalBody').classList.remove('wide');
};
$('#modal').onclick = (e) => { if (e.target.id === 'modal') { $('#modal').classList.add('hidden'); sfx.close(); } };

// ---------- WebSocket
function connect(onOpen) {
  const base = API ? new URL(API) : location;
  const proto = base.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${base.host}/ws`);
  ws.onopen = () => { onOpen && onOpen(); };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'state') { reconnectTries = 0; state = msg; pid = msg.you; sessionStorage.setItem('geoking_room', msg.room); if (msg.token) { sessionStorage.setItem('geoking_pid', msg.you); sessionStorage.setItem('geoking_token', msg.token); } render(); }
    else if (msg.type === 'pong') { clearTimeout(pongTimer); pongTimer = null; }
    else if (msg.type === 'toast') toast(tServer('t_', msg.code, msg.message));
    else if (msg.type === 'left') { leaveToHome(tServer('l_', msg.code, msg.message)); if (ws) { ws.onclose = null; ws.close(); } }
    else if (msg.type === 'error') {
      sfx.error();
      msg.message = tServer('e_', msg.code, msg.message);
      if (msg.code === 'room_not_found' || msg.code === 'reauth_failed') {
        sessionStorage.removeItem('geoking_room'); sessionStorage.removeItem('geoking_token');
        if (state) { stopTimer(); state = null; $('#roomInfo').classList.add('hidden'); show('home'); startRoomsPoll(); }   // 部屋が消えた → ホームへ
        else if (!manualJoin) return;
      }
      toast(msg.message);
    }
  };
  ws.onclose = () => {
    if (!state) return;
    reconnectTries++;
    if (reconnectTries > 8) {   // 約1分あきらめたら停止（無限再接続ループを防ぐ）
      toast(t('conn_lost_reload')); stopTimer(); state = null; return;
    }
    if (reconnectTries > 1) toast(t('reconnecting'));
    const delay = reconnectTries === 1 ? 300 : Math.min(15000, 1000 * 2 ** (reconnectTries - 2));   // 1回目はすぐ、以降は間隔を広げる
    setTimeout(() => { if (state) connect(() => send({ type: 'join', room: state.room, name: $('#nameInput').value, ...rejoinInfo() })); }, delay);
  };
}
function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

// アプリを切り替えて戻った時（LINE など）: iOS は WebSocket が死んでも onclose が来ないことがある。
// ping を送って 2.5 秒以内に返事がなければ切れたとみなして、待ち時間なしでつなぎ直す
let pongTimer = null;
function ensureConnection() {
  if (!state) return;
  reconnectTries = 0;
  if (!ws || ws.readyState !== 1) { if (ws) { ws.onclose = null; try { ws.close(); } catch {} } return reconnectNow(); }
  clearTimeout(pongTimer);
  pongTimer = setTimeout(() => { if (ws) { ws.onclose = null; try { ws.close(); } catch {} } reconnectNow(); }, 2500);
  send({ type: 'ping' });
}
function reconnectNow() {
  if (!state) return;
  connect(() => send({ type: 'join', room: state.room, name: $('#nameInput').value || localStorage.getItem('geoking_name') || '', ...rejoinInfo() }));
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') ensureConnection(); });
window.addEventListener('focus', () => ensureConnection());
window.addEventListener('pageshow', () => ensureConnection());
window.addEventListener('online', () => ensureConnection());

// ---------- ホーム
// 名前は必須。空なら null を返して呼び出し側で止める
function myName() {
  const n = $('#nameInput').value.trim();
  if (!n) { toast(t('enter_name')); $('#nameInput').focus(); return null; }
  localStorage.setItem('geoking_name', n); return n;
}
$('#nameInput').value = localStorage.getItem('geoking_name') || '';
$('#nameInput').addEventListener('focus', function () { this.select(); });   // 前回の名前が入っていても、そのまま打てば置き換わる
$('#createBtn').onclick = () => { const name = myName(); if (!name) return; manualJoin = true; connect(() => send({ type: 'create', name })); };
$('#joinBtn').onclick = () => {
  const raw = $('#codeInput').value.trim(); if (!raw) return toast(t('enter_room_name'));
  const name = myName(); if (!name) return; manualJoin = true;
  // 4文字の英数字なら招待コード、それ以外は部屋の名前として探す（両方送ってサーバーに任せる）
  const asCode = /^[A-Za-z0-9]{4}$/.test(raw) ? raw.toUpperCase() : '';
  connect(() => send({ type: 'join', room: asCode, room_name: raw, name }));
};
$('#codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('#joinBtn').click(); });

// ---------- ロビー操作
function pushSettings() {
  if (!state || state.host !== pid) return;
  send({ type: 'settings', settings: { public: $('#setPublic').checked, title: $('#setTitle').value.trim() } });
}
['#setPublic', '#setTitle'].forEach(s => $(s).addEventListener('change', pushSettings));
$('#addBotBtn').onclick = () => send({ type: 'add_bot' });
$('#lobbyBtn').onclick = () => { if (confirm(t('confirm_to_lobby'))) send({ type: 'to_lobby' }); };
$('#leaveBtn').onclick = () => { if (confirm(t('confirm_leave'))) send({ type: 'leave' }); };
function leaveToHome(message) {
  stopTimer(); prevKey = ''; prevChatLen = 0; prevRoom = null; prevPlayers = null; seenChat.clear(); chatPrimed = false;
  sessionStorage.removeItem('geoking_room'); sessionStorage.removeItem('geoking_token'); sessionStorage.removeItem('geoking_pid');
  state = null; stopTimer(); $('#roomInfo').classList.add('hidden'); show('home'); startRoomsPoll();
  sfx.leave();
  if (message) toast(message);
}
$('#startBtn').onclick = () => send({ type: 'start' });
$('#rematchBtn').onclick = () => send({ type: 'start' });
$('#toLobbyBtn').onclick = () => send({ type: 'to_lobby' });
$('#chatForm').onsubmit = (e) => { e.preventDefault(); const t = $('#chatInput').value.trim(); if (t) { send({ type: 'chat', text: t }); sfx.send(); } $('#chatInput').value = ''; };
// スマホ：キーボードが出ると入力欄が隠れるので、入力中はキーボードの真上に固定表示する
(function mobileComposer() {
  const form = $('#chatForm'), input = $('#chatInput');
  const isTouch = () => matchMedia('(pointer:coarse)').matches || matchMedia('(max-width:900px)').matches;
  const place = () => {
    if (!document.body.classList.contains('composing')) return;
    const vv = window.visualViewport;
    const h = form.offsetHeight;
    // visualViewport＝キーボードを除いた見えている範囲。その下端に合わせる
    form.style.top = vv ? (vv.offsetTop + vv.height - h) + 'px' : `calc(100% - ${h}px)`;
  };
  input.addEventListener('focus', () => {
    if (!isTouch()) return;
    document.body.classList.add('composing');
    place(); setTimeout(place, 50); setTimeout(place, 300); setTimeout(place, 600);   // キーボードが出きるまで数回合わせる
  });
  // 送信ボタンを押してもフォーカスを外さない（外れると欄が元の位置に戻ってタップが空振りする）
  form.querySelector('button').addEventListener('pointerdown', (e) => e.preventDefault());
  form.querySelector('button').addEventListener('mousedown', (e) => e.preventDefault());
  input.addEventListener('blur', () => setTimeout(() => {
    if (document.activeElement === input) return;
    document.body.classList.remove('composing'); form.style.top = '';
  }, 150));
  if (window.visualViewport) { visualViewport.addEventListener('resize', place); visualViewport.addEventListener('scroll', place); }
  window.addEventListener('resize', place);
})();

$('#copyLink').onclick = async () => {
  const url = `${API || location.origin}/static/index.html?room=${state.room}`;
  try { await navigator.clipboard.writeText(url); toast(t('link_copied')); } catch { prompt(t('share_this_link'), url); }
};

// ---------- 描画
let prevKey = '', prevChatLen = 0, lastTickSec = null, prevPlayers = null, prevRoom = null;
const seenChat = new Set(); let chatPrimed = false;   // 画面を流れるチャットの重複防止

// チャット1件の表示名と本文（システム通知は言語に合わせる。ボットは英語名も持つ）
const isSystem = (c) => !!c.key || c.name === 'システム';
function chatName(c) { if (isSystem(c)) return t('system'); const p = state && state.players.find(x => x.pid === c.pid); return p ? pname(p) : c.name; }
function chatText(c) { return c.key ? t('sys_' + c.key, c.params || {}) : c.text; }
const byPid = (id) => state && state.players.find(x => x.pid === id);
const rowName = (row) => { const p = byPid(row.pid); return p ? pname(p) : ((LANG === 'en' && row.name_en) ? row.name_en : row.name); };
const joinNames = (arr) => arr.join(t('names_sep'));
// チャットを画面の下から上へ流す（名前＋本文）
function floatChat(c) {
  const me = state && state.players.find(p => p.pid === pid);
  const d = el('div', 'floatmsg' + (isSystem(c) ? ' sys' : (me && c.pid === pid ? ' me' : '')));
  d.innerHTML = `<b>${escapeHtml(chatName(c))}</b>${escapeHtml(chatText(c))}`;
  d.style.setProperty('--x', (4 + Math.random() * 50).toFixed(0) + '%');
  const olds = document.querySelectorAll('.floatmsg'); if (olds.length >= 8) olds[0].remove();
  document.body.appendChild(d);
  d.addEventListener('animationend', () => d.remove());
}
// 言語切り替え時: 今の画面を作り直す
window.onLangChange = () => { document.title = t('app_title'); if (typeof RANK_CACHE_CLEAR === 'function') RANK_CACHE_CLEAR(); if (state) render(); else loadRooms(); renderPrefs(); };

function playTransitions() {
  const key = `${state.room}:${state.phase}:${state.round}`;
  // 部屋に入った／人が増えた・減った
  if (state.room !== prevRoom) { sfx.enter(); prevRoom = state.room; prevPlayers = state.players.length; }
  else if (prevPlayers != null && state.players.length !== prevPlayers) { (state.players.length > prevPlayers ? sfx.joined : sfx.left)(); prevPlayers = state.players.length; }
  if (key !== prevKey) {
    if (state.phase === 'pick' && state.round === 1 && !prevKey.endsWith(':pick:1')) { sfx.start(); lastTickSec = null; }
    else if (state.phase === 'pick') { sfx.round(); lastTickSec = null; }
    else if (state.phase === 'reveal' && state.reveal) {
      sfx.reveal();
      const me = state.reveal.rows.find(r => r.pid === pid);
      const isSpectator = !!state.players.find(p => p.pid === pid && p.spectator);
      if (me && !isSpectator) setTimeout(() => (me.winner ? sfx.win() : sfx.lose()), 350);
    } else if (state.phase === 'end') {
      const mine = state.players.find(p => p.pid === pid);
      const scores = state.players.filter(p => !p.spectator).map(p => p.score);
      const top = scores.length ? Math.max(...scores) : 0;
      setTimeout(() => (mine && !mine.spectator && mine.score === top ? sfx.champion() : sfx.reveal()), 200);
    }
    prevKey = key;
  }
  const chat = state.chat || [];
  let ding = false;
  for (const c of chat) {
    const k = `${c.ts}|${c.pid || ''}|${c.text}`;
    if (seenChat.has(k)) continue;
    seenChat.add(k);
    if (!chatPrimed) continue;                      // 入室時にすでにあった履歴は流さない
    floatChat(c);
    if (c.pid !== pid && !isSystem(c)) ding = true;
  }
  if (ding) sfx.chat();
  chatPrimed = true;
  if (seenChat.size > 400) seenChat.clear();
  prevChatLen = chat.length;
}

function render() {
  if (!state) return;
  playTransitions();
  const isHost = state.host === pid;
  document.body.classList.toggle('host', isHost); document.body.classList.toggle('guest', !isHost);
  $('#roomInfo').classList.remove('hidden'); $('#roomTitle').textContent = roomTitle();
  $('#lobbyBtn').classList.toggle('hidden', !(isHost && (state.phase === 'pick' || state.phase === 'reveal')));

  if (state.phase === 'lobby') { renderLobby(); show('lobby'); }
  else if (state.phase === 'pick' || state.phase === 'reveal') { renderGame(); show('game'); }
  else if (state.phase === 'end') { renderEnd(); show('end'); }
  renderChat();
}

// チャットはロビー・ゲーム・結果のどの画面でも使える。カードを今の画面のスロットへ移して描画
function renderChat() {
  const card = $('#chatCard');
  const slot = state.phase === 'lobby' ? $('#lobbyChatSlot') : state.phase === 'end' ? $('#endChatSlot') : $('#gameChatSlot');
  if (slot && card.parentElement !== slot) slot.appendChild(card);
  card.classList.remove('hidden');
  const log = $('#chatLog'); const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 10;
  log.innerHTML = (state.chat || []).map(c => `<div>${c.pid && c.pid !== pid ? `<b class="who" data-pid="${c.pid}" title="${t('report_mute')}">${escapeHtml(chatName(c))}</b>` : `<b>${escapeHtml(chatName(c))}</b>`} ${escapeHtml(chatText(c))}</div>`).join('');
  log.querySelectorAll('.who').forEach(b => b.onclick = () => showPlayerMenu(b.dataset.pid));
  if (atBottom) log.scrollTop = log.scrollHeight;
}

// 部屋名（未設定なら「〇〇の部屋」を言語に合わせて）
function roomTitle() { if (!state) return ''; if (state.title_raw) return state.title_raw; const h = byPid(state.host); return t('room_of', { name: h ? pname(h) : '' }); }

function playerTag(p) {
  let t = '';
  if (p.pid === state.host) t += `<span class="tag host">${ico('crown')}${window.t('tag_host')}</span>`;
  if (p.is_bot) t += `<span class="tag">${ico('bot')}BOT</span>`;
  if (!p.connected && !p.is_bot) t += `<span class="tag off">${window.t('tag_off')}</span>`;
  if (p.spectator) t += `<span class="tag spec">${window.t('tag_spec')}</span>`;
  if (p.pid === state.you) t += `<span class="tag">${window.t('tag_you')}</span>`;
  return t;
}

function renderLobby() {
  $('#lobbyCode').textContent = roomTitle();
  $('#playerCount').textContent = `${state.players.length} / 8`;
  const ul = $('#lobbyPlayers'); ul.innerHTML = '';
  for (const p of state.players) {
    const li = el('li', '', `<span>${escapeHtml(pname(p))}${playerTag(p)}</span>`);
    if (state.host === pid && p.pid !== pid) { const b = el('button', 'mini', t('kick')); b.onclick = () => send({ type: 'kick', pid: p.pid }); li.appendChild(b); }
    ul.appendChild(li);
  }
  const s = state.settings;
  if (document.activeElement?.closest('.settings') == null) {
    $('#setPublic').checked = s.public; $('#setTitle').value = state.title_raw || ''; $('#setTitle').placeholder = roomTitle() || t('room_title_ph');
  }
  $('#startBtn').disabled = state.players.length < 2;
  $('#startBtn').textContent = state.players.length < 2 ? t('start_need2') : t('start_rounds', { n: state.settings.rounds });
}

function renderGame() {
  const pr = state.prompt, cat = META.categories[pr.cat];
  $('#roundNum').textContent = state.round; $('#roundTotal').textContent = state.total_rounds;
  $('#promptCat').innerHTML = `${ico(cat.icon)} ${escapeHtml(catName(cat))} ／ ${t('difficulty')} ${stars(pr.star)}`;
  // 「〜が高い国は？」の「高い/低い」などを強調表示（日本語のみ）
  const m = LANG === 'ja' ? pr.text.match(/^(.*?)(大きい|小さい|多い|少ない|高い|低い|長い|短い|北|南|東|西|近い)(国は？)$/) : null;
  $('#promptText').innerHTML = m ? `${escapeHtml(m[1])}<span class="kw">${m[2]}</span>${m[3]}` : escapeHtml(pt(pr));

  // スコア
  const sl = $('#scoreList'); sl.innerHTML = '';
  for (const p of [...state.players].sort((a, b) => b.score - a.score)) {
    sl.appendChild(el('li', '', `<span>${p.pid !== pid && !p.is_bot ? `<b class="who" data-pid="${p.pid}" title="${t('report_mute')}">${escapeHtml(pname(p))}</b>` : escapeHtml(pname(p))}${playerTag(p)}</span><b>${p.spectator ? '—' : p.score + ' ' + t('pts')}${state.phase === 'pick' && !p.spectator ? (p.picked ? ico('check', 'sm status-ico') : ico('clock', 'sm status-ico')) : ''}</b>`));
  }
  sl.querySelectorAll('.who').forEach(b => b.onclick = () => showPlayerMenu(b.dataset.pid));

  if (state.phase === 'pick') {
    $('#pickArea').classList.remove('hidden'); $('#revealArea').classList.add('hidden');
    renderHand(); renderTimer();
  } else {
    $('#pickArea').classList.add('hidden'); $('#revealArea').classList.remove('hidden'); $('#timer').classList.add('hidden');
    stopTimer(); renderReveal();
  }
  if (state.phase === 'pick') {
    clearInterval(revealInterval); revealInterval = null; clearInterval(confettiTimer);
  }
}

function renderHand() {
  const hand = $('#hand'); hand.innerHTML = '';
  const me = state.players.find(p => p.pid === pid);
  const spectating = !!(me && me.spectator);
  $('#spectate').classList.toggle('hidden', !spectating);
  $('#pickTitle').classList.toggle('hidden', spectating);
  if (spectating) { renderOthersHands(); return; }
  const picked = state.my_pick;
  if (selectedCard && !state.hand.includes(selectedCard)) selectedCard = null;
  $('#pickTitle').textContent = picked
    ? t('played_msg', { card: state.settings.show_names ? '「' + countryName(picked) + '」' : t('card_word') })
    : (state.hand.length ? t('pick_hint') : t('no_hand'));
  for (const id of state.hand) {
    const cls = 'flagcard' + (id === picked ? ' picked' : '') + (id === selectedCard && id !== picked ? ' selected' : '');
    const c = el('div', cls);
    c.innerHTML = `<img src="${flagUrl(id)}" alt="${t('flag_alt')}" loading="lazy"><div class="nm">${state.settings.show_names ? countryName(id) : (id === picked ? t('played_card') : '&nbsp;')}</div>`;
    c.onclick = () => {
      if (id === picked) return;                       // すでに出しているカード
      if (selectedCard === id) { send({ type: 'pick', card: id }); selectedCard = null; sfx.confirm(); return; }   // 2回目で決定・変更
      selectedCard = id;
      sfx.select();
      send({ type: 'selecting', card: id });
      document.querySelectorAll('.flagcard').forEach(x => x.classList.remove('selected'));
      c.classList.add('selected');
      $('#pickTitle').textContent = `${picked ? t('confirm_change') : t('confirm_play')} ${t('once_more')}${state.settings.show_names ? '：' + countryName(id) : ''}`;
    };
    hand.appendChild(c);
  }
  const w = el('div', 'waiting');
  for (const p of state.players.filter(x => !x.spectator)) w.appendChild(el('span', p.picked ? 'done' : '', `${escapeHtml(p.name)}${p.picked ? ' ' + ico('check', 'sm') : ''}`));
  hand.appendChild(w); w.style.gridColumn = '1 / -1';
  renderOthersHands();
}

function renderOthersHands() {
  const box = $('#othersHands'); box.innerHTML = '';
  const others = state.players.filter(p => p.pid !== pid && !p.spectator);
  if (!others.length || !state.hands) return;
  const live = state.live;   // 観戦者にだけ届く
  box.appendChild(el('h4', '', live ? t('others_live') : t('others_hidden')));
  for (const p of others) {
    const row = el('div', 'orow' + (live ? ' live' : ''));
    const lv = live ? live[p.pid] : null;
    let bubble = '';
    if (lv) {
      const st = lv.pick ? 'go' : (lv.selecting ? 'sel' : 'think');
      bubble = `<span class="bubble ${st}">${lv.pick ? t('bubble_pick') : (lv.selecting ? t('bubble_selecting') : t('bubble_thinking'))}</span>`;
    }
    row.appendChild(el('span', 'oname', `${escapeHtml(p.name)}${!live && p.picked ? ' ' + ico('check', 'sm') : ''}${bubble}`));
    for (const id of (state.hands[p.pid] || [])) {
      const wrap = el('span', 'oflag' + (lv && lv.pick === id ? ' go' : (lv && lv.selecting === id ? ' sel' : '')));
      const img = el('img'); img.src = flagUrl(id, 80); img.alt = ''; img.title = state.settings.show_names ? countryName(id) : '';
      img.onclick = () => showCountry(id);
      wrap.appendChild(img); row.appendChild(wrap);
    }
    box.appendChild(row);
  }
}

// 世界順位を金・銀・銅で強調（1位／2〜10位／11〜30位）
function wrankTier(rank) {
  if (rank === 1) return { cls: ' gold', tag: `${ico('crown', 'sm')} ${t('world_first')}` };
  if (rank <= 10) return { cls: ' silver', tag: `${ico('trophy', 'sm')} ${t('top10')}` };
  if (rank <= 30) return { cls: ' bronze', tag: `${ico('star', 'sm')} ${t('top30')}` };
  return { cls: '', tag: '' };
}
function wrankHtml(rank, total) {
  if (!rank) return '';
  const t = wrankTier(rank);
  return `<div class="wrank${t.cls}">${t.tag ? `<em>${t.tag}</em>` : ''}${window.t('world_rank', { n: rank, total })}</div>`;
}
// 紙吹雪：金は多め、銀は中くらい、銅は少しだけ
const CONFETTI = {
  gold: { n: 60, cols: ['#f4c542', '#e8674a', '#1f6f4a', '#fff', '#ffd25e'] },
  silver: { n: 25, cols: ['#d5dae2', '#fff', '#9ca3af', '#f4c542'] },
  bronze: { n: 10, cols: ['#e0a878', '#c47a3a', '#fff'] },
};
function spawnConfetti(target, tier, scale = 1) {
  const cfg = CONFETTI[tier]; if (!cfg || !target || !target.isConnected) return;
  const box = el('div', 'confetti');
  for (let i = 0; i < Math.round(cfg.n * scale); i++) {
    const s = document.createElement('i');
    const a = Math.random() * Math.PI * 2, r = 80 + Math.random() * 140;
    s.style.setProperty('--dx', (Math.cos(a) * r).toFixed(0) + 'px');
    s.style.setProperty('--dy', (Math.sin(a) * r * 0.6 - 60 + Math.random() * 120).toFixed(0) + 'px');
    s.style.setProperty('--rot', (Math.random() * 720 - 360).toFixed(0) + 'deg');
    s.style.background = cfg.cols[i % cfg.cols.length];
    s.style.animationDelay = (Math.random() * 0.15).toFixed(2) + 's';
    box.appendChild(s);
  }
  target.appendChild(box);
  setTimeout(() => box.remove(), 1800);
}
function renderReveal() {
  const r = state.reveal, F = META.fields[r.prompt.key];
  const box = $('#revealRows'); box.innerHTML = '';
  r.rows.forEach((row, i) => {
    const c = META.countries[row.card];
    const d = el('div', 'rev' + (row.winner ? ' win' : ''));
    d.style.animationDelay = (i * 0.25) + 's';
    d.innerHTML = `<div class="crown">${row.winner ? ico('crown') : (row.rank ? t('rank_n', { n: row.rank }) : '—')}</div><img src="${flagUrl(row.card)}" alt=""><div class="who">${escapeHtml(rowName(row))}${row.pid === pid ? t('you_paren') : ''}</div><div class="country">${coff(c)}${r.prompt.key === 'kana_rank' ? `<small>${t('reading')}${c.name_kana}</small>` : (r.prompt.key === 'name_len' ? `<small>${t('reading')}${c.official_kana}</small>` : (coff(c) !== cname(c) ? `<small>${cname(c)}</small>` : ''))}</div><div class="val">${fmtValue(row.value, F.fmt)}</div><div class="rank">${flabel(F)}${row.missing ? t('missing_zero') : ''}</div>${wrankHtml(row.world_rank, row.world_total)}`;
    d.style.cursor = 'pointer'; d.onclick = () => showCountry(row.card);
    box.appendChild(d);
    const tier = wrankTier(row.world_rank || 999).cls.trim();
    if (tier) { d.dataset.tier = tier; setTimeout(() => spawnConfetti(d.querySelector('.wrank'), tier), i * 250 + 350); }
  });
  // 結果画面が出ている間は紙吹雪を繰り返す（最初の大きな一発のあと、少し控えめに）
  clearInterval(confettiTimer);
  confettiTimer = setInterval(() => {
    if (!state || state.phase !== 'reveal' || !box.isConnected) { clearInterval(confettiTimer); return; }
    box.querySelectorAll('.rev[data-tier]').forEach(d => spawnConfetti(d.querySelector('.wrank'), d.dataset.tier, 0.6));
  }, 1300);
  const winners = r.rows.filter(x => x.winner).map(x => rowName(x));
  const label = state.round >= state.total_rounds ? t('final_label') : t('next_round', { n: state.round + 1, total: state.total_rounds });
  const tick = () => {
    if (!state) { stopTimer(); return; }
    const left = state.next_at ? Math.max(0, Math.ceil(state.next_at - Date.now() / 1000)) : 0;
    $('#nextCountdown').textContent = t('next_in', { sec: left, label });
  };
  tick(); revealInterval = setInterval(tick, 250);
  $('#revealArea').querySelector('h3').textContent = winners.length ? t('won_point', { names: joinNames(winners) }) : t('draw_nodata');
}

function renderEnd() {
  const ol = $('#finalList'); ol.innerHTML = '';
  const sorted = state.players.filter(p => !p.spectator).sort((a, b) => b.score - a.score);
  const top = sorted[0]?.score;
  sorted.forEach((p, i) => {
    const won = p.won.map(id => { const pr = META.prompts.find(x => x.id === id); return pr ? (LANG === 'ja' ? pr.text.replace('は？', '') : pt(pr)) : null; }).filter(Boolean);
    ol.appendChild(el('li', '', `${p.score === top ? ico('crown') + ' ' : ''}${escapeHtml(pname(p))}${p.pid === pid ? t('you_paren') : ''} — <b>${p.score} ${t('pts')}</b><div class="muted small">${won.join(LANG === 'ja' ? '／' : ' / ') || '—'}</div>`));
  });
  const champs = sorted.filter(p => p.score === top).map(p => pname(p));
  $('#endTitle').innerHTML = `${ico('trophy', 'big')} ${t('is_champion', { names: escapeHtml(joinNames(champs)) })}`;
  renderHistory();
}

function renderHistory() {
  const box = $('#historyList'); box.innerHTML = '';
  const history = state.history || [], left = state.leftover || {};
  // 横軸はプレイヤーで固定（観戦者は除く）。途中で抜けた人も履歴にいれば列を作る
  const cols = [];
  const addCol = (pid, name) => { if (pid && !cols.find(c => c.pid === pid)) cols.push({ pid, name }); };
  for (const p of state.players) if (!p.spectator) addCol(p.pid, pname(p));
  for (const h of history) for (const r of h.rows) addCol(r.pid, rowName(r));
  if (!cols.length) return;
  const wrap = el('div', 'htablewrap');
  const table = el('div', 'htable'); table.style.gridTemplateColumns = `120px repeat(${cols.length}, 150px)`;   // 列幅は固定（人数で拡大しない）
  // 見出し行
  table.appendChild(el('div', 'hth corner', t('prompt_col')));
  for (const c of cols) table.appendChild(el('div', 'hth' + (c.pid === pid ? ' me' : ''), `${ico('person', 'sm')} ${escapeHtml(c.name)}${c.pid === pid ? `<small>${t('you_paren')}</small>` : ''}`));
  const cardHtml = (id, extra = '') => `<img src="${flagUrl(id, 160)}" alt=""><div class="cn">${coff(META.countries[id])}</div>${extra}`;
  for (const h of history) {
    const F = META.fields[h.prompt.key];
    table.appendChild(el('div', 'hth row', `<b>${t('round_short', { n: h.round })}</b>${escapeHtml(pt(h.prompt))}`));
    for (const c of cols) {
      const r = h.rows.find(x => x.pid === c.pid);
      if (!r) { table.appendChild(el('div', 'hcard empty', '—')); continue; }
      const card = el('div', 'hcard' + (r.winner ? ' win' : ''));
      const t = r.world_rank ? wrankTier(r.world_rank).cls : '';
      card.innerHTML = cardHtml(r.card, `<div class="val">${r.winner ? ico('crown', 'sm') + ' ' : ''}${fmtValue(r.value, F.fmt)}</div>${r.world_rank ? `<div class="who${t ? ' hot' + t : ''}">${window.t('world_rank_plain', { n: r.world_rank, total: r.world_total })}</div>` : ''}`);
      card.onclick = () => showCountry(r.card);
      table.appendChild(card);
    }
  }
  // 使わなかった手札（各プレイヤーに1枚以上残る）
  if (Object.keys(left).length) {
    table.appendChild(el('div', 'hth row', t('leftover_row')));
    for (const c of cols) {
      const ids = left[c.pid] || [];
      if (!ids.length) { table.appendChild(el('div', 'hcard empty', '—')); continue; }
      const cell = el('div', 'hcard rest');
      cell.innerHTML = ids.map(id => `<div class="restcard" data-id="${id}">${cardHtml(id)}</div>`).join('');
      cell.querySelectorAll('.restcard').forEach(x => x.onclick = () => showCountry(x.dataset.id));
      table.appendChild(cell);
    }
  }
  wrap.appendChild(table); box.appendChild(wrap);
}

// ---------- タイマー
function renderTimer() {
  stopTimer();
  if (!state.deadline) { $('#timer').classList.add('hidden'); return; }
  $('#timer').classList.remove('hidden');
  const tick = () => {
    if (!state || !state.deadline) { stopTimer(); return; }
    const left = Math.max(0, Math.ceil(state.deadline - Date.now() / 1000));
    $('#timer').textContent = t('sec', { n: left }); $('#timer').classList.toggle('urgent', left <= 10);
    if (left <= 10 && left > 0 && left !== lastTickSec && state.my_pick == null) { (left <= 3 ? sfx.tickFast : sfx.tick)(); lastTickSec = left; }   // 残り10秒からカウント音（残り3秒は高く）
  };
  tick(); timerInterval = setInterval(tick, 250);
}
function stopTimer() { clearInterval(timerInterval); timerInterval = null; clearInterval(revealInterval); revealInterval = null; }

// ---------- 公開部屋一覧
async function loadRooms() {
  const ul = $('#publicRoomList');
  try {
    const { rooms } = await (await fetch(API + '/api/rooms')).json();
    ul.innerHTML = '';
    if (!rooms.length) { ul.innerHTML = `<li class="muted">${t('no_public_rooms')}</li>`; return; }
    for (const r of rooms) {
      const cats = r.categories.map(c => ico(META.categories[c]?.icon || 'flag', 'sm')).join('');
      const status = r.phase === 'lobby' ? `<span class="tag">${ico('clock')}${t('recruiting')}</span>` : `<span class="tag live">${ico('cards')}${t('in_progress', { n: r.round })}</span>`;
      const li = el('li', '', `<span><b>${escapeHtml(r.title_raw || t('room_of', { name: r.host }))}</b> <span class="muted small">${t('by')} ${escapeHtml(r.host)}</span> ${status} <span class="tag">${t('players_n', { n: r.players })}</span> <span class="tag">${t('rounds_short', { n: r.rounds })} ${cats}</span></span>`);
      const b = el('button', 'mini primary', t('join')); b.onclick = () => { $('#codeInput').value = r.room; $('#joinBtn').click(); };
      li.appendChild(b); ul.appendChild(li);
    }
  } catch { ul.innerHTML = `<li class="muted">${t('rooms_fetch_failed')}</li>`; }
}
$('#refreshRooms').onclick = loadRooms;
let roomsPoll = null;
function startRoomsPoll() { stopRoomsPoll(); loadRooms(); roomsPoll = setInterval(() => { if (!$('#home').classList.contains('hidden')) loadRooms(); }, 5000); }
function stopRoomsPoll() { clearInterval(roomsPoll); roomsPoll = null; }

// ---------- 通報・ミュート
function showPlayerMenu(targetPid) {
  const p = state.players.find(x => x.pid === targetPid); if (!p) return;
  const muted = (state.muted || []).includes(targetPid);
  $('#modalBody').classList.remove('wide');
  $('#modalBody').innerHTML = `<h2 style="margin-top:0">${escapeHtml(pname(p))}${t('san')}</h2>
    <p class="small muted">${t('menu_note')}</p>
    <div class="row"><button id="pmMute">${muted ? t('unmute') : t('mute')}</button><button id="pmReport" class="danger">${t('report')}</button></div>
    <div id="pmReasons" class="row hidden"><span class="small">${t('reason')}</span><button class="mini" data-r="暴言・差別">${t('r_abuse')}</button><button class="mini" data-r="迷惑行為">${t('r_harass')}</button><button class="mini" data-r="個人情報・勧誘">${t('r_personal')}</button><button class="mini" data-r="その他">${t('r_other')}</button></div>`;
  $('#modal').classList.remove('hidden');
  $('#pmMute').onclick = () => { send({ type: 'mute', pid: targetPid, on: !muted }); $('#modal').classList.add('hidden'); toast(muted ? t('unmuted_toast') : t('muted_toast')); };
  $('#pmReport').onclick = () => $('#pmReasons').classList.remove('hidden');
  $('#pmReasons').querySelectorAll('button').forEach(b => b.onclick = () => { send({ type: 'report', pid: targetPid, reason: b.dataset.r }); $('#modal').classList.add('hidden'); });
}

// ---------- 招待リンクの確認ポップアップ
async function showInvite(code) {
  let info = null;
  try { const res = await fetch(`${API}/api/room/${code}`); if (res.ok) info = await res.json(); } catch {}
  if (!info) { toast(t('room_not_found_toast')); return; }
  const status = info.phase === 'lobby' ? t('status_recruiting') : (info.phase === 'end' ? t('status_end') : t('status_round', { n: info.round }));
  const saved = localStorage.getItem('geoking_name') || '';
  $('#modalBody').innerHTML = `
    <h2 style="margin-top:0">${ico('door')} ${t('join_room_q')}</h2>
    <div class="invitebox">
      <div class="invtitle">${escapeHtml(info.title)}</div>
      <div class="muted small">${t('host_label')}: ${escapeHtml(info.host)} ／ ${info.players} / ${info.max}${t('people')} ／ <span class="tag">${status}</span></div>
      <div class="small" style="margin-top:6px">${info.names.map(nm => `<span class="tag">${escapeHtml(nm)}</span>`).join(' ')}</div>
    </div>
    <label>${t('your_name')}<input id="inviteName" maxlength="16" placeholder="${t('name_ph')}" value="${escapeHtml(saved)}"></label>
    <div class="row"><button id="inviteJoin" class="primary">${t('join')}</button><button id="inviteCancel">${t('invite_cancel')}</button></div>`;
  $('#modalBody').classList.remove('wide'); $('#modal').classList.remove('hidden');
  const close = () => $('#modal').classList.add('hidden');
  $('#inviteCancel').onclick = close;
  const go = () => {
    const name = $('#inviteName').value.trim();
    if (!name) { toast(t('enter_name')); $('#inviteName').focus(); return; }
    localStorage.setItem('geoking_name', name); $('#nameInput').value = name; close();
    manualJoin = true; connect(() => send({ type: 'join', room: code, name }));
  };
  $('#inviteJoin').onclick = go;
  $('#inviteName').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  if (!saved) $('#inviteName').focus();
}

// ---------- 起動
(async function init() {
  META = await (await fetch(API + '/api/meta')).json();
  const q = new URLSearchParams(location.search);
  const room = q.get('room') || sessionStorage.getItem('geoking_room');
  if (q.get('room')) { $('#codeInput').value = q.get('room').toUpperCase(); }
  if (q.get('room') && sessionStorage.getItem('geoking_room') !== q.get('room').toUpperCase()) {
    show('home'); startRoomsPoll(); renderPrefs();
    history.replaceState(null, '', location.pathname);   // URLからコードを消して二重表示を防ぐ
    await showInvite(q.get('room').toUpperCase());
    return;
  }
  if (room && sessionStorage.getItem('geoking_room') === room) {
    // リロード時の自動再接続
    connect(() => send({ type: 'join', room, name: $('#nameInput').value.trim() || localStorage.getItem('geoking_name') || '', ...rejoinInfo() }));
  }
  show('home'); startRoomsPoll(); renderPrefs();
})();
