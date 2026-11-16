// 「測量」の画面（時計・バス・電車）は、交通情報の画面と同じく 16:8〜16:10 で画面いっぱいに描き、
// それより外の比率は近いほうの比率のまま縮めて中央に置く。
const {chromium}=require('playwright');
const assert=require('assert/strict');
(async()=>{
    const base=(process.env.SIGNAGE_DEMO_URL||'http://127.0.0.1:18745/demo').replace(/\/demo\/?$/,'');
    const browser=await chromium.launch(),errors=[];
    try {
        for(const path of ['/clock/','/board/bus/','/board/train/'].map(p=>base.includes(':8080')?p.replace('/board','/transit/board'):p)){
            for(const [w,h,canvasW,canvasH,top] of [[1920,1080,1920,1080,0],[1920,1200,1920,1200,0],[1920,960,2160,1080,0],[1024,768,1920,1200,64]]){
                const page=await browser.newPage({viewport:{width:w,height:h}});
                page.on('pageerror',error=>errors.push(path+': '+error.message));
                await page.goto(base+path);
                await page.waitForFunction(()=>document.getElementById('atlas-clock').clock?.ready,null,{timeout:30000});
                const got=await page.evaluate(()=>{const canvas=document.querySelector('.clock-map'),box=canvas.getBoundingClientRect(),overlay=document.querySelector('.clock-overlay');
                    return {w:canvas.width,h:canvas.height,left:Math.round(box.left),top:Math.round(box.top),right:Math.round(box.right),overlay:overlay.style.width+'x'+overlay.style.height,
                        textBottom:Math.max(...[...overlay.querySelectorAll('.clock-row,.board-head')].map(e=>e.getBoundingClientRect().bottom))};});
                assert.deepEqual([got.w,got.h],[canvasW,canvasH],`${path} ${w}x${h} の描く範囲`);
                assert.equal(got.overlay,`${canvasW}px x ${canvasH}px`.replace(' x ','x'));
                assert.equal(got.top,top,`${path} ${w}x${h}`);
                if(!top)assert.equal(got.right,w,'横は画面の端まで');
                assert.ok(got.textBottom<=h,'文字が画面からはみ出さない');
                await page.close();
            }
        }
        assert.deepEqual(errors,[]);
        console.log('ok');
    } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
