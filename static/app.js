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
  $('#modalBody').innerHTML = `<h2 style="margin-top:0">データ出典</h2><ul class="small" style="padding-left:18px;line-height:1.8">
    <li>国の基本情報・面積・位置: <a href="https://github.com/mledoze/countries" target="_blank" rel="noopener">mledoze/countries</a>（ODbL）</li>
    <li>人口・GDP・平均寿命・降水量・都市人口率など: <a href="https://data.worldbank.org/" target="_blank" rel="noopener">World Bank Open Data</a>（CC BY 4.0）</li>
    <li>宗教構成: Pew Research Center の公表値を参考にした概算</li>
    <li>年平均気温・気候区分: 公開資料（ケッペンの気候区分）を参考にした概算</li>
    <li>国旗画像: <a href="https://flagcdn.com/" target="_blank" rel="noopener">flagcdn.com</a></li>
    <li>ゲームデザインの着想: ウナム日月『国旗王（こっきんぐ）』</li></ul>`;
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
    else if (msg.type === 'toast') toast(msg.message);
    else if (msg.type === 'left') { leaveToHome(msg.message); if (ws) { ws.onclose = null; ws.close(); } }
    else if (msg.type === 'error') {
      sfx.error();
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
$('#lobbyBtn').onclick = () => { if (confirm('ゲームを中断してロビーに戻りますか？\n（得点はリセットされ、設定を変えて再開できます）')) send({ type: 'to_lobby' }); };
$('#leaveBtn').onclick = () => { if (confirm('この部屋から退出しますか？')) send({ type: 'leave' }); };
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
  try { await navigator.clipboard.writeText(url); toast('招待リンクをコピーしました'); } catch { prompt('このリンクを共有してください', url); }
};

// ---------- 描画
let prevKey = '', prevChatLen = 0, lastTickSec = null, prevPlayers = null, prevRoom = null;
const seenChat = new Set(); let chatPrimed = false;   // 画面を流れるチャットの重複防止

