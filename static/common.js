/* 地理王 共通処理（対戦画面 app.js と 図鑑 zukan.js で共用）
   - API 基点、DOM ヘルパー、値の表示形式、国データの小窓（データ＋世界順位＋地図） */
const API = (window.GEOKING_SERVER || '').replace(/\/$/, '');
// アプリ内フレームに表示されているとき: 画面上下の余白(充電表示など)は外側のフレームが空けるので、ページ側では空けない
if (window.self !== window.top) document.documentElement.classList.add('inframe');
const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
let META = null;          // countries, fields, categories, prompts（/api/meta）
let META_AT = 0;          // 国データを通信で取った時刻
// 国データを読み込む。アプリ内フレームでは、外側のページが読み込み済みのものを写して使う（大きな通信を1回省いて早く開く）
async function loadMeta() {
  try {
    const shared = window.top !== window && typeof window.parent.sharedMeta === 'function' && window.parent.sharedMeta();
    if (shared && typeof structuredClone === 'function') return structuredClone(shared);
  } catch (e) { /* 外側が読めないときは通信で取る */ }
  const m = await (await fetch(API + '/api/meta')).json();
  META_AT = Date.now();
  return m;
}
// 外側のページとして国データを貸す。アプリは何日も開いたままのことがあるので、10分より古ければ貸さず（フレームが自分で取る）、次回用に裏で取り直す
let metaRefreshing = false;
window.sharedMeta = () => {
  if (META && Date.now() - META_AT < 10 * 60 * 1000) return META;
  if (META && !metaRefreshing) {
    metaRefreshing = true;
    fetch(API + '/api/meta').then(r => r.json()).then(m => { META = m; META_AT = Date.now(); RANK_CACHE_CLEAR(); }).catch(() => {}).finally(() => { metaRefreshing = false; });
  }
  return null;
};
// アプリ内フレームに表示されたページが、表示の準備ができたことを外側に知らせる（外側はそれまで今の画面を見せておく）
// 文言の差し替えは本来 DOMContentLoaded だが、その前に表示されると一瞬日本語が見えるので、合図の前に済ませる
const frameReady = () => { if (window.top === window) return; if (typeof applyI18n === 'function') applyI18n(); window.parent.postMessage('geoking:ready', '*'); };

const flagUrl = (id, w = 320) => `https://flagcdn.com/w${w}/${id}.png`;
const ico = (name, cls = '') => `<svg class="ico ${cls}" aria-hidden="true"><use href="/static/icons.svg?v=2#${name}"/></svg>`;
function stars(n) { return `<span class="stars">${ico('star').repeat(n)}${ico('star-off').repeat(3 - n)}</span>`; }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
function toast(msg) { const t = $('#toast'); if (!t) return; t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 2600); }
function countryName(id) { const c = META.countries[id]; return c ? c.name : id; }

