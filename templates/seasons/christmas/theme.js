// クリスマス: 雪（文字の後ろに細かい雪、手前にごく薄い大きな雪）、見出しの下線に沿った電飾、ときどき横切るサンタのそり。
window.signageSeason.define('christmas', ({ screen, back, front, motion, hidden }) => {
  const BULBS = ['#E5343A', '#F2C14E', '#2FB866', '#FFF3DC'];
  const size = () => ({ w: screen.clientWidth, h: screen.clientHeight });
  const rand = (a, b) => a + Math.random() * (b - a);

  function snowfall(layer, count, make) {
    const canvas = document.createElement('canvas');
    canvas.className = 'xmas-snow';
    layer.append(canvas);
    const context = canvas.getContext('2d');
    let flakes = [];
    return {
      resize() {
        const { w, h } = size();
        canvas.width = w; canvas.height = h;
        flakes = Array.from({ length: count }, () => ({ ...make(), x: rand(0, w), y: rand(0, h), phase: rand(0, 6.28) }));
      },
      draw(dt, t) {
        const { width: w, height: h } = canvas;
        context.clearRect(0, 0, w, h);
        for (const f of flakes) {
          f.y += f.speed * dt;
          if (f.y > h + f.r) { f.y = -f.r; f.x = rand(0, w); }
          const x = f.x + Math.sin(t * f.sway + f.phase) * f.drift;
          context.globalAlpha = f.alpha;
          if (f.soft) {
            const glow = context.createRadialGradient(x, f.y, 0, x, f.y, f.r);
            glow.addColorStop(0, '#FFFFFF'); glow.addColorStop(1, 'rgba(255,255,255,0)');
            context.fillStyle = glow;
          } else context.fillStyle = '#E9EEF5';
          context.beginPath(); context.arc(x, f.y, f.r, 0, 6.2832); context.fill();
        }
      }
    };
  }

  const far = snowfall(back, 130, () => ({ r: rand(1, 2.8), speed: rand(14, 42), alpha: rand(.25, .75), sway: rand(.3, .9), drift: rand(4, 14) }));
  const near = snowfall(front, 12, () => ({ r: rand(7, 13), speed: rand(40, 70), alpha: rand(.10, .18), sway: rand(.2, .5), drift: rand(10, 26), soft: true }));

  const lights = document.createElement('div');
  lights.className = 'xmas-lights' + (motion ? ' is-moving' : '');
  front.append(lights);
  function hang() {
    const header = screen.querySelector('header');
    if (!header) return;
    const scale = screen.getBoundingClientRect().width / screen.clientWidth || 1;
    const box = header.getBoundingClientRect(), origin = screen.getBoundingClientRect();
    const left = (box.left - origin.left) / scale, width = box.width / scale, top = (box.bottom - origin.top) / scale - 1;
    const spans = Math.max(1, Math.round(width / 150)), span = width / spans, sag = 9;
    let path = `M${left} ${top}`, bulbs = '', index = 0;
    for (let i = 0; i < spans; i++) {
      const x0 = left + span * i;
      path += ` Q${x0 + span / 2} ${top + sag * 2} ${x0 + span} ${top}`;
      for (const t of [.125, .375, .625, .875]) {
        const x = x0 + span * t, y = top + 2 * t * (1 - t) * sag * 2 + 5;
        const duration = 3.2 + (index % 5) * .45, delay = -((index * .83) % duration);
        bulbs += `<i class="xmas-bulb" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;color:${BULBS[index % BULBS.length]};animation-duration:${duration}s;animation-delay:${delay.toFixed(2)}s"></i>`;
        index++;
      }
    }
    lights.innerHTML = `<svg width="1" height="1"><path d="${path}" fill="none" stroke="#1E6B3C" stroke-width="5" stroke-linecap="round"/>`
      + `<path d="${path}" fill="none" stroke="#3FA060" stroke-width="5" stroke-linecap="round" stroke-dasharray="1 7"/></svg>${bulbs}`;
  }

  // サンタのそり。文字の後ろの層を、見出しの帯に沿って左から右へ横切る
  const FLIGHT_FIRST = 6, FLIGHT_EVERY = 80, FLIGHT_SECONDS = 18;
  const deer = (x, y, nose) => `<g transform="translate(${x} ${y})">`
    + '<g stroke="#8A5A32" stroke-width="3.2" stroke-linecap="round"><path d="M11 4l13 9M7 5l7 13M-11 4l-14 8M-8 5l-5 13"/></g>'
    + '<ellipse rx="17" ry="7.5" fill="#A8703F"/><path d="M10-3l9-15 7 3-6 15z" fill="#A8703F"/>'
    + '<ellipse cx="27" cy="-18" rx="7.5" ry="4.6" transform="rotate(-14 27 -18)" fill="#A8703F"/>'
    + '<path d="M23-22l-3-10m3 10l4-9m-6 3l-5-2m9 1l4-2" stroke="#D9B77A" stroke-width="1.7" stroke-linecap="round" fill="none"/>'
    + '<circle cx="-18" cy="-3" r="2.6" fill="#F4EAD5"/>'
    + `<circle cx="34.5" cy="-18.5" r="2.4" fill="${nose}"/></g>`;
  const santa = document.createElement('div');
  santa.className = 'xmas-santa';
  santa.innerHTML = '<svg viewBox="0 0 300 96" width="300" height="96">'
    + '<path d="M78 46L150 52M150 52L222 46" stroke="#C9A227" stroke-width="1.4" fill="none"/>'
    + deer(168, 56, '#3A2A1C') + deer(240, 50, '#FF3B30')
    + '<circle cx="30" cy="38" r="15" fill="#2E8B4E"/><path d="M22 27q8-9 16 0" stroke="#C9A227" stroke-width="2" fill="none"/>'
    + '<path d="M40 30q14-6 22 6l2 18h-26z" fill="#D8282F"/><rect x="38" y="48" width="27" height="5" fill="#F4EAD5"/>'
    + '<circle cx="58" cy="24" r="7" fill="#F3C9A8"/><path d="M52 26q7 12 14 0q-1 9-7 10q-6-1-7-10z" fill="#FFFFFF"/>'
    + '<path d="M50 21q8-17 18-3z" fill="#D8282F"/><rect x="49" y="19" width="19" height="4.5" rx="2" fill="#FFFFFF"/><circle cx="70" cy="17" r="3.2" fill="#FFFFFF"/>'
    + '<path d="M62 40l16 6" stroke="#D8282F" stroke-width="5" stroke-linecap="round"/><circle cx="79" cy="46" r="3" fill="#F4EAD5"/>'
    + '<path d="M8 44q0 26 24 26h46q18 0 20-22l-12 0q-2 10-10 10h-44q-10 0-12-14z" fill="#B81E26"/>'
    + '<path d="M10 46q2 22 22 22h46q15 0 18-18" stroke="#F2C14E" stroke-width="2" fill="none"/>'
    + '<path d="M30 70v10M72 70v10" stroke="#C9A227" stroke-width="2.5"/>'
    + '<path d="M6 82h82q14 0 18-12" stroke="#F2C14E" stroke-width="3.2" stroke-linecap="round" fill="none"/>'
    + '</svg>';
  back.append(santa);
  function fly(t) {
    const phase = ((t - FLIGHT_FIRST) % FLIGHT_EVERY + FLIGHT_EVERY) % FLIGHT_EVERY / FLIGHT_SECONDS;
    if (t < FLIGHT_FIRST || phase >= 1) { santa.style.visibility = 'hidden'; return; }
    const { w } = size(), x = -320 + (w + 640) * phase;
    const y = 86 - 58 * Math.sin(Math.PI * phase) + Math.sin(t * 2.2) * 5;
    const tilt = -Math.cos(Math.PI * phase) * 9 + Math.sin(t * 2.2 + 1) * 1.5;
    santa.style.visibility = 'visible';
    santa.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) rotate(${tilt.toFixed(2)}deg)`;
  }
  let started = 0;

  function layout() { far.resize(); near.resize(); hang(); far.draw(0, 0); near.draw(0, 0); }
  const observer = new ResizeObserver(layout);
  observer.observe(screen);
  layout();

  let frame = 0, last = 0, skip = false;
  function tick(now) {
    frame = requestAnimationFrame(tick);
    // 30コマ/秒で足りる。隠れているあいだは描かない
    skip = !skip;
    if (skip || hidden()) { if (!skip) last = now; return; }
    const dt = Math.min(.1, (now - (last || now)) / 1000);
    last = now;
    far.draw(dt, now / 1000); near.draw(dt, now / 1000);
    started = started || now;
    fly((now - started) / 1000);
  }
  if (motion) frame = requestAnimationFrame(tick);

  return () => { cancelAnimationFrame(frame); observer.disconnect(); };
});
