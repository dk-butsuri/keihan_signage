(() => {
  const root = document.getElementById('atlas-intro');
  const stage = root.querySelector('.intro-stage');
  const canvas = root.querySelector('.intro-map');
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
    W: 1920, H: 1080, DURATION: 10.4, POSTER: 5.0,
    bg: [11, 11, 12], ink: [241, 241, 238],
    exaggerate: 2.2,
    hud: { start: 0.15, scramble: 0.7, color: '#7C7C82', font: '"IBM Plex Mono", ui-monospace, monospace' },
    lock: { start: 0.05, slide: 0.5, snap: 0.36, size: [170, 26], lineOut: [0.85, 0.6], out: [1.7, 0.5] },
    scan: { start: 0.7, speed: 820, ring: 0.5, rise: 0.5, swell: 0.75, bump: 13, bumpDur: 0.26, settle: 1 },
    hot: [[0.06, 0.9, 1.5], [0.16, 0.42, 1.2], [0.38, 0.16, 1]],
    dots: { ahead: 0.16, behind: 0.32, alpha: 0.85 },
    rings: { radii: [250, 500, 750, 1000], alpha: 0.36, dash: [3, 6], bearing: 2.75 },
    terrain: { alpha: 0.085, every: 2, gain: 0.3 },
    contour: { every: 5, step: 15, alpha: 0.17, gain: 0.55 },
    roads: { alpha: [0.42, 0.2, 0.09], lag: [-0.2, 0.08, 0.08], gain: [1, 0.7, 0.4] },
    buildings: { alpha: 0.26, campusAlpha: 0.95, lead: 0.16, reach: { school: 620, station: 380 }, edge: 0.35, gain: 0.8 },
    campus: { alpha: 0.85, dash: [10, 7] },
    rail: { drawStart: 3.45, drawDur: 0.85, bright: [214, 214, 210], rest: [130, 130, 128], final: [38, 38, 42] },
    colors: { '特急': '#FF3B30', '快速急行': '#C445D6', '準急': '#2F7BFF', '普通': '#B8B8BC' },
    trail: { perSpeed: 0.34, max: 420 },
    trains: [
      { kind: '特急', dir: 1, t0: 3.9, speed: 1400 },
      { kind: '普通', dir: -1, t0: 4.05, speed: 520 },
      { kind: '準急', dir: 1, speed: 700, stopsAt: 5.6, brakeDur: 1.2 }
    ],
    callout: { school: 2.0, station: 3.0, rise: 150, run: 34, nameSize: 24, dataSize: 13 },
    measure: { start: 4.15, dur: 0.7 },
    arrival: { pulseDur: 0.75, pulseRadius: 40, ring: 5.5 },
    group: { start: 2.25, dur: 0.8, spacingFrom: 0.6, spacingTo: 0.24 },
    title: { lines: ['京阪電車・京阪バス', '発車時刻リアルタイムサイネージ設置プロジェクト'], start: 2.45, stagger: 0.024, charDur: 0.55, rise: 22, outStart: 5.5, outDur: 0.45, outLift: 8 },
    camera: {
      focal: 1500,
      open: { yaw: -1.3, pitch: 80, dist: 1150, anchor: [960, 560], focus: 0 },
      orbit: { yaw: -0.42, pitch: 40, dist: 1900, anchor: [1200, 560], focus: 0.56 },
      sweep: 2.5, drift: 0.2,
      start: 5.85, dur: 1.6, ease: [0.5, 0, 0.25, 1], pxPerMeter: 1.55
    },
    clock: { start: 6.85, digitStagger: 0.027 },
    assembly: { start: 7.25, columnGap: 0.38, rowStart: 0.18, rowGap: 0.05, cardDur: 0.48, cardEase: 'cubic-bezier(.65,0,.2,1)' }
  };
  const BEATS = [['座標', 0], ['地形', 0.7], ['街', 1.4], ['表題', 2.25], ['路線', 3.45], ['到着', 4.9], ['寄る', 5.85], ['組み上げ', 7.2]];
  const LAST = Math.round(SPEC.DURATION * FPS) - 1, DURATION = (LAST + 1) / FPS;
  const POSTER_FRAME = Math.round(SPEC.POSTER * FPS), CAMERA_FRAME = Math.round(BEATS[6][1] * FPS);

  let frame = POSTER_FRAME, playing = false, ready = false, firstPlay = true, raf = 0, epoch = 0;
  let boardFrame = null, doc = null, geo = null, animations = [], stationName = null, header = null, world = null;
  const chars = [];

  const clamp01 = x => Math.max(0, Math.min(1, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const prog = (t, start, dur) => clamp01((t - start) / dur);
  const outCubic = x => 1 - Math.pow(1 - x, 3);
  const outBack = (x, s = 1.70158) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2);
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
  const angleLerp = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

  /* 地図は描く前に一度だけ平らな配列にしておく。毎フレーム投影するのは座標だけ。 */
  function prepare(map) {
    const X = SPEC.exaggerate, T = map.terrain;
    const heightAt = (x, y) => {
      const fx = clamp01((x - T.x0) / (T.step * (T.nx - 1))) * (T.nx - 1), fy = clamp01((y - T.y0) / (T.step * (T.ny - 1))) * (T.ny - 1);
      const i = Math.min(T.nx - 2, Math.floor(fx)), j = Math.min(T.ny - 2, Math.floor(fy)), u = fx - i, v = fy - j;
      const h = (a, b) => T.h[b * T.nx + a];
      return X * lerp(lerp(h(i, j), h(i + 1, j), u), lerp(h(i, j + 1), h(i + 1, j + 1), u), v);
    };
    const school = map.school, station = map.station;
    const distance = (x, y) => Math.hypot(x - school.x, y - school.y);
    const layers = {};
    let far = 0;
    const polyline = (flat, lift, layer, extra = {}) => {
      const n = flat.length / 2, xyz = new Float32Array(n * 3), at = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = flat[i * 2], y = flat[i * 2 + 1];
        xyz[i * 3] = x; xyz[i * 3 + 1] = y; xyz[i * 3 + 2] = heightAt(x, y) + lift;
        at[i] = distance(x, y); far = Math.max(far, at[i]);
      }
      (layers[layer] || (layers[layer] = [])).push({ xyz, at, ...extra });
    };
    const every = SPEC.terrain.every;
    for (let j = 0; j < T.ny; j += every) {
      const row = []; for (let i = 0; i < T.nx; i++) row.push(T.x0 + i * T.step, T.y0 + j * T.step);
      polyline(row, 0, 'terrain');
    }
    for (let i = 0; i < T.nx; i += every) {
      const column = []; for (let j = 0; j < T.ny; j++) column.push(T.x0 + i * T.step, T.y0 + j * T.step);
      polyline(column, 0, 'terrain');
    }
    /* 等高線。標高の格子を細かく取り直して、升目ごとに線分を拾う。 */
    {
      const C = SPEC.contour, cs = C.step, cnx = Math.floor((T.nx - 1) * T.step / cs), cny = Math.floor((T.ny - 1) * T.step / cs);
      const g = new Float32Array((cnx + 1) * (cny + 1));
      let low = Infinity, high = -Infinity;
      for (let j = 0; j <= cny; j++) for (let i = 0; i <= cnx; i++) {
        const v = heightAt(T.x0 + i * cs, T.y0 + j * cs); g[j * (cnx + 1) + i] = v; low = Math.min(low, v); high = Math.max(high, v);
      }
      const gap = C.every * X;
      for (let level = Math.ceil(low / gap) * gap; level < high; level += gap) {
        for (let j = 0; j < cny; j++) for (let i = 0; i < cnx; i++) {
          const a = g[j * (cnx + 1) + i], b = g[j * (cnx + 1) + i + 1], c = g[(j + 1) * (cnx + 1) + i + 1], d = g[(j + 1) * (cnx + 1) + i];
          const code = (a > level ? 1 : 0) | (b > level ? 2 : 0) | (c > level ? 4 : 0) | (d > level ? 8 : 0);
          if (code === 0 || code === 15) continue;
          const x = T.x0 + i * cs, y = T.y0 + j * cs, u = (p, q) => (level - p) / (q - p);
          const top = () => [x + cs * u(a, b), y], right = () => [x + cs, y + cs * u(b, c)];
          const bottom = () => [x + cs * u(d, c), y + cs], left = () => [x, y + cs * u(a, d)];
          const seg = (p, q) => polyline([...p(), ...q()], 0.3, 'contour');
          switch (code) {
            case 1: case 14: seg(left, top); break;
            case 2: case 13: seg(top, right); break;
            case 3: case 12: seg(left, right); break;
            case 4: case 11: seg(right, bottom); break;
            case 6: case 9: seg(top, bottom); break;
            case 7: case 8: seg(left, bottom); break;
            case 5: seg(left, top); seg(right, bottom); break;
            case 10: seg(top, right); seg(left, bottom); break;
          }
        }
      }
    }
    const nodes = { xyz: new Float32Array(T.nx * T.ny * 3), at: new Float32Array(T.nx * T.ny) };
    for (let j = 0, k = 0; j < T.ny; j++) for (let i = 0; i < T.nx; i++, k++) {
      const x = T.x0 + i * T.step, y = T.y0 + j * T.step;
      nodes.xyz[k * 3] = x; nodes.xyz[k * 3 + 1] = y; nodes.xyz[k * 3 + 2] = X * T.h[k]; nodes.at[k] = distance(x, y);
    }
    const rings = SPEC.rings.radii.map(r => {
      const n = 120, xyz = new Float32Array((n + 1) * 3);
      for (let i = 0; i <= n; i++) {
        const th = i / n * Math.PI * 2, x = school.x + Math.cos(th) * r, y = school.y + Math.sin(th) * r;
        xyz[i * 3] = x; xyz[i * 3 + 1] = y; xyz[i * 3 + 2] = heightAt(x, y) + 1;
      }
      const lx = school.x + Math.cos(SPEC.rings.bearing) * r, ly = school.y + Math.sin(SPEC.rings.bearing) * r;
      return { r, xyz, label: [lx, ly, heightAt(lx, ly) + 1] };
    });
    map.water.forEach(flat => polyline(flat, 0.5, 'water'));
    map.roads.forEach(road => polyline(road.p, 0.6, 'road', { cls: road.c }));
    map.grounds.forEach(flat => polyline(flat, 0.8, 'ground'));
    map.rail.others.forEach(flat => polyline(flat, 1.5, 'track'));
    polyline([...map.campus, map.campus[0], map.campus[1]], 1, 'campus');

    const buildings = map.buildings.map(b => {
      const n = b.p.length / 2, xy = new Float32Array(b.p);
      let cx = 0, cy = 0; for (let i = 0; i < n; i++) { cx += xy[i * 2]; cy += xy[i * 2 + 1]; }
      cx /= n; cy /= n;
      /* 建物があるのは学校と駅のまわりの円の中だけなので、円の縁に向かって薄くして境目を見せない。 */
      const R = SPEC.buildings.reach, inner = Math.max(1 - distance(cx, cy) / R.school, 1 - Math.hypot(cx - station.x, cy - station.y) / R.station);
      const dim = b.c ? 0 : Math.round((1 - smooth(clamp01(inner / SPEC.buildings.edge))) * 4);
      return { xy, n, z: b.z * X, h: b.h, campus: !!b.c, at: distance(cx, cy), dim };
    });
    buildings.sort((a, b) => a.at - b.at);

    const m = map.rail.main, n = m.length / 2;
    const rail = { xyz: new Float32Array(n * 3), s: new Float32Array(n), n };
    for (let i = 0; i < n; i++) {
      rail.xyz[i * 3] = m[i * 2]; rail.xyz[i * 3 + 1] = m[i * 2 + 1]; rail.xyz[i * 3 + 2] = heightAt(m[i * 2], m[i * 2 + 1]) + 2;
      if (i) rail.s[i] = rail.s[i - 1] + Math.hypot(m[i * 2] - m[i * 2 - 2], m[i * 2 + 1] - m[i * 2 - 1]);
    }
    let home = 0, best = Infinity;
    for (let i = 0; i < n - 1; i++) {
      const ax = m[i * 2], ay = m[i * 2 + 1], dx = m[i * 2 + 2] - ax, dy = m[i * 2 + 3] - ay;
      const u = clamp01(((station.x - ax) * dx + (station.y - ay) * dy) / (dx * dx + dy * dy));
      const d = Math.hypot(ax + dx * u - station.x, ay + dy * u - station.y);
      if (d < best) { best = d; home = rail.s[i] + u * Math.hypot(dx, dy); }
    }
    rail.home = home; rail.length = rail.s[n - 1];
    const back = railPoint(rail, home - 120), ahead = railPoint(rail, home + 120);
    rail.heading = Math.atan2(ahead[1] - back[1], ahead[0] - back[0]);
    const homePoint = railPoint(rail, home);
    return {
      map, layers, buildings, rail, heightAt, nodes, rings, far, floor: X * Math.min(...T.h),
      school: { ...school, z: heightAt(school.x, school.y) },
      station: { ...station, x: homePoint[0], y: homePoint[1], z: homePoint[2] },
      km: Math.hypot(school.x - station.x, school.y - station.y) / 1000
    };
  }
  function railPoint(rail, s) {
    s = Math.max(0, Math.min(rail.s[rail.n - 1], s));
    let i = 1; while (i < rail.n - 1 && rail.s[i] < s) i++;
    const u = (s - rail.s[i - 1]) / (rail.s[i] - rail.s[i - 1] || 1), p = rail.xyz;
    return [lerp(p[i * 3 - 3], p[i * 3], u), lerp(p[i * 3 - 2], p[i * 3 + 1], u), lerp(p[i * 3 - 1], p[i * 3 + 2], u)];
  }

  SPEC.trains.forEach(train => { train.color = hex(SPEC.colors[train.kind]); });
  function placeTrains() {
    const R = world.rail;
    for (const train of SPEC.trains) {
      if (train.stopsAt == null) continue;
      train.brakeFrom = train.stopsAt - train.brakeDur;
      train.brakeS = R.home - train.speed * train.brakeDur / 2;
      train.t0 = train.brakeFrom - train.brakeS / train.speed;
    }
  }
  function trainAt(train, t) {
    if (t < train.t0) return null;
    const R = world.rail;
    if (train.stopsAt != null) {
      if (t <= train.brakeFrom) return { s: train.brakeS - train.speed * (train.brakeFrom - t), v: train.speed };
      const u = Math.min(train.brakeDur, t - train.brakeFrom), a = train.speed / train.brakeDur;
      return { s: train.brakeS + train.speed * u - a * u * u / 2, v: Math.max(0, train.speed - a * u), stopped: t >= train.stopsAt };
    }
    const run = train.speed * (t - train.t0);
    const s = train.dir > 0 ? run : R.length - run;
    if (s < -SPEC.trail.max || s > R.length + SPEC.trail.max) return null;
    return { s, v: train.speed };
  }

  /* 波: 学校から外へ広がる。波が通ってからの秒数（age）で、線の熱・地形の盛り上がり・建物の伸びを決める。 */
  const wave = { reach: 0, speed: 1, active: true };
  function setWave(t) {
    const S = SPEC.scan;
    wave.speed = S.speed; wave.reach = (t - S.start) * S.speed;
    wave.active = wave.reach < world.far + S.speed * S.settle;
  }
  function liftZ(z, dist, steady = false) {
    if (!wave.active) return z;
    const S = SPEC.scan, age = (wave.reach - dist) / wave.speed;
    if (age <= 0) return world.floor;
    let v = age >= S.swell ? z : world.floor + (z - world.floor) * outBack(age / S.swell, 1.2);
    if (!steady && age < S.bumpDur) v += S.bump * Math.sin(Math.PI * age / S.bumpDur);
    return v;
  }
  const HOT = SPEC.hot, HOT_MAX = HOT[HOT.length - 1][0];
  const hotLevel = age => { for (let i = 0; i < HOT.length; i++) if (age < HOT[i][0]) return i; return -1; };
  function strokeHot(hot, gain) {
    if (!hot || gain <= 0) return;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 5; ctx.strokeStyle = rgb(SPEC.ink, .1 * gain); ctx.stroke(hot[0]);
    HOT.forEach(([, alpha, width], i) => { ctx.lineWidth = width; ctx.strokeStyle = rgb(SPEC.ink, alpha * gain); ctx.stroke(hot[i]); });
    ctx.globalCompositeOperation = 'source-over';
  }

  /* カメラ: 地面の点 target を画面の anchor に置き、yaw で向きを、pitch で見下ろす角度（90°で真上）を決める。 */
  const cam = { cy: 1, sy: 0, cp: 1, sp: 0, dist: 1, f: 1, ax: 0, ay: 0, tx: 0, ty: 0, tz: 0 };
  const near = 40;
  function setCamera(t) {
    const C = SPEC.camera, O = C.open, B = C.orbit, R = world.rail;
    /* はじめは学校の真上近く。波を追って引きながら寝かせ、あとはゆっくり流す。 */
    const intro = C.drift * prog(t, 0, C.start) + (1 - C.drift) * outCubic(prog(t, SPEC.scan.start, C.sweep));
    const k = cameraEase(prog(t, C.start, C.dur));
    const finalYaw = R.heading;
    const yaw = angleLerp(finalYaw + lerp(O.yaw, B.yaw, intro), finalYaw, k);
    const pitch = lerp(lerp(O.pitch, B.pitch, intro), 90, k) * Math.PI / 180;
    const finalDist = C.focal / C.pxPerMeter;
    const dist = Math.exp(lerp(lerp(Math.log(O.dist), Math.log(B.dist), intro), Math.log(finalDist), k));
    /* 構図（どこを画面のどこに置くか）だけは全体を通してゆっくり移す。 */
    const frame = smooth(prog(t, 0, C.start));
    const A = world.school, S = world.station, focusMix = lerp(O.focus, B.focus, frame);
    const fx = lerp(A.x, S.x, focusMix), fy = lerp(A.y, S.y, focusMix);
    const fz = world.heightAt(fx, fy);
    cam.tx = lerp(fx, S.x, k); cam.ty = lerp(fy, S.y, k);
    /* 波の盛り上がりは拾わない。拾うと、波が通る瞬間に画面全体が上下に揺れる。 */
    cam.tz = lerp(liftZ(fz, Math.hypot(fx - A.x, fy - A.y), true), S.z, k);
    cam.cy = Math.cos(yaw); cam.sy = Math.sin(yaw); cam.cp = Math.cos(pitch); cam.sp = Math.sin(pitch);
    cam.dist = dist; cam.f = C.focal;
    cam.ax = lerp(lerp(O.anchor[0], B.anchor[0], frame), geo.ruleLeft, k);
    cam.ay = lerp(lerp(O.anchor[1], B.anchor[1], frame), geo.ruleY, k);
    cam.yaw = yaw; cam.pitch = pitch;
    return k;
  }
  const out = [0, 0, 0];
  function project(x, y, z) {
    const dx = x - cam.tx, dy = y - cam.ty, dz = z - cam.tz;
    const rx = cam.cy * dx + cam.sy * dy, ry = -cam.sy * dx + cam.cy * dy;
    const depth = ry * cam.cp - dz * cam.sp + cam.dist;
    const up = ry * cam.sp + dz * cam.cp;
    out[0] = cam.ax + cam.f * rx / depth; out[1] = cam.ay - cam.f * up / depth; out[2] = depth;
    return out;
  }
  const BUCKETS = 6;
  const fogBucket = depth => Math.max(0, Math.min(BUCKETS - 1, Math.floor((depth / cam.dist - 0.55) * 3.2)));
  const fogAlpha = bucket => 1 - bucket / BUCKETS * 0.82;
  const offscreen = (x, y) => x < -300 || x > SPEC.W + 300 || y < -300 || y > SPEC.H + 300;

  function strokeBuckets(paths, color, alpha, width = 1) {
    ctx.lineWidth = width;
    for (let b = 0; b < BUCKETS; b++) {
      if (!paths[b]) continue;
      ctx.strokeStyle = rgb(color, alpha * fogAlpha(b));
      ctx.stroke(paths[b]);
    }
  }
  function drawLines(layer, filter, color, alpha, width = 1, lag = 0, gain = 1) {
    if (alpha <= 0.002 || !world.layers[layer]) return;
    const active = wave.active, paths = [], hot = active && gain > 0 ? HOT.map(() => new Path2D()) : null;
    const reach = wave.reach - lag * wave.speed, inv = 1 / wave.speed;
    let pen = false, path = null, lx = 0, ly = 0;
    const put = (x, y, z, dist, age) => {
      const p = project(x, y, active ? liftZ(z, dist) : z);
      if (p[2] < near || offscreen(p[0], p[1])) { pen = false; return; }
      if (!pen) {
        path = paths[fogBucket(p[2])] || (paths[fogBucket(p[2])] = new Path2D());
        path.moveTo(p[0], p[1]); pen = true;
      } else {
        path.lineTo(p[0], p[1]);
        if (hot && age < HOT_MAX) { const h = hot[hotLevel(age)]; h.moveTo(lx, ly); h.lineTo(p[0], p[1]); }
      }
      lx = p[0]; ly = p[1];
    };
    for (const line of world.layers[layer]) {
      if (filter && !filter(line)) continue;
      const xyz = line.xyz, d = line.at, n = d.length;
      let before = 0; pen = false;
      for (let i = 0; i < n; i++) {
        const age = active ? (reach - d[i]) * inv : 9;
        /* 波の縁をまたぐ線分は、縁のところで切る。 */
        if (i && (age < 0) !== (before < 0)) {
          const u = before / (before - age), j = i * 3;
          const x = lerp(xyz[j - 3], xyz[j], u), y = lerp(xyz[j - 2], xyz[j + 1], u), z = lerp(xyz[j - 1], xyz[j + 2], u);
          put(x, y, z, lerp(d[i - 1], d[i], u), 0);
        }
        if (age < 0) pen = false; else put(xyz[i * 3], xyz[i * 3 + 1], xyz[i * 3 + 2], d[i], age);
        before = age;
      }
    }
    strokeBuckets(paths, color, alpha, width);
    strokeHot(hot, gain);
  }
  function drawBuildings(fade) {
    const B = SPEC.buildings, S = SPEC.scan, active = wave.active;
    const reach = wave.reach - B.lead * wave.speed;
    if (reach <= 0 || fade <= 0) return;
    const paths = [], campus = new Path2D(), roofs = new Path2D(), hot = active ? HOT.map(() => new Path2D()) : null;
    const top = new Float32Array(64), bottom = new Float32Array(64);
    for (const b of world.buildings) {
      const dist = b.at, age = active ? (reach - dist) / wave.speed : 9;
      if (age < 0) break;
      const rise = age >= S.rise ? 1 : outBack(age / S.rise);
      const z0 = active ? liftZ(b.z, dist) : b.z, zTop = z0 + b.h * rise, n = Math.min(b.n, 32);
      let visible = true, depth = 0;
      for (let i = 0; i < n; i++) {
        const x = b.xy[i * 2], y = b.xy[i * 2 + 1];
        let p = project(x, y, zTop); if (p[2] < near || offscreen(p[0], p[1])) { visible = false; break; }
        top[i * 2] = p[0]; top[i * 2 + 1] = p[1]; depth = p[2];
        p = project(x, y, z0); bottom[i * 2] = p[0]; bottom[i * 2 + 1] = p[1];
      }
      if (!visible) continue;
      const bucket = Math.min(BUCKETS - 1, fogBucket(depth) + b.dim);
      const path = b.campus ? campus : (paths[bucket] || (paths[bucket] = new Path2D()));
      const outline = target => {
        target.moveTo(top[0], top[1]);
        for (let i = 1; i < n; i++) target.lineTo(top[i * 2], top[i * 2 + 1]);
        target.closePath();
      };
      outline(path);
      if (b.campus) outline(roofs);
      if (hot && age < HOT_MAX && b.dim < 3) outline(hot[hotLevel(age)]);
      for (let i = 0; i < n; i++) { path.moveTo(top[i * 2], top[i * 2 + 1]); path.lineTo(bottom[i * 2], bottom[i * 2 + 1]); }
      if (b.campus) {
        path.moveTo(bottom[0], bottom[1]);
        for (let i = 1; i < n; i++) path.lineTo(bottom[i * 2], bottom[i * 2 + 1]);
        path.closePath();
      }
    }
    strokeBuckets(paths, SPEC.ink, B.alpha * fade);
    strokeHot(hot, B.gain * fade);
    /* 校舎だけは屋根を薄く塗って、後ろの線から浮かせる。 */
    ctx.fillStyle = rgb(SPEC.bg, .55 * fade); ctx.fill(roofs);
    ctx.fillStyle = rgb(SPEC.ink, .07 * fade); ctx.fill(roofs);
    ctx.lineWidth = 1.2; ctx.strokeStyle = rgb(SPEC.ink, B.campusAlpha * fade); ctx.stroke(campus);
  }
  function drawScanRing(fade) {
    const S = SPEC.scan, r = wave.reach;
    if (r <= 0 || fade <= 0) return;
    const a = S.ring * (1 - smooth(prog(r, 900, 900))) * fade;
    if (a <= 0) return;
    const c = world.school, path = new Path2D();
    let pen = false;
    for (let i = 0; i <= 160; i++) {
      const th = i / 160 * Math.PI * 2, x = c.x + Math.cos(th) * r, y = c.y + Math.sin(th) * r;
      const p = project(x, y, world.floor + 1);
      if (p[2] < near) { pen = false; continue; }
      if (pen) path.lineTo(p[0], p[1]); else { path.moveTo(p[0], p[1]); pen = true; }
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 9; ctx.strokeStyle = rgb(SPEC.ink, a * .1); ctx.stroke(path);
    ctx.lineWidth = 1.4; ctx.strokeStyle = rgb(SPEC.ink, a); ctx.stroke(path);
    ctx.globalCompositeOperation = 'source-over';
  }
  /* 測点: 波の少し先に標高の格子点が灯り、線がそれを追いかける。 */
  function drawDots(fade) {
    const D = SPEC.dots;
    if (!wave.active || fade <= 0) return;
    const N = world.nodes, levels = [new Path2D(), new Path2D(), new Path2D()];
    const lo = wave.reach - D.behind * wave.speed, hi = wave.reach + D.ahead * wave.speed;
    if (lo > world.far) return;
    for (let i = 0, n = N.at.length; i < n; i++) {
      const d = N.at[i];
      if (d < lo || d > hi) continue;
      const age = (wave.reach - d) / wave.speed;
      const a = age < 0 ? 1 + age / D.ahead : 1 - age / D.behind;
      const p = project(N.xyz[i * 3], N.xyz[i * 3 + 1], liftZ(N.xyz[i * 3 + 2], d));
      if (p[2] < near || offscreen(p[0], p[1])) continue;
      const size = a > .66 ? 2.4 : 1.6;
      levels[a > .66 ? 2 : a > .33 ? 1 : 0].rect(p[0] - size / 2, p[1] - size / 2, size, size);
    }
    ctx.globalCompositeOperation = 'lighter';
    [.22, .5, 1].forEach((a, i) => { ctx.fillStyle = rgb(SPEC.ink, a * D.alpha * fade); ctx.fill(levels[i]); });
    ctx.globalCompositeOperation = 'source-over';
  }
  /* 距離の輪: 波が通ったあとに、学校からの距離を残す。 */
  function drawRanges(fade) {
    const R = SPEC.rings;
    if (fade <= 0) return;
    ctx.font = `300 11px ${SPEC.hud.font}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const ring of world.rings) {
      const age = (wave.reach - ring.r) / wave.speed;
      if (age <= 0) continue;
      const a = R.alpha * fade * (.45 + .55 * (1 - smooth(clamp01(age / 1.2)))), path = new Path2D(), n = ring.xyz.length / 3;
      let pen = false;
      for (let i = 0; i < n; i++) {
        const p = project(ring.xyz[i * 3], ring.xyz[i * 3 + 1], liftZ(ring.xyz[i * 3 + 2], ring.r));
        if (p[2] < near || offscreen(p[0], p[1])) { pen = false; continue; }
        if (pen) path.lineTo(p[0], p[1]); else { path.moveTo(p[0], p[1]); pen = true; }
      }
      ctx.setLineDash(R.dash); ctx.lineWidth = 1; ctx.strokeStyle = rgb(SPEC.ink, a); ctx.stroke(path); ctx.setLineDash([]);
      const p = project(ring.label[0], ring.label[1], liftZ(ring.label[2], ring.r));
      if (p[2] < near || offscreen(p[0], p[1])) continue;
      const text = scrambled(`${ring.r} m`, age, 0, .35);
      const w = ctx.measureText(text).width;
      ctx.fillStyle = rgb(SPEC.bg, .85 * fade); ctx.fillRect(p[0] + 5, p[1] - 8, w + 8, 16);
      ctx.fillStyle = rgb(hex(SPEC.hud.color), fade * smooth(clamp01(age / .25))); ctx.fillText(text, p[0] + 9, p[1]);
    }
  }

  /* 線路は寄りの後半で、駅から先の弧長をそのまま見出しの下線の上に伸ばした形へ移す。 */
  function railScreen(s, k, straight) {
    const q = railPoint(world.rail, s), p = project(q[0], q[1], q[2]);
    const sx = p[0], sy = p[1];
    if (straight <= 0) return [sx, sy, p[2]];
    const tx = geo.ruleLeft + (s - world.rail.home) * SPEC.camera.pxPerMeter, ty = geo.ruleY;
    return [lerp(sx, tx, straight), lerp(sy, ty, straight), p[2]];
  }
  function drawRail(t, k) {
    const L = SPEC.rail, R = world.rail;
    const drawn = inOutCubic(prog(t, L.drawStart, L.drawDur));
    if (drawn <= 0) return;
    const straight = smooth(prog(k, .35, .6));
    const settled = smooth(prog(t, L.drawStart + L.drawDur * .7, .6));
    const color = mix(mix(L.bright, L.rest, settled), L.final, k);
    const left = lerp(-200, geo.ruleLeft, k), right = lerp(SPEC.W + 200, geo.ruleRight, k);
    ctx.save();
    ctx.beginPath(); ctx.rect(left, 0, right - left, SPEC.H); ctx.clip();
    if (straight >= 1) {
      ctx.fillStyle = rgb(color); ctx.fillRect(left, geo.ruleY - .5, right - left, 1);
    } else {
      const end = R.length * drawn, path = new Path2D();
      let pen = false;
      for (let s = 0; s <= end; s += 6) {
        const p = railScreen(s, k, straight);
        if (p[2] < near) { pen = false; continue; }
        if (pen) path.lineTo(p[0], p[1]); else { path.moveTo(p[0], p[1]); pen = true; }
      }
      ctx.lineWidth = lerp(1.6, 1, k); ctx.strokeStyle = rgb(color); ctx.stroke(path);
      if (drawn < 1) {
        drawStreak(streakPath(end, Math.max(0, end - 300), k, straight), [241, 241, 238], Math.sin(Math.PI * drawn));
      }
    }
    ctx.restore();
  }
  /* 光の尾は線路の上をなぞる。頭と尻尾を直線で結ぶと、曲がった線路から外れる。 */
  function streakPath(sHead, sTail, k, straight) {
    const steps = Math.max(1, Math.ceil(Math.abs(sHead - sTail) / 14)), points = [];
    for (let i = 0; i <= steps; i++) {
      const p = railScreen(lerp(sTail, sHead, i / steps), k, straight);
      if (p[2] >= near) points.push(p[0], p[1]);
    }
    return points;
  }
  function drawStreak(points, color, alpha) {
    const n = points.length / 2;
    if (alpha <= 0 || !n) return;
    const x = points[n * 2 - 2], y = points[n * 2 - 1];
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 1; i < n; i++) {
      const a = alpha * (i - .5) / (n - 1);
      ctx.beginPath(); ctx.moveTo(points[i * 2 - 2], points[i * 2 - 1]); ctx.lineTo(points[i * 2], points[i * 2 + 1]);
      ctx.lineWidth = 3; ctx.strokeStyle = rgb(color, a); ctx.stroke();
      ctx.lineWidth = 14; ctx.strokeStyle = rgb(color, a * .2); ctx.stroke();
    }
    const halo = ctx.createRadialGradient(x, y, 0, x, y, 34);
    halo.addColorStop(0, rgb(color, alpha * .75)); halo.addColorStop(.35, rgb(color, alpha * .22)); halo.addColorStop(1, rgb(color, 0));
    ctx.fillStyle = halo; ctx.fillRect(x - 34, y - 34, 68, 68);
    const core = ctx.createRadialGradient(x, y, 0, x, y, 4.5);
    core.addColorStop(0, rgb([255, 255, 255], alpha)); core.addColorStop(1, rgb([255, 255, 255], 0));
    ctx.fillStyle = core; ctx.fillRect(x - 5, y - 5, 10, 10);
    ctx.globalCompositeOperation = 'source-over';
  }
  function drawTrains(t, k) {
    const fade = 1 - smooth(prog(k, .45, .5)), straight = smooth(prog(k, .35, .6));
    if (fade <= 0) return;
    for (const train of SPEC.trains) {
      const state = trainAt(train, t);
      if (!state) continue;
      const settle = state.stopped ? smooth(prog(t, train.stopsAt, .5)) : 0;
      const held = train.stopsAt != null ? 1 - smooth(prog(k, 0, .3)) : 1;
      const length = Math.min(SPEC.trail.max, state.v * SPEC.trail.perSpeed);
      if (railScreen(state.s, k, straight)[2] < near) continue;
      drawStreak(streakPath(state.s, state.s - train.dir * length, k, straight), train.color, fade * held * (1 - .2 * settle));
    }
  }

  function scrambled(text, t, start, dur) {
    const p = prog(t, start, dur);
    if (p >= 1) return text;
    const shown = Math.floor(text.length * p);
    let s = text.slice(0, shown);
    for (let i = shown; i < text.length; i++) {
      const c = text[i];
      s += /[0-9]/.test(c) ? String((Math.floor(t * 30) * 7 + i * 3) % 10) : c;
    }
    return s;
  }
  const dms = (value, pos, neg) => {
    const v = Math.abs(value), d = Math.floor(v), m = Math.floor((v - d) * 60), s = ((v - d) * 60 - m) * 60;
    return `${value >= 0 ? pos : neg} ${d}°${String(m).padStart(2, '0')}′${s.toFixed(1).padStart(4, '0')}″`;
  };
  function drawHud(t, fade) {
    const H = SPEC.hud, a = smooth(prog(t, H.start, .4)) * fade;
    if (a <= 0) return;
    const O = world.map.origin;
    const lat = O.lat + cam.ty / 110574, lon = O.lon + cam.tx / (Math.cos(O.lat * Math.PI / 180) * 111320);
    ctx.font = `300 14px ${H.font}`; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = rgb(hex(H.color), a);
    ctx.textAlign = 'right';
    ctx.fillText(scrambled(`${dms(lat, 'N', 'S')}   ${dms(lon, 'E', 'W')}`, t, H.start, H.scramble), SPEC.W - 64, 72);
    const heading = ((90 - cam.yaw * 180 / Math.PI) % 360 + 360) % 360;
    const altitude = cam.dist * cam.sp + cam.tz / SPEC.exaggerate;
    ctx.fillText(scrambled(`ALT ${String(Math.round(altitude)).padStart(4, '0')} m   PITCH ${(cam.pitch * 180 / Math.PI).toFixed(1).padStart(4, '0')}°   HDG ${heading.toFixed(1).padStart(5, '0')}°`, t, H.start + .2, H.scramble),
      SPEC.W - 64, SPEC.H - 64);
    ctx.textAlign = 'left';
    ctx.fillText('NEYAGAWA, OSAKA   ×' + SPEC.exaggerate.toFixed(1) + ' VERTICAL', 64, SPEC.H - 64);
    ctx.font = `300 11px ${H.font}`; ctx.fillStyle = rgb(hex(H.color), a * .7);
    ctx.fillText('© OpenStreetMap contributors · 国土地理院 · 線路を走る光はイメージで、実際の列車の位置ではありません', 64, SPEC.H - 40);
  }
  /* 照準: 画面の端から2本の細線が滑ってきて学校の上で交わり、枠が締まってから波が出る。 */
  function drawLock(t) {
    const L = SPEC.lock, gone = smooth(prog(t, L.out[0], L.out[1]));
    if (t < L.start || gone >= 1) return;
    const A = world.school, p = project(A.x, A.y, liftZ(A.z, 0)), x = p[0], y = p[1];
    const slide = outCubic(prog(t, L.start, L.slide));
    const lines = smooth(prog(t, L.start, .12)) * (1 - smooth(prog(t, L.lineOut[0], L.lineOut[1])));
    if (lines > 0) {
      const hy = lerp(0, y, slide), vx = lerp(SPEC.W, x, slide), gap = 34, at = world.map.school;
      ctx.strokeStyle = rgb(SPEC.ink, .42 * lines); ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, hy); ctx.lineTo(vx - gap, hy); ctx.moveTo(vx + gap, hy); ctx.lineTo(SPEC.W, hy);
      ctx.moveTo(vx, 0); ctx.lineTo(vx, hy - gap); ctx.moveTo(vx, hy + gap); ctx.lineTo(vx, SPEC.H); ctx.stroke();
      ctx.font = `300 13px ${SPEC.hud.font}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = rgb(hex(SPEC.hud.color), lines);
      ctx.fillText(`N ${(at.lat + (1 - slide) * .0312).toFixed(4)}°`, 64, hy - 10);
      ctx.fillText(`E ${(at.lon + (1 - slide) * .0447).toFixed(4)}°`, vx + 12, 132);
    }
    const snapAt = L.start + L.slide - .12, snap = outCubic(prog(t, snapAt, L.snap));
    if (snap <= 0) return;
    const half = lerp(L.size[0], L.size[1], snap) / 2, arm = lerp(30, 7, snap), a = smooth(prog(t, snapAt, .12)) * (1 - gone);
    ctx.strokeStyle = rgb(SPEC.ink, .9 * a); ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ctx.moveTo(x + sx * half, y + sy * (half - arm)); ctx.lineTo(x + sx * half, y + sy * half); ctx.lineTo(x + sx * (half - arm), y + sy * half);
    }
    ctx.stroke();
    const flash = prog(t, SPEC.scan.start - .04, .4);
    if (flash > 0 && flash < 1) {
      ctx.globalCompositeOperation = 'lighter';
      const halo = ctx.createRadialGradient(x, y, 0, x, y, 90);
      halo.addColorStop(0, rgb(SPEC.ink, .5 * (1 - flash))); halo.addColorStop(.3, rgb(SPEC.ink, .12 * (1 - flash))); halo.addColorStop(1, rgb(SPEC.ink, 0));
      ctx.fillStyle = halo; ctx.fillRect(x - 90, y - 90, 180, 180);
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  function callout(point, t, start, name, data, fade, nameOnCanvas = true) {
    const C = SPEC.callout, a = fade * smooth(prog(t, start, .35));
    const p = project(point.x, point.y, point.z + 4);
    const grow = outCubic(prog(t, start, .45));
    const x = p[0], y = p[1], ty = y - C.rise * grow, tx = x + C.run * grow;
    if (a <= 0) return { x: tx + 8, y: ty + 8 };
    ctx.strokeStyle = rgb(SPEC.ink, a * .7); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, ty); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.fillStyle = rgb(SPEC.ink, a); ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.textAlign = 'left';
    if (nameOnCanvas) {
      ctx.font = `400 ${C.nameSize}px "Zen Kaku Gothic New", "Noto Sans JP", sans-serif`; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = rgb(SPEC.ink, a * smooth(prog(t, start + .15, .3))); ctx.fillText(name, tx + 8, ty + 8);
    }
    ctx.font = `300 ${C.dataSize}px ${SPEC.hud.font}`; ctx.textBaseline = 'top';
    ctx.fillStyle = rgb(hex(SPEC.hud.color), a);
    ctx.fillText(scrambled(data, t, start + .2, .5), tx + 8, ty + 16);
    return { x: tx + 8, y: ty + 8 };
  }
  function drawMeasure(t, fade) {
    const M = SPEC.measure, p = outCubic(prog(t, M.start, M.dur));
    const a = fade * (1 - smooth(prog(t, 5.3, .5)));
    if (p <= 0 || a <= 0) return;
    const A = world.school, B = world.station, path = new Path2D();
    for (let i = 0; i <= 40 * p; i++) {
      const u = i / 40, x = lerp(A.x, B.x, u), y = lerp(A.y, B.y, u);
      const q = project(x, y, world.heightAt(x, y) + 3);
      if (i === 0) path.moveTo(q[0], q[1]); else path.lineTo(q[0], q[1]);
    }
    ctx.setLineDash([4, 6]); ctx.lineWidth = 1; ctx.strokeStyle = rgb(SPEC.ink, a * .55); ctx.stroke(path); ctx.setLineDash([]);
  }
  function drawArrival(t, fade) {
    const stopper = SPEC.trains.find(train => train.stopsAt != null);
    if (fade <= 0) return;
    const p = project(world.station.x, world.station.y, world.station.z);
    const arrived = prog(t, stopper.stopsAt, SPEC.arrival.pulseDur);
    if (arrived > 0 && arrived < 1) {
      ctx.strokeStyle = rgb(stopper.color, (1 - arrived) * .9 * fade); ctx.lineWidth = lerp(2.5, .5, arrived);
      ctx.beginPath(); ctx.arc(p[0], p[1], lerp(SPEC.arrival.ring, SPEC.arrival.pulseRadius, outCubic(arrived)), 0, Math.PI * 2); ctx.stroke();
    }
    const lit = smooth(prog(t, stopper.stopsAt - .1, .3)), shown = smooth(prog(t, SPEC.callout.station, .3));
    if (shown <= 0) return;
    ctx.fillStyle = rgb(mix(SPEC.bg, stopper.color, lit * .55), fade * shown);
    ctx.strokeStyle = rgb(SPEC.ink, fade * shown); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p[0], p[1], SPEC.arrival.ring, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }

  function draw(t) {
    ctx.clearRect(0, 0, SPEC.W, SPEC.H);
    setWave(t);
    const k = setCamera(t), S = SPEC.scan;
    const mapFade = 1 - smooth(prog(k, .2, .55));
    if (mapFade > 0) {
      const R = SPEC.roads;
      drawLines('terrain', null, SPEC.ink, SPEC.terrain.alpha * mapFade, 1, 0, SPEC.terrain.gain);
      drawLines('contour', null, SPEC.ink, SPEC.contour.alpha * mapFade, 1, 0, SPEC.contour.gain);
      drawLines('water', null, [150, 170, 190], .35 * mapFade, 1, 0, .5);
      for (const cls of [2, 1, 0]) drawLines('road', line => line.cls === cls, SPEC.ink, R.alpha[cls] * mapFade, cls ? 1 : 1.4, R.lag[cls], R.gain[cls]);
      drawLines('track', null, SPEC.ink, .18 * mapFade * (1 - smooth(prog(t, SPEC.rail.drawStart, .4))), 1, R.lag[0], .8);
      drawRanges(mapFade * (1 - smooth(prog(k, 0, .2))));
      drawBuildings(mapFade);
      ctx.setLineDash(SPEC.campus.dash);
      drawLines('ground', null, SPEC.ink, .45 * mapFade, 1, 0, 0);
      drawLines('campus', null, SPEC.ink, SPEC.campus.alpha * mapFade * smooth(prog(t, S.start + .1, .4)), 1.2, 0, 0);
      ctx.setLineDash([]);
      drawDots(mapFade);
      drawScanRing(mapFade);
    }
    const titleA = titleVisibility(t);
    if (titleA > 0) {
      /* 表題の後ろだけを暗くする。下の校舎までは掛けない。 */
      ctx.save(); ctx.translate(640, 448); ctx.scale(1, .24);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 920);
      g.addColorStop(0, rgb(SPEC.bg, .9 * titleA)); g.addColorStop(.6, rgb(SPEC.bg, .62 * titleA)); g.addColorStop(1, rgb(SPEC.bg, 0));
      ctx.fillStyle = g; ctx.fillRect(-920, -920, 1840, 1840); ctx.restore();
    }
    drawMeasure(t, mapFade);
    drawRail(t, k);
    drawTrains(t, k);
    const calloutFade = 1 - smooth(prog(k, 0, .3));
    callout(world.school, t, SPEC.callout.school, world.school.name,
      `${world.map.school.lat.toFixed(4)} N  ${world.map.school.lon.toFixed(4)} E  ${Math.round(world.map.school.z)} m`, calloutFade);
    const label = callout(world.station, t, SPEC.callout.station, world.station.name,
      `${world.map.station.lat.toFixed(4)} N  ${world.map.station.lon.toFixed(4)} E  ${world.km.toFixed(2)} km`, calloutFade, false);
    drawArrival(t, 1 - smooth(prog(k, .15, .55)));
    drawHud(t, 1 - smooth(prog(k, 0, .35)));
    drawLock(t);
    return { k, label };
  }
  function titleVisibility(t) {
    const T = SPEC.title;
    return smooth(prog(t, SPEC.group.start, .6)) * (1 - smooth(prog(t, T.outStart, T.outDur)));
  }

  /* 表題は左から1文字ずつ。 */
  SPEC.title.lines.forEach((text, index) => {
    const line = root.querySelector(index ? '.intro-line2' : '.intro-line1');
    for (const c of text) {
      const span = document.createElement('span');
      span.className = 'intro-ch'; span.textContent = c; line.append(span);
      chars.push({ span, at: SPEC.title.start + (index ? .18 : 0) + (line.children.length - 1) * SPEC.title.stagger });
    }
  });

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
      name, nameScale: SPEC.callout.nameSize / parseFloat(doc.defaultView.getComputedStyle(stationName).fontSize)
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

  function phaseAt(t) {
    let name = BEATS[0][0];
    for (const [label, at] of BEATS) if (t >= at) name = label;
    return name;
  }
  function render(f) {
    frame = Math.max(0, Math.min(LAST, Math.round(f)));
    const t = frame / FPS, G = SPEC.group, T = SPEC.title;
    const { k, label } = draw(t);
    const outP = prog(t, T.outStart, T.outDur), outA = 1 - smooth(outP);
    titleLayer.style.transform = `scale(${scale}) translateY(${-T.outLift * outCubic(outP)}px)`;
    const g = outCubic(prog(t, G.start, G.dur));
    groupText.style.opacity = String(g * outA);
    groupText.style.letterSpacing = `${lerp(G.spacingFrom, G.spacingTo, g)}em`;
    for (const c of chars) {
      const p = outCubic(prog(t, c.at, T.charDur));
      c.span.style.opacity = String(Math.min(1, p * 1.6) * outA);
      c.span.style.transform = `translateY(${(1 - p) * T.rise}px)`;
    }

    /* 駅名は案内画面の実物（#station-name）。寄る前は香里園の引き出し線の先に縮めて置く。 */
    const n = geo.name, s0 = geo.nameScale, C = SPEC.callout;
    const shown = smooth(prog(t, C.station + .15, .3));
    stationName.style.transformOrigin = '0 0';
    {
      const from = label;
      const x0 = from.x - n.x, y0 = from.y - C.nameSize * .88 - (n.h * s0 - C.nameSize) / 2 - n.y;
      stationName.style.transform = `translate(${lerp(x0, 0, k)}px,${lerp(y0, 0, k)}px) scale(${lerp(s0, 1, k)})`;
      stationName.style.opacity = String(Math.max(shown, k));
    }

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

  const base = location.pathname.replace(/\/$/, '');
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
      boardFrame.src = base.slice(0, base.lastIndexOf('/')) + '/normal';
      stage.prepend(boardFrame); resize();
    });
  }
  const loadMap = fetch(base + '/map.json').then(response => {
    if (!response.ok) throw new Error('地図を読み込めませんでした');
    return response.json();
  }).then(map => { world = prepare(map); placeTrains(); });
  /* Google Fonts に届かない環境でも代替フォントで動かす。待つのは4秒まで。 */
  const fontsReady = Promise.race([
    Promise.all([
      document.fonts.load('300 66px "Zen Kaku Gothic New"', SPEC.title.lines[1]),
      document.fonts.load('400 36px "Zen Kaku Gothic New"', SPEC.title.lines[0] + '同志社香里園'),
      document.fonts.load('500 20px "Zen Kaku Gothic New"', '探究1A-1班'),
      document.fonts.load('300 14px "IBM Plex Mono"', 'NE0123456789.°′″ ALTPITCHDGkm')
    ]),
    new Promise(resolve => setTimeout(resolve, 4000))
  ]).then(() => document.fonts.ready);
  Promise.all([fontsReady, loadMap, loadBoard()]).then(() => {
    ready = true; resize(); slider.max = String(LAST);
    root.querySelectorAll('button,input').forEach(el => el.disabled = false);
    status.textContent = 'プレビュー停止中';
  }).catch(error => {
    status.textContent = error.message + '。再読み込みしてください。'; status.setAttribute('role', 'alert');
    const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '再読み込み';
    retry.addEventListener('click', () => location.reload()); status.after(retry);
  });
})();
