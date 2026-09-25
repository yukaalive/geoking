/* スプレッドシート側のプログラム（docs/sheet-log/Code.gs）の確認。Google のしくみ（SpreadsheetApp など）を手元の作り物に置き換えて動かす。
   作り物のシートは本物に合わせてある:
   - 新しいシートは1000行・26列。それより外を指すとエラー
   - 見出し（固定した1行目）より下の行を全部消そうとするとエラー（本物: "it is not possible to delete all non-frozen rows"）
   - setValue で ' で始まる文字はただの文字、= で始まる文字は数式として扱う
   実行: node tests/sheet_log_gs_test.js */
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const CODE = fs.readFileSync(path.join(__dirname, '..', 'docs', 'sheet-log', 'Code.gs'), 'utf8');

function makeSheet(name) {
  const sh = { name, cells: [], single: {}, maxRows: 1000, maxCols: 26, frozen: 0 };
  const range = (r, c, nr = 1, nc = 1) => {
    if (r + nr - 1 > sh.maxRows) throw new Error(`range outside the sheet (row ${r + nr - 1} > ${sh.maxRows})`);
    if (c + nc - 1 > sh.maxCols) throw new Error(`range outside the sheet (column ${c + nc - 1} > ${sh.maxCols})`);
    return {
      setValues(v) { assert.strictEqual(v.length, nr); v.forEach((row, i) => { assert.strictEqual(row.length, nc); sh.cells[r - 1 + i] = sh.cells[r - 1 + i] || []; row.forEach((x, j) => { sh.cells[r - 1 + i][c - 1 + j] = x; }); }); return this; },
      getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push((sh.cells[r - 1 + i] || [])[c - 1 + j] ?? ''); out.push(row); } return out; },
      setValue(v) { const s = String(v); sh.single[`${r},${c}`] = s.startsWith("'") ? { value: s.slice(1), formula: '' } : s.startsWith('=') ? { value: 2, formula: s } : { value: s, formula: '' }; return this; },
      getValue() { return (sh.single[`${r},${c}`] || { value: '' }).value; },
      getFormula() { return (sh.single[`${r},${c}`] || { formula: '' }).formula; },
      setNumberFormat() { return this; }, setFontWeight() { return this; },
    };
  };
  Object.assign(sh, {
    getName: () => name,
    getLastRow: () => sh.cells.length, getMaxRows: () => sh.maxRows, getMaxColumns: () => sh.maxCols, getRange: range,
    insertRowsAfter(after, n) { assert.strictEqual(after, sh.maxRows); sh.maxRows += n; },
    deleteColumns(start, n) { assert.ok(start + n - 1 <= sh.maxCols); sh.maxCols -= n; },
    setFrozenRows(n) { sh.frozen = n; }, setColumnWidth() {},
    deleteRows(start, n) {
      assert.ok(start > sh.frozen && start + n - 1 <= sh.maxRows, `deleteRows(${start}, ${n}) outside`);
      if (sh.maxRows - n <= sh.frozen) throw new Error('Sorry, it is not possible to delete all non-frozen rows.');
      sh.cells.splice(start - 1, n); sh.maxRows -= n;
    },
  });
  return sh;
}

function makeEnv(code = CODE) {
  const sheets = [], props = {}, cache = {}, triggers = [];
  const env = {
    console: { log: (...a) => env.__logs.push(a.join(' ')) }, __logs: [], __locks: 0, __unlocks: 0,
    SpreadsheetApp: { flush() {}, getActiveSpreadsheet: () => ({
      getSheetByName: (n) => sheets.find((s) => s.name === n) || null,
      insertSheet: (n) => { const s = makeSheet(n); sheets.push(s); return s; },
      deleteSheet: (s) => { sheets.splice(sheets.indexOf(s), 1); },
      setSpreadsheetTimeZone(tz) { env.__tz = tz; },
    }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k] ?? null, put: (k, v, sec) => { assert.ok(k.length <= 250 && sec > 0 && sec <= 21600); cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() { env.__locks++; }, releaseLock() { env.__unlocks++; } }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) },
    Utilities: { getUuid: () => '12345678-1234-1234-1234-' + Math.random().toString(16).slice(2, 14).padEnd(12, '0') },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: (t) => triggers.splice(triggers.indexOf(t), 1),
      newTrigger: (fn) => { const b = { timeBased: () => b, everyDays: (d) => { b.days = d; return b; }, atHour: (h) => { b.hour = h; return b; }, create: () => { assert.ok(b.days, '毎日の指定がない'); const t = { fn, days: b.days, hour: b.hour, getHandlerFunction: () => fn }; triggers.push(t); return t; } }; return b; },
    },
    Date, JSON, Array, Number, String, isFinite, Math,
  };
  vm.createContext(env);
  vm.runInContext(code, env);
  const log = () => sheets.find((s) => s.name === 'ログ');
  return { env, props, triggers, sheets, log, cells: () => log().cells };
}

