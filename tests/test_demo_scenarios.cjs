const {chromium}=require('playwright');
const assert=require('assert/strict');
const fs=require('fs');
const path=require('path');
const os=require('os');
(async()=>{
    const root=(process.env.SIGNAGE_DEMO_URL||'http://127.0.0.1:18741/demo').replace(/\/$/,'');
    const out=process.env.SIGNAGE_SCREENSHOTS||fs.mkdtempSync(path.join(os.tmpdir(),'signage-scenarios-'));
    const browser=await chromium.launch();
    const page=await browser.newPage({viewport:{width:1920,height:1080}});
    const errors=[],live=[];page.on('pageerror',e=>errors.push(e.message));
    page.on('request',r=>{if(/\/(api|transit\/api)\//.test(new URL(r.url()).pathname))live.push(r.url());});
    await page.clock.install();
    await page.goto(root+'/');
    assert.equal(await page.locator('[data-demo-id]').count(),7);
    assert.equal(await page.locator('a.card.recorded').count(),1);
    await page.evaluate(()=>document.fonts.ready);
    assert.ok(await page.locator('a.card').last().evaluate(e=>e.getBoundingClientRect().bottom<innerHeight), 'all scenarios should be visible on a desktop');
    await page.screenshot({path:out+'/demo-catalog.png'});
    await page.getByRole('link',{name:/荒天で広域に影響/}).click();
    const scenarios=['severe-weather','all-stopped','jr-loop','normal'];
    for(const id of scenarios) {
        if(id!==scenarios[0])await page.getByRole('combobox',{name:'デモ選択',exact:true}).selectOption(id);
        await page.waitForURL(root+'/'+id);
        await page.waitForFunction(id=>config.demo.id===id&&trainData!==null,id);
        await page.evaluate(()=>document.fonts.ready);
        assert.match(await page.locator('#demo-controls').textContent(),/架空の想定/);
        assert.equal(await page.getByRole('slider',{name:'再生位置',exact:true}).count(),0);
        assert.equal(await page.getByRole('combobox',{name:'再生速度',exact:true}).count(),0);
        assert.equal(await page.getByRole('button',{name:'記録の再生を一時停止',exact:true}).count(),0);
        const suspended=id==='severe-weather'||id==='all-stopped';
        assert.equal(await page.locator('#suspended').isVisible(),suspended);
        const before=await page.locator('#clock-time').textContent();
        await page.clock.runFor(6500);
        assert.equal(await page.locator('#clock-time').textContent(),before);
        if(id==='normal')assert.equal(await page.locator('#operation-slides').isVisible(),false);
        else {
            assert.equal(await page.locator('#operation-slides').isVisible(),true);
            assert.equal(await page.locator('#operation-viewport .operation-page').last().getAttribute('data-page'),'1');
        }
        if(id==='all-stopped') {
            assert.deepEqual(await page.locator('#suspended [data-field="state"]').allTextContents(),['止まっています','止まっています']);
            assert.ok(await page.evaluate(()=>lineData.stopped===lineData.total));
        }
        const layout=await page.evaluate(()=>{
            const box=el=>el.getBoundingClientRect(),screen=box($('screen')),dock=box($('demo-dock'));
            const mode=$('normal').hidden?'suspended':'normal';
            const columns=[...document.querySelectorAll('#'+mode+' .next-list > div,#'+mode+' .operation-group,#'+mode+'-bus-list > div')].filter(e=>e.getClientRects().length);
            const footer=$('operation-slides').hidden?screen.bottom:box($('operation-slides')).top;
            return {bottom:screen.bottom,dockTop:dock.top,dockBottom:dock.bottom,height:innerHeight,
                clipped:columns.filter(e=>box(e).bottom>footer+1).map(e=>e.textContent),
                sidebar:$(`${mode}-delay-list`).scrollHeight-$(`${mode}-delay-list`).clientHeight,
                pagination:$('operation-slides').hidden?0:box($('operation-pagination')).height};
        });
        assert.ok(layout.bottom<=layout.dockTop+1&&layout.dockBottom<=layout.height+1,JSON.stringify(layout));
        assert.deepEqual(layout.clipped,[],JSON.stringify(layout));assert.ok(layout.sidebar<=1,JSON.stringify(layout));assert.ok(layout.pagination<=80,JSON.stringify(layout));
        await page.screenshot({path:out+'/demo-'+id+'.png',animations:'disabled'});
    }
    await page.getByRole('link',{name:'← デモ一覧',exact:true}).click();
    await page.getByRole('link',{name:/停電時の運行記録/}).click();
    await page.getByRole('slider',{name:'再生位置',exact:true}).waitFor();
    const range=page.getByRole('slider',{name:'再生位置',exact:true});
    const box=await range.boundingBox();assert.ok(box.width>1400&&box.height>=32,JSON.stringify(box));
    await page.mouse.move(box.x+box.width*.75,box.y+box.height/2);await page.mouse.down();await page.clock.runFor(1000);
    const scrubbed=Number(await range.inputValue());await page.clock.runFor(2000);
    assert.equal(Number(await range.inputValue()),scrubbed,'time must remain stable while dragging');
    await page.mouse.up();await page.clock.runFor(1000);
    const resumed=Number(await range.inputValue());
    // 表示は200msごとなので、10倍速では更新の間に最大2秒ぶんの差が出る。
    assert.ok(resumed>=scrubbed+7&&resumed<=scrubbed+12,`playback must resume after dragging: ${scrubbed} -> ${resumed}`);
    await page.getByRole('button',{name:'記録の再生を一時停止',exact:true}).click();
    await page.getByRole('button',{name:'最初から',exact:true}).click();
    await range.focus();await range.press('ArrowRight');assert.equal(Number(await range.inputValue()),1);
    await range.press('End');assert.equal(await range.inputValue(),await range.getAttribute('max'));
    assert.match(await page.getByRole('status',{name:'記録時刻',exact:true}).textContent(),/翌/);
    await page.screenshot({path:out+'/demo-player-wide.png'});
    await page.setViewportSize({width:960,height:540});
    await page.waitForFunction(()=>document.getElementById('demo-seek').getBoundingClientRect().width>600);
    const narrow=await range.boundingBox();assert.ok(narrow.width>600&&narrow.height>=32,JSON.stringify(narrow));
    await page.screenshot({path:out+'/demo-player-960.png'});
    await page.setViewportSize({width:390,height:844});
    const mobile=await range.boundingBox();assert.ok(mobile.width>=100&&mobile.height>=32,JSON.stringify(mobile));
    await page.getByRole('link',{name:'← デモ一覧',exact:true}).click();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:out+'/demo-catalog-mobile.png',fullPage:true});
    assert.deepEqual(errors,[]);assert.deepEqual(live,[]);
    await browser.close();console.log('Demo selection: all scenarios, static clock/no timeline, carousel, bounded layout, wide slider/drag/keyboard/overnight/mobile and no live API passed');
})().catch(error=>{console.error(error);process.exit(1)});
