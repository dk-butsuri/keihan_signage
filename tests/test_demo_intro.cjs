const {chromium}=require('playwright');
const assert=require('assert/strict');
const fs=require('fs'),os=require('os'),path=require('path');
(async()=>{
    const root=(process.env.SIGNAGE_DEMO_URL||'http://127.0.0.1:18745/demo').replace(/\/$/,'');
    const out=process.env.SIGNAGE_SCREENSHOTS||fs.mkdtempSync(path.join(os.tmpdir(),'signage-intro-'));
    const browser=await chromium.launch();
    const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[],live=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{if(/\/(api|transit\/api)\//.test(new URL(request.url()).pathname))live.push(request.url());});
    await page.clock.install();
    await page.goto(root+'/');
    await page.getByRole('link',{name:/起動イントロ/}).click();
    await page.waitForURL(root+'/startup-intro');
    await page.waitForFunction(()=>document.getElementById('tankyu-intro').intro?.ready);
    assert.equal(await page.getByRole('combobox',{name:'デモ選択',exact:true}).inputValue(),'startup-intro');
    assert.equal(await page.evaluate(()=>document.getElementById('tankyu-intro').intro.playing),false);
    const slider=page.getByRole('slider',{name:/再生位置/});
    async function seek(value) {
        await slider.evaluate((input,value)=>{input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));},value);
    }
    const glow=[];
    for(const value of [135,183,237]) {
        await seek(value);
        glow.push(await page.locator('.intro-source .intro-glow').evaluate(node=>Number(node.style.opacity)));
        assert.equal(await page.locator('.intro-source .intro-text').evaluate(node=>node.style.opacity),'1');
        await page.screenshot({path:out+`/intro-${value}.png`});
    }
    assert.ok(glow[0]<.05&&glow[0]<glow[1]&&glow[1]<glow[2]&&glow[2]===.75);
    const board=page.frameLocator('.intro-board');
    await seek(299);
    assert.equal(await board.locator('#station-name').evaluate(node=>getComputedStyle(node).opacity),'0');
    await seek(315);
    assert.ok(Number(await board.locator('#station-name').evaluate(node=>getComputedStyle(node).opacity))>.5);
    assert.equal(await board.locator('#normal-up-list > div').first().evaluate(node=>getComputedStyle(node).opacity),'0');
    await seek(400);
    const phase=await board.locator('#normal-up-list > div').first().evaluate(node=>({
        row:Number(getComputedStyle(node).opacity),
        time:Number(getComputedStyle(node.querySelector('[data-field="time"]')).opacity),
        destination:Number(getComputedStyle(node.querySelector('[data-field="destination"]')).opacity),
        remaining:Number(getComputedStyle(node.querySelector('[data-field="remaining"]')).opacity)
    }));
    assert.ok(phase.row>=phase.time&&phase.time>phase.destination&&phase.destination>phase.remaining,JSON.stringify(phase));
    assert.equal(await board.locator('#normal-delay-list > div').first().evaluate(node=>getComputedStyle(node).opacity),'0');
    await seek(183);
    await page.getByRole('button',{name:'1フレーム進む',exact:true}).click();
    assert.equal(await slider.inputValue(),'184');
    await page.getByRole('button',{name:'1フレーム戻る',exact:true}).click();
    assert.equal(await slider.inputValue(),'183');
    await slider.focus();await slider.press('ArrowRight');assert.equal(await slider.inputValue(),'184');
    await page.getByRole('button',{name:'やり直す',exact:true}).click();
    await page.clock.runFor(1600);
    await page.getByRole('button',{name:'一時停止',exact:true}).click();
    const stopped=await slider.inputValue();await page.clock.runFor(1000);assert.equal(await slider.inputValue(),stopped);
    await page.getByRole('button',{name:'再生',exact:true}).click();
    await page.clock.runFor(9000);
    assert.equal(await slider.inputValue(),'541');
    assert.equal(await page.locator('.intro-pixels').evaluate(node=>node.style.opacity),'0');
    const completed=await board.locator('#normal-up-list').textContent();
    assert.equal(await board.locator('#normal-up-list > div').count(),6);
    assert.equal(await board.locator('#demo-dock').isVisible(),false);
    assert.ok(await board.locator('.demo-assembly-guide').evaluateAll(nodes=>nodes.every(node=>getComputedStyle(node).opacity==='0')));
    await page.clock.runFor(1000);assert.equal(await slider.inputValue(),'541');
    await seek(299);await seek(541);assert.equal(await board.locator('#normal-up-list').textContent(),completed);
    await page.getByRole('button',{name:'つなぎから',exact:true}).click();
    assert.ok(Number(await slider.inputValue())>=276&&Number(await slider.inputValue())<300);
    await page.clock.runFor(5000);
    assert.equal(await slider.inputValue(),'541');
    await page.getByRole('button',{name:'再生',exact:true}).click();await page.clock.runFor(500);
    assert.ok(Number(await slider.inputValue())<50);
    await seek(200);
    for(const [width,height] of [[1920,1080],[960,600],[375,812],[320,700]]) {
        await page.setViewportSize({width,height});
        await page.clock.runFor(50);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}px overflow`);
        const stage=await page.locator('.intro-stage').boundingBox();assert.ok(Math.abs(stage.width/stage.height-16/9)<.01);
        await page.screenshot({path:out+`/intro-${width}.png`,fullPage:true});
    }
    await page.getByRole('combobox',{name:'デモ選択',exact:true}).selectOption('normal');
    await page.locator('#normal-up-list > div').first().waitFor();
    await page.getByRole('combobox',{name:'デモ選択',exact:true}).selectOption('startup-intro');
    await page.waitForFunction(()=>document.getElementById('tankyu-intro').intro?.ready);
    await page.goto(root+'/startup-intro/');await page.waitForFunction(()=>document.getElementById('tankyu-intro').intro?.ready);
    await page.getByRole('link',{name:'← デモ一覧',exact:true}).click();await page.waitForURL(root);
    await page.emulateMedia({reducedMotion:'reduce'});await page.goto(root+'/startup-intro');
    await page.waitForFunction(()=>document.getElementById('tankyu-intro').intro?.ready);
    await page.clock.runFor(1000);assert.equal(await page.evaluate(()=>document.getElementById('tankyu-intro').intro.playing),false);
    await page.route(root+'/normal/data',route=>route.fulfill({status:503,body:'unavailable'}));
    await page.reload();await page.locator('.intro-board').waitFor({state:'attached'});await page.clock.runFor(16000);
    await page.getByRole('button',{name:'再読み込み',exact:true}).waitFor();
    assert.match(await page.getByRole('alert').textContent(),/案内画面を読み込めませんでした/);
    await page.unroute(root+'/normal/data');await page.getByRole('button',{name:'再読み込み',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('tankyu-intro').intro?.ready);
    assert.deepEqual(errors,[]);assert.deepEqual(live,[]);
    await browser.close();console.log('Intro demo: glow, seamless handoff, planned order within rows/columns, complete board, seek/replay, 320–1920px, navigation, reduced motion and no live API passed');
})().catch(error=>{console.error(error);process.exit(1)});