const post = (env, body) => JSON.parse(env.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).text);
const day = 86400, now = () => Date.now() / 1000;
const events = (cells) => cells.slice(1).map((r) => r[1]);
const results = [];
const ok = (m) => { results.push('OK: ' + m); };

{ // setup
  const { env, props, triggers, sheets, log, cells } = makeEnv();
  env.setup(); const key1 = props.LOG_KEY; env.setup();
  assert.strictEqual(env.__tz, 'Asia/Tokyo');
  assert.deepStrictEqual(cells()[0], ['日時', '出来事', '部屋コード', '部屋名', 'ニックネーム', '人数', 'くわしく']);
  assert.strictEqual(log().maxCols, 7, '使わない列が残っている');
  assert.ok(key1 && key1.length >= 32 && props.LOG_KEY === key1, '合言葉が作られない／変わった');
  assert.strictEqual(triggers.length, 1); assert.strictEqual(triggers[0].fn, 'deleteOldRows'); assert.strictEqual(triggers[0].days, 1);
  assert.ok(env.__logs.some((l) => l.includes(key1)), '合言葉が実行ログに出ない');
  assert.ok(env.__logs.some((l) => l.startsWith('書き込みの確認: OK')), '= の確かめの結果が出ない');
  assert.deepStrictEqual(sheets.map((s) => s.name), ['ログ'], '確認用のシートが残っている');
  ok('setup: シート（7列だけ）・見出し・合言葉（実行ログに出す）・毎日の削除の予約（1つだけ）。= で始まる文字が数式にならないかを確かめ、確認用のシートは消す');
}

{ // 書き込み
  const { env, props, cells } = makeEnv();
  env.setup();
  assert.strictEqual(post(env, { key: 'wrong', rows: [{ ts: 1, event: 'x' }] }).ok, false);
  assert.strictEqual(post(env, 'not json').ok, false);
  assert.strictEqual(cells().length, 1, '合言葉が違うのに書き込んだ');
  ok('合言葉が違う・中身が壊れている書き込みは断る');
  const ts = Date.UTC(2026, 8, 26, 3, 4, 5) / 1000;
  const r = post(env, { key: props.LOG_KEY, id: 'b1', rows: [
    { ts, event: '部屋作成', room: 'AB2C', title: 'たろうの部屋', name: 'たろう', count: 1, detail: '' },
    { ts: ts + 1, event: '入室', room: 'AB2C', title: 'たろうの部屋', name: '=HYPERLINK("http://x")', count: 2, detail: '+1' },
    { ts: ts + 2, event: '対戦を開いた', room: '', title: '', name: '(名前なし)', count: '', detail: 'id=abc' },
  ] });
  assert.deepStrictEqual(r, { ok: true, added: 3 });
  const c = cells();
  assert.ok(c[1][0] instanceof Date && c[1][0].getTime() === ts * 1000, '日時が日付として入っていない');
  assert.deepStrictEqual(c[1].slice(1), ["'部屋作成", "'AB2C", "'たろうの部屋", "'たろう", 1, "'"]);
  assert.strictEqual(c[2][4], `'=HYPERLINK("http://x")`, '= で始まる名前が数式として入る');
  assert.strictEqual(c[3][5], '', '人数がない行に数字が入った');
  assert.ok(env.__locks >= 1 && env.__locks === env.__unlocks, '鍵をかけていない／外していない');
  ok('正しい合言葉なら行を足す（日時は日付、文字は先頭に \' を付けて数式にしない、人数は数字）');
  assert.deepStrictEqual(post(env, { key: props.LOG_KEY, id: 'b1', rows: [{ ts, event: '部屋作成' }] }), { ok: true, added: 0, duplicate: true });
  assert.strictEqual(cells().length, 4, '同じまとまりを2回書いた');
  assert.strictEqual(env.__locks, env.__unlocks, '二重のときに鍵を外していない');
  ok('同じまとまり（id）が2回届いたら、2回目は書かずに「書けた」と返す（送り直しで二重にならない）');
  assert.strictEqual(post(env, { key: props.LOG_KEY, rows: Array.from({ length: 1200 }, (_, i) => ({ ts: ts + 10 + i, event: 'e' + i })) }).added, 1000);
  ok('1回に書く行は1000行まで');
  assert.strictEqual(post(env, { key: props.LOG_KEY, rows: [{ ts: ts + 5000, event: 'x'.repeat(1000) }] }).added, 1);
  assert.strictEqual(cells()[cells().length - 1][1].length, 301);
  ok('長すぎる文字は300文字で切る');
}

