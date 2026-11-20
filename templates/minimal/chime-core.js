/* 時報「本線」の描画。デモ（demo-chime.js）と本番（chime.js）の両方から使う。
   boardDoc は発車案内の文書、canvas と titleLayer は重ね板。hourStamp() は正時の時刻（ミリ秒）。
   演出は 1920×1080 の枠で描く。画面がそれより広いときは origin() で枠の左上（画面の座標）を渡す。 */
export function createChime({ boardDoc: doc, canvas, titleLayer, slots, variant = '', hourStamp, titleBase = () => '', origin = () => ({ x: 0, y: 0 }) }) {
  const ctx = canvas.getContext('2d');
  const header = doc.querySelector('#screen header'), stationName = doc.getElementById('station-name');
  let geo = null, animations = [], helpers = [], restores = [];
  /* 起動イントロ「本線」（demo-intro.js）と同じ線・駅・光・寄り方を使う。
     intro の値は intro 側の時刻で書いてあり、離れる・寄る・組み上げは intro の時刻へ写して再生する。 */
  const SPEC = {
    W: 1920, H: 1080, DURATION: 15.5, ON: 10, POSTER: 10.35,
    bg: [11, 11, 12],
    line: { y: 610, rest: [89, 89, 89], final: [38, 38, 42] },
    stations: {
      names: ['淀屋橋', '北浜', '天満橋', '京橋', '野江', '関目', '森小路', '千林', '滝井', '土居', '守口市', '西三荘', '門真市', '古川橋', '大和田', '萱島', '寝屋川市', '香里園', '光善寺', '枚方公園', '枚方市', '御殿山', '牧野', '樟葉', '橋本', '石清水八幡宮', '淀', '中書島', '伏見桃山', '丹波橋', '墨染', '藤森', '龍谷大前深草', '伏見稲荷', '鳥羽街道', '東福寺', '七条', '清水五条', '祇園四条', '三条', '神宮丸太町', '出町柳'],
      limitedExpress: ['淀屋橋', '北浜', '天満橋', '京橋', '枚方市', '樟葉', '中書島', '丹波橋', '七条', '祇園四条', '三条', '出町柳'],
      labels: ['淀屋橋', '京橋', '枚方市', '中書島', '三条', '出町柳'],
      home: '香里園',
      x0: 120, x1: 1800,
      tick: 4, tickMajor: 7, flash: 5, flashRange: 26,
      labelOffset: 20, labelSize: 15, labelColor: '#7C7C82',
      homeLabelOpacity: 0.62
    },
    colors: { '特急': '#FF3B30', '快速急行': '#C445D6', '準急': '#2F7BFF', '普通': '#B8B8BC' },
    track: { offset: 4, enter: 200 },
    trail: { perSpeed: 0.3, min: 0, max: 700 },
    /* 正時に止まるのは香里園に停車する種別だけ（特急・快速急行は通過する）。 */
    trains: [
      { kind: '特急', dir: 1, t0: 2.1, speed: 2200, revealsTitle: true },
      { kind: '普通', dir: -1, t0: 2.5, speed: 620 },
      { kind: '快速急行', dir: 1, t0: 3.3, speed: 1500 },
      { kind: '準急', dir: -1, t0: 4.1, speed: 1000 },
      { kind: '特急', dir: -1, t0: 5.4, speed: 2300 },
      { kind: '快速急行', dir: 1, t0: 6.2, speed: 1500 },
      { kind: '普通', dir: -1, speed: 900, stopsAt: 10, brakeDur: 1.4 },
      { kind: '準急', dir: 1, speed: 1500, stopsAt: 10, brakeDur: 1.1, chime: true }
    ],
    /* [時報の時刻, intro の時刻]。0.9秒で組み上げを逆にたどり、1.3秒で線路まで引く。 */
    leave: [[0, 9.9], [0.9, 7.3], [2.2, 6.0]],
    enter: 11.6,
    intro: { camera: { start: 6.0, dur: 1.3, zoom: 14, ease: [0.7, 0, 0.2, 1] }, clockStart: 6.75, end: 9.9,
      assembly: { start: 7.15, columnGap: 0.38, rowStart: 0.18, rowGap: 0.05, cardDur: 0.48, cardEase: 'cubic-bezier(.65,0,.2,1)' } },
    title: { group: '時報', charDur: 0.55, rise: 22, outStart: 11.35, outDur: 0.45, outLift: 8, flipDur: 0.32, flipRise: 16 },
    countdown: { from: 7, stations: 2, stepDur: 0.3, flashDur: 0.55 },
    arrival: { ring: 5.5, pulseDur: 1.4, pulseRadius: 120, innerDur: 0.7, innerRadius: 56, glow: 70 },
    wave: { dur: 1.0, reach: 1300, tail: 360 }
  };
  /* わくわく版：正時に向けて光が増え、香里園を通るたびに輪へ色がたまって明るくなり、00秒でその色が線の両側へ弾ける。 */
  const HYPE = variant === 'hype';
  const HYPED = { push: .08, release: .45, secondsGrow: .3, beat: 7, hop: .28, burst: 14, burstDur: 1.3 };
  if (HYPE) {
    SPEC.trains.splice(SPEC.trains.length - 2, 0, ...[
      ['準急', 1, 5.0, 1700], ['快速急行', -1, 5.6, 1900], ['特急', 1, 6.2, 2200], ['準急', -1, 6.7, 1800],
      ['快速急行', 1, 7.15, 2100], ['特急', -1, 7.55, 2300], ['普通', 1, 7.9, 1600], ['準急', -1, 8.2, 2000],
      ['特急', 1, 8.5, 2500], ['快速急行', -1, 8.75, 2400], ['特急', -1, 9.15, 2800]
    ].map(([kind, dir, t0, speed]) => ({ kind, dir, t0, speed, collect: true })));
    Object.assign(SPEC.arrival, { pulseRadius: 190, innerRadius: 80, glow: 110 });
  }
  const ON = SPEC.ON;
  const BEATS = [['離れる', 0], ['往来', 2.2], ['秒読み', ON - SPEC.countdown.from], ['正時', ON], ['寄る', SPEC.enter], ['組み上げ', SPEC.enter + 1.15]];
  const DURATION = SPEC.DURATION;

  const clamp01 = x => Math.max(0, Math.min(1, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const prog = (t, start, dur) => clamp01((t - start) / dur);
  const outCubic = x => 1 - Math.pow(1 - x, 3);
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
  const cameraEase = bezier(SPEC.intro.camera.ease);
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const mix = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
  const WHITE = [241, 241, 238];
  const PALETTE = ['準急', '特急', '快速急行', '普通'].map(kind => hex(SPEC.colors[kind]));
  function hypeAt(t) {
    if (!HYPE) return 0;
    if (t < ON) return Math.pow(prog(t, ON - SPEC.countdown.from - 1, SPEC.countdown.from + 1), 1.5);
    return 1 - outCubic(prog(t, ON, HYPED.release));
  }
  /* 秒の境目ごとの拍。1秒の中で減衰する。 */
  const beatAt = t => HYPE && t < ON && t >= ON - SPEC.countdown.from ? Math.exp(-(t - Math.floor(t)) * HYPED.beat) : 0;
  /* 秒の境目ごとに跳ねる高さ（0〜1）。 */
  function hopAt(t) {
    if (!HYPE || t >= ON || t < ON - SPEC.countdown.from) return 0;
    const s = t - Math.floor(t);
    return s < HYPED.hop ? Math.sin(s / HYPED.hop * Math.PI) : 0;
  }
  const pushAt = t => 1 + HYPED.push * hypeAt(t);

  const S = SPEC.stations;
  const count = S.names.length, homeIndex = S.names.indexOf(S.home);
  const stationX = i => lerp(S.x0, S.x1, i / (count - 1));
  const homeX = stationX(homeIndex);
  const majors = new Set(S.limitedExpress), labelled = new Set(S.labels);
  const lead = SPEC.trains.find(train => train.revealsTitle);
  const chimeTrain = SPEC.trains.find(train => train.chime);
  const chimeColor = hex(SPEC.colors[chimeTrain.kind]);

  SPEC.trains.forEach(train => {
    train.color = hex(SPEC.colors[train.kind]);
    if (train.stopsAt == null) return;
    train.brakeFrom = train.stopsAt - train.brakeDur;
    train.brakeX = homeX - train.dir * train.speed * train.brakeDur / 2;
    const entry = train.dir > 0 ? train.brakeX + SPEC.track.enter : SPEC.W + SPEC.track.enter - train.brakeX;
    train.t0 = train.brakeFrom - entry / train.speed;
  });
  SPEC.trains.forEach(train => {
    if (train.collect) train.passAt = train.t0 + (train.dir > 0 ? homeX + SPEC.track.enter : SPEC.W + SPEC.track.enter - homeX) / train.speed;
  });
  const collectors = SPEC.trains.filter(train => train.collect);
  function trainAt(train, t) {
    if (t < train.t0) return null;
    if (train.stopsAt != null) {
      if (t <= train.brakeFrom) return { x: train.brakeX - train.dir * train.speed * (train.brakeFrom - t), v: train.speed };
      const u = Math.min(train.brakeDur, t - train.brakeFrom), a = train.speed / train.brakeDur;
      return { x: train.brakeX + train.dir * (train.speed * u - a * u * u / 2), v: Math.max(0, train.speed - a * u), stopped: t >= train.stopsAt };
    }
    const run = train.speed * (t - train.t0);
    const x = train.dir > 0 ? -SPEC.track.enter + run : SPEC.W + SPEC.track.enter - run;
    if (x < -SPEC.track.enter - SPEC.trail.max || x > SPEC.W + SPEC.track.enter + SPEC.trail.max) return null;
    return { x, v: train.speed };
  }
  function introAt(t) {
    const [a, b, c] = SPEC.leave;
    if (t < b[0]) return lerp(a[1], b[1], t / b[0]);
    if (t < c[0]) return lerp(b[1], c[1], (t - b[0]) / (c[0] - b[0]));
    if (t < SPEC.enter) return c[1];
    return Math.min(SPEC.intro.end, c[1] + t - SPEC.enter);
  }
  /* 正時の光の波が香里園から距離 d に届く時刻（波の先頭は outCubic で減速する）。 */
  function waveReaches(d) {
    const W = SPEC.wave;
    if (d >= W.reach) return Infinity;
    return ON + W.dur * (1 - Math.cbrt(1 - d / W.reach));
  }


  /* 時刻の文字。正時の時刻 hourStamp() からの秒で決めるので、どの時点を描いても同じ絵になる。 */
  const pad = n => String(n).padStart(2, '0');
  const WEEK = '日月火水木金土';
  const stampAt = second => hourStamp() + second * 1000;
  function textsAt(second) {
    const d = new Date(stampAt(second) + 9 * 3600000);
    return {
      group: SPEC.title.group,
      date: `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${WEEK[d.getUTCDay()]}曜日`,
      time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
      seconds: `:${pad(d.getUTCSeconds())}`
    };
  }
  const secondAt = t => Math.floor(t - ON);
  const firstSecond = secondAt(0);
  const chars = [];
  function buildTitle() {
    const longest = {};
    for (let s = firstSecond; s <= secondAt(SPEC.DURATION); s++) {
      for (const [slot, text] of Object.entries(textsAt(s))) longest[slot] = Math.max(longest[slot] || 0, [...text].length);
    }
    for (const [slot, element] of Object.entries(slots)) {
      element.replaceChildren();
      for (let index = 0; index < longest[slot]; index++) {
        const span = titleLayer.ownerDocument.createElement('span');
        span.className = 'chime-ch'; element.append(span);
        chars.push({ span, slot, index, x: 0, at: 0, wave: Infinity });
      }
    }
  }
  function charAt(slot, index, second) { return [...textsAt(second)[slot]][index] || ''; }
  /* その文字が最後に変わった秒。変わった瞬間だけ下から入れ替える。 */
  function changedAt(c, t) {
    let s = secondAt(t);
    while (s > firstSecond && charAt(c.slot, c.index, s) === charAt(c.slot, c.index, s - 1)) s--;
    return s > firstSecond ? ON + s : -Infinity;
  }
  function measureTitle() {
    const base = titleLayer.getBoundingClientRect(), scale = base.width / SPEC.W || 1;
    for (const c of chars) {
      const r = c.span.getBoundingClientRect();
      c.x = (r.left + r.width / 2 - base.left) / scale;
      c.at = lead.t0 + (c.x + SPEC.track.enter) / lead.speed;
      c.wave = waveReaches(Math.abs(homeX - c.x));
    }
  }


  /* 駅名と下線の着地先は、案内画面の実物の位置を測って使う。 */
  function measureBoard() {
    const screen = doc.getElementById('screen');
    const box = screen.getBoundingClientRect(), o = origin();
    const ratio = box.width / parseFloat(doc.defaultView.getComputedStyle(screen).width) || 1;
    const local = element => {
      const previous = element.style.transform; element.style.transform = 'none';
      const r = element.getBoundingClientRect(); element.style.transform = previous;
      return { x: (r.left - box.left) / ratio - o.x, y: (r.top - box.top) / ratio - o.y, w: r.width / ratio, h: r.height / ratio };
    };
    const head = local(header), name = local(stationName);
    geo = {
      ruleY: head.y + head.h - 0.5, ruleLeft: head.x, ruleRight: head.x + head.w,
      name, nameScale: S.labelSize / parseFloat(doc.defaultView.getComputedStyle(stationName).fontSize)
    };
  }


  function changeStyle(element, name, value) {
    restores.push([element, name, element.style[name]]); element.style[name] = value;
  }
  /* 組み上げは起動イントロと同じもの。intro の時刻を流し込むので、離れるときは逆向きに再生される。 */
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
    if (!kind) return WHITE;
    const c = doc.defaultView.getComputedStyle(kind).backgroundColor.match(/[\d.]+/g).slice(0, 3).map(Number);
    const luminance = .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
    return luminance < 40 ? hex(SPEC.colors['普通']) : mix(c, [255, 255, 255], .28);
  }
  function buildAssembly() {
    const A = SPEC.intro.assembly, clockStart = SPEC.intro.clockStart;
    changeStyle(header, 'borderBottomColor', 'transparent');
    doc.querySelectorAll('#clock-time > span,#clock-seconds > span')
      .forEach((digit, index) => lift(digit, clockStart + index * .027));
    motion(doc.getElementById('clock-date'), [{ opacity: 0, transform: 'translateY(3px)' }, { opacity: 1, transform: 'translateY(0)' }], clockStart + .2, .3);
    for (const id of ['weather', 'reconnect-badge']) motion(doc.getElementById(id), [{ opacity: 0 }, { opacity: 1 }], clockStart + .35, .4);
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
        if (doc.defaultView.getComputedStyle(card).position === 'static') changeStyle(card, 'position', 'relative');
        const edge = doc.createElement('span');
        edge.setAttribute('aria-hidden', 'true'); edge.dataset.chimeHelper = '1';
        edge.style.cssText = `position:absolute;left:-3px;top:0;bottom:0;width:3px;pointer-events:none;background:${rgb(color)};box-shadow:0 0 22px 3px ${rgb(color, .55)},0 0 4px 0 ${rgb(color)}`;
        card.append(edge); helpers.push(edge);
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
    sweep(doc.getElementById('operation-slides'), A.start + 4 * A.columnGap, .48);
  }
  function destroyAssembly() {
    animations.forEach(animation => animation.cancel()); animations = [];
    helpers.forEach(element => element.remove()); helpers = [];
    for (const [element, name, value] of restores.reverse()) element.style[name] = value;
    restores = [];
  }

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
  function ring(x, y, radius, color, alpha, width) {
    if (alpha <= 0) return;
    ctx.strokeStyle = rgb(color, alpha); ctx.lineWidth = width;
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
  }

  /* 秒読み：香里園の両側の明るい区間が、残りの秒数×stations 駅ぶん。1秒ごとに縮む。reach の単位は駅。 */
  function countdownAt(t) {
    const C = SPEC.countdown, start = ON - C.from;
    if (t < start || t >= ON + C.stepDur) return null;
    if (t >= ON) return { reach: lerp(C.stations, 0, outCubic(prog(t, ON, C.stepDur * .7))), step: 0, since: t - ON, alpha: 1 - prog(t, ON, C.stepDur) };
    const step = Math.ceil(ON - t - 1e-9), since = t - (ON - step);
    const from = step === C.from ? step : step + 1;
    return { reach: lerp(from, step, outCubic(prog(since, 0, C.stepDur))) * C.stations, step, since, alpha: smooth(prog(t, start, .4)) };
  }

  function draw(t, introT) {
    const L = SPEC.line, C = SPEC.intro.camera, A = SPEC.arrival, Wv = SPEC.wave;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const o = origin();
    const hype = hypeAt(t), beat = beatAt(t), push = pushAt(t);
    const collected = collectors.filter(train => train.passAt <= t);
    ctx.setTransform(push, 0, 0, push, o.x + homeX * (1 - push), o.y + SPEC.line.y * (1 - push));
    const k = cameraEase(prog(introT, C.start, C.dur));
    const zoom = Math.pow(C.zoom, k);
    const anchor = lerp(homeX, geo.ruleLeft, k);
    const mapX = x => anchor + (x - homeX) * zoom;
    const y = lerp(L.y, geo.ruleY, k);

    if (hype > .005) {
      const colors = collected.length ? collected.map(train => train.color) : [chimeColor];
      const tint = colors.reduce((a, c) => a.map((v, i) => v + c[i] / colors.length), [0, 0, 0]);
      const radius = 220 + 280 * hype, g = ctx.createRadialGradient(homeX, L.y, 0, homeX, L.y, radius);
      g.addColorStop(0, rgb(tint, .4 * hype * (.85 + .15 * beat))); g.addColorStop(1, rgb(tint, 0));
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.fillRect(homeX - radius, L.y - radius, radius * 2, radius * 2);
      ctx.globalCompositeOperation = 'source-over';
    }
    const left = lerp(-o.x, geo.ruleLeft, k), right = lerp(canvas.width - o.x, geo.ruleRight, k);
    ctx.fillStyle = rgb(mix(mix(L.rest, [150, 150, 148], .7 * hype * beat), L.final, k));
    ctx.fillRect(left, y - .5, right - left, 1);

    const countdown = countdownAt(t);
    if (countdown && countdown.reach > 0) {
      const span = countdown.reach * (stationX(1) - stationX(0)) * zoom;
      const hx = mapX(homeX), g = ctx.createLinearGradient(hx - span, 0, hx + span, 0);
      const c = mix(WHITE, chimeColor, .15), a = countdown.alpha * .85;
      if (HYPE) {
        [[0, 1], [.25, 2], [.5, 0], [.75, 2], [1, 1]].forEach(([at, index]) => g.addColorStop(at, rgb(mix(c, PALETTE[index], .9 * hype), a * (at === .5 ? 1 : .6))));
      } else {
        g.addColorStop(0, rgb(c, a * .35)); g.addColorStop(.5, rgb(c, a)); g.addColorStop(1, rgb(c, a * .35));
      }
      const thick = 2 + 3 * hype * (.6 + .4 * beat);
      ctx.fillStyle = g; ctx.fillRect(hx - span, y - thick / 2, span * 2, thick);
    }

    const lights = [];
    for (const train of SPEC.trains) {
      const state = trainAt(train, t);
      if (state) lights.push({ color: train.color, train, ...state, sx: mapX(state.x) });
    }
    const wave = prog(t, ON, Wv.dur);
    const waves = [];
    if (wave > 0 && wave < 1) {
      for (const dir of [-1, 1]) {
        const x = homeX + dir * Wv.reach * outCubic(wave);
        if (x > -Wv.tail && x < SPEC.W + Wv.tail) waves.push({ color: [255, 255, 255], dir, x, sx: mapX(x), alpha: 1 - smooth(wave) });
      }
    }

    if (HYPE && t >= ON) {
      for (let i = 0; i < HYPED.burst; i++) {
        const p = prog(t, ON + i * .015, HYPED.burstDur);
        if (p <= 0 || p >= 1) continue;
        const dir = i % 2 ? -1 : 1, reach = 700 + (i * 137) % 900, x = homeX + dir * reach * outCubic(p);
        waves.push({ color: PALETTE[(i >> 1) % PALETTE.length], dir, x, sx: mapX(x), alpha: 1 - smooth(p), lane: (((i >> 1) % 3) - 1) * 5, burst: true, p });
      }
    }
    const fadeTicks = 1 - smooth(prog(k, .25, .6));
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.font = `400 ${S.labelSize}px "Zen Kaku Gothic New", "Noto Sans JP", sans-serif`;
    for (let i = 0; i < count; i++) {
      if (fadeTicks <= 0 || i === homeIndex) continue;
      const x = mapX(stationX(i));
      if (x < -40 || x > SPEC.W + 40) continue;
      let glow = 0, glowColor = WHITE;
      for (const light of [...lights, ...waves]) {
        const g = Math.exp(-Math.pow((light.sx - x) / (S.flashRange * zoom), 2)) * (light.alpha ?? 1);
        if (g > glow) { glow = g; glowColor = light.color; }
      }
      let inside = 0;
      if (countdown) {
        const distance = Math.abs(i - homeIndex);
        inside = clamp01(countdown.reach - distance + 1) * countdown.alpha;
        const vacated = countdown.step * SPEC.countdown.stations;
        if (distance > vacated && distance <= vacated + SPEC.countdown.stations) {
          const edge = Math.exp(-countdown.since / SPEC.countdown.flashDur * 3) * countdown.alpha;
          if (edge > glow) { glow = edge; glowColor = HYPE ? mix(WHITE, PALETTE[countdown.step % PALETTE.length], .8) : WHITE; }
        }
      }
      const name = S.names[i], major = majors.has(name);
      const half = (major ? S.tickMajor : S.tick) + S.flash * glow + 2 * inside + 5 * hopAt(t) * hype * inside;
      const base = mix(major ? [200, 200, 198] : [124, 124, 130], WHITE, inside * .8);
      ctx.fillStyle = rgb(mix(base, glowColor, glow), fadeTicks);
      ctx.fillRect(Math.round(x) - .5, y - half, 1 + glow, half * 2);
      if (labelled.has(name)) {
        const a = 1 - prog(k, 0, .35);
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
    for (const w of waves) drawStreak(w.sx, y + (w.lane || 0), (w.burst ? 260 * (1 - w.p) + 30 : Wv.tail * (1 - wave * .6)) * zoom, w.dir, w.color, w.alpha * fadeLights);

    const fadeHome = 1 - smooth(prog(k, .15, .55));
    if (fadeHome > 0) {
      const hx = mapX(homeX);
      if (countdown && countdown.step > 0) {
        const p = prog(countdown.since, 0, .85), strength = lerp(.18, .55, (SPEC.countdown.from - countdown.step) / (SPEC.countdown.from - 1));
        const boost = 1 + hype, color = HYPE ? mix(WHITE, PALETTE[countdown.step % PALETTE.length], .7 * hype) : WHITE;
        if (p < 1) ring(hx, y, lerp(A.ring, lerp(16, 30, strength) * boost, outCubic(p)), color, Math.min(1, (1 - p) * strength * boost) * fadeHome * countdown.alpha, boost);
      }
      for (const train of collected) {
        const p = prog(t, train.passAt, .5);
        if (p < 1) ring(hx, y, lerp(A.ring, 34, outCubic(p)), train.color, (1 - p) * .8 * fadeHome, 1.5);
      }
      if (HYPE && collected.length) {
        /* 通った光の色を輪に1つずつためる。00秒で弾けて消える。 */
        const keep = (1 - prog(t, ON, .25)) * fadeHome, n = collectors.length, gap = .12;
        collected.forEach((train, index) => {
          const grow = outCubic(prog(t, train.passAt, .25)), start = -Math.PI / 2 + index * Math.PI * 2 / n;
          if (keep <= 0) return;
          ctx.strokeStyle = rgb(train.color, keep * grow); ctx.lineWidth = 4;
          ctx.beginPath(); ctx.arc(hx, y, 22 + 4 * beat * hype, start + gap / 2, start + (Math.PI * 2 / n) * grow - gap / 2); ctx.stroke();
        });
      }
      const arrived = prog(t, ON, A.pulseDur), inner = prog(t, ON, A.innerDur);
      if (arrived > 0 && arrived < 1) ring(hx, y, lerp(A.ring, A.pulseRadius, outCubic(arrived)), chimeColor, (1 - arrived) * .9 * fadeHome, lerp(2.5, .5, arrived));
      if (inner > 0 && inner < 1) ring(hx, y, lerp(A.ring, A.innerRadius, outCubic(inner)), WHITE, (1 - inner) * fadeHome, lerp(2, .5, inner));
      if (HYPE) [[1, .1, 150], [2, .2, 170]].forEach(([index, delay, radius]) => {
        const p = prog(t, ON + delay, A.pulseDur);
        if (p > 0 && p < 1) ring(hx, y, lerp(A.ring, radius, outCubic(p)), PALETTE[index], (1 - p) * .8 * fadeHome, lerp(2, .5, p));
      });
      if (t >= ON) {
        const strength = Math.exp(-4 * (t - ON)) * fadeHome, radius = A.glow * (1 + .6 * (t - ON));
        if (strength > .002) {
          const g = ctx.createRadialGradient(hx, y, 0, hx, y, radius);
          g.addColorStop(0, `rgba(255,255,255,${strength})`); g.addColorStop(.2, rgb(chimeColor, strength * .5)); g.addColorStop(1, rgb(chimeColor, 0));
          ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.fillRect(hx - radius, y - radius, radius * 2, radius * 2);
          ctx.globalCompositeOperation = 'source-over';
        }
      }
      const lit = smooth(prog(t, ON - .1, .3));
      ctx.fillStyle = rgb(mix(SPEC.bg, chimeColor, lit * .55), fadeHome);
      ctx.strokeStyle = rgb(mix(WHITE, [255, 255, 255], lit), fadeHome); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(hx, y, A.ring, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return k;
  }


  function phaseAt(t) {
    if (t >= ON - SPEC.countdown.from && t < ON) return `秒読み（あと${Math.ceil(ON - t - 1e-9)}秒）`;
    let name = BEATS[0][0];
    for (const [label, at] of BEATS) if (t >= at) name = label;
    return name;
  }
  function renderTitle(t) {
    const T = SPEC.title, second = secondAt(t);
    const out = prog(t, T.outStart, T.outDur), outA = 1 - smooth(out);
    const push = pushAt(t), hype = hypeAt(t);
    titleLayer.style.transform = `${titleBase()} translate(${homeX * (1 - push)}px,${SPEC.line.y * (1 - push)}px) scale(${push}) translateY(${-T.outLift * outCubic(out)}px)`;
    const urgency = smooth(prog(t, ON - SPEC.countdown.from, SPEC.countdown.from));
    slots.seconds.style.color = rgb(mix([161, 161, 166], WHITE, Math.max(urgency, t >= ON ? 1 : 0)));
    slots.seconds.style.transformOrigin = '0 100%';
    slots.seconds.style.transform = HYPE ? `scale(${1 + HYPED.secondsGrow * hype})` : '';
    const beat = beatAt(t);
    slots.seconds.style.filter = HYPE && hype > .01 ? `drop-shadow(0 0 ${(14 + 12 * beat) * hype}px ${rgb(chimeColor, (.45 + .35 * beat) * hype)})` : '';
    for (const c of chars) {
      c.span.textContent = charAt(c.slot, c.index, second);
      c.span.classList.toggle('is-separator', c.span.textContent === ':');
      const p = outCubic(prog(t, c.at, T.charDur));
      const q = outCubic(prog(t, changedAt(c, t), T.flipDur));
      c.span.style.opacity = String(Math.min(1, p * 1.6) * Math.min(1, q * 1.8) * outA);
      c.span.style.transform = `translateY(${(1 - p) * T.rise + (1 - q) * T.flipRise}px)`;
      const glow = Math.exp(-Math.pow((t - c.wave) / .14, 2));
      c.span.style.textShadow = glow > .01 ? `0 0 ${28 * glow}px rgba(255,255,255,${.75 * glow}),0 0 ${70 * glow}px ${rgb(chimeColor, .45 * glow)}` : '';
    }
  }
  function render(t) {
    const introT = introAt(t);
    const k = draw(t, introT);
    renderTitle(t);

    /* 駅名は案内画面の実物（#station-name）。線路が見えている間は香里園の輪の下に縮めて置く。 */
    const n = geo.name, s0 = geo.nameScale;
    const lit = smooth(prog(t, ON - .1, .4));
    stationName.style.transformOrigin = '0 0';
    const push = pushAt(t);
    const nx = n.x + lerp(homeX - n.w * s0 / 2 - n.x, 0, k), ny = n.y + lerp(SPEC.line.y + S.labelOffset - (n.h * s0 - S.labelSize) / 2 - n.y, 0, k);
    stationName.style.transform = `translate(${homeX + push * (nx - homeX) - n.x}px,${SPEC.line.y + push * (ny - SPEC.line.y) - n.y}px) scale(${lerp(s0, 1, k) * push})`;
    stationName.style.opacity = String(lerp(S.homeLabelOpacity, 1, Math.max(lit, k)));

    for (const animation of animations) animation.currentTime = introT * 1000;
    return { k, introT, second: secondAt(t) };
  }

  const nameStyle = ['transform', 'opacity', 'transformOrigin'].map(name => [name, stationName.style[name]]);
  measureBoard(); buildTitle();
  return {
    SPEC, ON, DURATION, BEATS,
    measure() { measureBoard(); measureTitle(); },
    buildAssembly, destroyAssembly, render, phaseAt, stampAt, secondAt,
    destroy() {
      destroyAssembly();
      for (const [name, value] of nameStyle) stationName.style[name] = value;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };
}
