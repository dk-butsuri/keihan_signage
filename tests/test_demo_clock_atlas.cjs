const {chromium}=require('playwright');
const assert=require('assert/strict');
(async()=>{
    const root=(process.env.SIGNAGE_DEMO_URL||'http://127.0.0.1:18745/demo').replace(/\/$/,'');
    const browser=await chromium.launch();
    const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(root+'/clock-atlas');
    await page.waitForFunction(()=>document.getElementById('atlas-clock').clock?.ready,null,{timeout:30000});
    const at=(t,now)=>page.evaluate(([t,now])=>{
        const clock=document.getElementById('atlas-clock');clock.clock.renderAt(t,now);
        const canvas=clock.querySelector('canvas'),data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
        let lit=0,sum=0;for(let i=3;i<data.length;i+=16){if(data[i]>40)lit++;sum=(sum*31+data[i])%1000000007;}
        return {lit,sum,time:clock.querySelector('.clock-time').textContent,seconds:clock.querySelector('.clock-seconds').textContent,
            date:clock.querySelector('.clock-date').textContent,opacity:clock.querySelector('.clock-overlay').style.opacity};
    },[t,now]);
    const morning=Date.UTC(2026,10,15,22,41,7);
    const opening=await at(0.4,morning),first=await at(30,morning),later=await at(60,morning+30000);
    assert.equal(opening.opacity,'0','立ち上げの最初は時計を出さない');
    assert.ok(opening.lit<first.lit,'波が広がるにつれて地図が描かれる');
    assert.equal(first.time,'07:41');assert.equal(first.seconds,':07');assert.equal(first.date,'2026.11.16 月');assert.equal(first.opacity,'1');
    assert.equal(later.time,'07:41');assert.equal(later.seconds,':37');
    assert.notEqual(first.sum,later.sum,'視点が動き続ける');
    const groups=['京阪','大阪メトロ','JR'].map(name=>({mark:'○',name,status:'平常運転',lines:[]}));
    const info=(ops,weather)=>page.evaluate(([ops,weather])=>{
        const clock=document.getElementById('atlas-clock');clock.clock.showInfo(ops,weather);
        return {ops:clock.querySelector('.ops').hidden?null:clock.querySelector('.ops-groups').textContent,
            lines:clock.querySelector('.ops-lines').hidden?null:clock.querySelector('.ops-lines').textContent,
            weather:clock.querySelector('.wx').hidden?null:clock.querySelector('.wx').textContent};
    },[ops,weather]);
    const calm=await info(groups,{available:true,warnings:[],previews:[]});
    assert.equal(calm.ops,'運行情報京阪大阪メトロJR','平常のときは社名だけ');assert.equal(calm.lines,null);assert.equal(calm.weather,null);
    groups[2]={mark:'△',name:'JR',status:'列車遅延',lines:[{name:'学研都市線',ticker_name:'JR学研都市線',status:'列車遅延',detail:'',announced_time:'2026-11-16T07:12:00+09:00'}]};
    const rough=await info(groups,{available:true,as_of:'07:30',area_count:7,all_label:'7市すべて',unit:'市',previews:[],
        warnings:[{name:'暴風警報',level:3,tone:'l3',cities:['寝屋川市','枚方市']}]});
    assert.match(rough.ops,/△JR列車遅延/);assert.equal(rough.lines,'JR学研都市線列車遅延07:12 発表');
    assert.match(rough.weather,/気象警報07:30 時点.*レベル3暴風警報寝屋川市・枚方市/);
    assert.equal((await info(null,null)).ops,null,'情報が取れないときは出さない');
    await page.getByRole('combobox',{name:'運行情報と気象警報'}).selectOption('sample');
    await page.waitForFunction(()=>/\d+ \/ \d+$/.test(document.querySelector('#atlas-clock .ops-lines').textContent));
    assert.equal(await page.locator('#atlas-clock .ops-lines span').count(),10,'路線は3行ずつ');
    assert.match(await page.evaluate(()=>getComputedStyle(document.querySelector('#atlas-clock .ops-lines')).fontFamily),/Noto Sans JP/);
    const pageAt=now=>page.evaluate(now=>{const clock=document.getElementById('atlas-clock');clock.clock.renderAt(30,now);return clock.querySelector('.ops-lines').textContent;},now);
    const p1=await pageAt(morning+1000),p1b=await pageAt(morning+3000),p2=await pageAt(morning+5000);
    assert.equal(p1,p1b,'4秒のあいだは同じ3路線');assert.notEqual(p1,p2,'4秒ごとに次の路線へ切り替わる');
    await page.getByRole('button',{name:'立ち上げからやり直す'}).click();
    await page.waitForFunction(()=>Number(document.querySelector('#atlas-clock .clock-stage').dataset.time)>0.2&&Number(document.querySelector('#atlas-clock .clock-stage').dataset.time)<5);
    await page.setViewportSize({width:390,height:844});
    await page.waitForTimeout(200);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
    assert.deepEqual(errors,[]);
    await browser.close();
    console.log('ok');
})().catch(error=>{console.error(error);process.exit(1);});
