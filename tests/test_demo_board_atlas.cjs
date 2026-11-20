// バス「測量」と電車「測量」: 発車案内が主役で、時計は右上に小さく出る。
const {chromium}=require('playwright');
const assert=require('assert/strict');
(async()=>{
    const root=(process.env.SIGNAGE_DEMO_URL||'http://127.0.0.1:18745/demo').replace(/\/$/,'');
    const browser=await chromium.launch(),errors=[];
    try {
        const page=await browser.newPage({viewport:{width:1920,height:1080}});
        page.on('pageerror',error=>errors.push(error.message));
        const calm=[{mark:'○',name:'京阪',status:'平常運転',lines:[]}],noWeather={available:true,warnings:[],previews:[]};
        const show=board=>page.evaluate(([calm,weather,board])=>{
            const clock=document.getElementById('atlas-clock');clock.clock.showInfo(calm,weather,board);
            const rows=[...clock.querySelectorAll('.board-row:not([hidden])')].map(row=>row.textContent);
            return {rows,empty:clock.querySelector('.board-empty')?.textContent||null,heads:[...clock.querySelectorAll('.board-col-head')].map(h=>h.textContent),
                name:clock.querySelector('[data-board=name]').textContent,time:getComputedStyle(clock.querySelector('.clock-time')).fontSize};
        },[calm,noWeather,board]);

        await page.goto(root+'/bus-atlas');
        await page.waitForFunction(()=>document.getElementById('atlas-clock').clock?.ready,null,{timeout:30000});
        let view=await show({buses:[
            {route_id:'22',destination:'京阪香里園',stop_name:'同志社香里',arrival_time:'15:08 到着予定',status:'約8分後に到着',terminal_arrival_time:'15:27'},
            {route_id:'22',destination:'寝屋川市駅行',stop_name:'同志社香里',arrival_time:'15:20 到着予定',status:'約20分後に到着',scheduled_time:'15:05',delay_text:'約15分遅れ',delay_minutes:15},
            {route_id:'22',destination:'京阪香里園',stop_name:'同志社香里',arrival_time:'14:59 到着予定',status:'到着済'}],error:null});
        assert.equal(view.time,'64px','時計は小さく');
        assert.deepEqual(view.heads,[],'バスは方面の見出しを出さない');
        assert.equal(view.rows[0],'15:08発香里園行終点 15:27着あと8分');
        assert.match(view.rows[1],/寝屋川市駅行定刻 15:05·約15分遅れ/);
        assert.match(view.rows[2],/到着済$/);
        assert.equal((await show({buses:[],error:null})).empty,'いまはバスの情報がありません');
        assert.equal((await show(null)).empty,'バスの情報を取得できていません','取れないときは古い案内を出さない');
        await page.getByRole('combobox',{name:'表示する情報'}).selectOption('sample');
        await page.waitForFunction(()=>document.querySelectorAll('#atlas-clock .board-row').length>0&&!document.querySelector('#atlas-clock .wx').hidden);
        assert.ok(await page.evaluate(()=>[...document.querySelectorAll('#atlas-clock .board-row:not([hidden])')].every(row=>row.getBoundingClientRect().bottom<=document.querySelector('#atlas-clock .board-list').getBoundingClientRect().bottom+.5)),'入りきらない行は隠す');

        await page.goto(root+'/train-atlas');
        await page.waitForFunction(()=>document.getElementById('atlas-clock').clock?.ready,null,{timeout:30000});
        const train=(extra)=>({kind:'準急',time:'15:06',destination:'出町柳',delay:0,status:'',minutes_remaining:21,is_this_station:false,sub_station_name:'寝屋川市',sub_station_time:'15:03',sub_station_verb:'着',...extra});
        view=await show({station_name:'香里園',error:null,up_trains:[train({}),train({kind:'特急',delay:18,estimate_unreliable:true,minutes_remaining:null,position:'寝屋川市 → 香里園 の間',stopped_minutes:14})],
            down_trains:[train({destination:'淀屋橋',minutes_remaining:0})]});
        assert.deepEqual(view.heads,['大阪方面淀屋橋・中之島','京都方面出町柳・三条']);
        assert.match(view.rows[0],/淀屋橋行.*まもなく$/);
        assert.equal(view.rows[1],'準急15:06出町柳行寝屋川市 15:03着あと21分');
        assert.equal(view.rows[2],'特急15:06出町柳行14分停止·寝屋川市 → 香里園 の間18分遅れ','予測が立たないときは遅れを右に');
        assert.doesNotMatch(view.rows.join(),/null|undefined/);
        assert.equal((await show({station_name:'',up_trains:[],down_trains:[],error:'18'})).empty,'列車の情報を取得できていません','読めないエラーは言い換える');
        await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        assert.deepEqual(errors,[]);
        console.log('ok');
    } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
