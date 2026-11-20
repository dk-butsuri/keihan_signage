// 季節の装飾を1つずつ読み込み、どの装飾にも共通の決まりを確かめる（新しい装飾を足してもこのファイルは書き足さなくてよい）
const {chromium}=require('playwright');
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..'),seasonsDir=root+'/templates/seasons';
const source=fs.readFileSync(root+'/templates/minimal/index.html','utf8');
const frame=JSON.parse(fs.readFileSync(root+'/demo-data/replay.json')).frames[0];
const ids=fs.readdirSync(seasonsDir).filter(id=>fs.existsSync(`${seasonsDir}/${id}/theme.js`));
const groups=['京阪','大阪メトロ','JR'].map(name=>({name,mark:'○',status:'平常運転',lines:[]}));
const PLAIN='rgb(21, 21, 23)';
(async()=>{
    const browser=await chromium.launch();
    async function view(id,{motion=true,suspended=false}={}) {
        const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[];
        page.on('pageerror',error=>errors.push(error.message));
        await page.route('https://fonts.googleapis.com/**',route=>route.fulfill({contentType:'text/css',body:''}));
        await page.route('http://season.test/**',route=>{
            const name=new URL(route.request().url()).pathname;
            if(name==='/transit/')return route.fulfill({contentType:'text/html',body:source.replace('{{ config | tojson }}',JSON.stringify({features:{trains:true,buses:true,delays:true},buses:{stop_name:'同志社香里'}}))});
            const season=name.match(/^\/transit\/assets\/seasons\/([a-z0-9-]+)\/(theme\.(?:js|css))$/);
            if(season)return route.fulfill({contentType:season[2].endsWith('.css')?'text/css':'text/javascript',body:fs.readFileSync(`${seasonsDir}/${season[1]}/${season[2]}`,'utf8')});
            if(name.startsWith('/transit/assets/'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(root+'/templates/minimal/'+path.basename(name),'utf8')});
            const key=path.basename(name),data=key==='trains'?frame.trains:key==='line'?{...frame.line,suspended}:key==='buses'?{buses:Array.from({length:6},()=>({destination:'京阪香里園',arrival_time:'15:08 着予定',status:'8分後'}))}:key==='delays'?{delays:[],groups}:key==='time'?{ts:Date.now()/1000,ntp_rtt_ms:0}:{};
            return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
        });
        await page.goto(`http://season.test/transit/?season=${id}`+(motion?'':'&motion=off'));
        return {page,errors};
    }
    const html=(page,name)=>page.evaluate(name=>document.documentElement.hasAttribute(name),name);
    const layers=page=>page.locator('.season-layer').evaluateAll(nodes=>nodes.map(node=>({opacity:getComputedStyle(node).opacity,children:node.childElementCount})));
    const cards=page=>page.locator('#normal-down-list > div:not(.empty),#normal-bus-list > div:not(.empty),#normal-delay-list > div').evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).backgroundColor));
    const settle=page=>page.waitForTimeout(1200);

    for(const id of ids) {
        // 見せてよいとき: 印が付き、2枚の層が出て、どちらかに何か描かれている
        const {page,errors}=await view(id);
        await page.waitForFunction(()=>document.documentElement.hasAttribute('data-season-visible'),null,{timeout:20000});
        await settle(page);
        assert.equal(await page.evaluate(()=>document.documentElement.dataset.season),id);
        const shown=await layers(page);
        assert.equal(shown.length,2,id);
        assert.ok(shown.every(layer=>layer.opacity==='1'),`${id}: 層が見えていない`);
        assert.ok(shown.some(layer=>layer.children>0),`${id}: 何も描いていない`);
        assert.ok((await cards(page)).length>0);

        // 時報・組み上げのあいだ: 印が外れ、層が消え、カードは元の色
        for(const [name,value] of [['data-chime','running'],['data-assembly','running']]) {
            await page.evaluate(([name,value])=>document.documentElement.setAttribute(name,value),[name,value]);
            await settle(page);
            assert.equal(await html(page,'data-season-visible'),false,`${id}: ${name} で印が残る`);
            assert.ok((await layers(page)).every(layer=>layer.opacity==='0'),`${id}: ${name} で層が残る`);
            assert.ok((await cards(page)).every(color=>color===PLAIN),`${id}: ${name} でカードの色が残る`);
            await page.evaluate(name=>document.documentElement.removeAttribute(name),name);
            await settle(page);
            assert.equal(await html(page,'data-season-visible'),true,`${id}: ${name} のあとに戻らない`);
        }

        // 外したとき: 層・読み込んだ CSS・印が残らない
        await page.evaluate(()=>window.signageSeason.apply('off'));
        await settle(page);
        assert.equal(await page.locator('.season-layer').count(),0,`${id}: 層が残る`);
        assert.equal(await page.locator(`link[href*="/seasons/${id}/"]`).count(),0,`${id}: CSS が残る`);
        assert.equal(await html(page,'data-season'),false);
        assert.equal(await html(page,'data-season-visible'),false);
        assert.ok((await cards(page)).every(color=>color===PLAIN),`${id}: 外してもカードの色が残る`);
        assert.deepEqual(errors,[],`${id}: ${errors.join(' / ')}`);
        await page.close();

        // 見合わせ時の画面: 出さない
        const quiet=await view(id,{motion:false,suspended:true});
        await quiet.page.waitForFunction(()=>document.documentElement.hasAttribute('data-season-quiet'),null,{timeout:10000});
        await settle(quiet.page);
        assert.equal(await html(quiet.page,'data-season-visible'),false,`${id}: 見合わせ時に印が付く`);
        assert.ok((await layers(quiet.page)).every(layer=>layer.opacity==='0'),`${id}: 見合わせ時に層が見える`);
        assert.deepEqual(quiet.errors,[],`${id}: ${quiet.errors.join(' / ')}`);
        await quiet.page.close();
        console.log('ok',id);
    }
    await browser.close();
    console.log(`season display: ${ids.length} themes ok`);
})().catch(error=>{console.error(error);process.exit(1);});
