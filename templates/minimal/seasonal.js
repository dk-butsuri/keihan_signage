// 季節の装飾の読み込み役。どの装飾を出すかは端末（controller）が決めて知らせてくる。
// 装飾は #screen の中の2枚の層（文字の後ろ・文字の前）にだけ描き、案内そのものには触れない。
// 見合わせ時の画面と警報（レベル3以上）のあいだ、起動の組み上げと時報のあいだは層ごと隠す。
// 装飾の作り方・決まりごとは docs/DEVELOPMENT.md の「季節の装飾」。
(() => {
  const root = document.documentElement;
  const base = new URL('seasons/', document.currentScript.src).href;
  const params = new URLSearchParams(location.search);
  const motion = params.get('motion') !== 'off' && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const themes = {};
  let wanted = '', link = null, layers = [], cleanup = null;

  // 装飾を見せてよいときだけ html に data-season-visible を付ける。装飾の CSS（カードの色など）はこの印だけを見る
  const style = document.createElement('style');
  style.textContent = '.season-layer{position:absolute;inset:0;pointer-events:none;overflow:hidden;transition:opacity .8s;opacity:0}'
    + '.season-back{z-index:-1}.season-front{z-index:40}'
    + 'html[data-season-visible] .season-layer{opacity:1}';
  document.head.append(style);

  function updateVisible() {
    const visible = !!wanted && !('seasonQuiet' in root.dataset)
      && !['pending', 'running'].includes(root.dataset.assembly) && root.dataset.chime !== 'running';
    if (visible) root.dataset.seasonVisible = ''; else delete root.dataset.seasonVisible;
  }
  new MutationObserver(updateVisible)
    .observe(root, { attributes: true, attributeFilter: ['data-season-quiet', 'data-assembly', 'data-chime'] });

  const hidden = () => document.hidden || !('seasonVisible' in root.dataset);

  function start() {
    const screen = document.getElementById('screen');
    if (!screen || cleanup || !themes[wanted]) return;
    const back = document.createElement('div'), front = document.createElement('div');
    back.className = 'season-layer season-back'; front.className = 'season-layer season-front';
    back.setAttribute('aria-hidden', 'true'); front.setAttribute('aria-hidden', 'true');
    screen.prepend(back); screen.append(front);
    layers = [back, front];
    try { cleanup = themes[wanted]({ screen, back, front, motion, hidden }) || (() => {}); }
    catch (error) { cleanup = () => {}; }
  }

  function stop() {
    try { if (cleanup) cleanup(); } catch (error) {}
    cleanup = null;
    for (const layer of layers) layer.remove();
    layers = [];
    if (link) link.remove();
    link = null;
    delete root.dataset.season;
    delete root.dataset.seasonVisible;
  }

  function apply(id) {
    id = /^[a-z0-9-]+$/.test(id || '') && id !== 'off' ? id : '';
    if (id === wanted) return;
    stop();
    wanted = id;
    if (!id) return;
    root.dataset.season = id;
    updateVisible();
    link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = base + id + '/theme.css';
    document.head.append(link);
    if (themes[id]) return start();
    const script = document.createElement('script');
    script.src = base + id + '/theme.js';
    document.head.append(script);
  }

  window.signageSeason = {
    define(id, mount) { themes[id] = mount; if (id === wanted) start(); },
    apply
  };

  setInterval(() => {
    const suspended = document.getElementById('suspended'), weather = document.getElementById('weather');
    const quiet = (suspended && !suspended.hidden)
      || (weather && !weather.hidden && !!weather.querySelector('.wx-chip.l3,.wx-chip.l4,.wx-chip.l5'));
    if (quiet) root.dataset.seasonQuiet = ''; else delete root.dataset.seasonQuiet;
  }, 1000);

  // ?season=christmas で期間の外でも確かめられる（?season=off で出さない）。デモのページはこの指定だけを見る
  if (params.has('season')) return apply(params.get('season'));
  if (typeof config !== 'undefined' && config.demo) return;

  let answered = false;
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== window.parent) return;
    if (event.data && event.data.type === 'signage:season') { answered = true; apply(event.data.season); }
  });
  if (window.parent !== window) window.parent.postMessage({ type: 'signage:season-request' }, location.origin);
  // 端末の器の外で開いたとき（管理画面の縮小表示など）は返事が来ないので、自分で聞きに行く
  async function ask() {
    if (answered) return;
    try {
      const response = await fetch('/api/mode', { cache: 'no-store' });
      if (response.ok && !answered) apply((await response.json()).season);
    } catch (error) {}
    setTimeout(ask, 60000);
  }
  setTimeout(ask, 3000);
})();
