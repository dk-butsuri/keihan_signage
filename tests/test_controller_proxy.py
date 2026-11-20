import asyncio
import json

import httpx
import pytest
import yaml
from fastapi.testclient import TestClient

from controller import main as controller


def test_proxy_preserves_preview_and_repeated_query_params(monkeypatch):
    received = []

    def upstream(request):
        received.append(request)
        return httpx.Response(200, text='preview', headers={'content-type': 'text/html'})

    client_type = httpx.AsyncClient
    monkeypatch.setattr(controller.httpx, 'AsyncClient', lambda **kwargs: client_type(
        transport=httpx.MockTransport(upstream), **kwargs))
    client = TestClient(controller.app)
    response = client.get('/transit/?motion=off&tag=first&tag=last')
    assert response.status_code == 200
    assert response.text == 'preview'
    assert response.headers['content-type'] == 'text/html'
    assert received[0].url.params.multi_items() == [
        ('motion', 'off'), ('tag', 'first'), ('tag', 'last'),
    ]
    client.close()


def test_playground_proxy_forwards_input_without_changing_live_mode(monkeypatch):
    received = []
    def upstream(request):
        received.append(request)
        return httpx.Response(200, json={"demo": True}, headers={"cache-control": "no-store"})
    client_type = httpx.AsyncClient
    monkeypatch.setattr(controller.httpx, 'AsyncClient', lambda **kwargs: client_type(
        transport=httpx.MockTransport(upstream), **kwargs))
    mode = controller.current_mode
    client = TestClient(controller.app)
    response = client.post('/demo/playground/evaluate', json={"train_delay": 12})
    assert response.status_code == 200 and response.headers['cache-control'] == 'no-store'
    assert received[0].method == 'POST' and received[0].url.path == '/demo/playground/evaluate'
    assert received[0].read() == b'{"train_delay":12}'
    assert controller.current_mode == mode
    client.close()


@pytest.mark.parametrize('path,upstream_path', [
    ('/demo', '/demo'), ('/demo/', '/demo'),
    ('/demo/data', '/demo/data'), ('/demo/player.js', '/demo/player.js'),
    ('/demo/severe-weather', '/demo/severe-weather'),
    ('/demo/severe-weather/data', '/demo/severe-weather/data'),
    ('/demo/power-outage/player.js', '/demo/power-outage/player.js'),
    ('/transit/demo/severe-weather', '/demo/severe-weather'),
    ('/transit/demo', '/demo'), ('/transit/demo/data', '/demo/data'),
])
def test_demo_proxy_preserves_path_and_does_not_change_mode(path, upstream_path, monkeypatch):
    received = []

    def upstream(request):
        received.append(request)
        return httpx.Response(200, text='demo')

    client_type = httpx.AsyncClient
    monkeypatch.setattr(controller.httpx, 'AsyncClient', lambda **kwargs: client_type(
        transport=httpx.MockTransport(upstream), **kwargs))
    mode = controller.current_mode
    client = TestClient(controller.app)
    response = client.get(path + '?sample=delay')
    assert response.status_code == 200
    assert received[0].url.path == upstream_path
    assert received[0].url.params['sample'] == 'delay'
    assert controller.current_mode == mode
    client.close()


@pytest.mark.parametrize('features,expected', [
    ({'trains': False, 'buses': False, 'delays': True}, 'clock'),
    ({'trains': False, 'buses': True}, 'transit'),
    ({'trains': True, 'buses': False}, 'transit'),
    ({'trains': False}, 'transit'),  # 書かれていないバスはオン
])
def test_mode_is_clock_when_trains_and_buses_are_off(features, expected, tmp_path, monkeypatch):
    config = tmp_path / 'config.yml'
    config.write_text(yaml.safe_dump({'features': features}), encoding='utf-8')
    monkeypatch.setattr(controller, 'CONFIG_FILE', config)
    monkeypatch.setattr(controller, 'current_mode', 'transit')
    monkeypatch.setattr(controller, 'manual_override_until', None)
    client = TestClient(controller.app)
    status = client.get('/api/mode').json()
    assert status['mode'] == expected
    assert status['scheduled_mode'] == 'transit'
    assert status['transit_disabled'] is (expected == 'clock')
    client.close()


def test_saving_config_with_trains_and_buses_off_switches_displays_to_clock(tmp_path, monkeypatch):
    config = tmp_path / 'config.yml'
    config.write_text('features:\n  trains: true\n  buses: true\n', encoding='utf-8')
    monkeypatch.setattr(controller, 'CONFIG_FILE', config)
    monkeypatch.setattr(controller, 'ADMIN_TOKEN', 'secret')
    monkeypatch.setattr(controller, 'current_mode', 'transit')
    monkeypatch.setattr(controller, 'manual_override_until', None)
    client_type = httpx.AsyncClient
    monkeypatch.setattr(controller.httpx, 'AsyncClient', lambda **kwargs: client_type(
        transport=httpx.MockTransport(lambda request: httpx.Response(200)), **kwargs))
    queue = asyncio.Queue()
    controller.subscribers.append(queue)
    try:
        client = TestClient(controller.app)
        response = client.put('/api/config/json', json={'features': {'trains': False, 'buses': False}},
                              headers={'Authorization': 'Bearer secret'})
        assert response.status_code == 200
        assert json.loads(queue.get_nowait())['mode'] == 'clock'
        client.close()
    finally:
        controller.subscribers.remove(queue)


