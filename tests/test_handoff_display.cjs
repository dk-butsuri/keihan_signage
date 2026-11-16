// 「測量」の画面（時計・バス・電車）から交通情報の画面へ切り替えるときのつなぎ（handoff）を確かめる。
// 1. 端末（controller の display.html）: 裏で交通情報の画面を読み込み、ready → 「測量」に outro → done → go → running で入れ替える
// 2. 交通情報の画面（index.html の ?handoff=atlas）: 準備ができても go まで待ち、下線を引かずに組み上げる
// 3. 「測量」の画面（demo-clock-atlas.js）: 後半を流し、最後のコマで交通情報の画面の下線と同じ画素に線だけが残る
// 3 は transit（SIGNAGE_DEMO_URL、例 http://127.0.0.1:18745/demo。サイネージ用の /clock/・/board/*/ を開く）が要る。
const {chromium}=require('playwright');
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
const display=fs.readFileSync(root+'/controller/templates/display.html','utf8');
const source=fs.readFileSync(root+'/templates/minimal/index.html','utf8');
const frame=JSON.parse(fs.readFileSync(root+'/demo-data/replay.json')).frames[0];
const groups=['京阪','大阪メトロ','JR','大阪モノレール','近鉄','その他の私鉄'].map(name=>({name,mark:'○',status:'平常運転',lines:[]}));
const base=(process.env.SIGNAGE_DEMO_URL||'http://127.0.0.1:18745/demo').replace(/\/demo\/?$/,'');

// 「測量」と交通情報の画面の代わり。やりとりを親（端末）の記録に残す
const atlasStub=`<body style="margin:0;background:#123">atlas<script>
addEventListener('message',e=>{if(e.data?.type!=='signage:outro')return;parent.__outro.push(e.data.rule);
  if(parent.__atlas==='silent')return;setTimeout(()=>parent.postMessage({type:'signage:outro',state:'done'},location.origin),300);});
</script></body>`;
const transitStub=`<body style="margin:0;background:#321">transit<script>
const handoff=new URLSearchParams(location.search).get('handoff')==='atlas';
if(handoff){const mode=parent.__transit;
  if(mode==='skip')setTimeout(()=>parent.postMessage({type:'signage:handoff',state:'skipped'},location.origin),100);
  else setTimeout(()=>parent.postMessage({type:'signage:handoff',state:'ready',rule:{left:56,right:1864,y:172.5,scale:1}},location.origin),100);
  addEventListener('message',e=>{if(e.data?.type!=='signage:handoff-go')return;parent.__go++;
    setTimeout(()=>parent.postMessage({type:'signage:handoff',state:'running'},location.origin),50);});}
</script></body>`;

