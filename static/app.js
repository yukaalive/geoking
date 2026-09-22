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
    case 'countries': return n + ' か国';
    case 'langs': return n + ' 言語';
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
const ico = (name, cls = '') => `<svg class="ico ${cls}" aria-hidden="true"><use href="/static/icons.svg#${name}"/></svg>`;
function stars(n) { return `<span class="stars">${ico('star').repeat(n)}${ico('star-off').repeat(3 - n)}</span>`; }
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
  let info = `<div style="display:flex;gap:14px;align-items:flex-start"><img src="${flagUrl(id)}" alt=""><div><h2 style="margin:0">${c.name_official}</h2><div class="muted">${c.name_official !== c.name ? c.name + '<br>' : ''}${c.name_en} ／ ${c.subregion}<br>首都: ${c.capital || '—'}${c.landlocked ? '（内陸国）' : ''}</div></div></div><div class="dl">`;
  for (const [title, keys] of groups) {
    info += `<div class="sec">${title}</div>`;
    for (const k of keys) info += `<div class="k">${F[k].label}</div><div class="v">${fmtValue(c[k], F[k].fmt)}</div>`;
  }
  info += '</div>';
  $('#modalBody').innerHTML = `<div class="modalgrid"><div class="minfo">${info}</div><div class="mmap worldmap"><div class="muted small">地図を読み込み中…</div></div></div>`;
  $('#modal').classList.remove('hidden');
  $('#modalBody').classList.add('wide');
  loadWorld().then(() => { const box = $('#modalBody .mmap'); if (box) box.innerHTML = `<div class="muted small" style="margin-bottom:4px">世界の中の位置</div>` + worldMapSvg(id) + `<div class="muted small" style="margin:10px 0 4px">周辺を拡大</div>` + worldMapSvg(id, true) + `<div class="muted small" style="margin-top:6px">${c.lat >= 0 ? '北緯' : '南緯'} ${Math.abs(c.lat).toFixed(1)}°　${c.lng >= 0 ? '東経' : '西経'} ${Math.abs(c.lng).toFixed(1)}°</div>`; });
}
$('#modalClose').onclick = () => $('#modal').classList.add('hidden');
$('#creditsLink').onclick = (e) => {
  e.preventDefault();
  $('#modalBody').innerHTML = `<h2 style="margin-top:0">データ出典</h2><ul class="small" style="padding-left:18px;line-height:1.8">
    <li>国の基本情報・面積・位置: <a href="https://github.com/mledoze/countries" target="_blank" rel="noopener">mledoze/countries</a>（ODbL）</li>
    <li>人口・GDP・平均寿命・降水量・都市人口率など: <a href="https://data.worldbank.org/" target="_blank" rel="noopener">World Bank Open Data</a>（CC BY 4.0）</li>
    <li>宗教構成: Pew Research Center の公表値を参考にした概算</li>
    <li>年平均気温: 公開資料を参考にした概算</li>
    <li>国旗画像: <a href="https://flagcdn.com/" target="_blank" rel="noopener">flagcdn.com</a></li>
    <li>ゲームデザインの着想: ウナム日月『国旗王（こっきんぐ）』</li></ul>`;
  $('#modal').classList.remove('hidden'); $('#modalBody').classList.remove('wide');
};
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
      toast('サーバーに接続できません。ページを再読み込みしてください'); stopTimer(); state = null; return;
    }
    toast('接続が切れました。再接続します…');
    const delay = Math.min(15000, 1000 * 2 ** (reconnectTries - 1));
    setTimeout(() => { if (state) connect(() => send({ type: 'join', room: state.room, name: $('#nameInput').value, ...rejoinInfo() })); }, delay);
  };
}
function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

