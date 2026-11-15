(() => {
    const base = location.pathname.replace(/\/$/, ''), $ = id => document.getElementById(id);
    const frame = $('preview');
    let catalog, defaults, state, latest, selected = '京阪', current = 'normal', ready = false;
    let revision = 0, timer, loadingTimer;
    const fields = {
        'screen': 'screen', 'train-delay': 'train_delay', 'train-stop': 'train_stop',
        'train-remaining': 'train_remaining', 'train-count': 'train_count', 'predictions': 'predictions',
        'bus-delay': 'bus_delay', 'bus-remaining': 'bus_remaining', 'bus-count': 'bus_count', 'bus-arrived': 'bus_arrived',
    };
    const presets = [
        {id: 'normal', label: 'すべて平常', group: '京阪', story: 'すべて平常運転。値を変えると、そのまま自由に試せます。', apply() {}},
        {id: 'mixed', label: '平常＋UNKNOWN', group: 'その他の私鉄',
            story: '阪神本線だけが状況不明。阪急・南海が平常でも「その他の私鉄」は「！ 状況不明」になります。',
            apply() { route('hanshin:阪神本線').status = 'unknown'; }},
        {id: 'unknown', label: '全路線UNKNOWN', group: '大阪モノレール',
            story: '大阪モノレールの2路線とも状況不明。「！ 状況不明」を表示し、下部には発表文を出しません。',
            apply() { forGroup('大阪モノレール', 'unknown'); }},
        {id: 'missing', label: '未取得', group: '大阪モノレール',
            story: '大阪モノレールの情報がまだない状態。「− 情報なし」を表示します。',
            apply() { forGroup('大阪モノレール', 'missing'); }},
        {id: 'disruption', label: 'JR見合わせ', group: 'JR',
            story: 'JRで見合わせ、京阪は12分遅れ。右側の路線一覧と下部の発表文を確認できます。',
            apply() {
                state.train_delay = 12;
                for (const item of catalog.routes.filter(r => r.group === 'JR').slice(0, 5)) route(item.id).status = 'suspended';
            }},
        {id: 'stopped', label: '広域に影響・停止', group: '京阪',
            story: '京阪は120分遅れ・25分停止。路線図の画面に切り替え、ほかの各社にも遅延を設定しています。',
            apply() {
                state.screen = 'suspended'; state.train_delay = 120; state.train_stop = 25; state.bus_delay = 75;
                for (const item of catalog.routes) route(item.id).status = item.group === '京阪' ? 'suspended' : 'delayed';
            }},
    ];
    $('playground-back').href = base.slice(0, base.lastIndexOf('/'));
    $('fullscreen').addEventListener('click', async () => {
        try {
            if (document.fullscreenElement) await document.exitFullscreen();
            else await $('stage').requestFullscreen();
        } catch { showError('全画面表示を利用できません。このままプレビューで確認できます。'); }
    });
    $('retry').addEventListener('click', () => state && ready ? changed(false) : location.reload());

    function node(tag, text, attrs = {}) {
        const element = document.createElement(tag);
        if (text != null) element.textContent = text;
        for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
        return element;
    }
    function statuses(select, value = 'normal') {
        select.replaceChildren(...catalog.statuses.map(([id, label]) => node('option', label, {value: id})));
        select.value = value;
    }
    function route(id) {
        return state.routes[id] ||= {status: 'normal', detail: '架空の想定です。安全確認を行っています。', age: 8};
    }
    function forGroup(group, status) {
        for (const item of catalog.routes.filter(r => r.group === group)) route(item.id).status = status;
    }
    function drawPresets() {
        $('presets').replaceChildren(...presets.map(preset => {
            const button = node('button', preset.label, {type: 'button', 'aria-pressed': String(current === preset.id)});
            button.addEventListener('click', () => {
                state = structuredClone(defaults); current = preset.id; selected = preset.group;
                preset.apply(); syncInputs(); drawRoutes(); drawPresets(); changed(false);
            });
            return button;
        }));
        $('story').textContent = presets.find(p => p.id === current)?.story || '自由に設定中。路線ステータスと列車・バスの数値は、それぞれ独立して変更できます。';
    }
    function syncInputs() {
        for (const [id, key] of Object.entries(fields)) {
            const input = $(id);
            if (input.type === 'checkbox') input.checked = state[key];
            else input.value = state[key] ?? 0;
        }
        $('bus-unknown').checked = state.bus_delay == null;
        $('bus-delay').disabled = $('bus-unknown').checked;
        $('group').value = selected;
    }
    function drawRoutes() {
        $('routes').replaceChildren(...catalog.routes.filter(item => item.group === selected).map(item => {
            const setting = route(item.id), section = node('div', null, {class: 'route', 'data-route': item.id});
            const head = node('div', null, {class: 'route-head'});
            const inputId = 'route-' + catalog.routes.indexOf(item), select = node('select', null, {id: inputId, 'aria-label': item.label + 'のステータス'});
            statuses(select, setting.status);
            select.addEventListener('change', () => { setting.status = select.value; changed(); });
            head.append(node('label', item.label, {for: inputId}), select);
            const details = node('details'), detail = node('textarea', null, {rows: '2', maxlength: '1000', 'aria-label': item.label + 'の発表文'});
            detail.value = setting.detail;
            detail.addEventListener('input', () => { setting.detail = detail.value; changed(); });
            const age = node('input', null, {type: 'number', min: '0', max: '1440', 'aria-label': item.label + 'の発表からの分数'});
            age.value = setting.age;
            age.addEventListener('input', () => {
                if (age.value === '' || !age.checkValidity()) { invalidated(); return; }
                setting.age = Number(age.value); changed();
            });
            const ageLabel = node('label', null, {class: 'field'}), value = node('span');
            value.append(age, '分前'); ageLabel.append('発表から', value);
            details.append(node('summary', '発表文・経過時間'), ageLabel, detail);
            section.append(head, details); return section;
        }));
        drawResult();
    }
    function drawResult() {
        const group = latest?.delays.groups.find(g => g.name === selected);
        if (!group) return;
        const result = $('group-result');
        result.className = 'result' + (['！', '×', '△'].includes(group.mark) ? ' warning' : group.mark === '○' ? ' normal' : '');
        result.replaceChildren(node('b', group.mark), node('span', group.name + ' · ' + group.status));
    }
    function showError(message) {
        $('error').hidden = false; $('error').textContent = message; $('retry').hidden = false;
    }
    function invalidated() {
        ++revision; clearTimeout(timer);
        showError('数値を入力欄の範囲内で指定してください。プレビューは前回の値を表示しています。');
    }
    function changed(manual = true) {
        if (manual && current != null) { current = null; drawPresets(); }
        clearTimeout(timer);
        const mine = ++revision;
        if ([...document.querySelectorAll('input[type=number]:not(:disabled)')].some(input => input.value === '' || !input.checkValidity())) {
            invalidated(); return;
        }
        timer = setTimeout(() => evaluate(mine), 120);
    }
    function send() {
        if (!ready || !latest) return;
        frame.contentWindow.postMessage({type: 'signage-demo:frame', frame: latest}, location.origin);
        $('loading').hidden = true; clearTimeout(loadingTimer);
    }
    async function evaluate(mine) {
        try {
            const response = await fetch(base + '/evaluate', {
                method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(state),
                signal: AbortSignal.timeout(15000), cache: 'no-store',
            });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const data = await response.json();
            if (mine !== revision) return;
            latest = data; $('error').hidden = true; $('retry').hidden = true; drawResult(); send();
        } catch {
            if (mine === revision) showError('変更を反映できませんでした。プレビューは前回の値です。「再読み込み」で再度反映できます。');
        }
    }
    window.addEventListener('message', event => {
        if (event.origin !== location.origin || event.source !== frame.contentWindow || event.data?.type !== 'signage-demo:ready') return;
        ready = true; send();
    });

    async function start() {
        const response = await fetch(base + '/data', {cache: 'no-store', signal: AbortSignal.timeout(15000)});
        if (!response.ok) throw new Error('data unavailable');
        catalog = await response.json();
        defaults = catalog.state; state = structuredClone(defaults); latest = catalog.frame;
        for (const group of [...new Set(catalog.routes.map(item => item.group))]) $('group').append(node('option', group, {value: group}));
        statuses($('bulk-status'));
        $('group').addEventListener('change', () => { selected = $('group').value; drawRoutes(); });
        $('bulk-apply').addEventListener('click', () => { forGroup(selected, $('bulk-status').value); drawRoutes(); changed(); });
        for (const [id, key] of Object.entries(fields)) {
            const input = $(id);
            input.addEventListener(input.type === 'checkbox' || input.tagName === 'SELECT' ? 'change' : 'input', () => {
                if (input.type === 'number' && (input.value === '' || !input.checkValidity())) { invalidated(); return; }
                state[key] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
                changed();
            });
        }
        $('bus-unknown').addEventListener('change', () => {
            state.bus_delay = $('bus-unknown').checked ? null : Number($('bus-delay').value);
            $('bus-delay').disabled = $('bus-unknown').checked; changed();
        });
        syncInputs(); drawPresets(); drawRoutes(); $('controls').inert = false;
        loadingTimer = setTimeout(() => showError('プレビューを読み込めませんでした。「再読み込み」を押してください。'), 20000);
        frame.src = base + '/preview?motion=off';
    }
    start().catch(() => {
        $('loading').textContent = 'デモを読み込めませんでした。';
        showError('デモを読み込めませんでした。「再読み込み」を押してください。');
    });
})();
