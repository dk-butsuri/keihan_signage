const {chromium}=require('playwright');
const assert=require('assert/strict');
const fs=require('fs'),os=require('os'),path=require('path');
(async()=>{
    const root=(process.env.SIGNAGE_DEMO_URL||'http://127.0.0.1:18743/demo').replace(/\/$/,'');
    const out=process.env.SIGNAGE_SCREENSHOTS||fs.mkdtempSync(path.join(os.tmpdir(),'signage-patterns-'));
    const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[],live=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{if(/\/(api|transit\/api)\//.test(new URL(request.url()).pathname))live.push(request.url());});
    await page.goto(root);
    await page.getByRole('link',{name:/列車カードの全表示パターン/}).click();
    await page.locator('#pattern-gallery').waitFor({state:'visible'});await page.evaluate(()=>document.fonts.ready);
    assert.equal(await page.locator('#pattern-basic .pattern-case').count(),8);
    assert.equal(await page.locator('#pattern-basic .pattern-card > div').count(),16);
    assert.equal(await page.locator('#pattern-extra-cases .pattern-case').count(),4);
    assert.equal(await page.locator('.pattern-source').count(),0);
    assert.equal(await page.locator('#pattern-count').textContent(),'基本 16枚');
    assert.equal(await page.locator('[data-case-id="prediction-1-stop-1-delay-1"] .train-stop-badge').count(),0);
    assert.equal(await page.locator('[data-case-id="prediction-0-stop-1-delay-1"] .train-stop-badge').count(),2);
    await page.getByRole('combobox',{name:'表示の高さ',exact:true}).selectOption('compact');
    assert.equal(await page.locator('#pattern-basic .pattern-sample:visible').count(),8);
    assert.ok((await page.locator('#pattern-basic .pattern-sample:visible').evaluateAll(samples=>samples.every(sample=>sample.dataset.density==='compact'))));
    await page.getByRole('combobox',{name:'到着予測の有無',exact:true}).selectOption('no');
    assert.equal(await page.locator('#pattern-basic .pattern-case:visible').count(),4);
    assert.equal(await page.locator('#pattern-count').textContent(),'基本 4枚');
    await page.reload();await page.locator('#pattern-gallery').waitFor({state:'visible'});
    assert.equal(await page.getByRole('combobox',{name:'表示の高さ',exact:true}).inputValue(),'compact');
    assert.equal(await page.getByRole('combobox',{name:'到着予測の有無',exact:true}).inputValue(),'no');
    await page.getByRole('combobox',{name:'表示の高さ',exact:true}).selectOption('normal');
    assert.ok(await page.locator('#pattern-basic .pattern-sample:visible').evaluateAll(samples=>samples.every(sample=>sample.dataset.density==='normal')));
    await page.getByRole('combobox',{name:'表示の高さ',exact:true}).selectOption('both');
    await page.getByRole('combobox',{name:'到着予測の有無',exact:true}).selectOption('all');
    await page.locator('#pattern-extras summary').click();
    for(const [width,height] of [[1920,1080],[1280,800],[960,600],[375,812],[320,700]]) {
        await page.setViewportSize({width,height});await page.evaluate(()=>document.fonts.ready);
        const problems=await page.evaluate(()=>{
            const problems=[];
            if(document.documentElement.scrollWidth>innerWidth)problems.push('page overflow');
            for(const sample of document.querySelectorAll('.pattern-sample')) {
                if(!sample.getClientRects().length)continue;
                const row=sample.querySelector('.pattern-card > div'),r=row.getBoundingClientRect(),dest=row.querySelector('.departure-destination'),sub=row.querySelector('.departure-secondary');
                const d=dest.getBoundingClientRect(),status=row.querySelector('.departure-status'),s=status.getBoundingClientRect(),compact=sample.dataset.density==='compact';
                if(Math.abs(r.height-(compact?72:116))>.1)problems.push('height');
                if(dest.scrollWidth>dest.clientWidth+1||(!sub.hidden&&sub.scrollWidth>sub.clientWidth+1))problems.push('clipped destination/details: '+row.textContent);
                if(s.top<r.top-.1||s.bottom>r.bottom+.1||s.right>r.right+.1||d.right>s.left+.1)problems.push('status clipped/overlapping');
                const label=row.querySelector('.departure-time-label'),time=row.querySelector('.departure-time'),t=time.getBoundingClientRect();
                if(row.classList.contains('departure-revised')) {
                    const original=row.querySelector('.departure-original'),prediction=row.querySelector('.departure-prediction');
                    if(original.scrollWidth>original.clientWidth+1||prediction.scrollWidth>prediction.clientWidth+1)problems.push('original/estimated time clipped');
                }
                if(compact) {
                    const clock=row.querySelector('.departure-clock'),c=clock.getBoundingClientRect();
                    if(clock.scrollWidth>clock.clientWidth+1||c.right>d.left+.1)problems.push('clock clipped/overlapping');
                    if(!label.hidden) {
                        const baselines=[label,time].map(span=>{const probe=document.createElement('i');probe.style.cssText='display:inline-block;width:0;height:0;padding:0;margin:0;vertical-align:baseline';span.append(probe);const y=probe.getBoundingClientRect().top;probe.remove();return y;});
                        if(Math.abs(baselines[0]-baselines[1])>.1)problems.push('baseline');
                    }
                } else {
                    const first=row.classList.contains('departure-revised')?row.querySelector('.departure-original').getBoundingClientRect():label.hidden?t:label.getBoundingClientRect(),last=sub.hidden?t:sub.getBoundingClientRect();
                    if(Math.abs((first.top+last.bottom-r.top-r.bottom)/2)>.1)problems.push('normal time group alignment: '+sample.closest('.pattern-case').dataset.caseId);
                }
            }
            return problems;
        });
        assert.deepEqual(problems,[],`${width}x${height}`);
        await page.screenshot({path:out+`/demo-patterns-${width}.png`,fullPage:true});
    }
    assert.ok(await page.locator('[data-case-id="unknown-time"] .departure-time-label').evaluateAll(labels=>labels.every(label=>label.hidden)));
    assert.ok(await page.locator('[data-case-id="without-secondary"] .departure-secondary').evaluateAll(subs=>subs.every(sub=>sub.hidden)));
    await page.goto(root+'/display-patterns/');await page.locator('#pattern-gallery').waitFor({state:'visible'});
    await page.getByRole('combobox',{name:'デモ選択',exact:true}).selectOption('normal');
    await page.waitForURL(root+'/normal');await page.locator('#normal-up-list > div').first().waitFor();
    await page.getByRole('combobox',{name:'デモ選択',exact:true}).selectOption('display-patterns');
    await page.locator('#pattern-gallery').waitFor({state:'visible'});
    await page.route(root+'/display-patterns/data',route=>route.fulfill({status:503,body:'unavailable'}));
    await page.reload();await page.getByRole('button',{name:'再読み込み',exact:true}).waitFor();
    await page.unroute(root+'/display-patterns/data');await page.getByRole('button',{name:'再読み込み',exact:true}).click();
    await page.locator('#pattern-gallery').waitFor({state:'visible'});
    await page.getByRole('link',{name:'← デモ一覧',exact:true}).click();await page.waitForURL(root);
    assert.deepEqual(errors,[]);assert.deepEqual(live,[]);await browser.close();
    console.log('Pattern gallery: 16 basic cards, edge cases, filters/bookmarks, shared rendering/baselines, 320–1920px, demo navigation, retry and no live API passed');
})().catch(error=>{console.error(error);process.exit(1)});
