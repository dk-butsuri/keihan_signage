// 正月: 金と白の紙吹雪（文字の後ろ）、見出しの下線に沿ったしめ縄と紙垂、ときどき横切る鶴。
window.signageSeason.define('shogatsu', ({ screen, back, front, motion, hidden }) => {
  const COLORS = ['#E3BC55', '#E3BC55', '#F6E7B0', '#FFFFFF', '#D7262B'];
  const size = () => ({ w: screen.clientWidth, h: screen.clientHeight });
  const rand = (a, b) => a + Math.random() * (b - a);

  const canvas = document.createElement('canvas');
  canvas.className = 'ny-flakes';
  back.append(canvas);
  const context = canvas.getContext('2d');
  let flakes = [];
  function scatter() {
    const { w, h } = size();
    canvas.width = w; canvas.height = h;
    flakes = Array.from({ length: 110 }, () => ({
      x: rand(0, w), y: rand(0, h), s: rand(4, 9), speed: rand(10, 28), drift: rand(8, 22), sway: rand(.3, .8),
      phase: rand(0, 6.28), spin: rand(.6, 2.2), alpha: rand(.35, .85), color: COLORS[Math.floor(rand(0, COLORS.length))]
    }));
  }
  function drawFlakes(dt, t) {
    const { width: w, height: h } = canvas;
    context.clearRect(0, 0, w, h);
    for (const f of flakes) {
      f.y += f.speed * dt;
      if (f.y > h + f.s) { f.y = -f.s; f.x = rand(0, w); }
      const turn = t * f.spin + f.phase;
      context.save();
      context.translate(f.x + Math.sin(t * f.sway + f.phase) * f.drift, f.y);
      context.rotate(turn * .5);
      // 紙がひるがえるように、幅を周期的につぶす
      context.scale(Math.max(.12, Math.abs(Math.cos(turn))), 1);
      context.globalAlpha = f.alpha;
      context.fillStyle = f.color;
      context.fillRect(-f.s / 2, -f.s / 2, f.s, f.s);
      context.restore();
    }
  }

  const SHIDE = '<svg viewBox="0 0 22 34" width="18" height="28"><path d="M7 0h8v9h5v10h-5v7h5v8h-11v-8h-5v-9h5v-8h-2z" fill="#FFFFFF"/></svg>';
  const TASSEL = '<svg viewBox="0 0 14 22" width="14" height="22"><path d="M7 0L1 21M7 0l-2 22M7 0l2 22M7 0l6 21" stroke="#D9BC72" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>';
  const rope = document.createElement('div');
  rope.className = 'ny-rope' + (motion ? ' is-moving' : '');
  front.append(rope);
  function hang() {
    const header = screen.querySelector('header');
    if (!header) return;
    const origin = screen.getBoundingClientRect(), box = header.getBoundingClientRect();
    const scale = origin.width / screen.clientWidth || 1;
    const left = (box.left - origin.left) / scale, width = box.width / scale, top = (box.bottom - origin.top) / scale + 1;
    const count = Math.max(2, Math.round(width / 230)), step = width / count;
    let items = '';
    for (let i = 0; i < count; i++) {
      const x = left + step * (i + .5), delay = -(i * 1.3 % 5);
      items += `<i class="ny-shide" style="left:${x.toFixed(1)}px;top:${top + 2}px;animation-delay:${delay}s">${SHIDE}</i>`;
      if (i) items += `<i class="ny-tassel" style="left:${(left + step * i).toFixed(1)}px;top:${top + 2}px;animation-delay:${delay - 2}s">${TASSEL}</i>`;
    }
    const line = `M${left} ${top}H${left + width}`;
    rope.innerHTML = `<svg width="1" height="1"><path d="${line}" stroke="#B8944A" stroke-width="6" stroke-linecap="round"/>`
      + `<path d="${line}" stroke="#E6CE8C" stroke-width="6" stroke-dasharray="3 7" transform="skewX(-30)" transform-origin="${left} ${top}"/></svg>${items}`;
  }

  // 鶴。文字の後ろの層を、見出しの帯に沿って左から右へ横切る
  const FLIGHT_FIRST = 6, FLIGHT_EVERY = 70, FLIGHT_SECONDS = 20;
  const wing = '<path d="M112 66q-14-44-64-58q34 22 40 60z" fill="#FFFFFF"/><path d="M48 8q26 14 36 44l-12-8q-8-22-24-36z" fill="#55555C"/>';
  const crane = document.createElement('div');
  crane.className = 'ny-crane';
  crane.innerHTML = '<svg viewBox="0 0 230 130" width="230" height="130">'
    + '<path d="M82 74L30 84M84 77L34 90" stroke="#8A8A90" stroke-width="2" stroke-linecap="round"/>'
    + `<g class="wing" opacity=".8">${wing}</g>`
    + '<path d="M70 72q40-16 76-4q-36 18-76 4z" fill="#FFFFFF"/><path d="M70 72l-22 4l24 4z" fill="#55555C"/>'
    + '<path d="M140 68q30-2 54-16" stroke="#FFFFFF" stroke-width="6" stroke-linecap="round" fill="none"/>'
    + '<path d="M160 65q18-4 32-12" stroke="#55555C" stroke-width="4" stroke-linecap="round" fill="none"/>'
    + '<circle cx="196" cy="51" r="5.5" fill="#FFFFFF"/><circle cx="196" cy="47" r="3.2" fill="#D7262B"/>'
    + '<path d="M200 51l18 3l-18 2z" fill="#D9BC72"/>'
    + `<g class="wing">${wing}</g></svg>`;
  back.append(crane);
  const wings = [...crane.querySelectorAll('.wing')].reverse();
  function fly(t) {
    const phase = ((t - FLIGHT_FIRST) % FLIGHT_EVERY + FLIGHT_EVERY) % FLIGHT_EVERY / FLIGHT_SECONDS;
    if (t < FLIGHT_FIRST || phase >= 1) { crane.style.visibility = 'hidden'; return; }
    const { w } = size(), x = -260 + (w + 520) * phase;
    const y = 40 - 34 * Math.sin(Math.PI * phase) + Math.sin(t * 1.4) * 6;
    crane.style.visibility = 'visible';
    const flap = .25 + .75 * Math.cos(t * 4.4);
    wings.forEach((el, i) => el.setAttribute('transform', `translate(${112 + i * 6} 66) scale(1 ${(i ? flap : flap * .9).toFixed(3)}) translate(-112 -66)`));
    crane.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) rotate(${(-Math.cos(Math.PI * phase) * 6).toFixed(2)}deg)`;
  }

  function layout() { scatter(); hang(); drawFlakes(0, 0); }
  const observer = new ResizeObserver(layout);
  observer.observe(screen);
  layout();

  let frame = 0, last = 0, started = 0, skip = false;
  function tick(now) {
    frame = requestAnimationFrame(tick);
    skip = !skip;
    if (skip || hidden()) { if (!skip) last = now; return; }
    const dt = Math.min(.1, (now - (last || now)) / 1000);
    last = now;
    drawFlakes(dt, now / 1000);
    started = started || now;
    fly((now - started) / 1000);
  }
  if (motion) frame = requestAnimationFrame(tick);

  return () => { cancelAnimationFrame(frame); observer.disconnect(); };
});
