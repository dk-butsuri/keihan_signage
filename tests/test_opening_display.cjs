const {chromium}=require('playwright');
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),os=require('os');
const root=path.resolve(__dirname,'..');
const out=process.env.SIGNAGE_SCREENSHOTS||fs.mkdtempSync(path.join(os.tmpdir(),'signage-opening-'));
const source=fs.readFileSync(root+'/templates/minimal/index.html','utf8');
const frame=JSON.parse(fs.readFileSync(root+'/demo-data/replay.json')).frames[0];
const groups=['京阪','大阪メトロ','JR','私鉄'].map(name=>({name,mark:'○',status:'平常運転',lines:[]}));
(async()=>{
    const browser=await chromium.launch(),errors=[];
    async function view({width=1920,height=1080,off=false,reduced=false,suspended=false,fail=false,slow=false,broken=false,notices=false,partial=false,features={trains:true,buses:true,delays:true}}={}) {
        const page=await browser.newPage({viewport:{width,height}});page.on('pageerror',error=>errors.push(error.message));
        await page.clock.install({time:new Date('2026-11-09T15:00:00+09:00')});
        if(reduced)await page.emulateMedia({reducedMotion:'reduce'});
        await page.route('https://fonts.googleapis.com/**',route=>route.fulfill({contentType:'text/css',body:''}));
        const requests=[];let release;
        const opGroups=notices?groups.map(group=>({...group,mark:'△',status:'列車遅延',lines:Array.from({length:5},(_,i)=>({name:'路線'+i,ticker_name:group.name+'路線'+i,status:'列車遅延',detail:'列車に遅れが出ています。',announced_time:'2026-11-09T14:50:00+09:00'}))})):groups;
        await page.route('http://opening.test/**',async route=>{
            const name=new URL(route.request().url()).pathname;requests.push(name);
            if(name==='/transit/')return route.fulfill({contentType:'text/html',body:source.replace('{{ config | tojson }}',JSON.stringify({features,buses:{stop_name:'同志社香里'}}))});
            if(name.startsWith('/transit/assets/')) {
                if(broken&&name.endsWith('/opening.js'))return route.fulfill({status:404,body:'missing'});
                return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(root+'/templates/minimal/'+path.basename(name),'utf8')});
            }
            if(fail&&name.endsWith('/trains'))return route.fulfill({status:503,body:'unavailable'});
            if(partial&&name.endsWith('/delays'))return route.fulfill({contentType:'application/json',body:JSON.stringify({groups:opGroups,error:'一部の運行情報を取得できませんでした'})});
            const key=path.basename(name),data=key==='trains'?frame.trains:key==='line'?{...frame.line,suspended}:key==='buses'?{buses:Array.from({length:6},()=>({destination:'京阪香里園',arrival_time:'15:08 着予定',status:'8分後'}))}:key==='delays'?{delays:[],groups:opGroups}:key==='time'?{ts:Date.now()/1000,ntp_rtt_ms:0}:{};
            if(slow&&key==='buses')return new Promise(resolve=>{release=async()=>{await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});resolve();};});
            return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
        });
        await page.goto('http://opening.test/transit/'+(off?'?motion=off':''));
        return {page,requests,release:()=>release()};
    }
    const state=page=>page.evaluate(()=>document.documentElement.dataset.assembly);
    const waitState=(page,value)=>page.waitForFunction(value=>document.documentElement.dataset.assembly===value,value);
    const seek=(page,ms)=>page.evaluate(ms=>{for(const a of document.getAnimations().filter(a=>a.id==='screen-assembly')){a.pause();a.currentTime=ms;}},ms);
    async function finish(page){await page.evaluate(()=>document.getAnimations().filter(a=>a.id==='screen-assembly').forEach(a=>a.finish()));await waitState(page,'completed');}
    async function cleaned(page){assert.equal(await page.locator('.demo-assembly-guide,.demo-assembly-rule').count(),0);assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>a.id==='screen-assembly').length),0);assert.equal(await page.locator('#screen').evaluate(node=>getComputedStyle(node).visibility),'visible');}
    async function geometry(page){return page.locator('#station-name,#clock-time,#normal-up-list > div,#normal-down-list > div,#normal-bus-list > div,#normal-delay-list > div,#operation-slides').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,opacity:getComputedStyle(node).opacity,transform:getComputedStyle(node).transform,text:node.id==='clock-time'?'':node.textContent};}));}
    for(const [width,height] of [[1920,1080],[960,540],[1919,990],[1920,1200]]) {
        const {page}=await view({width,height});await waitState(page,'running');await seek(page,1666);
        const phase=await page.evaluate(()=>{const row=document.querySelector('#normal-up-list > div');return ['time','destination','remaining'].map(name=>Number(getComputedStyle(row.querySelector(`[data-field="${name}"]`)).opacity));});
        assert.ok(phase[0]>phase[1]&&phase[1]>phase[2],JSON.stringify(phase));
        assert.equal(await page.locator('#normal-delay-list > div').first().evaluate(node=>getComputedStyle(node).opacity),'0');
        const guides=await page.evaluate(()=>{const root=document.getElementById('screen'),scale=root.getBoundingClientRect().width/root.offsetWidth;return [...document.querySelectorAll('.demo-assembly-guide')].map((guide,index)=>guide.getBoundingClientRect().left-document.getElementById(['normal-up','normal-down','normal-buses','normal-delays'][index]).getBoundingClientRect().left+(index?7*scale:0));});
        assert.ok(guides.every(offset=>Math.abs(offset)<.1),JSON.stringify({width,guides}));
        await page.screenshot({path:out+`/opening-${width}-${height}.png`});
        await finish(page);await cleaned(page);
        const baseline=await view({width,height,off:true});await baseline.page.waitForFunction(()=>trainData&&busData&&delayData);await baseline.page.evaluate(()=>document.fonts.ready);
        assert.deepEqual(await geometry(page),await geometry(baseline.page),`${width}x${height} changed layout`);
        assert.equal(baseline.requests.filter(name=>name.includes('/assets/')&&!name.endsWith('/weather.js')).length,0);
        await page.evaluate(()=>{trainData.up_trains[0].destination='樟葉';render();});assert.equal(await state(page),'completed');await cleaned(page);
        await baseline.page.close();await page.close();
    }
    for(const event of ['update','resize','hidden','motion']) {
        const {page}=await view();await waitState(page,'running');
        if(event==='update')await page.evaluate(()=>renderBuses());
        if(event==='resize')await page.setViewportSize({width:1280,height:800});
        if(event==='hidden')await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
        if(event==='motion')await page.emulateMedia({reducedMotion:'reduce'});
        await waitState(page,'skipped');await cleaned(page);await page.evaluate(()=>render());assert.equal(await state(page),'skipped');await page.close();
    }
    for(const options of [{reduced:true},{suspended:true},{fail:true},{broken:true}]) {
        const {page}=await view(options);await waitState(page,'skipped');await cleaned(page);await page.close();
    }
    const slow=await view({slow:true});await slow.page.clock.runFor(2100);await waitState(slow.page,'skipped');await cleaned(slow.page);await slow.release();await slow.page.locator('#normal-bus-list .bus-card').first().waitFor();assert.equal(await state(slow.page),'skipped');await slow.page.close();
    const disabled=await view({features:{trains:false,buses:true,delays:false}});await waitState(disabled.page,'running');assert.equal(await disabled.page.locator('.demo-assembly-guide').count(),1);await finish(disabled.page);await cleaned(disabled.page);assert.equal(await disabled.page.locator('#normal-trains').isVisible(),false);await disabled.page.close();
    const partial=await view({partial:true});await waitState(partial.page,'running');await finish(partial.page);await cleaned(partial.page);await partial.page.close();
    const automatic=await view({notices:true});await waitState(automatic.page,'running');
    assert.ok(await automatic.page.evaluate(()=>operationPagers.every(pager=>!pager.timer)));
    const seconds=await automatic.page.locator('#clock-seconds').textContent();
    await automatic.page.screenshot({path:out+'/opening-live-start.png'});
    await waitState(automatic.page,'completed');await cleaned(automatic.page);
    assert.notEqual(await automatic.page.locator('#clock-seconds').textContent(),seconds);
    assert.ok(await automatic.page.evaluate(()=>operationPagers.filter(pager=>pager.active()&&pager.pages.length>1).every(pager=>!!pager.timer)));
    const noticesBaseline=await view({notices:true,off:true});await noticesBaseline.page.waitForFunction(()=>trainData&&busData&&delayData);
    assert.deepEqual(await geometry(automatic.page),await geometry(noticesBaseline.page),'notices changed final layout');await noticesBaseline.page.close();
    await automatic.page.screenshot({path:out+'/opening-live-finished.png'});await automatic.page.close();
    assert.deepEqual(errors,[]);await browser.close();console.log('Opening: planned order, 4 screen ratios and exact final layout, cleanup, one-time playback, updates/resize/visibility/motion interrupts, errors/slow assets/data, feature switches passed');
})().catch(error=>{console.error(error);process.exit(1)});
