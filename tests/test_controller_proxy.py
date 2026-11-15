import httpx
import pytest
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
