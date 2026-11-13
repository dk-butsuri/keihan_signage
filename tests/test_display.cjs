const {chromium}=require('playwright');const fs=require('fs');const assert=require('assert/strict');const path=require('path');const os=require('os');
const root=path.resolve(__dirname,'..'),out=process.env.SIGNAGE_SCREENSHOTS || fs.mkdtempSync(path.join(os.tmpdir(),'signage-display-'));
async function assertBusRemainingTime(page, mode) {
    const rows = await page.locator('#'+mode+'-bus-list > div').evaluateAll(rows=>rows.slice(0,2).map(row=>{
        const field=name=>row.querySelector(`[data-field="${name}"]`);
        const card=row.getBoundingClientRect(),status=field('status').getBoundingClientRect(),depart=field('arrival').getBoundingClientRect(),destination=field('destination').getBoundingClientRect();
        return {status:field('status').textContent,arrival:field('arrival').textContent,terminal:field('terminal-time').textContent,
            fits:status.bottom<=card.bottom&&status.right<=card.right,
            stacked:destination.top>=depart.bottom-.1,
            noStopName:!row.textContent.includes('同志社香里'),
            bold:getComputedStyle(field('destination')).fontWeight==='700'};
    }));
    assert.deepEqual(rows.map(row=>row.status),['約4分後','約11分後']);
    assert.ok(rows.every(row=>row.fits&&row.stacked&&row.noStopName&&row.bold&&row.arrival.endsWith('発')),JSON.stringify(rows));
    assert.deepEqual(rows.map(row=>row.terminal),['12:32着','12:33着']);
}
async function assertBusFallbacks(page) {
    await page.evaluate(()=>{
        const original=busData;
        busData={buses:[
            {...original.buses[0],terminal_arrival_time:null},
            {...original.buses[1],stop_arrival_is_scheduled:true},
            {...original.buses[0],status:'運休'},
            {...original.buses[0],terminal_arrival_is_estimated:true},
        ]};
        renderBuses();window.savedBusData=original;
    });
    const cards=page.locator('#normal-bus-list .bus-card');
    assert.equal(await cards.nth(0).locator('[data-field="terminal-time"]').textContent(),'');
    assert.equal(await cards.nth(1).locator('[data-field="status"]').textContent(),'定刻');
    assert.equal(await cards.nth(2).locator('[data-field="arrival"]').textContent(),'—');
    assert.equal(await cards.nth(2).locator('[data-field="terminal-time"]').textContent(),'');
    assert.equal(await cards.nth(2).locator('[data-field="status"]').textContent(),'運休');
    assert.match(await cards.nth(3).locator('[data-field="terminal-time"]').textContent(),/着（推定）$/);
    await page.evaluate(()=>{busData=window.savedBusData;delete window.savedBusData;renderBuses();});
}
async function assertStableClock(page) {
    const geometry = await page.evaluate(() => {
        const shape = element => {
            const {x, width} = element.getBoundingClientRect();
            return {x, width};
        };
        return ['00:00:00', '01:11:11', '09:59:59', '10:00:00', '11:11:11', '18:48:48', '23:59:59'].map(time => {
            setClockDigits(document.getElementById('clock-time'), time.slice(0,5));
            setClockDigits(document.getElementById('clock-seconds'), time.slice(5));
            return [document.getElementById('clock-date'), document.getElementById('clock-time'), document.getElementById('clock-seconds'), ...document.querySelectorAll('.clock-digit, .clock-separator')].map(shape);
        });
    });
    for (const sample of geometry.slice(1)) assert.deepEqual(sample, geometry[0]);
}
async function assertDelayStopCenters(page) {
    const offsets=await page.locator('.train-stop-badge:visible').evaluateAll(badges=>badges.map(badge=>{
        const metric=badge.closest('.departure-status, .next-content').querySelector('.train-delay-metric');
        if(!metric)return null;
        const first=metric.firstElementChild.getBoundingClientRect(),last=metric.lastElementChild.getBoundingClientRect(),stop=badge.getBoundingClientRect();
        return {delay:metric.textContent,stop:badge.textContent,offset:(first.left+last.right-stop.left-stop.right)/2};
    }).filter(Boolean));
    assert.ok(offsets.length>0);
    assert.ok(offsets.every(sample=>Math.abs(sample.offset)<.1),JSON.stringify(offsets));
}
async function assertDepartureDetails(page) {
    const samples = [
        {estimate_unreliable:true, position:'萱島に停車中（停止5分）', delay:6, status:''},
        {estimate_unreliable:true, position:'枚方公園→光善寺で停止（25分以上）', delay:120, estimated_delay_minutes:150, status:'遅れ150分以上'},
        {estimate_unreliable:false, sub_station_name:'寝屋川市', sub_station_time:'17:51', sub_station_verb:'着', delay:3, status:''},
        {kind:'急行', time:'00:01', destination:'寝屋川市', minutes_remaining:18, estimate_unreliable:false, sub_station_name:'寝屋川市', sub_station_time:'00:47', sub_station_verb:'着', delay:43, status:''},
    ];
    await page.evaluate(samples => renderTrains('up', samples.map(sample => ({...trainData.up_trains[0], minutes_remaining:30, ...sample}))), samples);
    const rows = await page.locator('#normal-up-list > div').evaluateAll(rows => rows.map(row => {
        const sub=row.querySelector('[data-field="sub"]'), delay=row.querySelector('[data-field="delay"]');
        const range=document.createRange();range.selectNodeContents(sub);
        const right=row.querySelector('.departure-status').getBoundingClientRect().left, bottom=row.getBoundingClientRect().bottom;
        const time=row.querySelector('[data-field="time"]').getBoundingClientRect(),card=row.getBoundingClientRect(),primaryBottom=time.bottom;
        const label=row.querySelector('.departure-time-label'),labelRect=row.querySelector('.departure-original').getBoundingClientRect();
        const destination=row.querySelector('[data-field="destination"]');
        return {groupCenterOffset:((label.hidden?time.top:labelRect.top)+(sub.hidden?time.bottom:sub.getBoundingClientRect().bottom))/2-card.top-card.height/2,label:label.hidden?'':label.textContent,hiddenSub:sub.hidden,gap:sub.getBoundingClientRect().top-primaryBottom,destinationFits:destination.scrollWidth<=destination.clientWidth+1,destinationLines:destination.clientHeight,text:sub.textContent, stop:row.querySelector('.train-stop-badge')?.getAttribute('aria-label'), locationGap:sub.classList.contains('train-location')?sub.getBoundingClientRect().top-destination.getBoundingClientRect().bottom:null, delayText:delay.textContent,scheduledDelay:row.querySelector('[data-field="scheduled-delay"]').textContent, client:sub.clientHeight, scroll:sub.scrollHeight, width:sub.clientWidth, rects:[...range.getClientRects()].map(r=>({y:r.y,height:r.height,right:r.right})), clipped:sub.scrollHeight>sub.clientHeight+1,
            overlaps:[...range.getClientRects()].filter(r=>r.width && (r.right>right || r.bottom>bottom+1)).map(r=>({right:r.right,bottom:r.bottom}))};
    }));
    assert.ok(rows.every(row => !row.clipped && row.overlaps.length === 0 && (row.hiddenSub || row.gap >= 8) && row.destinationFits && row.destinationLines <= 32), JSON.stringify(rows));
    assert.deepEqual(rows.map(row=>row.hiddenSub),[false,false,true,true]);
    assert.equal(rows[0].text,'萱島停車中');
    assert.equal(rows[0].stop,'停止5分');
    assert.equal(rows[1].text,'枚方公園光善寺');
    assert.equal(rows[1].stop,'停止25分以上');
    assert.ok(rows.every(row=>Math.abs(row.groupCenterOffset)<.1),JSON.stringify(rows));
    assert.ok(rows.every(row=>row.label==='推定'),JSON.stringify(rows));
    assert.ok(rows.every(row=>row.hiddenSub || Math.abs(row.gap-10)<.1),JSON.stringify(rows));
    assert.equal(rows[0].scheduledDelay,'6分遅れ');
    assert.equal(rows[0].delayText,'5分停止');
    assert.equal(rows[1].scheduledDelay,'150分以上遅れ');
    assert.equal(rows[1].delayText,'25分以上停止');
    await page.screenshot({path:out+'/normal-details.png'});
    await page.evaluate(()=>renderTrains('up',['萱島に停車中（停止5分）','守口市で停止（停止7分）','寝屋川市を通過中'].map(position=>({
        ...trainData.up_trains[0],estimate_unreliable:true,position,
    }))));
    assert.deepEqual(await page.locator('#normal-up-list .location-state').allTextContents(),['停車中','停止','通過中']);
    assert.equal(await page.locator('#normal-up-list .train-location svg').count(),0);

    await page.evaluate(() => renderTrains('up',trainData.up_trains,trainData.error));
}
async function assertCompactDepartures(page) {
    const samples=[
        {minutes_remaining:39,delay:0}, {minutes_remaining:40,delay:0}, {minutes_remaining:60,delay:8},
        {minutes_remaining:null,delay:0},
        {time:'00:06',minutes_remaining:50,estimate_unreliable:true,position:'大和田→萱島で停止（19分以上）'},
        {time:'20:00',minutes_remaining:16},
        {minutes_remaining:40,is_this_station:true},
    ];
    await page.evaluate(samples=>renderTrains('up',samples.map(sample=>({...trainData.up_trains[0],...sample}))),samples);
    const rows=await page.locator('#normal-up-list > div').evaluateAll(rows=>rows.map(row=>{
        const r=row.getBoundingClientRect(),dest=row.querySelector('[data-field="destination"]').getBoundingClientRect(),status=row.querySelector('.departure-status').getBoundingClientRect();
        const label=row.querySelector('.departure-time-label').getBoundingClientRect(),time=row.querySelector('.departure-time').getBoundingClientRect();
        const clock=row.querySelector('.departure-clock'),c=clock.getBoundingClientRect();
        const baselines=[row.querySelector('.departure-time-label'),row.querySelector('.departure-time')].map(span=>{
            const probe=document.createElement('i');probe.style.cssText='display:inline-block;width:0;height:0;margin:0;padding:0;vertical-align:baseline';
            span.append(probe);const baseline=probe.getBoundingClientRect().top;probe.remove();return baseline;
        });
        return {compact:row.classList.contains('departure-compact'),height:r.height,hiddenSub:row.querySelector('[data-field="sub"]').hidden,
            timeGroupBalanced:c.top>=r.top&&c.bottom<=r.bottom&&label.right<=time.left&&Math.abs(baselines[0]-baselines[1])<.1&&clock.scrollWidth<=clock.clientWidth+1,
            centered:Math.abs(dest.top+dest.height/2-r.top-r.height/2)<.1,
            statusFits:status.top>=r.top&&status.bottom<=r.bottom,
            delay:row.querySelector('[data-field="scheduled-delay"]').textContent};
    }));
    assert.deepEqual(rows.map(row=>row.compact),[false,false,false,false,true,true]);
    assert.ok(rows.filter(row=>row.compact).every(row=>row.height===72&&row.hiddenSub&&row.centered&&row.timeGroupBalanced&&row.statusFits),JSON.stringify(rows));
    assert.ok(rows.filter(row=>!row.compact).every(row=>row.height>=108&&row.statusFits),JSON.stringify(rows));
    assert.deepEqual(rows.filter(row=>!row.compact).map(row=>row.hiddenSub),[false,false,true,false]);
    assert.equal(rows[2].delay,'8分遅れ');
    await page.screenshot({path:out+'/normal-compact.png'});
    await page.evaluate(()=>renderTrains('up',trainData.up_trains,trainData.error));
}
async function assertTrainLabels(page) {
    await page.evaluate(()=>renderTrains('up',['準急','快速急行','区間急行','特急'].map((kind,index)=>({
        ...trainData.up_trains[0],kind,delay:0,destination:'寝屋川市',minutes_remaining:[18,28,37,45][index],
    }))));
    assert.deepEqual(await page.locator('#normal-up-list .train-kind-en').allTextContents(),['Sub exp.','Rapid exp.','Semi exp.','Ltd exp.']);
    const labels=await page.locator('#normal-up-list > div').evaluateAll(rows=>rows.map(row=>{
        const kind=row.querySelector('.train-kind'),destination=row.querySelector('.departure-destination');
        const sub=row.querySelector('.departure-secondary'),badge=sub.querySelector('.station-badge');
        return{japanese:getComputedStyle(kind.querySelector('.train-kind-ja')).fontSize,english:getComputedStyle(kind.querySelector('.train-kind-en')).fontSize,
            gap:getComputedStyle(kind).gap,destination:getComputedStyle(destination).fontSize,
            badge:badge?.getAttribute('aria-label'),arrival:sub.textContent.endsWith('着')};
    }));
    assert.ok(labels.every(r=>r.japanese==='24px'&&r.english==='14px'&&r.gap==='2px'&&r.destination==='30px'&&r.badge==='寝屋川市'&&r.arrival),JSON.stringify(labels));
    await page.screenshot({path:out+'/normal-english-badge.png'});
    await page.evaluate(()=>renderTrains('up',trainData.up_trains,trainData.error));
}
async function assertUncertainFollowingSchedule(page) {
    await page.evaluate(()=>renderTrains('up', [{
        ...trainData.up_trains[0],time:'23:45',delay:0,status:'',is_active:false,
        estimate_unreliable:true,minutes_remaining:null,position:null,
        sub_station_name:'寝屋川市',sub_station_time:'23:51',sub_station_verb:'着',
    }]));
    const row=page.locator('#normal-up-list > div').first();
    assert.equal(await row.locator('[data-field="time"]').textContent(),'未定');
    assert.equal(await row.locator('[data-field="scheduled-time"]').textContent(),'23:45');
    assert.equal(await row.locator('[data-field="time-label"]').isVisible(),true);
    assert.equal(await row.locator('[data-field="remaining"]').textContent(),'');
    assert.equal(await row.locator('[data-field="sub"]').isVisible(),false);
    assert.equal(await row.locator('[data-field="delay"]').isVisible(),false);
    await page.screenshot({path:out+'/uncertain-following-schedule.png'});
    await page.evaluate(()=>renderTrains('up',trainData.up_trains,trainData.error));
}
async function assertMinimumArrival(page) {
    const samples=[{minutes_remaining:14},{minutes_remaining:15},{minutes_remaining:null},{minutes_remaining:0},
        {minutes_remaining:14,estimate_unreliable:true,position:'大和田→萱島で停止（19分以上）'},
        {minutes_remaining:40,is_this_station:true},{minutes_remaining:40},{minutes_remaining:30}];
    await page.evaluate(samples=>renderTrains('up',samples.map((sample,index)=>({...trainData.up_trains[0],time:`0${index+1}:00`,...sample}))),samples);
    assert.deepEqual(await page.locator('#normal-up-list [data-field="scheduled-time"]').allTextContents(),['02:00','03:00','05:00','07:00','08:00']);
    await page.evaluate(()=>renderTrains('up',[{...trainData.up_trains[0],minutes_remaining:14}]));
    assert.equal(await page.locator('#normal-up-list > .empty').count(),1);
    await page.evaluate(()=>renderTrains('up',trainData.up_trains,trainData.error));
}
async function assertEstimatedTimes(page) {
    const base={kind:'準急',time:'17:47',destination:'枚方市',delay:6,status:'',minutes_remaining:18,is_this_station:false,estimate_unreliable:false,sub_station_name:'寝屋川市',sub_station_time:'17:50',sub_station_verb:'着'};
    const cases=[
        {change:{},time:'17:53',label:'推定',revised:true,struck:true},
        {change:{time:'23:58'},time:'00:04',label:'推定',revised:true,struck:true},
        {change:{estimate_unreliable:true,minutes_remaining:null,position:'萱島に停車中（停止5分）'},time:'未定',label:'推定',revised:true,struck:true,stop:'5分停止'},
        {change:{estimate_unreliable:true,minutes_remaining:null,delay:0},time:'未定',label:'推定',revised:true,struck:false},
        {change:{delay:120,estimated_delay_minutes:150},time:'未定',label:'推定',revised:true,struck:true},
        {change:{minutes_remaining:null},time:'未定',label:'推定',revised:true,struck:true},
        {change:{delay:0},time:'17:47',label:'定刻',revised:false,struck:false},
        {change:{time:'-'},time:'-',label:null,revised:false,struck:false},
    ];
    for(const sample of cases) {
        const train={...base,...sample.change};
        await page.evaluate(train=>renderTrains('up',Array.from({length:6},()=>({...train}))),train);
        for(const index of [0,4]) {
            const row=page.locator('#normal-up-list > div').nth(index);
            assert.equal(await row.locator('[data-field="time"]').textContent(),sample.time);
            assert.equal(await row.locator('[data-field="scheduled-time"]').textContent(),train.time);
            assert.equal(await row.locator('[data-field="original"]').isVisible(),sample.revised);
            assert.equal(await row.locator('[data-field="original"]').evaluate(el=>el.classList.contains('is-delayed')),sample.struck);
            assert.equal(await row.locator('[data-field="time-label"]').isVisible(),sample.label!==null);
            if(sample.label)assert.equal(await row.locator('[data-field="time-label"]').textContent(),sample.label);
            if(sample.revised) {
                assert.equal(await row.locator('.train-delay-metric').count(),0);
                assert.equal(await row.locator('[data-field="remaining"]').textContent(),sample.time==='未定'?'':'あと18分');
                assert.equal(await row.locator('[data-field="delay"]').isVisible(),!!sample.stop);
                if(sample.stop)assert.equal(await row.locator('[data-field="delay"]').textContent(),sample.stop);
            }
            const baseline=await row.evaluate(row=>{
                const spans=[row.querySelector('[data-field="time-label"]'),row.querySelector('[data-field="time"]')];
                if(spans[0].hidden||!row.classList.contains('departure-revised'))return 0;
                const ys=spans.map(span=>{const probe=document.createElement('i');probe.style.cssText='display:inline-block;width:0;height:0;padding:0;margin:0;vertical-align:baseline';span.append(probe);const y=probe.getBoundingClientRect().top;probe.remove();return y;});
                return Math.abs(ys[0]-ys[1]);
            });
            assert.ok(baseline<.1);
        }
    }
    await page.evaluate(()=>renderTrains('up',trainData.up_trains,trainData.error));
}
(async()=>{
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1920,height:1080}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const fixture={"station_name": "香里園", "up_trains": [{"kind": "準急", "time": "12:00", "destination": "出町柳", "delay": 14, "status": "", "minutes_remaining": 7, "is_this_station": false, "estimate_unreliable": false, "sub_station_name": "寝屋川市", "sub_station_time": "12:11", "sub_station_verb": "着"}, {"kind": "普通", "time": "12:09", "destination": "出町柳", "delay": 3, "status": "", "minutes_remaining": 5, "is_this_station": false, "estimate_unreliable": false, "sub_station_name": "寝屋川市", "sub_station_time": "12:08", "sub_station_verb": "着"}, {"kind": "快速急行", "time": "12:10", "destination": "枚方市", "delay": 10, "status": "", "minutes_remaining": 13, "is_this_station": false, "estimate_unreliable": false, "sub_station_name": "寝屋川市", "sub_station_time": "12:17", "sub_station_verb": "着"}, {"kind": "準急", "time": "12:24", "destination": "出町柳", "delay": 3, "status": "", "minutes_remaining": 20, "is_this_station": false, "estimate_unreliable": false, "sub_station_name": "寝屋川市", "sub_station_time": "12:24", "sub_station_verb": "着"}, {"kind": "普通", "time": "12:33", "destination": "出町柳", "delay": 0, "status": "", "minutes_remaining": 26, "is_this_station": false, "estimate_unreliable": false, "sub_station_name": "寝屋川市", "sub_station_time": "12:29", "sub_station_verb": "着"}, {"kind": "快速急行", "time": "12:34", "destination": "枚方市", "delay": 0, "status": "", "minutes_remaining": 27, "is_this_station": false, "estimate_unreliable": false, "sub_station_name": "寝屋川市", "sub_station_time": "12:31", "sub_station_verb": "着"}], "down_trains": [{"kind": "普通", "time": "12:06", "destination": "中之島", "delay": 0, "status": "", "minutes_remaining": 0, "is_this_station": true, "estimate_unreliable": false, "sub_station_name": "寝屋川市", "sub_station_time": "12:13", "sub_station_verb": "着"}, {"kind": "快速急行", "time": "12:07", "destination": "淀屋橋", "delay": 0, "status": "", "minutes_remaining": 0, "is_this_station": false, "estimate_unreliable": false, "sub_station_name": "寝屋川市", "sub_station_time": "12:10", "sub_station_verb": "着"}, {"kind": "準急", "time": "12:18", "destination": "淀屋橋", "delay": 0, "status": "", "minutes_remaining": 11, "is_this_station": false, "estimate_unreliable": false, "sub_station_name": "寝屋川市", "sub_station_time": "12:21", "sub_station_verb": "着"}, {"kind": "普通", "time": "12:30", "destination": "中之島", "delay": 0, "status": "", "minutes_remaining": 23, "is_this_station": false, "estimate_unreliable": false, "sub_station_name": "寝屋川市", "sub_station_time": "12:37", "sub_station_verb": "着"}, {"kind": "快速急行", "time": "12:31", "destination": "淀屋橋", "delay": 0, "status": "", "minutes_remaining": 24, "is_this_station": false, "estimate_unreliable": false, "sub_station_name": "寝屋川市", "sub_station_time": "12:34", "sub_station_verb": "着"}, {"kind": "準急", "time": "12:42", "destination": "淀屋橋", "delay": 0, "status": "", "minutes_remaining": 35, "is_this_station": false, "estimate_unreliable": false, "sub_station_name": "寝屋川市", "sub_station_time": "12:45", "sub_station_verb": "着"}], "buses": [{"destination": "京阪香里園", "arrival_time": "12:13 着予定", "status": "6分後", "route_id": "22"}, {"destination": "寝屋川市駅", "arrival_time": "12:21 着予定", "status": "14分後", "route_id": "22"}, {"destination": "京阪香里園", "arrival_time": "12:32 着予定", "status": "25分後", "route_id": "22"}, {"destination": "寝屋川市駅", "arrival_time": "12:40 着予定", "status": "33分後", "route_id": "22"}, {"destination": "京阪香里園", "arrival_time": "12:52 着予定", "status": "45分後", "route_id": "22"}, {"destination": "寝屋川市駅", "arrival_time": "13:00 着予定", "status": "53分後", "route_id": "22"}], "delays": [{"line": "京阪本線", "status": "列車遅延", "detail": "京阪線は、一部の列車に遅れが出ています。", "announced_time": "2026-11-06T12:03:02+09:00"}, {"line": "JR 学研都市線", "status": "列車遅延", "detail": "学研都市線は、京橋駅での信号確認の影響で、列車に遅れが出ています。", "announced_time": "2026-11-06T11:49:02+09:00"}]};
const line={"suspended": false, "as_of": "12:06:40", "total": 32, "stopped": 9, "station_id": 18, "stations": [{"number": 4, "name": "京橋"}, {"number": 5, "name": "野江"}, {"number": 6, "name": "関目"}, {"number": 7, "name": "森小路"}, {"number": 8, "name": "千林"}, {"number": 9, "name": "滝井"}, {"number": 10, "name": "土居"}, {"number": 11, "name": "守口市"}, {"number": 12, "name": "西三荘"}, {"number": 13, "name": "門真市"}, {"number": 14, "name": "古川橋"}, {"number": 15, "name": "大和田"}, {"number": 16, "name": "萱島"}, {"number": 17, "name": "寝屋川市"}, {"number": 18, "name": "香里園"}, {"number": 19, "name": "光善寺"}, {"number": 20, "name": "枚方公園"}, {"number": 21, "name": "枚方市"}, {"number": 22, "name": "御殿山"}, {"number": 23, "name": "牧野"}, {"number": 24, "name": "樟葉"}], "trains": [{"direction": "up", "position": 6, "kind": "普通", "delay": 5, "stopped_minutes": null, "stopped_lower_bound": false}, {"direction": "up", "position": 9.6, "kind": "特急", "delay": 6, "stopped_minutes": null, "stopped_lower_bound": false}, {"direction": "up", "position": 13, "kind": "普通", "delay": 9, "stopped_minutes": null, "stopped_lower_bound": false}, {"direction": "up", "position": 15.3, "kind": "快速急行", "delay": 14, "stopped_minutes": 12, "stopped_lower_bound": false}, {"direction": "up", "position": 16, "kind": "普通", "delay": 15, "stopped_minutes": 14, "stopped_lower_bound": false}, {"direction": "up", "position": 17, "kind": "普通", "delay": 16, "stopped_minutes": 16, "stopped_lower_bound": false}, {"direction": "up", "position": 17.6, "kind": "準急", "delay": 22, "stopped_minutes": 18, "stopped_lower_bound": false}, {"direction": "up", "position": 19.3, "kind": "特急", "delay": 18, "stopped_minutes": 15, "stopped_lower_bound": false}, {"direction": "up", "position": 20.6, "kind": "普通", "delay": 17, "stopped_minutes": 13, "stopped_lower_bound": false}, {"direction": "up", "position": 22, "kind": "急行", "delay": 19, "stopped_minutes": 15, "stopped_lower_bound": false}, {"direction": "up", "position": 23.3, "kind": "普通", "delay": 21, "stopped_minutes": 17, "stopped_lower_bound": false}, {"direction": "up", "position": 24, "kind": "特急", "delay": 20, "stopped_minutes": 16, "stopped_lower_bound": false}, {"direction": "down", "position": 21.3, "kind": "快速急行", "delay": 10, "stopped_minutes": null, "stopped_lower_bound": false}, {"direction": "down", "position": 19.6, "kind": "普通", "delay": 12, "stopped_minutes": null, "stopped_lower_bound": false}, {"direction": "down", "position": 18.6, "kind": "準急", "delay": 14, "stopped_minutes": null, "stopped_lower_bound": false}, {"direction": "down", "position": 14.599999999999998, "kind": "特急", "delay": 16, "stopped_minutes": null, "stopped_lower_bound": false}, {"direction": "down", "position": 12, "kind": "普通", "delay": 15, "stopped_minutes": null, "stopped_lower_bound": false}, {"direction": "down", "position": 8.3, "kind": "快速急行", "delay": 14, "stopped_minutes": null, "stopped_lower_bound": false}, {"direction": "down", "position": 5, "kind": "普通", "delay": 13, "stopped_minutes": null, "stopped_lower_bound": false}], "outside": {"up_osaka": 1, "down_osaka": 1, "up_kyoto": 5, "down_kyoto": 6}, "outside_stopped": {"up_osaka": 0, "down_osaka": 0, "up_kyoto": 0, "down_kyoto": 0}, "directions": {"up": {"state": "stopped", "next": [{"kind": "準急", "destination": "出町柳", "delay": 22, "position_text": "寝屋川市 → 香里園 の間", "stopped_minutes": 18, "is_active": true}, {"kind": "普通", "destination": "出町柳", "delay": 16, "position_text": "寝屋川市に停車中", "stopped_minutes": 16, "is_active": true}]}, "down": {"state": "delayed", "next": [{"kind": "普通", "destination": "中之島", "delay": 15, "position_text": "光善寺 → 香里園 の間", "stopped_minutes": null, "is_active": true}, {"kind": "快速急行", "destination": "淀屋橋", "delay": 14, "position_text": "枚方公園 → 光善寺 の間", "stopped_minutes": null, "is_active": true}]}}};
fixture.buses[0].destination='京阪香里園行';fixture.buses[1].destination='寝屋川市駅行';
fixture.buses[0].status='約4分後に到着';fixture.buses[1].status='約11分後に到着';
fixture.buses.forEach((bus,i)=>{
    bus.stop_name='同志社香里';
    const [h,m]=bus.arrival_time.match(/(\d+):(\d+)/).slice(1).map(Number),minutes=h*60+m+(i%2?12:19);
    bus.terminal_arrival_time=String(Math.floor(minutes/60)%24).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');
});
await page.clock.install({time:new Date('2026-11-06T12:07:02+09:00')});
fixture.delays.unshift({line:'Long notice',status:'お知らせ',detail:'very long notice '.repeat(1000)});
let failure=false;const cfg={features:{trains:true,buses:true,delays:true},buses:{stop_name:'同志社香里'}};
const html=()=>fs.readFileSync(root+'/templates/minimal/index.html','utf8').replace('{{ config | tojson }}',JSON.stringify(cfg));
await page.route('http://signage.test/**',async route=>{
 const path=new URL(route.request().url()).pathname;
 if(path==='/transit/')return route.fulfill({contentType:'text/html',body:html()});
 const name=path.split('/').at(-1);
 if(failure && ['trains','line','buses'].includes(name))return route.fulfill({status:503,contentType:'application/json',body:'{"detail":"test"}'});
 const data=name==='trains'?fixture:name==='line'?line:name==='buses'?{buses:fixture.buses}:name==='delays'?{delays:fixture.delays,groups:['京阪','大阪メトロ','JR','大阪モノレール','近鉄','その他の私鉄'].map((name,i)=>({name,mark:i===0||i===2?'△':'○',status:i===0||i===2?'列車遅延':'平常運転',lines:fixture.delays.filter(d=>i===0?d.line.startsWith('京阪'):i===2?d.line.startsWith('JR'):false).map(d=>({...d,name:d.line,ticker_name:d.line}))}))}:name==='time'?{ts:Date.parse('2026-11-06T12:07:02+09:00')/1000,ntp_rtt_ms:1}:{};
 return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
});
await page.goto('http://signage.test/transit/?motion=off');await page.evaluate(()=>document.fonts.ready);await page.locator('#normal-up-list > div').first().waitFor();await page.screenshot({path:out+'/normal.png'});
assert.equal(await page.locator('#normal-delay-list > div').count(),6);assert.equal(await page.locator('#normal-delay-list').textContent().then(t=>t.includes('Long notice')),false);
assert.equal(await page.locator('#normal-up-list > div').count(),3);assert.equal(await page.locator('#normal-bus-list > div').count(),6);
assert.deepEqual(await page.locator('#normal-bus-list [data-field=destination]').allTextContents(),['香里園','寝屋川市駅','香里園','寝屋川市駅','香里園','寝屋川市駅']);
await assertBusRemainingTime(page,'normal');
await assertBusFallbacks(page);
await assertDepartureDetails(page);
await assertUncertainFollowingSchedule(page);
await assertCompactDepartures(page);
await assertTrainLabels(page);
await assertMinimumArrival(page);
await assertEstimatedTimes(page);
line.suspended=true;await page.evaluate(()=>fetchTrains());await page.locator('#suspended').waitFor({state:'visible'});await page.screenshot({path:out+'/suspended.png'});
assert.ok((await page.locator('#suspended').innerText()).includes('ダイヤが乱れています'));
await assertBusRemainingTime(page,'suspended');
const busCount=await page.locator('#suspended-bus-list .bus-card').count();assert.ok(busCount>=2&&busCount<=4);
assert.deepEqual(await page.locator('#suspended-bus-list [data-field=destination]').allTextContents(),['香里園','寝屋川市駅','香里園','寝屋川市駅'].slice(0,busCount));
const stoppedLabels=await page.locator('.line-stopped').allTextContents();assert.ok(stoppedLabels.every(t=>!/停止[0-4]分/.test(t)),stoppedLabels.join(','));
await assertDelayStopCenters(page);
const overlaps=await page.locator('.line-label').evaluateAll(labels=>labels.flatMap((a,i)=>labels.slice(i+1).filter(b=>a.dataset.direction===b.dataset.direction && a.dataset.lane===b.dataset.lane && a.getBoundingClientRect().right+2.9>b.getBoundingClientRect().left && b.getBoundingClientRect().right+2.9>a.getBoundingClientRect().left).map(b=>[a.textContent,b.textContent])));
assert.deepEqual(overlaps,[]);
assert.equal(await page.locator('#suspended-up [data-field="state"]').textContent(),'止まっています');
line.directions.up.state='many_stopped';await page.evaluate(()=>fetchTrains());
assert.equal(await page.locator('#suspended-up [data-field="state"]').textContent(),'多くの列車が止まっています');
assert.ok(await page.locator('#suspended-up [data-field="state"]').evaluate(e=>e.scrollWidth<=e.clientWidth+1));
line.directions.up={state:'none',next:[]};await page.evaluate(()=>fetchTrains());assert.equal(await page.locator('#suspended-up .next-list [data-field="kind"]').count(),0);
line.suspended=false;await page.evaluate(()=>fetchTrains());failure=true;await page.evaluate(()=>fetchTrains());await page.locator('#reconnect-badge').waitFor({state:'visible'});await page.screenshot({path:out+'/reconnecting-brief.png'});
assert.equal(await page.locator('#normal-delay-list > div').count(),6);assert.equal(await page.locator('#normal-delay-list').textContent().then(t=>t.includes('Long notice')),false);
assert.equal(await page.locator('#normal-up-list > div').count(),3);
failure=false;await page.evaluate(()=>fetchTrains());assert.equal(await page.locator('#reconnect-badge').isVisible(),false);
await page.setViewportSize({width:960,height:540});await page.waitForFunction(()=>getComputedStyle(document.getElementById('screen')).transform==='matrix(0.5, 0, 0, 0.5, 0, 0)');assert.equal(await page.locator('#screen').evaluate(e=>getComputedStyle(e).transform),'matrix(0.5, 0, 0, 0.5, 0, 0)');
cfg.features={trains:false,buses:false,delays:true};await page.reload();assert.equal(await page.locator('#normal-trains').isVisible(),false);assert.equal(await page.locator('#normal-buses').isVisible(),false);
await assertStableClock(page);
assert.deepEqual(errors,[]);console.log('Minimal: normal/suspended/none/retry/recovery/scaling/features passed');
const c=await browser.newPage({viewport:{width:1920,height:1080}});c.on('pageerror',e=>errors.push(e.message));await c.clock.install({time:new Date('2026-11-06T12:07:42+09:00')});let healthy=false,code=502,detail='Upstream unreachable', loads=0;
await c.route('http://controller.test/**',async route=>{
 const path=new URL(route.request().url()).pathname;
 if(path==='/')return route.fulfill({contentType:'text/html',body:fs.readFileSync(root+'/controller/templates/display.html','utf8')});
 if(path==='/transit'){if(code==='network')return route.abort('failed');if(code==='timeout')return;return route.fulfill({status:healthy?200:code,contentType:'application/json',body:JSON.stringify({detail})});}
 if(path==='/transit/'){loads++;return route.fulfill({contentType:'text/html',body:'<body style="margin:0;background:#ff00ff">Display</body>'});}
 if(path==='/api/mode')return route.fulfill({contentType:'application/json',body:'{"mode":"transit"}'});
 if(path==='/api/mode/stream')return route.fulfill({contentType:'text/event-stream',body:': keepalive\n\n'});
 return route.fulfill({body:''});
});
await c.goto('http://controller.test/');await c.evaluate(()=>document.fonts.ready);
for(let i=0;i<14;i++){await c.clock.runFor(5000);await new Promise(r=>setTimeout(r,15));}
await c.locator('#reconnecting-screen').waitFor({state:'visible'});assert.match(await c.locator('#failure-cause').textContent(),/応答しません/);await c.screenshot({path:out+'/reconnecting.png'});
await assertStableClock(c);
for(const [width,height] of [[1920,960],[1920,1080],[1920,1200],[960,480],[960,600],[2560,1080],[800,800]]) {
 await c.setViewportSize({width,height});
 const coverage=await c.evaluate(()=>{
  scaleScreen();
  const overlay=$('reconnecting-screen'),r=overlay.getBoundingClientRect();
  const points=[[1,1],[innerWidth-1,1],[1,innerHeight-1],[innerWidth-1,innerHeight-1],[innerWidth/2,innerHeight/2]];
  return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,background:getComputedStyle(overlay).backgroundColor,
   leaked:points.filter(([x,y])=>!overlay.contains(document.elementFromPoint(x,y)))};
 });
 assert.deepEqual(coverage,{left:0,top:0,right:width,bottom:height,background:'rgb(11, 11, 12)',leaked:[]},`${width} x ${height}`);
 if(width===1920)await c.screenshot({path:out+`/reconnecting-${width}x${height}.png`});
}
await c.setViewportSize({width:1920,height:1080});
const before=await c.locator('#next-retry').textContent();await c.clock.runFor(1000);assert.equal(+await c.locator('#next-retry').textContent(),+before-1);
code=503;detail='Service unavailable';await c.evaluate(()=>healthCheck());assert.match(await c.locator('#failure-cause').textContent(),/HTTP 503/);
code='network';await c.evaluate(()=>healthCheck());assert.equal(await c.locator('#failure-cause').textContent(),'サーバーまで届きません');
code='timeout';const pending=c.evaluate(()=>healthCheck());await c.clock.runFor(11000);await pending;assert.match(await c.locator('#attempts').textContent(),/応答なし（10秒でタイムアウト）/);
assert.equal(await c.locator('#attempts > div').count(),7);healthy=true;code=200;await c.evaluate(()=>healthCheck());assert.equal(await c.locator('#reconnecting-screen').isVisible(),false);await c.waitForTimeout(50);assert.ok(loads>=2);assert.deepEqual(errors,[]);
console.log('Controller: 70s outage/countdown/HTTP/network/timeout/recovery iframe reload passed');console.log('Screenshots: '+out);await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
