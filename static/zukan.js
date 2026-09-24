/* 図鑑: 国旗一覧（検索・地域・並び替え）とランキング閲覧 */
const regionName = (r) => t('r_' + r);
let rankDesc = true;   // ランキングの向き（お題の向きが既定）

function norm(s) { return (s || '').toString().toLowerCase().replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60)); }  // カタカナ→ひらがな

// ---------- 国旗一覧
function renderFlags() {
  const q = norm($('#q').value.trim());
  const region = $('#region').value;
  const sort = $('#sort').value;
  let list = Object.values(META.countries);
  if (region) list = list.filter(c => c.region === region);
  if (q) list = list.filter(c => [c.name, c.name_official, c.name_kana, c.official_kana, c.name_en, c.name_official_en, c.capital].some(x => norm(x).includes(q)));
  if (sort === 'kana') { if (LANG === 'en') list.sort((a, b) => a.name_en.localeCompare(b.name_en)); else list.sort((a, b) => a.kana_rank - b.kana_rank); }
  else list.sort((a, b) => (b[sort] || 0) - (a[sort] || 0));
  $('#flagCount').textContent = t('countries_n', { n: list.length });
  const grid = $('#flagGrid'); grid.innerHTML = '';
  for (const c of list) {
    const card = el('div', 'zcard');
    card.innerHTML = `<img src="${flagUrl(c.id, 160)}" alt="" loading="lazy"><div class="nm">${escapeHtml(cname(c))}</div>`;
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
  $('#rankInfo').textContent = t('rank_info', { prompt: pt(pr), dir: desc ? t('dir_desc') : t('dir_asc'), missing: missing ? t('excluded_missing', { n: missing }) : '', region: region ? t('only_region', { r: regionName(region) }) : '' });
  const ol = $('#rankList'); ol.innerHTML = '';
  // 世界順位は地域で絞っても全体での順位を表示。同値は同じ順位で、次は人数分飛ぶ（1,1,1,4…）
  list.forEach((c, i) => {
    const shown = worldRank(c.id, pr.key, desc ? 'max' : 'min').rank;
    const li = el('li');
    li.innerHTML = `<span class="rk${shown <= 3 ? ' medal' : ''}">${shown}</span><img src="${flagUrl(c.id, 80)}" alt="" loading="lazy"><span class="nm">${escapeHtml(cname(c))}<small>${escapeHtml(coff(c))}${pr.key === 'kana_rank' ? '　' + t('reading') + escapeHtml(c.name_kana) : (pr.key === 'name_len' ? '　' + t('reading') + escapeHtml(c.official_kana) : '')}</small></span><span class="val">${fmtValue(c[pr.key], F.fmt)}</span>`;
    li.onclick = () => { sfx.select(); showCountry(c.id); };
    ol.appendChild(li);
  });
}

// ---------- 起動
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';   // 読み直し・戻るで前のスクロール位置に戻さない
if (/^#(flags|rank)$/.test(location.hash)) history.replaceState(null, '', '#tab-' + location.hash.slice(1));   // 前の版のアドレス（#flags など）で開いたとき、読み込みの最後にその部品まで飛ばないよう先に書き換える
(async function init() {
  trackVisit('zukan');   // 利用ログ（開始・5分ごと・離脱）
  META = await loadMeta();
  // 地域の選択肢
  const fillSelects = () => {
    for (const sel of [$('#region'), $('#rankRegion')]) {
      const cur = sel.value; sel.innerHTML = '';
      sel.appendChild(el('option', '', t('all_regions'))).value = '';
      for (const r of ['Asia', 'Europe', 'Africa', 'Americas', 'Oceania']) { const o = el('option', '', regionName(r)); o.value = r; sel.appendChild(o); }
      sel.value = cur;
    }
    // お題の選択肢（カテゴリごと）
    const ps = $('#promptSel'); const cur = ps.value; ps.innerHTML = '';
    for (const [cat, info] of Object.entries(META.categories)) {
      const g = document.createElement('optgroup'); g.label = catName(info);
      for (const p of META.prompts.filter(p => p.cat === cat)) { const o = el('option', '', pt(p)); o.value = p.id; g.appendChild(o); }
      ps.appendChild(g);
    }
    if (cur) ps.value = cur;
  };
  fillSelects();
  const ps = $('#promptSel');
  window.onLangChange = () => { document.title = t('zukan_title'); RANK_CACHE_CLEAR(); fillSelects(); if ($('#rank').classList.contains('hidden')) renderFlags(); else renderRank(); renderPrefs(); };
  // タブ
  const showTab = (which) => {
    $('#flags').classList.toggle('hidden', which !== 'flags'); $('#rank').classList.toggle('hidden', which !== 'rank');
    $('#tabFlags').classList.toggle('on', which === 'flags'); $('#tabRank').classList.toggle('on', which === 'rank');
    history.replaceState(null, '', '#tab-' + which);   // 画面の部品の id（#flags / #rank）と同じ名前にすると、読み直したときにその部品まで勝手にスクロールして検索欄が隠れる
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
  else showTab(location.hash === '#tab-rank' ? 'rank' : 'flags');
  window.scrollTo(0, 0);   // 開いたときはいつも一番上から（検索欄が見えるように）。前の版の #flags などで開いたときも
  frameReady();
})();
