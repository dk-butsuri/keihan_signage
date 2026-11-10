(() => {
    const base=location.pathname.replace(/\/$/,''),catalog=base.slice(0,base.lastIndexOf('/'));
    const get=id=>document.getElementById(id),gallery=get('pattern-gallery'),loading=get('pattern-loading');
    const density=get('pattern-density'),prediction=get('pattern-prediction');
    get('pattern-back').href=catalog;
    get('pattern-demo').addEventListener('change',event=>location.assign(catalog+'/'+event.target.value));
    const params=new URLSearchParams(location.search);
    if(['normal','compact'].includes(params.get('density')))density.value=params.get('density');
    if(['yes','no'].includes(params.get('prediction')))prediction.value=params.get('prediction');
    get('pattern-extras').open=params.get('extras')==='1';

    function filter() {
        let basic=0,extra=0;
        for(const section of gallery.querySelectorAll('.pattern-case')) {
            section.hidden=prediction.value!=='all'&&section.dataset.predicted!==prediction.value;
            if(!section.hidden) { if(section.dataset.extra==='true')extra++;else basic++; }
            for(const sample of section.querySelectorAll('[data-density]'))sample.hidden=density.value!=='both'&&sample.dataset.density!==density.value;
        }
        gallery.classList.toggle('single-density',density.value!=='both');
        get('pattern-count').textContent='基本 '+basic*(density.value==='both'?2:1)+'枚';
        get('pattern-extra-count').textContent='（'+extra+'条件）';
        get('pattern-extras').hidden=!extra;
    }
    function remember() {
        filter();
        const query=new URLSearchParams();
        if(density.value!=='both')query.set('density',density.value);
        if(prediction.value!=='all')query.set('prediction',prediction.value);
        if(get('pattern-extras').open)query.set('extras','1');
        history.replaceState(null,'',base+(query.size?'?'+query:''));
    }
    density.addEventListener('change',remember);prediction.addEventListener('change',remember);
    get('pattern-extras').addEventListener('toggle',remember);

    const frame=document.createElement('iframe');frame.className='pattern-source';frame.setAttribute('aria-hidden','true');frame.inert=true;
    const renderer=new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('renderer timeout')),20000);
        frame.addEventListener('load',()=>{
            clearTimeout(timer);
            if(typeof frame.contentWindow.renderTrains==='function')resolve(frame.contentWindow);
            else reject(new Error('renderer unavailable'));
        },{once:true});
        frame.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('renderer failed'));},{once:true});
        frame.src=catalog+'/normal';document.body.append(frame);
    });
    const data=fetch(base+'/data',{cache:'no-store',signal:AbortSignal.timeout(15000)}).then(response=>{
        if(!response.ok)throw new Error('patterns unavailable');return response.json();
    });
    Promise.all([renderer,data]).then(([source,patterns])=>{
        if(patterns.version!==1||patterns.mode!=='gallery'||!Array.isArray(patterns.cases))throw new Error('invalid patterns');
        const component=/\.(?:departure-[\w-]+|train-(?:kind[\w-]*|location|delay[\w-]*|stop[\w-]*)|sub-station[\w-]*|station-badge)\b/;
        const rules=[...source.document.querySelectorAll('style')].flatMap(style=>[...style.sheet.cssRules]).filter(rule=>rule.type===1&&component.test(rule.selectorText));
        const style=document.createElement('style');style.id='pattern-component-styles';
        style.textContent=rules.map(rule=>rule.selectorText.split(',').map(selector=>'#pattern-gallery '+selector.trim()).join(',')+'{'+rule.style.cssText+'}').join('\n');
        document.head.insertBefore(style,document.head.querySelector('style'));
        for(const item of patterns.cases) {
            source.renderTrains('up',Array.from({length:6},()=>({...item.train})));
            const rows=source.document.querySelectorAll('#normal-up-list > div');
            if(rows.length!==6)throw new Error('pattern not rendered');
            const fragment=get('pattern-case-template').content.cloneNode(true),section=fragment.querySelector('section');
            section.dataset.caseId=item.id;section.dataset.predicted=item.predicted?'yes':'no';section.dataset.extra=String(item.extra);
            section.querySelector('h2').textContent=item.title;
            const note=section.querySelector('.pattern-note');note.hidden=!item.note;note.textContent=item.note;
            section.querySelector('[data-density="normal"] .pattern-card').append(document.importNode(rows[0],true));
            section.querySelector('[data-density="compact"] .pattern-card').append(document.importNode(rows[4],true));
            get(item.extra?'pattern-extra-cases':'pattern-basic').append(fragment);
        }
        filter();gallery.hidden=false;loading.hidden=true;
    }).catch(()=>{
        loading.textContent='見本を読み込めませんでした。';
        const retry=document.createElement('button');retry.type='button';retry.textContent='再読み込み';retry.addEventListener('click',()=>location.reload());loading.append(' ',retry);
    }).finally(()=>frame.remove());
})();
