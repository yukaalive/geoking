/**
 * 地理王の出来事（部屋を作った・入った・ゲームの開始と終了・画面を開いた など）を、このスプレッドシートに書き込む。
 * サーバー（server.py の sheet_log）が30秒ごとにまとめて送ってくる。設定の手順は同じフォルダの README.md。
 * - setup を1回実行すると: シート「ログ」と見出しを作り、合言葉（LOG_KEY）を作って実行ログに出し、毎日の古い行の削除を予約する。
 *   あわせて「= で始まる名前が数式にならないか」を確かめ、結果を実行ログに出す
 * - 古い行は、毎日 deleteOldRows が消す。85日より古い行を消すので、何日か失敗しても、どの行も記録から90日以内に消える
 *   （プライバシーポリシーと Google Play の申告の「90日以内」）。並べ替えてあっても、日付を見て消す
 * - 同じまとまり（id）が2回届いたら2回目は書かない（書けたあとに返事だけ届かず、サーバーが送り直したとき）
 * - 行が MAX_KEEP_ROWS を超えそうなら、いちばん古い行から消して場所を空ける（シートがいっぱいで書けなくなるのを防ぐ）
 * - バトルのレート（2026-10-03〜）: シート「レート」に、端末ごとの番号（合言葉そのものではない）・名前・レート・試合数などを1人1行で残す。
 *   サーバーが起動したときに全部読み（action: ratings_get）、変わった人の行を送ってくる（action: ratings_put。同じ番号は上書き、
 *   試合数が減る古い書き込みは受けない）。最後に遊んでから RATE_KEEP_DAYS 日たった行は、毎日の deleteOldRows で一緒に消す（プライバシーポリシー）
 */
const SHEET_NAME = 'ログ';
const KEEP_DAYS = 85;           // 1日1回消す。失敗した日があっても90日以内に消えるよう余裕をもたせる
const MAX_KEEP_ROWS = 200000;   // 7列×20万行 = 140万セル（スプレッドシートの上限は1000万セル）
const HEADER = ['日時', '出来事', '部屋コード', '部屋名', 'ニックネーム', '人数', 'くわしく'];
const MAX_ROWS_PER_POST = 1000;
const RATE_SHEET = 'レート';
const RATE_HEADER = ['番号', '名前', 'レート', '試合', '人との試合', '最高', '名前を出さない', '更新日時'];
const RATE_KEEP_DAYS = 365;     // 最後に遊んでから1年たったレートは消す
const MAX_RATES_PER_POST = 1000;

/** サーバーからの書き込み。{ key, id, rows: [{ ts, event, room, title, name, count, detail }] } */
function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply({ ok: false, error: 'bad json' });
  }
  const key = PropertiesService.getScriptProperties().getProperty('LOG_KEY');
  if (!key || !data || data.key !== key) return reply({ ok: false, error: 'bad key' });
  if (data.action === 'ratings_get') return reply({ ok: true, rows: getRatings() });
  if (data.action === 'ratings_put') return reply(putRatings(data.rows));
  const rows = (Array.isArray(data.rows) ? data.rows : []).slice(0, MAX_ROWS_PER_POST).map(toRow);
  const batchId = data.id ? 'batch_' + String(data.id).slice(0, 64) : '';
  const lock = LockService.getScriptLock();   // 同時に届いても、毎日の削除と重なっても、行がずれないように
  lock.waitLock(20000);
  try {
    const cache = CacheService.getScriptCache();
    if (batchId && cache.get(batchId)) return reply({ ok: true, added: 0, duplicate: true });
    if (rows.length) {
      const sh = getSheet();
      const over = sh.getLastRow() - 1 + rows.length - MAX_KEEP_ROWS;
      if (over > 0) deleteDataRows(sh, 0, Math.min(over, sh.getLastRow() - 1));   // いちばん古い（上の）行から消して場所を空ける
      const start = sh.getLastRow() + 1;
      const need = start + rows.length - 1 - sh.getMaxRows();
      if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need);   // シートの行が足りなければ足す（新しいシートは1000行しかない）
      sh.getRange(start, 1, rows.length, HEADER.length).setValues(rows);
      sh.getRange(start, 1, rows.length, 1).setNumberFormat('yyyy/mm/dd hh:mm:ss');
      SpreadsheetApp.flush();
    }
    if (batchId) cache.put(batchId, '1', 21600);   // 6時間おぼえておく
  } finally {
    lock.releaseLock();
  }
  return reply({ ok: true, added: rows.length });
}

