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
function show(screen) { document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden')); $('#' + screen).classList.remove('hidden'); if (screen !== 'home' && typeof stopRoomsPoll === 'function') stopRoomsPoll(); const lb = $('#langBtn'); if (lb) lb.classList.toggle('hidden', screen !== 'home'); const br = $('header .brand'); if (br) br.classList.toggle('hidden', screen !== 'home'); }   // 言語切替と「地理王」のロゴはトップ画面だけ

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
  const sock = ws = new WebSocket(`${proto}://${base.host}/ws`);
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
      if (msg.code === 'room_not_found' || msg.code === 'reauth_failed' || msg.code === 'rejoin_full') {   // rejoin_full: 切断中にロビーで外れ、戻る前に席が埋まった
        sessionStorage.removeItem('geoking_room'); sessionStorage.removeItem('geoking_token');
        if (state) { stopTimer(); state = null; $('#roomInfo').classList.add('hidden'); show('home'); startRoomsPoll(); }   // 部屋が消えた → ホームへ
        else if (!manualJoin && msg.code !== 'rejoin_full') return;
      }
      toast(msg.message);
    }
  };
  ws.onclose = () => {
    if (ws !== sock) return;   // もう新しい接続に替わっている（古い接続が閉じただけ）。ここでつなぎ直すと、2本の接続が互いを切り合って止まらない
    if (!state) return;
    reconnectTries++;
    if (reconnectTries > 8) {   // 約1分あきらめたら停止（無限再接続ループを防ぐ）
      toast(t('conn_lost_reload')); stopTimer(); state = null; return;
    }
    if (reconnectTries > 1) toast(t('reconnecting'));
    const delay = reconnectTries === 1 ? 300 : Math.min(15000, 1000 * 2 ** (reconnectTries - 2));   // 1回目はすぐ、以降は間隔を広げる
    setTimeout(() => { if (state && ws === sock) connect(() => send({ type: 'join', room: state.room, name: $('#nameInput').value, ...rejoinInfo() })); }, delay);   // 待つ間に別の経路（アプリに戻った時など）でつなぎ直していたら何もしない
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

// ---------- 更新の自動読み直し
// アプリ（Android・iPhone）は裏に回して戻っても画面を読み直さないので、更新（Render の Manual sync）の前の画面が残る。
// 画面の版（/api/version）を、開いた時・アプリに戻った時・5分おきに確かめ、変わっていたら対戦中でないとき
// （ホーム画面で部屋に入っておらず、図鑑・クイズの枠も小窓も開いておらず、入力中でも操作の直後でもない）に読み直す。部屋にいる間は待ち、ホームに戻ってから読み直す
let pageVersion = null, updateVersion = null, lastTouch = 0;
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => { lastTouch = Date.now(); }, true));
async function fetchVersion() {
  try { const r = await fetch(API + '/api/version', { cache: 'no-store' }); return r.ok ? (await r.json()).v : null; } catch { return null; }
}
function safeToReload() {
  const a = document.activeElement;
  return !state && (!ws || ws.readyState === 3) && !document.querySelector('.appframe') && $('#modal').classList.contains('hidden')
    && !(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) && Date.now() - lastTouch > 5000;
}
async function checkForUpdate() {
  if (!pageVersion) { pageVersion = await fetchVersion(); return; }
  if (!updateVersion) {
    const v = await fetchVersion();
    if (!v || v === pageVersion) return;
    updateVersion = v;
  }
  if (!safeToReload()) return;   // 対戦中などは待つ（下の見張りが、読み直してよくなったところで読み直す）
  try { if (sessionStorage.getItem('geoking_reloaded_for') === updateVersion) return; sessionStorage.setItem('geoking_reloaded_for', updateVersion); } catch {}   // 同じ版で何度も読み直さない
  location.reload();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });
