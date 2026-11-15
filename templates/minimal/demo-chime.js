import { createChime } from './chime-core.js';

const root = document.getElementById('chime-demo');
const stage = root.querySelector('.chime-stage');
const canvas = root.querySelector('.chime-rail');
const titleLayer = root.querySelector('.chime-title');
const slider = root.querySelector('input'), hourSelect = root.querySelector('#chime-hour');
const playButton = root.querySelector('[data-action="play"]');
const status = root.querySelector('[role="status"]');
const timeOutput = root.querySelector('[data-time]');
const frameOutput = root.querySelector('[data-frame]');
const phaseOutput = root.querySelector('[data-phase]');
const slots = { group: root.querySelector('.chime-group'), date: root.querySelector('.chime-date'), time: root.querySelector('.chime-time'), seconds: root.querySelector('.chime-seconds') };

const FPS = 60;
let chime = null, LAST = 0, DURATION = 0;
let frame = 0, playing = false, ready = false, firstPlay = true, raf = 0, epoch = 0, scale = 1;
let boardFrame = null, doc = null;

/* デモの日付は固定し、シークしても同じ絵になるようにする。 */
const hourStamp = () => Date.UTC(2026, 10, 14, Number(hourSelect.value) - 9, 0, 0);

function render(f) {
  frame = Math.max(0, Math.min(LAST, Math.round(f)));
  const t = frame / FPS, { second } = chime.render(t);
  doc.defaultView.clockTick(chime.stampAt(second));
  slider.value = String(frame);
  timeOutput.value = `${t.toFixed(2)} / ${DURATION.toFixed(2)} 秒`;
  frameOutput.value = `${frame} / ${LAST} F · ${FPS} fps`;
  stage.dataset.frame = String(frame);
  phaseOutput.textContent = frame === LAST ? '発車案内' : chime.phaseAt(t);
}

function pause(message = '停止中') {
  playing = false; cancelAnimationFrame(raf); playButton.textContent = '再生'; playButton.setAttribute('aria-pressed', 'false'); status.textContent = message;
}
function tick(now) {
  if (!playing) return;
  const next = Math.floor((now - epoch) * FPS / 1000);
  if (next > LAST) { render(LAST); pause('再生終了'); return; }
  if (next !== frame) render(next);
  raf = requestAnimationFrame(tick);
}
function play(fromStart = false) {
  if (!ready) return;
  if (fromStart || firstPlay || frame === LAST) render(0);
  firstPlay = false; playing = true; cancelAnimationFrame(raf); epoch = performance.now() - frame * 1000 / FPS;
  playButton.textContent = '一時停止'; playButton.setAttribute('aria-pressed', 'true'); status.textContent = '再生中'; raf = requestAnimationFrame(tick);
}
function seek(f) { if (ready) { pause(); firstPlay = false; render(f); } }
root.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
  const action = button.dataset.action;
  if (action === 'play') { if (playing) pause(); else play(); }
  if (action === 'restart') play(true);
  if (action === 'hour') { seek((chime.ON - 3) * FPS); play(); }
  if (action === 'previous' || action === 'next') seek(frame + (action === 'previous' ? -1 : 1));
}));
slider.addEventListener('input', () => seek(Number(slider.value)));
hourSelect.addEventListener('change', () => { if (ready) { chime.measure(); render(frame); } });
document.addEventListener('visibilitychange', () => { if (document.hidden && playing) pause(); });
window.addEventListener('pagehide', () => pause());
root.chime = { seek, play, pause, get frame() { return frame; }, get playing() { return playing; }, get ready() { return ready; } };

const resize = () => {
  scale = stage.clientWidth / 1920;
  const transform = `scale(${scale})`;
  canvas.style.transform = transform;
  if (boardFrame) boardFrame.style.transform = transform;
  if (ready) render(frame); else titleLayer.style.transform = transform;
};
new ResizeObserver(resize).observe(stage);

function loadBoard() {
  return new Promise((resolve, reject) => {
    boardFrame = document.createElement('iframe'); boardFrame.className = 'chime-board';
    boardFrame.title = '時報の前後の発車案内'; boardFrame.setAttribute('aria-hidden', 'true'); boardFrame.inert = true;
    let observer, settled = false;
    const timer = setTimeout(() => finish(new Error('案内画面を読み込めませんでした')), 15000);
    function finish(error) {
      if (settled) return; settled = true; clearTimeout(timer); observer?.disconnect();
      if (error) reject(error); else resolve();
    }
    boardFrame.addEventListener('load', () => {
      doc = boardFrame.contentDocument;
      if (!doc?.getElementById('normal-up-list')) { finish(new Error('案内画面を読み込めませんでした')); return; }
      const style = doc.createElement('style'); style.textContent = '#demo-dock,#demo-controls{display:none!important}'; doc.head.append(style);
      let preparing = false;
      const check = async () => {
        if (preparing || !doc.querySelector('#normal-up-list .train-kind')) return;
        preparing = true; observer?.disconnect();
        try {
          await Promise.race([doc.fonts.ready, new Promise(done => setTimeout(done, 4000))]);
          if (settled) return;
          /* 案内画面自身の時計は1秒ごとに今の時刻へ戻すので止め、時報の時刻はこちらから渡す。 */
          boardFrame.contentWindow.eval('clearTimeout(clockTimer);clockLoop=function(){};');
          boardFrame.contentWindow.scaleScreen();
          await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
          if (settled) return;
          chime = createChime({ boardDoc: doc, canvas, titleLayer, slots, variant: root.dataset.variant, hourStamp, titleBase: () => `scale(${scale})` });
          DURATION = chime.DURATION; LAST = Math.round(DURATION * FPS) - 1; frame = Math.round(chime.SPEC.POSTER * FPS);
          doc.defaultView.clockTick(chime.stampAt(chime.secondAt(0)));
          chime.buildAssembly();
          boardFrame.style.visibility = 'visible'; finish(null);
        } catch (error) { finish(new Error('時報のプレビューを準備できませんでした')); }
      };
      observer = new MutationObserver(check); observer.observe(doc.body, { childList: true, subtree: true }); check();
    }, { once: true });
    boardFrame.addEventListener('error', () => finish(new Error('案内画面を読み込めませんでした')), { once: true });
    const base = location.pathname.replace(/\/$/, '');
    boardFrame.src = base.slice(0, base.lastIndexOf('/')) + '/normal';
    stage.prepend(boardFrame); resize();
  });
}
/* Google Fonts に届かない環境でも代替フォントで動かす。待つのは4秒まで。 */
const fontsReady = Promise.race([
  Promise.all([
    document.fonts.load('300 168px "Zen Kaku Gothic New"', '0123456789:'),
    document.fonts.load('400 36px "Zen Kaku Gothic New"', '0123456789月日曜日月火水木金土淀屋橋京橋枚方市中書島三条出町柳'),
    document.fonts.load('500 20px "Zen Kaku Gothic New"', '時報香里園')
  ]),
  new Promise(resolve => setTimeout(resolve, 4000))
]).then(() => document.fonts.ready);
Promise.all([fontsReady, loadBoard()]).then(() => {
  ready = true; resize(); render(frame); chime.measure(); render(frame); slider.max = String(LAST);
  root.querySelectorAll('button,input,select').forEach(el => el.disabled = false);
  status.textContent = 'プレビュー停止中';
}).catch(error => {
  status.textContent = error.message + '。再読み込みしてください。'; status.setAttribute('role', 'alert');
  const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '再読み込み';
  retry.addEventListener('click', () => location.reload()); status.after(retry);
});
