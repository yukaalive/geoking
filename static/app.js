/* GeoKing client */
const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

let META = null;          // countries, fields, categories, prompts
let ws = null, state = null, pendingAction = null;
let selectedCard = null, manualJoin = false;
let timerInterval = null;
let reconnectTries = 0, revealInterval = null;
let pid = null;  // サーバーが発行する。再接続用トークンと共に sessionStorage に保持
const rejoinInfo = () => ({ pid: sessionStorage.getItem('geoking_pid'), token: sessionStorage.getItem('geoking_token') });

// ---------- 表示ユーティリティ
const flagUrl = (id, w = 320) => `https://flagcdn.com/w${w}/${id}.png`;
function fmtValue(v, fmt) {
  if (v == null) return 'データなし';
  const n = Number(v);
  switch (fmt) {
    case 'km2': return n.toLocaleString('ja-JP', { maximumFractionDigits: 0 }) + ' km²';
    case 'people': return n >= 1e8 ? (n / 1e8).toFixed(2) + '億人' : n >= 1e4 ? (n / 1e4).toFixed(1) + '万人' : n.toLocaleString('ja-JP') + '人';
    case 'usd': return n >= 1e12 ? (n / 1e12).toFixed(2) + '兆ドル' : n >= 1e8 ? (n / 1e8).toFixed(0) + '億ドル' : (n / 1e6).toFixed(0) + '百万ドル';
    case 'usd_small': return n.toLocaleString('ja-JP', { maximumFractionDigits: 0 }) + ' ドル';
    case 'chars': return n + ' 文字';
    case 'lat': return (n >= 0 ? '北緯 ' : '南緯 ') + Math.abs(n).toFixed(1) + '°';
    case 'lng': return (n >= 0 ? '東経 ' : '西経 ') + Math.abs(n).toFixed(1) + '°';
    case 'deg': return n.toFixed(1) + '°';
    case 'count': return n + ' か国・言語';
    case 'temp': return n.toFixed(1) + ' ℃';
    case 'mm': return n.toLocaleString('ja-JP') + ' mm';
    case 'pct': return n.toFixed(1) + ' %';
    case 'ton': return n.toFixed(2) + ' t';
    case 'years': return n.toFixed(1) + ' 歳';
    case 'float2': return n.toFixed(2);
    default: return String(v);
  }
}
function countryName(id) { const c = META.countries[id]; return c ? c.name : id; }
function stars(n) { return '★'.repeat(n) + '☆'.repeat(3 - n); }
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 2600); }
function show(screen) { document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden')); $('#' + screen).classList.remove('hidden'); if (screen !== 'home' && typeof stopRoomsPoll === 'function') stopRoomsPoll(); }

// ---------- カード裏面（全データ）モーダル
function showCountry(id) {
  const c = META.countries[id]; if (!c) return;
  const F = META.fields;
  const groups = [
    ['基本', ['area', 'population', 'gdp', 'gdp_pc', 'name_len', 'lat', 'lng', 'borders', 'languages', 'military']],
    ['気候・自然', ['temp', 'precip', 'forest_pct', 'agri_pct', 'co2_pc']],
    ['宗教', ['rel_chr', 'rel_mus', 'rel_bud', 'rel_hin', 'rel_non', 'rel_folk', 'rel_jew', 'rel_div']],
    ['社会・暮らし', ['life_exp', 'age65_pct', 'fertility', 'urban_pct', 'internet_pct', 'tourists', 'physicians', 'elec_pct']],
  ];
  let html = `<div style="display:flex;gap:14px;align-items:flex-start"><img src="${flagUrl(id)}" alt=""><div><h2 style="margin:0">${c.name}</h2><div class="muted">${c.name_official}<br>${c.name_en} ／ ${c.subregion}<br>首都: ${c.capital || '—'}${c.landlocked ? '（内陸国）' : ''}</div></div></div><div class="dl">`;
  for (const [title, keys] of groups) {
    html += `<div class="sec">${title}</div>`;
    for (const k of keys) html += `<div class="k">${F[k].label}</div><div class="v">${fmtValue(c[k], F[k].fmt)}</div>`;
  }
  html += '</div>';
  $('#modalBody').innerHTML = html; $('#modal').classList.remove('hidden');
}
$('#modalClose').onclick = () => $('#modal').classList.add('hidden');
$('#modal').onclick = (e) => { if (e.target.id === 'modal') $('#modal').classList.add('hidden'); };

// ---------- WebSocket
function connect(onOpen) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => { onOpen && onOpen(); };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'state') { reconnectTries = 0; state = msg; pid = msg.you; sessionStorage.setItem('geoking_room', msg.room); if (msg.token) { sessionStorage.setItem('geoking_pid', msg.you); sessionStorage.setItem('geoking_token', msg.token); } render(); }
    else if (msg.type === 'left') { leaveToHome(msg.message); if (ws) { ws.onclose = null; ws.close(); } }
    else if (msg.type === 'error') {
      if (msg.message.includes('見つかりません') || msg.message.includes('認証に失敗')) {
        sessionStorage.removeItem('geoking_room'); sessionStorage.removeItem('geoking_token');
        if (state) { state = null; show('home'); startRoomsPoll(); }   // 部屋が消えた → ホームへ
        else if (!manualJoin) return;
      }
      toast(msg.message);
    }
  };
  ws.onclose = () => {
    if (!state) return;
    reconnectTries++;
    if (reconnectTries > 8) {   // 約1分あきらめたら停止（無限再接続ループを防ぐ）
      toast('サーバーに接続できません。ページを再読み込みしてください'); state = null; return;
    }
    toast('接続が切れました。再接続します…');
    const delay = Math.min(15000, 1000 * 2 ** (reconnectTries - 1));
    setTimeout(() => { if (state) connect(() => send({ type: 'join', room: state.room, name: $('#nameInput').value, ...rejoinInfo() })); }, delay);
  };
}
function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

