// 操作用ページから受け取った架空データを、本番と同じ描画処理に渡す。
(() => {
    $('demo-controls').hidden = false;
    $('demo-controls').textContent = 'デモ · 架空の想定 · 操作プレビュー';
    window.addEventListener('message', event => {
        if (event.origin !== location.origin || event.source !== parent || event.data?.type !== 'signage-demo:frame') return;
        const frame = event.data.frame;
        if (!frame || !Number.isFinite(frame.timestamp) || !frame.trains || !frame.line || !frame.buses || !frame.delays) return;
        demoTimestamp = frame.timestamp * 1000;
        trainData = frame.trains; lineData = frame.line; busData = frame.buses; delayData = frame.delays;
        render(); clockTick();
    });
    if (parent !== window) parent.postMessage({type: 'signage-demo:ready'}, location.origin);
})();
