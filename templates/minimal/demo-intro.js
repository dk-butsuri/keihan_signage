import {createScreenAssembly} from './assembly.js';

(() => {
  const root = document.getElementById('tankyu-intro');
  const stage = root.querySelector('.intro-stage');
  const pixels = root.querySelector('.intro-pixels');
  const source = root.querySelector('.intro-source');
  const peripheral = root.querySelector('.intro-peripheral');
  const slider = root.querySelector('input');
  const playButton = root.querySelector('[data-action="play"]');
  const status = root.querySelector('[role="status"]');
  const timeOutput = root.querySelector('[data-time]');
  const frameOutput = root.querySelector('[data-frame]');
  const phaseOutput = root.querySelector('[data-phase]');
  const W = 1920, H = 1080, FPS = 60, LAST = 541, DURATION = (LAST+1) / FPS;
  const ASSEMBLY_START = 300;
  let assembly=null, boardFrame=null;
  const curves = Object.freeze({
    scale: [0.251031, 0, 1, 0.085366],
    opacity: [0, 0.408537, 0.473077, 0],
    blur: [0.334615, 0.74187, 1, 0.097872],
    exit: [0.040346, 0, 0, 1],
    title: [0, 0.679787, 1, 0],
    radius: [0, 0.554878, 0.807692, 0.184959],
    fade: [0.169231, 1, 0.846154, 0.130081]
  });
  let frame = 200, playing = false, ready = false, firstPlay = true, raf = 0, epoch = 0;
  const clamp = x => Math.max(0, Math.min(1, x));
  const mix = (a,b,t) => a + (b-a)*t;
  const cubic = (u,a,b) => 3*(1-u)*(1-u)*u*a + 3*(1-u)*u*u*b + u*u*u;
  function ease(t, h) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    // AviUtl stores both endpoint handle offsets; the ending handle points backwards.
    let lo = 0, hi = 1;
    for (let i=0; i<24; i++) {
      const u = (lo+hi)/2;
      if (cubic(u,h[0],1-h[2]) < t) lo=u; else hi=u;
    }
    return cubic((lo+hi)/2,h[1],1-h[3]);
  }
  const progress = (f,a,b) => clamp((f-a)/(b-a));
  function stateAt(f) {
    let group = null, title = null;
    if (f>=33 && f<=113) {
      const t=progress(f,33,113);
      group={y:-30,scale:mix(1.56,1,ease(t,curves.scale)),
        alpha:mix(0.347,1,ease(t,curves.opacity)),blur:mix(34,0,ease(t,curves.blur))};
    } else if (f>=114 && f<=131) {
      group={y:mix(-30,150,ease(progress(f,114,131),curves.exit)),scale:1,
        alpha:clamp((131-f)/6),blur:0};
    }
    if(f>=129) {
      const t=progress(f,129,237);
      title={y:f<=259?mix(-220,-20,ease(progress(f,129,259),curves.title)):-20,
        alpha:clamp((f-129)/6),glow:mix(.035,.75,t*t*(3-2*t))};
    }
    return {frame:f,group,title,opening:f<=38?progress(f,0,38):1,
      ending:f>=300?1-ease(progress(f,300,356),curves.fade):1,
      peripheralRadius:mix(146.6,118.6,ease(progress(f,0,356),curves.radius))};
  }
  function surface() {const c=document.createElement('canvas');c.width=W;c.height=H;return c;}
  const groupImage=surface(), titleImage=surface(), glowImage=surface();
  let groupNodes=[], titleNodes=[];
  function textImage(target,lines,size,font,lineAdvance) {
    const c=target.getContext('2d');
    c.clearRect(0,0,W,H);
    c.font=`${font==='TankyuLine'?100:400} ${size}px ${font}`;
    c.fillStyle='#fff';c.textAlign='center';c.textBaseline='alphabetic';
    const metrics=c.measureText('国');
    const ascent=metrics.fontBoundingBoxAscent ?? size*.88;
    const descent=metrics.fontBoundingBoxDescent ?? size*.12;
    const baseline=H/2+(ascent-descent)/2;
    lines.forEach((line,i)=>c.fillText(line,W/2,baseline+(i-(lines.length-1)/2)*lineAdvance));
  }
  function buildImages() {
    textImage(groupImage,['探究1A-2班'],53.5,'TankyuLine',53.5);
    textImage(titleImage,['京阪電車・京阪バス','発車時刻リアルタイムサイネージ設置プロジェクト'],58.5,'TankyuZen',58.5);
    const g=glowImage.getContext('2d');
    // Native glow and blur kernels are unavailable in the browser; this is the optical approximation.
    g.globalAlpha=.704;g.filter='blur(83.333px)';g.drawImage(titleImage,0,0);
    g.globalAlpha=.352;g.filter='blur(41.667px)';g.drawImage(titleImage,0,0);
    g.filter='none';g.globalAlpha=1;
    const blurredTitle=surface(), b=blurredTitle.getContext('2d');
    b.filter=`blur(${Math.hypot(W,H)*60/10000/3}px) brightness(90%)`;
    b.drawImage(titleImage,0,0);
    const blurredGlow=surface(), bg=blurredGlow.getContext('2d');
    bg.filter=b.filter;bg.drawImage(glowImage,0,0);
    for(const [layer,text,glow] of [[source,titleImage,glowImage],[peripheral,blurredTitle,blurredGlow]]) {
      const group=document.createElement('canvas');group.width=512;group.height=160;
      group.className='intro-group';group.setAttribute('aria-hidden','true');
      group.getContext('2d').drawImage(groupImage,704,460,512,160,0,0,512,160);
      text.className='intro-main intro-text';glow.className='intro-main intro-glow';glow.dataset.glow='true';
      text.setAttribute('aria-hidden','true');glow.setAttribute('aria-hidden','true');
      layer.append(group,glow,text);groupNodes.push(group);titleNodes.push(glow,text);
    }
  }
  function render(f) {
    frame=Math.max(0,Math.min(LAST,Math.round(f)));
    const v=stateAt(frame);
    groupNodes.forEach((node,i)=>{
      node.style.visibility=v.group?'visible':'hidden';
      if(!v.group)return;
      const group=v.group;
      const sigma=i?Math.hypot(group.blur/3,Math.hypot(W,H)*60/10000/3):group.blur/3;
      node.style.transform=`translateY(${group.y}px) scale(${group.scale})`;
      node.style.opacity=String(group.alpha);
      node.style.filter=`blur(${sigma/group.scale}px)${i?' brightness(90%)':''}`;
    });
    titleNodes.forEach(node=>{
      node.style.visibility=v.title?'visible':'hidden';
      if(v.title){
        node.style.transform=`translateY(${v.title.y}px)`;
        node.style.opacity=String(v.title.alpha*(node.dataset.glow?v.title.glow:1));
      }
    });
    source.style.opacity=String(v.opening);peripheral.style.opacity=String(v.opening);
    const diameter=(W+H)/2*v.peripheralRadius/100;
    const feather=(W+H)/2*200/400;
    const radius=diameter/2;
    peripheral.style.maskImage=`radial-gradient(circle at 960px 540px,transparent ${Math.max(0,radius-feather/2)}px,#000 ${radius+feather/2}px)`;
    pixels.style.opacity=String(v.ending);
    slider.value=String(frame);
    timeOutput.value=`${(frame/FPS).toFixed(2)} / ${DURATION.toFixed(2)} 秒`;
    frameOutput.value=`${frame} / ${LAST} F · ${FPS} fps`;
    stage.dataset.frame=String(frame);
    assembly?.seek((frame-ASSEMBLY_START)*1000/FPS);
    phaseOutput.textContent=frame<ASSEMBLY_START?'イントロ':frame<=356?'タイトルから案内へ':frame===LAST?'完成':assembly?.phase((frame-ASSEMBLY_START)*1000/FPS)||'案内画面';
  }
  function pause(message='停止中') {
    playing=false;cancelAnimationFrame(raf);playButton.textContent='再生';playButton.setAttribute('aria-pressed','false');status.textContent=message;
  }
  function tick(now) {
    if(!playing) return;
    const next=Math.floor((now-epoch)*FPS/1000);
    if(next>LAST) {render(LAST);pause('再生終了');return;}
    if(next!==frame) render(next);
    raf=requestAnimationFrame(tick);
  }
  function play(fromStart=false) {
    if(!ready)return;
    if(fromStart || firstPlay || frame===LAST) render(0);
    firstPlay=false;playing=true;cancelAnimationFrame(raf);epoch=performance.now()-frame*1000/FPS;
    playButton.textContent='一時停止';playButton.setAttribute('aria-pressed','true');status.textContent='再生中';raf=requestAnimationFrame(tick);
  }
  root.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',()=>{
    const action=button.dataset.action;
    if(action==='play') {if(playing)pause();else play();}
    if(action==='restart')play(true);
    if(action==='transition'){pause();firstPlay=false;render(276);play();}
    if(action==='previous'||action==='next') {pause();firstPlay=false;render(frame+(action==='previous'?-1:1));}
  }));
  slider.addEventListener('input',()=>{pause();firstPlay=false;render(Number(slider.value));});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&playing)pause();});
  window.addEventListener('pagehide',event=>{pause();if(!event.persisted)assembly?.destroy();});
  root.intro={seek(f){if(ready){pause();firstPlay=false;render(f);}},play,pause,stateAt,
    get frame(){return frame;},get playing(){return playing;},get ready(){return ready;}};
  const resize=()=>{
    const scale=`scale(${stage.clientWidth/W})`;
    pixels.style.transform=scale;if(boardFrame)boardFrame.style.transform=scale;
  };
  new ResizeObserver(resize).observe(stage);resize();
  function loadBoard() {
    return new Promise((resolve,reject)=>{
      boardFrame=document.createElement('iframe');boardFrame.className='intro-board';
      boardFrame.title='組み上がる発車案内';boardFrame.setAttribute('aria-hidden','true');boardFrame.inert=true;
      let observer,settled=false;
      const timer=setTimeout(()=>finish(new Error('案内画面を読み込めませんでした')),15000);
      function finish(error,value) {
        if(settled)return;settled=true;clearTimeout(timer);observer?.disconnect();
        if(error)reject(error);else resolve(value);
      }
      boardFrame.addEventListener('load',()=>{
        const doc=boardFrame.contentDocument;
        if(!doc?.getElementById('normal-up-list')){finish(new Error('案内画面を読み込めませんでした'));return;}
        const style=doc.createElement('style');style.textContent='#demo-dock,#demo-controls{display:none!important}';doc.head.append(style);
        let preparing=false;
        const check=async()=>{
          if(preparing||!doc.querySelector('#normal-up-list .train-kind'))return;
          preparing=true;observer?.disconnect();
          try {
            await doc.fonts.ready;
            if(settled)return;
            boardFrame.contentWindow.scaleScreen();
            await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
            if(settled)return;
            const next=createScreenAssembly(doc);next.seek(0);boardFrame.style.visibility='visible';finish(null,next);
          } catch(error){finish(new Error('組み上げ演出を準備できませんでした'));}
        };
        observer=new MutationObserver(check);observer.observe(doc.body,{childList:true,subtree:true});check();
      },{once:true});
      boardFrame.addEventListener('error',()=>finish(new Error('案内画面を読み込めませんでした')),{once:true});
      const base=location.pathname.replace(/\/$/,'');
      boardFrame.src=base.slice(0,base.lastIndexOf('/'))+'/normal';
      stage.prepend(boardFrame);resize();
    });
  }
  const fontsReady=Promise.all([document.fonts.load('100 53.5px TankyuLine','探究1A-2班'),
    document.fonts.load('400 58.5px TankyuZen','京阪電車・京阪バス')]).then(fonts=>{
    if(fonts.some(font=>font.length===0))throw Error('フォントを読み込めませんでした');
    buildImages();render(frame);
  });
  Promise.all([fontsReady,loadBoard()]).then(([,board])=>{
    assembly=board;ready=true;render(frame);slider.max=String(LAST);
    root.querySelectorAll('button,input').forEach(el=>el.disabled=false);
    status.textContent='プレビュー停止中';
  }).catch(error=>{
    status.textContent=error.message+'。再読み込みしてください。';status.setAttribute('role','alert');
    const retry=document.createElement('button');retry.type='button';retry.textContent='再読み込み';
    retry.addEventListener('click',()=>location.reload());status.after(retry);
  });
})();
