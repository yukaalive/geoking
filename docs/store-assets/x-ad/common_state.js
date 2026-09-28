// 本物の画面をニセの状態で描くための土台（サーバーにはつながない）
window.ensureConnection = () => {}; window.reconnectNow = () => {};
try { sessionStorage.clear(); } catch {}
setLang('ja');
const ME = 'me0001';
window.P = (pid, name, extra = {}) => ({ pid, name, name_en: null, score: 0, is_bot: false, connected: true, picked: false, won: [], spectator: false, hand_count: 8, ...extra });
window.PR = (id) => { const p = { area_max: ['面積が大きい国は？', 'area', 'max', 'Which country has the largest area?'], pop_max: ['人口が多い国は？', 'population', 'max', 'Which country has the largest population?'], life_max: ['平均寿命が長い国は？', 'life_exp', 'max', 'Which country has the longest life expectancy?'] }[id]; return { id, cat: 'basic', text: p[0], key: p[1], dir: p[2], star: 1, hint: '', text_en: p[3] }; };
window.BASE = (over = {}) => ({ type: 'state', room: 'AB12', title: 'ゆかの部屋', title_raw: 'ゆか', host: ME, you: ME, token: null, phase: 'lobby', round: 1, total_rounds: 7,
  settings: { categories: ['basic', 'climate', 'religion', 'society'], rounds: 7, hand_size: 8, show_names: false, timer: 30, max_star: 3, public: false },
  players: [], prompt: null, hand: [], hands: {}, live: null, history: [], final: null, leftover: null, my_pick: null, reveal: null, deadline: null, next_at: null, chat: [], muted: [], ...over });
window.SHOW = (s) => { state = s; pid = ME; render(); };