/** ブラウザでアドレスを開いたとき（動いているかの確認用。書き込みはしない） */
function doGet() {
  return ContentService.createTextOutput('地理王のログの受け口です（書き込みはサーバーからだけ）');
}

/** 1行分。文字は先頭に ' を付けて、ただの文字として入れる（= や + で始まる名前が数式にならない・数字や日付に変わらない。' は表示されない） */
function toRow(r) {
  r = r || {};
  const ts = Number(r.ts);
  const when = isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date();
  const text = (v) => "'" + String(v == null ? '' : v).slice(0, 300);
  const count = r.count === '' || r.count == null || !isFinite(Number(r.count)) ? '' : Number(r.count);
  return [when, text(r.event), text(r.room), text(r.title), text(r.name), count, text(r.detail)];
}

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME, 0);
    if (sh.getMaxColumns() > HEADER.length) sh.deleteColumns(HEADER.length + 1, sh.getMaxColumns() - HEADER.length);   // 使わない列を消す（上限のセル数を無駄にしない）
    sh.getRange(1, 1, 1, HEADER.length).setValues([HEADER]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 150); sh.setColumnWidth(2, 110); sh.setColumnWidth(4, 180); sh.setColumnWidth(5, 130); sh.setColumnWidth(7, 320);
  }
  return sh;
}

/** シート「レート」（なければ作る） */
function rateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(RATE_SHEET);
  if (!sh) {
    sh = ss.insertSheet(RATE_SHEET);
    if (sh.getMaxColumns() > RATE_HEADER.length) sh.deleteColumns(RATE_HEADER.length + 1, sh.getMaxColumns() - RATE_HEADER.length);
    sh.getRange(1, 1, 1, RATE_HEADER.length).setValues([RATE_HEADER]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 190); sh.setColumnWidth(2, 130); sh.setColumnWidth(8, 150);
  }
  return sh;
}

/** 先頭の ' を外す（本物のシートは ' を値に入れないが、念のため） */
function plain(v) {
  return String(v == null ? '' : v).replace(/^'/, '');
}

/** レートの1行。番号と名前は ' を付けてただの文字に（= で始まる名前が数式にならない） */
function toRateRow(r) {
  const num = (v) => Math.round(Number(v) * 100) / 100;
  const t = Number(r.t);
  return ["'" + r.rid, "'" + String(r.name == null ? '' : r.name).slice(0, 16), num(r.r), Math.floor(Number(r.n)), Math.floor(Number(r.h) || 0),
    num(isFinite(Number(r.best)) ? r.best : r.r), !!r.hide, isFinite(t) && t > 0 ? new Date(t * 1000) : new Date()];
}

function okRate(r) {
  return r && /^[0-9a-f]{20}$/.test(String(r.rid)) && isFinite(Number(r.r)) && Number(r.r) > 0 && Number(r.r) < 10000 && isFinite(Number(r.n)) && Number(r.n) >= 0;
}

/** サーバーが起動したとき: 全部の人のレート */
function getRatings() {
  const sh = rateSheet();
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, RATE_HEADER.length).getValues()
    .map((v) => ({ rid: plain(v[0]), name: plain(v[1]), r: Number(v[2]), n: Number(v[3]), h: Number(v[4]), best: Number(v[5]),
      hide: v[6] === true || String(v[6]).toUpperCase() === 'TRUE', t: v[7] instanceof Date ? Math.round(v[7].getTime() / 1000) : Number(v[7]) || 0 }))
    .filter(okRate);
}

