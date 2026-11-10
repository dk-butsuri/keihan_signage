import {createScreenAssembly} from './assembly.js';

export function startOpening({doc,boot,required,critical,hasError}) {
    const root=doc.documentElement,win=doc.defaultView,screen=doc.getElementById('screen');
    if(root.dataset.assembly!=='pending')return;
    let assembly=null,preparing=false,fontsReady=false,finished=false;
    const motion=win.matchMedia('(prefers-reduced-motion: reduce)');
    const observer=new MutationObserver(consider);
    function finish(state) {
        if(finished)return;finished=true;
        root.dataset.assembly=state;clearTimeout(boot.timer);observer.disconnect();
        assembly?.destroy();root.classList.remove('assembly-pending');
        doc.removeEventListener('visibilitychange',visibility);
        doc.removeEventListener('signage:assembly-cancel',cancel);
        win.removeEventListener('resize',cancel);motion.removeEventListener('change',cancel);
        doc.dispatchEvent(new Event('signage:assembly-state'));
    }
    function cancel(){finish('skipped');}
    function visibility(){if(doc.hidden)cancel();}
    function consider() {
        if(root.dataset.assembly!=='pending'||preparing)return;
        if(doc.hidden||motion.matches||!doc.getElementById('suspended').hidden||critical.some(name=>boot.failed.has(name))||hasError()) {cancel();return;}
        if(!fontsReady||!required.every(name=>boot.settled.has(name)))return;
        preparing=true;
        win.requestAnimationFrame(()=>win.requestAnimationFrame(()=>{
            if(root.dataset.assembly!=='pending')return;
            if(doc.hidden||motion.matches||!doc.getElementById('suspended').hidden||hasError()) {cancel();return;}
            try {
                observer.disconnect();assembly=createScreenAssembly(doc);
                clearTimeout(boot.timer);root.dataset.assembly='running';root.classList.remove('assembly-pending');
                doc.dispatchEvent(new Event('signage:assembly-state'));
                assembly.play().then(()=>finish('completed')).catch(cancel);
            } catch(error){cancel();}
        }));
    }
    observer.observe(screen,{childList:true,subtree:true,attributes:true});
    doc.addEventListener('visibilitychange',visibility);
    doc.addEventListener('signage:assembly-cancel',cancel);
    win.addEventListener('resize',cancel);motion.addEventListener('change',cancel);
    doc.fonts.ready.then(()=>{fontsReady=true;consider();}).catch(cancel);
    consider();
}
