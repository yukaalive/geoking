// 撮影用の道具（ページに入れて使う）。字幕の帯・タップの印・ニセの状態で本物の画面を描く。
window.AD = (() => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const t0 = performance.now(); const events = [];
  const ev = (name) => events.push([name, (performance.now() - AD.clipStart) / 1000]);
  const BAND = window.AD_BAND ?? 66;   // 字幕の帯の高さ（CSS px）
  const TOP = window.AD_SAFE_TOP || 0;   // 帯の上に空ける高さ（X の縦型広告は上155pxに時計やボタンが重なる。幅390なら 56px ≒ 155px）
  const st = document.createElement('style');
  st.textContent = `
    body{padding-top:${TOP + BAND}px!important} .top{top:${TOP + BAND}px!important}
    #adSafe{position:fixed;left:0;right:0;top:0;height:${TOP}px;z-index:9999;background:#1c2b22}
    #adBand{position:fixed;left:0;right:0;top:${TOP}px;height:${BAND}px;z-index:9999;background:#1f6f4a;color:#fff;display:flex;align-items:center;justify-content:center;text-align:center;
      font-family:'M PLUS 1p',sans-serif;font-weight:900;font-size:21px;line-height:1.22;letter-spacing:.02em;padding:0 10px;box-shadow:0 3px 0 #1c2b22}
    #adBand b{color:#f4c542} #adBand .adCap{display:block}
    #adBand.pop{animation:adPop .35s cubic-bezier(.2,1.6,.4,1)}
    @keyframes adPop{from{transform:scale(.92);opacity:.3}to{transform:none;opacity:1}}
    .adTap{position:fixed;z-index:9998;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:rgba(255,255,255,.55);border:3px solid #1c2b22;pointer-events:none;box-shadow:0 0 0 4px rgba(244,197,66,.6);transition:transform .12s}
    .adTap.down{transform:scale(.75)}
    .adRing{position:fixed;z-index:9997;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;border:4px solid #f4c542;pointer-events:none;animation:adRing .5s ease-out forwards}
    @keyframes adRing{from{transform:scale(.6);opacity:1}to{transform:scale(2.2);opacity:0}}
    #adCard{position:fixed;inset:0;z-index:10000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#f7f1df;color:#1c2b22;text-align:center;font-family:'M PLUS 1p',sans-serif}
    #adCard h1{font-family:'Dela Gothic One',sans-serif;font-weight:400;font-size:64px;margin:0;letter-spacing:.04em}
    #adCard .sub{font-weight:900;font-size:22px;color:#1f6f4a;line-height:1.35}
    #adCard .pill{margin-top:10px;padding:10px 20px;border:3px solid #1c2b22;border-radius:999px;background:#f4c542;font-weight:900;font-size:18px;box-shadow:3px 3px 0 #1c2b22}
    #adCard .url{padding:10px 18px;border-radius:14px;background:#1c2b22;color:#fff;font-weight:900;font-size:17px}
    #adCard img{width:120px;height:120px;border-radius:26px;box-shadow:4px 4px 0 #1c2b22;border:3px solid #1c2b22}
    #adCard .small{font-weight:800;font-size:15px;color:#5f6f64}
    #adCard.in > *{animation:adIn .45s cubic-bezier(.2,1.4,.4,1) both}
    @keyframes adIn{from{transform:scale(.8)}to{transform:none}}
  `;
  document.head.appendChild(st);
  const band = document.createElement('div'); band.id = 'adBand'; document.body.appendChild(band);
  if (TOP) { const sf = document.createElement('div'); sf.id = 'adSafe'; document.body.appendChild(sf); }
  if (!BAND) { band.style.display = 'none'; }   // 帯は動画の外（別の絵）で付けるとき
  let tapEl = null;
  return {
    clipStart: t0, events, sleep, BAND: BAND + TOP,
    mark: ev,
    caption(html) { band.innerHTML = `<div class="adCap">${html}</div>`; band.classList.remove('pop'); void band.offsetWidth; band.classList.add('pop'); },
    hideBand() { band.style.display = 'none'; const sf = document.getElementById('adSafe'); if (sf) sf.style.display = 'none'; document.body.style.setProperty('padding-top', '0px', 'important'); },
    async moveTo(el, ms = 350) {
      const r = (typeof el === 'string' ? document.querySelector(el) : el).getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (!tapEl) { tapEl = document.createElement('div'); tapEl.className = 'adTap'; tapEl.style.left = x + 'px'; tapEl.style.top = (y + 120) + 'px'; document.body.appendChild(tapEl); await sleep(30); }
      tapEl.style.transition = `left ${ms}ms ease, top ${ms}ms ease, transform .12s`; tapEl.style.left = x + 'px'; tapEl.style.top = y + 'px';
      await sleep(ms + 40); return [x, y];
    },
    async tap(el, sfx = 'tap') {
      const node = typeof el === 'string' ? document.querySelector(el) : el;
      const [x, y] = await this.moveTo(node);
      tapEl.classList.add('down'); const ring = document.createElement('div'); ring.className = 'adRing'; ring.style.left = x + 'px'; ring.style.top = y + 'px'; document.body.appendChild(ring); setTimeout(() => ring.remove(), 600);
      ev(sfx); node.click(); await sleep(120); tapEl.classList.remove('down');
    },
    hideTap() { if (tapEl) { tapEl.remove(); tapEl = null; } },
    card(html) { let c = document.getElementById('adCard'); if (!c) { c = document.createElement('div'); c.id = 'adCard'; document.body.appendChild(c); } c.innerHTML = html; c.classList.remove('in'); void c.offsetWidth; c.classList.add('in'); },
    uncard() { const c = document.getElementById('adCard'); if (c) c.remove(); },
  };
})();
