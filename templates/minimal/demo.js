(() => {
    const scenario=config.demo;
    const base=location.pathname.replace(/\/$/,'');
    const catalogPath=base.slice(0,base.lastIndexOf('/'));
    const controls=$('demo-controls');controls.hidden=false;
    controls.textContent=scenario.mode==='static'?'デモ · 架空の想定 · '+scenario.title:'デモ · 実際の運行記録';
    const style=document.createElement('style');
    style.textContent=`
        #demo-controls { font-size:17px; line-height:1.4; color:#A1A1A6; white-space:nowrap; }
        #demo-dock { position:fixed; z-index:10; left:0; right:0; bottom:0; box-sizing:border-box; padding:12px 24px; background:#151517; border-top:1px solid #3A3A40; color:#F1F1EE; font:16px/1.5 'Zen Kaku Gothic New',sans-serif; }
        .demo-toolbar { display:flex; align-items:center; flex-wrap:wrap; gap:12px 20px; }
        #demo-dock a { color:#D9D9D6; text-decoration:none; white-space:nowrap; padding:8px 0; }
        #demo-dock a:hover { text-decoration:underline; }
        #demo-dock button, #demo-dock select { box-sizing:border-box; font:inherit; min-height:44px; padding:6px 12px; background:#202024; color:#F1F1EE; border:1px solid #4A4A50; border-radius:4px; }
        #demo-dock :focus-visible { outline:2px solid #F1F1EE; outline-offset:3px; }
        .demo-choice { display:flex; align-items:center; gap:10px; flex:1; }
        #demo-choice { width:100%; max-width:360px; min-width:180px; }
        .demo-badge { font-size:14px; color:#A1A1A6; white-space:nowrap; }
        .demo-playback { display:flex; align-items:center; gap:12px; }
        .demo-speed { display:flex; align-items:center; gap:8px; white-space:nowrap; }
        .demo-position { margin-left:auto; font-variant-numeric:tabular-nums; white-space:nowrap; color:#A1A1A6; }
        .demo-position output { display:inline-block; min-width:86px; margin-left:10px; color:#F1F1EE; }
        .demo-timeline { display:grid; grid-template-columns:88px minmax(0,1fr) 104px; gap:16px; align-items:center; margin-top:8px; font-size:14px; color:#A1A1A6; font-variant-numeric:tabular-nums; }
        .demo-timeline > :last-child { text-align:right; }
        #demo-seek { appearance:none; -webkit-appearance:none; width:100%; min-width:0; height:36px; margin:0; background:transparent; cursor:pointer; touch-action:pan-y; }
        #demo-seek::-webkit-slider-runnable-track { height:8px; background:linear-gradient(to right,#F1F1EE 0 var(--seek-progress,0%),#4A4A50 var(--seek-progress,0%) 100%); border-radius:4px; }
        #demo-seek::-webkit-slider-thumb { appearance:none; -webkit-appearance:none; width:26px; height:26px; margin-top:-9px; background:#F1F1EE; border:2px solid #151517; border-radius:50%; box-shadow:0 0 0 1px #7C7C82; }
        #demo-seek::-moz-range-track { height:8px; background:#4A4A50; border-radius:4px; }
        #demo-seek::-moz-range-progress { height:8px; background:#F1F1EE; }
        #demo-seek::-moz-range-thumb { width:24px; height:24px; background:#F1F1EE; border:2px solid #151517; border-radius:50%; }
        @media(max-width:760px) { #demo-dock { padding:10px 16px; } .demo-toolbar { gap:8px 16px; } .demo-choice { min-width:220px; } .demo-badge { display:none; } .demo-timeline { grid-template-columns:72px minmax(0,1fr) 90px; gap:8px; font-size:12px; } .demo-position { font-size:14px; } }
    `;
    document.head.append(style);
    const dock=document.createElement('div');dock.id='demo-dock';dock.setAttribute('role','region');dock.setAttribute('aria-label','デモの選択と操作');
    const toolbar=document.createElement('div');toolbar.className='demo-toolbar';
    const back=document.createElement('a');back.href=catalogPath;back.textContent='← デモ一覧';
    const badge=document.createElement('span');badge.className='demo-badge';badge.textContent=scenario.mode==='static'?'架空の想定 · 表示のみ':'実際の記録';
    const choiceLabel=document.createElement('label');choiceLabel.className='demo-choice';
    const choice=document.createElement('select');choice.id='demo-choice';choice.setAttribute('aria-label','デモ選択');
    for(const mode of ['replay','static','gallery']) {
        const group=document.createElement('optgroup');group.label={replay:'実際の記録',static:'架空の想定',gallery:'表示の見本'}[mode];
        for(const item of scenario.catalog.filter(item=>item.mode===mode||(mode==='gallery'&&item.mode==='intro'))) {
            const option=document.createElement('option');option.value=item.id;option.textContent=item.title;option.disabled=!item.available;group.append(option);
        }
        choice.append(group);
    }
    choice.value=scenario.id;choice.addEventListener('change',()=>location.assign(catalogPath+'/'+choice.value));
    choiceLabel.append(choice);toolbar.append(back,badge,choiceLabel);dock.append(toolbar);document.body.append(dock);
    new ResizeObserver(scaleScreen).observe(dock);scaleScreen();
    function apply(data) {
        trainData=structuredClone(data.trains);lineData=structuredClone(data.line);
        busData=data.buses;delayData=data.delays;render();clockTick();
    }
    async function start() {
        const response=await fetch(base+'/data',{signal:AbortSignal.timeout(15000),cache:'no-store'});
        if(!response.ok)throw new Error('HTTP '+response.status);
        const replay=await response.json();
        if(replay.version!==1)throw new Error('デモを読み込めません');
        if(scenario.mode==='static') {
            if(replay.mode!=='static'||!replay.trains||!replay.line||!Number.isFinite(replay.timestamp))throw new Error('想定データを読み込めません');
            demoTimestamp=replay.timestamp*1000;apply(replay);return;
        }
        if(!replay.frames?.length||!(replay.end>replay.start))throw new Error('再生用の記録を読めません');
        let elapsed=0,speed=10,playing=true,previous=performance.now(),shown=-1,scrubbing=false;
        const duration=replay.end-replay.start;
        controls.textContent='デモ · '+replay.recorded_date.replaceAll('-','.')+'の実記録';
        const playback=document.createElement('div');playback.className='demo-playback';
        const toggle=document.createElement('button');toggle.type='button';
        const speedLabel=document.createElement('label');speedLabel.className='demo-speed';speedLabel.append('速度');
        const speeds=document.createElement('select');speeds.setAttribute('aria-label','再生速度');
        for(const value of [1,10,60]) {
            const option=document.createElement('option');option.value=value;option.textContent=value+'倍';speeds.append(option);
        }
        speeds.value=String(speed);speedLabel.append(speeds);
        const reset=document.createElement('button');reset.type='button';reset.textContent='最初から';
        playback.append(toggle,speedLabel,reset);
        const position=document.createElement('span');position.className='demo-position';position.append('記録時刻');
        const current=document.createElement('output');current.setAttribute('aria-label','記録時刻');position.append(current);
        toolbar.append(playback,position);
        const timeline=document.createElement('div');timeline.className='demo-timeline';
        const seek=document.createElement('input');seek.id='demo-seek';seek.type='range';seek.min='0';seek.max=String(duration);seek.step='1';seek.setAttribute('aria-label','再生位置');
        const labelTime=seconds=>((new Date(seconds*1000+9*3600000).getUTCDate()!==new Date(replay.start*1000+9*3600000).getUTCDate())?'翌 ':'')+timeText(new Date(seconds*1000));
        const from=document.createElement('span'),to=document.createElement('span');from.textContent=labelTime(replay.start);to.textContent=labelTime(replay.end);
        timeline.append(from,seek,to);dock.append(timeline);
        busData=replay.buses;delayData=replay.delays;
        function update() {
            demoTimestamp=(replay.start+elapsed)*1000;
            let index=0;
            while(index+1<replay.frames.length&&replay.frames[index+1].ts<=demoTimestamp/1000)index++;
            if(index!==shown) {
                trainData=structuredClone(replay.frames[index].trains);lineData=structuredClone(replay.frames[index].line);shown=index;render();
            }
            clockTick();seek.value=String(Math.floor(elapsed));
            seek.style.setProperty('--seek-progress',(elapsed/duration*100)+'%');
            seek.setAttribute('aria-valuetext',labelTime(replay.start+elapsed));current.textContent=labelTime(replay.start+elapsed);
            toggle.textContent=playing?'一時停止':'再生';toggle.setAttribute('aria-label',playing?'記録の再生を一時停止':'記録を再生');
        }
        function advance() {
            const now=performance.now();if(playing&&!scrubbing)elapsed+=(now-previous)/1000*speed;previous=now;
            if(elapsed>=duration){elapsed=duration;playing=false;}
        }
        toggle.addEventListener('click',()=>{advance();if(!playing&&elapsed>=duration)elapsed=0;playing=!playing;update();});
        speeds.addEventListener('change',()=>{advance();speed=Number(speeds.value);update();});
        seek.addEventListener('pointerdown',()=>{advance();scrubbing=true;});
        const stopScrubbing=()=>{if(scrubbing){scrubbing=false;previous=performance.now();}};
        window.addEventListener('pointerup',stopScrubbing);window.addEventListener('pointercancel',stopScrubbing);
        seek.addEventListener('input',()=>{elapsed=Number(seek.value);previous=performance.now();update();});
        reset.addEventListener('click',()=>{elapsed=0;previous=performance.now();update();});
        update();setInterval(()=>{advance();update();},200);
    }
    start().catch(()=>{
        controls.textContent='デモを読み込めませんでした';
        const message=document.createElement('span');message.textContent='読み込みに失敗しました。';
        const retry=document.createElement('button');retry.textContent='再読み込み';retry.type='button';retry.addEventListener('click',()=>location.reload());toolbar.append(message,retry);
        empty($('normal-up-list'),'デモを取得できません');empty($('normal-down-list'),'デモを取得できません');
    });
})();