window.addEventListener('pageshow', () => checkForUpdate());
setInterval(() => { if (updateVersion) checkForUpdate(); }, 3000);   // 新しい版が見つかっていたら、読み直してよくなるのを待つ
setInterval(() => { if (document.visibilityState === 'visible') checkForUpdate(); }, 5 * 60 * 1000);
checkForUpdate();   // 開いた時の版を覚える

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
document.querySelectorAll('.modebtn').forEach(b => b.onclick = () => {   // 部屋の設定の「ゲーム」（パーティー＝points・バトル＝survival）。変えられるのはホストだけ
  if (!state || state.host !== pid || state.settings.rule === b.dataset.rule) return;
  send({ type: 'settings', settings: { rule: b.dataset.rule } });
});
$('#addBotBtn').onclick = () => send({ type: 'add_bot' });
// 確認はゲームの中の小窓で（ブラウザの確認ダイアログは、出さずに「キャンセル」にするアプリ内ブラウザがある。common.js の askConfirm）
$('#lobbyBtn').onclick = async () => { if (await askConfirm(t('confirm_to_lobby'), t('ask_lobby_ok'), t('ask_cancel'))) send({ type: 'to_lobby' }); };
$('#leaveBtn').onclick = async () => { if (await askConfirm(t('confirm_leave'), t('ask_leave_ok'), t('ask_cancel'), true)) send({ type: 'leave' }); };
function leaveToHome(message) {
  stopTimer(); prevKey = ''; prevChatLen = 0; prevRoom = null; prevPlayers = null; seenChat.clear(); chatPrimed = false;
  sessionStorage.removeItem('geoking_room'); sessionStorage.removeItem('geoking_token'); sessionStorage.removeItem('geoking_pid');
  document.querySelectorAll('.floatmsg').forEach(e => e.remove()); floatLastStart = 0; lastChatKey = ''; scrollTopPending = false;
  state = null; stopTimer(); $('#roomInfo').classList.add('hidden'); show('home'); startRoomsPoll();
  sfx.leave();
  if (message) toast(message);
}
$('#startBtn').onclick = () => send({ type: 'start', with_bot: state.players.length < 2 });   // ひとりのときはボットを1体入れて始める
$('#rematchBtn').onclick = () => send({ type: 'start', with_bot: state.players.length < 2 });
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
    if (scrollTopPending && state && state.phase !== 'lobby') requestAnimationFrame(scrollGameTop);   // 打っている間に答え合わせ・次のラウンドになっていたら、ここで一番上へ
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
// 同じ時に届いた発言は同じ高さから出て重なるので、前の吹き出しがこの吹き出しの高さ分だけ上がってから出す。横も左・中・右に振り分ける
let floatLastStart = 0, floatLane = 0;
function floatChat(c) {
  const me = state && state.players.find(p => p.pid === pid);
  const d = el('div', 'floatmsg' + (isSystem(c) ? ' sys' : (me && c.pid === pid ? ' me' : '')));
  d.innerHTML = `<b>${escapeHtml(chatName(c))}</b>${escapeHtml(chatText(c))}`;
  const lane = floatLane++ % 3;
  if (lane === 2) { d.style.left = 'auto'; d.style.right = (4 + Math.random() * 10).toFixed(0) + '%'; }   // 右の列は右から置く（左から置くと幅が狭まって縦に長くなる）
  else d.style.setProperty('--x', (4 + lane * 12 + Math.random() * 10).toFixed(0) + '%');
  d.style.visibility = 'hidden'; d.style.animationPlayState = 'paused';   // 出番まで待たせておく
  const olds = document.querySelectorAll('.floatmsg'); if (olds.length >= 12) olds[0].remove();
  document.body.appendChild(d);
  const speed = (innerHeight + 140) / 6500, now = Date.now();   // 流れる速さ（px/ミリ秒。CSS の floatUp と合わせる）
  const start = Math.max(now, floatLastStart + (d.offsetHeight + 10) / speed);
  floatLastStart = start;
  setTimeout(() => { d.style.visibility = ''; d.style.animationPlayState = 'running'; }, start - now);
  d.addEventListener('animationend', () => d.remove());
}
// 言語切り替え時: 今の画面を作り直す
window.onLangChange = () => { document.title = t('app_title'); if (typeof RANK_CACHE_CLEAR === 'function') RANK_CACHE_CLEAR(); if (state) render(); else loadRooms(); renderPrefs(); };