/** 変わった人の行を書く。同じ番号の行は上書き（試合数が減る古い書き込みは受けない）、新しい人は下に足す */
function putRatings(rows) {
  const byId = new Map();
  (Array.isArray(rows) ? rows : []).slice(0, MAX_RATES_PER_POST).filter(okRate).forEach((r) => byId.set(String(r.rid), r));   // 同じ番号が2回あれば後の方
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = rateSheet();
    const last = sh.getLastRow();
    const have = last >= 2 ? sh.getRange(2, 1, last - 1, 4).getValues() : [];
    const at = new Map(have.map((v, i) => [plain(v[0]), i]));
    let updated = 0, stale = 0;
    const add = [];
    byId.forEach((r, rid) => {
      const i = at.get(rid);
      if (i === undefined) { add.push(toRateRow(r)); return; }
      if (Number(r.n) < Number(have[i][3])) { stale++; return; }
      sh.getRange(2 + i, 1, 1, RATE_HEADER.length).setValues([toRateRow(r)]);
      updated++;
    });
    if (add.length) {
      const start = sh.getLastRow() + 1;
      const need = start + add.length - 1 - sh.getMaxRows();
      if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need);
      sh.getRange(start, 1, add.length, RATE_HEADER.length).setValues(add);
      sh.getRange(start, 8, add.length, 1).setNumberFormat('yyyy/mm/dd hh:mm:ss');
    }
    SpreadsheetApp.flush();
    return { ok: true, updated, added: add.length, stale };
  } finally {
    lock.releaseLock();
  }
}

/** 最後に遊んでから RATE_KEEP_DAYS 日たったレートの行を消す（鍵は呼ぶ側でかける）。消した数を返す */
function deleteOldRatingsLocked() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RATE_SHEET);
  if (!sh) return 0;
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const cutoff = Date.now() - RATE_KEEP_DAYS * 24 * 60 * 60 * 1000;
  const dates = sh.getRange(2, 8, last - 1, 1).getValues();
  const old = [];
  dates.forEach((d, i) => { if (d[0] instanceof Date && d[0].getTime() < cutoff) old.push(i); });
  for (let j = old.length - 1; j >= 0;) {
    let k = j;
    while (k > 0 && old[k - 1] === old[k] - 1) k--;
    deleteDataRows(sh, old[k], j - k + 1);
    j = k - 1;
  }
  return old.length;
}

/** 見出しより下の行を消す（from は見出しの下を0とした番号）。見出しの下を全部は消せないので、そのときは先に空の行を1つ足す */
function deleteDataRows(sh, from, n) {
  if (n <= 0) return;
  if (n >= sh.getMaxRows() - 1) sh.insertRowsAfter(sh.getMaxRows(), 1);
  sh.deleteRows(2 + from, n);
}

/** KEEP_DAYS より古い行を消す。並べ替えや書き足しがあっても、日付が古い行を全部探して、下から続きの行ごとに消す */
function deleteOldRows() {
  const lock = LockService.getScriptLock();
  lock.waitLock(60000);
  try {
    const sh = getSheet();
    const last = sh.getLastRow();
    if (last < 2) { deleteOldRatingsLocked(); return 0; }
    const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
    const dates = sh.getRange(2, 1, last - 1, 1).getValues();
    const old = [];
    dates.forEach((d, i) => { if (d[0] instanceof Date && d[0].getTime() < cutoff) old.push(i); });
    let deleted = 0;
    for (let j = old.length - 1; j >= 0;) {   // 下から、続いている行をまとめて消す（上の行の番号がずれないように）
      let k = j;
      while (k > 0 && old[k - 1] === old[k] - 1) k--;
      deleteDataRows(sh, old[k], j - k + 1);
      deleted += j - k + 1;
      j = k - 1;
    }
    deleteOldRatingsLocked();   // レートは最後に遊んでから1年で消す（同じ毎日の予約で）
    SpreadsheetApp.flush();
    return deleted;
  } finally {
    lock.releaseLock();
  }
}

/** 最初に1回だけ実行する: シートを作り、合言葉を作って実行ログに出し、毎日の削除を予約する（何度実行しても大丈夫） */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone('Asia/Tokyo');
  getSheet();
  rateSheet();
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('LOG_KEY');
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('LOG_KEY', key);
  }
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'deleteOldRows')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('deleteOldRows').timeBased().atHour(4).everyDays(1).create();
  // = で始まる名前が数式にならないかを確かめる（確認用のシートを一時的に作って試し、すぐ消す）
  const probeSheet = ss.insertSheet('確認用（すぐ消えます）');
  const probe = probeSheet.getRange(1, 1);
  probe.setValue("'=1+1");
  SpreadsheetApp.flush();
  const safe = probe.getFormula() === '' && String(probe.getValue()) === '=1+1';
  ss.deleteSheet(probeSheet);
  console.log('書き込みの確認: ' + (safe ? 'OK（= で始まる名前も、ただの文字として入る）' : 'NG（= で始まる名前が数式になる。Claude に伝えてください）'));
  console.log('合言葉（Render の SHEET_LOG_KEY に入れる）: ' + key);
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
