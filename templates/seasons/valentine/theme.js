// バレンタイン: 見出しの空いたところに、金の紙カップに入ったボンボンショコラを箱のように並べ、金の欧文の札を添える。
// カードはココア色の地と金の細線。ときどき、並んだショコラの上を光が左から右へ流れる。
window.signageSeason.define('valentine', ({ screen, back, front, motion, hidden }) => {
  const NS = 'http://www.w3.org/2000/svg';
  const SHEEN_FIRST = 6, SHEEN_EVERY = 40, SHEEN_SECONDS = 2.4, STEP = 70;

  const glow = document.createElement('div');
  glow.className = 'vl-bg';
  back.append(glow);

  const box = document.createElement('div');
  box.className = 'vl-box';
  const cup = '<path class="vl-cup" d="M-21 4 L21 4 L17 21 Q0 25 -17 21Z"/>'
    + '<path class="vl-pleat" d="M-15 6l2 15M-8 6l1 17M0 6v18M8 6l-1 17M15 6l-2 15"/>';
  const gloss = (x, y, rx, ry) => `<ellipse class="vl-gloss" cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" transform="rotate(-25 ${x} ${y})"/>`;
  const heart = 'M0 14C-4 10-18 2-18-7C-18-14-11-17-6-15C-3-14-1-12 0-10C1-12 3-14 6-15C11-17 18-14 18-7C18 2 4 10 0 14Z';
  const pieces = [
    // ルビーのハート
    `${cup}<path d="${heart}" fill="url(#vl-ruby)"/>${gloss(-7, -8, 5, 2.6)}`,
    // ココアをまぶしたトリュフ
    `${cup}<circle r="17" fill="url(#vl-truffle)"/><circle r="17" fill="url(#vl-dust)" opacity=".55"/>${gloss(-6, -8, 5, 2.2)}`,
    // 金箔をのせた四角いガナッシュ
    `${cup}<rect x="-16" y="-15" width="32" height="30" rx="4" fill="url(#vl-dark)"/>`
      + '<path class="vl-leaf" d="M-3-4l5-3 4 2-1 5-6 1z"/><path class="vl-leaf" d="M4 2l3 1-1 3-3-1z"/>' + gloss(-8, -9, 6, 1.8),
    // ホワイトの斜めの線がけ
    `${cup}<circle r="17" fill="url(#vl-milk)"/><path class="vl-drizzle" d="M-12-6L4-13M-15 1L10-10M-13 8L13-3M-6 12L14 4"/>${gloss(-6, -9, 5, 2.2)}`,
    // 金箔をのせたダークのハート
    `${cup}<path d="${heart}" fill="url(#vl-dark)"/><path class="vl-leaf" d="M7-10l3-2 2 2-2 3-3-1z"/>${gloss(-7, -8, 5, 2.6)}`
  ];
  // 光はショコラとカップの形の中だけに流す（clipPath の中には g を置けないので、形ごとに位置を付ける）
  const outline = '<path d="M-21 4 L21 4 L17 21 Q0 25 -17 21Z"/>';
  const silhouette = [`<path d="${heart}"/>`, '<circle r="17"/>', '<rect x="-16" y="-15" width="32" height="30" rx="4"/>', '<circle r="17"/>', `<path d="${heart}"/>`]
    .map(shape => outline + shape);
  box.innerHTML = `<svg class="vl-svg" width="${STEP * pieces.length}" height="76" viewBox="0 -30 ${STEP * pieces.length} 76">`
    + '<defs>'
    + '<radialGradient id="vl-ruby" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#C0455A"/><stop offset=".6" stop-color="#7E1C30"/><stop offset="1" stop-color="#4A0F1C"/></radialGradient>'
    + '<radialGradient id="vl-truffle" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#6A4330"/><stop offset=".7" stop-color="#3A2219"/><stop offset="1" stop-color="#22130D"/></radialGradient>'
    + '<pattern id="vl-dust" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill="#8C6248"/><circle cx="3.5" cy="3" r=".6" fill="#7A5038"/></pattern>'
    + '<linearGradient id="vl-dark" x1="0" y1="0" x2=".6" y2="1"><stop offset="0" stop-color="#4E3024"/><stop offset=".55" stop-color="#2A1812"/><stop offset="1" stop-color="#1A0E0A"/></linearGradient>'
    + '<radialGradient id="vl-milk" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#9A6A4A"/><stop offset=".7" stop-color="#6B4430"/><stop offset="1" stop-color="#4A2D1F"/></radialGradient>'
    + '<linearGradient id="vl-sheen" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FFF6DF" stop-opacity="0"/><stop offset=".5" stop-color="#FFF6DF" stop-opacity=".32"/><stop offset="1" stop-color="#FFF6DF" stop-opacity="0"/></linearGradient>'
    + '<clipPath id="vl-clip">' + silhouette.map((shapes, i) => shapes.replaceAll('/>', ` transform="translate(${STEP * i + STEP / 2} 0) scale(1.25)"/>`)).join('') + '</clipPath>'
    + '</defs>'
    + pieces.map((p, i) => `<g transform="translate(${STEP * i + STEP / 2} 0) scale(1.25)">${p}</g>`).join('')
    + '<rect class="vl-sheen" clip-path="url(#vl-clip)" x="-60" y="-30" width="60" height="76" fill="url(#vl-sheen)"/>'
    + '</svg>'
    + "<div class=\"vl-label\"><b>Saint Valentine's Day</b><span>FEBRUARY 14</span></div>";
  front.append(box);
  const sheen = box.querySelector('.vl-sheen');

  function place() {
    const header = screen.querySelector('header'), name = screen.querySelector('#station-name');
    if (!header || !name) { box.hidden = true; return; }
    box.hidden = false;
    const origin = screen.getBoundingClientRect(), scale = origin.width / screen.clientWidth || 1;
    const h = header.getBoundingClientRect(), n = name.getBoundingClientRect();
    box.style.left = `${(n.right - origin.left) / scale + 80}px`;
    box.style.top = `${(h.top - origin.top) / scale + h.height / scale / 2 - 34}px`;
  }
  const observer = new ResizeObserver(place);
  observer.observe(screen);
  const timer = setInterval(place, 5000);
  place();

  let frame = 0, started = 0, skip = false;
  function tick(now) {
    frame = requestAnimationFrame(tick);
    skip = !skip;
    if (skip || hidden()) return;
    started = started || now;
    const s = (now - started) / 1000, phase = ((s - SHEEN_FIRST) % SHEEN_EVERY + SHEEN_EVERY) % SHEEN_EVERY;
    const f = s >= SHEEN_FIRST && phase < SHEEN_SECONDS ? phase / SHEEN_SECONDS : -1;
    sheen.setAttribute('x', f < 0 ? -60 : -60 + (STEP * pieces.length + 60) * f);
  }
  if (motion) frame = requestAnimationFrame(tick);

  return () => { cancelAnimationFrame(frame); clearInterval(timer); observer.disconnect(); };
});