{ // 1000行を超えても書き続け、全部古くなっても消せる（見出しの下を全部は消せない本物の決まりに合わせる）
  const { env, props, log, cells } = makeEnv();
  env.setup();
  for (let i = 0; i < 3; i++) post(env, { key: props.LOG_KEY, id: 'g' + i, rows: Array.from({ length: 450 }, (_, j) => ({ ts: now() - 100 * day + i * 1000 + j, event: `r${i}-${j}` })) });
  assert.strictEqual(cells().length, 1 + 1350);
  assert.strictEqual(log().maxRows, 1351, 'シートの行を足していない');
  ok('シートの行が足りなくなったら足して書き続ける（1350行、シートは1351行に）');
  assert.strictEqual(env.deleteOldRows(), 1350, '全部古いときに消せない');
  assert.strictEqual(cells().length, 1); assert.strictEqual(cells()[0][0], '日時');
  post(env, { key: props.LOG_KEY, id: 'n1', rows: [{ ts: now(), event: 'new' }] });
  assert.deepStrictEqual(events(cells()), ["'new"]);
  ok('全部の行が古くなっても消せる（空の行を1つ足してから消す）。そのあとも書ける');
}

{ // 85日より古い行を消す。並べ替え・メモの行・日付でない行があっても、古い行は全部消える
  const { env, props, cells } = makeEnv();
  env.setup();
  post(env, { key: props.LOG_KEY, rows: [
    { ts: now() - 120 * day, event: 'old1' }, { ts: now() - 85.5 * day, event: 'old2' },
    { ts: now() - 84.5 * day, event: 'keep1' }, { ts: now() - 1, event: 'keep2' },
    { ts: now() - 100 * day, event: 'old3' }, { ts: now() - 2, event: 'keep3' }, { ts: now() - 90 * day, event: 'old4' },
  ] });
  cells().splice(3, 0, ['メモ', '運営のメモ', '', '', '', '', '']);   // 持ち主が行を書き足した
  const c = cells(); const body = c.slice(1).sort((a, b) => String(a[4]).localeCompare(String(b[4]))); c.splice(1, c.length - 1, ...body);   // ニックネームで並べ替えた
  const locks = env.__locks;
  assert.strictEqual(env.deleteOldRows(), 4, '並べ替えたあと古い行を消せない');
  assert.ok(env.__locks === locks + 1 && env.__locks === env.__unlocks, '削除のときに書き込みと同じ鍵をかけていない');
  assert.deepStrictEqual(events(cells()).sort(), ["'keep1", "'keep2", "'keep3", '運営のメモ'].sort());
  assert.strictEqual(cells()[0][0], '日時', '見出しが消えた');
  assert.strictEqual(env.deleteOldRows(), 0);
  ok('85日より古い行を全部消す（並べ替えてあっても、メモの行があっても）。新しい行・メモ・見出しは残す。書き込みと同じ鍵をかける');
}

{ // 行が多すぎたら古い行から消して書き続ける
  const { env, props, cells } = makeEnv(CODE.replace('const MAX_KEEP_ROWS = 200000;', 'const MAX_KEEP_ROWS = 50;'));
  env.setup();
  for (let i = 0; i < 4; i++) post(env, { key: props.LOG_KEY, id: 'm' + i, rows: Array.from({ length: 20 }, (_, j) => ({ ts: now() - 1000 + i * 20 + j, event: `m${i * 20 + j}` })) });
  assert.strictEqual(cells().length - 1, 50, '上限を超えて残っている');
  assert.strictEqual(events(cells())[0], "'m30", 'いちばん古い行から消していない');
  assert.strictEqual(events(cells())[49], "'m79");
  ok('行が上限（本番は20万行）を超えそうなら、いちばん古い行から消して書き続ける（シートがいっぱいで止まらない）');
}

{ // ブラウザで開いたとき（doGet）は書き込まない
  const { env, cells } = makeEnv();
  env.setup();
  assert.ok(env.doGet().text.includes('地理王'));
  assert.strictEqual(cells().length, 1);
  ok('アドレスをブラウザで開いても書き込まない（動いているかの確認だけ）');
}

console.log(results.join('\n') + '\nALL OK');
