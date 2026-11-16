// デモ一覧のサムネイルを撮る。各デモを開いて画面の部分だけを撮り、docs/demo-thumbs/<id>.jpg に保存する。
// 使い方: node tools/build_demo_thumbs.cjs http://<controller>/demo [撮り直すデモのid ...]
const {chromium}=require('playwright');
const path=require('node:path');
const root=(process.argv[2]||'http://127.0.0.1:8080/demo').replace(/\/$/,'');
const out=path.join(__dirname,'../docs/demo-thumbs'),only=process.argv.slice(3);
// 開いたままだと何も出ない画面は、見どころのある状態にしてから撮る
const PREPARE={'weather-cards':page=>page.locator('#presets button').nth(2).click()};
// [撮る部分, 開いてから待つ秒数]
const SHOTS={replay:['#screen',5],static:['#screen',4],gallery:['main',3],playground:['#stage',5],weather:['main > section:nth-of-type(2)',3],
    intro:['.intro-stage',9],chime:['.chime-stage',8],clock:['.clock-stage',7]};
(async()=>{
    const browser=await chromium.launch();
    const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:0.42});
    await page.goto(root+'/');
    const demos=await page.locator('[data-demo-id]').evaluateAll(cards=>cards.map(card=>({id:card.dataset.demoId,mode:card.dataset.mode})));
    for(const {id,mode} of demos.filter(demo=>!only.length||only.includes(demo.id))){
        const [selector,wait]=SHOTS[mode]||['main',3];
        await page.goto(`${root}/${id}${mode==='static'||mode==='replay'?'?motion=off':''}`);
        await page.waitForTimeout(wait*1000);
        if(PREPARE[id]){await PREPARE[id](page);await page.waitForTimeout(800);}
        const target=page.locator(selector).first(),box=await target.boundingBox();
        // 16:9 に切り出す（縦長の部分は上から）
        const clip={x:box.x,y:box.y,width:box.width,height:Math.min(box.height,box.width*9/16)};
        await page.screenshot({path:path.join(out,id+'.jpg'),type:'jpeg',quality:72,clip});
        console.log(id,mode,selector);
    }
    await browser.close();
})().catch(error=>{console.error(error);process.exit(1);});
