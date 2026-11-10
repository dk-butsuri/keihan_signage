const {chromium} = require('playwright');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

(async () => {
    const url = process.env.SIGNAGE_DEMO_URL || 'http://127.0.0.1:8880/demo';
    const out = process.env.SIGNAGE_SCREENSHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'signage-demo-'));
    const browser = await chromium.launch();
    const page = await browser.newPage({viewport: {width:1920, height:1080}});
    const errors = [], liveRequests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', request => {
        const parsed = new URL(request.url());
        if (/\/(?:api|transit\/api)\//.test(parsed.pathname)) liveRequests.push(request.url());
    });
    await page.clock.install();
    await page.goto(url);
    if (/\/demo\/?$/.test(new URL(page.url()).pathname)) {
        await page.getByRole('link', {name:/停電時の運行記録/}).click();
    }
    await page.getByRole('button', {name:'記録の再生を一時停止', exact:true}).waitFor();
    await page.evaluate(() => document.fonts.ready);
    const seekBox=await page.getByRole('slider',{name:'再生位置',exact:true}).boundingBox();
    assert.ok(seekBox.width > 1400 && seekBox.height >= 32, JSON.stringify(seekBox));
    assert.equal(await page.getByRole('combobox',{name:'デモ選択',exact:true}).inputValue(),'power-outage');
    const replay = await page.evaluate(async () => (await fetch(location.pathname.replace(/\/$/, '') + '/data')).json());
    const startClock = new Intl.DateTimeFormat('ja-JP', {timeZone:'Asia/Tokyo', hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).format(new Date(replay.start * 1000));
    await page.getByRole('button', {name:'記録の再生を一時停止', exact:true}).click();
    const clock = () => page.locator('#clock-time').textContent();
    const initialClock = await clock();
    await page.clock.runFor(5000);
    assert.equal(await clock(), initialClock);
    assert.ok((await page.locator('#demo-controls').textContent()).includes(replay.recorded_date.replaceAll('-', '.') + 'の実記録'));
    assert.match(await page.locator('#normal-bus-list').textContent(), /記録にはバス情報がありません/);
    await page.screenshot({path: out + '/demo-normal.png'});
    const layouts = [];
    for (const frame of replay.frames) {
        await page.getByRole('slider', {name:'再生位置', exact:true}).evaluate((element, value) => {
            element.value = String(value);
            element.dispatchEvent(new Event('input', {bubbles:true}));
        }, frame.ts - replay.start);
        const shape = await page.evaluate(() => {
            const bottom = document.getElementById('screen').getBoundingClientRect().bottom;
            const visible = document.getElementById('suspended');
            const overlap = visible.hidden ? [] : ['up', 'down'].map(direction => {
                const section = document.getElementById('suspended-' + direction);
                return section.querySelector('[data-field="state"]').getBoundingClientRect().bottom - section.querySelector('.next-list').getBoundingClientRect().top;
            });
            const clipped = [...document.querySelectorAll('#normal-up-list > div, #normal-down-list > div, .next-list > div')]
                .filter(e => e.getClientRects().length && e.getBoundingClientRect().bottom > bottom + 1)
                .map(e => e.textContent);
            const labels=visible.hidden?[]:[...document.querySelectorAll('.line-label')];
            const mapOverlaps=labels.flatMap((a,i)=>labels.slice(i+1).filter(b=>{
                const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();
                return x.left<y.right && y.left<x.right && x.top<y.bottom && y.top<x.bottom;
            }).map(b=>[a.textContent,b.textContent]));
            const textOverflow=labels.filter(label=>[...label.children].some(child=>child.scrollWidth>label.clientWidth+1)).map(label=>label.textContent);
            const rows=new Map(), alignmentErrors=[];
            for(const label of labels) {
                const key=label.dataset.direction+':'+label.dataset.lane, top=parseFloat(label.style.top), height=parseFloat(label.style.height);
                if(rows.has(key) && Math.abs(rows.get(key)-top)>.01)alignmentErrors.push(label.textContent);
                rows.set(key,top);
                const gap=label.dataset.direction==='up'?Number(label.dataset.anchorY)-top-height:top-Number(label.dataset.anchorY);
                if(gap<32)alignmentErrors.push(label.textContent);
            }
            const markers=visible.hidden?[]:[...document.querySelectorAll('#line-map polygon[data-position]')];
            const markerErrors=markers.filter(marker=>{
                const direction=marker.dataset.direction,position=Number(marker.dataset.position),sign=direction==='up'?1:-1;
                const first=lineData.stations[0].number,last=lineData.stations.at(-1).number,ratio=.35;
                const ranges=(lineData.compress_ranges||[]).filter(r=>Array.isArray(r)&&r.length===2&&r.every(Number.isFinite)&&r[0]>=first&&r[1]<=last&&r[1]>r[0]);
                const span=(last-first)-ranges.reduce((sum,[a,b])=>sum+(b-a)*(1-ratio),0);
                const effective=p=>p-first-ranges.reduce((sum,[a,b])=>sum+Math.min(Math.max(p,a),b)-a,0)*(1-ratio);
                const expected=150+effective(position)/span*(document.getElementById('line-map').clientWidth-210);
                const actual=Number(/^translate\(([^,]+)/.exec(marker.getAttribute('transform'))[1])+sign*6;
                const count=lineData.trains.filter(t=>t.direction===direction&&t.position===position).length;
                return Math.abs(expected-actual)>.01 || count!==Number(marker.dataset.count);
            }).map(marker=>marker.outerHTML);
            const lostMarkers=!visible.hidden && markers.reduce((n,m)=>n+Number(m.dataset.count),0)!==lineData.trains.length;
            return {overlap, clipped, mapOverlaps, textOverflow, alignmentErrors, markerErrors, lostMarkers};
        });
        layouts.push(shape);
    }
    assert.ok(layouts.every(s => s.clipped.length === 0), JSON.stringify(layouts.filter(s => s.clipped.length).slice(0,2)));
    assert.ok(layouts.every(s => s.overlap.every(x => x <= 0)), JSON.stringify(layouts.filter(s => s.overlap.some(x => x > 0))));
    assert.ok(layouts.every(s => s.mapOverlaps.length===0 && s.textOverflow.length===0), JSON.stringify(layouts.filter(s=>s.mapOverlaps.length||s.textOverflow.length).slice(0,2)));
    assert.ok(layouts.every(s=>s.alignmentErrors.length===0), JSON.stringify(layouts.filter(s=>s.alignmentErrors.length).slice(0,2)));
    assert.ok(layouts.every(s=>!s.lostMarkers && s.markerErrors.length===0), JSON.stringify(layouts.filter(s=>s.lostMarkers||s.markerErrors.length).slice(0,2)));
    const suspendedFrame = replay.frames.find(frame => frame.line.suspended);
    for (const [time, expected] of [['2026-10-30T19:47:24+09:00', '止まっています'], ['2026-10-30T19:55:26+09:00', '多くの列車が止まっています']]) {
        const frame = replay.frames.find(frame => frame.ts === Date.parse(time) / 1000);
        assert.ok(frame, time);
        await page.getByRole('slider', {name:'再生位置', exact:true}).evaluate((element, value) => {
            element.value = String(value);
            element.dispatchEvent(new Event('input', {bubbles:true}));
        }, frame.ts - replay.start);
        assert.equal(await page.locator('#suspended-down [data-field="state"]').textContent(), expected, time);
        if (frame.line.directions.down.state === 'many_stopped') await page.screenshot({path: out + '/demo-many-stopped.png'});
    }
    await page.getByRole('slider', {name:'再生位置', exact:true}).evaluate((element, value) => {
        element.value = String(value);
        element.dispatchEvent(new Event('input', {bubbles:true}));
    }, suspendedFrame.ts - replay.start);
    await page.locator('#suspended').waitFor({state:'visible'});
    const stoppedLabels = await page.locator('.line-stopped').allTextContents();
    assert.ok(stoppedLabels.every(text => !/停止[0-4]分/.test(text)), stoppedLabels.join(','));
    await page.screenshot({path: out + '/demo-suspended.png'});
    await page.getByRole('button', {name:'最初から', exact:true}).click();
    assert.equal(await clock(), startClock);
    await page.getByRole('combobox', {name:'再生速度', exact:true}).selectOption('60');
    await page.getByRole('button', {name:'記録を再生', exact:true}).click();
    await page.clock.runFor(10000);
    assert.notEqual(await clock(), initialClock);
    const elapsed = Number(await page.getByRole('slider', {name:'再生位置', exact:true}).inputValue());
    assert.ok(elapsed >= 580 && elapsed <= 620, '60倍速で10秒再生: ' + elapsed);
    await page.getByRole('slider', {name:'再生位置', exact:true}).evaluate(element => {
        element.value = element.max; element.dispatchEvent(new Event('input', {bubbles:true}));
    });
    await page.clock.runFor(1000);
    await page.getByRole('button', {name:'記録を再生', exact:true}).waitFor();
    assert.deepEqual(liveRequests, []);
    assert.deepEqual(errors, []);
    console.log('Demo: real snapshots, pause/speed/seek/reset/end, all frame layouts and no live API requests passed');
    console.log('Screenshots: ' + out);
    await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
