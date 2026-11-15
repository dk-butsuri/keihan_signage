const {chromium}=require('playwright');
const assert=require('assert/strict');
(async()=>{
    const root=(process.env.SIGNAGE_DEMO_URL||'http://127.0.0.1:18745/demo').replace(/\/$/,'');
    const browser=await chromium.launch();
    const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[],live=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{if(/\/(api|transit\/api)\//.test(new URL(request.url()).pathname))live.push(request.url());});
    await page.goto(root+'/startup-intro-atlas');
    await page.waitForFunction(()=>document.getElementById('atlas-intro').intro?.ready,null,{timeout:30000});
    const lit=async frame=>page.evaluate(frame=>{
        const intro=document.getElementById('atlas-intro');intro.intro.seek(frame);
        const canvas=intro.querySelector('canvas'),data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
        let count=0;for(let i=3;i<data.length;i+=16)if(data[i]>40)count++;
        return count;
    },frame);
    assert.ok(await lit(10)<await lit(150),'走査の輪が広がるにつれて地図が描かれる');
    assert.ok(await lit(300)>0);
    const last=await page.evaluate(()=>{
        const intro=document.getElementById('atlas-intro'),max=Number(intro.querySelector('input').max);intro.intro.seek(max);
        const doc=intro.querySelector('iframe').contentDocument,name=doc.getElementById('station-name');
        return {frame:intro.intro.frame,max,transform:name.style.transform,opacity:name.style.opacity,
            phase:intro.querySelector('[data-phase]').textContent};
    });
    assert.equal(last.frame,last.max);assert.equal(last.phase,'完成');assert.equal(last.opacity,'1');
    assert.match(last.transform,/translate\(0px, ?0px\) scale\(1\)/);
    await page.getByRole('button',{name:'やり直す'}).click();
    await page.waitForTimeout(500);
    assert.ok(await page.evaluate(()=>document.getElementById('atlas-intro').intro.playing));
    await page.setViewportSize({width:390,height:844});
    await page.waitForTimeout(200);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
    assert.deepEqual(errors,[]);assert.deepEqual(live,[]);
    await browser.close();
    console.log('ok');
})().catch(error=>{console.error(error);process.exit(1);});