// ---------- ホーム
// 名前は必須。空なら null を返して呼び出し側で止める
function myName() {
  const n = $('#nameInput').value.trim();
  if (!n) { toast('名前を入力してください'); $('#nameInput').focus(); return null; }
  localStorage.setItem('geoking_name', n); return n;
}
$('#nameInput').value = localStorage.getItem('geoking_name') || '';
$('#nameInput').addEventListener('focus', function () { this.select(); });   // 前回の名前が入っていても、そのまま打てば置き換わる
$('#createBtn').onclick = () => { const name = myName(); if (!name) return; manualJoin = true; connect(() => send({ type: 'create', name })); };
$('#joinBtn').onclick = () => {
  const code = $('#codeInput').value.trim().toUpperCase(); if (code.length !== 4) return toast('4文字の部屋コードを入力してください');
  const name = myName(); if (!name) return; manualJoin = true; connect(() => send({ type: 'join', room: code, name }));
};
$('#codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('#joinBtn').click(); });

// ---------- ロビー操作
function pushSettings() {
  if (!state || state.host !== pid) return;
  send({ type: 'settings', settings: { public: $('#setPublic').checked, title: $('#setTitle').value.trim() } });
}
['#setPublic', '#setTitle'].forEach(s => $(s).addEventListener('change', pushSettings));
$('#addBotBtn').onclick = () => send({ type: 'add_bot' });
$('#joinGameBtn').onclick = () => send({ type: 'join_game' });
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
  if (p.pid === state.host) t += `<span class="tag host">${ico('crown')}ホスト</span>`;
  if (p.is_bot) t += `<span class="tag">${ico('bot')}BOT</span>`;
  if (!p.connected && !p.is_bot) t += '<span class="tag off">切断</span>';
  if (p.spectator) t += '<span class="tag spec">観戦</span>';
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
  $('#promptCat').innerHTML = `${ico(cat.icon)} ${escapeHtml(cat.name)} ／ 難易度 ${stars(pr.star)}`;
  // 「〜が高い国は？」の「高い/低い」などを強調表示
  const m = pr.text.match(/^(.*?)(大きい|小さい|多い|少ない|高い|低い|長い|短い|北|南|東|西|近い)(国は？)$/);
  $('#promptText').innerHTML = m ? `${escapeHtml(m[1])}<span class="kw">${m[2]}</span>${m[3]}` : escapeHtml(pr.text);
  $('#promptHint').textContent = pr.hint || '';

  // スコア
  const sl = $('#scoreList'); sl.innerHTML = '';
  for (const p of [...state.players].sort((a, b) => b.score - a.score)) {
    sl.appendChild(el('li', '', `<span>${escapeHtml(p.name)}${playerTag(p)}</span><b>${p.spectator ? '—' : p.score + ' 点'}${state.phase === 'pick' && !p.spectator ? (p.picked ? ico('check', 'sm status-ico') : ico('clock', 'sm status-ico')) : ''}</b>`));
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
  const me = state.players.find(p => p.pid === pid);
  const spectating = !!(me && me.spectator);
  $('#spectate').classList.toggle('hidden', !spectating);
  $('#pickTitle').classList.toggle('hidden', spectating);
  if (spectating) { renderOthersHands(); return; }
  const picked = state.my_pick;
  if (selectedCard && !state.hand.includes(selectedCard)) selectedCard = null;
  $('#pickTitle').textContent = picked
    ? `「${countryName(picked)}」を出しました。全員が出すまでは、別のカードを2回クリックで変更できます`
    : (state.hand.length ? 'お題に一番合うと思う国旗を1枚選ぼう（2回クリックで決定）' : '手札がありません。次のゲームから参加できます');
  for (const id of state.hand) {
    const cls = 'flagcard' + (id === picked ? ' picked' : '') + (id === selectedCard && id !== picked ? ' selected' : '');
    const c = el('div', cls);
    c.innerHTML = `<img src="${flagUrl(id)}" alt="国旗" loading="lazy"><div class="nm">${state.settings.show_names ? countryName(id) : (id === picked ? '出したカード' : '&nbsp;')}</div>`;
    c.onclick = () => {
      if (id === picked) return;                       // すでに出しているカード
      if (selectedCard === id) { send({ type: 'pick', card: id }); selectedCard = null; return; }   // 2回目で決定・変更
      selectedCard = id;
      document.querySelectorAll('.flagcard').forEach(x => x.classList.remove('selected'));
      c.classList.add('selected');
      $('#pickTitle').textContent = `${picked ? 'このカードに変更する？' : 'この国旗を出す？'} もう一度クリックで決定${state.settings.show_names ? '：' + countryName(id) : ''}`;
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
  box.appendChild(el('h4', '', 'みんなの手札（何を出したかは公開まで分かりません）'));
  for (const p of others) {
    const row = el('div', 'orow');
    row.appendChild(el('span', 'oname', `${escapeHtml(p.name)}${p.picked ? ' ' + ico('check', 'sm') : ''}`));
    for (const id of (state.hands[p.pid] || [])) {
      const img = el('img'); img.src = flagUrl(id, 80); img.alt = ''; img.title = state.settings.show_names ? countryName(id) : '';
      img.style.cursor = 'pointer'; img.onclick = () => showCountry(id);
      row.appendChild(img);
    }
    box.appendChild(row);
  }
}

function renderReveal() {
  const r = state.reveal, F = META.fields[r.prompt.key];
  const box = $('#revealRows'); box.innerHTML = '';
  r.rows.forEach((row, i) => {
    const c = META.countries[row.card];
    const d = el('div', 'rev' + (row.winner ? ' win' : ''));
    d.style.animationDelay = (i * 0.25) + 's';
    d.innerHTML = `<div class="crown">${row.winner ? ico('crown') : (row.rank ? row.rank + '位' : '—')}</div><img src="${flagUrl(row.card)}" alt=""><div class="who">${escapeHtml(row.name)}${row.pid === pid ? '（あなた）' : ''}</div><div class="country">${c.name_official}${c.name_official !== c.name ? `<small>${c.name}</small>` : ''}</div><div class="val">${fmtValue(row.value, F.fmt)}</div><div class="rank">${F.label}${row.value == null ? '（データなし＝敗北）' : ''}</div>`;
    d.style.cursor = 'pointer'; d.onclick = () => showCountry(row.card);
    box.appendChild(d);
  });
  const winners = r.rows.filter(x => x.winner).map(x => x.name);
  const label = state.round >= state.total_rounds ? '最終結果' : `次のラウンド（${state.round + 1} / ${state.total_rounds}）`;
  const tick = () => {
    if (!state) { stopTimer(); return; }
    const left = state.next_at ? Math.max(0, Math.ceil(state.next_at - Date.now() / 1000)) : 0;
    $('#nextCountdown').textContent = `${left}秒後に${label}へ`;
  };
  tick(); revealInterval = setInterval(tick, 250);
  $('#revealArea').querySelector('h3').textContent = winners.length ? `${winners.join('・')} が1点獲得！（カードをクリックで裏面の全データ）` : '全員データなし… 引き分け';
}

function renderEnd() {
  const ol = $('#finalList'); ol.innerHTML = '';
  const sorted = state.players.filter(p => !p.spectator).sort((a, b) => b.score - a.score);
  const top = sorted[0]?.score;
  sorted.forEach((p, i) => {
    const won = p.won.map(id => META.prompts.find(x => x.id === id)?.text.replace('は？', '')).filter(Boolean);
    ol.appendChild(el('li', '', `${p.score === top ? ico('crown') + ' ' : ''}${escapeHtml(p.name)}${p.pid === pid ? '（あなた）' : ''} — <b>${p.score} 点</b><div class="muted small">${won.join('／') || '—'}</div>`));
  });
  const champs = sorted.filter(p => p.score === top).map(p => p.name);
  $('#endTitle').innerHTML = `${ico('trophy', 'big')} ${escapeHtml(champs.join('・'))} が地理王！`;
  renderHistory();
}

function renderHistory() {
  const box = $('#historyList'); box.innerHTML = '';
  for (const h of (state.history || [])) {
    const F = META.fields[h.prompt.key];
    const d = el('div', 'hround');
    d.appendChild(el('div', 'hprompt', `第${h.round}ラウンド：${escapeHtml(h.prompt.text)}`));
    const cards = el('div', 'hcards');
    for (const r of h.rows) {
      const c = META.countries[r.card];
      const card = el('div', 'hcard' + (r.winner ? ' win' : ''));
      card.innerHTML = `<img src="${flagUrl(r.card, 160)}" alt=""><div>${r.winner ? ico('crown', 'sm') + ' ' : ''}${c.name_official}</div><div class="val">${fmtValue(r.value, F.fmt)}</div><div class="who">${escapeHtml(r.name)}</div>`;
      card.style.cursor = 'pointer'; card.onclick = () => showCountry(r.card);
      cards.appendChild(card);
    }
    d.appendChild(cards); box.appendChild(d);
  }
}

let WORLD = null;
async function loadWorld() {
  if (!WORLD) { try { WORLD = await (await fetch('/static/worldmap.json')).json(); } catch { WORLD = {}; } }
  return WORLD;
}
// 指定した国を強調した世界地図SVGを返す
function worldMapSvg(id, zoom = false) {
  const c = META.countries[id];
  const x = (c.lng + 180) / 360 * 1000, y = (90 - c.lat) / 180 * 500;
  // zoom: その国を中心に 300x200（経度約108°×緯度72°）を切り出す
  const vb = zoom ? `${Math.max(0, Math.min(700, x - 150)).toFixed(0)} ${Math.max(0, Math.min(300, y - 100)).toFixed(0)} 300 200` : '0 40 1000 420';
  let svg = `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${c.name}の位置">`;
  for (const [iso, d] of Object.entries(WORLD || {})) svg += `<path class="land${iso === c.cca3 ? ' played' : ''}" d="${d}"/>`;
  const r = zoom ? 3 : 5, lbl = zoom ? 'lbl' : 'lbl';
  svg += `<circle class="pulse${zoom ? ' small' : ''}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r * 3}"/><circle class="dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}"/>`;
  svg += `<text class="${lbl}" x="${(x + r + 4).toFixed(1)}" y="${(y + 4).toFixed(1)}" ${zoom ? 'font-size="8"' : ''}>${c.name}</text></svg>`;
  return svg;
}

// ---------- タイマー
function renderTimer() {
  stopTimer();
  if (!state.deadline) { $('#timer').classList.add('hidden'); return; }
  $('#timer').classList.remove('hidden');
  const tick = () => {
    if (!state || !state.deadline) { stopTimer(); return; }
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
      const cats = r.categories.map(c => ico(META.categories[c]?.icon || 'flag', 'sm')).join('');
      const status = r.phase === 'lobby' ? `<span class="tag">${ico('clock')}募集中</span>` : `<span class="tag live">${ico('cards')}ラウンド${r.round}進行中・途中参加OK</span>`;
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
    connect(() => send({ type: 'join', room, name: $('#nameInput').value.trim() || localStorage.getItem('geoking_name') || '', ...rejoinInfo() }));
  }
  show('home'); startRoomsPoll();
})();
