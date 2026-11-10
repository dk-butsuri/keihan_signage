export function createScreenAssembly(doc) {
    const screen=doc.getElementById('screen'),animations=[],helpers=[],styles=[];
    let destroyed=false;
    function changeStyle(element,name,value) {
        styles.push([element,name,element.style[name]]);element.style[name]=value;
    }
    function destroy() {
        if(destroyed)return;destroyed=true;
        animations.forEach(animation=>animation.cancel());helpers.forEach(element=>element.remove());
        for(const [element,name,value] of styles.reverse())element.style[name]=value;
    }
    const visible=element=>element&&!element.closest('[hidden]');
    function motion(element,frames,start,duration,easing='cubic-bezier(.22,.8,.18,1)') {
        if(!visible(element))return;
        const animation=element.animate(frames,{delay:start,duration,easing,fill:'both'});
        animation.id='screen-assembly';animation.pause();animation.currentTime=0;animations.push(animation);
    }
    const sweep=(el,start,duration=400,x=0)=>motion(el,[
        {opacity:0,clipPath:'inset(0 100% 0 0)',transform:`translateX(${x}px)`},
        {opacity:1,clipPath:'inset(0 0 0 0)',transform:'translateX(0)'}
    ],start,duration);
    const lift=(el,start,duration=360,y=5)=>motion(el,[
        {opacity:0,clipPath:'inset(100% 0 0 0)',transform:`translateY(${y}px)`},
        {opacity:1,clipPath:'inset(0 0 0 0)',transform:'translateY(0)'}
    ],start,duration,'cubic-bezier(.16,1,.3,1)');
    const enter=(el,start,duration,x=0,y=0)=>motion(el,[
        {opacity:0,transform:`translate(${x}px,${y}px)`},
        {opacity:1,transform:'translate(0,0)'}
    ],start,duration);
    function rule(element,start,duration) {
        if(!visible(element))return;
        const color=doc.defaultView.getComputedStyle(element).borderBottomColor;
        changeStyle(element,'position','relative');changeStyle(element,'borderBottomColor','transparent');
        const line=doc.createElement('span');line.setAttribute('aria-hidden','true');
        line.className='demo-assembly-rule';
        line.style.cssText=`position:absolute;left:0;right:0;bottom:-1px;height:1px;background:${color};transform-origin:left center;pointer-events:none`;
        element.append(line);helpers.push(line);
        motion(line,[{transform:'scaleX(0)',backgroundColor:'#909095'},{transform:'scaleX(1)',backgroundColor:color}],start,duration,'cubic-bezier(.65,0,.25,1)');
    }
    try {
        const header=screen.querySelector('header');
        changeStyle(screen,'position','relative');
        lift(doc.getElementById('station-name'),0,420,8);
        doc.querySelectorAll('#clock-time > span,#clock-seconds > span').forEach((digit,index)=>lift(digit,55+index*27,380,9));
        enter(doc.getElementById('clock-date'),210,300,0,3);
        rule(header,380,500);
        const columns=['normal-up','normal-down','normal-buses','normal-delays'].map(id=>doc.getElementById(id)).filter(visible);
        const screenRect=screen.getBoundingClientRect(),headRect=header.getBoundingClientRect(),bottom=doc.getElementById('normal').getBoundingClientRect().bottom;
        const scale=screenRect.width/parseFloat(doc.defaultView.getComputedStyle(screen).width);
        const names=columns.map(column=>column.firstElementChild.firstElementChild.textContent);
        columns.forEach((column,index)=>{
            const begin=800+index*480,heading=column.firstElementChild;
            [...heading.children].forEach(child=>sweep(child,begin,380,-4));
            rule(heading,begin+90,440);
            const rect=column.getBoundingClientRect(),guide=doc.createElement('span');
            guide.className='demo-assembly-guide';guide.setAttribute('aria-hidden','true');
            guide.style.cssText=`position:absolute;left:${(rect.left-screenRect.left)/scale-(index?7:0)}px;top:${(headRect.bottom-screenRect.top)/scale}px;height:${(bottom-headRect.bottom)/scale}px;width:1px;background:#909095;transform-origin:center top;pointer-events:none`;
            screen.append(guide);helpers.push(guide);
            motion(guide,[{opacity:0,transform:'scaleY(0)'},{opacity:.4,transform:'scaleY(1)',offset:.64},{opacity:0,transform:'scaleY(1)'}],begin+120,940,'cubic-bezier(.65,0,.25,1)');
            const list=column.querySelector('.delay-list,[id$="-list"]');
            [...list.children].forEach((card,rowIndex)=>{
                const row=begin+205+rowIndex*44;
                motion(card,[{opacity:0,clipPath:'inset(0 100% 0 0)',transform:'translateX(-4px)'},
                    {opacity:1,clipPath:'inset(0 0 0 0)',transform:'translateX(0)'}],row,420,'cubic-bezier(.65,0,.2,1)');
                if(card.querySelector('.train-kind')) {
                    motion(card.querySelector('.train-kind'),[{clipPath:'inset(0 0 100% 0)'},{clipPath:'inset(0 0 0 0)'}],row+140,360,'cubic-bezier(.2,.75,.2,1)');
                    sweep(card.querySelector('[data-field="time-label"]'),row+225,280,-3);
                    sweep(card.querySelector('[data-field="original"]'),row+225,280,-3);
                    sweep(card.querySelector('[data-field="time"]'),row+265,400,-6.6);
                    sweep(card.querySelector('[data-field="destination"]'),row+335,400,-12);
                    enter(card.querySelector('[data-field="remaining"]'),row+415,350,7.2);
                    enter(card.querySelector('[data-field="delay"]'),row+415,350,7.2);
                    lift(card.querySelector('[data-field="sub"]'),row+480,360,4);
                } else if(card.classList.contains('bus-card')) {
                    sweep(card.querySelector('[data-field="origin"]'),row+265,380,-6);
                    sweep(card.querySelector('[data-field="destination"]'),row+265,380,-6);
                    enter(card.querySelector('[data-field="arrival"]'),row+335,400,-7.2);
                    enter(card.querySelector('[data-field="terminal-time"]'),row+400,400,7.2);
                    enter(card.querySelector('.bus-arrow'),row+335,350);
                    lift(card.querySelector('[data-field="status"]'),row+475,360,4);
                    lift(card.querySelector('[data-field="terminal-note"]'),row+475,360,4);
                } else {
                    sweep(card.querySelector('.operation-group-name'),row+290,400,-6);
                    enter(card.querySelector('.operation-mark'),row+290,400);
                    enter(card.querySelector('.operation-group-status'),row+405,380,7.2);
                }
            });
        });
        const finishAt=800+(columns.length-1)*480+1160;
        const footer=doc.getElementById('operation-slides');
        if(visible(footer)) {
            sweep(footer,finishAt,480);
            sweep(footer.querySelector('.operation-viewport'),finishAt+170,400,-6);
            enter(footer.querySelector('.operation-pagination'),finishAt+285,320,0,3);
        }
        return {
            duration:finishAt+605,
            seek(ms){for(const animation of animations)animation.currentTime=Math.max(0,ms);},
            phase(ms){if(ms<800)return '駅名・時計';const index=Math.min(columns.length-1,Math.floor((ms-800)/480));return ms>=finishAt?'仕上げ':names[index];},
            play(){
                const start=doc.timeline.currentTime;
                for(const animation of animations){animation.play();if(start!==null)animation.startTime=start;}
                return Promise.all(animations.map(animation=>animation.finished));
            },
            destroy
        };
    } catch(error){destroy();throw error;}
}
