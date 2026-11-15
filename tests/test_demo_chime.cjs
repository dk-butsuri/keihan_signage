const {chromium} = require('playwright');
const assert = require('assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
(async () => {
  const base = (process.env.SIGNAGE_DEMO_URL || 'http://127.0.0.1:18747/demo').replace(/\/$/, '');
  const out = process.env.SIGNAGE_SCREENSHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'signage-chime-'));
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width: 1920, height: 1080}});
  const errors = [], live = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => {if (/\/(api|transit\/api)\//.test(new URL(r.url()).pathname)) live.push(r.url());});
  await page.clock.install();
  await page.goto(base);
  await page.locator('[data-demo-id="hourly-honsen"]').click();
  await page.waitForURL(base + '/hourly-honsen');
  await page.waitForFunction(() => document.getElementById('chime-demo').chime?.ready);
  const api = 'document.getElementById("chime-demo").chime';
  assert.equal(await page.evaluate(`${api}.playing`), false);
  const seek = f => page.evaluate(f => document.getElementById('chime-demo').chime.seek(f), f);
  const text = selector => page.locator(selector).evaluate(n => n.textContent);
  const board = page.frameLocator('.chime-board');
  const rail = () => page.locator('.chime-rail').evaluate(canvas => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let lit = 0; for (let i = 3; i < data.length; i += 4) if (data[i] > 0) lit++;
    return lit;
  });
  const opacity = locator => locator.evaluate(n => Number(getComputedStyle(n).opacity));

  // 始まりは通常の発車案内そのもので、時報の文字はまだ出ていない。
  await seek(0);
  assert.equal(await opacity(board.locator('#normal-delays .operation-group').first()), 1);
  assert.equal(await board.locator('#clock-time').textContent(), '14:59');
  assert.equal(await board.locator('#clock-seconds').textContent(), ':50');
  assert.ok((await page.locator('.chime-time .chime-ch').evaluateAll(n => n.map(x => Number(x.style.opacity)))).every(v => v === 0));

  // 離れる：組み上げを逆にたどり、運行情報の欄が先に消える。
  await seek(30);
  assert.ok(await opacity(board.locator('#normal-delays .operation-group').first()) < 1);
  assert.equal(await opacity(board.locator('#normal-up-list > *').first()), 1);
  await seek(150);
  assert.equal(await opacity(board.locator('#normal-up-list > *').first()), 0);
  assert.ok(await rail() > 1000, 'the header rule opens back into the line');

  // 特急の光が通った後、時報の時刻が左から現れる。
  await seek(140);
  assert.match(await page.locator('[data-phase]').textContent(), /往来/);
  const early = await page.locator('.chime-time .chime-ch').evaluateAll(n => n.map(x => Number(x.style.opacity)));
  await seek(240);
  assert.equal(await text('.chime-time'), '14:59'); assert.equal(await text('.chime-seconds'), ':54');
  assert.ok((await page.locator('.chime-time .chime-ch').evaluateAll(n => n.map(x => Number(x.style.opacity)))).every(v => v > .99));
  assert.ok(early[0] > early.at(-1), 'the passing light reveals the clock from the left');
  await page.screenshot({path: out + '/chime-traffic.png'});

  // 秒読み：秒の境目ちょうどで数字が変わり、区間は縮む。
  for (const second of [3, 5, 9]) {
    await seek(second * 60 - 1); assert.equal(await text('.chime-seconds'), `:${50 + second - 1}`);
    await seek(second * 60); assert.equal(await text('.chime-seconds'), `:${50 + second}`);
    assert.match(await page.locator('[data-phase]').textContent(), new RegExp(`あと${10 - second}秒`));
  }
  await seek(599);
  assert.equal(await text('.chime-time'), '14:59'); assert.equal(await text('.chime-seconds'), ':59');
  const before = await rail();
  await page.screenshot({path: out + '/chime-59.png'});

  // 正時：00秒のフレームで時刻が切り替わり、光が線を走る。
  await seek(600);
  assert.equal(await text('.chime-time'), '15:00'); assert.equal(await text('.chime-seconds'), ':00');
  assert.match(await page.locator('[data-phase]').textContent(), /正時/);
  await seek(612);
  assert.ok(await rail() > before, 'the arrival lights up the line');
  await page.screenshot({path: out + '/chime-on-hour.png'});

  // 0時は日付も切り替わる。
  await page.selectOption('#chime-hour', '0');
  await seek(599); assert.match(await text('.chime-date'), /11月13日 金曜日/); assert.equal(await text('.chime-time'), '23:59');
  await seek(600); assert.match(await text('.chime-date'), /11月14日 土曜日/); assert.equal(await text('.chime-time'), '00:00');
  await page.selectOption('#chime-hour', '15');

  // 寄る・組み上げ：最後は通常の発車案内に戻り、時刻は正時を過ぎている。
  await seek(929);
  assert.equal(await page.locator('[data-phase]').textContent(), '発車案内');
  assert.equal(await opacity(board.locator('#normal-delays .operation-group').last()), 1);
  assert.equal(await board.locator('#clock-time').textContent(), '15:00');
  assert.equal(await board.locator('#clock-seconds').textContent(), ':05');
  assert.ok((await page.locator('.chime-time .chime-ch').evaluateAll(n => n.map(x => Number(x.style.opacity)))).every(v => v === 0));
  await page.screenshot({path: out + '/chime-end.png'});

  // 再生・一時停止・コマ送り。
  await page.getByRole('button', {name: '正時の直前から'}).click();
  await page.clock.runFor(1000);
  assert.equal(await page.evaluate(`${api}.playing`), true);
  await page.getByRole('button', {name: '一時停止'}).click();
  const frame = await page.evaluate(`${api}.frame`);
  await page.getByRole('button', {name: '1フレーム進む'}).click();
  assert.equal(await page.evaluate(`${api}.frame`), frame + 1);

  // 狭い画面でも横にはみ出さない。
  await page.setViewportSize({width: 390, height: 844});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  // わくわく版：光が通るたびに輪へ色がたまり、秒の数字は跳ねながら大きくなって、00秒で戻る。
  await page.setViewportSize({width: 1920, height: 1080});
  await page.goto(base + '/hourly-honsen-hype');
  await page.waitForFunction(() => document.getElementById('chime-demo').chime?.ready);
  assert.equal(await page.locator('#chime-demo').getAttribute('data-variant'), 'hype');
  const secondsHeight = () => page.locator('.chime-seconds').evaluate(n => n.getBoundingClientRect().height);
  const secondsTop = () => page.locator('.chime-seconds').evaluate(n => n.getBoundingClientRect().top);
  await seek(125); const calm = await secondsHeight();
  await seek(590); const excited = await secondsHeight();
  assert.ok(excited > calm * 1.2, 'the seconds grow toward the hour');
  await seek(540); const rest = await secondsTop();
  await seek(548); assert.ok(Math.abs(await secondsTop() - rest) < 3, 'the seconds grow in place without hopping');
  const [r, g, b] = (await page.locator('.chime-seconds').evaluate(n => getComputedStyle(n).color)).match(/\d+/g).map(Number);
  assert.ok(Math.max(r, g, b) - Math.min(r, g, b) < 8 && r > 200, 'the seconds stay bright white, not alarming red');
  const colorful = () => page.locator('.chime-rail').evaluate(canvas => {
    const ctx = canvas.getContext('2d'), d = ctx.getImageData(700, 560, 240, 100).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 60 && d[i + 3] > 80) n++;
    return n;
  });
  await seek(330); const fewColors = await colorful();
  await seek(595); assert.ok(await colorful() > fewColors, 'colours gather around the station');
  await page.screenshot({path: out + '/chime-hype-59.png'});
  await seek(600); assert.equal(await text('.chime-time'), '15:00'); assert.equal(await text('.chime-seconds'), ':00');
  await seek(630); await page.screenshot({path: out + '/chime-hype-burst.png'});
  await seek(660); assert.ok(Math.abs(await secondsHeight() - calm) < 2, 'the clock settles after 00');
  await seek(929); assert.equal(await page.locator('[data-phase]').textContent(), '発車案内');

  assert.deepEqual(errors, []); assert.deepEqual(live, []);
  await browser.close();
  console.log('chime demo ok', out);
})().catch(error => { console.error(error); process.exit(1); });