// ---------- ホーム
const JP_NAMES = ['さくら', 'ゆうき', 'はると', 'みお', 'そうた', 'ひなた', 'りく', 'あおい', 'ゆい', 'こうき', 'はな', 'だいき', 'めい', 'たくみ', 'りん', 'けんた', 'ももか', 'しょうた', 'あかり', 'ゆうと', 'なな', 'かいと', 'ひかり', 'れん', 'みさき', 'たいち', 'ことね', 'ゆうま', 'まお', 'しゅん'];
const randomName = () => JP_NAMES[Math.floor(Math.random() * JP_NAMES.length)];
function myName() { const n = $('#nameInput').value.trim() || randomName(); localStorage.setItem('geoking_name', n); return n; }
$('#nameInput').value = localStorage.getItem('geoking_name') || randomName();
$('#createBtn').onclick = () => { manualJoin = true; const name = myName(); connect(() => send({ type: 'create', name })); };
$('#joinBtn').onclick = () => {
  const code = $('#codeInput').value.trim().toUpperCase(); if (code.length !== 4) return toast('4文字の部屋コードを入力してください');
  manualJoin = true; const name = myName(); connect(() => send({ type: 'join', room: code, name }));
};
$('#codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('#joinBtn').click(); });

// ---------- ロビー操作
function pushSettings() {
  if (!state || state.host !== pid) return;
  send({ type: 'settings', settings: { public: $('#setPublic').checked, title: $('#setTitle').value.trim() } });
}
['#setPublic', '#setTitle'].forEach(s => $(s).addEventListener('change', pushSettings));
$('#addBotBtn').onclick = () => send({ type: 'add_bot' });
$('#leaveBtn').onclick = () => { if (confirm('この部屋から退出しますか？')) send({ type: 'leave' }); };
function leaveToHome(message) {
  stopTimer();
  sessionStorage.removeItem('geoking_room'); sessionStorage.removeItem('geoking_token'); sessionStorage.removeItem('geoking_pid');
  state = null; stopTimer(); $('#roomInfo').classList.add('hidden'); show('home'); startRoomsPoll();
  if (message) toast(message);
}
$('#startBtn').onclick = () => send({ type: 'start' });
$('#rematchBtn').onclick = () => send({ type: 'start' });
$('#toLobbyBtn').onclick = () => send({ type: 'to_lobby' });
$('#chatForm').onsubmit = (e) => { e.preventDefault(); const t = $('#chatInput').value.trim(); if (t) send({ type: 'chat', text: t }); $('#chatInput').value = ''; };
$('#copyLink').onclick = async () => {
  const url = `${location.origin}/static/index.html?room=${state.room}`;
  try { await navigator.clipboard.writeText(url); toast('招待リンクをコピーしました'); } catch { prompt('このリンクを共有してください', url); }
};

// ---------- 描画
function render() {
  if (!state) return;
  const isHost = state.host === pid;
  document.body.classList.toggle('host', isHost); document.body.classList.toggle('guest', !isHost);
  $('#roomInfo').classList.remove('hidden'); $('#roomCode').textContent = state.room; $('#roomTitle').textContent = state.title || '';

  if (state.phase === 'lobby') { renderLobby(); show('lobby'); }
  else if (state.phase === 'pick' || state.phase === 'reveal') { renderGame(); show('game'); }
  else if (state.phase === 'end') { renderEnd(); show('end'); }
}

function playerTag(p) {
  let t = '';
  if (p.pid === state.host) t += '<span class="tag host">ホスト</span>';
  if (p.is_bot) t += '<span class="tag">BOT</span>';
  if (!p.connected && !p.is_bot) t += '<span class="tag off">切断</span>';
  if (p.pid === state.you) t += '<span class="tag">あなた</span>';
  return t;
}

function renderLobby() {
  $('#lobbyCode').textContent = state.room;
  $('#playerCount').textContent = `${state.players.length} / 8`;
  const ul = $('#lobbyPlayers'); ul.innerHTML = '';
  for (const p of state.players) {
    const li = el('li', '', `<span>${escapeHtml(p.name)}${playerTag(p)}</span>`);
    if (state.host === pid && p.pid !== pid) { const b = el('button', 'mini', '退出'); b.onclick = () => send({ type: 'kick', pid: p.pid }); li.appendChild(b); }
    ul.appendChild(li);
  }
  const s = state.settings;
  if (document.activeElement?.closest('.settings') == null) {
    $('#setPublic').checked = s.public; $('#setTitle').value = state.title_raw || ''; $('#setTitle').placeholder = state.title || '例：ゆかの部屋';
  }
  $('#startBtn').disabled = state.players.length < 2;
  $('#startBtn').textContent = state.players.length < 2 ? 'ゲーム開始（2人以上必要・ボット可）' : `ゲーム開始（${state.settings.rounds}ラウンド）`;
}

function renderGame() {
  const pr = state.prompt, cat = META.categories[pr.cat];
  $('#roundNum').textContent = state.round; $('#roundTotal').textContent = state.total_rounds;
  $('#promptCat').textContent = `${cat.icon} ${cat.name} ／ 難易度 ${stars(pr.star)}`;
  // 「〜が高い国は？」の「高い/低い」などを強調表示
  const m = pr.text.match(/^(.*?)(大きい|小さい|多い|少ない|高い|低い|長い|短い|北|南|東|西|近い)(国は？)$/);
  $('#promptText').innerHTML = m ? `${escapeHtml(m[1])}<span class="kw">${m[2]}</span>${m[3]}` : escapeHtml(pr.text);
  $('#promptHint').textContent = pr.hint || '';
  const F = META.fields[pr.key];
  $('#promptDir').textContent = m ? `${m[1]}最も${m[2]}国を出した人の勝ち` : (pr.dir === 'max' ? `${F.label}が最も大きい国を出した人の勝ち` : `${F.label}が最も小さい国を出した人の勝ち`);
  $('#promptDir').className = 'dir ' + pr.dir;

  // スコア
  const sl = $('#scoreList'); sl.innerHTML = '';
  for (const p of [...state.players].sort((a, b) => b.score - a.score)) {
    sl.appendChild(el('li', '', `<span>${escapeHtml(p.name)}${playerTag(p)}</span><b>${p.score} 点${state.phase === 'pick' ? (p.picked ? ' ✅' : ' …') : ''}</b>`));
  }
  // チャット
  const log = $('#chatLog'); const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 10;
  log.innerHTML = state.chat.map(c => `<div><b>${escapeHtml(c.name)}</b> ${escapeHtml(c.text)}</div>`).join('');
  if (atBottom) log.scrollTop = log.scrollHeight;

  if (state.phase === 'pick') {
    $('#pickArea').classList.remove('hidden'); $('#revealArea').classList.add('hidden');
    renderHand(); renderTimer();
  } else {
    $('#pickArea').classList.add('hidden'); $('#revealArea').classList.remove('hidden'); $('#timer').classList.add('hidden');
    stopTimer(); renderReveal();
  }
  if (state.phase === 'pick') {
    clearInterval(revealInterval); revealInterval = null;
  }
}

function renderHand() {
  const hand = $('#hand'); hand.innerHTML = '';
  const locked = state.my_pick != null;
  $('#pickTitle').textContent = locked ? `「${countryName(state.my_pick)}」を出しました。他のプレイヤーを待っています…` : (state.hand.length ? 'お題に一番合うと思う国旗を1枚選ぼう（クリックで決定）' : '手札がありません。次のゲームから参加できます');
  for (const id of state.hand) {
    const c = el('div', 'flagcard' + (id === state.my_pick ? ' selected' : '') + (locked ? ' locked' : ''));
    c.innerHTML = `<img src="${flagUrl(id)}" alt="国旗" loading="lazy"><div class="nm">${state.settings.show_names ? countryName(id) : '&nbsp;'}</div>`;
    if (!locked) {
      c.onclick = () => { if (selectedCard === id) { send({ type: 'pick', card: id }); selectedCard = null; } else { selectedCard = id; document.querySelectorAll('.flagcard').forEach(x => x.classList.remove('selected')); c.classList.add('selected'); $('#pickTitle').textContent = `この国旗を出す？ もう一度クリックで決定${state.settings.show_names ? '：' + countryName(id) : ''}`; } };
    }
    hand.appendChild(c);
  }
  const w = el('div', 'waiting');
  for (const p of state.players) w.appendChild(el('span', p.picked ? 'done' : '', `${escapeHtml(p.name)}${p.picked ? ' ✓' : ''}`));
  hand.appendChild(w); w.style.gridColumn = '1 / -1';
}

function renderReveal() {
  const r = state.reveal, F = META.fields[r.prompt.key];
  const box = $('#revealRows'); box.innerHTML = '';
  r.rows.forEach((row, i) => {
    const c = META.countries[row.card];
    const d = el('div', 'rev' + (row.winner ? ' win' : ''));
    d.style.animationDelay = (i * 0.25) + 's';
    d.innerHTML = `<div class="crown">${row.winner ? '👑' : (row.rank ? row.rank + '位' : '—')}</div><img src="${flagUrl(row.card)}" alt=""><div class="who">${escapeHtml(row.name)}${row.pid === pid ? '（あなた）' : ''}</div><div class="country">${c.name_official}${c.name_official !== c.name ? `<small>${c.name}</small>` : ''}</div><div class="val">${fmtValue(row.value, F.fmt)}</div><div class="rank">${F.label}${row.value == null ? '（データなし＝敗北）' : ''}</div>`;
    d.style.cursor = 'pointer'; d.onclick = () => showCountry(row.card);
    box.appendChild(d);
  });
  const winners = r.rows.filter(x => x.winner).map(x => x.name);
  const label = state.round >= state.total_rounds ? '最終結果' : `次のラウンド（${state.round + 1} / ${state.total_rounds}）`;
  const tick = () => {
    const left = state.next_at ? Math.max(0, Math.ceil(state.next_at - Date.now() / 1000)) : 0;
    $('#nextCountdown').textContent = `${left}秒後に${label}へ`;
  };
  tick(); revealInterval = setInterval(tick, 250);
  $('#revealArea').querySelector('h3').textContent = winners.length ? `${winners.join('・')} が1点獲得！（カードをクリックで裏面の全データ）` : '全員データなし… 引き分け';
}

function renderEnd() {
  const ol = $('#finalList'); ol.innerHTML = '';
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  const top = sorted[0]?.score;
  sorted.forEach((p, i) => {
    const won = p.won.map(id => META.prompts.find(x => x.id === id)?.text.replace('は？', '')).filter(Boolean);
    ol.appendChild(el('li', '', `${p.score === top ? '👑 ' : ''}${escapeHtml(p.name)}${p.pid === pid ? '（あなた）' : ''} — <b>${p.score} 点</b><div class="muted small">${won.join('／') || '—'}</div>`));
  });
  const champs = sorted.filter(p => p.score === top).map(p => p.name);
  $('#endTitle').textContent = `🏆 ${champs.join('・')} が地理王！`;
}

// ---------- タイマー
function renderTimer() {
  stopTimer();
  if (!state.deadline) { $('#timer').classList.add('hidden'); return; }
  $('#timer').classList.remove('hidden');
  const tick = () => {
    const left = Math.max(0, Math.ceil(state.deadline - Date.now() / 1000));
    $('#timer').textContent = left + '秒'; $('#timer').classList.toggle('urgent', left <= 10);
  };
  tick(); timerInterval = setInterval(tick, 250);
}
function stopTimer() { clearInterval(timerInterval); timerInterval = null; clearInterval(revealInterval); revealInterval = null; }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

// ---------- 公開部屋一覧
async function loadRooms() {
  const ul = $('#publicRoomList');
  try {
    const { rooms } = await (await fetch('/api/rooms')).json();
    ul.innerHTML = '';
    if (!rooms.length) { ul.innerHTML = '<li class="muted">いま募集中の部屋はありません。部屋を作って「公開部屋にする」をオンにすると、ここに表示されます。</li>'; return; }
    for (const r of rooms) {
      const cats = r.categories.map(c => META.categories[c]?.icon || '').join('');
      const status = r.phase === 'lobby' ? '<span class="tag">募集中</span>' : `<span class="tag live">ラウンド${r.round}進行中・途中参加OK</span>`;
      const li = el('li', '', `<span><b>${escapeHtml(r.title || r.host + 'の部屋')}</b> <span class="muted small">by ${escapeHtml(r.host)}</span> ${status} <span class="tag">${r.players}/8人</span> <span class="tag">${r.rounds}R ${cats}</span></span>`);
      const b = el('button', 'mini primary', '参加'); b.onclick = () => { $('#codeInput').value = r.room; $('#joinBtn').click(); };
      li.appendChild(b); ul.appendChild(li);
    }
  } catch { ul.innerHTML = '<li class="muted">一覧を取得できませんでした</li>'; }
}
$('#refreshRooms').onclick = loadRooms;
let roomsPoll = null;
function startRoomsPoll() { stopRoomsPoll(); loadRooms(); roomsPoll = setInterval(() => { if (!$('#home').classList.contains('hidden')) loadRooms(); }, 5000); }
function stopRoomsPoll() { clearInterval(roomsPoll); roomsPoll = null; }

// ---------- 起動
(async function init() {
  META = await (await fetch('/api/meta')).json();
  const q = new URLSearchParams(location.search);
  const room = q.get('room') || sessionStorage.getItem('geoking_room');
  if (q.get('room')) { $('#codeInput').value = q.get('room').toUpperCase(); }
  if (room && sessionStorage.getItem('geoking_room') === room) {
    // リロード時の自動再接続
    connect(() => send({ type: 'join', room, name: $('#nameInput').value.trim() || localStorage.getItem('geoking_name') || 'プレイヤー', ...rejoinInfo() }));
  }
  show('home'); startRoomsPoll();
})();
