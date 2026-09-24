/* 地理王 多言語（日本語・英語）。common.js より先に読み込む。
   - LANG: 'ja' | 'en'。保存値 → ブラウザの言語 → 日本語 の順で決める
   - t(key, params): 文言を返す。{name} のような差し込みに対応
   - applyI18n(): data-i18n / data-i18n-ph / data-i18n-title を付けた要素の文言を差し替える
   - setLang(lang): 切り替えて保存。各画面は window.onLangChange で再描画する */
const I18N = {
  ja: {
    app_title: '地理王', tagline: '国旗から、どんな国かを推測せよ！', your_name: 'あなたの名前（必須）', name_ph: 'ニックネームを入力',
    create_room: '部屋を作る', code_ph: '部屋コード', join: '参加する', learn_zukan: '図鑑で学ぶ', public_rooms: '募集中の公開部屋', refresh: '更新',
    loading: '読み込み中…', public_rooms_note: '世界のどこかの誰かが作った部屋に飛び入りできます。自分の部屋を載せるにはロビーで「公開部屋にする」をオンに。',
    demo_prompt: 'お題', demo_q: '面積が大きい国は？', demo_win: 'ブラジル 851万km²', c_br: 'ブラジル', c_jp: '日本', c_mn: 'モンゴル', c_mt: 'マルタ',
    v_br: '851万km²', v_jp: '37.8万km²', v_mn: '156万km²', v_mt: '316km²',
    players: 'プレイヤー', add_bot: 'ボットを追加', lobby_note_pre: '部屋コード ', lobby_note_post: ' を友だちに伝えるか、招待リンクを共有してください。ゲームが始まったあとでも途中参加できます。ゲーム中でもホストは右上の「ロビーへ」で中断して設定を変えられます。',
    room_settings: '部屋の設定', host_only: '（ホストのみ変更できます）', room_name: '部屋の名前', room_title_ph: '例：ゆかの部屋',
    public_room_label: '公開部屋にする（トップページの一覧に載せて誰でも参加可）',
    settings_note: '7ラウンド・手札8枚・回答は1問30秒（時間切れはランダムに出ます）。お題は「基本・気候・宗教・社会」からランダムに出ます。',
    start_game: 'ゲーム開始', start_need2: 'ゲーム開始（2人以上必要・ボット可）', start_rounds: 'ゲーム開始（{n}ラウンド）', waiting_host_start: 'ホストが開始するのを待っています…',
    round: 'ラウンド', pick_title: 'お題に一番合うと思う国旗を1枚選ぼう', pick_hint: 'お題に一番合うと思う国旗を1枚選ぼう（2回クリックで決定）',
    spectating: '観戦中', spectate_note: 'このゲームは観戦です。次のゲームから参加できます。みんなの手札で、誰がどのカードを選んでいるかがリアルタイムで見えます。',
    result: '結果', score: 'スコア', chat: 'チャット', chat_ph: 'メッセージを入力', send: '送信', final_results: '結果発表', played_list: '出された国の一覧',
    rematch: '同じメンバーでもう一戦', to_lobby_settings: 'ロビーに戻って設定を変える', waiting_host: 'ホストの操作を待っています…',
    code: 'コード', copy_invite: '招待リンクをコピー', lobby_btn: 'ロビーへ', leave: '退出', sources: 'データ出典', privacy: 'プライバシーポリシー',
    sound_title: '効果音・振動', sound_on: '効果音・振動: オン', sound_off: '効果音・振動: オフ', lang_btn: 'EN',
    // 対戦画面（JS）
    conn_lost_reload: 'サーバーに接続できません。ページを再読み込みしてください', reconnecting: '接続が切れました。再接続します…',
    enter_name: '名前を入力してください', enter_code4: '4文字の部屋コードを入力してください',
    confirm_to_lobby: 'ゲームを中断してロビーに戻りますか？\n（得点はリセットされ、設定を変えて再開できます）', confirm_leave: 'この部屋から退出しますか？',
    link_copied: '招待リンクをコピーしました', share_this_link: 'このリンクを共有してください', system: 'システム', report_mute: '通報・ミュート',
    tag_host: 'ホスト', tag_off: '切断', tag_spec: '観戦', tag_you: 'あなた', kick: '退出', difficulty: '難易度', pts: '点',
    played_msg: '{card}を出しました。全員が出すまでは、別のカードを2回クリックで変更できます', card_word: 'カード', no_hand: '手札がありません。次のゲームから参加できます',
    played_card: '出したカード', flag_alt: '国旗', confirm_change: 'このカードに変更する？', confirm_play: 'この国旗を出す？', once_more: 'もう一度クリックで決定',
    others_live: 'みんなの手札（観戦モード：選んでいるカードが見えます）', others_hidden: 'みんなの手札（何を出したかは公開まで分かりません）',
    bubble_pick: '勝負！', bubble_selecting: '選択中…', bubble_thinking: '考え中…',
    world_first: '世界1位！', top10: 'トップ10！', top30: 'トップ30！', world_rank: '世界 <b>{n}</b> 位 <span>／ {total}か国</span>', world_rank_plain: '世界 {n} 位／{total}か国',
    rank_n: '{n}位', you_paren: '（あなた）', reading: '読み：', missing_zero: '（データなし＝0として比較）',
    final_label: '最終結果', next_round: '次のラウンド（{n} / {total}）', next_in: '{sec}秒後に{label}へ', won_point: '{names} が1点獲得！', draw_nodata: '全員データなし… 引き分け',
    is_champion: '{names} が地理王！', prompt_col: 'お題', round_short: '第{n}R', leftover_row: '<b>残り</b>使わなかったカード', sec: '{n}秒', names_sep: '・',
    no_public_rooms: 'いま募集中の部屋はありません。部屋を作って「公開部屋にする」をオンにすると、ここに表示されます。', recruiting: '募集中',
    in_progress: 'ラウンド{n}進行中・途中参加OK', room_of: '{name}の部屋', by: 'by', players_n: '{n}/8人', rounds_short: '{n}R', rooms_fetch_failed: '一覧を取得できませんでした',
    mute: 'ミュートする', unmute: 'ミュートを解除', report: '通報する', reason: '理由：', r_abuse: '暴言・差別', r_harass: '迷惑行為', r_personal: '個人情報・勧誘', r_other: 'その他',
    muted_toast: 'ミュートしました', unmuted_toast: 'ミュートを解除しました', san: ' さん',
    menu_note: '迷惑な発言があった場合は通報してください。ミュートすると、この人の発言があなたの画面に表示されなくなります（相手には通知されません）。',
    room_not_found_toast: 'その部屋は見つかりませんでした（終了したか、コードが違います）', status_recruiting: '募集中', status_end: '結果発表中（次のゲームから参加）',
    status_round: 'ラウンド{n}進行中（観戦で入ります）', join_room_q: 'この部屋に参加しますか？', host_label: 'ホスト', people: ' 人', invite_cancel: 'やめる',
    // サーバーからのメッセージ（code で切り替え）
    e_room_full_global: '現在満室です。しばらくしてからお試しください', e_room_not_found: 'その部屋コードは見つかりません', e_reauth_failed: '再接続の認証に失敗しました',
    e_room_full: '満員です（最大8人）', e_join_first: '先に部屋を作成または参加してください', e_bad_input: '入力値が不正です', e_bad_title: 'その部屋名は使えません（不適切な表現や連絡先を含みます）',
    e_need_two: '2人以上（ボット可）で開始できます', e_chat_banned: '通報が複数あったため、この部屋ではチャットできません', e_msg_big: 'メッセージが大きすぎます', e_failed: '処理に失敗しました',
    e_chat_empty: '空のメッセージです', e_chat_long: 'メッセージが長すぎます（80文字まで）', e_ng_word: '不適切な表現が含まれているため送信できません',
    e_link_or_personal: 'URL・連絡先・IDなどは送信できません', e_name_empty: '名前を入力してください', e_name_bad: 'その名前は使えません（不適切な表現や連絡先を含みます）',
    l_kicked: 'ホストによって退出させられました', l_left: '部屋から退出しました', t_reported: '通報しました。運営が確認します',
    sys_joined: '{name}さんが入室しました', sys_spectating: '{name}さんが観戦しました', sys_host_lobby: 'ホストがゲームを中断してロビーに戻りました',
    // 国データ・共通
    no_data: 'データなし', capital: '首都', landlocked: '（内陸国）', map_loading: '地図を読み込み中…', world_pos: '世界の中の位置', zoom_in: '周辺を拡大',
    lat_n: '北緯', lat_s: '南緯', lng_e: '東経', lng_w: '西経', g_basic: '基本', g_climate: '気候・自然', g_religion: '宗教', g_society: '社会・暮らし', rank_of: '{rank}位/{total}',
    share_title: '地理王で対戦しよう', share_text: '部屋コード {code}',
    credits_html: `<h2 style="margin-top:0">データ出典</h2><ul class="small" style="padding-left:18px;line-height:1.8">
    <li>国の基本情報・面積・位置: <a href="https://github.com/mledoze/countries" target="_blank" rel="noopener">mledoze/countries</a>（ODbL）</li>
    <li>人口・GDP・平均寿命・降水量・都市人口率など: <a href="https://data.worldbank.org/" target="_blank" rel="noopener">World Bank Open Data</a>（CC BY 4.0）</li>
    <li>宗教構成: Pew Research Center の公表値を参考にした概算</li>
    <li>年平均気温・気候区分: 公開資料（ケッペンの気候区分）を参考にした概算</li>
    <li>国旗画像: <a href="https://flagcdn.com/" target="_blank" rel="noopener">flagcdn.com</a></li>
    <li>ゲームデザインの着想: ウナム日月『国旗王（こっきんぐ）』</li></ul>`,
    // 図鑑
    zukan: '図鑑', back_to_game: '対戦へ戻る', tab_flags: '国旗一覧', tab_rank: 'ランキング', search_ph: '国名で検索（ひらがな・カタカナ・英語）',
    sort_kana: '五十音順', sort_area: '面積が大きい順', sort_pop: '人口が多い順', sort_gdp: 'GDPが高い順', sort_temp: '年平均気温が高い順', flip: '昇順／降順を反転',
    all_regions: 'すべての地域', countries_n: '{n} か国', r_Africa: 'アフリカ', r_Americas: 'アメリカ大陸', r_Asia: 'アジア', r_Europe: 'ヨーロッパ', r_Oceania: 'オセアニア', r_Antarctic: '南極',
    rank_info: '{prompt}　{dir}並べています。{missing}{region}', dir_desc: '大きい方から', dir_asc: '小さい方から', excluded_missing: 'データなし {n} か国は除外。', only_region: '（{r}のみ）',
    zukan_title: '図鑑 - 地理王',
  },
  en: {
    app_title: 'GeoKing', tagline: 'Guess the country from its flag!', your_name: 'Your name (required)', name_ph: 'Enter a nickname',
    create_room: 'Create room', code_ph: 'Room code', join: 'Join', learn_zukan: 'Study mode', public_rooms: 'Open public rooms', refresh: 'Refresh',
    loading: 'Loading…', public_rooms_note: 'Jump into a room someone else made. To list your own room, turn on "Public room" in the lobby.',
    demo_prompt: 'PROMPT', demo_q: 'Largest area?', demo_win: 'Brazil 8.51M km²', c_br: 'Brazil', c_jp: 'Japan', c_mn: 'Mongolia', c_mt: 'Malta',
    v_br: '8.51M km²', v_jp: '378K km²', v_mn: '1.56M km²', v_mt: '316 km²',
    players: 'Players', add_bot: 'Add bot', lobby_note_pre: 'Share the room code ', lobby_note_post: ' or the invite link with friends. Others can join even after the game starts. The host can pause with "Lobby" at the top right to change settings.',
    room_settings: 'Room settings', host_only: '(host only)', room_name: 'Room name', room_title_ph: "e.g. Hanako's room",
    public_room_label: 'Public room (listed on the top page, anyone can join)',
    settings_note: '7 rounds, 8 cards, 30 seconds per question (a random card is played on timeout). Prompts come from Basics, Climate, Religion and Society.',
    start_game: 'Start game', start_need2: 'Start game (2+ players, bots OK)', start_rounds: 'Start game ({n} rounds)', waiting_host_start: 'Waiting for the host to start…',
    round: 'Round', pick_title: 'Pick the flag that best fits the prompt', pick_hint: 'Pick the flag that best fits the prompt (tap twice to play)',
    spectating: 'Spectating', spectate_note: "You're watching this game and will join the next one. You can see which card each player is choosing in real time.",
    result: 'Result', score: 'Score', chat: 'Chat', chat_ph: 'Type a message', send: 'Send', final_results: 'Final results', played_list: 'Cards played',
    rematch: 'Play again', to_lobby_settings: 'Back to lobby to change settings', waiting_host: 'Waiting for the host…',
    code: 'Code', copy_invite: 'Copy invite link', lobby_btn: 'Lobby', leave: 'Leave', sources: 'Data sources', privacy: 'Privacy policy',
    sound_title: 'Sound & vibration', sound_on: 'Sound & vibration: on', sound_off: 'Sound & vibration: off', lang_btn: '日本語',
    conn_lost_reload: 'Cannot reach the server. Please reload the page.', reconnecting: 'Connection lost. Reconnecting…',
    enter_name: 'Please enter your name', enter_code4: 'Enter the 4-character room code',
    confirm_to_lobby: 'Pause the game and return to the lobby?\n(Scores reset; you can change settings and restart)', confirm_leave: 'Leave this room?',
    link_copied: 'Invite link copied', share_this_link: 'Share this link', system: 'System', report_mute: 'Report / mute',
    tag_host: 'Host', tag_off: 'Offline', tag_spec: 'Watching', tag_you: 'You', kick: 'Remove', difficulty: 'Difficulty', pts: 'pts',
    played_msg: 'You played {card}. You can change it by tapping another card twice until everyone has played.', card_word: 'a card', no_hand: 'No cards yet. You can join from the next game.',
    played_card: 'Played', flag_alt: 'Flag', confirm_change: 'Change to this card?', confirm_play: 'Play this flag?', once_more: 'Tap again to confirm',
    others_live: "Everyone's cards (spectator mode: you can see what they're choosing)", others_hidden: "Everyone's cards (plays are hidden until the reveal)",
    bubble_pick: 'Played!', bubble_selecting: 'Choosing…', bubble_thinking: 'Thinking…',
    world_first: 'World #1!', top10: 'Top 10!', top30: 'Top 30!', world_rank: 'World <b>#{n}</b> <span>/ {total} countries</span>', world_rank_plain: 'World #{n} / {total}',
    rank_n: '#{n}', you_paren: ' (you)', reading: 'Reading: ', missing_zero: ' (no data, counted as 0)',
    final_label: 'final results', next_round: 'round {n} / {total}', next_in: 'Next: {label} in {sec}s', won_point: '{names} scored a point!', draw_nodata: 'No data for anyone… draw',
    is_champion: '{names} is the GeoKing!', prompt_col: 'Prompt', round_short: 'R{n}', leftover_row: '<b>Left</b>Unplayed cards', sec: '{n}s', names_sep: ' & ',
    no_public_rooms: 'No open rooms right now. Create a room and turn on "Public room" to list it here.', recruiting: 'Open',
    in_progress: 'Round {n} in progress, join anytime', room_of: "{name}'s room", by: 'by', players_n: '{n}/8 players', rounds_short: '{n}R', rooms_fetch_failed: 'Could not load the list',
    mute: 'Mute', unmute: 'Unmute', report: 'Report', reason: 'Reason:', r_abuse: 'Abuse / discrimination', r_harass: 'Harassment', r_personal: 'Personal info / solicitation', r_other: 'Other',
    muted_toast: 'Muted', unmuted_toast: 'Unmuted', san: '',
    menu_note: "Report abusive messages. Muting hides this player's messages on your screen (they won't be notified).",
    room_not_found_toast: 'Room not found (it may have ended, or the code is wrong)', status_recruiting: 'Open', status_end: 'Showing results (join from the next game)',
    status_round: 'Round {n} in progress (you will join as a spectator)', join_room_q: 'Join this room?', host_label: 'Host', people: ' players', invite_cancel: 'Cancel',
    e_room_full_global: 'The server is full right now. Please try again later.', e_room_not_found: 'That room code was not found', e_reauth_failed: 'Reconnection failed',
    e_room_full: 'This room is full (max 8)', e_join_first: 'Create or join a room first', e_bad_input: 'Invalid input', e_bad_title: 'That room name is not allowed (inappropriate words or contact info)',
    e_need_two: 'You need 2 or more players (bots count)', e_chat_banned: 'You were reported by several players and cannot chat in this room', e_msg_big: 'Message too large', e_failed: 'Something went wrong',
    e_chat_empty: 'Empty message', e_chat_long: 'Message too long (80 characters max)', e_ng_word: 'Your message contains inappropriate words',
    e_link_or_personal: 'URLs, contact info and IDs cannot be sent', e_name_empty: 'Please enter your name', e_name_bad: 'That name is not allowed (inappropriate words or contact info)',
    l_kicked: 'You were removed by the host', l_left: 'You left the room', t_reported: 'Reported. Thank you.',
    sys_joined: '{name} joined', sys_spectating: '{name} is watching', sys_host_lobby: 'The host paused the game and returned to the lobby',
    no_data: 'No data', capital: 'Capital', landlocked: ' (landlocked)', map_loading: 'Loading map…', world_pos: 'Location in the world', zoom_in: 'Zoomed in',
    lat_n: 'N', lat_s: 'S', lng_e: 'E', lng_w: 'W', g_basic: 'Basics', g_climate: 'Climate & Nature', g_religion: 'Religion', g_society: 'Society & Life', rank_of: '#{rank}/{total}',
    share_title: 'Play GeoKing with me', share_text: 'Room code {code}',
    credits_html: `<h2 style="margin-top:0">Data sources</h2><ul class="small" style="padding-left:18px;line-height:1.8">
    <li>Country basics, area, location: <a href="https://github.com/mledoze/countries" target="_blank" rel="noopener">mledoze/countries</a> (ODbL)</li>
    <li>Population, GDP, life expectancy, rainfall, urban share, etc.: <a href="https://data.worldbank.org/" target="_blank" rel="noopener">World Bank Open Data</a> (CC BY 4.0)</li>
    <li>Religious composition: estimates based on Pew Research Center publications</li>
    <li>Average temperature and climate type: estimates based on public sources (Köppen classification)</li>
    <li>Flag images: <a href="https://flagcdn.com/" target="_blank" rel="noopener">flagcdn.com</a></li>
    <li>Game design inspired by the Japanese card game "Kokki-ng" (Flag King)</li></ul>`,
    zukan: 'Study', back_to_game: 'Back to game', tab_flags: 'All flags', tab_rank: 'Rankings', search_ph: 'Search by country name (English or Japanese)',
    sort_kana: 'Japanese kana order', sort_area: 'Largest area first', sort_pop: 'Largest population first', sort_gdp: 'Highest GDP first', sort_temp: 'Warmest first', flip: 'Reverse order',
    all_regions: 'All regions', countries_n: '{n} countries', r_Africa: 'Africa', r_Americas: 'Americas', r_Asia: 'Asia', r_Europe: 'Europe', r_Oceania: 'Oceania', r_Antarctic: 'Antarctic',
    rank_info: '{prompt} Sorted {dir}. {missing}{region}', dir_desc: 'from largest', dir_asc: 'from smallest', excluded_missing: '{n} countries without data excluded. ', only_region: '({r} only)',
    zukan_title: 'Study - GeoKing',
  },
};
let LANG = (() => { try { const v = localStorage.getItem('geoking_lang'); if (v === 'ja' || v === 'en') return v; } catch {} return (navigator.language || 'ja').toLowerCase().startsWith('ja') ? 'ja' : 'en'; })();
function t(key, params) {
  let s = (I18N[LANG] && I18N[LANG][key]) ?? I18N.ja[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.split('{' + k + '}').join(v);
  return s;
}
// サーバーのメッセージ: code があれば言語に合わせた文言、なければサーバーの日本語をそのまま
function tServer(prefix, code, fallback) { const k = prefix + code; return code && I18N[LANG][k] ? I18N[LANG][k] : fallback; }
function applyI18n() {
  document.documentElement.lang = LANG;
  document.querySelectorAll('[data-i18n]').forEach(e => { e.textContent = t(e.dataset.i18n); });
  document.querySelectorAll('[data-i18n-html]').forEach(e => { e.innerHTML = t(e.dataset.i18nHtml); });
  document.querySelectorAll('[data-i18n-ph]').forEach(e => { e.placeholder = t(e.dataset.i18nPh); });
  document.querySelectorAll('[data-i18n-title]').forEach(e => { e.title = t(e.dataset.i18nTitle); });
  const lb = document.getElementById('langBtn'); if (lb) lb.textContent = t('lang_btn');
}
function setLang(lang) {
  LANG = lang; try { localStorage.setItem('geoking_lang', lang); } catch {}
  applyI18n();
  if (typeof window.onLangChange === 'function') window.onLangChange();
}
document.addEventListener('DOMContentLoaded', () => {
  applyI18n();
  const lb = document.getElementById('langBtn');
  if (lb) lb.onclick = () => setLang(LANG === 'ja' ? 'en' : 'ja');
});
// 言語に応じた名前の取り出し
const pt = (pr) => (LANG === 'en' && pr && pr.text_en) ? pr.text_en : (pr ? pr.text : '');
const catName = (cat) => (LANG === 'en' && cat.name_en) ? cat.name_en : cat.name;
const flabel = (F) => (LANG === 'en' && F.label_en) ? F.label_en : F.label;
const cname = (c) => LANG === 'en' ? c.name_en : c.name;
const coff = (c) => LANG === 'en' ? (c.name_official_en || c.name_en) : c.name_official;
const pname = (p) => (LANG === 'en' && p && p.name_en) ? p.name_en : (p ? p.name : '');
// 気候区分の英語（主な区分だけ訳す。括弧内の補足は省く）
const CLIMATE_EN = { '熱帯雨林気候': 'Tropical rainforest', '熱帯モンスーン気候': 'Tropical monsoon', 'サバナ気候': 'Savanna', '砂漠気候': 'Desert', 'ステップ気候': 'Steppe',
  '地中海性気候': 'Mediterranean', '温暖湿潤気候': 'Humid subtropical', '西岸海洋性気候': 'Oceanic', '亜寒帯湿潤気候': 'Subarctic', '亜寒帯冬季少雨気候': 'Subarctic (dry winter)',
  'ツンドラ気候': 'Tundra', '高山気候': 'Alpine' };
function climateText(v) { if (!v) return v; if (LANG !== 'en') return v; const main = v.split('（')[0]; return CLIMATE_EN[main] || main; }
