// 「気象警報の札のしくみ」デモ。入力をサーバーの判定（本番と同じ weather.summarize）にかけ、札と理由を描く
(function () {
    const base = location.pathname.replace(/\/$/, '');
    const $ = id => document.getElementById(id);
    const CITIES = ['寝屋川市', '枚方市', '交野市', '守口市', '門真市', '四條畷市', '大東市'];
    const SCOPES = {
        all: ['7市すべて', CITIES], north: ['寝屋川市・枚方市', ['寝屋川市', '枚方市']],
        east: ['交野市・四條畷市・大東市', ['交野市', '四條畷市', '大東市']], west: ['守口市・門真市', ['守口市', '門真市']],
    };
    const HOURS = [6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45];
    const STAGE_LABEL = { none: '', advisory: '注意', warning: '警報', danger: '危険', emergency: '特別' };
    const LEVELED = ['none', 'advisory', 'warning', 'danger', 'emergency'];
    const PLAIN = ['none', 'advisory', 'warning', 'emergency'];
    const ROWS = [
        { id: 'rain', name: '大雨', warn: [['none', 'なし'], ['advisory', 'レベル2 大雨注意報'], ['warning', 'レベル3 大雨警報'], ['danger', 'レベル4 大雨危険警報'], ['emergency', 'レベル5 大雨特別警報']], series: LEVELED, poss: true },
        { id: 'landslide', name: '土砂災害', warn: [['none', 'なし'], ['advisory', 'レベル2 土砂災害注意報'], ['warning', 'レベル3 土砂災害警報'], ['danger', 'レベル4 土砂災害危険警報'], ['emergency', 'レベル5 土砂災害特別警報']], series: LEVELED, poss: true },
        { id: 'flood', name: '氾濫', note: '川ごとに発表', warn: [['none', 'なし'], ['advisory', 'レベル2 氾濫注意報'], ['warning', 'レベル3 氾濫警報'], ['danger', 'レベル4 氾濫危険警報'], ['emergency', 'レベル5 氾濫特別警報']] },
        { id: 'storm', name: '暴風', note: '雪を伴うと暴風雪', warn: [['none', 'なし'], ['advisory', '強風注意報'], ['warning', '暴風警報'], ['snowstorm', '暴風雪警報'], ['emergency', '暴風特別警報']], series: PLAIN, poss: true, snow: true },
        { id: 'snow', name: '大雪', warn: [['none', 'なし'], ['advisory', '大雪注意報'], ['warning', '大雪警報'], ['emergency', '大雪特別警報']], series: PLAIN, poss: true },
        { id: 'wave', name: '波浪', note: '本校の基準の対象外', warn: [['none', 'なし'], ['advisory', '波浪注意報'], ['warning', '波浪警報']] },
    ];
    const KEYWORD = { rain: /大雨/, landslide: /土砂災害/, flood: /氾濫/, storm: /暴風/, snow: /^大雪/, wave: /波浪/ };

    const blank = () => ({
        hour: 12,
        warn: Object.fromEntries(ROWS.map(r => [r.id, { stage: 'none', cities: [] }])),
        series: Object.fromEntries(ROWS.filter(r => r.series).map(r => [r.id, { scope: 'all', snow: false, blocks: {} }])),
        poss: Object.fromEntries(ROWS.filter(r => r.poss).map(r => [r.id, { tonight: 'none', tomorrow: 'none' }])),
    });
    const fill = (from, to, stage) => Object.fromEntries(HOURS.filter(h => h >= from && h <= to).map(h => [h, stage]));
    const PRESETS = [
        { id: 'calm', label: '平常', story: '何も出ていない日。②③は毎日発表されているが、どれも「注意報級未満」「なし」なので札は出ない。', make: s => s },
        {
            id: 'eve', label: '台風の前日', story: '前日の夕方。まだ進路がぶれるので、③の「明日 暴風 高」だけが出ている。大雨は「中」なので出さない。',
            make: s => { s.hour = 17; s.poss.storm.tomorrow = 'high'; s.poss.rain.tomorrow = 'medium'; return s; },
        },
        {
            id: 'noon', label: '当日の昼', story: '当日の昼。②で市と時間帯がはっきりし、黄色の札に変わる。③の「高」も出ているが、同じ現象なので灰色の札は出さない。',
            make: s => {
                s.hour = 12; s.poss.storm.tonight = 'high'; s.poss.rain.tonight = 'high';
                s.warn.rain = { stage: 'advisory', cities: CITIES.slice() }; s.warn.storm = { stage: 'advisory', cities: CITIES.slice() };
                s.series.storm.blocks = { ...fill(12, 15, 'advisory'), ...fill(18, 24, 'warning'), ...fill(27, 30, 'advisory') };
                s.series.rain = { scope: 'north', snow: false, blocks: { ...fill(12, 15, 'advisory'), ...fill(18, 21, 'warning'), 24: 'advisory' } };
                return s;
            },
        },
        {
            id: 'evening', label: '夕方に警報', story: '夕方に暴風警報と大雨警報が出た。この2つは塗った札に変わる。土砂災害は21時から警報級の見込みなので、黄色の札が残る。',
            make: s => {
                s = PRESETS[2].make(s); s.hour = 18;
                s.warn.storm = { stage: 'warning', cities: CITIES.slice() };
                s.warn.rain = { stage: 'warning', cities: ['寝屋川市', '枚方市'] };
                s.series.landslide = { scope: 'east', snow: false, blocks: { ...fill(18, 18, 'advisory'), ...fill(21, 27, 'warning') } };
                return s;
            },
        },
        {
            id: 'night', label: '夜に特別警報', story: '夜。大雨特別警報を含めて警報が4種類になった。枠が埋まるので、予告の札は出さない。',
            make: s => {
                s = PRESETS[3].make(s); s.hour = 21;
                s.warn.rain = { stage: 'emergency', cities: ['寝屋川市', '枚方市'] };
                s.warn.landslide = { stage: 'danger', cities: ['交野市', '四條畷市', '大東市'] };
                s.warn.flood = { stage: 'warning', cities: ['寝屋川市', '枚方市', '守口市', '門真市'] };
                s.series.snow.blocks = fill(27, 33, 'warning');
                return s;
            },
        },
    ];

    let state = blank(), current = 'calm', result = null, timer = null, seq = 0;

    function el(tag, attrs = {}, ...children) {
        const node = document.createElement(tag);
        for (const [key, value] of Object.entries(attrs)) {
            if (key === 'class') node.className = value;
            else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
            else if (value !== false && value != null) node.setAttribute(key, value === true ? '' : value);
        }
        node.append(...children.flat().filter(c => c != null));
        return node;
    }
    const clock = h => `${String(h % 24).padStart(2, '0')}:00`;
    const hourText = h => (h >= 24 ? `明日${h - 24}時` : `${h}時`);

    function request() {
        const body = {
            hour: state.hour,
            warnings: ROWS.filter(r => state.warn[r.id].stage !== 'none' && state.warn[r.id].cities.length).map(r => {
                const w = state.warn[r.id];
                return w.stage === 'snowstorm' ? { element: 'snowstorm', stage: 'warning', cities: w.cities } : { element: r.id, stage: w.stage, cities: w.cities };
            }),
            series: ROWS.filter(r => r.series).map(r => {
                const s = state.series[r.id];
                return { element: r.id, cities: SCOPES[s.scope][1], snow: s.snow, blocks: Object.entries(s.blocks).filter(([, v]) => v !== 'none').map(([h, stage]) => ({ hour: Number(h), stage })) };
            }),
            possibility: ROWS.filter(r => r.poss).flatMap(r => ['tonight', 'tomorrow'].map(period => ({ element: r.id, period, value: state.poss[r.id][period] }))),
        };
        return JSON.stringify(body);
    }

    async function evaluate() {
        const mine = ++seq;
        try {
            const response = await fetch(`${base}/weather?state=${encodeURIComponent(request())}`, { cache: 'no-store' });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const data = await response.json();
            if (mine !== seq) return;
            result = data; $('error').hidden = true;
        } catch (error) {
            if (mine !== seq) return;
            $('error').hidden = false; $('error').textContent = '判定を取得できませんでした（' + error.message + '）。';
        }
        drawResult();
    }
    function changed() { current = null; drawPresets(); drawInputs(); clearTimeout(timer); timer = setTimeout(evaluate, 120); }

    function drawPresets() {
        $('presets').replaceChildren(...PRESETS.map(p => el('button', { type: 'button', 'aria-pressed': String(current === p.id), onclick: () => {
            state = p.make(blank()); current = p.id; drawPresets(); drawInputs(); evaluate();
        } }, p.label)));
        const preset = PRESETS.find(p => p.id === current);
        $('story').textContent = preset ? preset.story : '自由に設定中。上の場面を押すと、決まった状況に戻ります。';
    }

    function warnCell(row) {
        const w = state.warn[row.id];
        const select = el('select', { 'aria-label': row.name + 'の発表中の警報', onchange: e => {
            w.stage = e.target.value; if (w.stage !== 'none' && !w.cities.length) w.cities = CITIES.slice(); if (w.stage === 'none') w.cities = []; changed();
        } }, row.warn.map(([value, label]) => el('option', { value, selected: w.stage === value }, label)));
        const pills = el('div', { class: 'pills' }, CITIES.map(city => el('button', {
            type: 'button', 'aria-pressed': String(w.cities.includes(city)), disabled: w.stage === 'none',
            onclick: () => { w.cities = w.cities.includes(city) ? w.cities.filter(c => c !== city) : CITIES.filter(c => c === city || w.cities.includes(c)); changed(); },
        }, city.replace('市', ''))));
        return el('div', { class: 'warn', 'data-label': '① 発表中の警報' }, select, pills);
    }
    function ruler(className) {
        const from = HOURS.findIndex(h => h + 3 > state.hour), to = HOURS.findIndex(h => h >= state.hour + 12);
        return el('div', { class: className, 'aria-hidden': 'true' }, HOURS.map(h => el('span', { class: h === 24 ? 'day' : '' }, String(h % 24))),
            el('div', { class: 'ruler-window', style: `--from:${from + 1};--to:${(to < 0 ? HOURS.length : to) + 1}` }));
    }
    function seriesCell(row) {
        if (!row.series) return el('div', { 'data-label': '② 警報の予想時系列' }, el('span', { class: 'na' }, row.id === 'flood' ? '時系列には含まれない' : '—'));
        const s = state.series[row.id];
        const strip = el('div', { class: 'strip' }, HOURS.map(h => {
            const stage = s.blocks[h] || 'none';
            const past = h + 3 <= state.hour, later = h >= state.hour + 12;
            return el('button', {
                type: 'button', class: [stage, past ? 'past' : later ? 'later' : 'window'].join(' '),
                title: `${hourText(h)}〜 ${stage === 'none' ? '注意報級未満' : STAGE_LABEL[stage] + '級'}`, 'aria-label': `${row.name} ${hourText(h)}から3時間`,
                onclick: () => { s.blocks[h] = row.series[(row.series.indexOf(stage) + 1) % row.series.length]; changed(); },
            }, STAGE_LABEL[stage]);
        }));
        const opts = el('div', { class: 'series-opts' },
            el('label', {}, '市 ', el('select', { onchange: e => { s.scope = e.target.value; changed(); } }, Object.entries(SCOPES).map(([k, [label]]) => el('option', { value: k, selected: s.scope === k }, label)))),
            row.snow ? el('label', {}, el('input', { type: 'checkbox', checked: s.snow, onchange: e => { s.snow = e.target.checked; changed(); } }), ' 雪を伴う') : null);
        return el('div', { 'data-label': '② 警報の予想時系列' }, ruler('ruler inline'), strip, opts);
    }
    function possCell(row) {
        if (!row.poss) return el('div', { 'data-label': '③ 警報級の可能性' }, el('span', { class: 'na' }, '—'));
        const p = state.poss[row.id], order = ['none', 'medium', 'high'], text = { none: 'なし', medium: '中', high: '高' };
        return el('div', { class: 'poss', 'data-label': '③ 警報級の可能性' }, ['tonight', 'tomorrow'].map(period => el('button', {
            type: 'button', class: p[period], 'aria-label': `${row.name} ${period === 'tonight' ? '今夜' : '明日'}の可能性`,
            onclick: () => { p[period] = order[(order.indexOf(p[period]) + 1) % 3]; changed(); },
        }, el('small', {}, period === 'tonight' ? '今夜' : '明日'), text[p[period]])));
    }

    function drawInputs() {
        $('hour').value = state.hour; $('hour-label').textContent = clock(state.hour); $('board-time').textContent = clock(state.hour);
        $('ruler').replaceChildren(...ruler('').childNodes);
        const table = $('table'), active = document.activeElement, focusRow = active?.closest?.('[data-row]');
        const focusAt = focusRow ? [...focusRow.querySelectorAll('button,select,input')].indexOf(active) : -1;
        table.querySelectorAll('.row:not(.head)').forEach(r => r.remove());
        for (const row of ROWS) {
            table.append(el('div', { class: 'row', 'data-row': row.id },
                el('div', { class: 'name' }, row.name, row.note ? el('small', {}, row.note) : null),
                warnCell(row), seriesCell(row), possCell(row), el('div', { class: 'result', 'data-label': '画面の札', 'data-result': row.id })));
        }
        if (focusRow && focusAt >= 0) table.querySelector(`[data-row="${focusRow.dataset.row}"]`).querySelectorAll('button,select,input')[focusAt]?.focus();
        drawResult();
    }

    function reason(row, chips, crowded) {
        const w = state.warn[row.id];
        const stageName = (row.warn.find(([v]) => v === w.stage) || [])[1];
        const red = chips.find(c => c.type === 'warning'), soon = chips.find(c => c.type === 'soon'), poss = chips.find(c => c.type === 'possibility');
        const s = state.series[row.id], p = state.poss[row.id];
        const hasWarningLevel = s && Object.entries(s.blocks).some(([h, v]) => ['warning', 'danger', 'emergency'].includes(v) && Number(h) + 3 > state.hour);
        const lines = [];
        if (red) lines.push('① の警報が本校の基準に当たるので、塗った札にする。');
        if (soon) lines.push(red ? 'さらに上の段階になる見込みがあるので、黄色の札も出す。' : '① の警報はまだだが、② で12時間以内に警報級になるので、黄色の札にする。');
        if (poss) lines.push('①② に当たるものがなく、③ が「高」なので灰色の札にする。');
        if (red || soon) {
            if (p && (p.tonight === 'high' || p.tomorrow === 'high')) lines.push('③ の「高」は同じ現象なので出さない。');
            return lines.join('');
        }
        if (poss) return lines.join('');
        if (row.id === 'wave' && w.stage !== 'none') return '波浪警報は本校の基準の対象外なので出さない。';
        if (w.stage === 'advisory') lines.push(`${stageName}は札にしない。`);
        if (crowded && (hasWarningLevel || (p && (p.tonight === 'high' || p.tomorrow === 'high')))) lines.push('警報が4種類以上で枠が埋まるので、予告は出さない。');
        else {
            if (hasWarningLevel) lines.push('② の警報級は12時間より先なので、まだ出さない。');
            if (p && (p.tonight === 'medium' || p.tomorrow === 'medium')) lines.push('③ は「中」なので出さない（「高」だけ出す）。');
        }
        return lines.join('') || '当てはまる情報がない。';
    }

    function drawResult() {
        const data = result;
        window.renderWeather($('weather'), data);
        $('empty-note').hidden = !$('weather').hidden;
        if (!data) return;
        const crowded = data.warnings.length >= 4;
        const all = [...data.warnings.map(w => ({ type: 'warning', item: w })), ...data.previews.map(p => ({ type: p.kind, item: p }))];
        $('notice').hidden = !crowded || !data.previews.length;
        $('notice').textContent = '警報が4種類以上あるので、予告の札は出していません。';
        for (const row of ROWS) {
            const cell = document.querySelector(`[data-result="${row.id}"]`);
            if (!cell) continue;
            const chips = all.filter(c => KEYWORD[row.id].test(c.item.name)).filter(c => !(crowded && c.type !== 'warning'));
            const nodes = chips.map(c => {
                const i = c.item;
                if (c.type === 'warning') return el('span', { class: 'chip ' + i.tone }, (i.level ? `レベル${i.level} ` : '') + i.name);
                if (c.type === 'soon') return el('span', { class: 'chip soon' }, `${i.when} ${i.name}の可能性`);
                return el('span', { class: 'chip possibility' }, `${i.when} ${i.name} 警報級の可能性 高`);
            });
            if (!nodes.length) nodes.push(el('span', { class: 'none' }, '札なし'));
            cell.replaceChildren(el('div', {}, ...nodes.flatMap(n => [n, ' '])), el('div', {}, reason(row, chips, crowded)));
        }
    }

    function fit() {
        const stage = $('stage'), scale = stage.clientWidth / 1920;
        $('board').style.transform = `scale(${scale})`; stage.style.height = `${176 * scale}px`;
    }

    $('weather-back').href = base.replace(/\/[^/]+$/, '');
    $('hour').addEventListener('input', e => { state.hour = Number(e.target.value); changed(); });
    addEventListener('resize', fit);
    const helper = document.createElement('script');
    helper.src = base + '/weather.js';
    helper.onload = () => { fit(); drawPresets(); drawInputs(); evaluate(); };
    helper.onerror = () => { $('error').hidden = false; $('error').textContent = '札の描画部品を読み込めませんでした。'; };
    document.body.append(helper);
})();