@pytest.mark.parametrize('features,suspended,expected', [
    ({'trains': True, 'buses': True}, False, 'full'),
    ({'trains': False, 'buses': True}, False, 'bus'),
    ({'trains': True, 'buses': False}, False, 'train'),
    ({'trains': True, 'buses': False}, True, 'full'),  # 見合わせ時の画面はいつもの画面で出す
    ({'trains': False, 'buses': True}, True, 'full'),
])
def test_transit_view_uses_board_when_only_one_is_on(features, suspended, expected, tmp_path, monkeypatch):
    config = tmp_path / 'config.yml'
    config.write_text(yaml.safe_dump({'features': features}), encoding='utf-8')
    monkeypatch.setattr(controller, 'CONFIG_FILE', config)
    monkeypatch.setattr(controller, 'current_mode', 'transit')
    monkeypatch.setattr(controller, 'manual_override_until', None)
    monkeypatch.setattr(controller, 'keihan_suspended', suspended)
    status = controller._mode_status()
    assert status['mode'] == 'transit' and status['transit_view'] == expected


@pytest.mark.parametrize('body,expected,changed', [
    ({'trains': {'suspended': True}}, True, True),
    ({'trains': {'suspended': False}}, False, False),
])
def test_refresh_suspension_reads_transit_status(body, expected, changed, monkeypatch):
    monkeypatch.setattr(controller, 'keihan_suspended', False)
    client_type = httpx.AsyncClient
    monkeypatch.setattr(controller.httpx, 'AsyncClient', lambda **kwargs: client_type(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json=body)), **kwargs))
    assert asyncio.run(controller._refresh_suspension()) is changed
    assert controller.keihan_suspended is expected


def test_refresh_suspension_keeps_state_when_transit_is_down(monkeypatch):
    monkeypatch.setattr(controller, 'keihan_suspended', True)
    client_type = httpx.AsyncClient
    monkeypatch.setattr(controller.httpx, 'AsyncClient', lambda **kwargs: client_type(
        transport=httpx.MockTransport(lambda request: httpx.Response(502, json={'detail': 'x'})), **kwargs))
    assert asyncio.run(controller._refresh_suspension()) is False
    assert controller.keihan_suspended is True


def test_status_carries_features_so_display_can_reload(tmp_path, monkeypatch):
    config = tmp_path / 'config.yml'
    config.write_text(yaml.safe_dump({'features': {'delays': False}}), encoding='utf-8')
    monkeypatch.setattr(controller, 'CONFIG_FILE', config)
    monkeypatch.setattr(controller, 'manual_override_until', None)
    assert controller._mode_status()['features'] == {'trains': True, 'buses': True, 'delays': False, 'weather': True}


def test_error_reports_are_merged_and_cleared(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    monkeypatch.setattr(controller, 'ERRORS_FILE', tmp_path / 'errors.json')
    monkeypatch.setattr(controller, 'DATA_DIR', tmp_path)
    monkeypatch.setattr(controller, 'ADMIN_TOKEN', 'secret')
    controller._error_times.clear()
    report = {'kind': 'error', 'message': 'x is not defined', 'source': '/clock/player.js:1:2', 'page': '/clock/', 'count': 3}
    with TestClient(controller.app) as client:
        assert client.post('/api/errors', json=[report, {'kind': 'bogus'}]).status_code == 204
        assert client.post('/api/errors', json=[report]).status_code == 204
        items = client.get('/api/errors').json()['items']
        assert len(items) == 1 and items[0]['count'] == 6
        assert client.post('/api/errors', json={'kind': 'error'}).status_code == 400
        assert client.delete('/api/errors').status_code == 401
        assert client.delete('/api/errors', headers={'Authorization': 'Bearer secret'}).status_code == 204
        assert client.get('/api/errors').json()['items'] == []
    controller._error_times.clear()


def test_displays_merge_tabs_and_show_details_only_to_admin(monkeypatch):
    from datetime import datetime
    from fastapi.testclient import TestClient
    monkeypatch.setattr(controller, 'ADMIN_TOKEN', 'secret')
    monkeypatch.setattr(controller, 'display_clients', {1: {'since': datetime(2026, 1, 1, 9), 'id': 'tab'},
                                                        2: {'since': datetime(2026, 1, 1, 10), 'id': 'tab'},
                                                        3: {'since': datetime(2026, 1, 1, 11), 'id': ''}})
    monkeypatch.setattr(controller, 'display_info', {})
    with TestClient(controller.app) as client:
        assert client.post('/api/displays/info', json={'id': 'tab', 'screen': [1920, 1080], 'dpr': 1, 'page': '/clock/', 'tab_age_ms': 7200000, 'page_age_ms': -5},
                           headers={'User-Agent': 'TestUA'}).status_code == 204
        public = client.get('/api/displays').json()
        assert public['count'] == 2 and 'clients' not in public
        clients = client.get('/api/displays', headers={'Authorization': 'Bearer secret'}).json()['clients']
        assert clients[0]['connections'] == 2 and clients[0]['user_agent'] == 'TestUA' and clients[0]['page'] == '/clock/'
        assert 'user_agent' not in clients[1]
        started = datetime.fromisoformat(clients[0]['tab_started'])
        assert 7190 < (datetime.now() - started).total_seconds() < 7210 and clients[0]['page_loaded'] is None