// チャットを画面の下から上へ流す（名前＋本文）
function floatChat(c) {
  const me = state && state.players.find(p => p.pid === pid);
  const d = el('div', 'floatmsg' + (c.name === 'システム' ? ' sys' : (me && c.pid === pid ? ' me' : '')));
  d.innerHTML = `<b>${escapeHtml(c.name)}</b>${escapeHtml(c.text)}`;
  d.style.setProperty('--x', (4 + Math.random() * 50).toFixed(0) + '%');
  const olds = document.querySelectorAll('.floatmsg'); if (olds.length >= 8) olds[0].remove();
  document.body.appendChild(d);
  d.addEventListener('animationend', () => d.remove());
}
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
    if (c.pid !== pid && c.name !== 'システム') ding = true;
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
  $('#roomInfo').classList.remove('hidden'); $('#roomCode').textContent = state.room; $('#roomTitle').textContent = state.title || '';
  $('#lobbyBtn').classList.toggle('hidden', !(isHost && (state.phase === 'pick' || state.phase === 'reveal')));

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
    sl.appendChild(el('li', '', `<span>${p.pid !== pid && !p.is_bot ? `<b class="who" data-pid="${p.pid}" title="通報・ミュート">${escapeHtml(p.name)}</b>` : escapeHtml(p.name)}${playerTag(p)}</span><b>${p.spectator ? '—' : p.score + ' 点'}${state.phase === 'pick' && !p.spectator ? (p.picked ? ico('check', 'sm status-ico') : ico('clock', 'sm status-ico')) : ''}</b>`));
  }
  // チャット
  sl.querySelectorAll('.who').forEach(b => b.onclick = () => showPlayerMenu(b.dataset.pid));
  const log = $('#chatLog'); const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 10;
  log.innerHTML = state.chat.map(c => `<div>${c.pid && c.pid !== pid ? `<b class="who" data-pid="${c.pid}" title="通報・ミュート">${escapeHtml(c.name)}</b>` : `<b>${escapeHtml(c.name)}</b>`} ${escapeHtml(c.text)}</div>`).join('');
  log.querySelectorAll('.who').forEach(b => b.onclick = () => showPlayerMenu(b.dataset.pid));
  if (atBottom) log.scrollTop = log.scrollHeight;

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
    ? `${state.settings.show_names ? '「' + countryName(picked) + '」' : 'カード'}を出しました。全員が出すまでは、別のカードを2回クリックで変更できます`
    : (state.hand.length ? 'お題に一番合うと思う国旗を1枚選ぼう（2回クリックで決定）' : '手札がありません。次のゲームから参加できます');
  for (const id of state.hand) {
    const cls = 'flagcard' + (id === picked ? ' picked' : '') + (id === selectedCard && id !== picked ? ' selected' : '');
    const c = el('div', cls);
    c.innerHTML = `<img src="${flagUrl(id)}" alt="国旗" loading="lazy"><div class="nm">${state.settings.show_names ? countryName(id) : (id === picked ? '出したカード' : '&nbsp;')}</div>`;
    c.onclick = () => {
      if (id === picked) return;                       // すでに出しているカード
      if (selectedCard === id) { send({ type: 'pick', card: id }); selectedCard = null; sfx.confirm(); return; }   // 2回目で決定・変更
      selectedCard = id;
      sfx.select();
      send({ type: 'selecting', card: id });
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
  const live = state.live;   // 観戦者にだけ届く
  box.appendChild(el('h4', '', live ? 'みんなの手札（観戦モード：選んでいるカードが見えます）' : 'みんなの手札（何を出したかは公開まで分かりません）'));
  for (const p of others) {
    const row = el('div', 'orow' + (live ? ' live' : ''));
    const lv = live ? live[p.pid] : null;
    let bubble = '';
    if (lv) {
      const st = lv.pick ? 'go' : (lv.selecting ? 'sel' : 'think');
      bubble = `<span class="bubble ${st}">${lv.pick ? '勝負！' : (lv.selecting ? '選択中…' : '考え中…')}</span>`;
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
  if (rank === 1) return { cls: ' gold', tag: `${ico('crown', 'sm')} 世界1位！` };
  if (rank <= 10) return { cls: ' silver', tag: `${ico('trophy', 'sm')} トップ10！` };
  if (rank <= 30) return { cls: ' bronze', tag: `${ico('star', 'sm')} トップ30！` };
  return { cls: '', tag: '' };
}
function wrankHtml(rank, total) {
  if (!rank) return '';
  const t = wrankTier(rank);
  return `<div class="wrank${t.cls}">${t.tag ? `<em>${t.tag}</em>` : ''}世界 <b>${rank}</b> 位 <span>／ ${total}か国</span></div>`;
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
    d.innerHTML = `<div class="crown">${row.winner ? ico('crown') : (row.rank ? row.rank + '位' : '—')}</div><img src="${flagUrl(row.card)}" alt=""><div class="who">${escapeHtml(row.name)}${row.pid === pid ? '（あなた）' : ''}</div><div class="country">${c.name_official}${r.prompt.key === 'kana_rank' ? `<small>読み：${c.name_kana}</small>` : (r.prompt.key === 'name_len' ? `<small>読み：${c.official_kana}</small>` : (c.name_official !== c.name ? `<small>${c.name}</small>` : ''))}</div><div class="val">${fmtValue(row.value, F.fmt)}</div><div class="rank">${F.label}${row.missing ? '（データなし＝0として比較）' : ''}</div>${wrankHtml(row.world_rank, row.world_total)}`;
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
      card.innerHTML = `<img src="${flagUrl(r.card, 160)}" alt=""><div>${r.winner ? ico('crown', 'sm') + ' ' : ''}${c.name_official}</div><div class="val">${fmtValue(r.value, F.fmt)}</div>${r.world_rank ? `<div class="who${wrankTier(r.world_rank).cls ? ' hot' + wrankTier(r.world_rank).cls : ''}">世界 ${r.world_rank} 位／${r.world_total}か国</div>` : ''}<div class="who">${escapeHtml(r.name)}</div>`;
      card.style.cursor = 'pointer'; card.onclick = () => showCountry(r.card);
      cards.appendChild(card);
    }
    d.appendChild(cards); box.appendChild(d);
  }
  // 使わなかった手札（各プレイヤーに1枚以上残る）
  const left = state.leftover || {};
  if (Object.keys(left).length) {
    const d = el('div', 'hround');
    d.appendChild(el('div', 'hprompt', '使わなかったカード'));
    const cards = el('div', 'hcards');
    for (const p of state.players) {
      for (const id of (left[p.pid] || [])) {
        const c = META.countries[id];
        const card = el('div', 'hcard rest');
        card.innerHTML = `<img src="${flagUrl(id, 160)}" alt=""><div>${c.name_official}</div><div class="who">${escapeHtml(p.name)}</div>`;
        card.style.cursor = 'pointer'; card.onclick = () => showCountry(id);
        cards.appendChild(card);
      }
    }
    d.appendChild(cards); box.appendChild(d);
  }
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

// ---------- 通報・ミュート
function showPlayerMenu(targetPid) {
  const p = state.players.find(x => x.pid === targetPid); if (!p) return;
  const muted = (state.muted || []).includes(targetPid);
  $('#modalBody').classList.remove('wide');
  $('#modalBody').innerHTML = `<h2 style="margin-top:0">${escapeHtml(p.name)} さん</h2>
    <p class="small muted">迷惑な発言があった場合は通報してください。ミュートすると、この人の発言があなたの画面に表示されなくなります（相手には通知されません）。</p>
    <div class="row"><button id="pmMute">${muted ? 'ミュートを解除' : 'ミュートする'}</button><button id="pmReport" class="danger">通報する</button></div>
    <div id="pmReasons" class="row hidden"><span class="small">理由：</span><button class="mini" data-r="暴言・差別">暴言・差別</button><button class="mini" data-r="迷惑行為">迷惑行為</button><button class="mini" data-r="個人情報・勧誘">個人情報・勧誘</button><button class="mini" data-r="その他">その他</button></div>`;
  $('#modal').classList.remove('hidden');
  $('#pmMute').onclick = () => { send({ type: 'mute', pid: targetPid, on: !muted }); $('#modal').classList.add('hidden'); toast(muted ? 'ミュートを解除しました' : 'ミュートしました'); };
  $('#pmReport').onclick = () => $('#pmReasons').classList.remove('hidden');
  $('#pmReasons').querySelectorAll('button').forEach(b => b.onclick = () => { send({ type: 'report', pid: targetPid, reason: b.dataset.r }); $('#modal').classList.add('hidden'); });
}

// ---------- 招待リンクの確認ポップアップ
async function showInvite(code) {
  let info = null;
  try { const res = await fetch(`${API}/api/room/${code}`); if (res.ok) info = await res.json(); } catch {}
  if (!info) { toast('その部屋は見つかりませんでした（終了したか、コードが違います）'); return; }
  const status = info.phase === 'lobby' ? '募集中' : (info.phase === 'end' ? '結果発表中（次のゲームから参加）' : `ラウンド${info.round}進行中（観戦で入ります）`);
  const saved = localStorage.getItem('geoking_name') || '';
  $('#modalBody').innerHTML = `
    <h2 style="margin-top:0">${ico('door')} この部屋に参加しますか？</h2>
    <div class="invitebox">
      <div class="invtitle">${escapeHtml(info.title)}</div>
      <div class="muted small">ホスト: ${escapeHtml(info.host)} ／ ${info.players} / ${info.max} 人 ／ <span class="tag">${status}</span></div>
      <div class="small" style="margin-top:6px">${info.names.map(nm => `<span class="tag">${escapeHtml(nm)}</span>`).join(' ')}</div>
    </div>
    <label>あなたの名前（必須）<input id="inviteName" maxlength="16" placeholder="ニックネームを入力" value="${escapeHtml(saved)}"></label>
    <div class="row"><button id="inviteJoin" class="primary">参加する</button><button id="inviteCancel">やめる</button></div>`;
  $('#modalBody').classList.remove('wide'); $('#modal').classList.remove('hidden');
  const close = () => $('#modal').classList.add('hidden');
  $('#inviteCancel').onclick = close;
  const go = () => {
    const name = $('#inviteName').value.trim();
    if (!name) { toast('名前を入力してください'); $('#inviteName').focus(); return; }
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
