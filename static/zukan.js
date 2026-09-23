/* 図鑑: 国旗一覧（検索・地域・並び替え）とランキング閲覧 */
const REGION_JA = { Africa: 'アフリカ', Americas: 'アメリカ大陸', Asia: 'アジア', Europe: 'ヨーロッパ', Oceania: 'オセアニア', Antarctic: '南極' };
let rankDesc = true;   // ランキングの向き（お題の向きが既定）

function norm(s) { return (s || '').toString().toLowerCase().replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60)); }  // カタカナ→ひらがな

// ---------- 国旗一覧
function renderFlags() {
  const q = norm($('#q').value.trim());
  const region = $('#region').value;
  const sort = $('#sort').value;
  let list = Object.values(META.countries);
  if (region) list = list.filter(c => c.region === region);
  if (q) list = list.filter(c => [c.name, c.name_official, c.name_kana, c.official_kana, c.name_en, c.capital].some(x => norm(x).includes(q)));
  if (sort === 'kana') list.sort((a, b) => a.kana_rank - b.kana_rank);
  else list.sort((a, b) => (b[sort] || 0) - (a[sort] || 0));
  $('#flagCount').textContent = `${list.length} か国`;
  const grid = $('#flagGrid'); grid.innerHTML = '';
  for (const c of list) {
    const card = el('div', 'zcard');
    card.innerHTML = `<img src="${flagUrl(c.id, 160)}" alt="" loading="lazy"><div class="nm">${escapeHtml(c.name)}</div>`;
    card.onclick = () => { sfx.select(); showCountry(c.id); };
    grid.appendChild(card);
  }
}

// ---------- ランキング
function renderRank() {
  const pr = META.prompts.find(p => p.id === $('#promptSel').value) || META.prompts[0];
  const F = META.fields[pr.key];
  const region = $('#rankRegion').value;
  let list = Object.values(META.countries).filter(c => c[pr.key] != null);
  const all = list.length;
  if (region) list = list.filter(c => c.region === region);
  const desc = (pr.dir === 'max') === rankDesc;   // お題の向きを既定に、反転ボタンで切り替え
  list.sort((a, b) => desc ? b[pr.key] - a[pr.key] : a[pr.key] - b[pr.key]);
  const missing = Object.keys(META.countries).length - all;
  $('#rankInfo').textContent = `${pr.text}　${desc ? '大きい方から' : '小さい方から'}並べています。${missing ? `データなし ${missing} か国は除外。` : ''}${region ? `（${REGION_JA[region] || region}のみ）` : ''}`;
  const ol = $('#rankList'); ol.innerHTML = '';
  // 世界順位は地域で絞っても全体での順位を表示。同値は同じ順位で、次は人数分飛ぶ（1,1,1,4…）
  list.forEach((c, i) => {
    const shown = worldRank(c.id, pr.key, desc ? 'max' : 'min').rank;
    const li = el('li');
    li.innerHTML = `<span class="rk${shown <= 3 ? ' top' : ''}">${shown}</span><img src="${flagUrl(c.id, 80)}" alt="" loading="lazy"><span class="nm">${escapeHtml(c.name)}<small>${escapeHtml(c.name_official)}${pr.key === 'kana_rank' ? '　読み：' + escapeHtml(c.name_kana) : (pr.key === 'name_len' ? '　読み：' + escapeHtml(c.official_kana) : '')}</small></span><span class="val">${fmtValue(c[pr.key], F.fmt)}</span>`;
    li.onclick = () => { sfx.select(); showCountry(c.id); };
    ol.appendChild(li);
  });
}

// ---------- 起動
(async function init() {
  trackVisit('zukan');   // 利用ログ（開始・5分ごと・離脱）
  META = await (await fetch(API + '/api/meta')).json();
  // 地域の選択肢
  for (const sel of [$('#region'), $('#rankRegion')]) {
    sel.appendChild(el('option', '', 'すべての地域')).value = '';
    for (const r of ['Asia', 'Europe', 'Africa', 'Americas', 'Oceania']) { const o = el('option', '', REGION_JA[r]); o.value = r; sel.appendChild(o); }
  }
  // お題の選択肢（カテゴリごと）
  const ps = $('#promptSel');
  for (const [cat, info] of Object.entries(META.categories)) {
    const g = document.createElement('optgroup'); g.label = info.name;
    for (const p of META.prompts.filter(p => p.cat === cat)) { const o = el('option', '', p.text); o.value = p.id; g.appendChild(o); }
    ps.appendChild(g);
  }
  // タブ
  const showTab = (which) => {
    $('#flags').classList.toggle('hidden', which !== 'flags'); $('#rank').classList.toggle('hidden', which !== 'rank');
    $('#tabFlags').classList.toggle('on', which === 'flags'); $('#tabRank').classList.toggle('on', which === 'rank');
    history.replaceState(null, '', '#' + which);
    if (which === 'rank') renderRank(); else renderFlags();
  };
  $('#tabFlags').onclick = () => showTab('flags'); $('#tabRank').onclick = () => showTab('rank');
  ['#q', '#region', '#sort'].forEach(s => $(s).addEventListener('input', renderFlags));
  ['#promptSel', '#rankRegion'].forEach(s => $(s).addEventListener('change', renderRank));
  $('#rankFlip').onclick = () => { rankDesc = !rankDesc; renderRank(); };
  $('#modal').onclick = (e) => { if (e.target.id === 'modal') { $('#modal').classList.add('hidden'); sfx.close(); } };
  $('#q').addEventListener('input', () => sfx.tap());   // 検索の入力中もカチカチ
  const q = new URLSearchParams(location.search);
  if (q.get('prompt')) { ps.value = q.get('prompt'); showTab('rank'); }
  else showTab(location.hash === '#rank' ? 'rank' : 'flags');
})();
