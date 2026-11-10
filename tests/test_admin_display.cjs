const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

(async()=>{
    const browser=await chromium.launch({headless:true});
    try {
        const page=await browser.newPage({viewport:{width:1440,height:1000}});
        const errors=[];
        page.on('pageerror',error=>errors.push(error.message));
        const config={
            features:{trains:true,buses:true,delays:true,extra:false},
            trains:{station_id:18,min_minutes_until:15,max_trains_per_direction:6,sub_station_id:17,map_compress_ranges:[[5,10],[14,15]],force_suspended:false},
            buses:{stop_name:'Test',stop_numbers:[1,2],custom:null},
            delays:{providers:'all',only_lines:{jrw:['大阪環状線']}},
            intervals:{train_seconds:60,bus_seconds:60,delay_seconds:600},
            extra_section:{values:['a','b']},
        };
        const now=new Date().toISOString();
        let status={now,trains:{enabled:true,last_success:now,position_created_at:now,active:30,error:null,suspended:false,forced:false,unreliable_ratio:0.1,interval_seconds:60},
            buses:{enabled:true,last_success:now,count:6,error:null,interval_seconds:60},
            delays:{enabled:true,last_success:now,affected:2,error:null,interval_seconds:600}};
        let schedule={default_mode:'transit',rules:[{time:'18:30',mode:'clock'}]};
        let savedConfig, modeRequest, transitUp=true;
        const authed=request=>request.headers()['authorization']==='Bearer secret';
        await page.route('http://admin.test/**',route=>{
            const request=route.request(),pathname=new URL(request.url()).pathname,method=request.method();
            if(pathname==='/admin')return route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(__dirname,'../controller/templates/admin.html'),'utf8')});
            if(pathname==='/api/auth')return route.fulfill({status:authed(request)?204:401,body:''});
            if(pathname==='/api/config/json'&&method==='GET')return route.fulfill({json:config});
            if(pathname==='/api/config'&&method==='GET')return route.fulfill({contentType:'text/plain',body:'features:\n  trains: true\n'});
            if(pathname==='/api/config/json'&&method==='PUT'){
                if(!authed(request))return route.fulfill({status:401,json:{detail:'Unauthorized'}});
                savedConfig=JSON.parse(request.postData());return route.fulfill({json:{ok:true,reloaded:true}});
            }
            if(pathname==='/api/schedule'&&method==='PUT'){schedule=JSON.parse(request.postData());return route.fulfill({json:schedule});}
            if(pathname==='/api/schedule')return route.fulfill({json:schedule});
            if(pathname==='/api/mode'&&method==='POST'){modeRequest=JSON.parse(request.postData());return route.fulfill({json:{mode:modeRequest.mode,source:'manual',override_until:new Date(Date.now()+3600e3).toISOString()}});}
            if(pathname==='/api/mode')return route.fulfill({json:{mode:'transit',source:'schedule',override_until:null}});
            if(pathname==='/api/mode/stream')return route.fulfill({contentType:'text/event-stream',body:''});
            if(pathname==='/api/displays')return route.fulfill({json:{count:1,connected_since:[now]}});
            if(pathname==='/transit/api/status')return transitUp?route.fulfill({json:status}):route.fulfill({status:502,json:{detail:'Upstream unreachable'}});
            return route.fulfill({contentType:'text/html',body:'<body style="background:#123"></body>'});
        });
        await page.goto('http://admin.test/admin');
        await page.waitForFunction(()=>document.getElementById('status-list').children.length>=5);
        assert.match(await page.locator('#overall-text').textContent(),/正常/);
        assert.match(await page.locator('#status-list').textContent(),/1台が表示中/);
        assert.equal(await page.locator('#login-card').isVisible(),true);
        assert.equal(await page.locator('#to-clock').isDisabled(),true,'controls are locked before login');

        await page.locator('#token').fill('wrong');await page.locator('#login-form button').click();
        await page.waitForFunction(()=>document.getElementById('login-msg').textContent.includes('違います'));
        await page.locator('#token').fill('secret');await page.locator('#login-form button').click();
        await page.waitForSelector('#login-card',{state:'hidden'});
        assert.equal(await page.locator('#to-clock').isDisabled(),false);

        await page.locator('#to-clock').click();
        await page.waitForFunction(()=>document.getElementById('mode-name').textContent==='時計');
        assert.deepEqual(modeRequest,{mode:'clock',override_minutes:60});
        assert.equal(await page.locator('#back-to-schedule').isVisible(),true);

        await page.locator('#rule-time').fill('07:30');await page.locator('#add-rule').click();
        await page.waitForFunction(()=>document.getElementById('rules').children.length===2);
        assert.deepEqual(schedule.rules.map(r=>r.time).sort(),['07:30','18:30']);

        assert.equal(await page.locator('#save-config').isDisabled(),true,'nothing to save before an edit');
        await page.locator('#b-stop').fill('駅 "東口"');
        await page.locator('#b-numbers').fill('1, 3');
        await page.locator('#t-sub').fill('');
        await page.locator('#save-config').click();
        await page.waitForFunction(()=>document.getElementById('config-msg').textContent.includes('反映'));
        assert.equal(savedConfig.buses.stop_name,'駅 "東口"');
        assert.deepEqual(savedConfig.buses.stop_numbers,[1,3]);
        assert.equal(savedConfig.trains.sub_station_id,null);
        for(const [key,value] of [['features.extra',false],['trains.map_compress_ranges',[[5,10],[14,15]]],['buses.custom',null],['delays',config.delays],['extra_section',config.extra_section]])
            assert.deepEqual(key.split('.').reduce((o,k)=>o[k],savedConfig),value,`${key} should be preserved`);

        status={...status,trains:{...status.trains,error:'列車位置を取得できていないため表示を止めています（12:00時点の情報）'},buses:{...status.buses,error:'のりば1: timeout'}};
        await page.evaluate(()=>refreshStatus());
        assert.match(await page.locator('#overall-text').textContent(),/問題/);
        assert.match(await page.locator('#status-list').textContent(),/列車の表示を止めています/);
        assert.match(await page.locator('#status-list').textContent(),/一部を取得できていません/);
        transitUp=false;await page.evaluate(()=>refreshStatus());
        assert.match(await page.locator('#status-list').textContent(),/応答しません/);

        await page.setViewportSize({width:390,height:844});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal scroll on a phone');
        assert.deepEqual(errors,[]);
        console.log('Admin dashboard: status summary, login lock, mode switch, schedule edit, config save keeps unexposed settings, failure states.');
    } finally {
        await browser.close();
    }
})().catch(error=>{console.error(error);process.exit(1);});
