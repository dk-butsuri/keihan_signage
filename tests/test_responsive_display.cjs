const {chromium}=require('playwright');
const assert=require('assert/strict');
const fs=require('fs');
const path=require('path');
const os=require('os');
const root=path.resolve(__dirname,'..');
const replay=JSON.parse(fs.readFileSync(root+'/demo-data/replay.json'));
const output=process.env.SIGNAGE_SCREENSHOTS||fs.mkdtempSync(path.join(os.tmpdir(),'signage-responsive-'));
const groups=['京阪','大阪メトロ','JR','私鉄'].map(name=>({name,mark:'×',status:'運転見合わせ',lines:Array.from({length:5},(_,i)=>({name:name+'路線'+(i+1),ticker_name:name+'路線'+(i+1),status:'運転見合わせ',detail:'強風のため、運転を見合わせています。',announced_time:'2026-11-07T12:00:00+09:00'}))}));
function inspectFrames(frames) {
    const failures=[];
    const root=$('screen'),scale=root.getBoundingClientRect().width/root.clientWidth;
    for(const frame of frames) {
        trainData=frame.trains;lineData=frame.line;render();
        const problems=[],visible=$('normal').hidden?'suspended':'normal';
        for(const kind of document.querySelectorAll('#'+visible+' .train-kind')) {
            const r=kind.getBoundingClientRect();
            if([...kind.children].filter(e=>!e.hidden).some(e=>{const c=e.getBoundingClientRect();return c.left<r.left-1||c.right>r.right+1||c.top<r.top-1||c.bottom>r.bottom+1;}))problems.push('train kind clipped: '+kind.textContent);
        }
        const bound=$('operation-slides').getBoundingClientRect().top;
        for(const row of document.querySelectorAll('#'+visible+' .next-list > div,#'+visible+'-up-list > div,#'+visible+'-down-list > div,#'+visible+'-bus-list > div,#'+visible+' .operation-group')) {
            if(row.getClientRects().length&&row.getBoundingClientRect().bottom>bound-8*scale)problems.push('row overlaps footer: '+row.textContent);
        }
        for(const card of document.querySelectorAll('#'+visible+'-bus-list .bus-card')) {
            const r=card.getBoundingClientRect(),endpoints=card.querySelectorAll('.bus-endpoint');
            for(const el of card.querySelectorAll('.bus-endpoint > *')) {
                const e=el.getBoundingClientRect();
                if(el.scrollWidth>el.clientWidth+1||e.top<r.top-.1||e.bottom>r.bottom+.1)problems.push('bus text clipped: '+el.textContent);
            }
            for(let index=0;index<3;index++) {
                const a=endpoints[0].children[index].getBoundingClientRect(),b=endpoints[1].children[index].getBoundingClientRect();
                if(Math.abs(a.top-b.top)>.1||Math.abs(a.height-b.height)>.1)problems.push('bus arrival columns misaligned');
            }
        }
        if(visible==='normal') {
            const rows=[...document.querySelectorAll('#normal-up-list > div:not(.empty),#normal-down-list > div:not(.empty)')];
            for(const row of rows) {
                const sub=row.querySelector('.departure-secondary'),dest=row.querySelector('.departure-destination');
                const primaryBottom=row.querySelector('[data-field="time"]').getBoundingClientRect().bottom;
                if(!sub.hidden&&sub.textContent&&sub.getBoundingClientRect().top-primaryBottom<7.9*scale)problems.push('departure gap');
                if(dest.scrollWidth>dest.clientWidth+1||(!sub.hidden&&sub.scrollHeight>sub.clientHeight+1))problems.push('departure text clipped: '+row.textContent);
                const r=row.getBoundingClientRect(),d=dest.getBoundingClientRect(),status=row.querySelector('.departure-status').getBoundingClientRect();
                if(Math.abs(d.top+d.height/2-r.top-r.height/2)>.1)problems.push('destination not centered');
                const label=row.querySelector('.departure-time-label'),time=row.querySelector('.departure-time').getBoundingClientRect();
                if(row.classList.contains('departure-revised')) {
                    const original=row.querySelector('.departure-original'),prediction=row.querySelector('.departure-prediction');
                    if(original.scrollWidth>original.clientWidth+1||prediction.scrollWidth>prediction.clientWidth+1)problems.push('original/estimated time clipped');
                }
                const first=row.classList.contains('departure-revised')?row.querySelector('.departure-original').getBoundingClientRect():label.hidden?time:label.getBoundingClientRect(),last=sub.hidden?time:sub.getBoundingClientRect();
                const centerOffset=(first.top+last.bottom-r.top-r.bottom)/2;
                if(row.classList.contains('departure-compact')) {
                    const clock=row.querySelector('.departure-clock'),c=clock.getBoundingClientRect(),offset=(c.top+c.bottom-r.top-r.bottom)/2;
                    if(label.hidden?Math.abs(offset)>.1:offset>=0||offset< -5*scale)problems.push('compact time group optical alignment');
                    if(clock.scrollWidth>clock.clientWidth+1||c.top<r.top||c.bottom>r.bottom||(!label.hidden&&label.getBoundingClientRect().right>time.left+.1))problems.push('compact time/label clipped or overlapping: '+JSON.stringify({text:clock.textContent,width:clock.clientWidth,scroll:clock.scrollWidth,top:c.top-r.top,bottom:r.bottom-c.bottom,labelRight:label.getBoundingClientRect().right,timeLeft:time.left}));
                } else if(Math.abs(centerOffset)>.1)problems.push('schedule, time and details group not centered');
                if(first.top<r.top||last.bottom>r.bottom)problems.push('departure time group clipped');
                if(!sub.hidden&&sub.classList.contains('train-location')&&(sub.scrollWidth>sub.clientWidth+1||sub.getBoundingClientRect().bottom>r.bottom-6*scale))problems.push('location clipped');
                if(status.top<r.top-1||status.bottom>r.bottom+1)problems.push('departure status clipped');
                if(row.classList.contains('departure-compact')&&(Math.abs(r.height-72*scale)>.1||!sub.hidden))problems.push('compact departure height/details');
                const badge=sub.querySelector('.station-badge');
                if(badge&&!sub.hidden) {
                    const b=badge.getBoundingClientRect(),s=sub.getBoundingClientRect();
                    if(b.top<s.top-.1||b.bottom>s.bottom+.1)problems.push('station badge clipped');
                }
            }
            for(const id of ['normal-up-list','normal-down-list','normal-bus-list']) {
                const cards=[...$(id).children].filter(e=>!e.classList.contains('empty'));
                if(cards.some((e,index)=>index&&e.getBoundingClientRect().top-cards[index-1].getBoundingClientRect().bottom<7.9*scale))problems.push('row spacing');
            }
        } else {
            for(const direction of ['up','down']) {
                const col=$('suspended-'+direction),state=col.querySelector('[data-field="state"]'),next=col.querySelector('.next-list');
                if(next.getClientRects().length&&state.getBoundingClientRect().bottom>next.getBoundingClientRect().top-10*scale)problems.push('state overlaps next trains');
                if(state.scrollWidth>state.clientWidth+1)problems.push('state text clipped');
                for(const row of next.querySelectorAll('.next-content')) {
                    const dest=row.querySelector('[data-field="destination"]'),pos=row.querySelector('[data-field="position"]');
                    const d=dest.getBoundingClientRect(),p=pos.getBoundingClientRect(),r=row.getBoundingClientRect();
                    if(Math.abs(d.left+d.width/2-p.left-p.width/2)>.1||getComputedStyle(pos).textAlign!=='center')problems.push('next train alignment');
                    for(const field of row.children) {
                        const f=field.getBoundingClientRect();
                        if(field.scrollWidth>field.clientWidth+1||f.top<r.top-1||f.bottom>r.bottom+1)problems.push('next train text clipped: '+field.textContent);
                    }
                    if(pos.textContent&&p.top<d.bottom+1*scale)problems.push('next train details overlap');
                }
            }
            const labels=[...document.querySelectorAll('.line-label')];
            if(labels.some((a,i)=>labels.slice(i+1).some(b=>{const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return x.left<y.right&&y.left<x.right&&x.top<y.bottom&&y.top<x.bottom;})))problems.push('map labels overlap');
            const width=$('line-map').clientWidth;
            const markers=[...document.querySelectorAll('#line-map polygon[data-position]')];
            if(markers.reduce((n,m)=>n+Number(m.dataset.count),0)!==lineData.trains.length)problems.push('missing markers');
            for(const marker of markers) {
                const group=marker.parentElement,count=Number(marker.dataset.count);
                if(group.querySelectorAll('polygon').length!==Math.min(count,3))problems.push('missing stacked triangles');
                if(count<=3&&group.querySelector('text'))problems.push('redundant marker count');
                if(count>1&&new Set([...group.querySelectorAll('polygon')].map(p=>p.getAttribute('transform'))).size!==Math.min(count,3))problems.push('triangles not offset');
                if(new Set([...group.querySelectorAll('polygon')].map(p=>p.getAttribute('transform').split(',')[1])).size!==1)problems.push('stacked triangles not level');
                const triangles=[...group.querySelectorAll('polygon')];
                if(count>1&&triangles[0]!==marker)problems.push('triangle tips hidden by draw order');
            }
            const first=lineData.stations[0].number,last=lineData.stations.at(-1).number;
            const ranges=lineData.compress_ranges||[],removed=p=>ranges.reduce((n,[a,b])=>n+(Math.min(Math.max(p,a),b)-a)*.65,0);
            const span=last-first-removed(last);
            for(const marker of markers) {
                const position=Number(marker.dataset.position),sign=marker.dataset.direction==='up'?1:-1;
                const expected=150+(position-first-removed(position))/span*(width-210);
                const actual=Number(/^translate\(([^,]+)/.exec(marker.getAttribute('transform'))[1])+sign*6;
                if(Math.abs(expected-actual)>.01)problems.push('marker moved from its position');
            }
        }
        if(problems.length)failures.push({timestamp:frame.ts,problems:problems.slice(0,3)});
        if(failures.length>=3)break;
    }
    return failures;
}
(async()=>{
    const browser=await chromium.launch();
    const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.clock.install();
    await page.route('http://responsive.test/**',route=>{
        const pathname=new URL(route.request().url()).pathname;
        if(pathname==='/')return route.fulfill({contentType:'text/html',body:fs.readFileSync(root+'/templates/minimal/index.html','utf8').replace('{{ config | tojson }}',JSON.stringify({features:{trains:true,buses:true,delays:true},buses:{stop_name:'同志社香里'}}))});
        const name=pathname.split('/').at(-1),frame=replay.frames[0];
        const data=name==='trains'?frame.trains:name==='line'?frame.line:name==='delays'?{delays:[],groups}:name==='buses'?{buses:Array.from({length:6},(_,i)=>({destination:i%2?'寝屋川市駅行':'京阪香里園行',arrival_time:'12:13 到着予定',status:'約11分後に到着'}))}:name==='time'?{ts:Date.now()/1000,ntp_rtt_ms:0}:{};
        return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
    });
    await page.goto('http://responsive.test/?motion=off');await page.evaluate(()=>document.fonts.ready);
    await page.waitForFunction(()=>trainData&&busData&&delayData);
    const denseFrame=replay.frames.reduce((best,frame)=>frame.line.trains.length>best.line.trains.length?frame:best);
    const sizes=[[1920,960],[1920,1080],[1920,1200],[1919,990],[1280,800],[960,480],[960,600]];
    const dimensions=[];
    for(const [width,height] of sizes) {
        await page.setViewportSize({width,height});
        const metrics=await page.evaluate(()=>{scaleScreen();render();const r=$('screen').getBoundingClientRect(),m=new DOMMatrix(getComputedStyle($('screen')).transform);return{width:r.width,height:r.height,left:r.left,top:r.top,sx:m.a,sy:m.d,logicalWidth:$('screen').clientWidth,logicalHeight:$('screen').clientHeight};});
        assert.ok(Math.abs(metrics.width-width)<1&&Math.abs(metrics.height-height)<1&&metrics.left<1&&metrics.top<1,JSON.stringify({width,height,metrics}));
        assert.ok(Math.abs(metrics.sx-metrics.sy)<.000001,'text must retain its proportions');
        dimensions.push(metrics);
        const frames=width===1920&&height!==1080?replay.frames:[replay.frames[0],denseFrame];
        assert.deepEqual(await page.evaluate(inspectFrames,frames),[],`${width} x ${height}`);
        await page.evaluate(frame=>{trainData=frame.trains;lineData=frame.line;render();},replay.frames[0]);
        await page.screenshot({path:output+`/responsive-normal-${width}x${height}.png`,animations:'disabled'});
        await page.evaluate(frame=>{trainData=frame.trains;lineData=frame.line;render();},denseFrame);
        await page.screenshot({path:output+`/responsive-map-${width}x${height}.png`,animations:'disabled'});
    }
    assert.ok(dimensions[0].logicalWidth>dimensions[1].logicalWidth);
    assert.ok(dimensions[2].logicalHeight>dimensions[1].logicalHeight);
    assert.deepEqual(errors,[]);await browser.close();
    console.log(`Responsive: 16:8 / 16:9 / 16:10, fractional and small viewports, ${replay.frames.length} frames at both extremes, text gaps/alignment/map positions/overlaps passed`);
})().catch(e=>{console.error(e);process.exit(1)});
