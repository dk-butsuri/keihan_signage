import {createScreenAssembly} from './assembly.js';

/* handoff: 端末（controller の display.html）が「測量」の画面から切り替えるとき、この画面を裏で読み込んでおく。
   準備ができたら親に ready と見出しの下線の位置を伝え、「測量」の画面の後半が終わって go が届いてから組み上げる。
   下線は「測量」の線路がそのまま重なるので、組み上げでは引かない。状態（running・completed・skipped）も親に伝える。 */
export function startOpening({doc,boot,required,critical,hasError,handoff=false}) {
    const root=doc.documentElement,win=doc.defaultView,screen=doc.getElementById('screen');
    if(root.dataset.assembly!=='pending')return;
    let assembly=null,preparing=false,fontsReady=false,finished=false,released=!handoff,announced=false;
    const motion=win.matchMedia('(prefers-reduced-motion: reduce)');
    const observer=new MutationObserver(consider);
    const tell=(state,extra={})=>{if(handoff)win.parent.postMessage({type:'signage:handoff',state,...extra},win.location.origin);};
    function finish(state) {
        if(finished)return;finished=true;
        root.dataset.assembly=state;clearTimeout(boot.timer);observer.disconnect();
        assembly?.destroy();root.classList.remove('assembly-pending');
        doc.removeEventListener('visibilitychange',visibility);
        doc.removeEventListener('signage:assembly-cancel',cancel);
        win.removeEventListener('resize',cancel);motion.removeEventListener('change',cancel);
        win.removeEventListener('message',message);
        doc.dispatchEvent(new Event('signage:assembly-state'));
        tell(state);
    }
    function cancel(){finish('skipped');}
    function visibility(){if(doc.hidden)cancel();}
    function message(event) {
        if(event.source!==win.parent||event.origin!==win.location.origin||event.data?.type!=='signage:handoff-go')return;
        released=true;consider();
    }
    /* 見出しの下線の位置（端末の画面の座標）。線の太さは画面の縮尺ぶん細くなる。 */
    function rule() {
        const header=screen.querySelector('header'),rect=header.getBoundingClientRect();
        const scale=rect.width/header.offsetWidth||1;
        return {left:rect.left,right:rect.right,y:rect.bottom-scale/2,scale};
    }
    function consider() {
        if(root.dataset.assembly!=='pending'||preparing)return;
        if(doc.hidden||motion.matches||!doc.getElementById('suspended').hidden||critical.some(name=>boot.failed.has(name))||hasError()) {cancel();return;}
        if(!fontsReady||!required.every(name=>boot.settled.has(name)))return;
        if(!released) {
            if(!announced){announced=true;tell('ready',{rule:rule()});}
            return;
        }
        preparing=true;
        win.requestAnimationFrame(()=>win.requestAnimationFrame(()=>{
            if(root.dataset.assembly!=='pending')return;
            if(doc.hidden||motion.matches||!doc.getElementById('suspended').hidden||hasError()) {cancel();return;}
            try {
                observer.disconnect();assembly=createScreenAssembly(doc,{headerRule:!handoff});
                clearTimeout(boot.timer);root.dataset.assembly='running';root.classList.remove('assembly-pending');
                doc.dispatchEvent(new Event('signage:assembly-state'));
                tell('running');
                assembly.play().then(()=>finish('completed')).catch(cancel);
            } catch(error){cancel();}
        }));
    }
    observer.observe(screen,{childList:true,subtree:true,attributes:true});
    doc.addEventListener('visibilitychange',visibility);
    doc.addEventListener('signage:assembly-cancel',cancel);
    win.addEventListener('resize',cancel);motion.addEventListener('change',cancel);
    if(handoff)win.addEventListener('message',message);
    doc.fonts.ready.then(()=>{fontsReady=true;consider();}).catch(cancel);
    consider();
}