(async()=>{
    const browser=await chromium.launch(),errors=[];
    /* 1. 端末 */
    async function controller({reduced=false}={}) {
        const page=await browser.newPage({viewport:{width:1920,height:1080}});page.on('pageerror',e=>errors.push(e.message));
        if(reduced)await page.emulateMedia({reducedMotion:'reduce'});
        await page.route('http://controller.test/**',route=>{
            const url=new URL(route.request().url()),p=url.pathname;
            if(p==='/')return route.fulfill({contentType:'text/html',body:display});
            if(p==='/clock/'||p.startsWith('/transit/board/'))return route.fulfill({contentType:'text/html',body:atlasStub});
            if(p==='/transit/')return route.fulfill({contentType:'text/html',body:transitStub});
            if(p==='/api/mode')return route.fulfill({contentType:'application/json',body:'{"mode":"clock"}'});
            if(p==='/api/mode/stream')return route.fulfill({contentType:'text/event-stream',body:': keepalive\n\n'});
            return route.fulfill({status:200,contentType:'application/json',body:'{}'});
        });
        await page.goto('http://controller.test/');
        await page.evaluate(()=>{window.__outro=[];window.__go=0;window.__atlas='';window.__transit='';});
        await page.waitForFunction(()=>document.getElementById('f').getAttribute('src')==='/clock/');
        return page;
    }
    const frames=page=>page.evaluate(()=>[...document.querySelectorAll('iframe')].map(f=>({id:f.id,cls:f.className,src:f.getAttribute('src'),opacity:getComputedStyle(f).opacity})));
    {
        const page=await controller();
        await page.evaluate(()=>setMode('transit','full'));
        let list=await frames(page);
        assert.deepEqual(list.map(f=>[f.id,f.src,f.opacity]),[['f','/clock/','1'],['','/transit/?handoff=atlas','0']],'裏で読み込み、表は「測量」のまま');
        await page.waitForFunction(()=>window.__outro.length===1);
        assert.deepEqual(await page.evaluate(()=>window.__outro[0]),{left:56,right:1864,y:172.5,scale:1},'下線の位置を「測量」に渡す');
        assert.equal(await page.evaluate(()=>window.__go),0,'後半が終わるまでは組み上げさせない');
        await page.waitForFunction(()=>document.querySelectorAll('iframe').length===1);
        list=await frames(page);
        assert.deepEqual(list.map(f=>[f.id,f.cls,f.src,f.opacity]),[['f','','/transit/?handoff=atlas','1']],'組み上げが始まったら入れ替える');
        assert.equal(await page.evaluate(()=>window.__go),1);
        // 交通情報 → 時計はそのまま切り替える
        await page.evaluate(()=>setMode('clock'));
        assert.deepEqual((await frames(page)).map(f=>[f.id,f.src]),[['f','/clock/']]);
        // バスの「測量」からも同じ。途中で時計に戻されたら、裏の画面を捨てる
        await page.evaluate(()=>{setMode('transit','bus');});await page.waitForFunction(()=>{const w=document.getElementById('f').contentWindow;return w?.location.pathname==='/transit/board/bus/'&&w.document.readyState==='complete';});
        await page.evaluate(()=>{window.__atlas='silent';setMode('transit','full');});
        await page.waitForFunction(()=>window.__outro.length===2);
        await page.evaluate(()=>setMode('clock'));
        assert.deepEqual((await frames(page)).map(f=>[f.id,f.src]),[['f','/clock/']],'途中で切り替えたら裏の画面を捨てる');
        // 交通情報の画面が演出を飛ばしたら、後半を待たずに入れ替える
        await page.evaluate(()=>{window.__atlas='';window.__transit='skip';setMode('transit','full');});
        await page.waitForFunction(()=>document.querySelectorAll('iframe').length===1&&document.getElementById('f').getAttribute('src').startsWith('/transit/'));
        assert.equal(await page.evaluate(()=>window.__outro.length),2,'飛ばしたときは後半を流さない');
        await page.close();
    }
    {
        // 「測量」が返事をしないときは、8秒で組み上げに進む
        const page=await controller();await page.clock.install();
        await page.evaluate(()=>{window.__atlas='silent';setMode('transit','full');});
        await page.waitForFunction(()=>window.__outro.length===1);
        await page.clock.runFor(7900);assert.equal(await page.evaluate(()=>window.__go),0);
        await page.clock.runFor(200);await page.waitForFunction(()=>window.__go===1);
        await page.clock.runFor(100);await page.waitForFunction(()=>document.querySelectorAll('iframe').length===1);
        await page.close();
    }
    {
        // 動きを減らす設定ではつながない
        const page=await controller({reduced:true});
        await page.evaluate(()=>setMode('transit','full'));
        assert.deepEqual((await frames(page)).map(f=>[f.id,f.src]),[['f','/transit/']]);
        await page.close();
    }

    /* 2. 交通情報の画面の handoff */
    async function transit({fail=false}={}) {
        const page=await browser.newPage({viewport:{width:1920,height:1080}});page.on('pageerror',e=>errors.push(e.message));
        await page.route('https://fonts.googleapis.com/**',route=>route.fulfill({contentType:'text/css',body:''}));
        await page.route('http://handoff.test/**',route=>{
            const name=new URL(route.request().url()).pathname;
            if(name==='/')return route.fulfill({contentType:'text/html',body:`<body style="margin:0"><iframe id=b style="position:fixed;inset:0;width:100%;height:100%;border:0" src="/transit/?handoff=atlas"></iframe><script>
window.__messages=[];addEventListener('message',e=>window.__messages.push(e.data));</script></body>`});
            if(name==='/transit/')return route.fulfill({contentType:'text/html',body:source.replace('{{ config | tojson }}',JSON.stringify({features:{trains:true,buses:true,delays:true},buses:{stop_name:'同志社香里'}}))});
            if(name.startsWith('/transit/assets/'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(root+'/templates/minimal/'+path.basename(name),'utf8')});
            if(fail&&name.endsWith('/trains'))return route.fulfill({status:503,body:'unavailable'});
            const key=path.basename(name),data=key==='trains'?frame.trains:key==='line'?{...frame.line,suspended:false}:key==='buses'?{buses:Array.from({length:6},()=>({destination:'京阪香里園',arrival_time:'15:08 着予定',status:'8分後'}))}:key==='delays'?{delays:[],groups}:key==='time'?{ts:Date.now()/1000,ntp_rtt_ms:0}:{};
            return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
        });
        await page.goto('http://handoff.test/');
        const inner=()=>page.frames().find(f=>f.url().includes('handoff=atlas'));
        return {page,inner};
    }
    {
        const {page,inner}=await transit();
        await page.waitForFunction(()=>window.__messages.some(m=>m.state==='ready'));
        const ready=await page.evaluate(()=>window.__messages.find(m=>m.state==='ready'));
        assert.deepEqual(ready.rule,{left:56,right:1864,y:172.5,scale:1});
        await page.waitForTimeout(2500);
        assert.equal(await inner().evaluate(()=>document.documentElement.dataset.assembly),'pending','合図までは組み上げない（2秒であきらめない）');
        await page.evaluate(()=>document.getElementById('b').contentWindow.postMessage({type:'signage:handoff-go'},location.origin));
        await page.waitForFunction(()=>window.__messages.some(m=>m.state==='running'));
        const first=await inner().evaluate(()=>{
            for(const a of document.getAnimations().filter(a=>a.id==='screen-assembly')){a.pause();a.currentTime=0;}
            const header=document.querySelector('#screen header');
            return {rules:header.querySelectorAll('.demo-assembly-rule').length,border:getComputedStyle(header).borderBottomColor,
                name:getComputedStyle(document.getElementById('station-name')).opacity};
        });
        assert.deepEqual(first,{rules:0,border:'rgb(38, 38, 42)',name:'0'},'見出しの下線は最初から出ていて、ほかはまだ出ていない');
        await inner().evaluate(()=>document.getAnimations().filter(a=>a.id==='screen-assembly').forEach(a=>a.finish()));
        await page.waitForFunction(()=>window.__messages.some(m=>m.state==='completed'));
        await page.close();
    }
    {
        const {page}=await transit({fail:true});
        await page.waitForFunction(()=>window.__messages.some(m=>m.state==='skipped'));
        assert.equal(await page.evaluate(()=>window.__messages.some(m=>m.state==='ready')),false);
        await page.close();
    }

    /* 3. 「測量」の画面の後半 */
    for(const name of ['clock/','board/bus/','board/train/']) {
        const page=await browser.newPage({viewport:{width:1920,height:1080}});page.on('pageerror',e=>errors.push(e.message));
        await page.goto(base+'/'+name);
        await page.waitForFunction(()=>document.getElementById('atlas-clock').clock?.ready,null,{timeout:30000});
        const rule={left:56,right:1864,y:172.5,scale:1};
        const at=u=>page.evaluate(([u,rule])=>{
            const clock=document.getElementById('atlas-clock');clock.clock.renderOutroAt(u,30+u,Date.UTC(2026,10,15,22,41,7),rule);
            const canvas=clock.querySelector('canvas'),ctx=canvas.getContext('2d'),data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
            let lit=0,outside=0;const row=[];
            for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x+=2){const a=data[(y*canvas.width+x)*4+3];if(a>8){lit++;if(y!==172)outside++;}}
            for(const x of [55,56,960,1863,1864])row.push([...data.slice((172*canvas.width+x)*4,(172*canvas.width+x)*4+4)]);
            return {lit,outside,row,overlay:clock.querySelector('.clock-overlay').style.opacity};
        },[u,rule]);
        const start=await at(0),faded=await at(0.7),last=await at(await page.evaluate(()=>document.getElementById('atlas-clock').clock.outroEnd));
        assert.equal(start.overlay,'1',name);assert.equal(faded.overlay,'0',name+': 文字は後半の始めに消す');
        assert.equal(last.outside,0,name+': 最後は下線のほかに何も残らない');
        assert.deepEqual(last.row,[[0,0,0,0],[38,38,42,255],[38,38,42,255],[38,38,42,255],[0,0,0,0]],name+': 下線と同じ位置・色');
        // 端末と同じく親から合図を送ると、後半を流して done を返す
        if(name==='clock/') {
            await page.evaluate(()=>{window.__done=null;const t=performance.now();
                const frame=document.createElement('iframe');frame.style.cssText='position:fixed;inset:0;width:100%;height:100%;border:0';frame.src=location.href;
                addEventListener('message',e=>{if(e.data?.type==='signage:outro')window.__done=[e.data.state,performance.now()-t];});
                frame.onload=()=>{const wait=setInterval(()=>{if(frame.contentDocument.getElementById('atlas-clock').clock?.ready){clearInterval(wait);
                    window.__sent=performance.now();frame.contentWindow.postMessage({type:'signage:outro',rule:{left:56,right:1864,y:172.5,scale:1}},location.origin);}},50);};
                document.body.append(frame);});
            await page.waitForFunction(()=>window.__done,null,{timeout:30000});
            const [state,elapsed]=await page.evaluate(()=>[window.__done[0],performance.now()-window.__sent]);
            assert.equal(state,'done');assert.ok(elapsed>3000&&elapsed<6000,'後半はおよそ3.2秒: '+elapsed);
        }
        await page.close();
    }
    assert.deepEqual(errors,[]);
    console.log('Handoff: controller swap/cancel/skip/silent/reduced, transit wait-for-go and kept rule, atlas outro fade/final rule/done passed');
    await browser.close();
})().catch(error=>{console.error(error);process.exit(1);});