function fmtValue(v, fmt) {
  if (v == null) return t('no_data');
  const n = Number(v);
  if (LANG === 'en') return fmtValueEn(n, fmt, v);
  switch (fmt) {
    case 'km2': return n.toLocaleString('ja-JP', { maximumFractionDigits: 0 }) + ' km²';
    case 'people': return n >= 1e8 ? (n / 1e8).toFixed(2) + '億人' : n >= 1e4 ? (n / 1e4).toFixed(1) + '万人' : n.toLocaleString('ja-JP') + '人';
    case 'usd': return n >= 1e12 ? (n / 1e12).toFixed(2) + '兆ドル' : n >= 1e8 ? (n / 1e8).toFixed(0) + '億ドル' : (n / 1e6).toFixed(0) + '百万ドル';
    case 'usd_small': return n.toLocaleString('ja-JP', { maximumFractionDigits: 0 }) + ' ドル';
    case 'chars': return n + ' 文字';
    case 'text': return climateText(v);
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

// 英語表示の単位
function fmtValueEn(n, fmt, v) {
  const loc = (x, d = 0) => x.toLocaleString('en-US', { maximumFractionDigits: d });
  switch (fmt) {
    case 'km2': return loc(n) + ' km²';
    case 'people': return n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(0) + 'K' : loc(n);
    case 'usd': return n >= 1e12 ? '$' + (n / 1e12).toFixed(2) + 'T' : n >= 1e9 ? '$' + (n / 1e9).toFixed(1) + 'B' : '$' + (n / 1e6).toFixed(0) + 'M';
    case 'usd_small': return '$' + loc(n);
    case 'chars': return n + (n === 1 ? ' char' : ' chars');
    case 'density': return loc(n, 1) + ' /km²';
    case 'kana_rank': return `#${n} in kana order`;
    case 'lat': return Math.abs(n).toFixed(1) + '° ' + (n >= 0 ? 'N' : 'S');
    case 'lng': return Math.abs(n).toFixed(1) + '° ' + (n >= 0 ? 'E' : 'W');
    case 'deg': return n.toFixed(1) + '°';
    case 'countries': return n + (n === 1 ? ' country' : ' countries');
    case 'langs': return n + (n === 1 ? ' language' : ' languages');
    case 'temp': return n.toFixed(1) + ' °C';
    case 'mm': return loc(n) + ' mm';
    case 'pct': return n.toFixed(1) + ' %';
    case 'ton': return n.toFixed(2) + ' t';
    case 'years': return n.toFixed(1) + ' yrs';
    case 'float2': return n.toFixed(2);
    case 'text': return climateText(v);
    default: return String(v);
  }
}

// 指標ごとの世界順位（大きい順）。データがある国の中での順位と母数を返す
const RANK_CACHE = {};
const RANK_CACHE_CLEAR = () => { for (const k of Object.keys(RANK_CACHE)) delete RANK_CACHE[k]; };
// dir='max' は大きい順、'min' は小さい順。同値は同じ順位（1,1,1,4… の方式。サーバーの出す世界順位と同じ）
const roundVal = (key, v) => { const d = (META.fields[key] && META.fields[key].dec) ?? 2; const m = 10 ** d; return Math.round(v * m) / m; };
function worldRank(id, key, dir = 'max') {
  if (!RANK_CACHE[key]) {
    RANK_CACHE[key] = Object.values(META.countries).map(c => c[key]).filter(v => v != null).map(v => roundVal(key, v));   // 表示桁で丸めて比較
  }
  const raw = META.countries[id][key]; if (raw == null) return null;
  const v = roundVal(key, raw);
  const vals = RANK_CACHE[key];
  const better = dir === 'max' ? vals.filter(x => x > v).length : vals.filter(x => x < v).length;
  return { rank: better + 1, total: vals.length };
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
  let svg = `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${cname(c)}">`;
  for (const [iso, d] of Object.entries(WORLD || {})) svg += `<path class="land${iso === c.cca3 ? ' played' : ''}" d="${d}"/>`;
  const r = zoom ? 3 : 5;
  svg += `<circle class="pulse${zoom ? ' small' : ''}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r * 3}"/><circle class="dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}"/>`;
  svg += `<text class="lbl" x="${(x + r + 4).toFixed(1)}" y="${(y + 4).toFixed(1)}" ${zoom ? 'font-size="8"' : ''}>${cname(c)}</text></svg>`;
  return svg;
}

// ---------- 国データの小窓（カード裏面）: 全指標＋世界順位＋地図
// 表示するのはお題（prompts.py）で使う指標だけ。お題にない指標は一覧から自動で外れる
const COUNTRY_GROUPS = [
  ['g_basic', ['area', 'population', 'density', 'gdp', 'gdp_pc', 'eez', 'name_len', 'kana_rank', 'lat', 'lng', 'borders', 'military']],
  ['g_climate', ['climate', 'temp', 'forest_pct', 'agri_pct', 'co2_pc']],
  ['g_religion', ['rel_chr', 'rel_mus', 'rel_bud', 'rel_hin', 'rel_non', 'rel_folk', 'rel_jew', 'rel_div']],
  ['g_society', ['life_exp', 'age65_pct', 'fertility', 'urban_pct', 'internet_pct', 'tourists', 'physicians', 'elec_pct']],
];
const NO_RANK_KEYS = new Set(['kana_rank', 'lat', 'lng', 'climate']);
const EXTRA_KEYS = new Set(['climate']);   // お題にはないが表示する指標
function showCountry(id) {
  const c = META.countries[id]; if (!c) return;
  const F = META.fields;
  const sub = LANG === 'en' ? `${c.name_official_en !== c.name_en ? c.name_en + '<br>' : ''}${c.name} ／ ${c.subregion}` : `${t('reading')}${c.official_kana}<br>${c.name_en} ／ ${c.subregion}`;
  let info = `<div class="chead"><img class="cflag" src="${flagUrl(id)}" alt=""><h2>${coff(c)}</h2><div class="muted csub">${sub}<br>${t('capital')}: ${(LANG === 'en' ? c.capital : (c.capital_ja || c.capital)) || '—'}${c.landlocked ? t('landlocked') : ''}</div></div><div class="dl">`;
  const used = new Set(META.prompts.map(p => p.key));
  for (const [title, allKeys] of COUNTRY_GROUPS) {
    const keys = allKeys.filter(k => (used.has(k) || EXTRA_KEYS.has(k)) && F[k]);
    if (!keys.length) continue;
    info += `<div class="sec">${t(title)}</div>`;
    for (const k of keys) {
      const wr = NO_RANK_KEYS.has(k) ? null : worldRank(id, k);
      info += `<div class="k">${flabel(F[k])}</div><div class="v">${fmtValue(c[k], F[k].fmt)}${wr ? `<span class="r">${t('rank_of', { rank: wr.rank, total: wr.total })}</span>` : ''}</div>`;
    }
  }
  info += '</div>';
  $('#modalBody').innerHTML = `<div class="modalgrid"><div class="minfo">${info}</div><div class="mmap worldmap"><div class="muted small">${t('map_loading')}</div></div></div>`;
  $('#modal').classList.remove('hidden');
  $('#modalBody').classList.add('wide');
  $('#modal .modalbox').scrollTop = 0;   // 別の国を開いたときも一番上から（前に開いた国を下まで見ていると、途中から開いていた）
  loadWorld().then(() => { const box = $('#modalBody .mmap'); if (box) box.innerHTML = `<div class="muted small" style="margin-bottom:4px">${t('world_pos')}</div>` + worldMapSvg(id) + `<div class="muted small" style="margin:10px 0 4px">${t('zoom_in')}</div>` + worldMapSvg(id, true) + `<div class="muted small" style="margin-top:6px">${fmtValue(c.lat, 'lat')}　${fmtValue(c.lng, 'lng')}</div>`; });
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
