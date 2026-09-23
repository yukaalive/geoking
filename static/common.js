/* 地理王 共通処理（対戦画面 app.js と 図鑑 zukan.js で共用）
   - API 基点、DOM ヘルパー、値の表示形式、国データの小窓（データ＋世界順位＋地図） */
const API = (window.GEOKING_SERVER || '').replace(/\/$/, '');
const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
let META = null;          // countries, fields, categories, prompts（/api/meta）

const flagUrl = (id, w = 320) => `https://flagcdn.com/w${w}/${id}.png`;
const ico = (name, cls = '') => `<svg class="ico ${cls}" aria-hidden="true"><use href="/static/icons.svg?v=2#${name}"/></svg>`;
function stars(n) { return `<span class="stars">${ico('star').repeat(n)}${ico('star-off').repeat(3 - n)}</span>`; }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
function toast(msg) { const t = $('#toast'); if (!t) return; t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 2600); }
function countryName(id) { const c = META.countries[id]; return c ? c.name : id; }

function fmtValue(v, fmt) {
  if (v == null) return 'データなし';
  const n = Number(v);
  switch (fmt) {
    case 'km2': return n.toLocaleString('ja-JP', { maximumFractionDigits: 0 }) + ' km²';
    case 'people': return n >= 1e8 ? (n / 1e8).toFixed(2) + '億人' : n >= 1e4 ? (n / 1e4).toFixed(1) + '万人' : n.toLocaleString('ja-JP') + '人';
    case 'usd': return n >= 1e12 ? (n / 1e12).toFixed(2) + '兆ドル' : n >= 1e8 ? (n / 1e8).toFixed(0) + '億ドル' : (n / 1e6).toFixed(0) + '百万ドル';
    case 'usd_small': return n.toLocaleString('ja-JP', { maximumFractionDigits: 0 }) + ' ドル';
    case 'chars': return n + ' 文字';
    case 'density': return n.toLocaleString('ja-JP', { maximumFractionDigits: 1 }) + ' 人/km²';
    case 'kana_rank': return `五十音順 ${n} 番目`;
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

// 指標ごとの世界順位（大きい順）。データがある国の中での順位と母数を返す
const RANK_CACHE = {};
function worldRank(id, key) {
  if (!RANK_CACHE[key]) {
    const vals = Object.values(META.countries).map(c => c[key]).filter(v => v != null).sort((a, b) => b - a);
    RANK_CACHE[key] = vals;
  }
  const v = META.countries[id][key]; if (v == null) return null;
  const vals = RANK_CACHE[key];
  return { rank: vals.findIndex(x => x <= v) + 1, total: vals.length };
}

// ---------- 世界地図
let WORLD = null;
async function loadWorld() {
  if (!WORLD) { try { WORLD = await (await fetch('/static/worldmap.json')).json(); } catch { WORLD = {}; } }
  return WORLD;
}
// 指定した国を強調した世界地図SVG（zoom: その国を中心に切り出し）
function worldMapSvg(id, zoom = false) {
  const c = META.countries[id];
  const x = (c.lng + 180) / 360 * 1000, y = (90 - c.lat) / 180 * 500;
  const vb = zoom ? `${Math.max(0, Math.min(700, x - 150)).toFixed(0)} ${Math.max(0, Math.min(300, y - 100)).toFixed(0)} 300 200` : '0 40 1000 420';
  let svg = `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${c.name}の位置">`;
  for (const [iso, d] of Object.entries(WORLD || {})) svg += `<path class="land${iso === c.cca3 ? ' played' : ''}" d="${d}"/>`;
  const r = zoom ? 3 : 5;
  svg += `<circle class="pulse${zoom ? ' small' : ''}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r * 3}"/><circle class="dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}"/>`;
  svg += `<text class="lbl" x="${(x + r + 4).toFixed(1)}" y="${(y + 4).toFixed(1)}" ${zoom ? 'font-size="8"' : ''}>${c.name}</text></svg>`;
  return svg;
}

// ---------- 国データの小窓（カード裏面）: 全指標＋世界順位＋地図
const COUNTRY_GROUPS = [
  ['基本', ['area', 'population', 'density', 'gdp', 'gdp_pc', 'eez', 'name_len', 'kana_rank', 'lat', 'lng', 'borders', 'languages', 'military']],
  ['気候・自然', ['temp', 'precip', 'forest_pct', 'agri_pct', 'co2_pc']],
  ['宗教', ['rel_chr', 'rel_mus', 'rel_bud', 'rel_hin', 'rel_non', 'rel_folk', 'rel_jew', 'rel_div']],
  ['社会・暮らし', ['life_exp', 'age65_pct', 'fertility', 'urban_pct', 'internet_pct', 'tourists', 'physicians', 'elec_pct']],
];
const NO_RANK_KEYS = new Set(['kana_rank', 'lat', 'lng']);
function showCountry(id) {
  const c = META.countries[id]; if (!c) return;
  const F = META.fields;
  let info = `<div style="display:flex;gap:14px;align-items:flex-start"><img src="${flagUrl(id)}" alt=""><div><h2 style="margin:0">${c.name_official}</h2><div class="muted">読み：${c.official_kana}<br>${c.name_official !== c.name ? c.name + '<br>' : ''}${c.name_en} ／ ${c.subregion}<br>首都: ${c.capital || '—'}${c.landlocked ? '（内陸国）' : ''}</div></div></div><div class="dl">`;
  for (const [title, keys] of COUNTRY_GROUPS) {
    info += `<div class="sec">${title}</div>`;
    for (const k of keys) {
      const wr = NO_RANK_KEYS.has(k) ? null : worldRank(id, k);
      info += `<div class="k">${F[k].label}</div><div class="v">${fmtValue(c[k], F[k].fmt)}${wr ? `<span class="r">${wr.rank}位/${wr.total}</span>` : ''}</div>`;
    }
  }
  info += '</div>';
  $('#modalBody').innerHTML = `<div class="modalgrid"><div class="minfo">${info}</div><div class="mmap worldmap"><div class="muted small">地図を読み込み中…</div></div></div>`;
  $('#modal').classList.remove('hidden');
  $('#modalBody').classList.add('wide');
  loadWorld().then(() => { const box = $('#modalBody .mmap'); if (box) box.innerHTML = `<div class="muted small" style="margin-bottom:4px">世界の中の位置</div>` + worldMapSvg(id) + `<div class="muted small" style="margin:10px 0 4px">周辺を拡大</div>` + worldMapSvg(id, true) + `<div class="muted small" style="margin-top:6px">${c.lat >= 0 ? '北緯' : '南緯'} ${Math.abs(c.lat).toFixed(1)}°　${c.lng >= 0 ? '東経' : '西経'} ${Math.abs(c.lng).toFixed(1)}°</div>`; });
}
if ($('#modalClose')) $('#modalClose').onclick = () => { $('#modal').classList.add('hidden'); if (typeof sfx !== 'undefined') sfx.close(); };

// ---------- 利用ログ（ざっくり）: 開いた時・5分ごと・離れた時に、画面の種類とニックネーム・滞在秒数をサーバーへ送る
function trackVisit(mode) {
  const id = Math.random().toString(36).slice(2, 10), t0 = Date.now();
  const post = (event) => {
    const body = JSON.stringify({ id, mode, event, name: localStorage.getItem('geoking_name') || '', sec: Math.round((Date.now() - t0) / 1000) });
    try {
      if (event === 'leave' && navigator.sendBeacon) navigator.sendBeacon(API + '/api/visit', new Blob([body], { type: 'application/json' }));
      else fetch(API + '/api/visit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
    } catch {}
  };
  post('start');
  setInterval(() => { if (document.visibilityState !== 'hidden') post('ping'); }, 5 * 60 * 1000);
  let hidden = false;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { if (!hidden) { hidden = true; post('leave'); } }
    else hidden = false;
  });
  window.addEventListener('pagehide', () => { if (!hidden) { hidden = true; post('leave'); } });
  window.addEventListener('beforeunload', () => { if (!hidden) { hidden = true; post('leave'); } });
}
