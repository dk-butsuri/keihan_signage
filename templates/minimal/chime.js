import { createChime } from './chime-core.js';

const HOUR = 3600000;
const STYLE = `
.signage-chime{position:absolute;left:0;top:0;pointer-events:none;z-index:50}
.signage-chime-title{position:absolute;width:1920px;height:1080px;white-space:nowrap;transform-origin:0 0}
.signage-chime-title .chime-group{position:absolute;left:120px;top:300px;font-size:20px;font-weight:500;line-height:1;color:#7C7C82;letter-spacing:.24em}
.signage-chime-title .chime-date{position:absolute;left:120px;top:344px;font-size:36px;font-weight:400;letter-spacing:.06em;line-height:1;color:#A1A1A6}
.signage-chime-title .chime-clock{position:absolute;left:112px;top:404px;display:flex;align-items:baseline;gap:8px;font-weight:300;line-height:.9;font-variant-numeric:tabular-nums}
.signage-chime-title .chime-time{display:flex;font-size:168px}.signage-chime-title .chime-seconds{display:flex;font-size:84px;color:#A1A1A6}
.signage-chime-title .chime-ch{display:inline-block;white-space:pre}
.signage-chime-title .chime-time .chime-ch,.signage-chime-title .chime-seconds .chime-ch{flex:0 0 .58em;width:.58em;text-align:center}
.signage-chime-title .chime-ch.is-separator{flex-basis:.22em;width:.22em}`;

/* 毎正時の10秒前から時報の演出を流す。now() は補正済みの時刻、canPlay() は今流してよいか。
   流せない状況（見合わせ・取得エラー・起動演出の途中など）ならその回は飛ばし、途中でそうなったら発車案内へ戻す。 */
export function startHourlyChime({ doc, now, canPlay, variant = 'hype' }) {
  const win = doc.defaultView, root = doc.documentElement, screen = doc.getElementById('screen');
  const motion = win.matchMedia('(prefers-reduced-motion: reduce)');
  let timer = null, run = null;
  const style = doc.createElement('style'); style.textContent = STYLE; doc.head.append(style);

  function schedule() {
    clearTimeout(timer);
    const t = now(), lead = 10000;
    /* 準備の時間を残せない近さの正時は飛ばす。 */
    const hour = Math.ceil((t + lead + 1500) / HOUR) * HOUR;
    timer = win.setTimeout(() => prepare(hour), Math.max(0, hour - lead - 1000 - t));
  }

  function prepare(hour) {
    try {
      if (run || doc.hidden || motion.matches || !canPlay()) { schedule(); return; }
      const overlay = doc.createElement('div'); overlay.className = 'signage-chime'; overlay.setAttribute('aria-hidden', 'true');
      const canvas = doc.createElement('canvas');
      const title = doc.createElement('div'); title.className = 'signage-chime-title';
      title.innerHTML = '<div class="chime-group"></div><div class="chime-date"></div><div class="chime-clock"><div class="chime-time"></div><div class="chime-seconds"></div></div>';
      overlay.append(canvas, title);
      const previousPosition = screen.style.position;
      if (win.getComputedStyle(screen).position === 'static') screen.style.position = 'relative';
      screen.append(overlay);
      const slots = Object.fromEntries(['group', 'date', 'time', 'seconds'].map(name => [name, title.querySelector('.chime-' + name)]));
      let origin = { x: 0, y: 0 };
      const fit = () => {
        const width = parseFloat(screen.style.width) || 1920, height = parseFloat(screen.style.height) || 1080;
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        overlay.style.width = width + 'px'; overlay.style.height = height + 'px';
        origin = { x: (width - 1920) / 2, y: (height - 1080) / 2 };
        title.style.left = origin.x + 'px'; title.style.top = origin.y + 'px';
      };
      fit();
      const chime = createChime({ boardDoc: doc, canvas, titleLayer: title, slots, variant, hourStamp: () => hour, origin: () => origin });
      chime.measure();
      overlay.style.visibility = 'hidden';
      run = { hour, chime, overlay, previousPosition, started: false, raf: 0, observer: null, fit, rebuild: 0 };
      /* 演出中に発車案内が描き直されたら、新しい札にも同じ時刻の組み上げを付け直す。 */
      run.observer = new win.MutationObserver(records => {
        if (!run?.started || records.every(record => [...record.addedNodes, ...record.removedNodes].every(node => node.dataset?.chimeHelper))) return;
        win.cancelAnimationFrame(run.rebuild);
        run.rebuild = win.requestAnimationFrame(() => {
          if (!run) return;
          run.observer.disconnect();
          run.chime.destroyAssembly(); run.chime.buildAssembly();
          observe();
        });
      });
      run.raf = win.requestAnimationFrame(frame);
    } catch (error) { finish(); }
  }

  function observe() {
    for (const id of ['normal', 'operation-slides']) {
      const element = doc.getElementById(id);
      if (element) run.observer.observe(element, { childList: true, subtree: true });
    }
  }

  function frame() {
    if (!run) return;
    try {
      const t = (now() - (run.hour - run.chime.ON * 1000)) / 1000;
      if (t < 0) { run.raf = win.requestAnimationFrame(frame); return; }
      if (!run.started) {
        if (t > .5 || doc.hidden || motion.matches || !canPlay()) { finish(); return; }
        run.started = true; root.dataset.chime = 'running';
        run.chime.buildAssembly(); observe();
        run.overlay.style.visibility = '';
        doc.dispatchEvent(new Event('signage:assembly-state'));
      }
      if (t >= run.chime.DURATION || doc.hidden || motion.matches || !doc.getElementById('suspended').hidden) { finish(); return; }
      run.fit();
      run.chime.render(t);
      run.raf = win.requestAnimationFrame(frame);
    } catch (error) { finish(); }
  }

  function finish() {
    if (run) {
      const ended = run; run = null;
      win.cancelAnimationFrame(ended.raf); win.cancelAnimationFrame(ended.rebuild); ended.observer?.disconnect();
      try { ended.chime.destroy(); } catch (error) {}
      ended.overlay.remove(); screen.style.position = ended.previousPosition;
      if (root.dataset.chime) { delete root.dataset.chime; doc.dispatchEvent(new Event('signage:assembly-state')); }
    }
    schedule();
  }

  doc.addEventListener('visibilitychange', () => { if (doc.hidden && run?.started) finish(); });
  schedule();
  return { finish, get running() { return !!run?.started; } };
}
