const {chromium} = require('playwright');
const assert = require('assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
(async () => {
  const base = (process.env.SIGNAGE_URL || 'http://127.0.0.1:18747/').replace(/\/?$/, '/');
  const out = process.env.SIGNAGE_SCREENSHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'signage-hourly-'));
  const browser = await chromium.launch();
  const errors = [];
  // 列車の少ない時間帯でも同じ画面で試せるよう、通常運転の想定データを返す。
  const sample = await (await fetch(base + 'demo/normal/data')).json();
  async function stub(page) {
    await page.route('**/api/time', route => route.fulfill({status: 503, body: ''}));
    for (const name of ['trains', 'line', 'buses', 'delays'])
      await page.route(`**/api/${name}`, route => route.fulfill({json: sample[name]}));
  }
  async function open(viewport, time) {
    const page = await browser.newPage({viewport});
    page.on('pageerror', e => errors.push(e.message));
    // 時刻合わせは偽の時計をずらすので止める。
    await stub(page);
    await page.clock.install({time: new Date(time)});
    await page.goto(base);
    // 偽の時計は進めないとタイマーが動かないので、少しずつ進めながら起動演出の終わりを待つ。
    for (let i = 0; ; i++) {
      const ok = await page.evaluate(() => !!document.querySelector('#normal-up-list .train-kind') && !!window.signageChime
        && !['pending', 'running'].includes(document.documentElement.dataset.assembly));
      if (ok) break;
      if (i > 60) throw new Error('the board did not become ready');
      await page.clock.runFor(100); await page.waitForTimeout(100);
    }
    await page.clock.setSystemTime(new Date(time));
    return page;
  }
  const state = page => page.evaluate(() => ({
    chime: document.documentElement.dataset.chime || '', overlay: !!document.querySelector('.signage-chime'),
    time: document.querySelector('.signage-chime .chime-time')?.textContent || '',
    seconds: document.querySelector('.signage-chime .chime-seconds')?.textContent || '',
    edges: document.querySelectorAll('[data-chime-helper]').length,
    border: document.querySelector('#screen header').style.borderBottomColor,
    name: document.getElementById('station-name').style.transform,
    animations: document.getAnimations().filter(a => a.effect?.target?.closest?.('#screen') && a.id !== 'screen-assembly' && a.playState === 'paused').length,
    cardOpacity: getComputedStyle(document.querySelector('#normal-up-list > *')).opacity
  }));

  const page = await open({width: 1920, height: 1080}, '2026-11-15T14:59:30+09:00');
  await page.clock.runFor(18000);     // 14:59:48
  const before = await state(page);
  assert.equal(before.chime, '', 'nothing before ten seconds to the hour');
  await page.clock.runFor(3000);      // 14:59:51
  let s = await state(page);
  assert.equal(s.chime, 'running'); assert.ok(s.overlay); assert.ok(s.edges > 0);
  await page.screenshot({path: out + '/hourly-leave.png'});
  await page.clock.runFor(5500);      // 14:59:56.5
  s = await state(page);
  assert.equal(s.time, '14:59'); assert.equal(s.seconds, ':56'); assert.equal(s.cardOpacity, '0');
  // 演出中に発車案内が描き直されても、組み上げが付け直されて札は隠れたまま。
  await page.evaluate(() => render());
  await page.clock.runFor(100);
  s = await state(page); assert.equal(s.cardOpacity, '0'); assert.ok(s.edges > 0);
  await page.screenshot({path: out + '/hourly-59.png'});
  await page.clock.runFor(3500);      // 15:00:00.1
  s = await state(page); assert.equal(s.time, '15:00'); assert.equal(s.seconds, ':00');
  await page.clock.runFor(300);
  await page.screenshot({path: out + '/hourly-00.png'});
  await page.clock.runFor(6000);      // 15:00:06.4 終わっている
  s = await state(page);
  assert.equal(s.chime, ''); assert.equal(s.overlay, false); assert.equal(s.edges, 0);
  assert.equal(s.border, before.border); assert.equal(s.name, before.name); assert.equal(s.animations, 0); assert.equal(s.cardOpacity, '1');
  assert.equal(await page.locator('#clock-time').textContent(), '15:00');
  await page.screenshot({path: out + '/hourly-after.png'});
  // 次の正時も流れる。
  await page.clock.runFor(3600000 - 6400 - 9000);
  assert.equal((await state(page)).chime, 'running', 'the next hour plays again');
  await page.close();

  // 見合わせの画面に切り替わったら、その場で発車案内側に戻す。
  const p2 = await open({width: 1920, height: 1200}, '2026-11-15T15:59:40+09:00');
  await p2.clock.runFor(14000);       // 15:59:54
  assert.equal((await state(p2)).chime, 'running');
  await p2.screenshot({path: out + '/hourly-1610.png'});
  await p2.evaluate(() => { document.getElementById('normal').hidden = true; document.getElementById('suspended').hidden = false; });
  await p2.clock.runFor(100);
  s = await state(p2); assert.equal(s.chime, ''); assert.equal(s.overlay, false); assert.equal(s.edges, 0);
  await p2.close();

  // 演出OFF・動きを減らす設定では流さない。
  for (const [url, reduced] of [['?motion=off', false], ['', true]]) {
    const p = await browser.newPage({viewport: {width: 1920, height: 1080}, reducedMotion: reduced ? 'reduce' : 'no-preference'});
    await stub(p);
    await p.clock.install({time: new Date('2026-11-15T16:59:45+09:00')});
    await p.goto(base + url); await p.clock.runFor(8000);
    assert.equal((await state(p)).overlay, false, `no chime with ${url || 'reduced motion'}`);
    await p.close();
  }
  assert.deepEqual(errors, []);
  await browser.close();
  console.log('hourly chime ok', out);
})().catch(error => { console.error(error); process.exit(1); });
