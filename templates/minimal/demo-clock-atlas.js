(() => {
  const root = document.getElementById('atlas-clock');
  const stage = root.querySelector('.clock-stage');
  const canvas = root.querySelector('.clock-map');
  const ctx = canvas.getContext('2d');
  const overlay = root.querySelector('.clock-overlay');
  const dateText = root.querySelector('.clock-date');
  const timeText = root.querySelector('.clock-time');
  const secondsText = root.querySelector('.clock-seconds');
  const status = root.querySelector('[role="status"]');
  const opsBox = root.querySelector('.ops'), weatherBox = root.querySelector('.wx'), infoSelect = root.querySelector('[data-info]');

  const SPEC = {
    W: 1920, H: 1080,
    bg: [11, 11, 12], ink: [241, 241, 238],
    exaggerate: 2.2,
    hud: { start: 0.15, scramble: 0.7, color: '#7C7C82', font: '"IBM Plex Mono", ui-monospace, monospace' },
    lock: { start: 0.05, slide: 0.5, snap: 0.36, size: [170, 26], lineOut: [0.85, 0.6], out: [1.7, 0.5] },
    /* 読み込んだ直後に一度だけ、学校から広がる波で地図を立ち上げる。 */
    reveal: { start: 0.7, speed: 820, ring: 0.5, rise: 0.5, swell: 0.75, bump: 13, bumpDur: 0.26, settle: 1 },
    /* そのあとは20秒ごとに、学校と駅から交互に波を出す。地図は消さず、通った所の線が光るだけ。 */
    pulse: { every: 20, speed: 560, ring: 0.3, minuteRing: 0.5, bump: 8, bumpDur: 0.3, gain: 0.55 },
    hot: [[0.06, 0.9, 1.5], [0.16, 0.42, 1.2], [0.38, 0.16, 1]],
    dots: { ahead: 0.16, behind: 0.32, alpha: 0.85 },
    rings: { radii: [250, 500, 750, 1000], alpha: 0.3, dash: [3, 6], bearing: 2.75 },
    terrain: { alpha: 0.085, every: 2, gain: 0.3 },
    contour: { every: 5, step: 15, alpha: 0.17, gain: 0.55 },
    roads: { alpha: [0.42, 0.2, 0.09], lag: [-0.2, 0.08, 0.08], gain: [1, 0.7, 0.4] },
    buildings: { alpha: 0.26, campusAlpha: 0.95, lead: 0.16, reach: { school: 620, station: 380 }, edge: 0.35, gain: 0.8 },
    campus: { alpha: 0.85, dash: [10, 7] },
    rail: { drawStart: 2.4, drawDur: 0.9, color: [150, 150, 148], width: 1.5 },
    colors: { '特急': '#FF3B30', '快速急行': '#C445D6', '準急': '#2F7BFF', '普通': '#B8B8BC' },
    trains: {
      every: 8, from: 3.6, tail: 1.3,
      order: ['特急', '普通', '準急', '快速急行', '普通', '準急'],
      speed: { '特急': 300, '快速急行': 270, '準急': 220, '普通': 180 }
    },
    callout: { school: 2.0, station: 3.0, rise: 150, run: 34, nameSize: 24, dataSize: 13, hideLeft: [980, 1140] },
    arrival: { ring: 5.5 },
    clock: { start: 2.3, fade: 0.6, stagger: 0.045, backing: [560, 548, 1040, 0.4] },
    camera: {
      focal: 1500,
      open: { yaw: -1.1, pitch: 80, dist: 1150, anchor: [960, 560] },
      sweep: 2.5, settle: 5,
      anchor: [1300, 590],
      /* 揺れの始まり（phase）は、開いた直後に学校が手前・駅が奥で両方とも画面に入る位置に合わせてある。 */
      yaw: { from: -0.3, period: 300 },
      pitch: { mid: 45, swing: 9, period: 97, phase: 3.1416 },
      dist: { mid: 1780, swing: 440, period: 131, phase: 0.82 },
      focus: { mid: 0.42, swing: 0.34, period: 173, phase: 3.665, side: 130, sidePeriod: 61 }
    }
  };

  let world = null, ready = false, raf = 0, startedAt = 0, frozen = false, scale = 1;
  let offset = 0, shownSecond = -1, clockOn = false, slow = 0, skip = false;

  const clamp01 = x => Math.max(0, Math.min(1, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const prog = (t, start, dur) => clamp01((t - start) / dur);
  const outCubic = x => 1 - Math.pow(1 - x, 3);
  const outBack = (x, s = 1.70158) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2);
  const inOutCubic = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  const smooth = x => x * x * (3 - 2 * x);
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const TAU = Math.PI * 2;

  /* 地図は描く前に一度だけ平らな配列にしておく。at は学校からの距離、at2 は駅からの距離（波の出どころが2つあるため）。 */
  function prepare(map) {
    const X = SPEC.exaggerate, T = map.terrain;
    const heightAt = (x, y) => {
      const fx = clamp01((x - T.x0) / (T.step * (T.nx - 1))) * (T.nx - 1), fy = clamp01((y - T.y0) / (T.step * (T.ny - 1))) * (T.ny - 1);
      const i = Math.min(T.nx - 2, Math.floor(fx)), j = Math.min(T.ny - 2, Math.floor(fy)), u = fx - i, v = fy - j;
      const h = (a, b) => T.h[b * T.nx + a];
      return X * lerp(lerp(h(i, j), h(i + 1, j), u), lerp(h(i, j + 1), h(i + 1, j + 1), u), v);
    };
    const school = map.school;
    const m = map.rail.main, n = m.length / 2;
    const rail = { xyz: new Float32Array(n * 3), s: new Float32Array(n), n };
    for (let i = 0; i < n; i++) {
      rail.xyz[i * 3] = m[i * 2]; rail.xyz[i * 3 + 1] = m[i * 2 + 1]; rail.xyz[i * 3 + 2] = heightAt(m[i * 2], m[i * 2 + 1]) + 2;
      if (i) rail.s[i] = rail.s[i - 1] + Math.hypot(m[i * 2] - m[i * 2 - 2], m[i * 2 + 1] - m[i * 2 - 1]);
    }
    let home = 0, best = Infinity;
    for (let i = 0; i < n - 1; i++) {
      const ax = m[i * 2], ay = m[i * 2 + 1], dx = m[i * 2 + 2] - ax, dy = m[i * 2 + 3] - ay;
      const u = clamp01(((map.station.x - ax) * dx + (map.station.y - ay) * dy) / (dx * dx + dy * dy));
      const d = Math.hypot(ax + dx * u - map.station.x, ay + dy * u - map.station.y);
      if (d < best) { best = d; home = rail.s[i] + u * Math.hypot(dx, dy); }
    }
    rail.home = home; rail.length = rail.s[n - 1];
    const back = railPoint(rail, home - 120), ahead = railPoint(rail, home + 120);
    rail.heading = Math.atan2(ahead[1] - back[1], ahead[0] - back[0]);
    const homePoint = railPoint(rail, home);
    const station = { ...map.station, x: homePoint[0], y: homePoint[1], z: homePoint[2] };

    const distance = (x, y) => Math.hypot(x - school.x, y - school.y);
    const fromStation = (x, y) => Math.hypot(x - station.x, y - station.y);
    const layers = {}, far = { at: 0, at2: 0 };
    const polyline = (flat, lift, layer, extra = {}) => {
      const count = flat.length / 2, xyz = new Float32Array(count * 3), at = new Float32Array(count), at2 = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const x = flat[i * 2], y = flat[i * 2 + 1];
        xyz[i * 3] = x; xyz[i * 3 + 1] = y; xyz[i * 3 + 2] = heightAt(x, y) + lift;
        at[i] = distance(x, y); at2[i] = fromStation(x, y);
        far.at = Math.max(far.at, at[i]); far.at2 = Math.max(far.at2, at2[i]);
      }
      (layers[layer] || (layers[layer] = [])).push({ xyz, at, at2, ...extra });
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
    const count = T.nx * T.ny, nodes = { xyz: new Float32Array(count * 3), at: new Float32Array(count), at2: new Float32Array(count) };
    for (let j = 0, k = 0; j < T.ny; j++) for (let i = 0; i < T.nx; i++, k++) {
      const x = T.x0 + i * T.step, y = T.y0 + j * T.step;
      nodes.xyz[k * 3] = x; nodes.xyz[k * 3 + 1] = y; nodes.xyz[k * 3 + 2] = X * T.h[k];
      nodes.at[k] = distance(x, y); nodes.at2[k] = fromStation(x, y);
    }
    const rings = SPEC.rings.radii.map(r => {
      const steps = 120, xyz = new Float32Array((steps + 1) * 3);
      for (let i = 0; i <= steps; i++) {
        const th = i / steps * TAU, x = school.x + Math.cos(th) * r, y = school.y + Math.sin(th) * r;
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
      const points = b.p.length / 2, xy = new Float32Array(b.p);
      let cx = 0, cy = 0; for (let i = 0; i < points; i++) { cx += xy[i * 2]; cy += xy[i * 2 + 1]; }
      cx /= points; cy /= points;
      /* 建物があるのは学校と駅のまわりの円の中だけなので、円の縁に向かって薄くして境目を見せない。 */
      const R = SPEC.buildings.reach, inner = Math.max(1 - distance(cx, cy) / R.school, 1 - fromStation(cx, cy) / R.station);
      const dim = b.c ? 0 : Math.round((1 - smooth(clamp01(inner / SPEC.buildings.edge))) * 4);
      return { xy, n: points, z: b.z * X, h: b.h, campus: !!b.c, at: distance(cx, cy), at2: fromStation(cx, cy), dim };
    });
    buildings.sort((a, b) => a.at - b.at);
    return {
      map, layers, buildings, rail, heightAt, nodes, rings, far, floor: X * Math.min(...T.h),
      school: { ...school, z: heightAt(school.x, school.y) }, station,
      km: Math.hypot(school.x - map.station.x, school.y - map.station.y) / 1000
    };
  }
  function railPoint(rail, s) {
    s = Math.max(0, Math.min(rail.s[rail.n - 1], s));
    let i = 1; while (i < rail.n - 1 && rail.s[i] < s) i++;
    const u = (s - rail.s[i - 1]) / (rail.s[i] - rail.s[i - 1] || 1), p = rail.xyz;
    return [lerp(p[i * 3 - 3], p[i * 3], u), lerp(p[i * 3 - 2], p[i * 3 + 1], u), lerp(p[i * 3 - 1], p[i * 3 + 2], u)];
  }

  /* 波: 出どころからの距離と、波が通ってからの秒数（age）で、線の熱と地形の盛り上がりを決める。
     hide が立っているあいだ（最初の立ち上げ）だけ、波がまだ来ていない所を描かない。 */
  const wave = { key: 'at', reach: 0, speed: 1, active: false, hide: false, gain: 1, ring: 0, bump: 0, bumpDur: 1 };
  function setWave(t, now) {
    const R = SPEC.reveal, P = SPEC.pulse;
    const revealReach = (t - R.start) * R.speed, revealing = revealReach < world.far.at + R.speed * R.settle;
    if (revealing) {
      Object.assign(wave, { key: 'at', reach: revealReach, speed: R.speed, active: true, hide: true, gain: 1, ring: R.ring, bump: R.bump, bumpDur: R.bumpDur });
      return;
    }
    const seconds = now / 1000, index = Math.floor(seconds / P.every), phase = seconds - index * P.every;
    const key = index % 3 === 1 ? 'at2' : 'at', reach = phase * P.speed;
    const revealEnd = R.start + world.far.at / R.speed + R.settle;
    wave.hide = false;
    wave.active = phase < t - revealEnd && reach < world.far[key] + P.speed * 0.5;
    if (!wave.active) return;
    Object.assign(wave, { key, reach, speed: P.speed, gain: P.gain, ring: index % 3 === 0 ? P.minuteRing : P.ring, bump: P.bump, bumpDur: P.bumpDur });
  }
  function liftZ(z, dist, steady = false) {
    if (!wave.active) return z;
    const age = (wave.reach - dist) / wave.speed;
    if (!wave.hide) return !steady && age > 0 && age < wave.bumpDur ? z + wave.bump * Math.sin(Math.PI * age / wave.bumpDur) : z;
    if (age <= 0) return world.floor;
    const S = SPEC.reveal;
    let v = age >= S.swell ? z : world.floor + (z - world.floor) * outBack(age / S.swell, 1.2);
    if (!steady && age < wave.bumpDur) v += wave.bump * Math.sin(Math.PI * age / wave.bumpDur);
    return v;
  }
  const HOT = SPEC.hot, HOT_MAX = HOT[HOT.length - 1][0];
  const hotLevel = age => { for (let i = 0; i < HOT.length; i++) if (age < HOT[i][0]) return i; return -1; };
  function strokeHot(hot, gain) {
    gain *= wave.gain;
    if (!hot || gain <= 0) return;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 5; ctx.strokeStyle = rgb(SPEC.ink, .1 * gain); ctx.stroke(hot[0]);
    HOT.forEach(([, alpha, width], i) => { ctx.lineWidth = width; ctx.strokeStyle = rgb(SPEC.ink, alpha * gain); ctx.stroke(hot[i]); });
    ctx.globalCompositeOperation = 'source-over';
  }

  /* カメラ: 地面の点 target を画面の anchor に置き、yaw で向きを、pitch で見下ろす角度（90°で真上）を決める。
     止まらない。向きは一定の速さで回り、角度・距離・見る場所はそれぞれ違う周期でゆっくり揺れる。 */
  const cam = { cy: 1, sy: 0, cp: 1, sp: 0, dist: 1, f: 1, ax: 0, ay: 0, tx: 0, ty: 0, tz: 0, yaw: 0, pitch: 0 };
  const near = 40;
  const swing = (o, t) => o.mid + o.swing * Math.sin(TAU * t / o.period + o.phase);
  function setCamera(t) {
    const C = SPEC.camera, O = C.open, A = world.school, S = world.station;
    const sweep = outCubic(prog(t, SPEC.reveal.start, C.sweep)), settle = smooth(prog(t, 0, C.settle));
    /* 向きの基準は「学校から駅を見る向き」。 */
    const yaw = Math.atan2(A.x - S.x, S.y - A.y) + C.yaw.from + TAU * t / C.yaw.period + (1 - sweep) * (O.yaw - C.yaw.from);
    const pitch = lerp(O.pitch, swing(C.pitch, t), sweep) * Math.PI / 180;
    const dist = Math.exp(lerp(Math.log(O.dist), Math.log(swing(C.dist, t)), sweep));
    const along = swing(C.focus, t) * settle, side = C.focus.side * Math.sin(TAU * t / C.focus.sidePeriod) * settle;
    const dx = S.x - A.x, dy = S.y - A.y, length = Math.hypot(dx, dy);
    const fx = A.x + dx * along - dy / length * side, fy = A.y + dy * along + dx / length * side;
    /* 波の盛り上がりは拾わない。拾うと、波が通るたびに画面全体が上下に揺れる。 */
    cam.tx = fx; cam.ty = fy; cam.tz = liftZ(world.heightAt(fx, fy), wave.key === 'at' ? Math.hypot(fx - A.x, fy - A.y) : Math.hypot(fx - S.x, fy - S.y), true);
    cam.cy = Math.cos(yaw); cam.sy = Math.sin(yaw); cam.cp = Math.cos(pitch); cam.sp = Math.sin(pitch);
    cam.dist = dist; cam.f = C.focal; cam.yaw = yaw; cam.pitch = pitch;
    cam.ax = lerp(O.anchor[0], C.anchor[0], settle); cam.ay = lerp(O.anchor[1], C.anchor[1], settle);
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
    const active = wave.active, hide = active && wave.hide, key = wave.key;
    const paths = [], hot = active && gain > 0 ? HOT.map(() => new Path2D()) : null;
    const reach = wave.reach - (hide ? lag : 0) * wave.speed, inv = 1 / wave.speed;
    let pen = false, path = null, lx = 0, ly = 0;
    const put = (x, y, z, dist, age) => {
      const p = project(x, y, active ? liftZ(z, dist) : z);
      if (p[2] < near || offscreen(p[0], p[1])) { pen = false; return; }
      if (!pen) {
        path = paths[fogBucket(p[2])] || (paths[fogBucket(p[2])] = new Path2D());
        path.moveTo(p[0], p[1]); pen = true;
      } else {
        path.lineTo(p[0], p[1]);
        if (hot && age >= 0 && age < HOT_MAX) { const h = hot[hotLevel(age)]; h.moveTo(lx, ly); h.lineTo(p[0], p[1]); }
      }
      lx = p[0]; ly = p[1];
    };
    for (const line of world.layers[layer]) {
      if (filter && !filter(line)) continue;
      const xyz = line.xyz, d = line[key], n = d.length;
      let before = 0; pen = false;
      for (let i = 0; i < n; i++) {
        const age = active ? (reach - d[i]) * inv : 9;
        if (!hide) { put(xyz[i * 3], xyz[i * 3 + 1], xyz[i * 3 + 2], d[i], age); continue; }
        /* 波の縁をまたぐ線分は、縁のところで切る。 */
        if (i && (age < 0) !== (before < 0)) {
          const u = before / (before - age), j = i * 3;
          put(lerp(xyz[j - 3], xyz[j], u), lerp(xyz[j - 2], xyz[j + 1], u), lerp(xyz[j - 1], xyz[j + 2], u), lerp(d[i - 1], d[i], u), 0);
        }
        if (age < 0) pen = false; else put(xyz[i * 3], xyz[i * 3 + 1], xyz[i * 3 + 2], d[i], age);
        before = age;
      }
    }
    strokeBuckets(paths, color, alpha, width);
    strokeHot(hot, gain);
  }
  function drawBuildings() {
    const B = SPEC.buildings, S = SPEC.reveal, active = wave.active, hide = active && wave.hide;
    const reach = wave.reach - (hide ? B.lead : 0) * wave.speed;
    if (hide && reach <= 0) return;
    const paths = [], campus = new Path2D(), roofs = new Path2D(), hot = active ? HOT.map(() => new Path2D()) : null;
    const top = new Float32Array(64), bottom = new Float32Array(64);
    for (const b of world.buildings) {
      const dist = b[wave.key], age = active ? (reach - dist) / wave.speed : 9;
      if (hide && age < 0) break;
      const rise = !hide || age >= S.rise ? 1 : outBack(age / S.rise);
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
      if (hot && age >= 0 && age < HOT_MAX && b.dim < 3) outline(hot[hotLevel(age)]);
      for (let i = 0; i < n; i++) { path.moveTo(top[i * 2], top[i * 2 + 1]); path.lineTo(bottom[i * 2], bottom[i * 2 + 1]); }
      if (b.campus) {
        path.moveTo(bottom[0], bottom[1]);
        for (let i = 1; i < n; i++) path.lineTo(bottom[i * 2], bottom[i * 2 + 1]);
        path.closePath();
      }
    }
    strokeBuckets(paths, SPEC.ink, B.alpha);
    strokeHot(hot, B.gain);
    /* 校舎だけは屋根を薄く塗って、後ろの線から浮かせる。 */
    ctx.fillStyle = rgb(SPEC.bg, .55); ctx.fill(roofs);
    ctx.fillStyle = rgb(SPEC.ink, .07); ctx.fill(roofs);
    ctx.lineWidth = 1.2; ctx.strokeStyle = rgb(SPEC.ink, B.campusAlpha); ctx.stroke(campus);
  }
  function drawWaveRing() {
    const r = wave.reach;
    if (!wave.active || r <= 0) return;
    const a = wave.ring * (1 - smooth(prog(r, wave.hide ? 900 : 500, wave.hide ? 900 : 1400)));
    if (a <= 0) return;
    const c = wave.key === 'at' ? world.school : world.station, path = new Path2D();
    let pen = false;
    for (let i = 0; i <= 160; i++) {
      const th = i / 160 * TAU, x = c.x + Math.cos(th) * r, y = c.y + Math.sin(th) * r;
      const p = project(x, y, wave.hide ? world.floor + 1 : world.heightAt(x, y) + 1);
      if (p[2] < near) { pen = false; continue; }
      if (pen) path.lineTo(p[0], p[1]); else { path.moveTo(p[0], p[1]); pen = true; }
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 9; ctx.strokeStyle = rgb(SPEC.ink, a * .1); ctx.stroke(path);
    ctx.lineWidth = 1.4; ctx.strokeStyle = rgb(SPEC.ink, a); ctx.stroke(path);
    ctx.globalCompositeOperation = 'source-over';
  }
  /* 測点: 波の少し先に標高の格子点が灯る。 */
  function drawDots() {
    const D = SPEC.dots;
    if (!wave.active) return;
    const N = world.nodes, at = N[wave.key], levels = [new Path2D(), new Path2D(), new Path2D()];
    const lo = wave.reach - D.behind * wave.speed, hi = wave.reach + D.ahead * wave.speed;
    for (let i = 0, n = at.length; i < n; i++) {
      const d = at[i];
      if (d < lo || d > hi) continue;
      const age = (wave.reach - d) / wave.speed;
      const a = age < 0 ? 1 + age / D.ahead : 1 - age / D.behind;
      const p = project(N.xyz[i * 3], N.xyz[i * 3 + 1], liftZ(N.xyz[i * 3 + 2], d));
      if (p[2] < near || offscreen(p[0], p[1])) continue;
      const size = a > .66 ? 2.4 : 1.6;
      levels[a > .66 ? 2 : a > .33 ? 1 : 0].rect(p[0] - size / 2, p[1] - size / 2, size, size);
    }
    ctx.globalCompositeOperation = 'lighter';
    [.22, .5, 1].forEach((a, i) => { ctx.fillStyle = rgb(SPEC.ink, a * D.alpha * wave.gain); ctx.fill(levels[i]); });
    ctx.globalCompositeOperation = 'source-over';
  }
  /* 距離の輪: 学校からの距離を残す。 */
  function drawRanges(t) {
    const R = SPEC.rings, S = SPEC.reveal;
    ctx.font = `300 11px ${SPEC.hud.font}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const ring of world.rings) {
      const age = t - S.start - ring.r / S.speed;
      if (age <= 0) continue;
      const dist = wave.key === 'at' ? ring.r : 1e9;
      const a = R.alpha * (.45 + .55 * (1 - smooth(clamp01(age / 1.2)))), path = new Path2D(), n = ring.xyz.length / 3;
      let pen = false;
      for (let i = 0; i < n; i++) {
        const p = project(ring.xyz[i * 3], ring.xyz[i * 3 + 1], liftZ(ring.xyz[i * 3 + 2], dist));
        if (p[2] < near || offscreen(p[0], p[1])) { pen = false; continue; }
        if (pen) path.lineTo(p[0], p[1]); else { path.moveTo(p[0], p[1]); pen = true; }
      }
      ctx.setLineDash(R.dash); ctx.lineWidth = 1; ctx.strokeStyle = rgb(SPEC.ink, a); ctx.stroke(path); ctx.setLineDash([]);
      const p = project(ring.label[0], ring.label[1], liftZ(ring.label[2], dist));
      if (p[2] < near || offscreen(p[0], p[1])) continue;
      const text = scrambled(`${ring.r} m`, age, 0, .35), w = ctx.measureText(text).width;
      ctx.fillStyle = rgb(SPEC.bg, .85); ctx.fillRect(p[0] + 5, p[1] - 8, w + 8, 16);
      ctx.fillStyle = rgb(hex(SPEC.hud.color), smooth(clamp01(age / .25))); ctx.fillText(text, p[0] + 9, p[1]);
    }
  }

  function railScreen(s) {
    const q = railPoint(world.rail, s), p = project(q[0], q[1], q[2]);
    return [p[0], p[1], p[2]];
  }
  /* 光の尾は線路の上をなぞる。 */
  function streakPath(sHead, sTail) {
    const steps = Math.max(1, Math.ceil(Math.abs(sHead - sTail) / 14)), points = [];
    for (let i = 0; i <= steps; i++) {
      const p = railScreen(lerp(sTail, sHead, i / steps));
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
  function drawRail(t) {
    const L = SPEC.rail, R = world.rail, drawn = inOutCubic(prog(t, L.drawStart, L.drawDur));
    if (drawn <= 0) return;
    const end = R.length * drawn, path = new Path2D();
    let pen = false;
    for (let s = 0; s <= end; s += 8) {
      const p = railScreen(s);
      if (p[2] < near || offscreen(p[0], p[1])) { pen = false; continue; }
      if (pen) path.lineTo(p[0], p[1]); else { path.moveTo(p[0], p[1]); pen = true; }
    }
    ctx.lineWidth = L.width; ctx.strokeStyle = rgb(L.color); ctx.stroke(path);
    if (drawn < 1) drawStreak(streakPath(end, Math.max(0, end - 300)), SPEC.ink, Math.sin(Math.PI * drawn));
  }
  /* 列車の光は飾り。実際の列車の位置ではない。時計の時刻だけで決めて、読み込み直しても同じ流れが続くようにする。 */
  const KINDS = SPEC.trains.order.map(kind => ({ kind, color: hex(SPEC.colors[kind]), speed: SPEC.trains.speed[kind] }));
  function drawTrains(t, now) {
    const T = SPEC.trains, R = world.rail, fade = smooth(prog(t, T.from, 1.2));
    if (fade <= 0) return;
    const seconds = now / 1000, latest = Math.floor(seconds / T.every);
    for (let index = latest; index > latest - 4; index--) {
      const train = KINDS[((index % KINDS.length) + KINDS.length) % KINDS.length], dir = index % 2 ? -1 : 1;
      const run = (seconds - index * T.every) * train.speed, tail = train.speed * T.tail;
      if (run > R.length + tail) continue;
      const s = dir > 0 ? run : R.length - run, sTail = s - dir * tail;
      const edge = smooth(clamp01(run / 200)) * smooth(clamp01((R.length + tail - run) / 200));
      const head = railScreen(s);
      if (head[2] < near || offscreen(head[0], head[1])) continue;
      drawStreak(streakPath(s, sTail), train.color, fade * edge);
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
  function drawHud(t) {
    const H = SPEC.hud, a = smooth(prog(t, H.start, .4));
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
    ctx.fillText('© OpenStreetMap contributors · 国土地理院', 64, SPEC.H - 40);
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
  }
  /* 引き出し線つきの名前。時計の文字の後ろに回ったら消す。 */
  function callout(point, t, start, name, data) {
    const C = SPEC.callout;
    const p = project(point.x, point.y, point.z + 4), x = p[0], y = p[1];
    if (p[2] < near || y < 40 || y > SPEC.H + 100) return;
    /* 右上の座標表示に重なる所でも消す。 */
    const corner = smooth(prog(x, 1430, 120)) * (1 - smooth(prog(y - C.rise, 70, 70)));
    const a = smooth(prog(t, start, .35)) * smooth(prog(x, C.hideLeft[0], C.hideLeft[1] - C.hideLeft[0])) * (1 - smooth(prog(x, SPEC.W - 330, 200))) * (1 - corner);
    if (a <= 0) return;
    const grow = outCubic(prog(t, start, .45)), ty = y - C.rise * grow, tx = x + C.run * grow;
    ctx.strokeStyle = rgb(SPEC.ink, a * .7); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, ty); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.fillStyle = rgb(SPEC.ink, a); ctx.beginPath(); ctx.arc(x, y, 2.5, 0, TAU); ctx.fill();
    ctx.textAlign = 'left';
    ctx.font = `400 ${C.nameSize}px "Zen Kaku Gothic New", "Noto Sans JP", sans-serif`; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = rgb(SPEC.ink, a * smooth(prog(t, start + .15, .3))); ctx.fillText(name, tx + 8, ty + 8);
    ctx.font = `300 ${C.dataSize}px ${SPEC.hud.font}`; ctx.textBaseline = 'top';
    ctx.fillStyle = rgb(hex(SPEC.hud.color), a);
    ctx.fillText(scrambled(data, t, start + .2, .5), tx + 8, ty + 16);
  }
  function drawStation(t) {
    const shown = smooth(prog(t, SPEC.callout.station, .3));
    if (shown <= 0) return;
    const p = project(world.station.x, world.station.y, world.station.z);
    if (p[2] < near) return;
    ctx.fillStyle = rgb(SPEC.bg, shown); ctx.strokeStyle = rgb(SPEC.ink, shown); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p[0], p[1], SPEC.arrival.ring, 0, TAU); ctx.fill(); ctx.stroke();
  }

  function draw(t, now) {
    ctx.clearRect(0, 0, SPEC.W, SPEC.H);
    setWave(t, now); setCamera(t);
    const R = SPEC.roads, S = SPEC.reveal;
    drawLines('terrain', null, SPEC.ink, SPEC.terrain.alpha, 1, 0, SPEC.terrain.gain);
    drawLines('contour', null, SPEC.ink, SPEC.contour.alpha, 1, 0, SPEC.contour.gain);
    drawLines('water', null, [150, 170, 190], .35, 1, 0, .5);
    for (const cls of [2, 1, 0]) drawLines('road', line => line.cls === cls, SPEC.ink, R.alpha[cls], cls ? 1 : 1.4, R.lag[cls], R.gain[cls]);
    drawLines('track', null, SPEC.ink, .18 * (1 - smooth(prog(t, SPEC.rail.drawStart, .4))), 1, R.lag[0], .8);
    drawRanges(t);
    drawBuildings();
    ctx.setLineDash(SPEC.campus.dash);
    drawLines('ground', null, SPEC.ink, .45, 1, 0, 0);
    drawLines('campus', null, SPEC.ink, SPEC.campus.alpha * smooth(prog(t, S.start + .1, .4)), 1.2, 0, 0);
    ctx.setLineDash([]);
    drawDots();
    drawWaveRing();
    drawRail(t);
    drawTrains(t, now);
    drawStation(t);
    const shown = smooth(prog(t, SPEC.clock.start, SPEC.clock.fade));
    if (shown > 0) {
      /* 時計の後ろだけを暗くする。 */
      const [cx, cy, radius, squash] = SPEC.clock.backing;
      ctx.save(); ctx.translate(cx, cy); ctx.scale(1, squash);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
      g.addColorStop(0, rgb(SPEC.bg, .93 * shown)); g.addColorStop(.62, rgb(SPEC.bg, .7 * shown)); g.addColorStop(1, rgb(SPEC.bg, 0));
      ctx.fillStyle = g; ctx.fillRect(-radius, -radius, radius * 2, radius * 2); ctx.restore();
    }
    callout(world.school, t, SPEC.callout.school, world.school.name,
      `${world.map.school.lat.toFixed(4)} N  ${world.map.school.lon.toFixed(4)} E  ${Math.round(world.map.school.z)} m`);
    callout(world.station, t, SPEC.callout.station, world.station.name,
      `${world.map.station.lat.toFixed(4)} N  ${world.map.station.lon.toFixed(4)} E  ${world.km.toFixed(2)} km`);
    drawHud(t);
    drawLock(t);
    return shown;
  }

  /* 時計。1秒ごとに書き換え、変わった桁だけ下からせり上げる。 */
  const timeFormat = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const dateFormat = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
  function setDigits(element, text, animate) {
    if (element.childElementCount !== text.length) {
      element.replaceChildren(...Array.from(text, character => {
        const span = document.createElement('span');
        span.className = character === ':' ? 'clock-separator' : 'clock-digit';
        return span;
      }));
    }
    Array.from(text).forEach((character, index) => {
      const span = element.children[index];
      if (span.textContent === character) return;
      span.textContent = character;
      if (animate) span.animate([
        { opacity: 0, clipPath: 'inset(100% 0 0 0)', transform: 'translateY(.07em)' },
        { opacity: 1, clipPath: 'inset(-10% 0 -10% 0)', transform: 'translateY(0)' }
      ], { duration: 420, easing: 'cubic-bezier(.16,1,.3,1)' });
    });
  }
  function showTime(now) {
    const second = Math.floor(now / 1000);
    if (second === shownSecond) return;
    const first = shownSecond < 0; shownSecond = second;
    const date = new Date(second * 1000), time = timeFormat.format(date), parts = dateFormat.formatToParts(date);
    const part = type => parts.find(p => p.type === type).value;
    setDigits(timeText, time.slice(0, 5), !first && clockOn);
    setDigits(secondsText, time.slice(5), false);
    dateText.textContent = `${part('year')}.${part('month')}.${part('day')} ${part('weekday')}`;
    showLines(second);
  }
  function render(t, now) {
    showTime(now);
    const shown = draw(t, now);
    overlay.style.opacity = String(shown);
    if (shown > 0 && !clockOn) {
      clockOn = true;
      [dateText, ...timeText.children, ...secondsText.children].forEach((element, index) => element.animate([
        { opacity: 0, transform: 'translateY(22px)' }, { opacity: 1, transform: 'translateY(0)' }
      ], { duration: 550, delay: index * SPEC.clock.stagger * 1000, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' }));
    }
    stage.dataset.time = t.toFixed(2);
  }
  function tick(stamp) {
    raf = requestAnimationFrame(tick);
    /* 描くのに時間がかかる端末では、1コマおきに描く。 */
    skip = slow > 20 && !skip;
    if (skip) { showTime(Date.now() + offset); return; }
    const before = performance.now();
    render((stamp - startedAt) / 1000, Date.now() + offset);
    const cost = performance.now() - before;
    slow = cost > 13 ? Math.min(40, slow + 1) : Math.max(0, slow - 1);
  }
  function start() {
    cancelAnimationFrame(raf); frozen = false; clockOn = false; shownSecond = -1;
    startedAt = performance.now(); raf = requestAnimationFrame(tick);
  }

  /* 時刻合わせは時計の画面（clock/index.html）と同じ。届かなければ端末の時計のまま。 */
  function sampleOnce() {
    const t0 = performance.now();
    return fetch('/api/time', { cache: 'no-store', signal: AbortSignal.timeout(10000) })
      .then(response => { if (!response.ok) throw new Error('HTTP ' + response.status); return response.json(); })
      .then(data => { const rtt = performance.now() - t0; return { offset: data.ts * 1000 + rtt / 2 - Date.now(), rtt }; });
  }
  async function syncTime() {
    let best = null;
    for (let i = 0; i < 8; i++) {
      try { const sample = await sampleOnce(); if (!best || sample.rtt < best.rtt) best = sample; } catch (error) { if (!best && i >= 1) break; }
    }
    if (best && !frozen) offset = best.offset;
  }

  /* 運行情報と気象警報。1分ごとに取り直し、10分取れなければ古い内容は出さない。 */
  const INFO = { every: 60000, stale: 600000, pageSize: 3, pageSeconds: 4 };
  const SAMPLE_WEATHER = {
    enabled: true, available: true, as_of: '07:30', area_count: 7, all_label: '7市すべて', unit: '市',
    warnings: [{ name: '暴風警報', level: 3, tone: 'l3', cities: ['寝屋川市', '枚方市', '交野市', '守口市', '門真市', '四條畷市', '大東市'] }],
    previews: [{ kind: 'soon', when: '昼過ぎから', name: '大雨警報', cities: ['寝屋川市', '枚方市'] }]
  };
  const info = { ops: null, opsAt: 0, weather: null, weatherAt: 0, timer: 0, run: 0, rows: [], page: -1 };
  const span = (className, text) => { const node = document.createElement('span'); if (className) node.className = className; node.textContent = text; return node; };
  const hhmm = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  function renderOps(groups) {
    opsBox.hidden = !groups || !groups.length;
    if (opsBox.hidden) return;
    const list = opsBox.querySelector('.ops-groups'), lines = opsBox.querySelector('.ops-lines'), perGroup = [];
    list.replaceChildren(span('ops-title', '運行情報'), ...groups.map(group => {
      const warning = ['×', '△', '！'].includes(group.mark), normal = ['○', '〇'].includes(group.mark);
      const item = span('ops-group' + (warning ? ' is-warning' : normal ? '' : ' is-unknown'), '');
      item.append(span('ops-mark', warning ? group.mark : ''), span('', group.name));
      if (!normal) item.append(span(warning ? 'ops-status' : '', group.status));
      if (warning && group.lines.length) perGroup.push(group.lines.map(line => [line.ticker_name || line.name, line.status, line.announced_time]));
      return item;
    }));
    /* 路線が多いときに1社だけで行を使い切らないよう、各社のいちばん重い路線から順に取る。 */
    const rows = [];
    for (let i = 0; perGroup.some(group => i < group.length); i++) perGroup.forEach(group => { if (i < group.length) rows.push(group[i]); });
    lines.hidden = !rows.length;
    info.rows = rows; info.page = -1;
    showLines(shownSecond);
  }
  /* 路線は3行ずつ、4秒ごとに次へ送る。どの組が出るかは時刻で決める。 */
  function showLines(second) {
    const rows = info.rows, pages = Math.ceil(rows.length / INFO.pageSize);
    if (!pages) return;
    const page = Math.floor(Math.max(0, second) / INFO.pageSeconds) % pages;
    if (page === info.page) return;
    const lines = opsBox.querySelector('.ops-lines'), first = info.page < 0; info.page = page;
    const cells = rows.slice(page * INFO.pageSize, (page + 1) * INFO.pageSize)
      .flatMap(([name, state, time]) => [span('', name), span('', state), span('', time ? hhmm.format(new Date(time)) + ' 発表' : '')]);
    lines.replaceChildren(...cells);
    /* 切り替わったことが分かるように、1行ずつ左から引き直す。 */
    if (!first) cells.forEach((cell, index) => cell.animate([
      { opacity: 0, clipPath: 'inset(0 100% 0 0)', transform: 'translateX(-14px)' },
      { opacity: 1, clipPath: 'inset(-20% 0 -20% 0)', transform: 'translateX(0)' }
    ], { duration: 520, delay: Math.floor(index / 3) * 110, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' }));
    if (pages < 2) return;
    const foot = document.createElement('div'), bar = document.createElement('i'), fill = document.createElement('i');
    foot.className = 'ops-foot'; bar.className = 'ops-bar'; bar.append(fill);
    foot.append(bar, span('ops-page', `${page + 1} / ${pages}`)); lines.append(foot);
    const total = INFO.pageSeconds * 1000;
    fill.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
      { duration: total, delay: -(Math.max(0, second) % INFO.pageSeconds) * 1000, easing: 'linear', fill: 'both' });
  }
  function showInfo() {
    const now = Date.now();
    renderOps(now - info.opsAt <= INFO.stale ? info.ops : null);
    if (window.renderWeather) window.renderWeather(weatherBox, now - info.weatherAt <= INFO.stale ? info.weather : null);
    root.querySelectorAll('.clock-info').forEach(box => box.classList.remove('is-waiting'));
  }
  const getJson = url => fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) }).then(response => { if (!response.ok) throw new Error('HTTP ' + response.status); return response.json(); });
  async function loadInfo() {
    const run = ++info.run, sample = infoSelect.value === 'sample';
    clearTimeout(info.timer);
    const catalog = base.slice(0, base.lastIndexOf('/'));
    const [ops, weather] = await Promise.allSettled(sample
      ? [getJson(catalog + '/severe-weather/data').then(data => data.delays), Promise.resolve(SAMPLE_WEATHER)]
      : [getJson('/transit/api/delays'), getJson('/transit/api/weather')]);
    if (run !== info.run) return;
    if (ops.status === 'fulfilled' && ops.value && ops.value.groups) { info.ops = ops.value.groups; info.opsAt = Date.now(); }
    if (weather.status === 'fulfilled' && weather.value) { info.weather = weather.value; info.weatherAt = Date.now(); }
    showInfo();
    info.timer = setTimeout(loadInfo, INFO.every);
  }
  infoSelect.addEventListener('change', () => { info.ops = info.weather = null; info.opsAt = info.weatherAt = 0; loadInfo(); });

  const resize = () => {
    scale = Math.min(stage.clientWidth / SPEC.W, stage.clientHeight / SPEC.H);
    const x = (stage.clientWidth - SPEC.W * scale) / 2, y = (stage.clientHeight - SPEC.H * scale) / 2;
    const transform = `translate(${x}px,${y}px) scale(${scale})`;
    canvas.style.transform = transform; overlay.style.transform = transform;
  };
  new ResizeObserver(resize).observe(stage);
  root.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
    if (!ready) return;
    if (button.dataset.action === 'restart') start();
    if (button.dataset.action === 'fullscreen') (document.fullscreenElement ? document.exitFullscreen() : stage.requestFullscreen()).catch(() => {});
  }));
  root.clock = {
    /* 確認用: 読み込んでからの秒数と時刻（ミリ秒）を指定して1コマだけ描く。 */
    renderAt(t, now) { if (!ready) return; cancelAnimationFrame(raf); frozen = true; offset = 0; shownSecond = -1; render(t, now); },
    start, get ready() { return ready; }, get camera() { return { ...cam }; },
    showInfo(ops, weather) { clearTimeout(info.timer); info.run++; info.ops = ops; info.weather = weather; info.opsAt = info.weatherAt = Date.now(); showInfo(); }
  };

  const base = location.pathname.replace(/\/$/, '');
  const loadMap = fetch(base + '/map.json').then(response => {
    if (!response.ok) throw new Error('地図を読み込めませんでした');
    return response.json();
  }).then(map => { world = prepare(map); });
  /* Google Fonts に届かない環境でも代替フォントで動かす。待つのは4秒まで。 */
  const fontsReady = Promise.race([
    Promise.all([
      document.fonts.load('300 320px "Zen Kaku Gothic New"', '0123456789:'),
      document.fonts.load('400 36px "Zen Kaku Gothic New"', '同志社香里園月火水木金土日'),
      document.fonts.load('400 18px "Noto Sans JP"', '京阪本線列車遅延運転見合わせ発表'),
      document.fonts.load('500 18px "Noto Sans JP"', '列車遅延運転見合わせ部分運休'),
      document.fonts.load('300 14px "IBM Plex Mono"', 'NE0123456789.°′″ ALTPITCHDGkm')
    ]),
    new Promise(resolve => setTimeout(resolve, 4000))
  ]).then(() => document.fonts.ready);
  Promise.all([fontsReady, loadMap]).then(() => {
    ready = true; resize();
    root.querySelectorAll('button').forEach(button => button.disabled = false);
    status.textContent = '';
    start(); syncTime(); setInterval(syncTime, 5 * 60 * 1000);
    const weatherScript = document.createElement('script');
    weatherScript.src = base + '/weather.js'; weatherScript.onload = weatherScript.onerror = loadInfo;
    document.body.append(weatherScript);
  }).catch(error => {
    status.textContent = error.message + '。再読み込みしてください。'; status.setAttribute('role', 'alert');
  });
})();
