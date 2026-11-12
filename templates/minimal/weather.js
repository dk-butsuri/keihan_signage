// サイネージと時計の画面で共通の、気象警報の札。/api/weather の結果を root（.wx）に描く
(function () {
    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }
    function cities(list, data, compress) {
        const node = el('span', 'wx-cities');
        if (list.length === data.area_count && list.length > 1) node.textContent = data.all_label;
        else if (compress && list.length >= 3) node.textContent = `${list[0]}ほか${list.length - 1}${data.unit}`;
        else list.forEach((city, index) => { if (index) node.append(el('i', null, '・')); node.append(city); });
        return node;
    }
    function item(chipClass, label, name, place) {
        const row = el('div', 'wx-item'), chip = el('span', 'wx-chip ' + chipClass);
        if (label) chip.append(el('span', 'wx-lv', label));
        chip.append(name);
        row.append(chip, place);
        return row;
    }
    window.renderWeather = function (root, data) {
        const available = !!(data && data.available);
        const warnings = available ? data.warnings : [];
        // 警報だけで枠が埋まるときは予告を出さない
        const previews = available && warnings.length < 4 ? data.previews : [];
        const count = warnings.length + previews.length;
        root.hidden = count === 0;
        if (!count) return;
        const compress = count > 2;
        root.classList.toggle('one', count === 1);
        root.classList.toggle('many', compress);
        root.querySelector('[data-weather=title]').textContent = warnings.length ? '気象警報' : '警報の予告';
        root.querySelector('[data-weather=time]').textContent = `${data.as_of} 時点`;
        root.querySelector('[data-weather=items]').replaceChildren(
            ...warnings.map(w => item(w.tone, w.level ? `レベル${w.level}` : '', w.name, cities(w.cities, data, compress))),
            ...previews.map(p => p.kind === 'soon'
                ? item('pre soon', p.when, p.name + 'の可能性', cities(p.cities, data, compress))
                : item('pre possibility', p.when, p.name + ' 警報級の可能性 高', el('span', 'wx-cities', p.place))),
        );
    };
})();
