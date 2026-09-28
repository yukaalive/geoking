// 12.6-15.0 本物のホーム画面（飾りの国旗がめくれてブラジルに王冠）。最後の0.5秒は止める
const sleep = AD.sleep;
document.documentElement.style.zoom = 0.8;   // 飾りの国旗まで画面の上の方に収める（X の縦型広告は下の300pxにアカウント名などが重なる）
window.scrollTo(0, 0);
const hero = () => document.getAnimations().filter(a => /^hero/.test(a.animationName || ''));
hero().forEach(a => { a.currentTime = 2600; a.pause(); });
let go; window.__go = () => go(); window.__ready = Promise.resolve(true); await new Promise(r => go = r);
hero().forEach(a => { a.currentTime = 2750; a.play(); });   // 6秒の動きの 2.75秒目から（0.55秒後にめくれ、1.6秒ごろ王冠）
await sleep(1950); hero().forEach(a => a.pause());
await sleep(450);
