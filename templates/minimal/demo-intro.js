(() => {
  const root = document.getElementById('tankyu-intro');
  const stage = root.querySelector('.intro-stage');
  const canvas = root.querySelector('.intro-rail');
  const ctx = canvas.getContext('2d');
  const titleLayer = root.querySelector('.intro-title');
  const groupText = root.querySelector('.intro-group');
  const slider = root.querySelector('input');
  const playButton = root.querySelector('[data-action="play"]');
  const status = root.querySelector('[role="status"]');
  const timeOutput = root.querySelector('[data-time]');
  const frameOutput = root.querySelector('[data-frame]');
  const phaseOutput = root.querySelector('[data-phase]');

  const FPS = 60;
  const SPEC = {
    W: 1920, H: 1080, DURATION: 9.9, POSTER: 4.7,
    bg: [11, 11, 12],
    line: {
      y: 610, drawStart: 0.35, drawDur: 1.1,
      bright: [150, 150, 148], rest: [89, 89, 89], settleDur: 0.6,
      final: [38, 38, 42]
    },
    stations: {
      names: ['淀屋橋', '北浜', '天満橋', '京橋', '野江', '関目', '森小路', '千林', '滝井', '土居', '守口市', '西三荘', '門真市', '古川橋', '大和田', '萱島', '寝屋川市', '香里園', '光善寺', '枚方公園', '枚方市', '御殿山', '牧野', '樟葉', '橋本', '石清水八幡宮', '淀', '中書島', '伏見桃山', '丹波橋', '墨染', '藤森', '龍谷大前深草', '伏見稲荷', '鳥羽街道', '東福寺', '七条', '清水五条', '祇園四条', '三条', '神宮丸太町', '出町柳'],
      limitedExpress: ['淀屋橋', '北浜', '天満橋', '京橋', '枚方市', '樟葉', '中書島', '丹波橋', '七条', '祇園四条', '三条', '出町柳'],
      labels: ['淀屋橋', '京橋', '枚方市', '中書島', '三条', '出町柳'],
      home: '香里園',
      x0: 120, x1: 1800,
      tickStart: 1.35, tickStagger: 0.016, tickDur: 0.35,
      tick: 4, tickMajor: 7, flash: 5, flashRange: 26,
      labelOffset: 20, labelSize: 15, labelColor: '#7C7C82',
      homeLabelOpacity: 0.62
    },
    colors: { '特急': '#FF3B30', '快速急行': '#C445D6', '準急': '#2F7BFF', '普通': '#B8B8BC' },
    track: { offset: 4, enter: 200 },
    trail: { perSpeed: 0.3, min: 0, max: 700 },
    trains: [
      { kind: '特急', dir: 1, t0: 2.25, speed: 2200, revealsTitle: true },
      { kind: '準急', dir: -1, t0: 2.90, speed: 1000 },
      { kind: '快速急行', dir: 1, t0: 3.35, speed: 1500 },
      { kind: '普通', dir: -1, t0: 3.15, speed: 620 },
      { kind: '特急', dir: -1, t0: 4.45, speed: 2300 },
      { kind: '準急', dir: 1, speed: 1100, stopsAt: 5.6, brakeDur: 1.3 }
    ],
    group: { start: 0.75, dur: 0.8, spacingFrom: 0.6, spacingTo: 0.24 },
    title: { lines: ['京阪電車・京阪バス', '発車時刻リアルタイムサイネージ設置プロジェクト'], charDur: 0.55, rise: 22, outStart: 5.5, outDur: 0.45, outLift: 8 },
    arrival: { pulseDur: 0.75, pulseRadius: 40, ring: 5.5 },
    camera: { start: 6.0, dur: 1.3, zoom: 14, ease: [0.7, 0, 0.2, 1] },
    clock: { start: 6.75, digitStagger: 0.027 },
    assembly: { start: 7.15, columnGap: 0.38, rowStart: 0.18, rowGap: 0.05, cardDur: 0.48, cardEase: 'cubic-bezier(.65,0,.2,1)' }
  };
  const BEATS = [['線', 0], ['駅', 1.3], ['表題', 2.2], ['往来', 3.3], ['到着', 4.9], ['寄る', 5.95], ['組み上げ', 7.1]];
  const LAST = Math.round(SPEC.DURATION * FPS) - 1, DURATION = (LAST + 1) / FPS;
  const POSTER_FRAME = Math.round(SPEC.POSTER * FPS), CAMERA_FRAME = Math.round(BEATS[5][1] * FPS);

  let frame = POSTER_FRAME, playing = false, ready = false, firstPlay = true, raf = 0, epoch = 0;
  let boardFrame = null, doc = null, geo = null, animations = [], stationName = null, header = null;
  const chars = [];

  const clamp01 = x => Math.max(0, Math.min(1, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const prog = (t, start, dur) => clamp01((t - start) / dur);
  const outCubic = x => 1 - Math.pow(1 - x, 3);
  const inOutCubic = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  const smooth = x => x * x * (3 - 2 * x);
  function bezier([x1, y1, x2, y2]) {
    const f = (u, a, b) => 3 * (1 - u) * (1 - u) * u * a + 3 * (1 - u) * u * u * b + u * u * u;
    return x => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let lo = 0, hi = 1;
      for (let i = 0; i < 24; i++) { const u = (lo + hi) / 2; if (f(u, x1, x2) < x) lo = u; else hi = u; }
      return f((lo + hi) / 2, y1, y2);
    };
  }
  const cameraEase = bezier(SPEC.camera.ease);
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const mix = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));

  const S = SPEC.stations;
  const count = S.names.length, homeIndex = S.names.indexOf(S.home);
  const stationX = i => lerp(S.x0, S.x1, i / (count - 1));
  const homeX = stationX(homeIndex);
  const majors = new Set(S.limitedExpress), labelled = new Set(S.labels);
  const lead = SPEC.trains.find(train => train.revealsTitle);
  const stopper = SPEC.trains.find(train => train.stopsAt != null);

  SPEC.trains.forEach(train => {
    train.color = hex(SPEC.colors[train.kind]);
    if (train.stopsAt == null) return;
    train.brakeFrom = train.stopsAt - train.brakeDur;
    train.brakeX = homeX - train.speed * train.brakeDur / 2;
    train.t0 = train.brakeFrom - (train.brakeX + SPEC.track.enter) / train.speed;
  });
  function trainAt(train, t) {
    if (t < train.t0) return null;
    if (train.stopsAt != null) {
      if (t <= train.brakeFrom) return { x: train.brakeX - train.speed * (train.brakeFrom - t), v: train.speed };
      const u = Math.min(train.brakeDur, t - train.brakeFrom), a = train.speed / train.brakeDur;
      return { x: train.brakeX + train.speed * u - a * u * u / 2, v: Math.max(0, train.speed - a * u), stopped: t >= train.stopsAt };
    }
    const run = train.speed * (t - train.t0);
    const x = train.dir > 0 ? -SPEC.track.enter + run : SPEC.W + SPEC.track.enter - run;
    if (x < -SPEC.track.enter - SPEC.trail.max || x > SPEC.W + SPEC.track.enter + SPEC.trail.max) return null;
    return { x, v: train.speed };
  }

  /* 表題は1文字ずつ。特急の光が文字の位置を通った瞬間に立ち上げるため、各文字の中心を測っておく。 */
  SPEC.title.lines.forEach((text, index) => {
    const line = root.querySelector(index ? '.intro-line2' : '.intro-line1');
    for (const c of text) {
      const span = document.createElement('span');
      span.className = 'intro-ch'; span.textContent = c; line.append(span);
      chars.push({ span, x: 0, at: 0 });
    }
  });
  function measureTitle() {
    for (const c of chars) {
      c.x = c.span.offsetParent.offsetLeft + c.span.offsetLeft + c.span.offsetWidth / 2;
      c.at = lead.t0 + (c.x + SPEC.track.enter) / lead.speed;
    }
  }

  /* 駅名と下線の着地先は、案内画面（iframe）の実物の位置を測って使う。 */
  function measureBoard() {
    const screen = doc.getElementById('screen');
    const origin = screen.getBoundingClientRect();
    const scale = origin.width / parseFloat(doc.defaultView.getComputedStyle(screen).width) || 1;
    const local = element => {
      const previous = element.style.transform; element.style.transform = 'none';
      const r = element.getBoundingClientRect(); element.style.transform = previous;
      return { x: (r.left - origin.left) / scale, y: (r.top - origin.top) / scale, w: r.width / scale, h: r.height / scale };
    };
    const head = local(header), name = local(stationName);
    geo = {
      ruleY: head.y + head.h - 0.5, ruleLeft: head.x, ruleRight: head.x + head.w,
      name, nameScale: S.labelSize / parseFloat(doc.defaultView.getComputedStyle(stationName).fontSize)
    };
  }

  /* 案内画面の組み上げ。止めた Web Animations に時刻を流し込む。 */
  function motion(element, frames, start, duration, easing = 'cubic-bezier(.22,.8,.18,1)') {
    if (!element || element.closest('[hidden]')) return;
    const animation = element.animate(frames, { delay: start * 1000, duration: duration * 1000, easing, fill: 'both' });
    animation.pause(); animations.push(animation);
  }
  const lift = (el, start, duration = .38, y = 9) => motion(el, [
    { opacity: 0, clipPath: 'inset(100% 0 0 0)', transform: `translateY(${y}px)` },
    { opacity: 1, clipPath: 'inset(0 0 0 0)', transform: 'translateY(0)' }
  ], start, duration, 'cubic-bezier(.16,1,.3,1)');
  const sweep = (el, start, duration = .4, x = -4) => motion(el, [
    { opacity: 0, clipPath: 'inset(0 100% 0 0)', transform: `translateX(${x}px)` },
    { opacity: 1, clipPath: 'inset(0 0 0 0)', transform: 'translateX(0)' }
  ], start, duration);
  function edgeColor(card) {
    const kind = card.querySelector('.train-kind');
    if (!kind) return [241, 241, 238];
    const c = doc.defaultView.getComputedStyle(kind).backgroundColor.match(/[\d.]+/g).slice(0, 3).map(Number);
    const luminance = .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
    return luminance < 40 ? hex(SPEC.colors['普通']) : mix(c, [255, 255, 255], .28);
  }
  function buildAssembly() {
    const A = SPEC.assembly;
    header.style.borderBottomColor = 'transparent';
    doc.querySelectorAll('#clock-time > span,#clock-seconds > span')
      .forEach((digit, index) => lift(digit, SPEC.clock.start + index * SPEC.clock.digitStagger));
    motion(doc.getElementById('clock-date'), [{ opacity: 0, transform: 'translateY(3px)' }, { opacity: 1, transform: 'translateY(0)' }], SPEC.clock.start + .2, .3);
    ['normal-down', 'normal-up', 'normal-buses', 'normal-delays'].map(id => doc.getElementById(id)).forEach((column, index) => {
      const begin = A.start + index * A.columnGap, heading = column.firstElementChild;
      motion(heading, [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], begin, .5, 'cubic-bezier(.65,0,.25,1)');
      [...heading.children].forEach(child => sweep(child, begin, .38));
      const list = column.querySelector('.delay-list,[id$="-list"]');
      [...list.children].forEach((card, rowIndex) => {
        const row = begin + A.rowStart + rowIndex * A.rowGap, color = edgeColor(card), width = card.offsetWidth;
        motion(card, [
          { opacity: 0, clipPath: 'inset(0 100% 0 0)' },
          { opacity: 1, offset: .12 },
          { opacity: 1, clipPath: 'inset(0 0 0 0)' }
        ], row, A.cardDur, A.cardEase);
        if (doc.defaultView.getComputedStyle(card).position === 'static') card.style.position = 'relative';
        const edge = doc.createElement('span');
        edge.setAttribute('aria-hidden', 'true');
        edge.className = 'demo-intro-edge';
        edge.style.cssText = `position:absolute;left:-3px;top:0;bottom:0;width:3px;pointer-events:none;background:${rgb(color)};box-shadow:0 0 22px 3px ${rgb(color, .55)},0 0 4px 0 ${rgb(color)}`;
        card.append(edge);
        motion(edge, [
          { transform: 'translateX(0)', opacity: 0 },
          { opacity: 1, offset: .1 },
          { opacity: 1, offset: .8 },
          { transform: `translateX(${width + 3}px)`, opacity: 0 }
        ], row, A.cardDur, A.cardEase);
        const kind = card.querySelector('.train-kind');
        if (kind) {
          motion(kind, [{ filter: 'brightness(2.4) saturate(1.15)' }, { filter: 'brightness(1) saturate(1)' }], row + .1, .8, 'cubic-bezier(.2,.6,.2,1)');
          [...kind.children].forEach(child => motion(child, [{ opacity: 0 }, { opacity: 1 }], row + .22, .35));
          motion(card.querySelector('.departure-content'), [{ opacity: 0, transform: 'translateX(-8px)' }, { opacity: 1, transform: 'translateX(0)' }], row + .2, .45);
        }
      });
    });
  }
  function destroyAssembly() {
    animations.forEach(animation => animation.cancel());
    animations = [];
  }

  /* canvas: 線・駅・光 */
  function drawStreak(x, y, length, dir, color, alpha) {
    if (alpha <= 0) return;
    const tail = x - dir * length;
    ctx.globalCompositeOperation = 'lighter';
    if (length > 1) {
      const g = ctx.createLinearGradient(tail, 0, x, 0);
      g.addColorStop(0, rgb(color, 0)); g.addColorStop(1, rgb(color, alpha));
      ctx.fillStyle = g; ctx.fillRect(Math.min(tail, x), y - 1.5, length, 3);
      const soft = ctx.createLinearGradient(tail, 0, x, 0);
      soft.addColorStop(0, rgb(color, 0)); soft.addColorStop(1, rgb(color, alpha * .2));
      ctx.fillStyle = soft; ctx.fillRect(Math.min(tail, x), y - 7, length, 14);
    }
    const halo = ctx.createRadialGradient(x, y, 0, x, y, 34);
    halo.addColorStop(0, rgb(color, alpha * .75)); halo.addColorStop(.35, rgb(color, alpha * .22)); halo.addColorStop(1, rgb(color, 0));
    ctx.fillStyle = halo; ctx.fillRect(x - 34, y - 34, 68, 68);
    const core = ctx.createRadialGradient(x, y, 0, x, y, 4.5);
    core.addColorStop(0, rgb([255, 255, 255], alpha)); core.addColorStop(1, rgb([255, 255, 255], 0));
    ctx.fillStyle = core; ctx.fillRect(x - 5, y - 5, 10, 10);
    ctx.globalCompositeOperation = 'source-over';
  }
  function draw(t) {
    const L = SPEC.line, C = SPEC.camera;
    ctx.clearRect(0, 0, SPEC.W, SPEC.H);
    const k = cameraEase(prog(t, C.start, C.dur));
    const zoom = Math.pow(C.zoom, k);
    const anchor = lerp(homeX, geo.ruleLeft, k);
    const mapX = x => anchor + (x - homeX) * zoom;
    const y = lerp(L.y, geo.ruleY, k);

    const drawn = inOutCubic(prog(t, L.drawStart, L.drawDur));
    if (drawn > 0) {
      const headX = lerp(-20, SPEC.W + 20, drawn);
      const settled = smooth(prog(t, L.drawStart + L.drawDur * .6, L.settleDur));
      const color = mix(mix(L.bright, L.rest, settled), L.final, k);
      const left = lerp(0, geo.ruleLeft, k), right = Math.min(headX, lerp(SPEC.W, geo.ruleRight, k));
      ctx.fillStyle = rgb(color);
      ctx.fillRect(left, y - .5, Math.max(0, right - left), 1);
      if (drawn < 1) drawStreak(headX, y, 260 * Math.sin(Math.PI * drawn), 1, [241, 241, 238], 1);
    }

    const lights = [];
    for (const train of SPEC.trains) {
      const state = trainAt(train, t);
      if (state) lights.push({ train, ...state, sx: mapX(state.x) });
    }

    const fadeTicks = 1 - smooth(prog(k, .25, .6));
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.font = `400 ${S.labelSize}px "Zen Kaku Gothic New", "Noto Sans JP", sans-serif`;
    for (let i = 0; i < count; i++) {
      const p = outCubic(prog(t, S.tickStart + i * S.tickStagger, S.tickDur));
      if (p <= 0 || fadeTicks <= 0 || i === homeIndex) continue;
      const x = mapX(stationX(i));
      if (x < -40 || x > SPEC.W + 40) continue;
      let glow = 0, glowColor = [241, 241, 238];
      for (const light of lights) {
        const g = Math.exp(-Math.pow((light.sx - x) / (S.flashRange * zoom), 2));
        if (g > glow) { glow = g; glowColor = light.train.color; }
      }
      const name = S.names[i], major = majors.has(name);
      const half = (major ? S.tickMajor : S.tick) * p + S.flash * glow;
      ctx.fillStyle = rgb(mix(major ? [200, 200, 198] : [124, 124, 130], glowColor, glow), fadeTicks * p);
      ctx.fillRect(Math.round(x) - .5, y - half, 1 + glow, half * 2);
      if (labelled.has(name)) {
        const a = prog(t, S.tickStart + i * S.tickStagger + .12, .45) * (1 - prog(k, 0, .35));
        if (a > 0) { ctx.fillStyle = rgb(hex(S.labelColor), a); ctx.fillText(name, x, y + S.labelOffset); }
      }
    }

    const fadeLights = 1 - smooth(prog(k, .45, .5));
    for (const light of lights) {
      const { train } = light;
      const settle = light.stopped ? smooth(prog(t, train.stopsAt, .5)) : 0;
      const held = train.stopsAt != null ? 1 - smooth(prog(k, 0, .3)) : 1;
      const offset = (train.dir > 0 ? -SPEC.track.offset : SPEC.track.offset) * (1 - settle);
      const length = Math.max(SPEC.trail.min, Math.min(SPEC.trail.max, light.v * SPEC.trail.perSpeed)) * zoom;
      drawStreak(light.sx, y + offset, length, train.dir, train.color, fadeLights * held * (1 - .2 * settle));
    }

    const homeP = outCubic(prog(t, S.tickStart + homeIndex * S.tickStagger, S.tickDur));
    const fadeHome = 1 - smooth(prog(k, .15, .55));
    if (homeP > 0 && fadeHome > 0) {
      const hx = mapX(homeX);
      const arrived = prog(t, stopper.stopsAt, SPEC.arrival.pulseDur);
      if (arrived > 0 && arrived < 1) {
        ctx.strokeStyle = rgb(stopper.color, (1 - arrived) * .9 * fadeHome); ctx.lineWidth = lerp(2.5, .5, arrived);
        ctx.beginPath(); ctx.arc(hx, y, lerp(SPEC.arrival.ring, SPEC.arrival.pulseRadius, outCubic(arrived)), 0, Math.PI * 2); ctx.stroke();
      }
      const lit = smooth(prog(t, stopper.stopsAt - .1, .3));
      ctx.fillStyle = rgb(mix(SPEC.bg, stopper.color, lit * .55), fadeHome);
      ctx.strokeStyle = rgb(mix([241, 241, 238], [255, 255, 255], lit), fadeHome * homeP); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(hx, y, SPEC.arrival.ring * homeP, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    return k;
  }

  function phaseAt(t) {
    let name = BEATS[0][0];
    for (const [label, at] of BEATS) if (t >= at) name = label;
    return name;
  }
  function render(f) {
    frame = Math.max(0, Math.min(LAST, Math.round(f)));
    const t = frame / FPS, G = SPEC.group, T = SPEC.title;
    const k = draw(t);
    const out = prog(t, T.outStart, T.outDur), outA = 1 - smooth(out);
    titleLayer.style.transform = `scale(${scale}) translateY(${-T.outLift * outCubic(out)}px)`;
    const g = outCubic(prog(t, G.start, G.dur));
    groupText.style.opacity = String(g * outA);
    groupText.style.letterSpacing = `${lerp(G.spacingFrom, G.spacingTo, g)}em`;
    for (const c of chars) {
      const p = outCubic(prog(t, c.at, T.charDur));
      c.span.style.opacity = String(Math.min(1, p * 1.6) * outA);
      c.span.style.transform = `translateY(${(1 - p) * T.rise}px)`;
    }

    /* 駅名は案内画面の実物（#station-name）。寄る前は香里園の輪の下に縮めて置く。 */
    const n = geo.name, s0 = geo.nameScale;
    const shown = prog(t, S.tickStart + homeIndex * S.tickStagger + .12, .45);
    const lit = smooth(prog(t, stopper.stopsAt - .1, .4));
    stationName.style.transformOrigin = '0 0';
    stationName.style.transform = `translate(${lerp(homeX - n.w * s0 / 2 - n.x, 0, k)}px,${lerp(SPEC.line.y + S.labelOffset - (n.h * s0 - S.labelSize) / 2 - n.y, 0, k)}px) scale(${lerp(s0, 1, k)})`;
    stationName.style.opacity = String(shown * lerp(S.homeLabelOpacity, 1, Math.max(lit, k)));

    for (const animation of animations) animation.currentTime = t * 1000;
    slider.value = String(frame);
    timeOutput.value = `${t.toFixed(2)} / ${DURATION.toFixed(2)} 秒`;
    frameOutput.value = `${frame} / ${LAST} F · ${FPS} fps`;
    stage.dataset.frame = String(frame);
    phaseOutput.textContent = frame === LAST ? '完成' : phaseAt(t);
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
  root.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
    const action = button.dataset.action;
    if (action === 'play') { if (playing) pause(); else play(); }
    if (action === 'restart') play(true);
    if (action === 'transition') { pause(); firstPlay = false; render(CAMERA_FRAME); play(); }
    if (action === 'previous' || action === 'next') { pause(); firstPlay = false; render(frame + (action === 'previous' ? -1 : 1)); }
  }));
  slider.addEventListener('input', () => { pause(); firstPlay = false; render(Number(slider.value)); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && playing) pause(); });
  window.addEventListener('pagehide', event => { pause(); if (!event.persisted) destroyAssembly(); });
  root.intro = {
    seek(f) { if (ready) { pause(); firstPlay = false; render(f); } }, play, pause,
    get frame() { return frame; }, get playing() { return playing; }, get ready() { return ready; }
  };

  let scale = 1;
  const resize = () => {
    scale = stage.clientWidth / SPEC.W;
    const transform = `scale(${scale})`;
    canvas.style.transform = transform;
    if (boardFrame) boardFrame.style.transform = transform;
    if (ready) render(frame); else titleLayer.style.transform = transform;
  };
  new ResizeObserver(resize).observe(stage);

  function loadBoard() {
    return new Promise((resolve, reject) => {
      boardFrame = document.createElement('iframe'); boardFrame.className = 'intro-board';
      boardFrame.title = '組み上がる発車案内'; boardFrame.setAttribute('aria-hidden', 'true'); boardFrame.inert = true;
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
            await doc.fonts.ready;
            if (settled) return;
            boardFrame.contentWindow.scaleScreen();
            await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
            if (settled) return;
            header = doc.querySelector('#screen header'); stationName = doc.getElementById('station-name');
            measureBoard(); buildAssembly();
            boardFrame.style.visibility = 'visible'; finish(null);
          } catch (error) { finish(new Error('組み上げ演出を準備できませんでした')); }
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
      document.fonts.load('300 66px "Zen Kaku Gothic New"', SPEC.title.lines[1]),
      document.fonts.load('400 36px "Zen Kaku Gothic New"', SPEC.title.lines[0] + S.labels.join('')),
      document.fonts.load('500 20px "Zen Kaku Gothic New"', '探究1A-1班')
    ]),
    new Promise(resolve => setTimeout(resolve, 4000))
  ]).then(() => document.fonts.ready);
  Promise.all([fontsReady, loadBoard()]).then(() => {
    measureTitle(); ready = true; resize(); slider.max = String(LAST);
    root.querySelectorAll('button,input').forEach(el => el.disabled = false);
    status.textContent = 'プレビュー停止中';
  }).catch(error => {
    status.textContent = error.message + '。再読み込みしてください。'; status.setAttribute('role', 'alert');
    const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '再読み込み';
    retry.addEventListener('click', () => location.reload()); status.after(retry);
  });
})();