// 同じラウンドの結果をもう一度受け取ったとき（チャット・つなぎ直し・ページの読み直しなど）は、めくる動き・紙吹雪・音をやり直さない
const revealKeyOf = (s) => s.reveal ? `${s.room}|${s.round}|${s.reveal.prompt.id}|${s.reveal.rows.map(r => r.pid + ':' + r.card).join(',')}` : '';
const revealShown = () => { try { return sessionStorage.getItem('geoking_revealed') || ''; } catch { return ''; } };
// 答え合わせが出たとき・次のラウンドが始まったときは画面の一番上へ（手札の下の方で選んでも、結果とお題が見えるように）
let scrollTopNext = false, scrollTopPending = false;
function scrollGameTop() {
  const a = document.activeElement;
  if (a && a.closest && a.closest('#chatForm')) { scrollTopPending = true; return; }   // チャットを打っている最中は動かさず、打ち終わって入力欄から離れたら戻す
  scrollTopPending = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function playTransitions() {
  const key = `${state.room}:${state.phase}:${state.round}`;
  // 部屋に入った／人が増えた・減った
  if (state.room !== prevRoom) { sfx.enter(); prevRoom = state.room; prevPlayers = state.players.length; }
  else if (prevPlayers != null && state.players.length !== prevPlayers) { (state.players.length > prevPlayers ? sfx.joined : sfx.left)(); prevPlayers = state.players.length; }
  if (key !== prevKey) {
    if (state.phase === 'pick' && state.round === 1 && !prevKey.endsWith(':pick:1')) { sfx.start(); lastTickSec = null; scrollTopNext = true; }
    else if (state.phase === 'pick') { sfx.round(); lastTickSec = null; scrollTopNext = true; }
    else if (state.phase === 'reveal' && state.reveal && revealKeyOf(state) !== revealShown()) {
      scrollTopNext = true;
      sfx.reveal();
      const me = state.reveal.rows.find(r => r.pid === pid);
      const isSpectator = !!state.players.find(p => p.pid === pid && p.spectator);
      if (me && !isSpectator && !SV.on() && !me.winner) setTimeout(() => sfx.lose(), 350);   // 1位のファンファーレは1位の演出（cheerWinners）が鳴らす。バトルは当たる演出に合わせて survival.js が鳴らす
    } else if (state.phase === 'end') {
      scrollTopNext = true;
      const mine = (state.final || state.players).find(p => p.pid === pid);
      const scores = (state.final || state.players.filter(p => !p.spectator)).map(p => p.score);
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
  $('#roomInfo').classList.remove('hidden');
  $('#roomCountN').textContent = t('people_n', { n: state.players.filter(p => p.connected || p.is_bot).length });   // 上に出す「今部屋にいる人数」（ボットも数える。対戦中に接続が切れた人は数えない。ロビーでは切れた人はすぐ抜けるので「プレイヤー 3 / 8」と同じ）
  $('#lobbyBtn').classList.toggle('hidden', !(isHost && (state.phase === 'pick' || state.phase === 'reveal')));

  if (state.phase === 'lobby') { renderLobby(); show('lobby'); }
  else if (state.phase === 'pick' || state.phase === 'reveal') { renderGame(); show('game'); }
  else if (state.phase === 'end') { renderEnd(); show('end'); }
  renderChat();
  if (scrollTopNext) { scrollTopNext = false; requestAnimationFrame(scrollGameTop); }
}

// チャットはロビー・ゲーム・結果のどの画面でも使える。カードを今の画面のスロットへ移して描画
let lastChatKey = '';
function renderChat() {
  const card = $('#chatCard');
  const slot = state.phase === 'lobby' ? $('#lobbyChatSlot') : state.phase === 'end' ? $('#endChatSlot') : $('#gameChatSlot');
  const moved = !!slot && card.parentElement !== slot;
  if (moved) slot.appendChild(card);
  card.classList.remove('hidden');
  const log = $('#chatLog');
  const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 10;
  const chat = state.chat || [], last = chat[chat.length - 1];
  const lastKey = last ? `${last.ts}|${last.pid || ''}|${last.text}` : '';
  const newMsg = lastKey !== lastChatKey; lastChatKey = lastKey;
  log.innerHTML = (state.chat || []).map(c => `<div>${c.pid && c.pid !== pid ? `<b class="who" data-pid="${c.pid}" title="${t('report_mute')}">${escapeHtml(chatName(c))}</b>` : `<b>${escapeHtml(chatName(c))}</b>`} ${escapeHtml(chatText(c))}</div>`).join('');
  log.querySelectorAll('.who').forEach(b => b.onclick = () => showPlayerMenu(b.dataset.pid));
  // 新しい発言が来たとき・画面が変わって欄を移したとき（移すと一番上に戻る）・もともと一番下にいたときは、いちばん新しい発言（一番下）を見せる。
  // 前の発言を読み返している途中は、ほかの更新（誰かがカードを出した等）で引き戻さない
  if (moved || newMsg || atBottom) { log.scrollTop = log.scrollHeight; requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; }); }
}

// 部屋名（未設定なら「〇〇の部屋」を言語に合わせて）
function roomTitle() { if (!state) return ''; if (state.title_raw) return state.title_raw; const h = byPid(state.host); return t('room_of', { name: h ? pname(h) : '' }); }

function playerTag(p) {   // 「あなた」の札は付けない（2026-09-28: ロビー・スコアの欄とも不要と言われた。自分の名前で分かる）
  let t = '';
  if (p.pid === state.host) t += `<span class="tag host">${ico('crown')}${window.t('tag_host')}</span>`;
  if (p.is_bot) t += `<span class="tag">${ico('bot')}BOT</span>`;
  if (!p.connected && !p.is_bot) t += `<span class="tag off">${window.t('tag_off')}</span>`;
  if (p.spectator) t += `<span class="tag spec">${window.t('tag_spec')}</span>`;
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
  document.querySelectorAll('.modebtn').forEach(b => { const on = b.dataset.rule === (s.rule || 'points'); b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
  $('#startBtn').textContent = SV.on() ? t(state.players.length < 2 ? 'sv_start_bot' : 'sv_start')
    : (state.players.length < 2 ? t('start_with_bot') : t('start_rounds', { n: state.settings.rounds }));
}

function renderGame() {
  const pr = state.prompt;
  $('#roundNum').textContent = state.round; $('#roundTotal').textContent = state.total_rounds;
  // 「〜が高い国は？」の「高い/低い」などを強調表示（日本語のみ）
  const m = LANG === 'ja' ? pr.text.match(/^(.*?)(大きい|小さい|多い|少ない|高い|低い|長い|短い|北|南|東|西|近い)(国は？)$/) : null;
  $('#promptText').innerHTML = m ? `${escapeHtml(m[1])}<span class="kw">${m[2]}</span>${m[3]}` : escapeHtml(pt(pr));

  SV.renderStatus();   // サバイバル: 「ラウンド 3」の下に自分の体力と残りの人数（点のルールでは隠れたまま）
  // スコア（サバイバルは体力）
  const sl = $('#scoreList'); sl.innerHTML = '';
  $('#scoreTitle').textContent = t(SV.on() ? 'sv_hp' : 'score');
  if (SV.on()) SV.renderScores(sl);
  else for (const p of [...state.players].sort((a, b) => b.score - a.score)) {
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
  hand.classList.toggle('sv-hand', SV.on());   // サバイバル: 手札の外側のカードの枠をなくす（国旗の枠だけ）
  const me = state.players.find(p => p.pid === pid);
  const spectating = !!(me && (me.spectator || me.out_round));   // out_round: サバイバルで脱落した（最後まで観戦）
  $('#spectate').classList.toggle('hidden', !spectating);
  $('#pickTitle').classList.toggle('hidden', spectating);
  if (spectating) { SV.spectateText(me); renderOthersHands(); return; }
  const picked = state.my_pick;
  if (selectedCard && !state.hand.includes(selectedCard)) selectedCard = null;
  $('#pickTitle').textContent = picked
    ? t('played_msg', { card: state.settings.show_names ? '「' + countryName(picked) + '」' : t('card_word') })
    : (state.hand.length ? t('pick_hint') : t('no_hand'));
  for (const id of state.hand) {
    const cls = 'flagcard' + (id === picked ? ' picked' : '') + (id === selectedCard && id !== picked ? ' selected' : '') + (id === state.new_card ? ' sv-new' : '');   // sv-new: サバイバルでこのラウンドの前に引いた国旗
    const c = el('div', cls);
    c.innerHTML = `<span class="fimg"><img src="${flagUrl(id)}" alt="${t('flag_alt')}" loading="lazy"></span><div class="nm">${state.settings.show_names ? countryName(id) : (id === picked ? t('played_card') : '&nbsp;')}</div>`;
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
  for (const p of state.players.filter(x => !x.spectator && !x.out_round)) w.appendChild(el('span', p.picked ? 'done' : '', `${escapeHtml(p.name)}${p.picked ? ' ' + ico('check', 'sm') : ''}`));
  hand.appendChild(w); w.style.gridColumn = '1 / -1';
  renderOthersHands();
}

function renderOthersHands() {
  const box = $('#othersHands'); box.innerHTML = '';
  const others = state.players.filter(p => p.pid !== pid && !p.spectator && !p.out_round);   // サバイバルで脱落した人は、もう手札がない
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
    row.appendChild(el('span', 'oname', `${escapeHtml(p.name)}${SV.on() ? SV.bar(p.pid, SV.hpOf(p), true) : ''}${!live && p.picked ? ' ' + ico('check', 'sm') : ''}${bubble}`));
    for (const id of (state.hands[p.pid] || [])) {
      const wrap = el('span', 'oflag' + (lv && lv.pick === id ? ' go' : (lv && lv.selecting === id ? ' sel' : '')));
      const img = el('img'); img.src = flagUrl(id, 80); img.alt = ''; img.title = state.settings.show_names ? countryName(id) : '';
      img.onclick = () => showCountry(id);
      wrap.appendChild(img);
      const slot = el('span', 'oslot'); slot.appendChild(wrap); row.appendChild(slot);   // oslot: 国旗の置き場（並びをそろえる）。国旗と選択中・勝負の枠（oflag）は国旗にぴったり
    }
    box.appendChild(row);
  }
}

// 世界順位を金・銀・銅で強調（1位／2〜10位／11〜30位）
function wrankTier(rank) {   // 金＝世界1〜10位「トップ10！」、銀＝11〜20位、銅＝21〜30位（2026-09-27 に 金＝世界1位だけ・銀2〜10位・銅11〜30位 から変更。金がほとんど出なかった）
  if (rank <= 10) return { cls: ' gold', tag: `${ico('crown', 'sm')} ${t('top10')}` };
  if (rank <= 20) return { cls: ' silver', tag: `${ico('trophy', 'sm')} ${t('top20')}` };
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

// ---------- 答え合わせの1位の演出（パーティー・バトル共通。2026-09-28 にバトルの案B として作り、同じ日にパーティーにも入れた）
// 国旗が跳ねて金色に光る・王冠が跳ねる・国旗の上を光の筋が走る・後ろで後光が回る・金の星が飛び散る・キラキラが残る・衝撃波・金の紙吹雪。
// 自分が1位なら、画面ぜんぶ（ふちだけでなく真ん中も）が金色に光って後光が画面いっぱいに回り、ファンファーレ（前はふちだけ光り、真ん中に何もなかった）。
// 部品は答え合わせの枠の中の2枚の層（.fx-back＝国旗の後ろ、.fx-front＝前）か画面に固定して出し、動き終わったら消す（画面の横にはみ出さない）
const fxCalm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;   // 端末の「視差効果を減らす」: 動く飾りは出さない
const fxRnd = (a, b) => a + Math.random() * (b - a);
const fxCenter = (layer, node) => { const L = layer.getBoundingClientRect(), c = node.getBoundingClientRect(); return { x: c.left - L.left + c.width / 2, y: c.top - L.top + c.height / 2, w: c.width, h: c.height }; };
function fxPart(layer, cls, x, y, frames, opt, html) {   // 小さい部品（星・キラキラ・火花など）を1つ出して、動き終わったら消す
  const e = el('i', cls, html); e.style.left = x + 'px'; e.style.top = y + 'px'; layer.appendChild(e);
  e.animate(frames, opt).onfinish = () => e.remove();
  setTimeout(() => e.remove(), (opt.duration || 0) + (opt.delay || 0) + 600);   // 画面が裏に回って動きが止まっていても消す
  return e;
}
function fxLayers(box) {   // 答え合わせの枠に、演出を描く層を2枚
  const back = el('div', 'fx-back'), front = el('div', 'fx-front');
  box.prepend(back); box.append(front);
  return { back, front };
}
const FX_STAR = `<svg viewBox="-11 -11 22 22" aria-hidden="true"><path d="${(() => { let d = ''; for (let i = 0; i < 10; i++) { const r = i % 2 ? 4.3 : 10, a = (-90 + i * 36) * Math.PI / 180; d += (i ? 'L' : 'M') + (r * Math.cos(a)).toFixed(2) + ' ' + (r * Math.sin(a)).toFixed(2); } return d + 'Z'; })()}"/></svg>`;
const FX_SPARK = '<svg viewBox="-11 -11 22 22" aria-hidden="true"><path d="M0 -10C1 -2 2 -1 10 0C2 1 1 2 0 10C-1 2 -2 1 -10 0C-2 -1 -1 -2 0 -10Z"/></svg>';
// wins: 1位のカードごとに { card, flag（国旗の枠）, crown（王冠）, mine（自分か） }。shine: ほかの人が1位のときに「シャキーン」を鳴らすか（パーティーは今までの「ふぃ〜」のまま）
function cheerWinners(box, L, wins, shine) {
  let mine = null;
  for (const w of wins) {
    if (w.mine && !mine) mine = w;   // チャットなどでカードが描き直されていても、自分が1位のファンファーレは鳴らす
    if (!w.card.isConnected) continue;
    w.card.style.animationDelay = '0s';   // めくる動きの遅れを引き継がない
    w.card.classList.add('cheer');
    fxWave(box, L.front, w.card);
    spawnConfetti(fxAnchor(L.front, w.crown), 'gold', 0.6);
    if (!fxCalm()) {
      fxRays(L.back, w.flag); fxStars(L.front, w.flag); fxTwinkle(L.front, w.crown, true);
      if (w.flag.tagName === 'IMG') fxShine(w.flag);   // パーティーの国旗は枠なしの画像なので、光の筋は上に重ねて出す（バトルは .sv-flag::before）
      const id = setInterval(() => (w.flag.isConnected && state && state.phase === 'reveal' ? fxTwinkle(L.front, w.flag) : clearInterval(id)), 420);
      setTimeout(() => clearInterval(id), 5200);
    }
  }
  if (mine) { sfx.fanfare(); fxGoldScreen(mine.flag); } else if (shine && wins.length) sfx.shine();
}
function fxWave(box, front, card) {   // 1位のカードから広がる衝撃波
  const b = box.getBoundingClientRect(), p = fxCenter(front, card), w = el('i', 'fx-wave');
  w.style.left = p.x + 'px'; w.style.top = p.y + 'px'; w.style.setProperty('--s', (Math.hypot(b.width, b.height) / 20).toFixed(1));
  front.appendChild(w); setTimeout(() => w.remove(), 900);
}
function fxAnchor(front, target) {   // 紙吹雪の出どころ（王冠の位置）。紙吹雪は .fx-front の中に出すので、画面の横にはみ出さない
  const p = fxCenter(front, target), a = el('i', 'fx-anchor');
  a.style.left = p.x + 'px'; a.style.top = p.y + 'px';
  front.appendChild(a); setTimeout(() => a.remove(), 1900);
  return a;
}
function fxRays(back, flag) {   // 国旗の後ろで回る後光（カードの下の層なので、国旗や文字を隠さない）
  const p = fxCenter(back, flag), e = el('i', 'fx-rays');
  e.style.left = p.x + 'px'; e.style.top = p.y + 'px'; e.style.setProperty('--d', Math.max(p.w, p.h) * 2.5 + 'px');
  back.appendChild(e);
  e.animate([{ opacity: 0, transform: 'scale(.3) rotate(0deg)' }, { opacity: 1, transform: 'scale(1) rotate(25deg)', offset: .14 }, { opacity: .85, transform: 'scale(1.04) rotate(95deg)', offset: .75 }, { opacity: 0, transform: 'scale(1.08) rotate(130deg)' }], { duration: 3200, fill: 'forwards' }).onfinish = () => e.remove();
  setTimeout(() => e.remove(), 3800);
}
function fxStars(front, flag) {   // 金の星が飛び散る
  const p = fxCenter(front, flag);
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * Math.PI * 2 + fxRnd(-.2, .2), dist = fxRnd(60, 115), dx = Math.cos(a) * dist, dy = Math.sin(a) * dist * .8;
    const s = fxPart(front, 'fx-star', p.x, p.y, [{ transform: 'translate(0,0) scale(.2) rotate(0deg)', opacity: 1 }, { transform: `translate(${dx * .8}px,${dy * .8}px) scale(1.1) rotate(${fxRnd(90, 220)}deg)`, opacity: 1, offset: .55 }, { transform: `translate(${dx}px,${dy + 18}px) scale(.4) rotate(${fxRnd(240, 360)}deg)`, opacity: 0 }],
      { duration: fxRnd(750, 1000), easing: 'cubic-bezier(.15,.8,.3,1)', fill: 'forwards' }, FX_STAR);
    s.style.setProperty('--s', fxRnd(12, 22) + 'px'); s.style.setProperty('--c', i % 3 ? '#ffd23f' : '#fff4c2');
  }
}
function fxTwinkle(front, node, big) {   // キラッ（big: 王冠の右上に大きく1つ。ほか: 国旗のまわりのどこか）
  if (!node.isConnected) return;
  const p = fxCenter(front, node), x = big ? p.x + p.w * .35 : p.x + fxRnd(-.55, .55) * p.w, y = big ? p.y - p.h * .35 : p.y + fxRnd(-.6, .6) * p.h;
  const s = fxPart(front, 'fx-tw', x, y, [{ transform: 'scale(0) rotate(0deg)', opacity: 0 }, { transform: 'scale(1.15) rotate(45deg)', opacity: 1, offset: .45 }, { transform: 'scale(0) rotate(90deg)', opacity: 0 }], { duration: big ? 700 : 650, easing: 'ease-out', fill: 'forwards' }, FX_SPARK);
  s.style.setProperty('--s', (big ? 30 : fxRnd(12, 22)) + 'px');
}
function fxShine(img) {   // 国旗の画像の上を光の筋が走る（国旗の置き場 .rflag の中に、国旗と同じ大きさで重ねる。カードと一緒に跳ねる）
  const box = img.parentElement, R = box.getBoundingClientRect(), I = img.getBoundingClientRect(), s = el('i', 'fx-shine');
  Object.assign(s.style, { left: I.left - R.left + 'px', top: I.top - R.top + 'px', width: I.width + 'px', height: I.height + 'px' });
  box.appendChild(s); setTimeout(() => s.remove(), 1400);
}
function fxGoldScreen(flag) {   // 自分が1位: 画面ぜんぶが金色に光り、自分の国旗から後光が画面いっぱいに回って、画面のあちこちがキラッと光る
  if (fxCalm()) return;
  const W = innerWidth, H = innerHeight, f = flag.isConnected ? flag.getBoundingClientRect() : { left: W / 2, top: H / 2, width: 0, height: 0 };   // 描き直されていたら画面の真ん中から
  const x = f.left + f.width / 2, y = f.top + f.height / 2;
  const R = Math.max(Math.hypot(x, y), Math.hypot(W - x, y), Math.hypot(x, H - y), Math.hypot(W - x, H - y));   // 自分の国旗から、いちばん遠い画面の角まで
  const glow = el('div', 'fx-gold'), big = el('i', 'fx-bigrays');
  glow.style.setProperty('--x', x + 'px'); glow.style.setProperty('--y', y + 'px');
  Object.assign(big.style, { left: x + 'px', top: y + 'px', width: 2 * R + 'px', height: 2 * R + 'px' });
  document.body.append(big, glow);
  setTimeout(() => glow.remove(), 1300);
  big.animate([{ opacity: 0, transform: 'translate(-50%,-50%) scale(.25) rotate(0deg)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1) rotate(24deg)', offset: .18 }, { opacity: .85, transform: 'translate(-50%,-50%) scale(1.02) rotate(60deg)', offset: .65 }, { opacity: 0, transform: 'translate(-50%,-50%) scale(1.05) rotate(80deg)' }], { duration: 2000, fill: 'forwards' }).onfinish = () => big.remove();
  setTimeout(() => big.remove(), 2400);
  for (let i = 0; i < 16; i++) setTimeout(() => {
    const s = fxPart(document.body, 'fx-tw fixed', W * fxRnd(.06, .94), H * fxRnd(.06, .94), [{ transform: 'scale(0) rotate(0deg)', opacity: 0 }, { transform: 'scale(1.2) rotate(45deg)', opacity: 1, offset: .45 }, { transform: 'scale(0) rotate(90deg)', opacity: 0 }], { duration: 700, easing: 'ease-out', fill: 'forwards' }, FX_SPARK);
    s.style.setProperty('--s', fxRnd(16, 30) + 'px');
  }, 60 + i * 75);
}

function renderReveal() {
  if (SV.on()) return SV.renderReveal();   // サバイバル: 体力が減る演出つきの答え合わせ（survival.js）
  const r = state.reveal, F = META.fields[r.prompt.key];
  const key = revealKeyOf(state), fresh = key !== revealShown();   // 初めて見る結果だけ動かす
  const box = $('#revealRows'); box.innerHTML = '';
  delete box.dataset.svKey; box.classList.remove('sv-reveal');   // 前にサバイバルの答え合わせを出していたときの印を消す
  box.classList.toggle('still', !fresh);
  const wins = [];
  r.rows.forEach((row, i) => {
    const c = META.countries[row.card];
    const d = el('div', 'rev' + (row.winner ? ' win' : ''));
    d.style.animationDelay = (i * 0.25) + 's';
    d.innerHTML = `<div class="crown">${row.winner ? ico('crown') : (row.rank ? t('rank_n', { n: row.rank }) : '—')}</div><div class="rflag"><img src="${flagUrl(row.card)}" alt=""></div><div class="who">${escapeHtml(rowName(row))}</div><div class="country">${coff(c)}${r.prompt.key === 'kana_rank' ? `<small>${t('reading')}${c.name_kana}</small>` : (r.prompt.key === 'name_len' ? `<small>${t('reading')}${c.official_kana}</small>` : (coff(c) !== cname(c) ? `<small>${cname(c)}</small>` : ''))}</div><div class="val">${row.missing ? t('no_data') : fmtValue(row.value, F.fmt)}</div>${row.points != null ? `<div class="gain">${t(row.points === 1 ? 'gain_1' : 'gain', { n: row.points })}</div>` : ''}${wrankHtml(row.world_rank, row.world_total)}`;
    d.style.cursor = 'pointer'; d.onclick = () => showCountry(row.card);
    box.appendChild(d);
    const tier = wrankTier(row.world_rank || 999).cls.trim();
    if (tier) { d.dataset.tier = tier; if (fresh) setTimeout(() => spawnConfetti(d.querySelector('.wrank'), tier), i * 250 + 350); }
    if (row.winner) wins.push({ card: d, flag: d.querySelector('.rflag img'), crown: d.querySelector('.crown .ico'), mine: row.pid === pid, i });
  });
  const L = fxLayers(box);   // 1位の演出を描く層（バトルと同じ）
  if (fresh && wins.length) setTimeout(() => cheerWinners(box, L, wins, false), (wins[wins.length - 1].i * 0.25 + 0.6) * 1000);   // 1位のカードがめくれ終わったら（自分が1位ならファンファーレ）
  try { sessionStorage.setItem('geoking_revealed', key); } catch {}
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
  const sorted = (state.final || state.players.filter(p => !p.spectator)).slice().sort((a, b) => b.score - a.score);   // 終わった時点の順位（そのあと誰かが退出しても変えない）
  const top = sorted[0]?.score;
  // メダル形式: 同点は同じ順位（1,1,3…）。金・銀・銅、4位以下は白。1位はポンと出て光り、紙吹雪。
  // 1位の行の名前は champ（2026-09-27 まで top で、ヘッダーの .top の「上に貼り付く」が効き、スクロールしても1位の行だけ動かなかった）
  let rank = 0, prev = null;
  if (SV.on()) SV.renderFinal(ol);   // サバイバル: 最後まで残った人（体力）→ 脱落した人（何ラウンドで脱落したか）
  else sorted.forEach((p, i) => {
    if (p.score !== prev) { rank = i + 1; prev = p.score; }
    const cls = rank === 1 ? 'g' : rank === 2 ? 's' : rank === 3 ? 'b' : 'n';
    const li = el('li', 'm' + (rank === 1 ? ' champ' : ''), `<div class="disc ${cls}">${rank}</div><div class="nm">${rank === 1 ? ico('crown') + ' ' : ''}${escapeHtml(pname(p))}</div><div class="sc">${p.score}<small>${t('pts')}</small></div>`);
    li.style.animationDelay = (0.15 * i) + 's';
    ol.appendChild(li);
    if (rank === 1) setTimeout(() => spawnConfetti(li.querySelector('.disc'), 'gold'), 400 + 150 * i);
  });
  const rb = $('#rematchBtn'); rb.dataset.i18n = state.players.length < 2 ? 'start_with_bot' : 'rematch'; rb.textContent = t(rb.dataset.i18n);   // ひとりならボットを入れて始める
  const champs = sorted.filter(p => p.score === top).map(p => pname(p));
  $('#endTitle').innerHTML = SV.on() ? SV.endTitle() : `${ico('trophy', 'big')} ${t('is_champion', { names: escapeHtml(joinNames(champs)) })}`;
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
  for (const c of cols) table.appendChild(el('div', 'hth' + (c.pid === pid ? ' me' : ''), `${ico('person', 'sm')} ${escapeHtml(c.name)}`));   // 自分の列は見出しの色（緑）で分かるので「（あなた）」は付けない
  const cardHtml = (id, extra = '') => `<div class="hflag"><img src="${flagUrl(id, 160)}" alt=""></div><div class="cn">${coff(META.countries[id])}</div>${extra}`;   // hflag: 国旗の置き場（国旗の枠は国旗にぴったり）
  for (const h of history) {
    const F = META.fields[h.prompt.key];
    table.appendChild(el('div', 'hth row', `<b>${t('round_short', { n: h.round })}</b>${escapeHtml(pt(h.prompt))}`));
    for (const c of cols) {
      const r = h.rows.find(x => x.pid === c.pid);
      if (!r) { table.appendChild(el('div', 'hcard empty', '—')); continue; }
      const card = el('div', 'hcard' + (r.winner ? ' win' : ''));
      const t = r.world_rank ? wrankTier(r.world_rank).cls : '';
      card.innerHTML = cardHtml(r.card, `<div class="val">${r.winner ? ico('crown', 'sm') + ' ' : ''}${fmtValue(r.value, F.fmt)}</div>${r.world_rank ? `<div class="who${t ? ' hot' + t : ''}">${window.t('world_rank_plain', { n: r.world_rank, total: r.world_total })}</div>` : ''}${SV.historyDamage(r)}`);   // historyDamage: サバイバルだけ、そのラウンドで減った体力
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
    for (const r of rooms) {   // 1行目に部屋名、2行目に人数・ゲーム（パーティー／バトル）・「募集中／対戦中」だけ（ホスト名・ラウンド数・お題の種類は出さない）
      const status = r.phase === 'lobby' ? `<span class="proom-st">${t('recruiting')}</span>` : `<b class="proom-st live">${t('playing')}</b>`;
      const mode = r.rule === 'survival' ? `<span class="tag proom-mode">${ico('heart', 'sm')}${t('mode_survival')}</span>` : `<span class="tag proom-mode">${ico('trophy', 'sm')}${t('mode_points')}</span>`;   // その部屋のゲーム
      const li = el('li', '', `<span class="proom"><b class="proom-name">${escapeHtml(r.title_raw || t('room_of', { name: r.host }))}</b><span class="proom-sub muted small">${ico('person', 'sm')} ${t('players_n', { n: r.players })}${mode}${status}</span></span>`);
      const b = el('button', 'mini primary', t('join_short')); b.onclick = () => { $('#codeInput').value = r.room; $('#joinBtn').click(); };
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
  META = await loadMeta();
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
